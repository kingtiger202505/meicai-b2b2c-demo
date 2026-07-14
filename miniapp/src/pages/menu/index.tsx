import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image, ScrollView, Swiper, SwiperItem } from '@tarojs/components';
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
import { createWxPayOrder, requestWxPayment } from '@/services/pay';
import { useMemberStore } from '@/store/member';
import { listMyCoupons, redeemCoupon, isCouponUsable, couponLabel, type Coupon } from '@/services/coupon';
import { STORE_ID } from '@/services/supabase';
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
  // 点分类时把该分类锚点写进 scrollIntoView（非受控 scrollTop —— 受控值会在手动滚动的重渲染里被 Taro
  // 重新贴回、把列表拽回旧位置，导致标准②回归）。配合 scrollIntoViewAlignment="start" 让锚点组头贴顶。
  const [scrollIntoCat, setScrollIntoCat] = useState('');
  const [showCart, setShowCart] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 选券面板状态
  const [couponPanelOpen, setCouponPanelOpen] = useState(false);
  const [couponList, setCouponList] = useState<Coupon[]>([]);
  const [couponLoading, setCouponLoading] = useState(false);
  const [selectedCouponId, setSelectedCouponId] = useState<string>('');
  // 暂存下单结果，选完券后继续支付
  const pendingOrderRef = useRef<{ placed: PlaceOrderResult; openid: string } | null>(null);

  // 我的券包弹层状态
  const [myCouponsOpen, setMyCouponsOpen] = useState(false);
  const [myCoupons, setMyCoupons] = useState<Coupon[]>([]);
  const [myCouponsLoading, setMyCouponsLoading] = useState(false);
  const [myCouponTab, setMyCouponTab] = useState<'unused' | 'history'>('unused');

  // 拉取我的优惠券列表
  const refreshCoupons = useCallback(async () => {
    if (!isBackendConfigured()) return;
    setMyCouponsLoading(true);
    try {
      const all = await listMyCoupons();
      setMyCoupons(all);
    } catch (e) {
      console.warn('获取我的券包失败', e);
    } finally {
      setMyCouponsLoading(false);
    }
  }, []);

  const {
    items, add, minus, getCount, getTotalCount, getTotalPrice, clear,
    orderType, setOrderType, tableNo, setTableNo,
    storeId, pointId, pointRef, setPoint,
    sessionId, setSessionId, mergeSessionCart, clearSessionCart,
    placeOrder: recordLocalOrder, updateOrderStatus,
  } = useCartStore();
  const { user } = useUserStore();
  const { member, refresh: refreshMember, ensure: ensureMember } = useMemberStore();

  // 进入点餐页拉一次会员/余额与优惠券
  useEffect(() => {
    if (isBackendConfigured()) {
      refreshMember();
      refreshCoupons();
    }
  }, [refreshMember, refreshCoupons]);

  // 拉后端真实分类 + 菜品
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [cats, ds] = await Promise.all([fetchCategories(storeId), fetchDishes(storeId)]);
      setCategories(cats);
      setDishes(ds);
      if (cats.length) setActiveCat((prev) => prev || cats[0].id);

      // 堂食有会话：拉共享购物车合并到本地（同桌已选的菜显示出来）
      const sid = useCartStore.getState().sessionId;
      if (sid && isBackendConfigured()) {
        const dishMap: Record<string, Dish> = {};
        ds.forEach((d) => { dishMap[d.id] = d; });
        await mergeSessionCart(dishMap);
      }
    } catch (e: any) {
      setLoadError(mapOrderError(e?.message || '菜单加载失败'));
    } finally {
      setLoading(false);
    }
  }, [storeId, mergeSessionCart]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // 扫码点位 code → 解析为 uuid + 桌号显示 + 会话 id
  useEffect(() => {
    if (!pointRef || pointId || !isBackendConfigured()) return;
    resolvePoint(pointRef, storeId)
      .then((p) => {
        if (p) {
          setPoint(p.id);
          setTableNo(p.name);
          // 堂食绑桌：记录当前会话（协同购物车用）
          if (p.current_session_id) setSessionId(p.current_session_id);
        }
      })
      .catch(() => {});
  }, [pointRef, pointId, storeId, setPoint, setTableNo, setSessionId]);

  const groupedDishes = useMemo(() => {
    return categories.map((cat) => ({
      ...cat,
      list: dishes.filter((d) => d.categoryId === cat.id),
    }));
  }, [categories, dishes]);

  // 点分类后短暂锁住「滚动反向高亮」，避免程序化滚动动画途中把高亮闪到中间分类
  const catLockUntil = useRef(0);

  // 左侧分类点击 → 用 scrollIntoView 把该分类锚点滚到容器顶（配合 alignment="start" 贴顶；非受控，不干扰手动滚动）
  const handleCatTap = useCallback((catId: string) => {
    setActiveCat(catId);
    // 滚动动画期间锁住反向高亮，确保动画尾帧不把高亮反算回中间/上一分类
    catLockUntil.current = Date.now() + 700;
    // 先清空再置：保证重复点同一分类时 scrollIntoView 值也会变化，从而再次触发滚动
    setScrollIntoCat('');
    setTimeout(() => setScrollIntoCat(`cat-anchor-${catId}`), 0);
  }, []);

  // 右侧滚动 → 同步高亮左侧分类（throttle + SelectorQuery，weapp/H5 通用）
  const scrollLock = useRef(false);
  const handleDishScroll = useCallback(() => {
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

    // 下单成功后，查可用券；有则弹选券面板，无则直接选支付方式
    pendingOrderRef.current = { placed, openid };
    let usableCoupons: Coupon[] = [];
    try {
      const all = await listMyCoupons('unused');
      usableCoupons = all.filter(isCouponUsable);
    } catch (e) {
      // 查券失败不阻塞下单，按无券处理
      console.warn('查券失败，跳过选券', e);
    }

    if (usableCoupons.length > 0) {
      setCouponList(usableCoupons);
      setSelectedCouponId('');
      setCouponPanelOpen(true);
      setSubmitting(false);
      return;
    }

    // 无可用券：直接进入支付方式选择
    proceedToPay(placed, openid);
  };

  // 选券面板：确认选择后核销券，再进入支付
  const handleConfirmCoupon = async () => {
    const pending = pendingOrderRef.current;
    if (!pending) return;
    const { placed, openid } = pending;

    // 未选券：直接按原金额支付
    if (!selectedCouponId) {
      setCouponPanelOpen(false);
      proceedToPay(placed, openid);
      return;
    }

    setSubmitting(true);
    Taro.showLoading({ title: '核销券中...', mask: true });
    try {
      const res = await redeemCoupon(selectedCouponId, placed.order_id, storeId || STORE_ID, openid);
      Taro.hideLoading();
      // 核销成功：用 new_total 覆盖原金额继续支付
      const newPlaced: PlaceOrderResult = { ...placed, total: res.new_total };
      setCouponPanelOpen(false);
      Taro.showToast({ title: `已优惠 ¥${res.discount.toFixed(2)}`, icon: 'none' });
      proceedToPay(newPlaced, openid);
    } catch (e: any) {
      Taro.hideLoading();
      const raw = String(e?.message || '');
      let content = '券核销失败，请重新选择';
      if (raw.indexOf('below_threshold') >= 0) content = '该券不满足使用门槛，请重新选择';
      else if (raw.indexOf('already_used') >= 0) content = '该券已被使用，请重新选择';
      else if (raw.indexOf('expired') >= 0) content = '该券已过期，请重新选择';
      else if (raw.indexOf('not_found') >= 0) content = '券不存在，请重新选择';
      Taro.showModal({ title: '无法使用该券', content, showCancel: false });
      // 允许重新选或不选券
      setSubmitting(false);
    }
  };

  // 选券面板：直接跳过不使用券
  const handleSkipCoupon = () => {
    const pending = pendingOrderRef.current;
    if (!pending) return;
    setCouponPanelOpen(false);
    proceedToPay(pending.placed, pending.openid);
  };

  // 选择支付方式：微信支付(mock) / 余额支付
  const proceedToPay = (placed: PlaceOrderResult, openid: string) => {
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
        // 微信支付: 调 wxpay-create Edge Function(服务商模式)
        // sandbox 模式返回占位 paySign,wx.requestPayment 会失败,走 mockPay 兜底
        // live 模式返回真 paySign,wx.requestPayment 唤起真支付
        let paid = false;
        try {
          const { payParams, mode } = await createWxPayOrder({
            orderToken: placed.order_token,
            orderId: placed.order_id,
            amount: placed.total,
            openId: openid,
          });
          if (mode === 'live') {
            // live: 唤起真微信支付
            paid = await requestWxPayment(payParams);
            if (!paid) {
              Taro.hideLoading();
              Taro.showToast({ title: '已取消支付', icon: 'none' });
              setSubmitting(false);
              return;
            }
            // live 模式支付成功由微信异步回调(wxpay-notify)驱动,此处不调 mockPay
          } else {
            // sandbox / local-mock: paySign 是假的,直接走 mockPay 跑通下游
            await mockPay(placed.order_token, openid, user?.phone || null);
            paid = true;
          }
        } catch (payErr) {
          // wx.requestPayment 失败(sandbox 下假 paySign): 兜底走 mockPay
          const errMsg = String((payErr as any)?.errMsg || (payErr as any)?.message || '');
          if (errMsg.indexOf('cancel') > -1) {
            Taro.hideLoading();
            Taro.showToast({ title: '已取消支付', icon: 'none' });
            setSubmitting(false);
            return;
          }
          // 其他失败: 兜底 mock(保证 demo 闭环)
          await mockPay(placed.order_token, openid, user?.phone || null);
          paid = true;
        }
        if (!paid) {
          Taro.hideLoading();
          setSubmitting(false);
          return;
        }
      }
      Taro.hideLoading();
      const label = method === 'balance' ? '余额支付' : '微信支付';
      const orderId = recordLocalOrder(label);
      updateOrderStatus(orderId, 'pending');
      refreshMember();
      refreshCoupons();
      // 下单成功后清空共享购物车（任何人结账后同桌购物车归零）
      clearSessionCart();
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

  // 营销 Banner 列表
  const banners = [
    { id: 1, image: 'https://picsum.photos/id/488/800/400', action: 'topup', title: '首充礼遇：充100送20' },
    { id: 2, image: 'https://picsum.photos/id/1060/800/400', action: 'coupon', title: '会员专享：限时领满减券' }
  ];

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

      {/* 轮播 Banner 营销区 */}
      <Swiper
        className={styles.bannerSwiper}
        indicatorColor="rgba(255,255,255,0.5)"
        indicatorActiveColor="#ff4d4f"
        circular
        autoplay
        interval={4000}
        indicatorDots
      >
        {banners.map((b) => (
          <SwiperItem
            key={b.id}
            onClick={() => {
              if (b.action === 'topup') {
                Taro.navigateTo({ url: '/pages/topup/index' });
              } else if (b.action === 'coupon') {
                refreshCoupons();
                setMyCouponsOpen(true);
              }
            }}
          >
            <Image className={styles.bannerImage} src={b.image} mode="aspectFill" />
            <View className={styles.bannerMask}>
              <Text className={styles.bannerTitle}>{b.title}</Text>
            </View>
          </SwiperItem>
        ))}
      </Swiper>

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

      {/* 会员资产栏（储值 + 优惠券） */}
      {isBackendConfigured() && (
        <View className={styles.memberBar}>
          <View className={styles.memberBarLeft}>
            <Text className={styles.memberAvatar}>👤</Text>
            <Text className={styles.memberWelcome}>
              {member ? `会员 (尾号${member.phone?.slice(-4) || '---'})` : '普通顾客'}
            </Text>
          </View>
          <View className={styles.memberBarRight}>
            <View className={styles.assetItem} onClick={() => Taro.navigateTo({ url: '/pages/topup/index' })}>
              <Text className={styles.assetLabel}>余额</Text>
              <Text className={styles.assetValue}>¥{(member?.balance ?? 0).toFixed(2)}</Text>
            </View>
            <View className={styles.assetDivider} />
            <View className={styles.assetItem} onClick={() => { refreshCoupons(); setMyCouponsOpen(true); }}>
              <Text className={styles.assetLabel}>券包</Text>
              <Text className={styles.assetValue}>
                {myCoupons.filter(isCouponUsable).length}张可用
              </Text>
              <Text className={styles.assetArrow}>›</Text>
            </View>
          </View>
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
          scrollIntoView={scrollIntoCat}
          scrollIntoViewAlignment="start"
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

      {/* 我的券包弹层 */}
      {myCouponsOpen && (
        <>
          <View className={styles.couponMask} onClick={() => setMyCouponsOpen(false)} />
          <View className={styles.couponPanel}>
            <View className={styles.couponPanelHd}>
              <Text className={styles.couponPanelTitle}>我的优惠券</Text>
              <Text className={styles.couponPanelClose} onClick={() => setMyCouponsOpen(false)}>关闭</Text>
            </View>
            <View className={styles.tabHeader}>
              <Text
                className={classnames(styles.tabItem, myCouponTab === 'unused' && styles.tabItemActive)}
                onClick={() => setMyCouponTab('unused')}
              >
                可用券 ({myCoupons.filter(isCouponUsable).length})
              </Text>
              <Text
                className={classnames(styles.tabItem, myCouponTab === 'history' && styles.tabItemActive)}
                onClick={() => setMyCouponTab('history')}
              >
                历史券 ({myCoupons.filter(c => !isCouponUsable(c)).length})
              </Text>
            </View>
            <ScrollView scrollY className={styles.couponPanelBd}>
              {myCouponsLoading && <View className={styles.stateTip}>加载中...</View>}
              {!myCouponsLoading && (
                <>
                  {myCouponTab === 'unused' ? (
                    <>
                      {myCoupons.filter(isCouponUsable).length === 0 ? (
                        <View className={styles.stateTip}>暂无可用优惠券</View>
                      ) : (
                        myCoupons.filter(isCouponUsable).map((c) => (
                          <View key={c.id} className={styles.couponItem}>
                            <View className={styles.couponItemLeft}>
                              <Text className={styles.couponItemValue}>¥{c.value}</Text>
                              <Text className={styles.couponItemThreshold}>
                                {c.kind === 'cash' ? '代金券' : `满 ${c.threshold} 可用`}
                              </Text>
                            </View>
                            <View className={styles.couponItemRight}>
                              <Text className={styles.couponItemLabel}>{couponLabel(c)}</Text>
                              <Text className={styles.couponItemExpire}>
                                {c.expire_at
                                  ? `有效期至 ${new Date(c.expire_at).toLocaleDateString('zh-CN')}`
                                  : '永久有效'}
                              </Text>
                            </View>
                          </View>
                        ))
                      )}
                    </>
                  ) : (
                    <>
                      {myCoupons.filter(c => !isCouponUsable(c)).length === 0 ? (
                        <View className={styles.stateTip}>暂无历史优惠券</View>
                      ) : (
                        myCoupons.filter(c => !isCouponUsable(c)).map((c) => (
                          <View key={c.id} className={classnames(styles.couponItem, styles.couponItemDisabled)}>
                            <View className={styles.couponItemLeft}>
                              <Text className={styles.couponItemValue}>¥{c.value}</Text>
                              <Text className={styles.couponItemThreshold}>
                                {c.kind === 'cash' ? '代金券' : `满 ${c.threshold} 可用`}
                              </Text>
                            </View>
                            <View className={styles.couponItemRight}>
                              <Text className={styles.couponItemLabel}>{couponLabel(c)}</Text>
                              <Text className={styles.couponItemExpire}>
                                {c.status === 'used' ? '已使用' : '已过期'}
                              </Text>
                            </View>
                          </View>
                        ))
                      )}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </>
      )}

      {/* 选券面板弹层 */}
      {couponPanelOpen && (
        <>
          <View className={styles.couponMask} onClick={handleSkipCoupon} />
          <View className={styles.couponPanel}>
            <View className={styles.couponPanelHd}>
              <Text className={styles.couponPanelTitle}>选择优惠券</Text>
              <Text className={styles.couponPanelClose} onClick={handleSkipCoupon}>不使用</Text>
            </View>
            <ScrollView scrollY className={styles.couponPanelBd}>
              {/* 不使用券选项 */}
              <View
                className={classnames(
                  styles.couponItem,
                  selectedCouponId === '' && styles.couponItemActive
                )}
                onClick={() => setSelectedCouponId('')}
              >
                <View className={styles.couponItemLeft}>
                  <Text className={styles.couponItemValue}>不使用</Text>
                  <Text className={styles.couponItemThreshold}>按原金额支付</Text>
                </View>
                <View className={styles.couponItemRadio}>
                  {selectedCouponId === '' && <Text className={styles.radioDot} />}
                </View>
              </View>
              {couponList.map((c) => {
                const selected = selectedCouponId === c.id;
                return (
                  <View
                    key={c.id}
                    className={classnames(styles.couponItem, selected && styles.couponItemActive)}
                    onClick={() => setSelectedCouponId(c.id)}
                  >
                    <View className={styles.couponItemLeft}>
                      <Text className={styles.couponItemValue}>¥{c.value}</Text>
                      <Text className={styles.couponItemThreshold}>
                        {c.kind === 'cash' ? '代金券' : `满 ${c.threshold} 可用`}
                      </Text>
                    </View>
                    <View className={styles.couponItemRight}>
                      <Text className={styles.couponItemLabel}>{couponLabel(c)}</Text>
                      <Text className={styles.couponItemExpire}>
                        {c.expire_at
                          ? `有效期至 ${new Date(c.expire_at).toLocaleDateString('zh-CN')}`
                          : '永久有效'}
                      </Text>
                    </View>
                    <View className={styles.couponItemRadio}>
                      {selected && <Text className={styles.radioDot} />}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            <View className={styles.couponPanelFt}>
              <Text
                className={classnames(
                  styles.couponConfirmBtn,
                  (submitting || couponLoading) && styles.couponConfirmBtnDisabled
                )}
                onClick={handleConfirmCoupon}
              >
                {submitting ? '处理中...' : '确认使用'}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* 购物车详情弹层 */}
      {showCart && totalCount > 0 && (
        <>
          <View className={styles.mask} onClick={() => setShowCart(false)} />
          <View className={styles.cartPanel}>
            <View className={styles.cartPanelHd}>
              <Text className={styles.cartPanelTitle}>已选商品 ({totalCount})</Text>
              {/* 堂食有会话：同桌共享购物车标识 */}
              {orderType === 'dineIn' && sessionId && totalCount > 0 && (
                <Text className={styles.sharedTag}>同桌共选</Text>
              )}
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
