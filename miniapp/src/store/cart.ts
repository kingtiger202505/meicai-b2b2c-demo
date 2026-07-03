import { create } from 'zustand';
import { Dish, CartItem, Order, OrderType, OrderStatus } from '@/types';
import { STORE_ID } from '@/services/supabase';

interface CartState {
  items: CartItem[];
  orderType: OrderType;
  tableNo: string;
  storeId: string;          // 门店（默认 seed 店，可被扫码/URL 覆盖）
  pointId: string;          // 已解析的点位 uuid（下单用）；空=非堂食/未绑桌
  pointRef: string;         // 扫码/URL 原始点位标识（code 或 uuid），待解析
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
