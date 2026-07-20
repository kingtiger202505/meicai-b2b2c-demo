// Edge Function: create-staff
// WX-46 老板端「新增员工」账号创建闭环（去 UUID）
//
// 用 service_role 幂等创建 Supabase Auth 账号 + 绑定 staff(门店 + 角色)，
// 系统生成初始密码，一次性明文回显给老板（明文不入库）。
// 复用 scripts/provision-store.mjs 同款 Admin API 方式（POST /auth/v1/admin/users）。
//
// 部署（一次性；CI 只部署静态站与迁移，不部署 Edge Function）：
//   supabase functions deploy create-staff
//   ⚠️ 需要 JWT 校验：仅登录的门店老板可调用，不要加 --no-verify-jwt。
//
// 运行时机密：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 平台默认注入，无需手动配置。
//
// 入参（POST JSON，Authorization: Bearer <老板 JWT>）：
//   { store_id, email, name, role_id }   role_id ∈ { 收银员, 店长 }
// 出参：
//   成功 { ok:true, user_id, email, password, role_name }
//   业务失败 { ok:false, code, message }（HTTP 200，前端读 ok 字段）

// deno-lint-ignore-file no-explicit-any
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const ROLE_CASHIER = '00000000-0000-0000-0000-000000000004';
const ROLE_MANAGER = '00000000-0000-0000-0000-000000000003';
const ASSIGNABLE = new Set([ROLE_CASHIER, ROLE_MANAGER]);

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
}

function svcHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// 生成可读、够强的初始密码（含大小写 + 数字，末尾符号；去除易混字符）。
function genPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const all = upper + lower + digit;
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let out = upper[buf[0] % upper.length] + lower[buf[1] % lower.length] + digit[buf[2] % digit.length];
  for (let i = 3; i < buf.length; i++) out += all[buf[i] % all.length];
  return out + '!';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, code: 'method_not_allowed', message: '仅支持 POST' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, code: 'server_misconfigured', message: '服务未配置 service_role，请联系管理员' }, 500);
  }

  try {
    // 1) 校验调用者身份（老板 JWT）
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!jwt) return json({ ok: false, code: 'unauthorized', message: '未登录' }, 401);
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return json({ ok: false, code: 'unauthorized', message: '登录已过期，请重新登录' }, 401);
    const caller = await userRes.json();
    const callerId: string | undefined = caller?.id;
    if (!callerId) return json({ ok: false, code: 'unauthorized', message: '无法识别当前用户' }, 401);

    // 2) 参数校验
    const body = await req.json().catch(() => ({} as any));
    const store_id = String(body.store_id ?? '').trim();
    const email = String(body.email ?? '').toLowerCase().trim();
    const name = String(body.name ?? '').trim();
    const role_id = String(body.role_id ?? '').trim();
    if (!store_id) return json({ ok: false, code: 'bad_request', message: '缺少门店' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, code: 'bad_email', message: '请填写有效邮箱' });
    if (!name) return json({ ok: false, code: 'bad_name', message: '请填写姓名' });
    if (!ASSIGNABLE.has(role_id)) return json({ ok: false, code: 'bad_role', message: '只能分配「收银员」或「店长」角色' });

    // 3) 校验调用者是该门店 owner
    const ownRes = await fetch(
      `${SUPABASE_URL}/rest/v1/store_owner?select=store_id&store_id=eq.${encodeURIComponent(store_id)}&user_id=eq.${encodeURIComponent(callerId)}`,
      { headers: svcHeaders() },
    );
    const owns = ownRes.ok ? await ownRes.json() : [];
    if (!Array.isArray(owns) || owns.length === 0) {
      return json({ ok: false, code: 'not_store_owner', message: '仅门店老板可添加员工' });
    }

    // 4) 生成初始密码 + 幂等创建 Auth 账号
    const password = genPassword();
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: svcHeaders(),
      body: JSON.stringify({
        email, password, email_confirm: true,
        app_metadata: { role: 'staff' }, user_metadata: { role: 'staff', name },
      }),
    });
    let userId: string | undefined;
    if (createRes.ok) {
      const created = await createRes.json();
      userId = created?.id ?? created?.user?.id;
    } else {
      const t = await createRes.text();
      if (/exist|registered|already/i.test(t) || createRes.status === 422) {
        return json({ ok: false, code: 'email_exists', message: '该邮箱已被注册，无法重复创建。若该员工已有账号，请核对后再试。' });
      }
      return json({ ok: false, code: 'create_failed', message: `创建账号失败：${t.slice(0, 200)}` });
    }
    if (!userId) return json({ ok: false, code: 'create_failed', message: '账号创建未返回用户 ID' });

    // 5) 取角色名 + 绑定 staff（service_role，幂等 upsert on user_id）
    const roleRes = await fetch(
      `${SUPABASE_URL}/rest/v1/role?select=name&id=eq.${encodeURIComponent(role_id)}`, { headers: svcHeaders() },
    );
    const roleRows = roleRes.ok ? await roleRes.json() : [];
    const roleName: string = roleRows?.[0]?.name ?? 'cashier';

    const staffRes = await fetch(`${SUPABASE_URL}/rest/v1/staff?on_conflict=user_id`, {
      method: 'POST',
      headers: { ...svcHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ user_id: userId, store_id, name, role_id, role: roleName }),
    });
    if (!staffRes.ok) {
      const t = await staffRes.text();
      return json({ ok: false, code: 'bind_failed', message: `账号已创建但绑定门店失败：${t.slice(0, 200)}` });
    }

    return json({ ok: true, user_id: userId, email, password, role_name: roleName });
  } catch (e: any) {
    return json({ ok: false, code: 'exception', message: String(e?.message ?? e) }, 500);
  }
});
