// 菜品分类
export interface Category {
  id: string;
  name: string;
}

// 菜品
export interface Dish {
  id: string;
  name: string;
  price: number;
  categoryId: string;
  desc: string;
  img: string;
  sales: number;
  tags: string[];
  soldOut?: boolean;   // 沽清：后端 item.status = 'sold_out'（置灰 + 下单拦截）
}

// 购物车项
export interface CartItem {
  dish: Dish;
  count: number;
}

// 订单
export interface Order {
  id: string;
  items: CartItem[];
  totalPrice: number;
  status: OrderStatus;
  type: OrderType;
  tableNo: string;
  createTime: string;
  payMethod: string;
}

export type OrderStatus = 'pending_payment' | 'pending' | 'cooking' | 'serving' | 'done' | 'cancelled';
export type OrderType = 'dineIn' | 'takeout' | 'pickup';

export const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  pending_payment: '待支付',
  pending: '待制作',
  cooking: '制作中',
  serving: '待收银',
  done: '已完成',
  cancelled: '已取消'
};

export const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  pending_payment: '#e4393c',
  pending: '#ff9500',
  cooking: '#ff6b00',
  serving: '#2a9fd6',
  done: '#4cb050',
  cancelled: '#999'
};
