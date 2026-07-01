import type { OrderStatus } from './types';

// 订单状态机（v2）：created → paid → processing → completed
//   分支：cancelled（支付前/超时）、refunded（支付后取消退款）
// 转移与 supabase RPC 一致：pay_order / accept_order / complete_order / cancel_order

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created:    ['paid', 'cancelled'],
  paid:       ['processing', 'refunded'],   // 前台接单 → processing；取消 → refunded
  processing: ['completed', 'refunded'],    // 前台完成；异常作废退款
  completed:  [],
  cancelled:  [],
  refunded:   [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export const ACTIVE_STATUSES: OrderStatus[] = ['paid', 'processing'];
export const TERMINAL_STATUSES: OrderStatus[] = ['completed', 'cancelled', 'refunded'];

// 顾客侧文案（餐饮默认，其它行业可用 terminology.processing 覆盖 processing 文案）
export function customerStatusText(s: OrderStatus, processingWord = '备餐中'): string {
  switch (s) {
    case 'created':    return '待支付';
    case 'paid':       return '已支付，等待商家接单';
    case 'processing': return processingWord;
    case 'completed':  return '已完成';
    case 'cancelled':  return '已取消';
    case 'refunded':   return '已退款，请到前台处理';
  }
}
