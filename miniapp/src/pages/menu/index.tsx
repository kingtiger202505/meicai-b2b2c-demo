import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import classnames from 'classnames';
import styles from './index.module.scss';
import { Category, Dish } from '@/types';
import { useCartStore } from '@/store/cart';
import { useUserStore } from '@/store/user';
import { fetchCategories, fetchDishes, resolvePoint } from '@/services/catalog';
import { placeOrder as placeOrderApi, mockPay, PlaceOrderResult } from '@/services/order';
import { payWithBalance } from '@/services/member';
import { ensureDevOpenId } from '@/services/identity';
import { isBackendConfigured } from '@/services/supabase';
import { useMemberStore } from '@/store/member';
import Stepper from '@/components/Stepper';

// 后端错误 → 用户可读文案
function mapOrderError(raw: string): string {
  if (!raw) return '下单失败，请重试';
  if (raw.indexOf('item_unavailable') >= 0) {
    const name = raw.split(':')[1] || '';
    return `「${name}」已沽清，请移除后重试`;
  }
  if (raw.indexOf('empty_cart') >= 0) return '购物车为空';
  if (raw.indexOf('store_not_found') >= 0) return '门店不存在，请重新扫码';
  if (raw.indexOf('后端未配置') >= 0) return raw;
  return raw;
}

const MenuPage: React.FC = () => {
  const [activeCat, setActiveCat] = useState('');
  // 右侧受控 scrollTop：点分类时按实测偏移精确定位（不依赖 scrollIntoView，H5 上其对齐会欠滚一截）
  const [dishScrollTop, setDishScrollTop] = useState(0);
  const [showCart, setShowCart] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    items, add, minus, getCount, getTotalCount, getTotalPrice, clear,
    orderType, setOrderType, tableNo, setTableNo,
    storeId, pointId, pointRef, setPoint,
    placeOrder: recordLocalOrder, updateOrderStatus,
  } = useCartStore();
  const { user } = useUserStore();
  const { member, refresh: refreshMember, ensure: ensureMember } = useMemberStore();

  // 进入点餐页拉一次会员/余额（供结算时展示可用余额）
  useEffect(() => {
    if (isBackendConfigured()) refreshMember();
  }, [refreshMember]);

  // 拉后端真实分类 + 菜品
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [cats, ds] = await Promise.all([fetchCategories(storeId), fetchDishes(storeId)]);
      setCategories(cats);
      setDishes(ds);
      if (cats.length) setActiveCat((prev) => prev || cats[0].id);
    } catch (e: any) {
      setLoadError(mapOrderError(e?.message || '菜单加载失败'));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // 扫码点位 code → 解析为 uuid + 桌号显示
  useEffect(() => {
    if (!pointRef || pointId || !isBackendConfigured()) return;
    resolvePoint(pointRef, storeId)
      .then((p) => {
        if (p) {
          setPoint(p.id);
          setTableNo(p.name);
        }
      })
      .catch(() => {});
  }, [pointRef, pointId, storeId, setPoint, setTableNo]);

  const groupedDishes = useMemo(() => {
    return categories.map((cat) => ({
      ...cat,
      list: dishes.filter((d) => d.categoryId === cat.id),
    }));
  }, [categories, dishes]);

  // 点分类后短暂锁住「滚动反向高亮」，避免程序化滚动动画途中把高亮闪到中间分类
  const catLockUntil = useRef(0);
  // 亚像素抖动：保证重复点同一分类时 scrollTop 值也会变化，从而再次触发滚动
  const jitterRef = useRef(0);
  // 右侧实时 scrollTop（由 onScroll 持续写入），供点分类时精确换算目标位置
  const curScrollTop = useRef(0);

  // 左侧分类点击 → 右侧把该分类首个菜品滚到容器顶
  // 用 SelectorQuery 实测锚点相对容器的偏移，直接设 scrollTop（H5 的 scrollIntoView 默认 block:center 会欠滚，弃用）
  const handleCatTap = useCallback((catId: string) => {
    setActiveCat(catId);
    // 滚动动画 easeOutScroll 固定 500ms，锁久一点确保动画尾帧不把高亮反算回中间/上一分类
    catLockUntil.current = Date.now() + 700;
    const q = Taro.createSelectorQuery();
    q.select('#dish-scroll').boundingClientRect();
    q.select(`#cat-anchor-${catId}`).boundingClientRect();
    q.exec((res: any[]) => {
      const container = res && res[0];
      const anchor = res && res[1];
      if (!container || !anchor) return;
      // 目标 scrollTop = 当前 scrollTop + (锚点顶 - 容器顶)，使锚点组头精确贴容器顶
      const target = Math.max(0, curScrollTop.current + (anchor.top - container.top));
      jitterRef.current = jitterRef.current === 0 ? 0.5 : 0;
      setDishScrollTop(target + jitterRef.current);
    });
  }, []);

  // 右侧滚动 → 同步高亮左侧分类（throttle + SelectorQuery，weapp/H5 通用）
  const scrollLock = useRef(false);
  const handleDishScroll = useCallback((e?: any) => {
    // 每次滚动都记录真实 scrollTop（不受 throttle 影响），供点分类换算
    const st = e?.detail?.scrollTop;
    if (typeof st === 'number') curScrollTop.current = st;
    if (Date.now() < catLockUntil.current) return; // 程序化定位动画期间不反向改高亮
    if (scrollLock.current) return;
    scrollLock.current = true;
    setTimeout(() => { scrollLock.current = false; }, 120);
    const groups = groupedDishes;
    if (!groups.length) return;
    const q = Taro.createSelectorQuery();
    q.select('#dish-scroll').boundingClientRect();
    groups.forEach((g) => q.select(`#cat-anchor-${g.id}`).boundingClientRect());
    q.exec((res: any[]) => {
      const container = res && res[0];
      if (!container) return;
      const rects = res.slice(1);
      let current = '';
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r) continue;
        // 组顶部越过（或贴近）容器顶部即视为当前分类
        if (r.top - container.top <= 12) current = groups[i].id;
        else break;
      }
      if (current) setActiveCat((prev) => (prev === current ? prev : current));
    });
  }, [groupedDishes]);

  const totalCount = getTotalCount();
  const totalPrice = getTotalPrice();

  // 扫码绑定桌号（weapp 有相机；H5 无相机会走 fail）
  const handleScanTable = () => {
    Taro.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode'],
      success: (res) => {
        const raw = res.result || '';
        let table = '';
        const m = raw.match(/[?&]table(?:No)?=([^&#]+)/i);
        if (m) {
          table = m[1];
        } else if (/^\d+$/.test(raw)) {
          table = raw;
        } else {
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
      },
    });
  };

  const handleAdd = (dish: Dish) => {
    if (dish.soldOut) {
      Taro.showToast({ title: '该菜品已沽清', icon: 'none' });
      return;
    }
    add(dish);
  };

  const handleSubmit = async () => {
    if (totalCount === 0 || submitting) return;

    // 堂食未绑桌：weapp 引导扫码；H5 用 URL 参数绑桌，直接放行
    if (orderType === 'dineIn' && !tableNo && process.env.TARO_ENV === 'weapp') {
      Taro.showModal({
        title: '请先绑定桌号',
        content: '堂食下单前请扫描桌角的二维码绑定桌号',
        confirmText: '去扫码',
        success: (r) => { if (r.confirm) handleScanTable(); },
      });
      return;
    }

    const openid = ensureDevOpenId();
    setSubmitting(true);
    Taro.showLoading({ title: '提交中...', mask: true });
    let placed: PlaceOrderResult;
    try {
      placed = await placeOrderApi({
        storeId,
        pointId: orderType === 'dineIn' ? (pointId || null) : null,
        items: items.map((i) => ({ item_id: i.dish.id, qty: i.count })),
        customerRef: openid,
        payMethod: 'mock',
      });
      Taro.hideLoading();
    } catch (e: any) {
      Taro.hideLoading();
      Taro.showModal({ title: '下单失败', content: mapOrderError(e?.message || ''), showCancel: false });
      if (String(e?.message).indexOf('item_unavailable') >= 0) loadCatalog();
      setSubmitting(false);
      return;
    }

    // 选择支付方式：微信支付(mock) / 余额支付
    const bal = member?.balance ?? 0;
    Taro.showActionSheet({
      itemList: ['微信支付', `余额支付（¥${bal.toFixed(2)}）`],
      success: (r) => settleOrder(placed, r.tapIndex === 1 ? 'balance' : 'wx', openid),
      fail: () => {
        // 取消支付：订单已创建但未支付，稍后可在订单页继续（demo 简化：提示即可）
        Taro.showToast({ title: '已取消支付', icon: 'none' });
        setSubmitting(false);
      },
    });
  };

  // 支付并跳转支付成功页（私域转化）
  const settleOrder = async (placed: PlaceOrderResult, method: 'wx' | 'balance', openid: string) => {
    Taro.showLoading({ title: '支付中...', mask: true });
    try {
      if (method === 'balance') {
        const m = await ensureMember(user?.phone ?? null);
        if (!m?.id) throw new Error('会员开通失败，请重试');
        await payWithBalance(placed.order_token, m.id);
      } else {
        // mock 支付：支付成功 + 无感建会员（openid 主键、附手机号）
        await mockPay(placed.order_token, openid, user?.phone || null);
      }
      Taro.hideLoading();
      const label = method === 'balance' ? '余额支付' : '微信支付';
      const orderId = recordLocalOrder(label);
      updateOrderStatus(orderId, 'pending');
      refreshMember();
      Taro.navigateTo({
        url: `/pages/paySuccess/index?amount=${placed.total}&method=${encodeURIComponent(label)}&orderId=${placed.order_id}`,
      });
    } catch (e: any) {
      Taro.hideLoading();
      const raw = String(e?.message || '');
      if (raw.indexOf('insufficient_balance') >= 0) {
        Taro.showModal({
          title: '余额不足',
          content: '储值余额不足以支付本单，去充值后再用余额支付？',
          confirmText: '去充值',
          success: (rr) => { if (rr.confirm) Taro.navigateTo({ url: '/pages/topup/index' }); },
        });
      } else {
        Taro.showModal({ title: '支付失败', content: mapOrderError(raw), showCancel: false });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className={styles.page}>
      {/* 餐厅信息 */}
      <View className={styles.restBar}>
        <View className={styles.restLogo}>川</View>
        <View className={styles.restInfo}>
          <Text className={styles.restName}>川小灶·望京店</Text>
          <Text className={styles.restDesc}>营业中 · 川味家常 · 扫码点餐</Text>
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
              onClick={() => handleCatTap(cat.id)}
            >
              {cat.name}
            </View>
          ))}
        </ScrollView>

        {/* 右侧菜品 */}
        <ScrollView
          scrollY
          id="dish-scroll"
          className={styles.dishList}
          scrollTop={dishScrollTop}
          scrollWithAnimation
          onScroll={handleDishScroll}
        >
          {loading && <View className={styles.stateTip}>菜单加载中…</View>}
          {!loading && loadError && (
            <View className={styles.stateTip}>
              {loadError}
              <Text className={styles.retryBtn} onClick={loadCatalog}>点击重试</Text>
            </View>
          )}
          {!loading && !loadError && groupedDishes.map((group) => (
            <View key={group.id} id={`cat-anchor-${group.id}`} className={styles.dishGroup}>
              <Text className={styles.groupTitle}>{group.name}</Text>
              {group.list.map((dish) => (
                <View key={dish.id} className={classnames(styles.dishCard, dish.soldOut && styles.soldOut)}>
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
                      {dish.soldOut ? (
                        <Text className={styles.soldOutBadge}>沽清</Text>
                      ) : (
                        <Stepper
                          count={getCount(dish.id)}
                          onAdd={() => handleAdd(dish)}
                          onMinus={() => minus(dish.id)}
                        />
                      )}
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
                    onAdd={() => handleAdd(item.dish)}
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
          className={classnames(styles.submitBtn, (totalCount === 0 || submitting) && styles.disabled)}
          onClick={handleSubmit}
        >
          {totalCount === 0 ? '未选购' : submitting ? '提交中...' : '去结算'}
        </View>
      </View>
    </View>
  );
};

export default MenuPage;
