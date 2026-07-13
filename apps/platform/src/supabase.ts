import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const serviceRole = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string;

// 平台管理端模式：若设置了 service_role key 且 VITE_PLATFORM_MODE=1，
// 则用 service_role client 直查受限表(wxpay_merchant 等)与调仅 service_role 的 RPC。
const useServiceRole = !!serviceRole && import.meta.env.VITE_PLATFORM_MODE === '1';

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.warn('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，请复制 .env.example 为 .env.local');
}
if (useServiceRole && !serviceRole) {
  // eslint-disable-next-line no-console
  console.warn('VITE_PLATFORM_MODE=1 但缺少 VITE_SUPABASE_SERVICE_ROLE_KEY');
}

// 用户登录用的 client（始终用 anon key，走 Supabase Auth）
export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// 平台管理端专用 client：service_role 直查受限表 + 调仅 service_role 的 RPC
// 若未配置 service_role key，则回退到 anon client（仅能查自己店的 wxpay_merchant，平台管理端功能受限）
export const platformClient = useServiceRole
  ? createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : supabase;

export const isServiceRoleMode = useServiceRole;
