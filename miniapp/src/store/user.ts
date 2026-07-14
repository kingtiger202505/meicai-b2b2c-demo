import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { ensureOpenId, decryptPhone, getCachedPhone } from '@/services/identity';
import { isBackendConfigured } from '@/services/supabase';

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
  /**
   * 一键手机号授权登录（主流方式）
   * @param phoneCode getPhoneNumber 回调的 e.detail.code
   */
  loginWithPhone: (phoneCode: string) => Promise<boolean>;
  // 退出登录
  logout: () => void;
  // 从本地缓存恢复
  restore: () => void;
}

const STORAGE_KEY = 'mc_user_info';

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  loggedIn: false,

  loginWithPhone: async (phoneCode: string) => {
    try {
      // 1. wx.login 拿 code，换 openid
      const { code: wxCode } = await Taro.login();
      const openId = await ensureOpenId(wxCode);

      // 2. 用 phoneCode 解密手机号
      let phone = '';
      if (isBackendConfigured() && phoneCode) {
        const decrypted = await decryptPhone(phoneCode);
        phone = decrypted || '';
      }

      if (!phone) {
        // 后端未配置或解密失败，提示用户
        console.warn('手机号解密失败，openId:', openId);
      }

      const user: UserInfo = {
        openId,
        nickName: '美食爱好者',
        avatarUrl: '',
        phone,
        memberLevel: 'normal',
        points: 0,
        balance: 0
      };
      Taro.setStorageSync(STORAGE_KEY, user);
      if (phone) {
        Taro.setStorageSync('mc_user_phone', phone);
      }
      set({ user, loggedIn: true });
      return true;
    } catch (e) {
      console.warn('登录失败', e);
      return false;
    }
  },

  logout: () => {
    Taro.removeStorageSync(STORAGE_KEY);
    Taro.removeStorageSync('mc_user_phone');
    set({ user: null, loggedIn: false });
  },

  restore: () => {
    try {
      const cached = Taro.getStorageSync(STORAGE_KEY);
      if (cached) {
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
