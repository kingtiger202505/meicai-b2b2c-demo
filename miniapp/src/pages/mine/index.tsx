import React from 'react';
import { View, Text, Image, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import styles from './index.module.scss';
import { useCartStore } from '@/store/cart';
import { useUserStore } from '@/store/user';
import { useMemberStore } from '@/store/member';
import { isBackendConfigured } from '@/services/supabase';

const LEVEL_TEXT = {
  normal: '普通会员',
  silver: '银卡会员',
  gold: '金卡会员',
  diamond: '钻石会员'
};

const MinePage: React.FC = () => {
  const orders = useCartStore((s) => s.orders);
  const { user, loggedIn, login, bindPhone, logout } = useUserStore();
  const { member, refresh: refreshMember } = useMemberStore();

  // 每次进入「我的」拉最新会员/余额（后端权威）
  useDidShow(() => { if (isBackendConfigured()) refreshMember(); });

  const balance = member?.balance ?? user?.balance ?? 0;
  const goTopup = () => Taro.navigateTo({ url: '/pages/topup/index' });

  // 微信登录
  const handleLogin = async () => {
    Taro.showLoading({ title: '登录中...' });
    const ok = await login();
    Taro.hideLoading();
    if (ok) {
      Taro.showToast({ title: '登录成功', icon: 'success' });
    } else {
      Taro.showToast({ title: '登录失败，请重试', icon: 'none' });
    }
  };

  // 绑定手机号（Button open-type=getPhoneNumber 回调）
  const handleGetPhone = async (e) => {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      Taro.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }
    Taro.showLoading({ title: '绑定中...' });
    const ok = await bindPhone(e.detail.code);
    Taro.hideLoading();
    if (ok) Taro.showToast({ title: '手机号已绑定', icon: 'success' });
    else Taro.showToast({ title: '绑定失败', icon: 'none' });
  };

  const menuList = [
    { icon: '🎁', text: '我的优惠券', count: '3张', action: 'coupon' },
    { icon: '⭐', text: '我的收藏', count: '5个', action: 'fav' },
    { icon: '📍', text: '收货地址', count: '2个', action: 'addr' },
    { icon: '💬', text: '意见反馈', count: '', action: 'feedback' },
    { icon: '📞', text: '联系商家', count: '', action: 'contact' },
    { icon: '⚙️', text: '设置', count: '', action: 'settings' }
  ];

  const onMenuTap = (action: string) => {
    if (!loggedIn) {
      Taro.showModal({
        title: '请先登录',
        content: '登录后才能使用该功能',
        confirmText: '去登录',
        success: (r) => { if (r.confirm) handleLogin(); }
      });
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
                {user.phone || '未绑定手机号'}
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
            onClick={handleLogin}
          >
            微信登录
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

      {/* 绑定手机号（未绑定时显示） */}
      {loggedIn && user && !user.phone && (
        <View className={styles.bindPhoneCard}>
          <View>
            <Text className={styles.bindTitle}>绑定手机号</Text>
            <Text className={styles.bindDesc}>用于接收订单通知、找回账号</Text>
          </View>
          <Button
            className={styles.bindBtn}
            size="mini"
            openType="getPhoneNumber"
            onGetPhoneNumber={handleGetPhone}
          >
            一键绑定
          </Button>
        </View>
      )}

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
