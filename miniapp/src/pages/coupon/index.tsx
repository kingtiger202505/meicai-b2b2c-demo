import React, { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';
import { listMyCoupons, couponLabel, isCouponUsable, type Coupon, type CouponStatus } from '@/services/coupon';
import { isBackendConfigured } from '@/services/supabase';

const TABS: { key: CouponStatus | 'all'; label: string }[] = [
  { key: 'unused', label: '可用' },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' },
  { key: 'all', label: '全部' },
];

const CouponPage: React.FC = () => {
  const [tab, setTab] = useState<CouponStatus | 'all'>('unused');
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (status: CouponStatus | 'all') => {
    if (!isBackendConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const filter = status === 'all' ? undefined : status;
      // 过期券后端可能还是 unused,前端再判一次
      const list = await listMyCoupons(filter);
      let filtered = list;
      if (status === 'unused') {
        filtered = list.filter(isCouponUsable);
      } else if (status === 'expired') {
        filtered = list.filter((c) => c.status === 'expired' || (c.status === 'unused' && c.expire_at && new Date(c.expire_at).getTime() < Date.now()));
      }
      setCoupons(filtered);
    } catch (e) {
      console.warn('加载券失败', e);
    } finally {
      setLoading(false);
    }
  };

  useDidShow(() => { load(tab); });
  useEffect(() => { load(tab); }, [tab]);

  const handleTabChange = (k: CouponStatus | 'all') => {
    setTab(k);
  };

  return (
    <View className={styles.page}>
      <View className={styles.tabs}>
        {TABS.map((t) => (
          <Text
            key={t.key}
            className={classnames(styles.tab, tab === t.key && styles.tabActive)}
            onClick={() => handleTabChange(t.key)}
          >
            {t.label}
          </Text>
        ))}
      </View>

      {loading ? (
        <View className={styles.empty}>加载中...</View>
      ) : coupons.length === 0 ? (
        <View className={styles.empty}>
          <Text className={styles.emptyIcon}>🎫</Text>
          <Text className={styles.emptyText}>暂无优惠券</Text>
          <Text className={styles.emptyHint}>下单支付后自动发放,敬请期待</Text>
        </View>
      ) : (
        <View className={styles.list}>
          {coupons.map((c) => {
            const usable = isCouponUsable(c);
            const expired = c.status === 'expired' || (c.status === 'unused' && c.expire_at && new Date(c.expire_at).getTime() < Date.now());
            return (
              <View
                key={c.id}
                className={classnames(styles.card, !usable && styles.cardDisabled)}
              >
                <View className={styles.cardLeft}>
                  <Text className={styles.value}>¥{c.value}</Text>
                  <Text className={styles.threshold}>
                    {c.kind === 'cash' ? '代金券' : `满 ${c.threshold} 可用`}
                  </Text>
                </View>
                <View className={styles.cardRight}>
                  <Text className={styles.title}>{couponLabel(c)}</Text>
                  <Text className={styles.expire}>
                    {c.expire_at
                      ? `有效期至 ${new Date(c.expire_at).toLocaleDateString('zh-CN')}`
                      : '永久有效'}
                  </Text>
                  {c.status === 'used' && <Text className={styles.badge}>已使用</Text>}
                  {expired && c.status !== 'used' && <Text className={styles.badge}>已过期</Text>}
                  {usable && <Text className={styles.badgeOk}>可用</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

export default CouponPage;
