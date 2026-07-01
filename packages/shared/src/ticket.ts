import type { OrderDetail, Store, ServicePoint, Terminology } from './types';
import { resolveTerminology } from './terminology';

// 小票数据模型（渲染无关）——POS 用它渲染 58mm 预览/浏览器打印，
// 未来云打印机(飞鹅云)Edge Function 复用同一结构。两联：后厨单(无价) + 顾客联(含价)。

export interface TicketLine { name: string; qty: number; price?: number; note?: string | null; }

export interface KitchenTicket {
  kind: 'kitchen';
  title: string;              // 后厨单 / 拣货单 …
  order_no: string;
  point_name: string | null;  // 3号桌
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
  created_at: string;
  lines: TicketLine[];        // 含单价
  total: number;
  pay_method: string | null;
}

export function buildTickets(
  detail: OrderDetail,
  store: Pick<Store, 'name' | 'industry_type' | 'terminology'>,
  point?: Pick<ServicePoint, 'name'> | null,
  term?: Terminology,
): { kitchen: KitchenTicket; customer: CustomerTicket } {
  const t = term ?? resolveTerminology(store.industry_type, store.terminology);
  const o = detail.order;
  const kitchen: KitchenTicket = {
    kind: 'kitchen',
    title: t.kitchen_ticket,
    order_no: o.order_no,
    point_name: point?.name ?? null,
    addon: o.is_addon,
    addon_seq: o.addon_seq,
    created_at: o.created_at,
    lines: detail.items.map((i) => ({ name: i.name_snapshot, qty: i.qty, note: i.note })),
  };
  const customer: CustomerTicket = {
    kind: 'customer',
    title: t.customer_ticket,
    store_name: store.name,
    order_no: o.order_no,
    point_name: point?.name ?? null,
    created_at: o.created_at,
    lines: detail.items.map((i) => ({ name: i.name_snapshot, qty: i.qty, price: i.price_snapshot })),
    total: o.total,
    pay_method: o.pay_method,
  };
  return { kitchen, customer };
}
