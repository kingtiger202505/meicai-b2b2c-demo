import { create } from 'zustand';
import Taro from '@tarojs/taro';
import { getCachedPhone, ensureDevOpenId } from '@/services/identity';
import { isBackendConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/services/supabase';

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
      // 1. wx.login 拿 code，与 phoneCode 一起请求，只调一次云函数
      const { code: wxCode } = await Taro.login();
      
      let openId = '';
      let phone = '';

      if (isBackendConfigured()) {
        const response = await Taro.request({
          url: `${SUPABASE_URL}/functions/v1/wx-login`,
          method: 'POST',
          header: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          data: { code: wxCode, phone_code: phoneCode },
        });

        if (response.statusCode === 200 && response.data) {
          openId = response.data.openid || '';
          phone = response.data.phone || '';
          if (openId) {
            Taro.setStorageSync('mc_dev_openid', openId);
          }
        }
      }

      if (!openId) {
        // 如果后端调用失败，使用本地兜底
        openId = ensureDevOpenId();
      }

      if (!phone && !isBackendConfigured()) {
        // 仅「本地无后端」联调时用 mock 兜底；一旦配了后端(live)就不再伪造手机号，
        // 否则真机授权失败会被 13812345678 掩盖、且用假号建会员污染数据。
        console.warn('本地无后端，手机号用 mock 兜底');
        phone = '13812345678';
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
      Taro.setStorageSync('mc_user_phone', phone);
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
