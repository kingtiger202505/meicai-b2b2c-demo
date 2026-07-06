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
