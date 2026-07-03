import React, { useState } from 'react';
import { View, Text, Button } from '@tarojs/components';
import Taro, { useRouter, useDidShow } from '@tarojs/taro';
import styles from './index.module.scss';
import { useMemberStore } from '@/store/member';
import { useUserStore } from '@/store/user';
import { calcGift } from '@/services/member';

// 支付成功页：私域转化钩子
//  1) 成为会员（无感建/补手机号）
//  2) 关注公众号领券（关注引导 + 领券入口，沿用后端既有券能力 —— PRD Q3）
//  3) 充 100 送 20，本单立减（立减封顶订单额 —— PRD Q2；到账走 mock 充值闭环）
const TOPUP_AMOUNT = 100;

const PaySuccessPage: React.FC = () => {
  const router = useRouter();
  const amount = Number(router.params.amount || 0);
  const method = router.params.method || '微信支付';

  const { member, refresh, ensure, topup } = useMemberStore();
  const { user } = useUserStore();
  const [joining, setJoining] = useState(false);
  const [topping, setTopping] = useState(false);
  const [followed, setFollowed] = useState(false);

  useDidShow(() => { refresh(); });

  const isMember = !!member?.id;
  const hasPhone = !!member?.phone;
  const gift = calcGift(TOPUP_AMOUNT);                 // 100 → 20
  const instantCut = Math.min(gift, amount);           // 本单立减封顶订单额

  // 成为会员（H5：无 getPhoneNumber，直接建会员；weapp：走手机号授权补全）
  const handleJoin = async (phone?: string | null) => {
    if (joining) return;
    setJoining(true);
    Taro.showLoading({ title: '开通中...', mask: true });
    try {
      await ensure(phone ?? user?.phone ?? null);
      Taro.hideLoading();
      Taro.showToast({ title: '已成为会员', icon: 'success' });
    } catch (e: any) {
      Taro.hideLoading();
      Taro.showToast({ title: e?.message || '开通失败', icon: 'none' });
    } finally {
      setJoining(false);
    }
  };

  const handleGetPhone = (e: any) => {
    if (e?.detail?.errMsg !== 'getPhoneNumber:ok') {
      Taro.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }
    // demo：真机需后端用 code 解密手机号，这里用尾号占位
    const code: string = e.detail.code || '';
    handleJoin('138****' + code.slice(-4));
  };

  const handleFollow = () => {
    setFollowed(true);
    Taro.showModal({
      title: '关注领券',
      content: '在微信搜索并关注「川小灶·望京店」公众号，关注后自动发放新客优惠券，可在「我的-优惠券」查看使用。',
      showCancel: false,
      confirmText: '知道了',
    });
  };

  const handleTopup = async () => {
    if (topping) return;
    setTopping(true);
    Taro.showLoading({ title: '充值到账中...', mask: true });
    try {
      const { balance, gift: g } = await topup(TOPUP_AMOUNT, user?.phone ?? null);
      Taro.hideLoading();
      Taro.showToast({ title: `到账 ¥${(TOPUP_AMOUNT + g).toFixed(0)}`, icon: 'success' });
      Taro.showModal({
        title: '充值成功',
        content: `已充 ¥${TOPUP_AMOUNT} 送 ¥${g}，本单立减 ¥${instantCut}；储值余额 ¥${balance.toFixed(2)}，下单可直接余额支付。`,
        showCancel: false,
        confirmText: '好的',
      });
    } catch (e: any) {
      Taro.hideLoading();
      Taro.showToast({ title: e?.message || '充值失败', icon: 'none' });
    } finally {
      setTopping(false);
    }
  };

  const goOrders = () => Taro.switchTab({ url: '/pages/order/index' });
  const goMenu = () => Taro.switchTab({ url: '/pages/menu/index' });
  const goTopup = () => Taro.navigateTo({ url: '/pages/topup/index' });

  return (
    <View className={styles.page}>
      {/* 支付成功头 */}
      <View className={styles.hero}>
        <View className={styles.check}>✓</View>
        <Text className={styles.heroText}>支付成功 · {method}</Text>
        {amount > 0 && <View className={styles.heroAmount}>¥{amount.toFixed(2)}</View>}
      </View>

      {/* 1. 成为会员 */}
      <View className={styles.card}>
        <View className={styles.cardHd}>
          <Text className={styles.cardIcon}>💳</Text>
          <Text className={styles.cardTitle}>{isMember ? '会员权益' : '成为会员'}</Text>
          <Text className={styles.cardTag}>私域会员</Text>
        </View>
        {isMember ? (
          <>
            <View className={styles.memberDone}>
              <Text className={styles.balanceNum}>¥{(member?.balance ?? 0).toFixed(2)}</Text>
              <Text className={styles.balanceUnit}>储值余额</Text>
            </View>
            <Text className={styles.cardDesc}>
              {hasPhone ? '会员资料已完善，消费积累、储值余额尽在「我的」。' : '已开通会员，绑定手机号可用于订单通知与找回账号。'}
            </Text>
          </>
        ) : (
          <Text className={styles.cardDesc}>
            开通会员，消费自动累计、储值余额随时可用，顾客与数据 100% 归门店。
          </Text>
        )}
        {!isMember && (
          process.env.TARO_ENV === 'weapp' ? (
            <Button className={styles.btn} openType="getPhoneNumber" onGetPhoneNumber={handleGetPhone}>
              一键成为会员
            </Button>
          ) : (
            <View className={styles.btn} onClick={() => handleJoin()}>立即成为会员</View>
          )
        )}
      </View>

      {/* 2. 关注公众号领券 */}
      <View className={styles.card}>
        <View className={styles.cardHd}>
          <Text className={styles.cardIcon}>🎁</Text>
          <Text className={styles.cardTitle}>关注领券</Text>
          <Text className={styles.cardTag}>新客券</Text>
        </View>
        <View className={styles.qr} />
        <Text className={styles.qrHint}>长按/扫码关注「川小灶·望京店」公众号</Text>
        <View style={{ height: '24rpx' }} />
        <View
          className={followed ? `${styles.btn} ${styles.btnGhost}` : styles.btn}
          onClick={handleFollow}
        >
          {followed ? '关注后自动发券' : '关注领券'}
        </View>
      </View>

      {/* 3. 充 100 送 20，本单立减 */}
      <View className={styles.card}>
        <View className={styles.cardHd}>
          <Text className={styles.cardIcon}>⚡</Text>
          <Text className={styles.cardTitle}>充 {TOPUP_AMOUNT} 送 {gift}</Text>
          <Text className={styles.cardTag}>本单立减 ¥{instantCut}</Text>
        </View>
        <View className={styles.topupRow}>
          <Text className={styles.topupPay}>¥{TOPUP_AMOUNT}</Text>
          <Text className={styles.topupGet}>到账 ¥{TOPUP_AMOUNT + gift}</Text>
        </View>
        <Text className={styles.cardDesc}>
          充值 <Text className={styles.highlight}>¥{TOPUP_AMOUNT}</Text> 立得 <Text className={styles.highlight}>¥{TOPUP_AMOUNT + gift}</Text> 储值，本单立减 <Text className={styles.highlight}>¥{instantCut}</Text>，余额下单可直接抵扣。
        </Text>
        <View
          className={topping ? `${styles.btn} ${styles.btnDisabled}` : styles.btn}
          onClick={handleTopup}
        >
          {topping ? '充值中...' : `立即充值 ¥${TOPUP_AMOUNT}`}
        </View>
        <View style={{ height: '16rpx' }} />
        <Text className={styles.qrHint} onClick={goTopup}>选择其它金额 ›</Text>
      </View>

      {/* 底部 */}
      <View className={styles.footer}>
        <View className={`${styles.btn} ${styles.btnGhost}`} onClick={goMenu}>再点一单</View>
        <View className={styles.btn} onClick={goOrders}>查看订单</View>
      </View>
    </View>
  );
};

export default PaySuccessPage;
