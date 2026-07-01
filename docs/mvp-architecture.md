# 全行业扫码点单 MVP — 业务与架构方案

> 本文是 `001` 分支的 MVP 规划基线。目标：把原「美菜 B2B2C 闭环 Demo」裁剪、去餐饮化，
> 落地成一个**能真机跑起来、数据动态联动**的最小可用系统。
> 定位：**扫码下单 + POS 收银/履约**两端闭环，后端用 Supabase，先跑餐饮，架构面向全行业。

---

## 一、范围裁剪（相对原 Demo）

| 保留 | 砍掉（本期不做） |
|---|---|
| ✅ 用户小程序：扫码绑点位 → 浏览 → 下单 → mock 支付 → 看状态 | ❌ admin 平台后台 |
| ✅ POS（SPA）：接单 → 履约 → 完成 + 小票打印 | ❌ supplier 供应商端 |
| ✅ 共享后端 + 实时（Supabase，新增） | ❌ 美菜采购 / 询价竞价 |
| ✅ 商品/分类、订单、点位三张核心数据 | ❌ 库存 BOM 扣减（改为「沽清开关」） |
| ✅ 沽清开关（手动售罄） | ❌ 会员/营销、权限、日结、独立 KDS 屏 |

原 `admin/`、`supplier/`、`user/`、旧 `pos/*.html` **保留在仓库不删**，只是本期不接后端。

---

## 二、重新梳理后的业务闭环

去掉 KDS、库存、采购、供应商后，角色收敛为 **2 个**：**顾客（小程序）** 与 **门店员工（POS）**。
**后厨是只读环境（厨师油手不碰屏）**，靠自动打印的**后厨单**承载，系统状态由前台推进。

```
顾客(小程序)                         门店(POS SPA)
   │ ① 扫点位码 → 解析门店+点位
   │ ② 浏览商品 → 加购 → 提交            
   │ ③ mock 支付 ───────────────▶ ④ Realtime 弹出新单
   │                                   │  自动打印【后厨单+顾客联】
   │                                   │  (打印成功 = 自动受理)
   │                                   │ ⑤ 后厨看纸做菜(零操作)
   │                                   │ ⑥ 前台点「完成」
   ◀────────── ⑦ 轮询状态回传 ──────────┘
   │ 看进度 / 已完成
```

### 订单状态机（行业中性）

```
created ──支付──▶ paid ──打印成功──▶ processing ──前台点完成──▶ completed
                   │                                              
                   └────────────────── cancelled ────────────────
```

| 状态 | 触发 | 小程序文案(餐饮) |
|---|---|---|
| `created` | 顾客提交订单 | 待支付 |
| `paid` | mock 支付成功 | 已支付，已下单 |
| `processing` | 后厨单打印成功（自动） | 备餐中 |
| `completed` | 前台在 POS 点「完成」 | 已完成 |
| `cancelled` | 支付前取消 / 沽清拦截 | 已取消 |

> **唯一人工推进点 = 前台点「完成」**。接单（受理）由打印成功自动完成，后厨全程不操作系统。

---

## 三、全行业抽象（去餐饮化）

核心领域模型全部行业中性，用每个门店的一份 `terminology` 配置把词换回去，**不 fork 代码**。

| 抽象概念 | 餐饮 | 零售/自提 | KTV | 洗车/服务 | 诊所 |
|---|---|---|---|---|---|
| **ServicePoint 点位**（二维码绑的对象） | 桌台 | 自提柜 | 包厢 | 工位 | 诊室 |
| **Item 商品/服务项** | 菜品 | 货品 | 套餐 | 服务项目 | 项目 |
| **后厨单 / 履约联** | 后厨单 | 拣货单 | 出品通知 | 工单 | 处置单 |
| **顾客联** | 小票 | 取货凭证 | 消费凭证 | 服务单 | 收费凭证 |
| **沽清** | 沽清 | 缺货 | 售罄 | 今日约满 | 停诊 |
| **processing 文案** | 备餐中 | 拣货中 | 备台中 | 施工中 | 处置中 |

- 二维码编码 `{storeId, pointId}`；扫码解析出门店 + 点位，订单自动绑定点位。
- 每个门店带 `industry_type` + `terminology`(JSON) + 主题色，前端 label 由配置驱动。
- **餐饮 = 第一份行业模板**，加行业 = 加一条 seed 数据 + 一份术语表。

---

## 四、技术选型

```
微信小程序(Taro, 真机) ──REST(PostgREST)──▶ ┌───────────────┐
                       ◀── 轮询订单状态 ────  │  Supabase     │
                                              │  Postgres+RLS │
POS SPA(浏览器) ── supabase-js REST+Realtime ─│  Auth+Realtime│
                                              │  Edge Function │
                                              └───────────────┘
```

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | **Supabase**（Postgres + Auth + Realtime + 自动 REST + Edge Functions） | 免自建服务器，实时内建 |
| POS | **SPA**：Vite + React + TS + `supabase-js` | 浏览器原生 Realtime，秒级接单 |
| 小程序 | 现有 **Taro + React + Zustand**，services 层改调 Supabase REST | 真机跑 |
| 共享 | `packages/shared`：TS 类型 + 状态机 + 各行业 terminology + 小票模板 | 全栈复用 |
| 支付 | **mock**（点击即 `paid`），预留微信支付对接位 | — |
| 打印 | 见第六节 | — |

---

## 五、数据模型（MVP 表）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `store` | id, name, `industry_type`, `terminology`(jsonb), theme | 门店 = 租户 |
| `service_point` | id, store_id, code, name, status | 点位（桌/柜/包厢/工位…），二维码目标 |
| `category` | id, store_id, name, sort | 商品分类 |
| `item` | id, store_id, category_id, name, price, img, desc, **status**, sales | `status ∈ {on_sale, sold_out, off_shelf}` ← 沽清 |
| `order` | id, store_id, point_id, status, total, pay_method, customer_id, created_at, updated_at | 订单主表 |
| `order_item` | id, order_id, item_id, name_snapshot, price_snapshot, count, note | 下单快照（防止商品改价影响历史单） |

- **无库存/BOM 表**：售罄用 `item.status` 手动切换，非数量扣减。
- **RLS**：全表按 `store_id` 行级隔离，天然多门店多行业多租户。
- 顾客身份 `customer_id` = 匿名/openid；POS 员工 = 门店账号。

---

## 六、小票打印

**当前无硬件 → 方案 C（屏幕预览 + 浏览器打印），接口预留云打印。** 订单 `paid` 后自动出**两联**：

| 联 | 给谁 | 内容 | 触发 |
|---|---|---|---|
| **后厨单**（履约联） | 后厨 | 点位/桌号(大字)、订单号、时间、类型、**商品+数量+备注**，**不含价格** | `paid` 自动 |
| **顾客联**（小票） | 顾客/前台 | 门店名、订单号、点位、**商品+单价+数量+合计**、支付方式、时间 | `paid` 自动 |

- 两联做成 **58mm 小票 CSS 模板**，POS 内屏幕预览 + `window.print()`。
- `PrintService` 做成**可插拔**：
  - `BrowserPrintProvider`（方案 C，当前）— 浏览器打印/预览。
  - `WebUSBEscposProvider`（方案 B，预留）— USB/串口热敏机直连，Chrome WebUSB/Web Serial 发 ESC/POS。
  - `CloudPrinterProvider`（方案 A，预留）— 飞鹅云/易联云，触发放 Supabase **Edge Function**，POS 关着也能出单。
- POS 保留**一键重打**（两联可分别重打）。
- 多行业：后厨单↔拣货单/工单，顾客联↔取货凭证/服务单，按 `terminology` 换词。

---

## 七、沽清开关（替代库存）

不做数量库存，只给商品一个手动状态，POS 一键切换：

| `item.status` | 含义 | 小程序表现 |
|---|---|---|
| `on_sale` | 正常在售 | 可加购 |
| `sold_out` | 当天沽清/售罄 | **置灰 + 「已售罄」角标**，不可下单；可一键恢复 |
| `off_shelf` | 长期下架 | 不显示 |

- POS 商品列表每行一个「沽清」开关。
- 小程序进菜单/轮询拉最新状态，沽清置灰；购物车内已加的，**提交时后端校验拦截**，提示「XX 已售罄」。

---

## 八、实时方案与真机注意点

- **POS（浏览器）**：`supabase-js` 原生 Realtime，订阅本门店订单 → 实时接单/状态联动。✅ 无坑。
- **小程序 Realtime 坑**：`supabase-js` 的 Realtime 依赖浏览器 `WebSocket` 全局，微信小程序没有（只有 `Taro.connectSocket`）。
  → **MVP 用轮询**（Supabase REST 每 3~5s 拉一次，`orderSync.ts` 轮询骨架现成）；进阶再写 `Taro.connectSocket → WebSocket` 适配 shim。
- **域名/备案坑**：微信真机请求要求 HTTPS 域名进「request 合法域名」白名单。
  - **开发版真机调试**：开发者工具勾「不校验合法域名」，可直连 `*.supabase.co`，**MVP 阶段够用**。✅
  - **体验版/正式版**：需已 ICP 备案的自有域名，`*.supabase.co` 无法备案 → 到时在自有备案域名加一层反代/BFF 转发 Supabase。**（风险项，体验版前处理）**

---

## 九、代码结构（001 分支，改造为 monorepo）

```
apps/
  miniapp/     # 现有 Taro 应用；services 层改调 Supabase REST + 轮询
  pos/         # 【新增】POS SPA：Vite + React + TS + supabase-js
packages/
  shared/      # 【新增】类型 + 订单状态机 + 各行业 terminology + 小票模板
supabase/      # 【新增】migrations(建表SQL) + seed(餐饮门店) + RLS 策略 + Edge Functions(预留 print-order)
# 保留不动：旧 pos/*.html、admin/、supplier/、user/
```

---

## 十、落地阶段

| 阶段 | 内容 | 验收（能跑起来） |
|---|---|---|
| **P0 地基** | Supabase 表 + RLS + 餐饮 seed；monorepo 骨架；shared 类型/状态机/术语 | Supabase 里能看到餐饮门店/商品数据 |
| **P1 目录+扫码** | 小程序：扫码解析点位 + 拉 catalog 显示真数据 | 真机扫码 → 看到后端商品 |
| **P2 下单+支付** | 小程序：下单 + mock 支付 + 订单详情（轮询状态） | 真机下单成功，库里出现订单 |
| **P3 实时闭环** | POS SPA：门店登录 + Realtime 订单看板 + 状态推进（点完成）+ 沽清开关 | 小程序下单 POS 秒级弹单；改状态小程序看到 |
| **P3.5 小票** | 后厨单+顾客联模板 + `PrintService`(方案 C) + `paid` 自动触发 + 一键重打 | paid 后两联可预览/打印 |
| **P4 多行业** | terminology 配置 + 第二个行业 seed + label 切换 | 切非餐饮门店，同套 UI 全变词 |

---

## 十一、待补输入

| 项 | 用途 | 状态 |
|---|---|---|
| Supabase `Project URL` + `anon key` + `service_role key` | P0 建表/seed | 待提供 |
| 小程序 `AppID`（测试号亦可） | 真机 | 待提供 |
| 第二个演示行业（零售自提 / KTV / 洗车 / 诊所） | P4 seed | 待确认 |

---

## 十二、已定档决策

Supabase 后端 · POS 用 SPA · 全行业通用（餐饮先跑）· 微信小程序真机 · mock 支付 ·
后厨零操作靠小票 · 打印方案 C + 两联 · 沽清开关替代库存。
