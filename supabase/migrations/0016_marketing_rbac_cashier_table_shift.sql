-- ============================================================
-- v4 阶段2+3: 运营引擎 + RBAC + 收银台 + 桌台升级 + 交接班
-- 幂等可重跑。依赖 0015(wxpay_merchant + 缺陷修复)
-- ============================================================

-- ============================================================
-- 2A: 自动运营引擎 — marketing_rule + coupon_template
-- ============================================================
create table if not exists coupon_template (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  name text not null,
  kind coupon_kind not null,                 -- full_reduce / cash / new_user
  threshold numeric(10,2) not null default 0,-- 满减门槛
  value numeric(10,2) not null,              -- 减免金额
  valid_days int default 30,                 -- 领取后有效天数
  total_quota int,                           -- 发放总量(null=不限)
  issued_count int not null default 0,
  enabled bool not null default true,
  created_at timestamptz not null default now()
);
create index if not exists coupon_tpl_store_idx on coupon_template(store_id, enabled);
alter table coupon_template enable row level security;
-- 老板可读本店券模板,平台 service_role 可读写
create policy coupon_tpl_owner_read on coupon_template for select to authenticated
  using (store_id in (select store_id from store_owner where user_id = auth.uid()));
grant select on coupon_template to authenticated;

-- 营销规则: 触发器 → 动作
create table if not exists marketing_rule (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  name text not null,
  trigger text not null,                     -- pay_success / first_order / birthday
  action jsonb not null,                     -- {type:'issue_coupon', coupon_template_id:xxx}
  enabled bool not null default true,
  priority int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists mkt_rule_store_idx on marketing_rule(store_id, enabled, priority);
alter table marketing_rule enable row level security;
create policy mkt_rule_owner_read on marketing_rule for select to authenticated
  using (store_id in (select store_id from store_owner where user_id = auth.uid()));
grant select on marketing_rule to authenticated;

-- 券模板 CRUD(老板用)
create or replace function upsert_coupon_template(
  p_id uuid default null, p_store_id uuid default null, p_name text default null, p_kind coupon_kind default 'cash',
  p_threshold numeric default 0, p_value numeric default 0, p_valid_days int default 30,
  p_total_quota int default null, p_enabled bool default true
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c coupon_template%rowtype;
begin
  if not exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  if p_id is null then
    insert into coupon_template(store_id,name,kind,threshold,value,valid_days,total_quota,enabled)
      values(p_store_id,p_name,p_kind,p_threshold,p_value,p_valid_days,p_total_quota,p_enabled)
      returning * into c;
  else
    update coupon_template set name=p_name,kind=p_kind,threshold=p_threshold,value=p_value,
      valid_days=p_valid_days,total_quota=p_total_quota,enabled=p_enabled
      where id=p_id and store_id=p_store_id returning * into c;
    if c.id is null then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(c);
end $$;
revoke all on function upsert_coupon_template(uuid,uuid,text,coupon_kind,numeric,numeric,int,int,bool) from public;
grant execute on function upsert_coupon_template(uuid,uuid,text,coupon_kind,numeric,numeric,int,int,bool) to authenticated;

-- 营销规则 CRUD
create or replace function upsert_marketing_rule(
  p_id uuid default null, p_store_id uuid default null, p_name text default null, p_trigger text default null,
  p_action jsonb default null, p_enabled bool default true, p_priority int default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_rule%rowtype;
begin
  if not exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  if p_id is null then
    insert into marketing_rule(store_id,name,trigger,action,enabled,priority)
      values(p_store_id,p_name,p_trigger,p_action,p_enabled,p_priority)
      returning * into r;
  else
    update marketing_rule set name=p_name,trigger=p_trigger,action=p_action,enabled=p_enabled,priority=p_priority
      where id=p_id and store_id=p_store_id returning * into r;
    if r.id is null then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(r);
end $$;
revoke all on function upsert_marketing_rule(uuid,uuid,text,text,jsonb,bool,int) from public;
grant execute on function upsert_marketing_rule(uuid,uuid,text,text,jsonb,bool,int) to authenticated;

-- 按规则发券(内部用,被 run_marketing_rules 调用)
create or replace function issue_coupon_by_template(p_template_id uuid, p_member_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t coupon_template%rowtype; c coupon%rowtype; v_expire timestamptz;
begin
  select * into t from coupon_template where id=p_template_id and enabled=true for update;
  if t.id is null then raise exception 'template_not_found'; end if;
  if t.total_quota is not null and t.issued_count >= t.total_quota then
    raise exception 'quota_exhausted';
  end if;
  v_expire := now() + (coalesce(t.valid_days,30) || ' days')::interval;
  insert into coupon(store_id,member_id,kind,threshold,value,expire_at)
    values(t.store_id,p_member_id,t.kind,t.threshold,t.value,v_expire)
    returning * into c;
  update coupon_template set issued_count = issued_count + 1 where id=t.id;
  return to_jsonb(c);
end $$;
revoke all on function issue_coupon_by_template(uuid,uuid) from public;
grant execute on function issue_coupon_by_template(uuid,uuid) to service_role;

-- 执行营销规则(支付成功后调,仅 service_role)
-- 传入 store_id + member_id + trigger,执行所有匹配规则
create or replace function run_marketing_rules(p_store_id uuid, p_member_id uuid, p_trigger text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_rule%rowtype; results jsonb[] := '{}'; v_first_order bool;
begin
  -- 判断是否首单：统计除去当前被跑规则的当前事件以外，历史已支付或退款订单数。
  -- 如果数量为 0，说明当前单是首单（由于触发 run_marketing_rules 的这一单可能已经在 orders 里，也可以将当前单排除）
  select count(*) <= 1 into v_first_order from orders o
    where o.store_id = p_store_id and o.member_id = p_member_id and o.status in ('paid','processing','completed','refunded');
  for r in select * from marketing_rule where store_id=p_store_id and enabled=true and trigger=p_trigger order by priority loop
    if r.trigger = 'first_order' and not v_first_order then continue; end if;
    if r.action->>'type' = 'issue_coupon' and r.action->>'coupon_template_id' is not null then
      begin
        perform issue_coupon_by_template((r.action->>'coupon_template_id')::uuid, p_member_id);
        results := results || jsonb_build_object('rule_id',r.id,'action','issue_coupon','ok',true);
      exception when others then
        results := results || jsonb_build_object('rule_id',r.id,'action','issue_coupon','ok',false,'error',SQLERRM);
      end;
    end if;
  end loop;
  return jsonb_build_object('triggered',results);
end $$;
revoke all on function run_marketing_rules(uuid,uuid,text) from public;
grant execute on function run_marketing_rules(uuid,uuid,text) to service_role;

-- 顾客查自己的券(凭 openid)
create or replace function list_my_coupons(p_store_id uuid, p_openid text, p_status text default null)
returns setof jsonb language sql security definer set search_path=public stable as $$
  select to_jsonb(c) from coupon c
  join member m on m.id = c.member_id
  where m.store_id=p_store_id and m.openid=p_openid
    and (p_status is null or c.status = p_status::coupon_status)
  order by c.created_at desc;
$$;
revoke all on function list_my_coupons(uuid,text,text) from public;
grant execute on function list_my_coupons(uuid,text,text) to anon, authenticated;

-- 核销券(下单时用,返回抵扣额 + 置 used)
create or replace function redeem_coupon(p_coupon_id uuid, p_order_id uuid, p_store_id uuid, p_openid text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c coupon%rowtype; o orders%rowtype; v_discount numeric(10,2);
begin
  select * into c from coupon where id=p_coupon_id for update;
  if c.id is null then raise exception 'coupon_not_found'; end if;
  if c.status <> 'unused' then raise exception 'coupon_not_usable'; end if;
  -- 校验券归属
  if not exists(select 1 from member m where m.id=c.member_id and m.store_id=p_store_id and m.openid=p_openid) then
    raise exception 'coupon_not_yours';
  end if;
  if c.expire_at is not null and c.expire_at < now() then
    update coupon set status='expired' where id=p_coupon_id;
    raise exception 'coupon_expired';
  end if;
  select * into o from orders where id=p_order_id and store_id=p_store_id and status='created' for update;
  if o.id is null then raise exception 'order_not_found'; end if;
  -- 满减校验
  if o.total < c.threshold then raise exception 'below_threshold'; end if;
  v_discount := c.value;
  -- 更新订单金额(不低于 0.01)
  update orders set total = greatest(o.total - v_discount, 0.01), coupon_id = p_coupon_id
    where id = p_order_id;
  update coupon set status='used', used_order_id=p_order_id where id=p_coupon_id;
  return jsonb_build_object('coupon_id',p_coupon_id,'discount',v_discount,'new_total',greatest(o.total - v_discount, 0.01));
end $$;
revoke all on function redeem_coupon(uuid,uuid,uuid,text) from public;
grant execute on function redeem_coupon(uuid,uuid,uuid,text) to anon, authenticated;

-- orders 加 coupon_id(幂等)
alter table orders add column if not exists coupon_id uuid references coupon(id) on delete set null;

-- ============================================================
-- 2B: RBAC 权限系统 — role / permission / role_permission
-- ============================================================
create table if not exists permission (
  id text primary key,                        -- 'menu.manage', 'order.refund', ...
  name text not null,
  category text                               -- 'menu' / 'order' / 'member' / 'cashier' / 'system'
);
alter table permission enable row level security;
grant select on permission to authenticated;

create table if not exists role (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references store(id) on delete cascade,  -- null = 平台级角色
  name text not null,
  built_in bool not null default false,
  created_at timestamptz not null default now(),
  unique(store_id, name)
);
alter table role enable row level security;
create policy role_owner_read on role for select to authenticated
  using (store_id is null or store_id in (select store_id from store_owner where user_id = auth.uid()));
grant select on role to authenticated;

create table if not exists role_permission (
  role_id uuid references role(id) on delete cascade,
  permission_id text references permission(id) on delete cascade,
  primary key (role_id, permission_id)
);
alter table role_permission enable row level security;
grant select on role_permission to authenticated;

-- 权限 seed
insert into permission(id,name,category) values
  ('menu.manage','菜品管理','menu'),
  ('menu.shelf','上下架','menu'),
  ('order.view','查看订单','order'),
  ('order.refund','退款','order'),
  ('order.accept','接单','order'),
  ('order.complete','完成订单','order'),
  ('member.view','查看会员','member'),
  ('member.manage','会员管理','member'),
  ('stats.view','营业统计','stats'),
  ('staff.manage','员工管理','system'),
  ('role.manage','角色管理','system'),
  ('table.manage','桌台管理','table'),
  ('cashier.settle','收银结账','cashier'),
  ('cashier.shift','交接班','cashier'),
  ('platform.onboard','商户进件','platform'),
  ('platform.dashboard','全局看板','platform')
on conflict (id) do nothing;

-- 内置角色 seed(平台级,store_id=null)
insert into role(id, store_id, name, built_in) values
  ('00000000-0000-0000-0000-000000000001', null, 'boss', true),       -- 平台超管
  ('00000000-0000-0000-0000-000000000002', null, 'owner', true),      -- 老板
  ('00000000-0000-0000-0000-000000000003', null, 'manager', true),    -- 店长
  ('00000000-0000-0000-0000-000000000004', null, 'cashier', true)     -- 收银员
on conflict do nothing;

-- 内置角色权限 seed
-- boss: 全部平台权限
insert into role_permission(role_id, permission_id)
  select '00000000-0000-0000-0000-000000000001', id from permission where category='platform'
on conflict do nothing;
-- owner: 全部门店权限
insert into role_permission(role_id, permission_id)
  select '00000000-0000-0000-0000-000000000002', id from permission
  where category in ('menu','order','member','stats','system','table','cashier')
on conflict do nothing;
-- manager: 除 role.manage 外的门店权限
insert into role_permission(role_id, permission_id)
  select '00000000-0000-0000-0000-000000000003', id from permission
  where category in ('menu','order','member','stats','table','cashier')
    and id <> 'system.role_manage'
on conflict do nothing;
-- cashier: 收银 + 接单/完成 + 沽清
insert into role_permission(role_id, permission_id)
  select '00000000-0000-0000-0000-000000000004', id from permission
  where id in ('order.view','order.accept','order.complete','menu.shelf','cashier.settle','cashier.shift')
on conflict do nothing;

-- staff 表加 role_id(关联 role 表,原 role text 字段保留兼容)
alter table staff add column if not exists role_id uuid references role(id) on delete set null;
-- 把现有 staff.role 文本映射到 role_id
update staff set role_id = case
  when role = 'owner' then '00000000-0000-0000-0000-000000000002'::uuid
  when role = 'manager' then '00000000-0000-0000-0000-000000000003'::uuid
  when role = 'cashier' then '00000000-0000-0000-0000-000000000004'::uuid
  else '00000000-0000-0000-0000-000000000004'::uuid  -- 默认 cashier
end where role_id is null;

-- 查当前用户权限(前端菜单/按钮控制用)
create or replace function current_staff_permissions()
returns setof text language sql security definer set search_path=public stable as $$
  select p.id from staff s
  join role_permission rp on rp.role_id = s.role_id
  join permission p on p.id = rp.permission_id
  where s.user_id = auth.uid()
  union
  -- owner 自动拥有 owner 角色权限
  select p.id from store_owner so
  join role_permission rp on rp.role_id = '00000000-0000-0000-0000-000000000002'
  join permission p on p.id = rp.permission_id
  where so.user_id = auth.uid();
$$;
revoke all on function current_staff_permissions() from public;
grant execute on function current_staff_permissions() to authenticated;

-- 员工管理 RPC(老板用)
create or replace function upsert_staff(
  p_user_id uuid default null, p_store_id uuid default null, p_name text default null, p_role_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s staff%rowtype;
begin
  if not exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  insert into staff(user_id, store_id, name, role_id, role)
    values(p_user_id, p_store_id, p_name, p_role_id,
           (select name from role where id=p_role_id))
    on conflict (user_id) do update
      set store_id = excluded.store_id, name = excluded.name,
          role_id = excluded.role_id, role = excluded.role
    returning * into s;
  return to_jsonb(s);
end $$;
revoke all on function upsert_staff(uuid,uuid,text,uuid) from public;
grant execute on function upsert_staff(uuid,uuid,text,uuid) to authenticated;

create or replace function list_staff(p_store_id uuid)
returns setof jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'user_id', s.user_id, 'store_id', s.store_id, 'name', s.name,
    'role_id', s.role_id, 'role_name', r.name, 'created_at', s.created_at
  ) from staff s left join role r on r.id = s.role_id
  where s.store_id = p_store_id
  order by s.created_at;
$$;
revoke all on function list_staff(uuid) from public;
grant execute on function list_staff(uuid) to authenticated;

-- ============================================================
-- 3A: 完整收银台 — orders 加收银字段
-- ============================================================
alter table orders add column if not exists cash_received numeric(10,2);
alter table orders add column if not exists change_amount numeric(10,2);
alter table orders add column if not exists round_off numeric(10,2) default 0;
alter table orders add column if not exists pay_breakdown jsonb;          -- {wechat:30, cash:20, balance:10}
alter table orders add column if not exists settled_by uuid;
alter table orders add column if not exists settled_at timestamptz;

-- POS 代顾客结账(现金收款,created→paid,收银员录入)
create or replace function settle_order_cash(
  p_order_id uuid, p_cash_received numeric, p_round_off numeric default 0,
  p_pay_method text default 'cash'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_order orders%rowtype; v_change numeric(10,2); v_id uuid;
begin
  select * into v_order from orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  if v_order.store_id <> current_staff_store() and not is_store_owner(v_order.store_id) then
    raise exception 'cross_store_forbidden';
  end if;
  if v_order.status <> 'created' then raise exception 'order_not_payable'; end if;
  if p_cash_received < v_order.total - p_round_off then raise exception 'cash_insufficient'; end if;
  v_change := p_cash_received - (v_order.total - p_round_off);
  update orders set
    status='paid', paid_at=now(), pay_method=p_pay_method,
    cash_received=p_cash_received, change_amount=v_change, round_off=p_round_off,
    pay_breakdown=jsonb_build_object(p_pay_method, v_order.total - p_round_off),
    settled_by=auth.uid(), settled_at=now()
    where id=p_order_id returning id into v_id;
  return jsonb_build_object('order_id',v_id,'status','paid','change',v_change,'total',v_order.total - p_round_off);
end $$;
revoke all on function settle_order_cash(uuid,numeric,numeric,text) from public;
grant execute on function settle_order_cash(uuid,numeric,numeric,text) to authenticated, service_role;

-- ============================================================
-- 3B: 桌台管理升级 — point_status 加 reserved/cleaning + 桌台 CRUD
-- ============================================================
-- point_status enum 已通过单独 ALTER TYPE ADD VALUE 执行（不支持在事务块中执行）

alter table service_point add column if not exists area text;
alter table service_point add column if not exists seat_count int default 4;
alter table service_point add column if not exists sort_order int default 0;

-- 桌台 CRUD(老板用)
create or replace function upsert_service_point(
  p_id uuid default null, p_store_id uuid default null, p_code text default null, p_name text default null,
  p_area text default null, p_seat_count int default 4, p_sort_order int default 0
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p service_point%rowtype; v_id uuid;
begin
  if not exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  if p_id is null then
    insert into service_point(store_id, code, name, area, seat_count, sort_order, status)
      values(p_store_id, p_code, p_name, p_area, p_seat_count, p_sort_order, 'idle')
      returning * into p;
  else
    update service_point set code=p_code, name=p_name, area=p_area,
      seat_count=p_seat_count, sort_order=p_sort_order
      where id=p_id and store_id=p_store_id returning * into p;
    if p.id is null then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(p);
end $$;
revoke all on function upsert_service_point(uuid,uuid,text,text,text,int,int) from public;
grant execute on function upsert_service_point(uuid,uuid,text,text,text,int,int) to authenticated;

create or replace function delete_service_point(p_point_id uuid, p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  delete from service_point where id=p_point_id and store_id=p_store_id and status='idle';
  if not found then raise exception 'not_deletable'; end if;
  return jsonb_build_object('deleted',p_point_id);
end $$;
revoke all on function delete_service_point(uuid,uuid) from public;
grant execute on function delete_service_point(uuid,uuid) to authenticated;

-- 桌台状态切换(POS 用,扩展 reserved/cleaning)
create or replace function set_point_status(p_point_id uuid, p_status point_status)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_id uuid;
begin
  select store_id into v_store from service_point where id=p_point_id;
  if v_store is null then raise exception 'point_not_found'; end if;
  if v_store <> current_staff_store() and not is_store_owner(v_store) then
    raise exception 'cross_store_forbidden';
  end if;
  update service_point set status=p_status where id=p_point_id returning id into v_id;
  return jsonb_build_object('point_id',v_id,'status',p_status);
end $$;
revoke all on function set_point_status(uuid,point_status) from public;
grant execute on function set_point_status(uuid,point_status) to authenticated, service_role;

-- ============================================================
-- 3D: 交接班 — shift 表
-- ============================================================
create table if not exists shift (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  staff_name text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  opening_float numeric(10,2) default 0,      -- 开班备用金
  expected_cash numeric(10,2),                -- 应有现金
  counted_cash numeric(10,2),                 -- 实点现金
  difference numeric(10,2),                   -- 差异
  status text not null default 'open',        -- open / closed
  note text,
  created_at timestamptz not null default now()
);
create index if not exists shift_store_staff_idx on shift(store_id, staff_id, started_at desc);
alter table shift enable row level security;
create policy shift_staff_read on shift for select to authenticated
  using (store_id = current_staff_store() or store_id in (select store_id from store_owner where user_id = auth.uid()));
grant select on shift to authenticated;

-- 开班
create or replace function open_shift(p_store_id uuid, p_opening_float numeric default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s shift%rowtype; v_name text;
begin
  if p_store_id <> current_staff_store() and not is_store_owner(p_store_id) then
    raise exception 'cross_store_forbidden';
  end if;
  -- 同人同店已有 open 班次:幂等返回
  select * into s from shift where store_id=p_store_id and staff_id=auth.uid() and status='open';
  if s.id is not null then return jsonb_build_object('shift_id',s.id,'status','open','idempotent',true); end if;
  select name into v_name from staff where user_id=auth.uid();
  insert into shift(store_id, staff_id, staff_name, opening_float, status)
    values(p_store_id, auth.uid(), v_name, p_opening_float, 'open')
    returning * into s;
  return to_jsonb(s);
end $$;
revoke all on function open_shift(uuid,numeric) from public;
grant execute on function open_shift(uuid,numeric) to authenticated;

-- 班次内统计(应收现金 = 现金支付订单总额)
create or replace function shift_summary(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare s shift%rowtype; v_cash_total numeric(10,2); v_wechat_total numeric(10,2); v_balance_total numeric(10,2); v_order_count int;
begin
  select * into s from shift where id=p_shift_id;
  if s.id is null then raise exception 'shift_not_found'; end if;
  select coalesce(sum(total),0), count(*) into v_cash_total, v_order_count
    from orders where store_id=s.store_id and settled_by=s.staff_id
    and settled_at >= s.started_at and (s.ended_at is null or settled_at <= s.ended_at)
    and pay_method='cash' and status in ('paid','processing','completed');
  select coalesce(sum(total),0) into v_wechat_total
    from orders where store_id=s.store_id and settled_by=s.staff_id
    and settled_at >= s.started_at and (s.ended_at is null or settled_at <= s.ended_at)
    and pay_method='wechat' and status in ('paid','processing','completed');
  select coalesce(sum(total),0) into v_balance_total
    from orders where store_id=s.store_id and settled_by=s.staff_id
    and settled_at >= s.started_at and (s.ended_at is null or settled_at <= s.ended_at)
    and pay_method='balance' and status in ('paid','processing','completed');
  return jsonb_build_object(
    'shift_id', p_shift_id,
    'cash_total', v_cash_total,
    'wechat_total', v_wechat_total,
    'balance_total', v_balance_total,
    'order_count', v_order_count,
    'expected_cash', s.opening_float + v_cash_total,
    'opening_float', s.opening_float
  );
end $$;
revoke all on function shift_summary(uuid) from public;
grant execute on function shift_summary(uuid) to authenticated;

-- 交接班(关班)
create or replace function close_shift(p_shift_id uuid, p_counted_cash numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s shift%rowtype; v_summary jsonb; v_expected numeric;
begin
  select * into s from shift where id=p_shift_id for update;
  if s.id is null then raise exception 'shift_not_found'; end if;
  if s.staff_id <> auth.uid() and not is_store_owner(s.store_id) then
    raise exception 'not_your_shift';
  end if;
  if s.status = 'closed' then raise exception 'already_closed'; end if;
  v_summary := shift_summary(p_shift_id);
  v_expected := (v_summary->>'expected_cash')::numeric;
  update shift set
    status='closed', ended_at=now(),
    expected_cash=v_expected, counted_cash=p_counted_cash,
    difference=p_counted_cash - v_expected, note=p_note
    where id=p_shift_id returning * into s;
  return to_jsonb(s);
end $$;
revoke all on function close_shift(uuid,numeric,text) from public;
grant execute on function close_shift(uuid,numeric,text) to authenticated;

-- 查当前班次
create or replace function current_shift(p_store_id uuid, p_user_id uuid default null)
returns jsonb language sql security definer set search_path=public stable as $$
  select to_jsonb(s) from shift s
  where s.store_id=p_store_id and s.staff_id=coalesce(p_user_id, auth.uid()) and s.status='open'
  order by s.started_at desc limit 1;
$$;
revoke all on function current_shift(uuid,uuid) from public;
grant execute on function current_shift(uuid,uuid) to authenticated;
