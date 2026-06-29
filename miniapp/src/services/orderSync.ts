import Taro from '@tarojs/taro';
import { OrderStatus } from '@/types';

export interface OrderStatusUpdate {
  orderId: string;
  status: OrderStatus;
  updatedAt: number;
}

type StatusListener = (updates: OrderStatusUpdate[]) => void;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let listeners: Set<StatusListener> = new Set();
let lastPollAt = 0;

/**
 * 拉取订单状态更新
 *
 * 实际项目应调用云函数 / 后端 API：
 *   const res = await Taro.cloud.callFunction({
 *     name: 'getOrderStatusUpdates',
 *     data: { since: lastPollAt }
 *   });
 *   return res.result.updates;
 *
 * 此处 mock：从 POS 后台模拟拉取最新状态
 */
async function fetchStatusUpdates(): Promise<OrderStatusUpdate[]> {
  // ===== 实际项目代码（注释保留） =====
  // try {
  //   const res = await Taro.cloud.callFunction({
  //     name: 'getOrderStatusUpdates',
  //     data: { since: lastPollAt }
  //   });
  //   lastPollAt = Date.now();
  //   return res.result.updates || [];
  // } catch (e) {
  //   console.warn('拉取订单状态失败', e);
  //   return [];
  // }

  // ===== Mock 实现：返回空（无后端时无更新） =====
  return [];
}

/**
 * 开始轮询订单状态
 * @param intervalMs 轮询间隔，默认 8 秒
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
    // 静默失败，不打断用户
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
 * 长连接方案（WebSocket）占位
 * 实际项目可改用 wx.connectSocket 接收推送，更实时
 *
 * Taro.connectSocket({
 *   url: 'wss://yourserver/ws',
 *   success: () => {},
 *   fail: () => {}
 * });
 * Taro.onSocketMessage((msg) => {
 *   const update = JSON.parse(msg.data);
 *   listeners.forEach(fn => fn([update]));
 * });
 */

/**
 * 状态变更通知文案
 */
export function getStatusNotifyText(status: OrderStatus): string | null {
  switch (status) {
    case 'pending': return '✓ 支付成功，订单已提交后厨';
    case 'cooking': return '🍳 您的订单已开始制作';
    case 'serving': return '🍽️ 菜品已出餐，请等待服务员上菜';
    case 'done': return '✓ 订单已完成，期待您再次光临';
    case 'cancelled': return '订单已取消';
    default: return null;
  }
}
