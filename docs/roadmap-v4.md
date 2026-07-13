# 餐饮私域 SaaS — 商业化试点路线图(v4)

> 本文档是 v4 执行基线,基于 v3(mvp-architecture.md)演进。
> **v4 核心变更**:① 微信支付从"规划"落地为**服务商模式架构 + mock 占位**,资质到位后替换签名即可;② 新增**自动运营引擎**(支付成功→会员→券);③ 新增**平台管理端**(商户进件);④ 新增 **RBAC 权限系统**;⑤ POS 补**完整收银台**;⑥ 桌台升级四态;⑦ 多人**协同点餐**。
> **资质策略**:微信支付服务商资质 + ICP 备案域名并行申请,代码侧用 mock 占位,保证资质到位后替换简单。

---

## 一、决策定档

| 决策项 | 选择 | 架构影响 |
|---|---|---|
| 微信支付模式 | **服务商模式** | Edge Function 走 `/v3/pay/partner/transactions/jsapi`,需 `sp_mchid` + `sub_mchid`;平台靠分润赚钱 |
| 商户进件归属 | **平台管理端** | 新增"平台超管"角色 + 进件审核流程 + `wxpay_merchant` 表 |
| 协同点餐 | **共享购物车 + 并单** | 购物车从"设备级"升级到"会话级",同桌多人共享,任何人可结账 |
| 收银台 | **完整收银台** | `orders` 表扩展收银字段;POS 加收银模块(现金/微信/余额/组合 + 找零抹零 + 交接班) |
| 资质策略 | **并行申请 + mock 占位** | 支付链路用 mock 跑通,资质到位后只替换签名实现 |

---

## 二、当前实现盘点(基线)

### 已完成(质量可用)

- 扫码点餐全流程(扫码→菜单→下单→mock 支付→支付成功页)
- 后端 14 个 migrations:schema/RLS/RPC/seed/审计齐全
- POS 闭环 80%:接单/完成/退款/沽清/清台/小票两联/重打/Realtime 弹单
- 会员储值 mock 闭环:无感建档 + 余额支付(原子扣减)+ 储值充值(每满 100 送 20)
- 多门店:运营开店 + 老板加分店 + 门店切换 + 归属校验
- admin SPA:菜品管理 + 营业统计
- Docker compose 部署 + GitHub Actions 自动部署

### 已知缺陷(必须在阶段 1 修复)

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| D1 | 退款不回滚会员余额 | `0002_rpc.sql` `cancel_order` | 余额支付的订单退款后钱没了 |
| D2 | 顾客端订单状态不同步 | `miniapp/src/services/orderSync.ts` | 顾客看不到 POS 接单/出餐进度 |
| D3 | POS 动作未做跨店归属校验 | `0008_staff_auth.sql:37-38` | 靠 RLS 间接隔离,不完整 |
| D4 | openid 用 `dev_xxx` 伪值 | `miniapp/src/services/identity.ts` | 换设备会员丢失 |
| D5 | 手机号用尾号占位 | `miniapp/src/store/user.ts` | 无法召回 |

### 未实现(阶段 1-4 补齐)

- 真·微信支付(服务商模式)
- 自动运营引擎 + 优惠券前端
- RBAC 权限系统 + 员工管理
- 商户进件 + 平台管理端
- 完整收银台(现金/找零/抹零/组合支付/交接班)
- 桌台四态 + 桌台图 + 桌台 CRUD
- 多人协同点餐
- 日结对账

---

## 三、四阶段路线图

### 阶段 0:资质准备(并行,非代码,关键路径)

| 任务 | 责任方 | 周期 | 状态 |
|---|---|---|---|
| 微信支付服务商进件申请 | 用户 | 2-4 周 | 进行中 |
| 企业主体 ICP 备案域名 | 用户 | 7-20 工作日 | 待启动 |
| 企业对公账户 | 用户 | 1-2 周 | 待确认 |

> **关键路径,代码再快也绕不开。必须立即启动,与代码并行。**

---

### 阶段 1:收款命脉(代码,2-3 周)

**目标**:微信支付服务商架构搭好,mock 跑通全链路,资质到位后 1 周内切真收款。**同时修复已知缺陷 D1-D5。**

**进度**:✅ 已完成代码骨架(sandbox 闭环 + live TODO 就绪),等资质到位切 live

| 序号 | 任务 | 核心改动 | 依赖资质 | 状态 |
|---|---|---|---|---|
| 1.1 | 新增 `wxpay_merchant` 表 | `store_id ↔ sub_mchid` 映射 + 进件状态 + `submit_merchant_application`/`approve_merchant_application`/`get_store_sub_mchid` RPC | 否 | ✅ `0015` |
| 1.2 | 重构 `wxpay-create` 为服务商模式 | partner 接口骨架 + v3 签名位 + sandbox/live 分支 | 否(签名实现待资质) | ✅ sandbox 完成,live TODO |
| 1.3 | 实现 `wxpay-notify` 验签解密骨架 | sandbox: mock 支付直走 `pay_order_by_id`+建会员;live: 验签位就绪 | 否(验签待平台证书) | ✅ sandbox 完成,live TODO |
| 1.4 | 真 openid + 手机号解密 Edge Function | `wx-login`: sandbox 返回 dev openid;live 调 jscode2session + getuserphonenumber | 否 | ✅ sandbox 完成,live TODO |
| 1.5 | 退款 Edge Function + 余额回滚 | `wxpay-refund`: sandbox 库内回滚;live 调微信退款 API。修复 D1 `cancel_order` 回滚余额 + `refund_order_by_id` RPC | 否(退款 API 待资质) | ✅ sandbox 完成,live TODO |
| 1.6 | 顾客端订单状态轮询(修复 D2) | `list_order_status` RPC + `orderSync.ts` 切真轮询 | 否 | ✅ |
| 1.7 | POS 动作跨店校验(修复 D3) | `accept_order`/`complete_order`/`cancel_order`/`clear_table` 加 `store_id` 校验 + `is_store_owner` | 否 | ✅ |
| 1.8 | ICP 域名 + HTTPS + Supabase 反代 | nginx 加反代层 | 是 | ⏳ 待资质 |

**已修复缺陷**:
- ✅ D1 退款不回滚余额 — `cancel_order` + `refund_order_by_id` 现回滚余额 + 写 refund 流水
- ✅ D2 顾客端订单状态不同步 — `list_order_status` RPC + `orderSync.ts` 真轮询
- ✅ D3 POS 跨店校验 — 四个动作 RPC 加 `store_id` 归属校验
- ⏳ D4 真 openid — `wx-login` Edge Function 已就绪,sandbox 用 dev openid,live 待资质
- ⏳ D5 真手机号 — `wx-login` 的 phone_code 分支已就绪,live 解密待资质

**mock 策略**(关键设计):
- `wxpay-create` `WXPAY_MODE=sandbox` 返回占位 paySign + 前端走 mock 支付;`live` 走真签名
- `wxpay-notify` sandbox 模式由小程序 mock 支付成功后主动调用,绕过验签直走 `pay_order_by_id` + `get_or_create_member`
- `wxpay-refund` sandbox 模式直接调 `refund_order_by_id`(库内置 refunded + 余额回滚),live 走真退款 API
- `wx-login` sandbox 返回 dev 伪 openid + 尾号手机号,live 调真 API
- **资质到位后只需**: 填 secrets + 实现 v3 签名 + 实现平台证书验签 + 切 `WXPAY_MODE=live` / `WX_LOGIN_MODE=live`

---

### 阶段 2:运营自动化 + 平台管理端(代码,2 周)

**目标**:老板能管店、能配营销、顾客支付后自动转化、平台能进件商户。

| 序号 | 任务 | 核心改动 |
|---|---|---|
| 2.1 | **自动运营引擎** | 新增 `marketing_rule` 表;支付成功→按规则自动发券(新客券/满返券)→引导储值 |
| 2.2 | **优惠券全链路** | 小程序:领券中心 + 下单选券核销;admin:券模板 CRUD + 发放记录 |
| 2.3 | **平台管理端(新建 `apps/platform/`)** | 商户进件审核 + sub_mchid 管理 + 全局看板 |
| 2.4 | **商户进件 RPC** | `submit_merchant_application` + `approve_merchant` + 调微信进件 API(资质到位前 mock sub_mchid) |
| 2.5 | **RBAC 权限系统** | 新增 `role`/`permission`/`role_permission` 表;支持 boss/owner/manager/cashier 四档 |
| 2.6 | **admin 角色员工管理** | 两个新 tab:角色管理(权限矩阵)+ 员工管理(增删改 + 分配角色) |

**运营引擎设计**:
```
支付成功(wxpay-notify mock 或 live)
  ├─ get_or_create_member(openid, phone)   # 已有
  ├─ 按 store_id 查 marketing_rule where trigger='pay_success' and enabled
  │   └─ for each rule: 执行 action(issue_coupon / notify / popup)
  ├─ 首单?→ 自动发新客券(rule: trigger='first_order')
  └─ 返回营销物料给支付成功页(成为会员/充100送20/领券)
```

**RBAC 权限矩阵**:
| 角色 | 菜品 | 订单 | 退款 | 营业统计 | 员工 | 角色 | 桌台 | 收银 |
|---|---|---|---|---|---|---|---|---|
| boss(平台超管) | - | - | - | 全局 | - | - | - | - |
| owner(老板) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| manager(店长) | ✅ | ✅ | ✅(审批) | ✅ | ✅ | ❌ | ✅ | ✅ |
| cashier(收银员) | 沽清 | ✅ | ❌ | 本班 | ❌ | ❌ | ✅ | ✅ |

---

### 阶段 3:门店运营核心(代码,2-3 周)

**目标**:完整收银台 + 桌台管理 + 协同点餐——试点店日常运营必备。

| 序号 | 任务 | 核心改动 |
|---|---|---|
| 3.1 | **完整收银台** | `orders` 表加收银字段;POS 加收银模块 |
| 3.2 | **桌台管理升级** | `point_status` enum 加 `reserved`/`cleaning`;POS 加桌台网格图;admin 加桌台 CRUD;换桌/并桌 |
| 3.3 | **多人协同点餐** | 购物车从设备级升会话级;同桌共享购物车 + 并单结账 |
| 3.4 | **交接班 + 日结对账** | `shift` 表 + 班次冻结 + 现金/微信/余额对账 + 差异处理 |

**收银台数据模型**:
```sql
ALTER TABLE orders ADD COLUMN cash_received numeric;      -- 实收现金
ALTER TABLE orders ADD COLUMN change_amount numeric;      -- 找零
ALTER TABLE orders ADD COLUMN round_off numeric;          -- 抹零(可负)
ALTER TABLE orders ADD COLUMN pay_breakdown jsonb;        -- {wechat:30, cash:20, balance:10}
ALTER TABLE orders ADD COLUMN settled_by uuid;            -- 收银员
ALTER TABLE orders ADD COLUMN settled_at timestamptz;     -- 结账时间
```

**协同点餐数据模型**:
- 购物车 key 从 `device_id` 改为 `session_id`(dining_session.id)
- 同桌多人 `addToCart` 写入同一 session 的购物车
- 结账时 `place_order` 读取整个 session 购物车,生成一个订单
- 任何人都能结账(主扫人/后扫人)

---

### 阶段 4:数据看板补全(代码,1 周)

| 任务 | 说明 |
|---|---|
| admin 订单查询 | 全店订单列表 + 多维筛选 + 详情 |
| 退款明细 | 退款记录 + 原因分析 |
| 操作日志 | staff 操作审计流水 |
| 会员列表 | 会员档案 + 消费累计 + 储值流水 |

---

## 四、关键数据模型改动汇总

```sql
-- ===== 阶段1:服务商模式支付 =====
CREATE TABLE wxpay_merchant (
  store_id uuid PRIMARY KEY REFERENCES store(id),
  sub_mchid text,                     -- 微信支付特约商户号(进件后才有)
  application_status text NOT NULL DEFAULT 'pending',  -- pending/approved/rejected
  applied_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  raw_response jsonb
);

-- 修复 D1:cancel_order 回滚余额(改 RPC,不加表)
-- 修复 D2:list_order_status RPC(不加表)
-- 修复 D3:POS 动作加 store_id 校验(改 RPC,不加表)

-- ===== 阶段2:运营 + RBAC =====
CREATE TABLE marketing_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES store(id),
  trigger text NOT NULL,              -- pay_success / first_order / birthday
  action jsonb NOT NULL,              -- {type:'issue_coupon', coupon_template_id:xxx}
  enabled bool DEFAULT true,
  priority int DEFAULT 0
);

CREATE TABLE coupon_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES store(id),
  name text NOT NULL,
  kind text NOT NULL,                 -- full_reduce / cash / new_user
  threshold numeric,
  value numeric NOT NULL,
  valid_days int,                     -- 领取后有效天数
  total_quota int,                    -- 发放总量
  issued_count int DEFAULT 0,
  enabled bool DEFAULT true
);

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES store(id), -- NULL = 平台级角色
  name text NOT NULL,
  built_in bool DEFAULT false
);

CREATE TABLE permission (
  id text PRIMARY KEY,                -- 'menu.manage', 'order.refund', ...
  name text NOT NULL,
  category text
);

CREATE TABLE role_permission (
  role_id uuid REFERENCES role(id),
  permission_id text REFERENCES permission(id),
  PRIMARY KEY (role_id, permission_id)
);

-- ===== 阶段3:收银台 + 桌台 =====
ALTER TABLE orders ADD COLUMN cash_received numeric;
ALTER TABLE orders ADD COLUMN change_amount numeric;
ALTER TABLE orders ADD COLUMN round_off numeric;
ALTER TABLE orders ADD COLUMN pay_breakdown jsonb;
ALTER TABLE orders ADD COLUMN settled_by uuid;
ALTER TABLE orders ADD COLUMN settled_at timestamptz;

ALTER TYPE point_status ADD VALUE 'reserved';
ALTER TYPE point_status ADD VALUE 'cleaning';

ALTER TABLE service_point ADD COLUMN area text;       -- 区域
ALTER TABLE service_point ADD COLUMN seat_count int;  -- 座位数

CREATE TABLE shift (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES store(id),
  staff_id uuid REFERENCES staff(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  opening_float numeric,              -- 开班备用金
  expected_cash numeric,              -- 应有现金
  counted_cash numeric,               -- 实点现金
  difference numeric,                 -- 差异
  status text DEFAULT 'open',         -- open / closed
  note text
);
```

---

## 五、目录结构演进

```
apps/
  miniapp/      # 小程序:协同点餐 + 真支付 + 领券核销
  pos/          # POS:接单看板 + 完整收银台 + 桌台图 + 交接班
  admin/        # 商户后台:菜品 + 统计 + 订单 + 退款 + 员工 + 角色 + 桌台
  platform/     # 【新】平台管理端:商户进件 + sub_mchid + 全局看板
packages/
  shared/       # 类型 + 状态机 + 术语 + 小票模型 + 营销模型
supabase/
  migrations/   # 0001-0014(已有) + 0015_wxpay_merchant + 0016_marketing
                # + 0017_rbac + 0018_cashier + 0019_table_upgrade + 0020_shift
  functions/
    wxpay-create/    # 服务商模式(sandbox + live)
    wxpay-notify/    # 验签解密(sandbox + live)
    wxpay-refund/    # 【新】退款 Edge Function
    wx-login/        # 【新】code 换 openid + 手机号解密
```

---

## 六、时间线

```
现在 ── 阶段0(资质,并行) ──────────────────────┐
                                                  │ 2-4周
                                                  ▼
                                    阶段1(收款命脉) ── 2-3周 ──┐
                                                                │
                                    阶段2(运营+平台端) ── 2周 ────┤
                                                                │
                                    阶段3(门店运营) ── 2-3周 ─────┤
                                                                │
                                    阶段4(数据看板) ── 1周 ───────┘
                                                                ▼
                                                         可商业化试点
```

**总计**:资质到位后,代码侧约 7-9 周达到完整商业化试点状态。
- 阶段 1 完成 = 最小可收款
- 阶段 2-3 完成 = 试点店真正能用
- 阶段 4 完成 = 管理补全

---

## 七、风险与缓解

| 风险 | 缓解 |
|---|---|
| 资质申请周期不可控 | 代码侧 mock 占位,资质到位后替换简单;阶段 1 不阻塞 |
| 服务商模式签名复杂 | 先写骨架 + 单元测试,v3 签名用微信官方 SDK |
| 协同点餐数据模型改动大 | 购物车从 device 级升 session 级,需兼容旧数据 |
| 收银台与小程序支付冲突 | 收银台仅处理"现金/代收"场景,小程序自助支付优先 |
| RBAC 改动影响现有功能 | 现有 owner/clerk 映射为 built-in 角色,不破坏现有 RPC |

---

## 八、验收标准

### 阶段 1 验收
- [ ] `wxpay_merchant` 表 + 进件状态字段
- [ ] `wxpay-create` sandbox 返回 paySign 占位,live 走 partner 接口骨架
- [ ] `wxpay-notify` sandbox 走 mock 置 paid,live 验签位就绪
- [ ] `wx-login` Edge Function:code 换 openid + 手机号解密(mock 模式保留 dev openid)
- [ ] 退款 Edge Function:sandbox 回滚余额 + 写 refund 流水,live 走真退款 API 位
- [ ] 顾客端订单状态轮询生效
- [ ] POS 动作跨店校验生效
- [ ] D1-D5 缺陷全部修复

### 阶段 2 验收
- [ ] 支付成功自动建会员 + 自动发券(按 marketing_rule)
- [ ] 小程序领券中心 + 下单选券核销
- [ ] admin 券模板 CRUD + 发放记录
- [ ] 平台管理端:商户进件审核 + sub_mchid 管理
- [ ] RBAC 四档角色生效,admin 角色员工管理 UI

### 阶段 3 验收
- [ ] POS 收银台:现金/微信/余额/组合支付 + 找零抹零
- [ ] 桌台四态 + 桌台网格图 + 换桌并桌
- [ ] 同桌多人共享购物车 + 并单结账
- [ ] 交接班 + 日结对账

### 阶段 4 验收
- [ ] admin 订单查询 + 退款明细 + 操作日志 + 会员列表
