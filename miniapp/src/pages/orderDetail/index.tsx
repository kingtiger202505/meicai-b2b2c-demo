import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useRouter, useDidShow, useDidHide } from '@tarojs/taro';
import styles from './index.module.scss';
import { useCartStore } from '@/store/cart';
import { ORDER_STATUS_TEXT, ORDER_STATUS_COLOR, OrderStatus } from '@/types';
import {
  startOrderStatusPolling,
  stopOrderStatusPolling
} from '@/services/orderSync';

// 进度节点（不含 pending_payment 和 cancelled）
const FLOW: OrderStatus[] = ['pending', 'cooking', 'serving', 'done'];

const OrderDetailPage: React.FC = () => {
  const router = useRouter();
  const orderId = router.params.orderId || '';
  const getOrder = useCartStore((s) => s.getOrder);
  const [order, setOrder] = useState(getOrder(orderId));

  useDidShow(() => {
    // 进入详情页时开启轮询，确保进度实时更新
    startOrderStatusPolling(5000);
    setOrder(getOrder(orderId));
  });

  useDidHide(() => {
    stopOrderStatusPolling();
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setOrder(getOrder(orderId));
    }, 2000);
    return () => clearInterval(timer);
  }, [orderId]);

  if (!order) {
    return (
      <View className={styles.page}>
        <View className={styles.empty}>订单不存在</View>
      </View>
    );
  }

  const currentIdx = FLOW.indexOf(order.status);

  return (
    <View className={styles.page}>
      <ScrollView scrollY style={{ height: '100vh' }}>
        {/* 状态头部 */}
        <View className={styles.statusHero} style={{ background: ORDER_STATUS_COLOR[order.status] }}>
          <Text className={styles.statusText}>{ORDER_STATUS_TEXT[order.status]}</Text>
          <Text className={styles.statusHint}>
            {order.status === 'pending_payment' && '请尽快完成支付'}
            {order.status === 'pending' && '后厨已接单，请耐心等待'}
            {order.status === 'cooking' && '大厨正在为您精心烹饪'}
            {order.status === 'serving' && '菜品已出餐，服务员即将送达'}
            {order.status === 'done' && '感谢您的光临，期待下次再见'}
            {order.status === 'cancelled' && '订单已取消'}
          </Text>
        </View>

        {/* 进度时间线 */}
        {order.status !== 'pending_payment' && order.status !== 'cancelled' && (
          <View className={styles.flowCard}>
            {FLOW.map((s, idx) => {
              const reached = currentIdx >= idx;
              const current = currentIdx === idx;
              return (
                <View key={s} className={styles.flowItem}>
                  <View className={styles.flowLeft}>
                    <View
                      className={styles.flowDot}
                      style={{
                        background: reached ? ORDER_STATUS_COLOR[s] : '#ddd',
                        transform: current ? 'scale(1.2)' : 'scale(1)',
                        boxShadow: current ? `0 0 0 8rpx ${ORDER_STATUS_COLOR[s]}33` : 'none'
                      }}
                    />
                    {idx < FLOW.length - 1 && (
                      <View className={styles.flowLine} style={{ background: reached ? ORDER_STATUS_COLOR[s] : '#ddd' }} />
                    )}
                  </View>
                  <View className={styles.flowRight}>
                    <Text className={styles.flowStatus} style={{ color: reached ? '#333' : '#999' }}>
                      {ORDER_STATUS_TEXT[s]}
                    </Text>
                    {reached && (
                      <Text className={styles.flowTime}>
                        {idx === currentIdx ? '进行中...' : '已完成'}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* 订单信息 */}
        <View className={styles.infoCard}>
          <View className={styles.infoRow}>
            <Text className={styles.infoLabel}>订单号</Text>
            <Text className={styles.infoValue}>{order.id}</Text>
          </View>
          <View className={styles.infoRow}>
            <Text className={styles.infoLabel}>桌号</Text>
            <Text className={styles.infoValue}>{order.tableNo}</Text>
          </View>
          <View className={styles.infoRow}>
            <Text className={styles.infoLabel}>下单时间</Text>
            <Text className={styles.infoValue}>{order.createTime}</Text>
          </View>
          <View className={styles.infoRow}>
            <Text className={styles.infoLabel}>支付方式</Text>
            <Text className={styles.infoValue}>{order.payMethod}</Text>
          </View>
        </View>

        {/* 菜品明细 */}
        <View className={styles.dishesCard}>
          <View className={styles.cardTitle}>菜品明细</View>
          {order.items.map((item) => (
            <View key={item.dish.id} className={styles.dishRow}>
              <View className={styles.dishInfo}>
                <Text className={styles.dishName}>{item.dish.name}</Text>
                <Text className={styles.dishPrice}>¥{item.dish.price} × {item.count}</Text>
              </View>
              <Text className={styles.dishTotal}>¥{(item.dish.price * item.count).toFixed(2)}</Text>
            </View>
          ))}
          <View className={styles.totalRow}>
            <Text>合计</Text>
            <Text className={styles.totalAmount}>¥{order.totalPrice.toFixed(2)}</Text>
          </View>
        </View>

        {/* 待支付时的操作 */}
        {order.status === 'pending_payment' && (
          <View className={styles.actionBar}>
            <View
              className={styles.cancelAction}
              onClick={() => {
                useCartStore.getState().updateOrderStatus(orderId, 'cancelled');
                Taro.showToast({ title: '订单已取消', icon: 'none' });
                setTimeout(() => Taro.navigateBack(), 800);
              }}
            >
              取消订单
            </View>
            <View className={styles.payAction}>
              去支付 ¥{order.totalPrice.toFixed(2)}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

export default OrderDetailPage;
