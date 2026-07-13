import { create } from 'zustand';
import { Dish, CartItem, Order, OrderType, OrderStatus } from '@/types';
import { STORE_ID, isBackendConfigured, rpc } from '@/services/supabase';

// 后端 session_cart 行（get_session_cart 返回）
interface SessionCartRow {
  item_id: string;
  name: string;
  price: number;
  img: string;
  qty: number;
  customer_ref: string | null;
}

interface CartState {
  items: CartItem[];
  orderType: OrderType;
  tableNo: string;
  storeId: string;          // 门店（默认 seed 店，可被扫码/URL 覆盖）
  pointId: string;          // 已解析的点位 uuid（下单用）；空=非堂食/未绑桌
  pointRef: string;         // 扫码/URL 原始点位标识（code 或 uuid），待解析
  sessionId: string;        // 堂食会话 id（来自 service_point.current_session_id）；空=非堂食/无会话
  orders: Order[];
  add: (dish: Dish) => void;
  minus: (dishId: string) => void;
  getCount: (dishId: string) => number;
  getTotalCount: () => number;
  getTotalPrice: () => number;
  clear: () => void;
  setOrderType: (t: OrderType) => void;
  setTableNo: (t: string) => void;
  setStoreId: (id: string) => void;
  setPointRef: (ref: string) => void;
  setPoint: (id: string) => void;
  setSessionId: (id: string) => void;
  /** 拉后端 session_cart 合并到本地 items（进入页面/绑桌后调） */
  mergeSessionCart: (dishMap: Record<string, Dish>) => Promise<void>;
  /** 清空 session_cart（下单后调） */
  clearSessionCart: () => Promise<void>;
  placeOrder: (payMethod: string) => string;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  getOrder: (orderId: string) => Order | undefined;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  orderType: 'dineIn',
  tableNo: '',
  storeId: STORE_ID,
  pointId: '',
  pointRef: '',
  sessionId: '',
  orders: [],

  add: (dish) => {
    const items = [...get().items];
    const idx = items.findIndex((i) => i.dish.id === dish.id);
    if (idx >= 0) {
      items[idx] = { ...items[idx], count: items[idx].count + 1 };
    } else {
      items.push({ dish, count: 1 });
    }
    set({ items });

    // 堂食且有会话：同步到后端共享购物车（异步，失败不阻塞 UI）
    syncSessionCart(get, dish.id, 1);
  },

  minus: (dishId) => {
    const items = [...get().items];
    const idx = items.findIndex((i) => i.dish.id === dishId);
    if (idx >= 0) {
      if (items[idx].count <= 1) {
        items.splice(idx, 1);
      } else {
        items[idx] = { ...items[idx], count: items[idx].count - 1 };
      }
      set({ items });
    }

    // 堂食且有会话：同步到后端共享购物车（异步）
    syncSessionCart(get, dishId, -1);
  },

  getCount: (dishId) => get().items.find((i) => i.dish.id === dishId)?.count || 0,

  getTotalCount: () => get().items.reduce((s, i) => s + i.count, 0),

  getTotalPrice: () =>
    Math.round(get().items.reduce((s, i) => s + i.dish.price * i.count, 0) * 100) / 100,

  clear: () => set({ items: [] }),

  setOrderType: (t) => set({ orderType: t }),
  setTableNo: (t) => set({ tableNo: t }),
  setStoreId: (id) => set({ storeId: id }),
  setPointRef: (ref) => set({ pointRef: ref }),
  setPoint: (id) => set({ pointId: id }),
  setSessionId: (id) => set({ sessionId: id }),

  mergeSessionCart: async (dishMap) => {
    const { sessionId, items } = get();
    if (!sessionId || !isBackendConfigured()) return;
    try {
      const rows = await rpc<SessionCartRow[]>('get_session_cart', { p_session_id: sessionId });
      if (!rows || !rows.length) return;
      // 后端聚合行覆盖本地（后端为准），但保留本地未同步的菜
      const merged: CartItem[] = rows.map((r) => ({
        dish: dishMap[r.item_id] || {
          id: r.item_id, name: r.name, price: r.price, categoryId: '',
          desc: '', img: r.img, sales: 0, tags: [],
        },
        count: r.qty,
      }));
      // 本地有但后端没有的菜保留（离线加的菜）
      const serverIds = new Set(rows.map((r) => r.item_id));
      items.forEach((i) => {
        if (!serverIds.has(i.dish.id)) merged.push(i);
      });
      set({ items: merged });
    } catch {
      // 拉共享购物车失败不阻塞点餐
    }
  },

  clearSessionCart: async () => {
    const { sessionId } = get();
    if (!sessionId || !isBackendConfigured()) return;
    try {
      await rpc('clear_session_cart', { p_session_id: sessionId });
    } catch {
      // 清空失败不阻塞下单
    }
  },

  placeOrder: (payMethod) => {
    const { items, orderType, tableNo, orders } = get();
    const totalPrice = Math.round(items.reduce((s, i) => s + i.dish.price * i.count, 0) * 100) / 100;
    const id = 'DD' + Date.now();
    const order: Order = {
      id,
      items: [...items],
      totalPrice,
      status: 'pending_payment',
      type: orderType,
      tableNo: orderType === 'dineIn' ? tableNo : orderType === 'takeout' ? '外卖配送' : '到店自取',
      createTime: '刚刚',
      payMethod
    };
    set({ orders: [order, ...orders], items: [] });
    return id;
  },

  updateOrderStatus: (orderId, status) => {
    const orders = get().orders.map((o) => o.id === orderId ? { ...o, status } : o);
    set({ orders });
  },

  getOrder: (orderId) => get().orders.find((o) => o.id === orderId)
}));

/**
 * 堂食 + 有会话时，把加/减菜同步到后端 session_cart。
 * 异步执行，失败静默（共享展示是辅助，不影响本地点餐）。
 */
function syncSessionCart(get: () => CartState, itemId: string, delta: number) {
  const { sessionId, orderType, pointId } = get();
  // 仅堂食且有 pointId 和 sessionId 时同步（外卖/未绑桌走纯本地）
  if (orderType !== 'dineIn' || !pointId || !sessionId || !isBackendConfigured()) return;
  rpc('add_to_session_cart', {
    p_session_id: sessionId,
    p_item_id: itemId,
    p_qty: delta,
    p_customer_ref: null,
  }).catch(() => {});
}
