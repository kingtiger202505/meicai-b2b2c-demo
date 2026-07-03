import Taro from '@tarojs/taro';

// ============================================================
// 开发期身份：设备端稳定的「伪 openid」
// 真 wx.login → openid 的 Edge Function 待商户/AppSecret 联调时再上；
// 现在用设备端持久化的伪 openid 作为会员主键，保证 P1 不被登录阻塞、
// 且同一设备多次下单会命中同一会员（无感建/更新会员）。
// ============================================================

const OPENID_KEY = 'mc_dev_openid';

function randomId(): string {
  const rnd = Math.random().toString(36).slice(2, 12);
  const t = Date.now().toString(36);
  return `dev_${t}${rnd}`;
}

/** 取（或首次生成并持久化）设备伪 openid */
export function ensureDevOpenId(): string {
  try {
    const cached = Taro.getStorageSync(OPENID_KEY);
    if (cached) return cached as string;
  } catch (e) {
    // ignore
  }
  const id = randomId();
  try {
    Taro.setStorageSync(OPENID_KEY, id);
  } catch (e) {
    // ignore（存储失败也返回本次生成值）
  }
  return id;
}
