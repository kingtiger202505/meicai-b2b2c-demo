import { create } from 'zustand';
import { Member, getMember, getOrCreateMember, mockTopup } from '@/services/member';
import { ensureDevOpenId } from '@/services/identity';
import { isBackendConfigured } from '@/services/supabase';

// 会员/储值状态（后端权威）。会员主键 = 设备伪 openid（与下单 customerRef 一致），
// 保证同一设备的下单、充值、余额支付命中同一会员。

interface MemberState {
  member: Member | null;
  loading: boolean;
  /** 拉取当前设备会员（不存在则 member=null，不自动建） */
  refresh: () => Promise<Member | null>;
  /** 确保会员存在（成为会员 / 补手机号），返回会员 */
  ensure: (phone?: string | null) => Promise<Member | null>;
  /** mock 充值，成功后刷新余额 */
  topup: (amount: number, phone?: string | null) => Promise<{ balance: number; gift: number }>;
  setMember: (m: Member | null) => void;
}

export const useMemberStore = create<MemberState>((set, get) => ({
  member: null,
  loading: false,

  refresh: async () => {
    if (!isBackendConfigured()) return null;
    set({ loading: true });
    try {
      const m = await getMember(ensureDevOpenId());
      set({ member: m });
      return m;
    } catch (e) {
      return get().member;
    } finally {
      set({ loading: false });
    }
  },

  ensure: async (phone) => {
    if (!isBackendConfigured()) return null;
    const m = await getOrCreateMember(ensureDevOpenId(), phone ?? null);
    set({ member: m });
    return m;
  },

  topup: async (amount, phone) => {
    const res = await mockTopup(ensureDevOpenId(), amount, phone ?? null);
    // 回填最新余额（沿用现有 member 其余字段）
    set((s) => ({
      member: s.member
        ? { ...s.member, balance: res.balance }
        : { id: res.member_id, balance: res.balance } as Member,
    }));
    // 拉一次权威会员，补全 total_spent/visit 等
    get().refresh();
    return { balance: res.balance, gift: res.gift };
  },

  setMember: (m) => set({ member: m }),
}));
