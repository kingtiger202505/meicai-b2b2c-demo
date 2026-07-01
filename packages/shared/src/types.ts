// 领域模型（行业中性）—— 前后端共用
// 表结构对应 supabase/migrations/0001_core.sql

export type ItemStatus = 'on_sale' | 'sold_out' | 'off_shelf';
export type OrderStatus =
  | 'created' | 'paid' | 'processing' | 'completed' | 'cancelled' | 'refunded';
export type PointStatus = 'idle' | 'occupied';
export type SessionStatus = 'open' | 'closed';

export interface Store {
  id: string;
  name: string;
  industry_type: string;      // restaurant | retail | ...
  terminology: Partial<Terminology>;
  theme: { primary?: string; tone?: string };
  created_at: string;
}

export interface ServicePoint {
  id: string;
  store_id: string;
  code: string;               // T01
  name: string;               // 3号桌
  status: PointStatus;
  current_session_id: string | null;
}

export interface Category {
  id: string;
  store_id: string;
  name: string;
  sort: number;
}

export interface Item {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  price: number;
  unit: string | null;
  img: string | null;
  descr: string | null;
  status: ItemStatus;
  sales: number;
  sort: number;
}

export interface Order {
  id: string;
  store_id: string;
  point_id: string | null;
  session_id: string | null;
  order_no: string;           // A023
  customer_ref: string | null;
  status: OrderStatus;
  total: number;
  pay_method: string | null;
  is_addon: boolean;          // 加菜单
  addon_seq: number | null;   // 第 N 单
  cancel_reason: string | null;
  created_at: string;
  paid_at: string | null;
  printed_at: string | null;
  completed_at: string | null;
  // order_token 永不下发到前端（query_order 已剥离）
}

export interface OrderItemLine {
  id: string;
  order_id: string;
  item_id: string | null;
  name_snapshot: string;
  price_snapshot: number;
  qty: number;
  note: string | null;
}

export interface OrderDetail {
  order: Order;
  items: OrderItemLine[];
}

// 下单入参：顾客只传这些，价格/单号/total 一律服务端算
export interface PlaceOrderItem {
  item_id: string;
  qty: number;
  note?: string;
}

// 各行业术语字典
export interface Terminology {
  point: string;              // 桌台 / 自提柜 / 工位
  point_short: string;        // 桌
  session: string;            // 就餐 / 取货 / 服务
  item: string;               // 菜品 / 货品 / 服务项
  kitchen_ticket: string;     // 后厨单 / 拣货单 / 工单
  customer_ticket: string;    // 小票 / 取货凭证 / 服务单
  sold_out: string;           // 沽清 / 缺货 / 售罄
  processing: string;         // 备餐中 / 拣货中 / 服务中
  fulfill: string;            // 上菜 / 交付
}
