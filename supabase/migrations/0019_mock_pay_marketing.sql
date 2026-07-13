-- ============================================================
-- 0019 营销规则联动：给 mock_pay_order 串联营销引擎触发器
-- 幂等可重跑。
-- ============================================================

create or replace function mock_pay_order(p_order_token uuid, p_openid text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o orders%rowtype; v_member_id uuid; m jsonb;
begin
  select * into o from orders where order_token=p_order_token for update;
  if o.id is null then raise exception 'order_not_found'; end if;
  if o.status <> 'created' then
    if o.status='paid' then return jsonb_build_object('order_id',o.id,'status','paid','idempotent',true); end if;
    raise exception 'order_not_payable';
  end if;
  -- 无感沉淀会员(有 openid 才建)
  if p_openid is not null then
    m := get_or_create_member(o.store_id, p_openid, p_phone);
    v_member_id := (m->>'id')::uuid;
    update member set total_spent = total_spent + o.total, visit_count = visit_count + 1, last_visit_at = now()
      where id = v_member_id;
  end if;
  update orders set status='paid', paid_at=now(), pay_method='mock', member_id=v_member_id
    where id=o.id;

  -- 触发营销引擎
  if v_member_id is not null then
    -- 执行首单送券规则
    perform run_marketing_rules(o.store_id, v_member_id, 'first_order');
    -- 执行每次支付成功规则
    perform run_marketing_rules(o.store_id, v_member_id, 'pay_order');
  end if;

  return jsonb_build_object('order_id',o.id,'status','paid','member_id',v_member_id);
end $$;
