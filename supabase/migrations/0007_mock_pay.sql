-- ============================================================
-- Dev mock 支付：一步完成 支付成功 + 无感建会员 + 关联订单
-- 与真微信支付回调(wxpay-notify)行为一致,商户号到位后换真支付即可
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
  return jsonb_build_object('order_id',o.id,'status','paid','member_id',v_member_id);
end $$;
revoke all on function mock_pay_order(uuid,text,text) from public;
grant execute on function mock_pay_order(uuid,text,text) to anon, authenticated;
