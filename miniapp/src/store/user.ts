import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { decryptPhone, getCachedPhone } from '@/services/identity';

export interface UserInfo {
  openId: string;
  unionId?: string;
  nickName: string;
  avatarUrl: string;
  phone: string;
  memberLevel: 'normal' | 'silver' | 'gold' | 'diamond';
  points: number;
  balance: number;
}

interface UserState {
  user: UserInfo | null;
  loggedIn: boolean;
  // 微信授权登录（获取 openid + 用户资料）
  login: () => Promise<boolean>;
  // 绑定手机号（从 getPhoneNumber 回调拿 code）
  bindPhone: (code: string) => Promise<boolean>;
  // 退出登录
  logout: () => void;
  // 从本地缓存恢复
  restore: () => void;
}

const STORAGE_KEY = 'mc_user_info';

// 模拟：实际项目应调用云函数 / 后端 API 用 code 换 openid
function mockLogin(): Promise<{ openId: string; nickName: string; avatarUrl: string }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        openId: 'o' + Math.random().toString(36).slice(2, 18),
        nickName: '美食爱好者',
        avatarUrl: ''
      });
    }, 300);
  });
}

function mockBindPhone(code: string): Promise<string> {
  return new Promise((resolve) => {
    // 实际项目用 code 调用后端 phonenumber.getPhoneNumber API
    setTimeout(() => {
      // 模拟返回手机号（实际由后端解密）
      resolve('138****' + code.slice(-4));
    }, 200);
  });
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  loggedIn: false,

  login: async () => {
    try {
      // 1. 获取微信登录凭证 code
      const { code } = await Taro.login();
      // 2. 用 code 调用后端换 openid（此处 mock）
      const profile = await mockLogin();
      // 3. 尝试获取用户资料（需用户授权）
      let nickName = profile.nickName;
      let avatarUrl = profile.avatarUrl;
      try {
        const u = await Taro.getUserProfile({ desc: '用于完善会员资料' });
        nickName = u.userInfo.nickName || nickName;
        avatarUrl = u.userInfo.avatarUrl || avatarUrl;
      } catch (e) {
        // 用户拒绝授权则使用默认资料，登录仍可继续
      }
      const user: UserInfo = {
        openId: profile.openId,
        nickName,
        avatarUrl,
        phone: '',
        memberLevel: 'normal',
        points: 0,
        balance: 0
      };
      Taro.setStorageSync(STORAGE_KEY, user);
      set({ user, loggedIn: true });
      return true;
    } catch (e) {
      console.warn('登录失败', e);
      return false;
    }
  },

  bindPhone: async (code: string) => {
    const user = get().user;
    if (!user) return false;
    // 真机：调 Edge Function 解密手机号；失败回退 mock
    let phone: string | null = null;
    try {
      phone = await decryptPhone(code);
    } catch (e) {
      console.warn('decryptPhone 失败，回退 mock', e);
    }
    if (!phone) {
      // 后端未配置或解密失败，mock 兜底
      phone = '138****' + code.slice(-4);
    }
    const updated = { ...user, phone };
    Taro.setStorageSync(STORAGE_KEY, updated);
    set({ user: updated });
    return true;
  },

  logout: () => {
    Taro.removeStorageSync(STORAGE_KEY);
    set({ user: null, loggedIn: false });
  },

  restore: () => {
    try {
      const cached = Taro.getStorageSync(STORAGE_KEY);
      if (cached) {
        // 如果缓存里没手机号，尝试从 identity 缓存补充
        if (!cached.phone) {
          const cp = getCachedPhone();
          if (cp) cached.phone = cp;
        }
        set({ user: cached, loggedIn: true });
      }
    } catch (e) {
      // ignore
    }
  }
}));
