import React, { useState, useEffect, useRef } from 'react';
console.log('[ORDER] file loaded');
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, useDidHide } from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';
import { useCartStore } from '@/store/cart';
import { useUserStore } from '@/store/user';
import { payOrder } from '@/services/pay';
import {
  startOrderStatusPolling,
  stopOrderStatusPolling,
  subscribeOrderStatus,
  getStatusNotifyText
} from '@/services/orderSync';
import { OrderStatus, ORDER_STATUS_TEXT, ORDER_STATUS_COLOR } from '@/types';

const STATUS_CLASS: Record<OrderStatus, string> = {
  pending_payment: 'pendingPayment',
  pending: 'pending',
  cooking: 'cooking',
  serving: 'serving',
  done: 'done',
  cancelled: 'cancelled'
};

const OrderPage: React.FC = () => {
  const orders = useCartStore((s) => s.orders);
  const updateOrderStatus = useCartStore((s) => s.updateOrderStatus);
  const { user } = useUserStore();
  const [activeTab, setActiveTab] = useState<'all' | OrderStatus>('all');
  const [payingId, setPayingId] = useState<string | null>(null);
  const prevStatusRef = useRef<Record<string, OrderStatus>>({});

  // 监听订单状态更新（来自后厨 KDS 推送）
  useEffect(() => {
    const unsubscribe = subscribeOrderStatus((updates) => {
      updates.forEach((u) => {
        const prev = prevStatusRef.current[u.orderId];
        // 状态有变化才提示
        if (prev && prev !== u.status) {
          const text = getStatusNotifyText(u.status);
          if (text) {
            Taro.showToast({ title: text, icon: 'none', duration: 2500 });
            // 出餐完成额外震动提醒
            if (u.status === 'serving' || u.status === 'done') {
              Taro.vibrateShort({ type: 'medium' });
            }
          }
        }
        prevStatusRef.current[u.orderId] = u.status;
        updateOrderStatus(u.orderId, u.status);
      });
    });
    return unsubscribe;
  }, []);

  // 页面显示时开始轮询，隐藏时停止
  useDidShow(() => {
    startOrderStatusPolling();
  });

  useDidHide(() => {
    stopOrderStatusPolling();
  });

  // 初始化状态快照
  useEffect(() => {
    orders.forEach((o) => {
      if (!prevStatusRef.current[o.id]) {
        prevStatusRef.current[o.id] = o.status;
      }
    });
  }, [orders]);

  const filtered = activeTab === 'all' ? orders : orders.filter((o) => o.status === activeTab);

  const tabs: { key: string; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'pending_payment', label: '待支付' },
    { key: 'pending', label: '待制作' },
    { key: 'cooking', label: '制作中' },
    { key: 'done', label: '已完成' }
  ];

  // 重新支付
  const handleRepay = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !user) return;
    setPayingId(orderId);
    Taro.showLoading({ title: '支付中...', mask: true });
    const result = await payOrder({
      orderId,
      amount: order.totalPrice,
      openId: user.openId,
      method: order.payMethod === '会员卡' ? '会员卡' : '微信支付'
    });
    Taro.hideLoading();
    setPayingId(null);
    if (result.success) {
      updateOrderStatus(orderId, 'pending');
      Taro.showToast({ title: '支付成功', icon: 'success' });
    } else {
      Taro.showToast({ title: result.reason || '支付失败', icon: 'none' });
    }
  };

  // 取消未支付订单
  const handleCancel = (orderId: string) => {
    Taro.showModal({
      title: '取消订单',
      content: '确认取消该订单？取消后不可恢复',
      success: (r) => {
        if (r.confirm) {
          updateOrderStatus(orderId, 'cancelled');
          Taro.showToast({ title: '已取消', icon: 'none' });
        }
      }
    });
  };

  return (
    <View className={styles.page}>
      <View className={styles.statStrip}>
        <View className={styles.statItem}>
          <Text className={styles.num}>{orders.length}</Text>
          <Text className={styles.label}>全部订单</Text>
        </View>
        <View className={styles.statItem}>
          <Text className={styles.num}>{orders.filter((o) => o.status === 'pending_payment').length}</Text>
          <Text className={styles.label}>待支付</Text>
        </View>
        <View className={styles.statItem}>
          <Text className={styles.num}>¥{orders.filter(o=>o.status!=='cancelled' && o.status!=='pending_payment').reduce((s, o) => s + o.totalPrice, 0).toFixed(0)}</Text>
          <Text className={styles.label}>累计消费</Text>
        </View>
      </View>

      <View className={styles.tabs}>
        {tabs.map((t) => (
          <Text
            key={t.key}
            className={classnames(styles.tab, activeTab === t.key && styles.active)}
            onClick={() => setActiveTab(t.key as any)}
          >
            {t.label}
          </Text>
        ))}
      </View>

      <ScrollView scrollY className={styles.orderList} style={{ height: 'calc(100vh - 240rpx)' }}>
        {filtered.length === 0 ? (
          <View className={styles.empty}>暂无订单，去点餐看看吧～</View>
        ) : (
          filtered.map((order) => (
            <View
              key={order.id}
              className={styles.orderCard}
              onClick={() => Taro.navigateTo({ url: `/pages/orderDetail/index?orderId=${order.id}` })}
            >
              <View className={styles.orderHd}>
                <Text className={styles.orderNo}>单号：{order.id.slice(-8)}</Text>
                <Text className={classnames(styles.statusTag, styles[STATUS_CLASS[order.status]])}>
                  {ORDER_STATUS_TEXT[order.status]}
                </Text>
              </View>

              <View className={styles.orderMeta}>
                <Text>{order.tableNo}</Text>
                <Text>{order.createTime}</Text>
                <Text>{order.payMethod}</Text>
              </View>

              <View className={styles.orderItems}>
                {order.items.map((item) => (
                  <View key={item.dish.id} className={styles.orderItemRow}>
                    <Text className={styles.itemName}>{item.dish.name} ×{item.count}</Text>
                    <Text className={styles.itemPrice}>¥{item.dish.price * item.count}</Text>
                  </View>
                ))}
              </View>

              <View className={styles.orderFt}>
                <Text className={styles.payInfo}>共{order.items.reduce((s, i) => s + i.count, 0)}件 · {order.payMethod}</Text>
                <Text className={styles.totalPrice}>¥{order.totalPrice.toFixed(2)}</Text>
              </View>

              {/* 待支付订单：显示操作按钮 */}
              {order.status === 'pending_payment' && (
                <View className={styles.orderActions}>
                  <View
                    className={classnames(styles.actionBtn, styles.cancelBtn)}
                    onClick={() => handleCancel(order.id)}
                  >
                    取消订单
                  </View>
                  <View
                    className={classnames(styles.actionBtn, styles.payBtn, payingId === order.id && styles.disabled)}
                    onClick={() => payingId !== order.id && handleRepay(order.id)}
                  >
                    {payingId === order.id ? '支付中...' : '立即支付 ¥' + order.totalPrice.toFixed(2)}
                  </View>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
};

export default OrderPage;
