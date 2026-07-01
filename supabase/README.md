# Supabase 后端（P0）

即时下单业态 MVP 的数据层。对应设计见 [`../docs/mvp-architecture.md`](../docs/mvp-architecture.md)。

## 迁移文件（按序执行）

| 文件 | 内容 |
|---|---|
| `migrations/0001_core.sql` | 表结构 + 枚举 + 索引 + RLS（锁全表，仅开放 anon 只读 store/point/category/item）+ Realtime 发布 orders |
| `migrations/0002_rpc.sql` | RPC：顾客 `place_order`/`pay_order`/`query_order`/`list_my_orders`；门店 `accept_order`/`complete_order`/`cancel_order`/`set_item_status`/`clear_table`。全部 `security definer`，金额/单号服务端算，沽清服务端校验 |
| `migrations/0003_seed.sql` | 餐饮示例门店「川小灶·望京店」：6 桌 + 7 分类 + 15 菜（幂等，重跑即重置） |

## 应用方式（任选）

**A. Dashboard SQL Editor**：把三个文件内容依次粘贴运行。最省事、无需密钥。

**B. psql / 迁移脚本**（需数据库密码，走 IPv4 连接池 pooler；直连 `db.<ref>.supabase.co` 是 IPv6，很多环境不通）：
```
postgresql://postgres.<ref>:<db-password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```
> 本项目区域：**ap-northeast-1（东京）**，pooler 主机 `aws-1-ap-northeast-1.pooler.supabase.com:5432`（session 模式）。

## 安全约定

- **顾客端只用 anon key**，只能：读 store/point/category/item（非 off_shelf），以及调用 4 个顾客 RPC。
- 顾客**不能直接读写 `orders`/`order_item`**（RLS 已拒），全部经 `security definer` RPC；金额、`order_no`、`order_token` 一律服务端生成，杜绝抓包改价。
- 匿名查单凭服务端下发的 `order_token`（`query_order` 已从返回里剥离该字段）；微信侧用 openid 存 `customer_ref` 兜底换设备。
- `service_role` key、数据库密码 **只用于建表/seed，绝不进前端、绝不入库**。

## 已验证（P0 验收）

anon 读菜单/桌台 ✅；`place_order` 服务端算 total ✅；加菜识别 `is_addon/addon_seq` ✅；沽清 `item_unavailable` 拦截 ✅；anon 直读 `orders` 被 RLS 拒 ✅；`pay→accept→complete` 全流程 + `printed_at/completed_at` ✅；`clear_table` 释放点位 ✅。
