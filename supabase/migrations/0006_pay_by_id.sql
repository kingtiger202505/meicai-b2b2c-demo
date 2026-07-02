-- ============================================================
-- 供微信支付回调使用：按订单ID置 paid（幂等，仅 service_role）
-- 微信 out_trade_no = orders.id(uuid hex, 全局唯一)
-- ============================================================
create or replace function pay_order_by_id(p_order_id uuid, p_wx_transaction_id text default null, p_pay_method text default 'wechat')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  select id into v_id from orders where id=p_order_id and status='paid';
  if v_id is not null then return jsonb_build_object('order_id',v_id,'status','paid','idempotent',true); end if;
  update orders set status='paid', paid_at=now(), pay_method=coalesce(p_pay_method,pay_method)
    where id=p_order_id and status='created' returning id into v_id;
  if v_id is null then raise exception 'order_not_payable'; end if;
  return jsonb_build_object('order_id',v_id,'status','paid');
end $$;
revoke all on function pay_order_by_id(uuid,text,text) from public;
grant execute on function pay_order_by_id(uuid,text,text) to service_role;
