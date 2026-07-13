import Taro from '@tarojs/taro';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isBackendConfigured } from './supabase';

// ============================================================
// 身份: openid + 手机号
// 资质到位前: 优先调 wx-login Edge Function(sandbox 返回 dev 伪 openid)
// 后端未配置或调用失败: 回退到本地 dev openid(保证 P1 不被登录阻塞)
// 资质到位后: wx-login 切 live 模式,返回真 openid + 真手机号
// ============================================================

const OPENID_KEY = 'mc_dev_openid';
const PHONE_KEY = 'mc_user_phone';

const WX_LOGIN_URL = `${SUPABASE_URL}/functions/v1/wx-login`;

function randomId(): string {
  const rnd = Math.random().toString(36).slice(2, 12);
  const t = Date.now().toString(36);
  return `dev_${t}${rnd}`;
}

/** 本地兜底: 取(或首次生成并持久化)设备伪 openid */
function ensureLocalDevOpenId(): string {
  try {
    const cached = Taro.getStorageSync(OPENID_KEY);
    if (cached) return cached as string;
  } catch (e) { /* ignore */ }
  const id = randomId();
  try { Taro.setStorageSync(OPENID_KEY, id); } catch (e) { /* ignore */ }
  return id;
}

/**
 * 取 openid: 优先调 wx-login Edge Function,失败回退本地 dev openid
 * @param wxCode wx.login() 返回的 code;不传则只用本地兜底
 */
export async function ensureOpenId(wxCode?: string): Promise<string> {
  // 后端未配置: 直接用本地兜底
  if (!isBackendConfigured()) {
    return ensureLocalDevOpenId();
  }

  // 优先用本地缓存的 openid(避免每次都调 Edge Function)
  try {
    const cached = Taro.getStorageSync(OPENID_KEY);
    if (cached && cached.startsWith('o')) {
      // 真 openid(以 o 开头)直接复用;dev_xxx 每次重试换真
      return cached;
    }
  } catch (e) { /* ignore */ }

  if (!wxCode) {
    // 无 code 也用本地兜底
    return ensureLocalDevOpenId();
  }

  // 调 wx-login Edge Function
  try {
    const res = await Taro.request({
      url: WX_LOGIN_URL,
      method: 'POST',
      header: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      data: { code: wxCode },
    });
    if (res.statusCode === 200 && res.data?.openid) {
      const openid: string = res.data.openid;
      try { Taro.setStorageSync(OPENID_KEY, openid); } catch (e) { /* ignore */ }
      return openid;
    }
    // 调用失败: 回退本地兜底
    return ensureLocalDevOpenId();
  } catch (e) {
    console.warn('wx-login Edge Function 调用失败,回退本地 openid', e);
    return ensureLocalDevOpenId();
  }
}

/**
 * 同步取 openid(无 wx.login code 时用,兼容旧调用)
 * 优先返回缓存的真 openid,否则生成/复用本地 dev openid
 */
export function ensureDevOpenId(): string {
  // 先查缓存
  try {
    const cached = Taro.getStorageSync(OPENID_KEY);
    if (cached) return cached as string;
  } catch (e) { /* ignore */ }
  return ensureLocalDevOpenId();
}

/**
 * 解密手机号: 调 wx-login Edge Function 的 phone_code 分支
 * @param phoneCode wx.getPhoneNumber 回调里的 code
 * @returns 解密后的手机号;失败返回 null
 */
export async function decryptPhone(phoneCode: string): Promise<string | null> {
  if (!isBackendConfigured() || !phoneCode) return null;

  try {
    // 需要 wx.login 的 code 一起传(Edge Function 用 jscode2session 换 openid 时附带解密手机号)
    const { code: wxCode } = await Taro.login();
    const res = await Taro.request({
      url: WX_LOGIN_URL,
      method: 'POST',
      header: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      data: { code: wxCode, phone_code: phoneCode },
    });
    if (res.statusCode === 200 && res.data?.phone) {
      const phone: string = res.data.phone;
      try { Taro.setStorageSync(PHONE_KEY, phone); } catch (e) { /* ignore */ }
      return phone;
    }
    return null;
  } catch (e) {
    console.warn('手机号解密失败', e);
    return null;
  }
}

/** 取缓存的手机号(无则 null) */
export function getCachedPhone(): string | null {
  try {
    return (Taro.getStorageSync(PHONE_KEY) as string) || null;
  } catch (e) {
    return null;
  }
}
