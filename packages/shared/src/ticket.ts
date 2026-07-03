import type { OrderDetail, Store, ServicePoint, Terminology } from './types';
import { resolveTerminology } from './terminology';

// 小票数据模型（渲染无关）——POS 用它渲染 58mm 预览/浏览器打印，
// 未来云打印机(飞鹅云)Edge Function 复用同一结构。两联：后厨单(无价) + 顾客联(含价)。

export interface TicketLine { name: string; qty: number; price?: number; note?: string | null; }

// 取餐主标识（后厨单/顾客联共用同一逻辑）：
// 堂食 → 桌号；自取/外带 → 取餐号(流水号)；两者缺失 → 回退流水号。
export interface PickupTag { label: string; value: string; }

export interface KitchenTicket {
  kind: 'kitchen';
  title: string;              // 后厨单 / 拣货单 …
  order_no: string;
  point_name: string | null;  // 3号桌
  pickup: PickupTag;          // 取餐主标识
  addon: boolean;             // 加菜
  addon_seq: number | null;
  created_at: string;
  lines: TicketLine[];        // 不含价格
}

export interface CustomerTicket {
  kind: 'customer';
  title: string;              // 小票 / 取货凭证 …
  store_name: string;
  order_no: string;
  point_name: string | null;
  pickup: PickupTag;          // 取餐主标识
  created_at: string;
  lines: TicketLine[];        // 含单价
  subtotal: number;           // 菜品小计合计
  discount: number;           // 优惠（小计 - 实付，≥0）
  total: number;              // 合计
  paid: number;               // 实付
  pay_method: string | null;
  member_balance: number | null; // 会员订单显示会员余额；非会员为 null（隐藏）
}

// 取餐主标识：有桌台 → 桌号；否则 → 取餐号(流水号)。
function resolvePickup(
  orderNo: string,
  point: Pick<ServicePoint, 'name'> | null | undefined,
  t: Terminology,
): PickupTag {
  if (point?.name) return { label: t.point, value: point.name };
  return { label: '取餐号', value: orderNo };
}

export function buildTickets(
  detail: OrderDetail,
  store: Pick<Store, 'name' | 'industry_type' | 'terminology'>,
  point?: Pick<ServicePoint, 'name'> | null,
  term?: Terminology,
  opts?: { memberBalance?: number | null },
): { kitchen: KitchenTicket; customer: CustomerTicket } {
  const t = term ?? resolveTerminology(store.industry_type, store.terminology);
  const o = detail.order;
  const pickup = resolvePickup(o.order_no, point, t);

  const kitchen: KitchenTicket = {
    kind: 'kitchen',
    title: t.kitchen_ticket,
    order_no: o.order_no,
    point_name: point?.name ?? null,
    pickup,
    addon: o.is_addon,
    addon_seq: o.addon_seq,
    created_at: o.created_at,
    lines: detail.items.map((i) => ({ name: i.name_snapshot, qty: i.qty, note: i.note })),
  };

  const subtotal = detail.items.reduce((s, i) => s + i.price_snapshot * i.qty, 0);
  const paid = o.total;
  const discount = Math.max(0, Math.round((subtotal - paid) * 100) / 100);

  const customer: CustomerTicket = {
    kind: 'customer',
    title: t.customer_ticket,
    store_name: store.name,
    order_no: o.order_no,
    point_name: point?.name ?? null,
    pickup,
    created_at: o.created_at,
    lines: detail.items.map((i) => ({ name: i.name_snapshot, qty: i.qty, price: i.price_snapshot })),
    subtotal,
    discount,
    total: o.total,
    paid,
    pay_method: o.pay_method,
    // 仅会员订单传入余额；非会员为 null，渲染层据此隐藏该字段。
    member_balance: opts?.memberBalance ?? null,
  };
  return { kitchen, customer };
}
