import './polyfill';   // 必须第一位：为 H5 兜底 process 全局，早于 any 模块
import React, { useEffect } from 'react';
import { useDidShow, useDidHide } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import { useCartStore } from '@/store/cart';
import { useUserStore } from '@/store/user';
import ErrorBoundary from '@/components/ErrorBoundary';
// 全局样式
import './app.scss';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 把 "store=..&point=T01&table=3号桌" 解析成对象
function parseKV(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  const decoded = decodeURIComponent(raw).replace(/^\?/, '');
  decoded.split('&').forEach((pair) => {
    const [k, v] = pair.split('=');
    if (k && v) out[k.trim()] = v.trim();
  });
  return out;
}

/**
 * 解析扫码进店参数（门店 + 点位/桌号）
 * - 小程序码 scene：`store=<uuid>&point=T01` 或裸 `T01` / 裸数字
 * - 普通二维码 / H5(nip.io) URL query：`?store=<uuid>&point=T01&table=3号桌`
 */
function applyEntryParams() {
  const cart = useCartStore.getState();
  const params: Record<string, string> = {};

  try {
    const launch = Taro.getLaunchOptionsSync();
    Object.assign(params, launch.query || {});
    if (launch.scene) {
      const raw = String(launch.scene);
      const kv = parseKV(raw);
      if (Object.keys(kv).length) {
        Object.assign(params, kv);
      } else if (/^\d+$/.test(raw)) {
        params.table = raw;                 // 裸数字 = 桌号
      } else {
        params.point = raw;                 // 裸字符串 = 点位 code
      }
    }
  } catch (e) {
    // ignore
  }

  // H5：补读浏览器地址栏 query（nip.io 访问场景）
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    Object.assign(params, parseKV(window.location.search));
  }

  if (params.store && UUID_RE.test(params.store)) cart.setStoreId(params.store);

  const pointRef = params.point || params.pointId || '';
  if (pointRef) cart.setPointRef(pointRef);

  const table = params.tableNo || params.table || '';
  if (table) {
    const display = /^\d+$/.test(table) ? `${table}号桌` : table;
    cart.setTableNo(display);
  }
}

function App(props) {
  console.log('[APP] App render start, children:', !!props.children);

  useEffect(() => {
    console.log('[APP] useEffect triggered');
    // 监听小程序全局未捕获异常
    if (process.env.TARO_ENV === 'weapp') {
      Taro.onError((err) => {
        console.error('[APP] Taro Global onError:', err);
      });
    }

    // 恢复本地登录态
    try {
      useUserStore.getState().restore();
      console.log('[APP] restore done');
    } catch (e) {
      console.error('[APP] restore error:', e);
    }

    // 解析扫码进店参数（门店 + 桌号），点位 code 由菜单页解析成 uuid
    try {
      applyEntryParams();
      console.log('[APP] applyEntryParams done');
    } catch (e) {
      console.error('[APP] applyEntryParams error:', e);
    }
  }, []);

  useDidShow(() => { console.log('[APP] didShow'); });
  useDidHide(() => {});

  console.log('[APP] App render return');
  return (
    <ErrorBoundary>
      {props.children}
    </ErrorBoundary>
  );
}

export default App;
