-- ============================================================
-- 老板端营业统计 RPC：按天查询指定门店的营业数据
-- security definer，内部校验 owner 身份
-- ============================================================

-- 查询某门店某日的营业汇总（营业额/订单数/客单价/支付方式分布）
create or replace function daily_stats(
  p_store_id uuid,
  p_date     date default null   -- null 则取当天(上海时区)
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_date   date := coalesce(p_date, (now() at time zone 'Asia/Shanghai')::date);
  v_total  numeric(10,2);
  v_count  int;
  v_avg    numeric(10,2);
  v_refund numeric(10,2);
  v_pay    jsonb;
begin
  -- 权限校验：必须是该门店的 owner
  if not is_store_owner(p_store_id) then
    raise exception 'not_store_owner';
  end if;

  -- 有效订单(paid/processing/completed)汇总
  select coalesce(sum(total), 0), count(*), coalesce(avg(total), 0)
    into v_total, v_count, v_avg
    from orders
   where store_id = p_store_id
     and status in ('paid', 'processing', 'completed')
     and (created_at at time zone 'Asia/Shanghai')::date = v_date;

  -- 退款金额
  select coalesce(sum(total), 0) into v_refund
    from orders
   where store_id = p_store_id
     and status = 'refunded'
     and (created_at at time zone 'Asia/Shanghai')::date = v_date;

  -- 支付方式分布
  select coalesce(jsonb_agg(jsonb_build_object('method', pm, 'amount', amt, 'count', cnt)), '[]'::jsonb)
    into v_pay
    from (
      select coalesce(pay_method, '未知') as pm, sum(total) as amt, count(*) as cnt
        from orders
       where store_id = p_store_id
         and status in ('paid', 'processing', 'completed')
         and (created_at at time zone 'Asia/Shanghai')::date = v_date
       group by pay_method
       order by amt desc
    ) t;

  return jsonb_build_object(
    'date',       v_date,
    'revenue',    v_total,
    'order_count', v_count,
    'avg_price',  round(v_avg, 2),
    'refund',     v_refund,
    'pay_methods', v_pay
  );
end $$;

-- 查询最近 N 天的每日营业额（趋势数据）
create or replace function daily_trend(
  p_store_id uuid,
  p_days     int default 7
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_result jsonb;
begin
  if not is_store_owner(p_store_id) then
    raise exception 'not_store_owner';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('date', d, 'revenue', rev, 'count', cnt) order by d), '[]'::jsonb)
    into v_result
    from (
      select
        g.d,
        coalesce(sum(case when o.status in ('paid','processing','completed') then o.total end), 0) as rev,
        count(case when o.status in ('paid','processing','completed') then 1 end) as cnt
      from generate_series(
        ((now() at time zone 'Asia/Shanghai')::date - (p_days - 1)),
        (now() at time zone 'Asia/Shanghai')::date,
        '1 day'::interval
      ) g(d)
      left join orders o
        on o.store_id = p_store_id
       and (o.created_at at time zone 'Asia/Shanghai')::date = g.d
      group by g.d
    ) t;

  return v_result;
end $$;

-- 权限：仅 authenticated（owner 在函数内校验）
revoke all on function daily_stats(uuid, date) from public;
grant execute on function daily_stats(uuid, date) to authenticated;
revoke all on function daily_trend(uuid, int) from public;
grant execute on function daily_trend(uuid, int) to authenticated;
