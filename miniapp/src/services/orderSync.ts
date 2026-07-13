import { OrderStatus } from '@/types';
import { rpc, STORE_ID, isBackendConfigured } from './supabase';
import { ensureDevOpenId } from './identity';

export interface OrderStatusUpdate {
  orderId: string;
  orderNo?: string;
  status: OrderStatus;
  updatedAt: number;
}

type StatusListener = (updates: OrderStatusUpdate[]) => void;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let listeners: Set<StatusListener> = new Set();
let lastPollAt: number = 0;

/**
 * 后端订单状态 -> 前端 OrderStatus 映射
 * 后端: created/paid/processing/completed/cancelled/refunded
 * 前端: pending(已下单待制作) / cooking(制作中) / serving(待上菜) / done(已完成) / cancelled
 */
function mapStatus(backendStatus: string): OrderStatus {
  switch (backendStatus) {
    case 'created': return 'pending';
    case 'paid': return 'pending';        // 已支付待接单 = 待制作
    case 'processing': return 'cooking';  // 后厨制作中
    case 'completed': return 'done';
    case 'cancelled':
    case 'refunded': return 'cancelled';
    default: return 'pending';
  }
}

interface BackendOrderStatus {
  order_id: string;
  order_no: string;
  status: string;
  updated_at: string;
}

/**
 * 拉取订单状态更新
 * 调用 list_order_status RPC,按 customer_ref(= openid) 查本店订单状态
 */
async function fetchStatusUpdates(): Promise<OrderStatusUpdate[]> {
  if (!isBackendConfigured()) return [];

  try {
    const openid = ensureDevOpenId();
    if (!openid) return [];

    const sinceIso = lastPollAt > 0 ? new Date(lastPollAt).toISOString() : null;
    const rows = await rpc<BackendOrderStatus[]>('list_order_status', {
      p_store_id: STORE_ID,
      p_customer_ref: openid,
      p_since: sinceIso,
    });
    lastPollAt = Date.now();

    if (!Array.isArray(rows) || rows.length === 0) return [];

    return rows.map((r) => ({
      orderId: r.order_id,
      orderNo: r.order_no,
      status: mapStatus(r.status),
      updatedAt: new Date(r.updated_at).getTime(),
    }));
  } catch (e) {
    console.warn('拉取订单状态失败', e);
    return [];
  }
}

/**
 * 开始轮询订单状态
 * @param intervalMs 轮询间隔,默认 8 秒
 */
export function startOrderStatusPolling(intervalMs = 8000) {
  if (pollingTimer) return; // 已在轮询

  // 立即拉一次
  pollOnce();

  pollingTimer = setInterval(pollOnce, intervalMs);
}

async function pollOnce() {
  try {
    const updates = await fetchStatusUpdates();
    if (updates.length > 0) {
      listeners.forEach((fn) => fn(updates));
    }
  } catch (e) {
    // 静默失败,不打断用户
  }
}

/**
 * 停止轮询
 */
export function stopOrderStatusPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

/**
 * 订阅订单状态变更
 * @returns 取消订阅函数
 */
export function subscribeOrderStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 手动拉取一次(支付成功后立即刷新用)
 */
export async function refreshOrderStatusNow(): Promise<OrderStatusUpdate[]> {
  const updates = await fetchStatusUpdates();
  if (updates.length > 0) {
    listeners.forEach((fn) => fn(updates));
  }
  return updates;
}

/**
 * 状态变更通知文案
 */
export function getStatusNotifyText(status: OrderStatus): string | null {
  switch (status) {
    case 'pending': return '✓ 支付成功,订单已提交后厨';
    case 'cooking': return '🍳 您的订单已开始制作';
    case 'serving': return '🍽️ 菜品已出餐,请等待服务员上菜';
    case 'done': return '✓ 订单已完成,期待您再次光临';
    case 'cancelled': return '订单已取消';
    default: return null;
  }
}
