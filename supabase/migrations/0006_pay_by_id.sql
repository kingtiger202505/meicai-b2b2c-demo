-- ============================================================
-- 供微信支付回调使用：按订单ID置 paid（幂等，仅 service_role）
-- 微信 out_trade_no = orders.id(uuid hex, 全局唯一)
-- 同时关联会员消费统计并触发营销规则
-- ============================================================
create or replace function pay_order_by_id(
  p_order_id uuid, 
  p_wx_transaction_id text default null, 
  p_pay_method text default 'wechat',
  p_openid text default null,
  p_phone text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare 
  v_id uuid; 
  o orders%rowtype; 
  v_member_id uuid; 
  m jsonb;
begin
  select * into o from orders where id=p_order_id for update;
  if o.id is null then raise exception 'order_not_found'; end if;
  
  if o.status = 'paid' then 
    return jsonb_build_object('order_id',o.id,'status','paid','idempotent',true); 
  end if;
  if o.status <> 'created' then 
    raise exception 'order_not_payable'; 
  end if;

  -- 微信回调支持传入 openid 沉淀或绑定会员
  if p_openid is not null then
    m := get_or_create_member(o.store_id, p_openid, p_phone);
    v_member_id := (m->>'id')::uuid;
    update member set total_spent = total_spent + o.total, visit_count = visit_count + 1, last_visit_at = now()
      where id = v_member_id;
  end if;

  update orders set 
    status='paid', 
    paid_at=now(), 
    pay_method=coalesce(p_pay_method, pay_method),
    member_id=coalesce(v_member_id, member_id)
    where id=p_order_id returning id into v_id;

  -- 触发营销引擎
  if v_member_id is not null or o.member_id is not null then
    declare
      v_trigger_member_id uuid := coalesce(v_member_id, o.member_id);
    begin
      -- 执行首单送券规则
      perform run_marketing_rules(o.store_id, v_trigger_member_id, 'first_order');
      -- 执行每次支付成功规则
      perform run_marketing_rules(o.store_id, v_trigger_member_id, 'pay_order');
    end;
  end if;

  return jsonb_build_object('order_id',v_id,'status','paid');
end $$;
revoke all on function pay_order_by_id(uuid,text,text) from public;
revoke all on function pay_order_by_id(uuid,text,text,text,text) from public;
grant execute on function pay_order_by_id(uuid,text,text,text,text) to service_role;
