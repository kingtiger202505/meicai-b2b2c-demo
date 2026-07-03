import Taro from '@tarojs/taro';

// ============================================================
// Supabase 直连（跨端：Taro.request 在 weapp / H5 均可用）
// 只用 anon key（面向客户端、可公开）；写操作全走 security definer RPC
// 配置来自构建期环境变量 TARO_APP_*（见 miniapp/.env.example）
// ============================================================

export const SUPABASE_URL = (process.env.TARO_APP_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = process.env.TARO_APP_SUPABASE_ANON_KEY || '';
// 单店 MVP：默认指向 seed 门店（川小灶·望京店），可用 TARO_APP_STORE_ID 覆盖
export const STORE_ID = process.env.TARO_APP_STORE_ID || '11111111-1111-1111-1111-111111111111';

export function isBackendConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function authHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

function ensureConfigured() {
  if (!isBackendConfigured()) {
    throw new Error('后端未配置：请在构建时提供 TARO_APP_SUPABASE_URL / TARO_APP_SUPABASE_ANON_KEY');
  }
}

/** PostgREST 只读查询（catalog：store / category / item / service_point 已开放 anon select） */
export async function restGet<T = any>(path: string): Promise<T> {
  ensureConfigured();
  const res = await Taro.request({
    url: `${SUPABASE_URL}/rest/v1/${path}`,
    method: 'GET',
    header: authHeaders(),
  });
  if (res.statusCode >= 400) {
    const msg = (res.data && (res.data.message || res.data.hint)) || `GET ${path} 失败(${res.statusCode})`;
    throw new Error(msg);
  }
  return res.data as T;
}

/** 调用 security definer RPC（下单 / mock 支付 / 会员等） */
export async function rpc<T = any>(fn: string, args: Record<string, any>): Promise<T> {
  ensureConfigured();
  const res = await Taro.request({
    url: `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
    method: 'POST',
    header: authHeaders(),
    data: args,
  });
  if (res.statusCode >= 400) {
    const msg = (res.data && (res.data.message || res.data.hint)) || `RPC ${fn} 失败(${res.statusCode})`;
    throw new Error(msg);
  }
  return res.data as T;
}
