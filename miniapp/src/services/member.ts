import { rpc, STORE_ID } from './supabase';

// ============================================================
// 会员 / 储值 / 余额支付 —— 私域护城河
// 后端 RPC（0005_member_rpc + 0009_mock_topup，均 security definer）：
//   get_or_create_member  建/取会员（anon）
//   get_member            查会员（anon）
//   mock_topup_member     mock 充值入账（anon；内部走 topup_member）
//   pay_with_balance      余额支付，原子扣减（anon）
// 真微信支付到位后，充值改由 wxpay-notify 调 topup_member，前端仅切支付发起。
// ============================================================

export interface Member {
  id: string;
  store_id: string;
  openid: string;
  phone: string | null;
  balance: number;
  total_spent: number;
  visit_count: number;
  last_visit_at: string | null;
  created_at: string;
}

export interface TopupResult {
  member_id: string;
  balance: number;
  gift: number;
  amount: number;
  idempotent?: boolean;
}

export interface BalancePayResult {
  order_id: string;
  status: string;
  balance: number;
}

/** 每满 100 送 20，累进（与后端 mock_topup_member / PRD Q1 一致，供前端展示预估赠送额） */
export function calcGift(amount: number): number {
  if (!amount || amount <= 0) return 0;
  return Math.floor(amount / 100) * 20;
}

/** 建/取会员（无感沉淀；可带手机号补全） */
export function getOrCreateMember(openid: string, phone?: string | null, storeId = STORE_ID): Promise<Member> {
  return rpc<Member>('get_or_create_member', { p_store_id: storeId, p_openid: openid, p_phone: phone ?? null });
}

/** 查会员（凭 openid），无会员返回 null */
export async function getMember(openid: string, storeId = STORE_ID): Promise<Member | null> {
  const m = await rpc<Member | null>('get_member', { p_store_id: storeId, p_openid: openid });
  return m || null;
}

/** mock 储值充值：入账 amount + 赠送，返回最新余额 */
export function mockTopup(openid: string, amount: number, phone?: string | null, storeId = STORE_ID): Promise<TopupResult> {
  return rpc<TopupResult>('mock_topup_member', {
    p_store_id: storeId,
    p_openid: openid,
    p_amount: amount,
    p_phone: phone ?? null,
  });
}

/** 余额支付：原子扣减，created→paid */
export function payWithBalance(orderToken: string, memberId: string): Promise<BalancePayResult> {
  return rpc<BalancePayResult>('pay_with_balance', { p_order_token: orderToken, p_member_id: memberId });
}
