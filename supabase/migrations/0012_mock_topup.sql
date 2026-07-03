-- ============================================================
-- Dev mock 储值充值：一步完成 建/取会员 + 余额入账（含赠送）
-- 与 0007_mock_pay 同款套路：anon 只能调这个 security definer 包装函数，
-- 内部再调受信的 topup_member（service_role 专属），跑通「充值→余额支付」闭环，
-- 不被真微信支付(WX-6/WX-11)阻塞。商户号到位后前端切真支付回调即可下线本函数。
--
-- 赠送规则（PRD 定稿 Q1）：每满 100 送 20，累进（floor(amount/100)*20）。
-- ============================================================
create or replace function mock_topup_member(
  p_store_id uuid, p_openid text, p_amount numeric, p_phone text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m jsonb; v_member_id uuid; v_gift numeric; v_res jsonb;
begin
  if p_amount <= 0 then raise exception 'bad_amount'; end if;
  -- 无感建/取会员（openid 主键）
  m := get_or_create_member(p_store_id, p_openid, p_phone);
  v_member_id := (m->>'id')::uuid;
  -- 每满 100 送 20，累进
  v_gift := floor(p_amount / 100) * 20;
  -- mock 无真实微信单号：合成一个幂等键（形如 MOCK_<uuid>）
  v_res := topup_member(v_member_id, p_amount, 'MOCK_' || gen_random_uuid()::text, v_gift);
  return v_res || jsonb_build_object('gift', v_gift, 'amount', p_amount, 'member_id', v_member_id);
end $$;

revoke all on function mock_topup_member(uuid,text,numeric,text) from public;
grant execute on function mock_topup_member(uuid,text,numeric,text) to anon, authenticated;
