# Supabase 后端（v4）

餐饮私域 SaaS 的数据层。对应设计见 [`../docs/mvp-architecture.md`](../docs/mvp-architecture.md) 与 [`../docs/roadmap-v4.md`](../docs/roadmap-v4.md)。

## 迁移文件（按序执行）

| 文件 | 内容 |
|---|---|
| `migrations/0001_core.sql` | 表结构 + 枚举 + 索引 + RLS（锁全表，仅开放 anon 只读 store/point/category/item）+ Realtime 发布 orders |
| `migrations/0002_rpc.sql` | RPC：顾客 `place_order`/`pay_order`/`query_order`/`list_my_orders`；门店 `accept_order`/`complete_order`/`cancel_order`/`set_item_status`/`clear_table`。全部 `security definer`，金额/单号服务端算，沽清服务端校验 |
| `migrations/0003_seed.sql` | 餐饮示例门店「川小灶·望京店」：6 桌 + 7 分类 + 15 菜（幂等，重跑即重置） |
| `migrations/0004_member_stored_value.sql` | 会员/储值/券三表 + RLS（锁全表，仅经 RPC 读写）；`orders` 加 `member_id` |
| `migrations/0005_member_rpc.sql` | 会员/储值 RPC：`get_or_create_member`/`get_member`/`topup_member`(幂等)/`pay_with_balance`(原子扣减)/`issue_coupon` |
| `migrations/0006_pay_by_id.sql` | `pay_order_by_id`（微信支付回调按订单ID置 paid，幂等，仅 service_role） |
| `migrations/0007_mock_pay.sql` | `mock_pay_order`（一步支付+建会员，sandbox 联调用） |
| `migrations/0008_staff_auth.sql` | staff 表 + `current_staff_store()` + 门店 RLS |
| `migrations/0009_menu_admin.sql` | 老板菜品/分类管理 RPC + 第二家店 seed + owner demo 账号 |
| `migrations/0010_ticket_reprint.sql` | `accept_order` 返回 `first_print` + `reprint_order` 审计 |
| `migrations/0011_store_provisioning.sql` | `provision_store`(运营开店) + `create_store`(老板加分店) |
| `migrations/0012_mock_topup.sql` | `mock_topup_member`(sandbox 充值,每满 100 送 20) |
| `migrations/0013_daily_stats_rpc.sql` | `daily_stats` + `daily_trend`(营业统计) |
| `migrations/0014_printer_config.sql` | `printer_config` 表 + 四类 Provider 配置/测试 RPC |
| `migrations/0015_wxpay_merchant_and_fixes.sql` | **v4** `wxpay_merchant` 表(服务商进件) + 修复 D1(退款回滚余额) + D2(`list_order_status` 顾客轮询) + D3(POS 跨店校验) + `refund_order_by_id` |

## Edge Functions（微信支付服务商模式）

| 目录 | 作用 | 模式 |
|---|---|---|
| `functions/wxpay-create` | JSAPI 统一下单(服务商模式,sp_mchid+sub_mchid) | sandbox: 返回占位 paySign;live: v3 签名 |
| `functions/wxpay-notify` | 支付结果回调 | sandbox: mock 支付直走下游;live: 验签+解密 |
| `functions/wxpay-refund` | **v4 新增** 退款 | sandbox: 库内回滚;live: 调微信退款 API |
| `functions/wx-login` | **v4 新增** code 换 openid + 手机号解密 | sandbox: dev 伪 openid;live: 真 openid+手机号 |

> 部署：
> ```
> supabase functions deploy wxpay-create
> supabase functions deploy wxpay-notify --no-verify-jwt
> supabase functions deploy wxpay-refund --no-verify-jwt
> supabase functions deploy wx-login --no-verify-jwt
> ```
> 机密放 **Supabase Function Secrets**(绝不进前端/入库)：
> - `WXPAY_MODE=sandbox|live` — 资质到位前 sandbox,到位后切 live
> - `WXPAY_SP_MCHID` / `WXPAY_APIV3_KEY` / `WXPAY_SP_CERT_SERIAL` / `WXPAY_SP_PRIVATE_KEY` — 服务商商户号 + 证书
> - `WX_APPID` — 小程序 AppID
> - `WX_APPSECRET` — 小程序 AppSecret(wx-login 用)
> - `WX_LOGIN_MODE=sandbox|live` — openid/手机号解密模式
> - `NOTIFY_URL=https://<icp域名>/wxpay-notify` — 微信回调地址(需 ICP 备案)
>
> **资质到位后只需**: 填 secrets + 实现 v3 签名 + 平台证书验签 + 切 `WXPAY_MODE=live`

## 应用方式（任选）

**A. Dashboard SQL Editor**：把迁移文件依次粘贴运行。最省事、无需密钥。

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
