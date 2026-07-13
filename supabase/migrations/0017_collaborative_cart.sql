-- ============================================================
-- 0017 协同点餐 — session 级共享购物车
-- session_cart 仅做"实时共享展示"，真正下单仍走 place_order 传 items
-- 幂等可重跑
-- ============================================================

-- ---------- 表 ----------
-- 共享购物车行：同一 session 下多人各自加菜，合并展示
create table if not exists session_cart (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references dining_session(id) on delete cascade,
  item_id     uuid not null references item(id) on delete cascade,
  qty         int  not null default 1 check (qty > 0),
  customer_ref text,                 -- 加菜人标识（伪 openid），仅展示用
  created_at  timestamptz not null default now()
);
create index if not exists session_cart_session_idx on session_cart(session_id);

-- RLS：客户端不直接读写 session_cart，全走 RPC（security definer）
alter table session_cart enable row level security;
revoke all on session_cart from anon, authenticated;

-- ---------- RPC ----------
-- 加菜到共享购物车（qty 正数=加，负数=减；减到 0 自动删行）
-- 幂等：同 session + 同 item + 同 customer 的行累加 qty
create or replace function add_to_session_cart(
  p_session_id uuid, p_item_id uuid, p_qty int, p_customer_ref text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_row session_cart%rowtype; v_new_qty int;
begin
  if p_qty = 0 then
    return jsonb_build_object('ok', true, 'qty', 0);
  end if;

  -- 同 session + 同 item + 同 customer 聚合到一行（不同 customer 各自一行）
  select * into v_row from session_cart
    where session_id = p_session_id and item_id = p_item_id
      and coalesce(customer_ref, '') = coalesce(p_customer_ref, '')
    for update;

  if v_row.id is null then
    if p_qty < 0 then
      -- 不存在行还要减，忽略（保持幂等）
      return jsonb_build_object('ok', true, 'qty', 0);
    end if;
    insert into session_cart(session_id, item_id, qty, customer_ref)
      values (p_session_id, p_item_id, p_qty, p_customer_ref);
    v_new_qty := p_qty;
  else
    v_new_qty := v_row.qty + p_qty;
    if v_new_qty <= 0 then
      delete from session_cart where id = v_row.id;
      v_new_qty := 0;
    else
      update session_cart set qty = v_new_qty where id = v_row.id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'qty', v_new_qty);
end $$;

-- 读取共享购物车内容（含菜品名/价格，按 item 聚合不同 customer 的行）
create or replace function get_session_cart(p_session_id uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', sc.item_id,
    'name', i.name,
    'price', i.price,
    'img', i.img,
    'qty', sc.qty,
    'customer_ref', sc.customer_ref
  ) order by sc.created_at), '[]'::jsonb)
  from (
    select item_id, sum(qty)::int as qty, min(customer_ref) as customer_ref, min(created_at) as created_at
    from session_cart
    where session_id = p_session_id
    group by item_id
  ) sc
  join item i on i.id = sc.item_id;
$$;

-- 清空共享购物车（下单后调用）
create or replace function clear_session_cart(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  delete from session_cart where session_id = p_session_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- grants ----------
revoke all on function add_to_session_cart(uuid,uuid,int,text) from public;
revoke all on function get_session_cart(uuid) from public;
revoke all on function clear_session_cart(uuid) from public;
grant execute on function add_to_session_cart(uuid,uuid,int,text) to anon, authenticated;
grant execute on function get_session_cart(uuid) to anon, authenticated;
grant execute on function clear_session_cart(uuid) to anon, authenticated;
