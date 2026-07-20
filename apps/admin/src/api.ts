import { supabase } from './supabase';
import type { Category, Item, ItemStatus, Store } from '@meicai/shared';

// ---------- 门店(owner 名下) ----------
export async function listMyStores(): Promise<Store[]> {
  const { data, error } = await supabase.rpc('list_my_stores');
  if (error) throw error;
  return (data ?? []) as Store[];
}

// 老板自助加分店(create_store SECURITY DEFINER RPC,谁建谁拥有;服务端校验已登录且为 owner)
export async function createStore(name: string, industryType = 'restaurant'): Promise<string> {
  const { data, error } = await supabase.rpc('create_store', {
    p_name: name,
    p_industry_type: industryType,
  });
  if (error) throw error;
  return (data as { store_id: string }).store_id;
}

// ---------- 读取(owner 读策略, 含 off_shelf) ----------
export async function listCategories(storeId: string): Promise<Category[]> {
  const { data, error } = await supabase
    .from('category')
    .select('id,store_id,name,sort')
    .eq('store_id', storeId)
    .order('sort');
  if (error) throw error;
  return (data ?? []) as Category[];
}

export async function listItems(storeId: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('item')
    .select('id,store_id,category_id,name,price,unit,img,descr,status,sales,sort')
    .eq('store_id', storeId)
    .order('sort');
  if (error) throw error;
  return (data ?? []) as Item[];
}

// ---------- 菜品写入(security definer RPC, 归属校验在服务端) ----------
export interface ItemInput {
  id?: string | null;
  store_id: string;
  name: string;
  price: number;
  category_id?: string | null;
  unit?: string | null;
  img?: string | null;
  descr?: string | null;
}

export const upsertItem = (i: ItemInput) =>
  supabase.rpc('upsert_item', {
    p_item_id: i.id ?? null,
    p_store_id: i.store_id,
    p_name: i.name,
    p_price: i.price,
    p_category_id: i.category_id ?? null,
    p_unit: i.unit ?? null,
    p_img: i.img ?? null,
    p_descr: i.descr ?? null,
  });

export const deleteItem = (id: string) =>
  supabase.rpc('delete_item', { p_item_id: id });

// 沽清/恢复(on_sale ⇄ sold_out)——老板端与 POS 店员端皆可
export const setItemStatus = (id: string, status: Extract<ItemStatus, 'on_sale' | 'sold_out'>) =>
  supabase.rpc('set_item_status', { p_item_id: id, p_status: status });

// 上架/下架(off_shelf ⇄ on_sale)——仅老板端
export const setItemShelf = (id: string, onShelf: boolean) =>
  supabase.rpc('set_item_shelf', { p_item_id: id, p_on_shelf: onShelf });

export const reorderItems = (orders: { item_id: string; sort: number }[]) =>
  supabase.rpc('reorder_items', { p_orders: orders });

// ---------- 分类写入 ----------
export const upsertCategory = (c: { id?: string | null; store_id: string; name: string; sort?: number }) =>
  supabase.rpc('upsert_category', {
    p_category_id: c.id ?? null,
    p_store_id: c.store_id,
    p_name: c.name,
    p_sort: c.sort ?? null,
  });

export const deleteCategory = (id: string) =>
  supabase.rpc('delete_category', { p_category_id: id });

export const reorderCategories = (orders: { category_id: string; sort: number }[]) =>
  supabase.rpc('reorder_categories', { p_orders: orders });

// ---------- 营业统计 ----------
export interface DailyStatsResult {
  date: string;
  revenue: number;
  order_count: number;
  avg_price: number;
  refund: number;
  pay_methods: { method: string; amount: number; count: number }[];
}

export interface DailyTrendItem {
  date: string;
  revenue: number;
  count: number;
}

export async function fetchDailyStats(storeId: string, date?: string): Promise<DailyStatsResult> {
  const { data, error } = await supabase.rpc('daily_stats', {
    p_store_id: storeId,
    p_date: date ?? null,
  });
  if (error) throw error;
  return data as DailyStatsResult;
}

export async function fetchDailyTrend(storeId: string, days = 7): Promise<DailyTrendItem[]> {
  const { data, error } = await supabase.rpc('daily_trend', {
    p_store_id: storeId,
    p_days: days,
  });
  if (error) throw error;
  return (data ?? []) as DailyTrendItem[];
}

// ---------- v4 员工管理 ----------
export interface StaffRow {
  user_id: string;
  store_id: string;
  name: string;
  role_id: string;
  role_name: string;
  created_at: string;
}

export async function listStaff(storeId: string): Promise<StaffRow[]> {
  const { data, error } = await supabase.rpc('list_staff', { p_store_id: storeId });
  if (error) throw error;
  return (data ?? []) as StaffRow[];
}

export const upsertStaff = (userId: string, storeId: string, name: string, roleId: string) =>
  supabase.rpc('upsert_staff', {
    p_user_id: userId, p_store_id: storeId, p_name: name, p_role_id: roleId,
  });

// 解绑/移除员工(老板用):删除本店 staff 绑定,Auth 账号保留但失去本店访问
export const deleteStaff = (userId: string, storeId: string) =>
  supabase.rpc('delete_staff', { p_user_id: userId, p_store_id: storeId });

// 账号创建闭环(去 UUID):调 create-staff Edge Function,用 service_role 建 Auth 账号 +
// 绑定门店/角色,返回一次性明文初始密码。前端只填 邮箱+姓名+角色。
export interface CreatedStaffCred {
  user_id: string;
  email: string;
  password: string;
  role_name: string;
}

export async function createStaffAccount(
  storeId: string, email: string, name: string, roleId: string,
): Promise<CreatedStaffCred> {
  const { data, error } = await supabase.functions.invoke('create-staff', {
    body: { store_id: storeId, email, name, role_id: roleId },
  });
  if (error) {
    // FunctionsHttpError: 响应体在 error.context(原始 Response),尽量取出可读消息
    let msg = error.message || '创建员工账号失败';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const b = await ctx.json();
        if (b?.message) msg = b.message;
      } catch { /* ignore parse error */ }
    }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.message || '创建员工账号失败');
  return data as CreatedStaffCred;
}

// ---------- v4 角色权限 ----------
export interface Role {
  id: string;
  name: string;
  built_in: boolean;
}

export interface Permission {
  id: string;
  name: string;
  category: string;
}

export async function listRoles(): Promise<Role[]> {
  const { data, error } = await supabase.from('role')
    .select('id,name,built_in').order('built_in', { ascending: false }).order('name');
  if (error) throw error;
  return (data ?? []) as Role[];
}

export async function listPermissions(): Promise<Permission[]> {
  const { data, error } = await supabase.from('permission')
    .select('id,name,category').order('category').order('id');
  if (error) throw error;
  return (data ?? []) as Permission[];
}

export async function listRolePermissions(roleId: string): Promise<string[]> {
  const { data, error } = await supabase.from('role_permission')
    .select('permission_id').eq('role_id', roleId);
  if (error) throw error;
  return (data ?? []).map((r: { permission_id: string }) => r.permission_id);
}

// ---------- v4 优惠券模板 ----------
export interface CouponTemplate {
  id: string;
  store_id: string;
  name: string;
  kind: 'full_reduce' | 'cash' | 'new_user';
  threshold: number;
  value: number;
  valid_days: number;
  total_quota: number | null;
  issued_count: number;
  enabled: boolean;
  created_at: string;
}

export async function listCouponTemplates(storeId: string): Promise<CouponTemplate[]> {
  const { data, error } = await supabase.from('coupon_template')
    .select('*').eq('store_id', storeId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CouponTemplate[];
}

export const upsertCouponTemplate = (t: {
  id?: string | null; store_id: string; name: string;
  kind: 'full_reduce' | 'cash' | 'new_user'; threshold: number; value: number;
  valid_days?: number; total_quota?: number | null; enabled?: boolean;
}) => supabase.rpc('upsert_coupon_template', {
  p_id: t.id ?? null, p_store_id: t.store_id, p_name: t.name, p_kind: t.kind,
  p_threshold: t.threshold, p_value: t.value,
  p_valid_days: t.valid_days ?? 30, p_total_quota: t.total_quota ?? null,
  p_enabled: t.enabled ?? true,
});

// ---------- v4 营销规则 ----------
export interface MarketingRule {
  id: string;
  store_id: string;
  name: string;
  trigger: string;
  action: { type: string; coupon_template_id?: string };
  enabled: boolean;
  priority: number;
  created_at: string;
}

export async function listMarketingRules(storeId: string): Promise<MarketingRule[]> {
  const { data, error } = await supabase.from('marketing_rule')
    .select('*').eq('store_id', storeId).order('priority').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MarketingRule[];
}

export const upsertMarketingRule = (r: {
  id?: string | null; store_id: string; name: string; trigger: string;
  action: { type: string; coupon_template_id?: string };
  enabled?: boolean; priority?: number;
}) => supabase.rpc('upsert_marketing_rule', {
  p_id: r.id ?? null, p_store_id: r.store_id, p_name: r.name, p_trigger: r.trigger,
  p_action: r.action, p_enabled: r.enabled ?? true, p_priority: r.priority ?? 0,
});

// ---------- 阶段4 数据看板 ----------
export interface StoreOrderRow {
  id: string;
  order_no: string;
  status: string;
  total: number;
  pay_method: string | null;
  customer_ref: string | null;
  cancel_reason: string | null;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  is_addon: boolean;
  addon_seq: number | null;
  point_name: string | null;
  items: { name: string; price: number; qty: number; note: string | null }[];
}

export interface StoreRefundRow {
  id: string;
  order_no: string;
  total: number;
  pay_method: string | null;
  cancel_reason: string | null;
  created_at: string;
  paid_at: string | null;
  point_name: string | null;
}

export interface StoreMemberRow {
  id: string;
  openid_tail: string;
  phone: string | null;
  balance: number;
  total_spent: number;
  visit_count: number;
  last_visit_at: string | null;
  created_at: string;
  topup_total: number;
}

export interface StaffLogRow {
  order_no: string;
  action: string;
  status: string;
  total: number;
  acted_at: string;
  point_name: string | null;
  settled_by: string | null;
}

// 查门店订单列表(含明细),支持按状态筛选
export async function fetchStoreOrders(storeId: string, status?: string): Promise<StoreOrderRow[]> {
  const { data, error } = await supabase.rpc('list_store_orders', {
    p_store_id: storeId,
    p_status: status ?? null,
    p_limit: 50,
  });
  if (error) throw error;
  return (data ?? []) as StoreOrderRow[];
}

// 查退款订单列表
export async function fetchStoreRefunds(storeId: string): Promise<StoreRefundRow[]> {
  const { data, error } = await supabase.rpc('list_store_refunds', {
    p_store_id: storeId,
    p_limit: 50,
  });
  if (error) throw error;
  return (data ?? []) as StoreRefundRow[];
}

// 查门店会员列表
export async function fetchStoreMembers(storeId: string): Promise<StoreMemberRow[]> {
  const { data, error } = await supabase.rpc('list_store_members', {
    p_store_id: storeId,
    p_limit: 50,
  });
  if (error) throw error;
  return (data ?? []) as StoreMemberRow[];
}

// 查门店员工操作日志(简化版:订单状态变更流水)
export async function fetchStaffLogs(storeId: string): Promise<StaffLogRow[]> {
  const { data, error } = await supabase.rpc('list_staff_logs', {
    p_store_id: storeId,
    p_limit: 50,
  });
  if (error) throw error;
  return (data ?? []) as StaffLogRow[];
}
