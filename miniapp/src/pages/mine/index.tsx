import React, { useState } from 'react';
console.log('[MINE] file loaded');
import { View, Text, Image, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import styles from './index.module.scss';
import { useCartStore } from '@/store/cart';
import { useUserStore } from '@/store/user';
import { useMemberStore } from '@/store/member';
import { isBackendConfigured } from '@/services/supabase';
import { listMyCoupons } from '@/services/coupon';

const LEVEL_TEXT = {
  normal: '普通会员',
  silver: '银卡会员',
  gold: '金卡会员',
  diamond: '钻石会员'
};

const MinePage: React.FC = () => {
  const orders = useCartStore((s) => s.orders);
  const { user, loggedIn, loginWithPhone, logout } = useUserStore();
  const { member, refresh: refreshMember, ensure: ensureMember } = useMemberStore();
  const [couponCount, setCouponCount] = useState(0);

  useDidShow(() => {
    if (isBackendConfigured()) {
      refreshMember();
      listMyCoupons('unused').then((list) => {
        setCouponCount(list.length);
      });
    }
  });

  const balance = member?.balance ?? user?.balance ?? 0;
  const goTopup = () => Taro.navigateTo({ url: '/pages/topup/index' });

  // 一键手机号授权登录
  const handlePhoneLogin = async (e) => {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      Taro.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }
    Taro.showLoading({ title: '登录中...' });
    const ok = await loginWithPhone(e.detail.code);
    Taro.hideLoading();
    if (ok) {
      const u = useUserStore.getState().user;
      if (u?.phone) {
        Taro.showToast({ title: '登录成功', icon: 'success' });
        // 同步创建会员
        if (isBackendConfigured()) {
          ensureMember(u.phone);
        }
      } else {
        Taro.showToast({ title: '登录成功，手机号获取失败', icon: 'none' });
      }
    } else {
      Taro.showToast({ title: '登录失败，请重试', icon: 'none' });
    }
  };

  const menuList = [
    { icon: '🎁', text: '我的优惠券', count: loggedIn ? `${couponCount}张` : '', action: 'coupon' },
    { icon: '⭐', text: '我的收藏', count: '5个', action: 'fav' },
    { icon: '📍', text: '收货地址', count: '2个', action: 'addr' },
    { icon: '💬', text: '意见反馈', count: '', action: 'feedback' },
    { icon: '📞', text: '联系商家', count: '', action: 'contact' },
    { icon: '⚙️', text: '设置', count: '', action: 'settings' }
  ];

  const onMenuTap = (action: string) => {
    if (!loggedIn) {
      Taro.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (action === 'coupon') {
      Taro.navigateTo({ url: '/pages/coupon/index' });
      return;
    }
    Taro.showToast({ title: '功能开发中', icon: 'none' });
  };

  return (
    <View className={styles.page}>
      {/* 用户头部 */}
      <View className={styles.profile}>
        {loggedIn && user?.avatarUrl ? (
          <Image className={styles.avatar} src={user.avatarUrl} mode="aspectFill" />
        ) : (
          <View className={styles.avatar}>{loggedIn && user ? user.nickName.slice(0, 1) : '👤'}</View>
        )}
        <View className={styles.profileInfo}>
          {loggedIn && user ? (
            <>
              <Text className={styles.nickName}>{user.nickName}</Text>
              <Text className={styles.phone}>
                {user.phone || '手机号未获取'}
                {user.phone && <Text className={styles.levelTag}>{LEVEL_TEXT[user.memberLevel]}</Text>}
              </Text>
            </>
          ) : (
            <>
              <Text className={styles.nickName}>点击登录</Text>
              <Text className={styles.phone}>登录后享受会员权益</Text>
            </>
          )}
        </View>
        {!loggedIn && (
          <Button
            className={styles.loginBtn}
            size="mini"
            openType="getPhoneNumber"
            onGetPhoneNumber={handlePhoneLogin}
          >
            手机号快捷登录
          </Button>
        )}
      </View>

      {/* 数据条 */}
      <View className={styles.dataRow}>
        <View className={styles.dataItem}>
          <Text className={styles.num}>{orders.length}</Text>
          <Text className={styles.label}>订单</Text>
        </View>
        <View className={styles.dataItem}>
          <Text className={styles.num}>{user?.points ?? 0}</Text>
          <Text className={styles.label}>积分</Text>
        </View>
        <View className={styles.dataItem} onClick={goTopup}>
          <Text className={styles.num}>¥{balance.toFixed(2)}</Text>
          <Text className={styles.label}>储值余额 ›</Text>
        </View>
      </View>

      {/* 储值充值入口 */}
      <View className={styles.rechargeCard} onClick={goTopup}>
        <View>
          <Text className={styles.rechargeTitle}>储值充值 · 充100送20</Text>
          <Text className={styles.rechargeDesc}>余额下单直接抵扣，多充多送</Text>
        </View>
        <Text className={styles.rechargeBtn}>去充值 ›</Text>
      </View>

      {/* 菜单组 */}
      <View className={styles.menuGroup}>
        {menuList.map((item) => (
          <View
            key={item.text}
            className={styles.menuItem}
            onClick={() => onMenuTap(item.action)}
          >
            <Text className={styles.menuIcon}>{item.icon}</Text>
            <Text className={styles.menuText}>{item.text}</Text>
            {item.count && <Text className={styles.arrow}>{item.count}  ›</Text>}
            {!item.count && <Text className={styles.arrow}>›</Text>}
          </View>
        ))}
      </View>

      {/* 退出登录 */}
      {loggedIn && (
        <View className={styles.logoutBtn} onClick={() => {
          Taro.showModal({
            title: '退出登录',
            content: '确认退出当前账号？',
            success: (r) => { if (r.confirm) logout(); }
          });
        }}>
          退出登录
        </View>
      )}
    </View>
  );
};

export default MinePage;
