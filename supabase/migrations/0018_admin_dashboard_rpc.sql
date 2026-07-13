-- ============================================================
-- 阶段4 数据看板 RPC — 订单查询/退款明细/会员列表/操作日志
-- 幂等可重跑。依赖 0016(已含 store_owner 校验函数 is_store_owner)
-- 全部 security definer，内部校验 owner 身份
-- ============================================================

-- ---------- 1. 门店订单列表(含明细 + 桌台名) ----------
create or replace function list_store_orders(
  p_store_id uuid,
  p_status   text default null,   -- null=全部状态
  p_limit    int  default 50
) returns setof jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',          o.id,
    'order_no',    o.order_no,
    'status',      o.status,
    'total',       o.total,
    'pay_method',  o.pay_method,
    'customer_ref', o.customer_ref,
    'cancel_reason', o.cancel_reason,
    'created_at',  o.created_at,
    'paid_at',     o.paid_at,
    'completed_at', o.completed_at,
    'is_addon',    o.is_addon,
    'addon_seq',   o.addon_seq,
    'point_name',  sp.name,
    'items',       coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', oi.name_snapshot,
        'price', oi.price_snapshot,
        'qty', oi.qty,
        'note', oi.note
      ) order by oi.id)
      from order_item oi where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from orders o
  left join service_point sp on sp.id = o.point_id
  where o.store_id = p_store_id
    and is_store_owner(p_store_id)
    and (p_status is null or o.status = p_status)
  order by o.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function list_store_orders(uuid,text,int) from public;
grant execute on function list_store_orders(uuid,text,int) to authenticated;

-- ---------- 2. 退款订单列表 ----------
create or replace function list_store_refunds(
  p_store_id uuid,
  p_limit    int  default 50
) returns setof jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',           o.id,
    'order_no',     o.order_no,
    'total',        o.total,
    'pay_method',   o.pay_method,
    'cancel_reason', o.cancel_reason,
    'created_at',   o.created_at,
    'paid_at',      o.paid_at,
    'point_name',   sp.name
  )
  from orders o
  left join service_point sp on sp.id = o.point_id
  where o.store_id = p_store_id
    and is_store_owner(p_store_id)
    and o.status = 'refunded'
  order by o.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function list_store_refunds(uuid,int) from public;
grant execute on function list_store_refunds(uuid,int) to authenticated;

-- ---------- 3. 门店会员列表(含储值流水摘要) ----------
create or replace function list_store_members(
  p_store_id uuid,
  p_limit    int  default 50
) returns setof jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',           m.id,
    'openid_tail',  right(m.openid, 8),
    'phone',        m.phone,
    'balance',      m.balance,
    'total_spent',  m.total_spent,
    'visit_count',  m.visit_count,
    'last_visit_at', m.last_visit_at,
    'created_at',   m.created_at,
    'topup_total',  coalesce((
      select sum(t.amount) from stored_value_txn t
      where t.member_id = m.id and t.type in ('topup','gift') and t.amount > 0
    ), 0)
  )
  from member m
  where m.store_id = p_store_id
    and is_store_owner(p_store_id)
  order by m.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function list_store_members(uuid,int) from public;
grant execute on function list_store_members(uuid,int) to authenticated;

-- ---------- 4. 员工操作日志(简化版:订单状态变更时间线) ----------
-- 无独立日志表，以 orders 各阶段时间戳为操作流水
create or replace function list_staff_logs(
  p_store_id uuid,
  p_limit    int  default 50
) returns setof jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'order_no',     o.order_no,
    'action',       case o.status
      when 'created'   then '创建订单'
      when 'paid'      then '支付成功'
      when 'processing' then '接单'
      when 'completed' then '完成订单'
      when 'cancelled' then '取消订单'
      when 'refunded'  then '退款'
    end,
    'status',       o.status,
    'total',         o.total,
    'acted_at',     coalesce(
      case o.status
        when 'created'    then o.created_at
        when 'paid'       then o.paid_at
        when 'processing' then o.printed_at
        when 'completed'  then o.completed_at
        else o.created_at
      end, o.created_at
    ),
    'point_name',   sp.name,
    'settled_by',   o.settled_by
  )
  from orders o
  left join service_point sp on sp.id = o.point_id
  where o.store_id = p_store_id
    and is_store_owner(p_store_id)
  order by coalesce(
    case o.status
      when 'created'    then o.created_at
      when 'paid'       then o.paid_at
      when 'processing' then o.printed_at
      when 'completed'  then o.completed_at
      else o.created_at
    end, o.created_at
  ) desc
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function list_staff_logs(uuid,int) from public;
grant execute on function list_staff_logs(uuid,int) to authenticated;
