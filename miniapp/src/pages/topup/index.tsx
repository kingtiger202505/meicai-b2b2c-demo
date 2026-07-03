import React, { useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';
import { useMemberStore } from '@/store/member';
import { useUserStore } from '@/store/user';
import { calcGift } from '@/services/member';
import { isBackendConfigured } from '@/services/supabase';

// 储值充值：mock 支付先走通闭环（复用 mock_topup_member，等 WX-6/WX-11 切真微信支付）。
// 赠送规则：每满 100 送 20，累进（PRD Q1）。
const PRESETS = [50, 100, 200, 300, 500, 1000];

const TopupPage: React.FC = () => {
  const { member, refresh, topup } = useMemberStore();
  const { user } = useUserStore();
  const [amount, setAmount] = useState(100);
  const [paying, setPaying] = useState(false);

  useDidShow(() => { refresh(); });

  const gift = calcGift(amount);

  const handlePay = async () => {
    if (paying || amount <= 0) return;
    if (!isBackendConfigured()) {
      Taro.showToast({ title: '后端未配置', icon: 'none' });
      return;
    }
    setPaying(true);
    Taro.showLoading({ title: '充值到账中...', mask: true });
    try {
      const { balance, gift: g } = await topup(amount, user?.phone ?? null);
      Taro.hideLoading();
      Taro.showModal({
        title: '充值成功',
        content: `已充 ¥${amount} 送 ¥${g}，储值余额 ¥${balance.toFixed(2)}。下单时可选「余额支付」直接抵扣。`,
        showCancel: false,
        confirmText: '好的',
        success: () => Taro.navigateBack(),
      });
    } catch (e: any) {
      Taro.hideLoading();
      Taro.showToast({ title: e?.message || '充值失败', icon: 'none' });
    } finally {
      setPaying(false);
    }
  };

  return (
    <View className={styles.page}>
      {/* 当前余额 */}
      <View className={styles.balanceCard}>
        <Text className={styles.balanceLabel}>当前储值余额</Text>
        <View className={styles.balanceNum}>¥{(member?.balance ?? 0).toFixed(2)}</View>
      </View>

      {/* 充值金额 */}
      <View className={styles.section}>
        <Text className={styles.sectionTitle}>选择充值金额</Text>
        <View className={styles.grid}>
          {PRESETS.map((v) => (
            <View
              key={v}
              className={classnames(styles.amountItem, amount === v && styles.active)}
              onClick={() => setAmount(v)}
            >
              <Text className={styles.amountValue}>¥{v}</Text>
              <Text className={styles.amountGift}>{calcGift(v) > 0 ? `送¥${calcGift(v)}` : '无赠送'}</Text>
            </View>
          ))}
        </View>
        <Text className={styles.rule}>
          充值规则：每满 ¥100 送 ¥20（累进，多充多送）。储值余额可在下单时直接抵扣，顾客与数据 100% 归门店。
        </Text>
      </View>

      {/* 底部支付栏 */}
      <View className={styles.payBar}>
        <View className={styles.paySummary}>
          <Text className={styles.payMain}>¥{amount.toFixed(0)}</Text>
          {gift > 0 && <Text className={styles.paySub}>到账 ¥{amount + gift}（送¥{gift}）</Text>}
        </View>
        <View
          className={classnames(styles.payBtn, paying && styles.disabled)}
          onClick={handlePay}
        >
          {paying ? '充值中...' : '立即充值'}
          <Text className={styles.mockTag}>mock</Text>
        </View>
      </View>
    </View>
  );
};

export default TopupPage;
