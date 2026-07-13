-- ============================================================
-- v4 阶段1: 服务商模式支付基建 + 缺陷修复
--   1) wxpay_merchant 表: store_id ↔ sub_mchid 映射 + 进件状态
--   2) 修复 D1: cancel_order 回滚会员余额 + 写 refund 流水
--   3) 修复 D2: list_order_status RPC(顾客端轮询订单状态)
--   4) 修复 D3: POS 动作 RPC 加跨店归属校验
--   5) refund_order_by_id RPC(微信退款回调/Edge Function 用)
-- 幂等可重跑
-- ============================================================

-- ============================================================
-- 1) wxpay_merchant: 服务商模式下,每个门店对应一个特约商户号(sub_mchid)
--    进件流程: 平台管理端 submit -> 微信进件 API -> approved(sub_mchid 落库)
--    资质到位前: application_status 可为 approved 但 sub_mchid 为 mock 值
-- ============================================================
create table if not exists wxpay_merchant (
  store_id uuid primary key references store(id) on delete cascade,
  sub_mchid text,                        -- 微信支付特约商户号(进件成功后才有)
  application_status text not null default 'pending',  -- pending / submitted / approved / rejected
  legal_name text,                       -- 法人/商户名称(进件资料)
  contact_phone text,                    -- 联系电话
  business_license_no text,              -- 营业执照号
  applied_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_reason text,
  raw_response jsonb,                    -- 微信进件 API 返回(或 mock)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table wxpay_merchant enable row level security;
revoke all on wxpay_merchant from anon, authenticated;
-- 仅 service_role(平台管理端 / Edge Fn)可读写;门店老板只读自己店
create policy wxpay_merchant_owner_read on wxpay_merchant for select to authenticated
  using (store_id in (select store_id from store_owner where user_id = auth.uid()));
grant select on wxpay_merchant to authenticated;

-- 进件申请(平台管理端 / 老板自助提交,均经 service_role 或 owner)
create or replace function submit_merchant_application(
  p_store_id uuid, p_legal_name text, p_contact_phone text, p_business_license_no text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare m wxpay_merchant%rowtype;
begin
  -- 仅该店 owner 可提交
  if not exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  insert into wxpay_merchant(store_id, legal_name, contact_phone, business_license_no, application_status, applied_at)
    values (p_store_id, p_legal_name, p_contact_phone, p_business_license_no, 'pending', now())
    on conflict (store_id) do update
      set legal_name = excluded.legal_name,
          contact_phone = excluded.contact_phone,
          business_license_no = excluded.business_license_no,
          application_status = case when wxpay_merchant.application_status = 'approved' then 'approved' else 'pending' end,
          updated_at = now()
    returning * into m;
  return to_jsonb(m);
end $$;
revoke all on function submit_merchant_application(uuid,text,text,text) from public;
grant execute on function submit_merchant_application(uuid,text,text,text) to authenticated;

-- 平台审批进件(仅 service_role: 平台管理端 / Edge Fn 调微信进件 API 后回写)
create or replace function approve_merchant_application(
  p_store_id uuid, p_sub_mchid text, p_raw_response jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare m wxpay_merchant%rowtype;
begin
  update wxpay_merchant
    set application_status='approved', sub_mchid=p_sub_mchid, approved_at=now(),
        raw_response=coalesce(p_raw_response, raw_response), updated_at=now()
    where store_id=p_store_id and application_status in ('pending','submitted','rejected')
    returning * into m;
  if m.store_id is null then
    -- 已 approved 的幂等返回
    select * into m from wxpay_merchant where store_id=p_store_id and application_status='approved';
    if m.store_id is null then raise exception 'application_not_found'; end if;
    return jsonb_build_object('store_id',p_store_id,'status','approved','idempotent',true);
  end if;
  return to_jsonb(m);
end $$;
revoke all on function approve_merchant_application(uuid,text,jsonb) from public;
grant execute on function approve_merchant_application(uuid,text,jsonb) to service_role;

-- 查门店的 sub_mchid(Edge Function wxpay-create 用,仅 service_role)
create or replace function get_store_sub_mchid(p_store_id uuid)
returns text language sql security definer set search_path=public stable as $$
  select sub_mchid from wxpay_merchant where store_id=p_store_id and application_status='approved' and sub_mchid is not null;
$$;
revoke all on function get_store_sub_mchid(uuid) from public;
grant execute on function get_store_sub_mchid(uuid) to service_role;

-- ============================================================
-- 2) 修复 D1: cancel_order 回滚会员余额 + 写 refund 流水
--    原 cancel_order 只置 refunded 状态,余额支付的订单退款后钱没了
--    现修复: 若订单是余额支付(pay_method='balance' 且有 member_id),回滚余额 + 写 refund 流水
-- ============================================================
create or replace function cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_status order_status; v_new order_status;
  v_order orders%rowtype; v_bal numeric(10,2);
  v_wx_txn text;
begin
  select * into v_order from orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  v_status := v_order.status;
  if v_status in ('created') then v_new:='cancelled';
  elsif v_status in ('paid','processing') then v_new:='refunded';
  else raise exception 'order_not_cancelable'; end if;

  -- 余额支付的订单: 回滚会员余额 + 写 refund 流水
  if v_new='refunded' and v_order.pay_method='balance' and v_order.member_id is not null then
    update member set balance = balance + v_order.total,
                      total_spent = greatest(total_spent - v_order.total, 0),
                      visit_count = greatest(visit_count - 1, 0)
      where id=v_order.member_id returning balance into v_bal;
    insert into stored_value_txn(store_id, member_id, type, amount, balance_after, order_id)
      values (v_order.store_id, v_order.member_id, 'refund', v_order.total, v_bal, v_order.id);
  end if;

  -- 微信支付的订单: 退款流水先占位(实际退款由 wxpay-refund Edge Function 调微信退款 API)
  -- refund 流水在微信退款回调成功后由 refund_order_by_id 写入
  update orders set status=v_new, cancel_reason=p_reason, refunded_at=now() where id=p_order_id;
  return jsonb_build_object('order_id',p_order_id,'status',v_new,
                            'balance_refunded', v_new='refunded' and v_order.pay_method='balance');
end $$;
-- 重新授权(原 grant 保持)
revoke all on function cancel_order(uuid,text) from public;
grant execute on function cancel_order(uuid,text) to authenticated, service_role;

-- orders 加退款时间字段(幂等)
alter table orders add column if not exists refunded_at timestamptz;

-- ============================================================
-- 3) refund_order_by_id: 微信退款成功后回写(仅 service_role)
--    供 wxpay-refund Edge Function 在微信退款 API 成功后调用
--    若是余额支付订单,余额已在 cancel_order 回滚,此处仅幂等置状态
--    若是微信支付订单,此处置 refunded + 写 refund 流水(资金由微信原路退回)
-- ============================================================
create or replace function refund_order_by_id(
  p_order_id uuid, p_wx_refund_id text default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_order orders%rowtype; v_id uuid; v_bal numeric(10,2);
begin
  select * into v_order from orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  -- 幂等: 已 refunded 直接返回
  if v_order.status='refunded' then
    return jsonb_build_object('order_id',p_order_id,'status','refunded','idempotent',true);
  end if;
  if v_order.status not in ('paid','processing') then raise exception 'order_not_refundable'; end if;

  -- 余额支付订单: 余额回滚(若 cancel_order 未回滚,此处兜底)
  if v_order.pay_method='balance' and v_order.member_id is not null then
    if not exists(select 1 from stored_value_txn where order_id=p_order_id and type='refund') then
      update member set balance = balance + v_order.total,
                        total_spent = greatest(total_spent - v_order.total, 0),
                        visit_count = greatest(visit_count - 1, 0)
        where id=v_order.member_id returning balance into v_bal;
      insert into stored_value_txn(store_id, member_id, type, amount, balance_after, order_id)
        values (v_order.store_id, v_order.member_id, 'refund', v_order.total, v_bal, p_order_id);
    end if;
  end if;

  update orders set status='refunded', cancel_reason=coalesce(p_reason, cancel_reason),
                    refunded_at=now(), wx_refund_id=coalesce(p_wx_refund_id, wx_refund_id)
    where id=p_order_id returning id into v_id;
  return jsonb_build_object('order_id',v_id,'status','refunded');
end $$;
revoke all on function refund_order_by_id(uuid,text,text) from public;
grant execute on function refund_order_by_id(uuid,text,text) to service_role;

-- orders 加微信退款单号字段(幂等)
alter table orders add column if not exists wx_refund_id text;

-- ============================================================
-- 4) 修复 D2: 顾客端订单状态轮询 RPC
--    顾客凭 customer_ref 查本店订单状态(轻量,只返回状态变更)
--    小程序轮询调用,替代永远返回 [] 的 orderSync.ts mock
-- ============================================================
create or replace function list_order_status(p_store_id uuid, p_customer_ref text, p_since timestamptz default null)
returns setof jsonb language sql security definer set search_path=public stable as $$
  select jsonb_build_object(
    'order_id', o.id,
    'order_no', o.order_no,
    'status', o.status,
    'updated_at', coalesce(o.completed_at, o.refunded_at, o.paid_at, o.printed_at, o.created_at)
  ) from orders o
  where o.store_id=p_store_id
    and o.customer_ref=p_customer_ref
    and (p_since is null or coalesce(o.completed_at, o.refunded_at, o.paid_at, o.printed_at, o.created_at) > p_since)
  order by o.created_at desc
  limit 50;
$$;
revoke all on function list_order_status(uuid,text,timestamptz) from public;
grant execute on function list_order_status(uuid,text,timestamptz) to anon, authenticated;

-- ============================================================
-- 5) 修复 D3: POS 动作 RPC 加跨店归属校验
--    原注释(0008_staff_auth.sql:37)明确"多门店硬化列 P4 TODO"
--    现 v4 补齐: accept/complete/cancel/clear_table 校验 order.store_id = current_staff_store()
--    (owner 可跨店,经 is_store_owner 判定)
-- ============================================================
create or replace function is_store_owner(p_store_id uuid)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid());
$$;
revoke all on function is_store_owner(uuid) from public;
grant execute on function is_store_owner(uuid) to authenticated;

-- accept_order 加跨店校验
create or replace function accept_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_store uuid;
begin
  select store_id into v_store from orders where id=p_order_id;
  if v_store is null then raise exception 'order_not_found'; end if;
  if v_store <> current_staff_store() and not is_store_owner(v_store) then
    raise exception 'cross_store_forbidden';
  end if;
  update orders set status='processing', printed_at=coalesce(printed_at,now())
    where id=p_order_id and status='paid' returning id into v_id;
  if v_id is null then raise exception 'order_not_acceptable'; end if;
  return jsonb_build_object('order_id',v_id,'status','processing');
end $$;
revoke all on function accept_order(uuid) from public;
grant execute on function accept_order(uuid) to authenticated, service_role;

-- complete_order 加跨店校验
create or replace function complete_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_store uuid;
begin
  select store_id into v_store from orders where id=p_order_id;
  if v_store is null then raise exception 'order_not_found'; end if;
  if v_store <> current_staff_store() and not is_store_owner(v_store) then
    raise exception 'cross_store_forbidden';
  end if;
  update orders set status='completed', completed_at=now()
    where id=p_order_id and status='processing' returning id into v_id;
  if v_id is null then raise exception 'order_not_completable'; end if;
  return jsonb_build_object('order_id',v_id,'status','completed');
end $$;
revoke all on function complete_order(uuid) from public;
grant execute on function complete_order(uuid) to authenticated, service_role;

-- cancel_order 加跨店校验(在原逻辑基础上前置校验)
-- 注意: 上面已重新定义 cancel_order(D1 修复),此处再覆盖一次加校验
create or replace function cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_status order_status; v_new order_status;
  v_order orders%rowtype; v_bal numeric(10,2);
begin
  select * into v_order from orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'order_not_found'; end if;
  -- D3 跨店校验
  if v_order.store_id <> current_staff_store() and not is_store_owner(v_order.store_id) then
    raise exception 'cross_store_forbidden';
  end if;
  v_status := v_order.status;
  if v_status in ('created') then v_new:='cancelled';
  elsif v_status in ('paid','processing') then v_new:='refunded';
  else raise exception 'order_not_cancelable'; end if;

  -- D1: 余额支付订单回滚余额
  if v_new='refunded' and v_order.pay_method='balance' and v_order.member_id is not null then
    update member set balance = balance + v_order.total,
                      total_spent = greatest(total_spent - v_order.total, 0),
                      visit_count = greatest(visit_count - 1, 0)
      where id=v_order.member_id returning balance into v_bal;
    insert into stored_value_txn(store_id, member_id, type, amount, balance_after, order_id)
      values (v_order.store_id, v_order.member_id, 'refund', v_order.total, v_bal, v_order.id);
  end if;

  update orders set status=v_new, cancel_reason=p_reason, refunded_at=now() where id=v_order.id;
  return jsonb_build_object('order_id',p_order_id,'status',v_new,
                            'balance_refunded', v_new='refunded' and v_order.pay_method='balance');
end $$;
revoke all on function cancel_order(uuid,text) from public;
grant execute on function cancel_order(uuid,text) to authenticated, service_role;

-- clear_table 加跨店校验
create or replace function clear_table(p_point_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_session uuid; v_store uuid;
begin
  select store_id into v_store from service_point where id=p_point_id;
  if v_store is null then raise exception 'point_not_found'; end if;
  if v_store <> current_staff_store() and not is_store_owner(v_store) then
    raise exception 'cross_store_forbidden';
  end if;
  select current_session_id into v_session from service_point where id=p_point_id;
  if v_session is not null then
    update dining_session set status='closed', closed_at=now() where id=v_session;
  end if;
  update service_point set current_session_id=null, status='idle' where id=p_point_id;
  return jsonb_build_object('point_id',p_point_id,'closed_session',v_session);
end $$;
revoke all on function clear_table(uuid) from public;
grant execute on function clear_table(uuid) to authenticated, service_role;
