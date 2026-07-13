import { rpc, STORE_ID } from './supabase';
import { ensureDevOpenId } from './identity';

// ============================================================
// 优惠券: 领取 / 查询 / 核销
// 后端 RPC(0016):
//   list_my_coupons(p_store_id, p_openid, p_status?)  查自己的券
//   redeem_coupon(p_coupon_id, p_order_id, p_store_id, p_openid)  核销
// 券由后端营销规则自动发放(run_marketing_rules),或 admin 手动发(issue_coupon)
// ============================================================

export type CouponKind = 'full_reduce' | 'cash' | 'new_user';
export type CouponStatus = 'unused' | 'used' | 'expired';

export interface Coupon {
  id: string;
  store_id: string;
  member_id: string;
  kind: CouponKind;
  threshold: number;
  value: number;
  status: CouponStatus;
  expire_at: string | null;
  used_order_id: string | null;
  created_at: string;
}

export interface RedeemResult {
  coupon_id: string;
  discount: number;
  new_total: number;
}

/** 查我的券(凭 openid) */
export async function listMyCoupons(status?: CouponStatus): Promise<Coupon[]> {
  const openid = ensureDevOpenId();
  if (!openid) return [];
  try {
    const rows = await rpc<Coupon[]>('list_my_coupons', {
      p_store_id: STORE_ID,
      p_openid: openid,
      p_status: status ?? null,
    });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('查券失败', e);
    return [];
  }
}

/** 核销券(下单时用) */
export async function redeemCoupon(
  couponId: string, orderId: string, storeId: string, openid: string
): Promise<RedeemResult> {
  return rpc<RedeemResult>('redeem_coupon', {
    p_coupon_id: couponId,
    p_order_id: orderId,
    p_store_id: storeId,
    p_openid: openid,
  });
}

/** 券可读文案 */
export function couponLabel(c: Coupon): string {
  if (c.kind === 'cash') return `¥${c.value} 元代金券`;
  if (c.kind === 'full_reduce') return `满 ${c.threshold} 减 ${c.value}`;
  if (c.kind === 'new_user') return `新客专享 · 满 ${c.threshold} 减 ${c.value}`;
  return `满 ${c.threshold} 减 ${c.value}`;
}

/** 券是否可用(未过期 + 未使用) */
export function isCouponUsable(c: Coupon): boolean {
  if (c.status !== 'unused') return false;
  if (c.expire_at && new Date(c.expire_at).getTime() < Date.now()) return false;
  return true;
}
