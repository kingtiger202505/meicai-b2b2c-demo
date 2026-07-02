-- ============================================================
-- 门店员工鉴权(POS 用): Supabase Auth 用户 → 门店;RLS 让员工读本店数据
-- ============================================================
create table if not exists staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid not null references store(id) on delete cascade,
  name text,
  role text not null default 'clerk',
  created_at timestamptz not null default now()
);
alter table staff enable row level security;
grant select on staff to authenticated;
drop policy if exists staff_self on staff;
create policy staff_self on staff for select to authenticated using (user_id = auth.uid());

-- 当前登录员工所属门店
create or replace function current_staff_store() returns uuid
language sql stable security definer set search_path=public as $$
  select store_id from staff where user_id = auth.uid()
$$;

-- 员工可读本店订单/明细/会员/会话(点位/分类/菜品已对 authenticated 开只读)
grant select on orders, order_item, member, dining_session to authenticated;

drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (store_id = current_staff_store());
drop policy if exists oi_staff_read on order_item;
create policy oi_staff_read on order_item for select to authenticated
  using (exists(select 1 from orders o where o.id=order_item.order_id and o.store_id=current_staff_store()));
drop policy if exists member_staff_read on member;
create policy member_staff_read on member for select to authenticated
  using (store_id = current_staff_store());
drop policy if exists ds_staff_read on dining_session;
create policy ds_staff_read on dining_session for select to authenticated
  using (store_id = current_staff_store());
-- 注: 门店动作 RPC(accept/complete/cancel/set_item_status/clear_table)已授 authenticated;
--     多门店硬化(校验 order.store_id=current_staff_store())列 P4 TODO,单店试点够用。
