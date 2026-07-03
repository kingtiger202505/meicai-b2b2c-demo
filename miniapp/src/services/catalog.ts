import { restGet, STORE_ID } from './supabase';
import { Category, Dish } from '@/types';

// 后端行数据（对应 supabase/migrations/0001_core.sql）
interface BackendCategory {
  id: string;
  name: string;
  sort: number;
}
interface BackendItem {
  id: string;
  category_id: string | null;
  name: string;
  price: number | string;
  img: string | null;
  descr: string | null;
  status: 'on_sale' | 'sold_out' | 'off_shelf';
  sales: number;
  sort: number;
}
export interface BackendPoint {
  id: string;
  code: string;
  name: string;
}

/** 拉后端真实分类 */
export async function fetchCategories(storeId = STORE_ID): Promise<Category[]> {
  const rows = await restGet<BackendCategory[]>(
    `category?store_id=eq.${storeId}&select=id,name,sort&order=sort.asc`
  );
  return rows.map((c) => ({ id: c.id, name: c.name }));
}

/** 拉后端真实菜品（含 sold_out，用于沽清置灰；off_shelf 被 RLS 过滤） */
export async function fetchDishes(storeId = STORE_ID): Promise<Dish[]> {
  const rows = await restGet<BackendItem[]>(
    `item?store_id=eq.${storeId}&status=neq.off_shelf&select=id,category_id,name,price,img,descr,status,sales,sort&order=sort.asc`
  );
  return rows.map((it) => ({
    id: it.id,
    name: it.name,
    price: Number(it.price),
    categoryId: it.category_id || '',
    desc: it.descr || '',
    img: it.img || '',
    sales: it.sales,
    tags: [],
    soldOut: it.status === 'sold_out',
  }));
}

/** 扫码解析：point 参数可能是 uuid，也可能是点位 code（如 T01）→ 解析为门店点位 */
export async function resolvePoint(pointRef: string, storeId = STORE_ID): Promise<BackendPoint | null> {
  if (!pointRef) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pointRef);
  const filter = isUuid ? `id=eq.${pointRef}` : `code=eq.${encodeURIComponent(pointRef)}`;
  const rows = await restGet<BackendPoint[]>(
    `service_point?store_id=eq.${storeId}&${filter}&select=id,code,name&limit=1`
  );
  return rows[0] || null;
}
