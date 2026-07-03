import { supabase } from './supabase';
import type { Order, OrderItemLine, Item, ServicePoint, Store, OrderStatus, ItemStatus, OrderDetail } from '@meicai/shared';

// 订单 + 明细 + 点位名 + 会员余额（PostgREST 关系嵌套）
export interface OrderRow extends Order {
  order_item: OrderItemLine[];
  service_point: { name: string } | null;
  member: { balance: number } | null; // 会员订单才有；非会员为 null（顾客联隐藏余额）
}

export async function getStoreId(): Promise<string> {
  const envStore = import.meta.env.VITE_STORE_ID as string;
  if (envStore) return envStore;
  const { data, error } = await supabase.rpc('current_staff_store');
  if (error) throw error;
  return data as string;
}

export async function getStore(storeId: string): Promise<Store> {
  const { data, error } = await supabase.from('store')
    .select('id,name,industry_type,terminology,theme,created_at').eq('id', storeId).single();
  if (error) throw error;
  return data as Store;
}

// 活动订单（待接单 + 备餐中）
export async function listActiveOrders(storeId: string): Promise<OrderRow[]> {
  const { data, error } = await supabase.from('orders')
    .select('*, order_item(*), service_point(name), member(balance)')
    .eq('store_id', storeId)
    .in('status', ['paid', 'processing'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrderRow[];
}

export async function listItems(storeId: string): Promise<Item[]> {
  const { data, error } = await supabase.from('item')
    .select('*').eq('store_id', storeId).neq('status', 'off_shelf').order('sort');
  if (error) throw error;
  return (data ?? []) as Item[];
}

export async function listOccupiedPoints(storeId: string): Promise<ServicePoint[]> {
  const { data, error } = await supabase.from('service_point')
    .select('*').eq('store_id', storeId).eq('status', 'occupied').order('code');
  if (error) throw error;
  return (data ?? []) as ServicePoint[];
}

// 门店动作（security definer RPC，已授 authenticated）
export const acceptOrder   = (id: string) => supabase.rpc('accept_order',   { p_order_id: id });
export const completeOrder = (id: string) => supabase.rpc('complete_order', { p_order_id: id });
// 重打：仅记录审计（reprint_count / last_reprinted_at），不改写首次 printed_at
export const reprintOrder  = (id: string) => supabase.rpc('reprint_order',  { p_order_id: id });
export const cancelOrder   = (id: string, reason?: string) =>
  supabase.rpc('cancel_order', { p_order_id: id, p_reason: reason ?? null });
export const setItemStatus = (id: string, status: ItemStatus) =>
  supabase.rpc('set_item_status', { p_item_id: id, p_status: status });
export const clearTable    = (pointId: string) => supabase.rpc('clear_table', { p_point_id: pointId });

export function toOrderDetail(row: OrderRow): OrderDetail {
  const { order_item, service_point, member, ...order } = row;
  void service_point; void member;
  return { order: order as Order, items: order_item ?? [] };
}

export type { OrderStatus };
