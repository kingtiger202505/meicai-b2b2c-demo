import React, { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';
import { useMemberStore } from '@/store/member';
import { useUserStore } from '@/store/user';
import { calcGift } from '@/services/member';
import { isBackendConfigured } from '@/services/supabase';

const PRESETS = [50, 100, 200, 300, 500, 1000];

const TopupPage: React.FC = () => {
  const { member, refresh, topup } = useMemberStore();
  const { user, loggedIn } = useUserStore();
  const [amount, setAmount] = useState(100);
  const [paying, setPaying] = useState(false);

  // 手机号直接从 user store 获取，无需手动输入
  const phone = user?.phone || member?.phone || '';

  useDidShow(() => {
    refresh();
  });

  const gift = calcGift(amount);

  const handlePay = async () => {
    if (paying || amount <= 0) return;
    if (!isBackendConfigured()) {
      Taro.showToast({ title: '后端未配置', icon: 'none' });
      return;
    }

    // 未登录，引导去登录
    if (!loggedIn || !phone) {
      Taro.showModal({
        title: '请先登录',
        content: '充值需要绑定手机号，请先在"我的"页面登录。',
        confirmText: '去登录',
        success: (r) => {
          if (r.confirm) Taro.switchTab({ url: '/pages/mine/index' });
        }
      });
      return;
    }

    setPaying(true);
    Taro.showLoading({ title: '充值到账中...', mask: true });
    try {
      const { balance, gift: g } = await topup(amount, phone);
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

      {/* 手机号显示（只读，来自登录授权） */}
      {phone ? (
        <View className={styles.phoneSection}>
          <Text className={styles.sectionTitle}>充值手机号</Text>
          <View className={styles.phoneDisplay}>
            <Text className={styles.phoneNum}>{phone}</Text>
          </View>
        </View>
      ) : (
        <View className={styles.phoneSection}>
          <Text className={styles.sectionTitle}>充值手机号</Text>
          <View className={styles.phoneDisplay}>
            <Text className={styles.phoneHint}>请先在"我的"页面登录获取手机号</Text>
          </View>
        </View>
      )}

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
        </View>
      </View>
    </View>
  );
};

export default TopupPage;
