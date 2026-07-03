#!/usr/bin/env node
// ============================================================
// WX-19 运营开店脚本(幂等)—— 点1 的推荐运营入口
//
// 用 service_role 一次开出「门店 + 老板账号 + 归属关联」。
//   1) 经 Supabase Auth Admin API 幂等创建/复用老板用户(role=owner) —— 官方接口,最稳
//   2) 调 SQL 函数 provision_store(...) 幂等建 store + store_owner
//
// 依赖:仅 Node 18+ 内置 fetch,无需 npm install。
//
// 用法:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
//   node scripts/provision-store.mjs \
//     --name "望京旗舰店" --email owner@example.com --password 'S3cret!pw' \
//     [--industry restaurant]
//
// 幂等:相同 (email, name) 重复执行不会重复建店/重复绑定;重复时打印 status=already_exists。
// 前置:先在目标 Supabase 上应用 supabase/migrations/0010_store_provisioning.sql。
// ============================================================

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  const name = args.name;
  const email = (args.email || '').toLowerCase().trim();
  const password = args.password;
  const industry = args.industry || 'restaurant';

  const missing = [];
  if (!SUPABASE_URL) missing.push('env SUPABASE_URL');
  if (!SERVICE_KEY) missing.push('env SUPABASE_SERVICE_ROLE_KEY');
  if (!name) missing.push('--name');
  if (!email) missing.push('--email');
  if (!password) missing.push('--password');
  if (missing.length) {
    console.error('缺少必填项: ' + missing.join(', '));
    console.error(
      "示例: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-store.mjs --name '望京旗舰店' --email owner@example.com --password 'S3cret!pw'"
    );
    process.exit(1);
  }

  const base = SUPABASE_URL.replace(/\/$/, '');
  const authHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ---- 1) 幂等创建/复用老板 Auth 用户(role=owner) ----
  let ownerCreated = false;
  const createRes = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'owner' },
      user_metadata: { role: 'owner' },
    }),
  });

  if (createRes.ok) {
    ownerCreated = true;
    console.log(`auth 用户已创建: ${email}`);
  } else {
    const body = await createRes.text();
    // 已存在 → 幂等复用(GoTrue 对重复 email 返回 422/400 email_exists)
    if (/exist|registered|already/i.test(body) || createRes.status === 422) {
      console.log(`auth 用户已存在,复用: ${email}`);
    } else {
      console.error(`创建 auth 用户失败 (HTTP ${createRes.status}): ${body}`);
      process.exit(1);
    }
  }

  // ---- 2) 幂等建 store + store_owner(经 SQL 函数,归属/判重在服务端) ----
  const rpcRes = await fetch(`${base}/rest/v1/rpc/provision_store`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      p_store_name: name,
      p_owner_email: email,
      p_owner_password: password,
      p_industry_type: industry,
    }),
  });

  const rpcText = await rpcRes.text();
  if (!rpcRes.ok) {
    console.error(`provision_store 调用失败 (HTTP ${rpcRes.status}): ${rpcText}`);
    console.error(
      '若报 function ... does not exist,请先在目标 Supabase 应用 0010_store_provisioning.sql。'
    );
    process.exit(1);
  }

  let result;
  try {
    result = JSON.parse(rpcText);
  } catch {
    result = rpcText;
  }

  console.log('---- 开店结果 ----');
  console.log(JSON.stringify({ owner_created_via_api: ownerCreated, ...result }, null, 2));
  if (result && result.status === 'already_exists') {
    console.log(`门店已存在(幂等跳过): ${result.store_name} (${result.store_id})`);
  } else if (result && result.status === 'created') {
    console.log(`门店已开通: ${result.store_name} (${result.store_id}),老板 ${email}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
