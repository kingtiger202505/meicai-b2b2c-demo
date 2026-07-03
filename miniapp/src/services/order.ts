import { rpc, STORE_ID } from './supabase';

export interface PlaceOrderLine {
  item_id: string;
  qty: number;
  note?: string;
}

export interface PlaceOrderResult {
  order_id: string;
  order_no: string;
  order_token: string;
  total: number;
  is_addon: boolean;
  addon_seq: number | null;
}

export interface PayResult {
  order_id: string;
  status: string;
  member_id?: string | null;
  idempotent?: boolean;
}

/** 下单：只传 item_id/qty，价格/单号/total 服务端算；沽清由服务端权威拦截 */
export function placeOrder(params: {
  storeId?: string;
  pointId?: string | null;
  items: PlaceOrderLine[];
  customerRef?: string | null;
  payMethod?: string;
}): Promise<PlaceOrderResult> {
  return rpc<PlaceOrderResult>('place_order', {
    p_store_id: params.storeId || STORE_ID,
    p_point_id: params.pointId || null,
    p_items: params.items,
    p_customer_ref: params.customerRef ?? null,
    p_pay_method: params.payMethod ?? 'mock',
  });
}

/** mock 支付：一步 支付成功 + 无感建会员(openid 主键、附手机号) + 关联订单 */
export function mockPay(orderToken: string, openid?: string | null, phone?: string | null): Promise<PayResult> {
  return rpc<PayResult>('mock_pay_order', {
    p_order_token: orderToken,
    p_openid: openid ?? null,
    p_phone: phone ?? null,
  });
}

/** 我的订单（按 customer_ref = 伪 openid） */
export function listMyOrders(customerRef: string, storeId = STORE_ID): Promise<any[]> {
  return rpc<any[]>('list_my_orders', { p_store_id: storeId, p_customer_ref: customerRef });
}

/** 查会员（凭 openid） */
export function getMember(openid: string, storeId = STORE_ID): Promise<any> {
  return rpc<any>('get_member', { p_store_id: storeId, p_openid: openid });
}
