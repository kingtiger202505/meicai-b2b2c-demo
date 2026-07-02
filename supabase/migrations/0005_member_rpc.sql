-- ============================================================
-- P2.5 会员/储值 RPC（security definer）
-- ============================================================

-- 建/取会员（小程序 wx.login 后调；支付成功页授权手机号后可再调补 phone）
create or replace function get_or_create_member(p_store_id uuid, p_openid text, p_phone text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m member%rowtype;
begin
  if not exists(select 1 from store where id=p_store_id) then raise exception 'store_not_found'; end if;
  insert into member(store_id, openid, phone) values (p_store_id, p_openid, p_phone)
    on conflict (store_id, openid) do update
      set phone = coalesce(excluded.phone, member.phone),
          last_visit_at = now()
    returning * into m;
  return to_jsonb(m);
end $$;

-- 查会员（凭 openid）
create or replace function get_member(p_store_id uuid, p_openid text)
returns jsonb language sql security definer set search_path=public stable as $$
  select to_jsonb(m) from member m where m.store_id=p_store_id and m.openid=p_openid;
$$;

-- 充值入账（由 wxpay-notify 在核验真实支付后调用；p_gift 为赠送额）
create or replace function topup_member(p_member_id uuid, p_amount numeric, p_wx_transaction_id text, p_gift numeric default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_bal numeric(10,2);
begin
  if p_amount <= 0 then raise exception 'bad_amount'; end if;
  -- 幂等：同一微信支付单号只入账一次
  if p_wx_transaction_id is not null and exists(
      select 1 from stored_value_txn where wx_transaction_id=p_wx_transaction_id and type='topup') then
    select balance into v_bal from member where id=p_member_id;
    return jsonb_build_object('member_id',p_member_id,'balance',v_bal,'idempotent',true);
  end if;
  update member set balance = balance + p_amount + coalesce(p_gift,0)
    where id=p_member_id returning store_id, balance into v_store, v_bal;
  if v_store is null then raise exception 'member_not_found'; end if;
  insert into stored_value_txn(store_id,member_id,type,amount,balance_after,wx_transaction_id)
    values (v_store,p_member_id,'topup',p_amount+coalesce(p_gift,0),v_bal,p_wx_transaction_id);
  return jsonb_build_object('member_id',p_member_id,'balance',v_bal);
end $$;

-- 余额支付（原子扣减；created->paid）
create or replace function pay_with_balance(p_order_token uuid, p_member_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o orders%rowtype; v_bal numeric(10,2);
begin
  select * into o from orders where order_token=p_order_token for update;
  if o.id is null then raise exception 'order_not_found'; end if;
  if o.status <> 'created' then raise exception 'order_not_payable'; end if;
  select balance into v_bal from member where id=p_member_id and store_id=o.store_id for update;
  if v_bal is null then raise exception 'member_not_found'; end if;
  if v_bal < o.total then raise exception 'insufficient_balance'; end if;
  update member set balance = balance - o.total, total_spent = total_spent + o.total,
                    visit_count = visit_count + 1, last_visit_at = now()
    where id=p_member_id returning balance into v_bal;
  insert into stored_value_txn(store_id,member_id,type,amount,balance_after,order_id)
    values (o.store_id,p_member_id,'consume',-o.total,v_bal,o.id);
  update orders set status='paid', paid_at=now(), pay_method='balance', member_id=p_member_id
    where id=o.id;
  return jsonb_build_object('order_id',o.id,'status','paid','balance',v_bal);
end $$;

-- 发券
create or replace function issue_coupon(p_store_id uuid, p_member_id uuid, p_kind coupon_kind,
  p_value numeric, p_threshold numeric default 0, p_expire_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c coupon%rowtype;
begin
  insert into coupon(store_id,member_id,kind,threshold,value,expire_at)
    values (p_store_id,p_member_id,p_kind,coalesce(p_threshold,0),p_value,p_expire_at)
    returning * into c;
  return to_jsonb(c);
end $$;

-- grants
revoke all on function get_or_create_member(uuid,text,text) from public;
revoke all on function get_member(uuid,text) from public;
revoke all on function pay_with_balance(uuid,uuid) from public;
revoke all on function topup_member(uuid,numeric,text,numeric) from public;
revoke all on function issue_coupon(uuid,uuid,coupon_kind,numeric,numeric,timestamptz) from public;
grant execute on function get_or_create_member(uuid,text,text) to anon, authenticated;
grant execute on function get_member(uuid,text) to anon, authenticated;
grant execute on function pay_with_balance(uuid,uuid) to anon, authenticated;
-- 充值入账/发券只允许受信端（Edge Fn service_role / 门店 authenticated）
grant execute on function topup_member(uuid,numeric,text,numeric) to service_role;
grant execute on function issue_coupon(uuid,uuid,coupon_kind,numeric,numeric,timestamptz) to service_role, authenticated;
