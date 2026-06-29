import React, { useState, useMemo } from 'react';
import { View, Text, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';
import { categories, dishes } from '@/data/dish';
import { useCartStore } from '@/store/cart';
import { useUserStore } from '@/store/user';
import { payOrder } from '@/services/pay';
import Stepper from '@/components/Stepper';

const MenuPage: React.FC = () => {
  const [activeCat, setActiveCat] = useState('hot');
  const [showCart, setShowCart] = useState(false);

  const { items, add, minus, getCount, getTotalCount, getTotalPrice, clear, orderType, setOrderType, placeOrder, tableNo, setTableNo, updateOrderStatus } = useCartStore();
  const { user, loggedIn } = useUserStore();

  const groupedDishes = useMemo(() => {
    return categories.map((cat) => ({
      ...cat,
      list: dishes.filter((d) => d.categoryId === cat.id)
    }));
  }, []);

  const totalCount = getTotalCount();
  const totalPrice = getTotalPrice();

  // 扫码绑定桌号
  const handleScanTable = () => {
    Taro.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        // 兼容多种二维码内容：
        // 1. 直接是数字 "5"
        // 2. URL 带 query: https://xxx?tableNo=5
        // 3. scene 字符串: table=5
        const raw = res.result || '';
        let table = '';
        // 从 URL query 提取
        const m = raw.match(/[?&]table(?:No)?=([^&#]+)/i);
        if (m) {
          table = m[1];
        } else if (/^\d+$/.test(raw)) {
          // 纯数字
          table = raw;
        } else {
          // scene 风格
          const m2 = raw.match(/table(?:No)?=([^&]+)/i);
          if (m2) table = m2[1];
        }
        if (table) {
          const display = /^\d+$/.test(table) ? `${table}号桌` : table;
          setTableNo(display);
          Taro.showToast({ title: `已绑定 ${display}`, icon: 'success' });
        } else {
          Taro.showToast({ title: '未识别到桌号', icon: 'none' });
        }
      },
      fail: () => {
        Taro.showToast({ title: '已取消扫码', icon: 'none' });
      }
    });
  };

  const handleSubmit = async () => {
    if (totalCount === 0) return;
    // 堂食必须先绑桌号
    if (orderType === 'dineIn' && !tableNo) {
      Taro.showModal({
        title: '请先绑定桌号',
        content: '堂食下单前请扫描桌角的二维码绑定桌号',
        confirmText: '去扫码',
        success: (r) => { if (r.confirm) handleScanTable(); }
      });
      return;
    }
    // 必须先登录
    if (!loggedIn || !user) {
      Taro.showModal({
        title: '请先登录',
        content: '下单前请先登录',
        confirmText: '去登录',
        success: (r) => {
          if (r.confirm) Taro.switchTab({ url: '/pages/mine/index' });
        }
      });
      return;
    }

    // 选择支付方式
    let payMethod: '微信支付' | '会员卡' = '微信支付';
    try {
      const res = await Taro.showActionSheet({
        itemList: ['💚 微信支付', '💳 会员卡储值（余额 ¥' + user.balance.toFixed(2) + '）']
      });
      payMethod = res.tapIndex === 1 ? '会员卡' : '微信支付';
    } catch (e) {
      // 用户取消选择
      return;
    }

    // 创建订单（状态为待支付）
    const orderId = placeOrder(payMethod);
    const order = useCartStore.getState().getOrder(orderId);
    if (!order) return;

    Taro.showLoading({ title: '支付中...', mask: true });
    const result = await payOrder({
      orderId,
      amount: order.totalPrice,
      openId: user.openId,
      method: payMethod
    });
    Taro.hideLoading();

    if (result.success) {
      // 支付成功 → 更新订单状态为待制作
      updateOrderStatus(orderId, 'pending');
      Taro.showToast({ title: '下单成功', icon: 'success' });
      setTimeout(() => {
        Taro.switchTab({ url: '/pages/order/index' });
      }, 1000);
    } else {
      // 支付失败/取消 → 订单留在待支付状态，用户可去订单页重试
      Taro.showModal({
        title: '支付未完成',
        content: result.reason || '支付失败，订单已保留在待支付状态',
        confirmText: '去订单',
        cancelText: '取消',
        success: (r) => {
          if (r.confirm) Taro.switchTab({ url: '/pages/order/index' });
        }
      });
    }
  };

  const onCatTap = (catId: string) => {
    setActiveCat(catId);
  };

  return (
    <View className={styles.page}>
      {/* 餐厅信息 */}
      <View className={styles.restBar}>
        <View className={styles.restLogo}>湘</View>
        <View className={styles.restInfo}>
          <Text className={styles.restName}>湘味楼</Text>
          <Text className={styles.restDesc}>营业中 · 人均 ¥67 · 月售 3200+ 单</Text>
        </View>
        <View className={styles.typeSwitch}>
          <Text
            className={classnames(styles.typeBtn, orderType === 'dineIn' && styles.active)}
            onClick={() => setOrderType('dineIn')}
          >
            堂食
          </Text>
          <Text
            className={classnames(styles.typeBtn, orderType === 'takeout' && styles.active)}
            onClick={() => setOrderType('takeout')}
          >
            外卖
          </Text>
        </View>
      </View>

      {/* 桌号横幅（堂食显示） */}
      {orderType === 'dineIn' && (
        <View
          className={classnames(styles.tableBar, !tableNo && styles.tableBarWarn)}
          onClick={handleScanTable}
        >
          {tableNo ? (
            <>
              <Text className={styles.tableIcon}>📍</Text>
              <Text className={styles.tableText}>当前桌号：<Text className={styles.tableNo}>{tableNo}</Text></Text>
              <Text className={styles.tableAction}>换桌 ›</Text>
            </>
          ) : (
            <>
              <Text className={styles.tableIcon}>📷</Text>
              <Text className={styles.tableText}>未绑定桌号，请扫描桌角二维码</Text>
              <Text className={styles.tableAction}>去扫码 ›</Text>
            </>
          )}
        </View>
      )}

      {/* 主体 */}
      <View className={styles.content}>
        {/* 左侧分类 */}
        <ScrollView scrollY className={styles.catSide}>
          {categories.map((cat) => (
            <View
              key={cat.id}
              className={classnames(styles.catItem, activeCat === cat.id && styles.active)}
              onClick={() => onCatTap(cat.id)}
            >
              {cat.name}
            </View>
          ))}
        </ScrollView>

        {/* 右侧菜品 */}
        <ScrollView scrollY className={styles.dishList}>
          {groupedDishes.map((group) => (
            <View key={group.id} className={styles.dishGroup}>
              <Text className={styles.groupTitle}>{group.name}</Text>
              {group.list.map((dish) => (
                <View key={dish.id} className={styles.dishCard}>
                  <Image className={styles.dishImg} src={dish.img} mode="aspectFill" />
                  <View className={styles.dishBody}>
                    <View>
                      <Text className={styles.dishName}>{dish.name}</Text>
                      <Text className={styles.dishDesc}>{dish.desc}</Text>
                      {dish.tags.length > 0 && (
                        <View className={styles.tagRow}>
                          {dish.tags.map((t) => (
                            <Text key={t} className={styles.tag}>{t}</Text>
                          ))}
                        </View>
                      )}
                    </View>
                    <View className={styles.dishFt}>
                      <View>
                        <Text className={styles.price}>¥{dish.price}</Text>
                        <Text className={styles.sales}>  · 月售{dish.sales}</Text>
                      </View>
                      <Stepper
                        count={getCount(dish.id)}
                        onAdd={() => add(dish)}
                        onMinus={() => minus(dish.id)}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ))}
          <View style={{ height: '180rpx' }} />
        </ScrollView>
      </View>

      {/* 购物车详情弹层 */}
      {showCart && totalCount > 0 && (
        <>
          <View className={styles.mask} onClick={() => setShowCart(false)} />
          <View className={styles.cartPanel}>
            <View className={styles.cartPanelHd}>
              <Text className={styles.cartPanelTitle}>已选商品 ({totalCount})</Text>
              <Text className={styles.clearBtn} onClick={() => clear()}>清空</Text>
            </View>
            <ScrollView scrollY className={styles.cartPanelBd}>
              {items.map((item) => (
                <View key={item.dish.id} className={styles.cartRow}>
                  <Text className={styles.cartRowName}>{item.dish.name}</Text>
                  <Stepper
                    count={item.count}
                    onAdd={() => add(item.dish)}
                    onMinus={() => minus(item.dish.id)}
                  />
                  <Text className={styles.cartRowPrice}>¥{item.dish.price * item.count}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      )}

      {/* 底部购物车栏 */}
      <View className={styles.cartBar}>
        <View className={styles.cartIcon} onClick={() => totalCount > 0 && setShowCart(!showCart)}>
          🛒
          {totalCount > 0 && <Text className={styles.cartBadge}>{totalCount}</Text>}
        </View>
        <View className={styles.cartInfo} onClick={() => totalCount > 0 && setShowCart(!showCart)}>
          <Text className={styles.cartPrice}>¥{totalPrice.toFixed(2)}</Text>
          {totalCount === 0 && <Text className={styles.cartHint}>购物车是空的</Text>}
        </View>
        <View
          className={classnames(styles.submitBtn, totalCount === 0 && styles.disabled)}
          onClick={handleSubmit}
        >
          {totalCount === 0 ? '未选购' : '去结算'}
        </View>
      </View>
    </View>
  );
};

export default MenuPage;
