# 即时下单业态通用 MVP — 业务与架构方案（v2，含专家评审修订）

> 本文是 `001` 分支的 MVP 规划基线。目标：把原「美菜 B2B2C 闭环 Demo」裁剪、去餐饮化，
> 落地成一个**能真机跑起来、数据动态联动**的最小可用系统。
> 定位：**扫码即时下单 + POS 收银/履约**两端闭环，后端用 Supabase，首发餐饮堂食，架构面向即时下单业态通用。
>
> **v2 变更**：经餐饮运营专家 + 全行业架构专家评审，修订了「打印驱动状态」的致命假设、下单安全边界、
> 翻台/加菜/退款等真实运营场景，并把「全行业通用」诚实收敛为「即时下单业态通用」。修订点见 [附录A]。

---

## 一、范围裁剪（相对原 Demo）

| 保留 | 砍掉（本期不做） |
|---|---|
| ✅ 用户小程序：扫码绑点位 → 浏览 → 下单 → mock 支付 → 看状态 | ❌ admin 平台后台 |
| ✅ POS（SPA）：**接单** → 履约 → 完成 + 小票打印 | ❌ supplier 供应商端 |
| ✅ 共享后端 + 实时（Supabase，新增） | ❌ 美菜采购 / 询价竞价 |
| ✅ 商品/分类、订单、点位、**桌次会话**四类核心数据 | ❌ 库存 BOM 扣减（改为「沽清开关」） |
| ✅ 沽清开关、支付后退款、加菜、清台 | ❌ 会员/营销、权限、日结、独立 KDS 屏 |

原 `admin/`、`supplier/`、`user/`、旧 `pos/*.html` **保留在仓库不删**，本期不接后端。

---

## 二、业务闭环（v2，含前台接单闸）

角色 2 个：**顾客（小程序）** 与 **门店员工（POS）**。**后厨是只读环境（厨师油手不碰屏）**，靠自动打印的**后厨单**承载。
关键修订：**取消「支付成功自动打印进备餐」的假设**，改为**前台在 POS 点「接单」**这一真人闸——它同时兜底了打印失败、挡住了幽灵刷单。

```
顾客(小程序)                          门店(POS SPA)
   │ ① 扫点位码 → 解析门店+点位(开/接桌次会话)
   │ ② 浏览商品 → 加购 → 提交(走服务端下单 RPC)
   │ ③ mock 支付 ───────────────▶ ④ Realtime 弹入【待接单队列】(paid)
   │                                   │ ⑤ 前台点「接单」→ 打印(后厨单+顾客联)
   │                                   │    (打印是副作用；失败可一键重打)
   │                                   │ ⑥ 后厨看纸做菜(零操作)
   │                                   │ ⑦ 前台点「完成」
   ◀────────── ⑧ 轮询状态回传 ──────────┘
   │ 看进度 / 已完成
异常：⑤前/后 前台可「取消/退款」整单或单项 → refunded
翻台：前台「清台」→ 关闭该点位会话，下一拨扫码开新会话
```

### 订单状态机（v2）

```
                    ┌──────────── 支付前取消 / created 超时未付 ──────────┐
                    ▼                                                     │
  created ──支付──▶ paid ──前台接单(打印)──▶ processing ──前台点完成──▶ completed
                    │                          │
                    └──前台取消/退款──▶ refunded ◀──前台作废(二次确认)
```

| 状态 | 触发 | 小程序文案(餐饮) |
|---|---|---|
| `created` | 顾客提交订单（未付） | 待支付 |
| `paid` | mock 支付成功 → 进 POS 待接单队列 | 已支付，等待商家接单 |
| `processing` | **前台点「接单」**（同时打印后厨单+顾客联） | 备餐中 |
| `completed` | 前台在 POS 点「完成」 | 已完成 |
| `cancelled` | 支付前取消 / `created` 超时未付（自动） | 已取消 |
| `refunded` | 付款后前台取消整单/单项（退款走线下） | 已退款，请到前台处理 |

> 人工推进点 = **前台点「接单」+ 点「完成」**。后厨全程不操作系统。
> 状态流转均用**条件更新**（`update ... where id=? and status=?`），受影响 0 行即他人已处理，避免重复打印/重复完成。

---

## 三、即时下单业态抽象（诚实版）

核心模型行业中性，用每个门店的一份 `terminology` 配置换词，**不 fork 代码**。
**但 `terminology` 只解决「叫什么」，解决不了「怎么计时、要不要预约排队」——这是模型的真实边界，见第十一节。**

| 抽象概念 | 餐饮 | 零售/自提 | 计次服务 |
|---|---|---|---|
| **ServicePoint 点位**（二维码绑的对象） | 桌台 | 自提柜 | 工位 |
| **DiningSession 服务会话** | 一桌就餐 | 一次取货 | 一次服务 |
| **Item 商品/服务项** | 菜品 | 货品 | 服务项 |
| **后厨单 / 履约联** | 后厨单 | 拣货单 | 工单 |
| **顾客联** | 小票 | 取货凭证 | 服务单 |
| **沽清** | 沽清 | 缺货 | 售罄 |

- 二维码编码 `{storeId, pointId, pointSecret}`（`pointSecret` 可 POS 一键轮换，被滥用即失效）。
- 每个门店带 `industry_type` + `terminology`(JSON) + 主题色；**代码内置 fallback 默认词典**，缺 key 不渲染 `undefined`。

---

## 四、技术选型

```
微信小程序(Taro, 真机) ──下单/查单 RPC + 轮询状态──▶ ┌───────────────┐
                                                     │  Supabase     │
                                                     │  Postgres+RLS │
POS SPA(浏览器) ── supabase-js REST + Realtime ──────│  RPC/Edge Fn  │
                                                     │  Realtime     │
                                                     └───────────────┘
```

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | **Supabase**（Postgres + RLS + Realtime + Edge Functions + RPC） | 免自建服务器 |
| POS | **SPA**：Vite + React + TS + `supabase-js` | 浏览器原生 Realtime，秒级接单 |
| 小程序 | 现有 **Taro + React + Zustand**，services 层改调 Supabase | 真机跑 |
| 共享 | `packages/shared`：TS 类型 + 状态机 + terminology(+默认词典) + 小票模板 | 全栈复用 |
| 支付 | **mock**（点击即 `paid`），预留微信支付对接位 | — |
| 打印 | 见第六节 | — |

---

## 五、数据模型（v2）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `store` | id, name, `industry_type`, `terminology`(jsonb), theme | 门店 = 租户 |
| `service_point` | id, store_id, code, name, **point_secret**, **current_session_id**(nullable), status | 点位；`current_session_id` 表达占用 |
| `dining_session` | id, store_id, point_id, opened_at, closed_at, status | **桌次会话**：翻台/加菜/多人同桌归并的锚点 |
| `category` | id, store_id, name, sort | 分类 |
| `item` | id, store_id, category_id, name, price, unit, img, desc, **status**, sales | `status ∈ {on_sale, sold_out, off_shelf}` ← 沽清 |
| `order` | id, store_id, point_id, **session_id**, **order_no**, status, total, pay_method, customer_ref, **created_at, paid_at, printed_at, completed_at** | 订单主表 |
| `order_item` | id, order_id, item_id, name_snapshot, price_snapshot, **qty**, note | 下单快照，防改价影响历史 |

要点（相对 v1 的修订）：
- 新增 **`order_no`**（门店内当日自增流水号，如 `A023`，建单 RPC 生成）—— 后厨/前台靠它对单，不能用 UUID 喊单。
- 新增**时间戳** `created_at/paid_at/printed_at/completed_at` —— 超时清理、等待时长、幂等打印都依赖它。
- 新增 **`dining_session`** + `service_point.current_session_id` —— 翻台/加菜/多人同桌的归并锚点。
- `order.printed_at` 做**打印幂等**：打印 RPC `where id=? and printed_at is null` 抢占，抢到才真打，避免重连/多 POS 重复打印。
- `order_item.count → qty`（避开 SQL 保留字）。
- `item` 增 `unit`（单位/规格，零售/计量场景需要）。
- **无库存/BOM 表**：售罄用 `item.status` 手动切。

---

## 六、小票打印

**当前无硬件 → 方案 C（屏幕预览 + 浏览器打印）**，接口预留云打印。**打印是「接单」动作的副作用，不进入状态机的转移条件**（浏览器打印无回执，见 [附录A]）。前台点「接单」时出**两联**：

| 联 | 给谁 | 内容 | 备注 |
|---|---|---|---|
| **后厨单**（履约联） | 后厨 | **流水号(大字)**、点位/桌号、时间、类型、**商品+数量+备注**，**不含价格**；**加菜单醒目标注「⚠️加菜·第N单」** | 无价 |
| **顾客联**（小票） | 顾客/前台 | 门店名、流水号、点位、**商品+单价+数量+合计**、支付方式、时间 | 含价 |

- 两联 **58mm 小票 CSS 模板**，POS 内屏幕预览 + `window.print()`。
- `PrintService` **可插拔**：`BrowserPrintProvider`（当前）/ `WebUSBEscposProvider`（预留）/ `CloudPrinterProvider`（飞鹅云·Edge Function·带 `order_no` 幂等，预留）。
- **必备「重打后厨单/重打顾客联」按钮**（processing/completed 也能重打），纸丢/打花能补。
- 多行业按 `terminology` 换词。

---

## 七、沽清开关（替代库存）

| `item.status` | 含义 | 小程序表现 |
|---|---|---|
| `on_sale` | 正常在售 | 可加购 |
| `sold_out` | 当天沽清/售罄 | 置灰 + 「已售罄」角标，可一键恢复 |
| `off_shelf` | 长期下架 | 不显示 |

- POS 商品列表每行「沽清」开关。
- **权威校验在服务端下单 RPC**：小程序轮询有 3-5s 延迟，置灰永远慢半拍，故 `sold_out`/`off_shelf` 的最终拦截**必须在 RPC 内实时判断**，命中即拒绝该行并提示「XX 已售罄」。

---

## 八、下单与安全（v2 新增，MVP 安全底座）

- **下单走服务端 RPC / Edge Function（`security definer`）**，顾客端**只传 `item_id + qty + note`**；`price_snapshot / name_snapshot / total / order_no / sales` **一律服务端算**，杜绝抓包改价。
- RLS：**关闭顾客对 `order/order_item` 的直接 INSERT**，只允许经 RPC 建单；`item` 仅可读**本店 `on_sale`**；跨店一律拒。
- **匿名订单归属**：建单 RPC 返回服务端生成的高熵 **`order_token`**，小程序本地保存、凭 token 查单（查单也走 RPC，不开放 `order` 表匿名 SELECT）。微信侧优先用 **openid** 兜底存 `order.customer_ref`，换设备可凭 openid 拉回。
- `anon` key 暴露在小程序端属正常，安全性由 **RLS + RPC 白名单** 保证，不靠隐藏 key。

---

## 九、实时方案与真机注意点

- **POS（浏览器）**：`supabase-js` 原生 Realtime，订阅本门店订单 → 实时接单/状态联动。✅
- **小程序 Realtime 坑**：weapp 无 `WebSocket` 全局，`supabase-js` Realtime 不可用 → **MVP 用轮询**（REST 每 3~5s，`orderSync.ts` 骨架现成）；进阶再写 `Taro.connectSocket → WebSocket` 适配 shim。
- **域名/备案坑**：微信真机 request 合法域名白名单。开发版真机可勾「不校验合法域名」直连 `*.supabase.co`（MVP 够用 ✅）；**体验版/正式版**需自有 ICP 备案域名反代 Supabase（`*.supabase.co` 无法备案）。**风险项，体验版前处理。**

---

## 十、代码结构（001 分支，改造为 monorepo）

```
apps/
  miniapp/     # 现有 Taro 应用；services 改调 Supabase 下单/查单 RPC + 轮询
  pos/         # 【新增】POS SPA：Vite + React + TS + supabase-js（待接单队列/看板/沽清/重打/清台）
packages/
  shared/      # 【新增】类型 + 状态机 + terminology(+默认词典) + 小票模板
supabase/      # 【新增】migrations(建表+RLS) + seed(餐饮门店) + RPC(place_order/query_order/print_claim) + Edge Functions(预留 print-order)
# 保留不动：旧 pos/*.html、admin/、supplier/、user/
```

---

## 十一、多行业适配性（诚实结论）

**本模型真实边界 = 「即时制、下单即履约、无时长、无预约」的业态。**

| 行业 | 适配 | 说明 |
|---|---|---|
| 餐饮堂食 | ✅ 原生贴合 | 为它设计 |
| 零售自提 | ✅ 基本贴合 | 缺 SKU 细节，MVP 可忍 |
| 计次型服务（洗车基础项等） | 🟡 半贴合 | 缺排队/工位调度 |
| 餐饮外带/外卖 | 🟡 半贴合 | 无桌位，需取餐号 |
| **KTV** | ❌ 结构不匹配 | 核心是**按时计费**，缺「时长+计时」结构 |
| **诊所/美容** | ❌ 结构不匹配 | 核心是**预约挂号+叫号**，换词换不出来 |

> **对外定位收敛为「即时下单业态通用，首发餐饮」。** KTV（计时）/ 诊所（预约）属 **Phase 2 需新增领域模型**（时长计费、预约号源/叫号队列），不在当前架构承诺范围，避免销售误承诺、交付翻车。

---

## 十二、落地阶段（v2）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 地基** | Supabase 表(含 session/时间戳/order_no) + RLS + **下单/查单 RPC** + 餐饮 seed；monorepo；shared | seed 数据入库；RPC 建单金额服务端算通过 |
| **P1 目录+扫码** | 小程序扫码解析点位(开/接会话) + 拉 catalog | 真机扫码 → 看到后端商品 |
| **P2 下单+支付** | 小程序下单(RPC) + mock 支付 + 订单详情(轮询) + 沽清拦截 | 真机下单成功，库里出现订单 |
| **P3 实时闭环** | POS SPA：门店登录 + **待接单队列 + 接单 + 完成 + 看板按桌聚合 + 清台 + 沽清开关 + 支付后取消/退款 + 条件更新防重** | 下单 POS 秒级弹单；接单/完成/退款/翻台全通 |
| **P3.5 小票** | 后厨单+顾客联模板 + `PrintService`(C) + **接单时打印(副作用) + 重打 + 流水号 + printed_at 幂等 + 加菜标注** | 接单后两联可预览/打印、可重打 |
| **P4 多行业** | terminology + 默认词典 + 第二个（即时制）行业 seed + label 切换 | 切零售自提门店，UI 全变词 |

---

## 十三、待补输入

| 项 | 用途 | 状态 |
|---|---|---|
| Supabase `Project URL` + `anon key` + `service_role key` | P0 建表/RPC/seed | 待提供 |
| 小程序 `AppID`（测试号亦可） | 真机 | 待提供 |
| 第二个演示行业（**建议即时制**：零售自提 / 计次服务） | P4 seed | 待确认 |

---

## 十四、已知风险清单

- 静态桌码可异地盗用/刷单 → `point_secret` 可轮换；前台「接单」真人闸兜底；接真支付前评估地理围栏。
- 匿名订单换设备/清缓存丢失 → openid 兜底，token 为降级方案。
- 浏览器打印无回执 → 打印不进状态机，靠前台确认 + 重打。
- 沽清为手动开关、非库存扣减 → 同秒并发最后一份可能双下单（MVP 可接受），RPC 做过期拦截。
- 体验版域名备案 → 见第九节。

---

## 附录A：v2 相对 v1 的关键修订（评审采纳项）

1. **打印不再驱动状态**：v1「打印成功→processing」在浏览器打印下无回执、无打印机时全线卡死 → 改为**前台「接单」转 processing，打印为副作用 + 重打**。
2. **前台「接单」真人闸**：一举兜底打印失败 + 挡住 mock 支付下的幽灵刷单。
3. **下单安全底座**：下单走服务端 RPC，金额服务端算；`order_token`/openid 解匿名 RLS 死结；关闭顾客直插订单表。
4. **真实运营场景补齐**：桌次会话（翻台）、加菜（后厨单标注 + 看板按桌聚合）、多人同桌（同上聚合）、清台动作。
5. **退款/异常出口**：新增 `refunded`，支付后可取消整单/单项；`created` 超时自动 `cancelled`。
6. **数据模型补全**：`order_no`、时间戳、`printed_at` 幂等、`session_id`、`qty`、`item.unit`。
7. **沽清权威校验移到服务端 RPC**；状态流转用**条件更新**防重复。
8. **定位收敛**：「全行业通用」→「即时下单业态通用，首发餐饮」；KTV/诊所归 Phase 2。

---

## 十五、已定档决策

Supabase 后端 · POS 用 SPA · 即时下单业态通用（餐饮先跑）· 微信小程序真机 · mock 支付 ·
后厨零操作靠小票 · 打印方案 C + 两联（接单副作用 + 重打）· 沽清开关替代库存 ·
前台接单/完成双闸 · 服务端 RPC 下单 · 桌次会话 · 支付后可退款。
