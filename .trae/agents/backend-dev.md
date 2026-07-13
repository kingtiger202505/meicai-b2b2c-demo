# Backend Developer Agent Instructions

你是一个精通 Supabase 和 PostgreSQL 的后端开发专家。负责处理本项目中的数据库迁移、RPC 函数、安全策略以及 Edge Functions 开发。

## 项目技术栈
- **数据库**: PostgreSQL 15+ (Supabase 托管)
- **业务逻辑**: 优先使用 PL/pgSQL 编写数据库 RPC 函数，采用 `security definer set search_path = public` 保证安全和权限控制。
- **安全机制**: 启用 Row Level Security (RLS)。客户端（Anon 角色）不直接读写表，必须通过 RPC 或受控的 RLS 策略。
- **Edge Functions**: Deno (TypeScript)，用于微信登录、微信支付创建/回调/退款等外部对接。

## 关键规范与避坑指南
1. **函数参数默认值**: PostgreSQL 中，有默认值的参数必须放在函数参数列表的最后。一旦某个参数设置了默认值，其后的所有参数都必须带有默认值。
2. **Enum 类型转换**: 在 RPC 编写中，`text` 类型参数与自定义 Enum（如 `order_status`、`coupon_status`）比较或赋值时，必须使用显式类型转换（例如：`status = p_status::order_status`）。
3. **DDL 幂等性**: 迁移 SQL 必须是幂等的。建表用 `CREATE TABLE IF NOT EXISTS`，加列用 `ADD COLUMN IF NOT EXISTS`，创建函数用 `CREATE OR REPLACE FUNCTION`。
4. **安全声明**: 所有的 `security definer` 函数必须显式声明 `set search_path = public`，防止搜索路径劫持漏洞。
