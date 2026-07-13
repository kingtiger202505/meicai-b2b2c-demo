# 平台管理端 (platform SPA)

Vite + React + TS + supabase-js。**平台超管(boss)** 登录 → 商户进件审核(sub_mchid 管理)+ 全局商户列表。v4 阶段 2。

## 权限模型
- `boss`(平台超管)：`auth.users.raw_app_meta_data.role = 'boss'`。仅 boss 可登录本端。
- 登录后客户端校验 `session.user.app_metadata.role === 'boss'`，非 boss 账号拒绝进入。
- demo 账号：`platform@chuanxiaozao.local` / `platform-demo-1234`（实际账号需在 Supabase Auth 创建，并设置 `raw_app_meta_data = {"role":"boss"}`）。

## service_role key
平台管理端调 `approve_merchant_application` 与直查 `wxpay_merchant`/`store` 表需要 service_role key（该 RPC 与表仅授 service_role / owner，平台超管需跨店读写）。

方案：独立环境变量 `VITE_SUPABASE_SERVICE_ROLE_KEY`，仅部署在内部环境，不对外。在 `supabase.ts` 里根据 `VITE_PLATFORM_MODE=1` 决定用 service_role client 还是 anon client：
- `VITE_PLATFORM_MODE=1` 且配了 service_role key → `platformClient` 用 service_role（绕过 RLS，可跨店读写）
- 否则 → `platformClient` 回退到 anon client（受 RLS 限制，只能查当前用户名下门店，平台功能受限）

**安全提示**：service_role key 可绕过所有 RLS，仅部署在受控的内部环境，绝不打包进对外发布的前端。

## 功能（2 个 tab）
1. **商户进件管理**：列表展示所有商户进件状态（`wxpay_merchant` join `store`），按状态筛选。pending/submitted/rejected 可点「审批通过」→ 弹窗输入 sub_mchid（测试可填 mock）→ 调 `approve_merchant_application`。
2. **商户列表**：列表展示所有门店（`store` join `store_owner` + `wxpay_merchant`）。字段：门店名、行业、老板 user_id、创建时间、进件状态。

## 后端 RPC（已就绪）
- `approve_merchant_application(p_store_id, p_sub_mchid, p_raw_response)` — 平台审批（仅 service_role）
- 直查 `wxpay_merchant` / `store` / `store_owner` 表（service_role 绕过 RLS）

对应后端迁移：`supabase/migrations/0015_wxpay_merchant_and_fixes.sql`、`0016_marketing_rbac_cashier_table_shift.sql`。

## 运行
1. `cp .env.example .env.local` 填：
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（anon key 可公开）
   - `VITE_SUPABASE_SERVICE_ROLE_KEY`（service_role key，仅内部环境）
   - `VITE_PLATFORM_MODE=1`（启用 service_role 模式）
2. 安装依赖：仓库根 `pnpm install`。
3. `pnpm dev` → http://localhost:8083
4. 用平台超管账号登录。

## 部署
仿 admin 接入自动部署链：新增 `Dockerfile.platform` → nginx 静态服务 **:8083**；`docker-compose.yml` 新增 `platform` service。**仅部署在内部环境**（因含 service_role key）。

## 类型/构建
`pnpm exec tsc --noEmit`（0 error）、`pnpm build`（通过）。
