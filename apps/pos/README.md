# 门店 POS (SPA)

Vite + React + TS + supabase-js。门店员工登录 → 实时订单看板 → 接单(打印)/完成/退款 → 沽清管理 → 清台 → 小票两联(浏览器打印)。

## 运行
1. `cp .env.example .env.local` 填 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`(anon key 可公开)。
2. 安装依赖:仓库根 `pnpm install`,或本目录 `pnpm install --ignore-workspace`。
3. `pnpm dev` → http://localhost:5173
4. 用门店员工账号登录(demo:`pos@chuanxiaozao.local` / `pos-demo-1234`,已绑定示例门店「川小灶·望京店」)。

## 说明
- 登录用 Supabase Auth;`current_staff_store()` 取员工所属门店;RLS 保证只读本店数据。
- 看板走 Realtime(orders 表变更即刷新);动作调用 security definer RPC(accept/complete/cancel/set_item_status/clear_table)。
- 小票模型来自 `@meicai/shared` 的 `buildTickets`,58mm 打印样式见 `styles.css` 的 `@media print`。
- 类型/构建:`pnpm exec tsc --noEmit`(0 error)、`pnpm build`(通过)。
