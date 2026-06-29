import React, { useEffect } from 'react';
import { useDidShow, useDidHide } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import { useCartStore } from '@/store/cart';
import { useUserStore } from '@/store/user';
// 全局样式
import './app.scss';

// 解析小程序码 scene 参数，提取桌号
// 支持格式：table=5  或  tableNo=5号桌  或  纯数字 5
function parseTableFromScene(scene: string): string {
  if (!scene) return '';
  const decoded = decodeURIComponent(scene);
  // table=5
  const m1 = decoded.match(/table(?:No)?=([^&]+)/i);
  if (m1) return m1[1];
  // 纯数字
  if (/^\d+$/.test(decoded)) return decoded;
  return '';
}

function App(props) {
  useEffect(() => {
    // 恢复本地登录态
    useUserStore.getState().restore();

    // 启动时解析场景参数，自动绑定桌号
    try {
      const launchOpts = Taro.getLaunchOptionsSync();
      // 普通二维码：query.tableNo 或 query.table
      const fromQuery = launchOpts.query?.tableNo || launchOpts.query?.table;
      if (fromQuery) {
        useCartStore.getState().setTableNo(String(fromQuery));
        return;
      }
      // 小程序码 scene
      if (launchOpts.scene) {
        const table = parseTableFromScene(String(launchOpts.scene));
        if (table) {
          // 标准化桌号显示
          const display = /^\d+$/.test(table) ? `${table}号桌` : table;
          useCartStore.getState().setTableNo(display);
        }
      }
    } catch (e) {
      console.warn('解析启动参数失败', e);
    }
  });

  useDidShow(() => {});
  useDidHide(() => {});

  return props.children;
}

export default App;
