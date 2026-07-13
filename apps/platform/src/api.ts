import { platformClient, isServiceRoleMode } from './supabase';

// ---------- 类型 ----------

/** 进件状态(对应 wxpay_merchant.application_status) */
export type MerchantStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

/** wxpay_merchant 表行(平台管理端 service_role 直查) */
export interface WxpayMerchant {
  store_id: string;
  sub_mchid: string | null;
  application_status: MerchantStatus;
  legal_name: string | null;
  contact_phone: string | null;
  business_license_no: string | null;
  applied_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  raw_response: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** 商户进件列表项(wxpay_merchant + store join) */
export interface MerchantApplicationRow {
  store_id: string;
  store_name: string;
  sub_mchid: string | null;
  application_status: MerchantStatus;
  legal_name: string | null;
  contact_phone: string | null;
  business_license_no: string | null;
  applied_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
}

/** 门店列表项(store + store_owner) */
export interface StoreRow {
  id: string;
  name: string;
  industry_type: string;
  created_at: string;
  owner_user_id: string | null;
  merchant_status: MerchantStatus | null;
}

// ---------- 平台超管角色校验 ----------

/**
 * 检查当前登录用户是否为平台超管(boss)。
 * role 存于 auth.users.raw_app_meta_data.role = 'boss'。
 * 客户端通过 session.user.app_metadata.role 读取(Supabase 会把 raw_app_meta_data 映射到 app_metadata)。
 */
export function isBoss(appMetadata: Record<string, unknown> | undefined): boolean {
  if (!appMetadata) return false;
  return (appMetadata.role as string) === 'boss';
}

// ---------- Tab 1: 商户进件管理 ----------

/**
 * 查询所有商户进件记录(平台管理端 service_role 直查 wxpay_merchant + store join)。
 * 若未配置 service_role，则只能查到当前用户名下门店(owner RLS)。
 */
export async function listMerchantApplications(): Promise<MerchantApplicationRow[]> {
  // wxpay_merchant 与 store 都需要跨店查询，service_role 模式下 platformClient 绕过 RLS。
  // 用 select join: wxpay_merchant(store_id, ...) → store(id, name)
  const { data, error } = await platformClient
    .from('wxpay_merchant')
    .select(`
      store_id,
      sub_mchid,
      application_status,
      legal_name,
      contact_phone,
      business_license_no,
      applied_at,
      submitted_at,
      approved_at,
      rejected_reason,
      store:store_id ( name )
    `)
    .order('applied_at', { ascending: false });

  if (error) throw error;
  if (!data) return [];

  // Supabase join 返回的 store 是对象或数组(取决于关系基数)，这里统一规整
  return (data as Array<Record<string, unknown>>).map((row) => {
    const store = row.store as Array<{ name: string }> | { name: string } | null;
    const storeName = Array.isArray(store) ? (store[0]?.name ?? '') : (store?.name ?? '');
    return {
      store_id: row.store_id as string,
      store_name: storeName,
      sub_mchid: row.sub_mchid as string | null,
      application_status: row.application_status as MerchantStatus,
      legal_name: row.legal_name as string | null,
      contact_phone: row.contact_phone as string | null,
      business_license_no: row.business_license_no as string | null,
      applied_at: row.applied_at as string,
      submitted_at: row.submitted_at as string | null,
      approved_at: row.approved_at as string | null,
      rejected_reason: row.rejected_reason as string | null,
    };
  });
}

/**
 * 平台审批进件通过(调 approve_merchant_application RPC，仅 service_role)。
 * @param storeId 门店 ID
 * @param subMchid 微信特约商户号(进件成功后由微信返回；测试可填 mock 值)
 * @param rawResponse 可选，原始返回(默认记 mock 标记)
 */
export async function approveMerchantApplication(
  storeId: string,
  subMchid: string,
  rawResponse: Record<string, unknown> | null = null,
): Promise<void> {
  const { error } = await platformClient.rpc('approve_merchant_application', {
    p_store_id: storeId,
    p_sub_mchid: subMchid,
    p_raw_response: rawResponse ?? { source: 'platform_admin', mock: true, approved_at: new Date().toISOString() },
  });
  if (error) throw error;
}

// ---------- Tab 2: 商户列表 ----------

/**
 * 查询所有门店列表(store + store_owner + wxpay_merchant.application_status)。
 * service_role 模式下 platformClient 绕过 RLS 查全部门店。
 * 注：跨表 join auth.users 复杂，这里只显示 owner user_id，不显示邮箱。
 */
export async function listAllStores(): Promise<StoreRow[]> {
  // store → store_owner(user_id) + wxpay_merchant(application_status)
  const { data, error } = await platformClient
    .from('store')
    .select(`
      id,
      name,
      industry_type,
      created_at,
      store_owner ( user_id ),
      wxpay_merchant ( application_status )
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => {
    const owner = row.store_owner as Array<{ user_id: string }> | { user_id: string } | null;
    const ownerUserId = Array.isArray(owner) ? (owner[0]?.user_id ?? null) : (owner?.user_id ?? null);

    const merchant = row.wxpay_merchant as Array<{ application_status: MerchantStatus }> | { application_status: MerchantStatus } | null;
    let merchantStatus: MerchantStatus | null = null;
    if (Array.isArray(merchant)) {
      merchantStatus = merchant[0]?.application_status ?? null;
    } else if (merchant) {
      merchantStatus = merchant.application_status ?? null;
    }

    return {
      id: row.id as string,
      name: row.name as string,
      industry_type: row.industry_type as string,
      created_at: row.created_at as string,
      owner_user_id: ownerUserId,
      merchant_status: merchantStatus,
    };
  });
}

// ---------- 导出模式标记(App UI 提示用) ----------

export { isServiceRoleMode };
