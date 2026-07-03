# 菜品管理后台 (admin SPA)

Vite + React + TS + supabase-js。门店**老板**登录 → 名下多门店切换 → 维护菜品(新增/编辑/上下架/沽清/排序)与分类(新增/改名/删除/排序)。图片按 MVP 仅填 URL 文本，暂不做上传。

## 权限模型
- `owner`(老板):经映射表 `store_owner(user_id, store_id)` 绑定名下门店;仅老板能进本后台管理菜品，可跨其名下多店。
- `clerk`(店员):仍走 POS(`current_staff_store()` 接单/沽清)，登录本后台会被拒绝(无门店可管)。
- **`item.status` 权限拆分**:沽清/恢复(`on_sale ⇄ sold_out`)老板端与 POS 店员端**都可**（`set_item_status`，已收窄为拒绝 `off_shelf`）；上架/下架(`off_shelf`)**仅老板端**（`set_item_shelf`）。
- 所有菜品/分类写入一律走 `security definer` RPC(`upsert_item`/`delete_item`/`set_item_shelf`/`reorder_items`/`upsert_category`/`delete_category`/`reorder_categories`)，RPC 内校验「目标 store ∈ 调用者名下门店」。绕过 UI 直连 RPC 也拿不到他店写权限。

对应后端迁移：`supabase/migrations/0009_menu_admin.sql`（须在 Supabase 应用，方式同其它迁移：Dashboard SQL Editor 或 pooler psql）。

## 运行
1. `cp .env.example .env.local` 填 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`(anon key 可公开)。
2. 安装依赖:仓库根 `pnpm install`，或本目录 `pnpm install --ignore-workspace`。
3. `pnpm dev` → http://localhost:5174
4. 用老板账号登录(demo:`owner@chuanxiaozao.local` / `owner-demo-1234`，绑定「川小灶·望京店」+「川小灶·三里屯店」两店)。

## 部署
仿 POS 接入自动部署链：`Dockerfile.admin` → nginx 静态服务 **:8082**；`docker-compose.yml` 新增 `admin` service；推送到 `001` 分支触发 `.github/workflows/deploy.yml`。QA 访问 `http://<test-host>:8082`。

## 类型/构建
`pnpm exec tsc --noEmit`(0 error)、`pnpm build`(通过)。
