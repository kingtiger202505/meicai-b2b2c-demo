// 会员 / 储值 / 券 —— 私域护城河核心
// 表结构对应 supabase/migrations/0004_member_stored_value.sql

export type SvTxnType = 'topup' | 'consume' | 'refund' | 'gift';
export type CouponKind = 'full_reduce' | 'cash' | 'new_user';
export type CouponStatus = 'unused' | 'used' | 'expired';

export interface Member {
  id: string;
  store_id: string;
  openid: string;
  unionid: string | null;
  phone: string | null;
  balance: number;          // 储值余额
  total_spent: number;
  visit_count: number;
  last_visit_at: string | null;
  created_at: string;
}

export interface StoredValueTxn {
  id: string;
  store_id: string;
  member_id: string;
  type: SvTxnType;
  amount: number;           // 正=入账 负=支出
  balance_after: number;
  order_id: string | null;
  wx_transaction_id: string | null;
  created_at: string;
}

export interface Coupon {
  id: string;
  store_id: string;
  member_id: string | null;
  kind: CouponKind;
  threshold: number;        // 满减门槛
  value: number;            // 减免金额
  status: CouponStatus;
  expire_at: string | null;
  used_order_id: string | null;
  created_at: string;
}
