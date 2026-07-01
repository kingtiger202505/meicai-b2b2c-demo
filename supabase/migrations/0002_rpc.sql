-- ============================================================
-- P0 RPC: 顾客(下单/支付/查单) + 门店(接单/完成/取消/沽清/清台)
-- 全部 security definer,金额服务端算,沽清服务端校验
-- ============================================================

-- 顾客下单：只收 item_id/qty/note，价格/单号/total 服务端算
create or replace function place_order(
  p_store_id uuid, p_point_id uuid, p_items jsonb,
  p_customer_ref text default null, p_pay_method text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_session_id uuid; v_order_id uuid; v_order_no text; v_token uuid;
  v_total numeric(10,2) := 0; v_seq int; v_day date := (now() at time zone 'Asia/Shanghai')::date;
  v_is_addon boolean := false; v_addon_seq int; r jsonb; v_item item%rowtype; v_qty int;
begin
  if not exists(select 1 from store where id=p_store_id) then raise exception 'store_not_found'; end if;
  if p_items is null or jsonb_array_length(p_items)=0 then raise exception 'empty_cart'; end if;

  if p_point_id is not null then
    select current_session_id into v_session_id from service_point where id=p_point_id and store_id=p_store_id;
    if v_session_id is null then
      insert into dining_session(store_id, point_id) values (p_store_id, p_point_id) returning id into v_session_id;
      update service_point set current_session_id=v_session_id, status='occupied' where id=p_point_id;
    else
      v_is_addon := true;
      select count(*)+1 into v_addon_seq from orders where session_id=v_session_id;
    end if;
  end if;

  insert into order_counter(store_id, day, seq) values (p_store_id, v_day, 1)
    on conflict (store_id, day) do update set seq = order_counter.seq + 1
    returning seq into v_seq;
  v_order_no := 'A' || lpad(v_seq::text, 3, '0');

  insert into orders(store_id, point_id, session_id, order_no, customer_ref, pay_method, status, is_addon, addon_seq)
    values (p_store_id, p_point_id, v_session_id, v_order_no, p_customer_ref, p_pay_method, 'created', v_is_addon, v_addon_seq)
    returning id, order_token into v_order_id, v_token;

  for r in select value from jsonb_array_elements(p_items) loop
    select * into v_item from item where id=(r->>'item_id')::uuid and store_id=p_store_id;
    if not found then raise exception 'item_not_found:%', r->>'item_id'; end if;
    if v_item.status <> 'on_sale' then raise exception 'item_unavailable:%', v_item.name; end if;
    v_qty := greatest(coalesce((r->>'qty')::int,1),1);
    insert into order_item(order_id, item_id, name_snapshot, price_snapshot, qty, note)
      values (v_order_id, v_item.id, v_item.name, v_item.price, v_qty, r->>'note');
    v_total := v_total + v_item.price * v_qty;
    update item set sales = sales + v_qty where id=v_item.id;
  end loop;

  update orders set total=v_total where id=v_order_id;
  return jsonb_build_object('order_id',v_order_id,'order_no',v_order_no,'order_token',v_token,
                            'total',v_total,'is_addon',v_is_addon,'addon_seq',v_addon_seq);
end $$;

-- mock 支付
create or replace function pay_order(p_order_token uuid, p_pay_method text default 'mock')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  update orders set status='paid', paid_at=now(), pay_method=coalesce(p_pay_method,pay_method)
    where order_token=p_order_token and status='created' returning id into v_id;
  if v_id is null then raise exception 'order_not_payable'; end if;
  return jsonb_build_object('order_id',v_id,'status','paid');
end $$;

-- 顾客查单(凭 token,不暴露 token 本身)
create or replace function query_order(p_order_token uuid)
returns jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'order', to_jsonb(o) - 'order_token',
    'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.id) from order_item oi where oi.order_id=o.id),'[]'::jsonb)
  ) from orders o where o.order_token=p_order_token;
$$;

-- 我的订单(按 openid/customer_ref)
create or replace function list_my_orders(p_store_id uuid, p_customer_ref text)
returns setof jsonb language sql security definer set search_path=public stable as $$
  select to_jsonb(o) - 'order_token' from orders o
  where o.store_id=p_store_id and o.customer_ref=p_customer_ref
  order by o.created_at desc limit 50;
$$;

-- ---------- 门店端(POS) ----------
-- 接单：paid -> processing,并占位打印时间(幂等)
create or replace function accept_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  update orders set status='processing', printed_at=coalesce(printed_at,now())
    where id=p_order_id and status='paid' returning id into v_id;
  if v_id is null then raise exception 'order_not_acceptable'; end if;
  return jsonb_build_object('order_id',v_id,'status','processing');
end $$;

-- 完成：processing -> completed
create or replace function complete_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  update orders set status='completed', completed_at=now()
    where id=p_order_id and status='processing' returning id into v_id;
  if v_id is null then raise exception 'order_not_completable'; end if;
  return jsonb_build_object('order_id',v_id,'status','completed');
end $$;

-- 取消/退款：created->cancelled,paid/processing->refunded
create or replace function cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_status order_status; v_new order_status;
begin
  select status into v_status from orders where id=p_order_id for update;
  if v_status is null then raise exception 'order_not_found'; end if;
  if v_status in ('created') then v_new:='cancelled';
  elsif v_status in ('paid','processing') then v_new:='refunded';
  else raise exception 'order_not_cancelable'; end if;
  update orders set status=v_new, cancel_reason=p_reason where id=p_order_id;
  return jsonb_build_object('order_id',p_order_id,'status',v_new);
end $$;

-- 沽清开关
create or replace function set_item_status(p_item_id uuid, p_status item_status)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  update item set status=p_status where id=p_item_id returning id into v_id;
  if v_id is null then raise exception 'item_not_found'; end if;
  return jsonb_build_object('item_id',v_id,'status',p_status);
end $$;

-- 清台：关闭会话,点位置空
create or replace function clear_table(p_point_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_session uuid;
begin
  select current_session_id into v_session from service_point where id=p_point_id;
  if v_session is not null then
    update dining_session set status='closed', closed_at=now() where id=v_session;
  end if;
  update service_point set current_session_id=null, status='idle' where id=p_point_id;
  return jsonb_build_object('point_id',p_point_id,'closed_session',v_session);
end $$;

-- ---------- grants ----------
revoke all on function place_order(uuid,uuid,jsonb,text,text) from public;
revoke all on function pay_order(uuid,text) from public;
revoke all on function query_order(uuid) from public;
revoke all on function list_my_orders(uuid,text) from public;
grant execute on function place_order(uuid,uuid,jsonb,text,text) to anon, authenticated;
grant execute on function pay_order(uuid,text) to anon, authenticated;
grant execute on function query_order(uuid) to anon, authenticated;
grant execute on function list_my_orders(uuid,text) to anon, authenticated;

grant execute on function accept_order(uuid)   to authenticated, service_role;
grant execute on function complete_order(uuid) to authenticated, service_role;
grant execute on function cancel_order(uuid,text) to authenticated, service_role;
grant execute on function set_item_status(uuid,item_status) to authenticated, service_role;
grant execute on function clear_table(uuid) to authenticated, service_role;
