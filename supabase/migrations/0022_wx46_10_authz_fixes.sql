-- ============================================================
-- WX-46 #10 修复：补两处后端授权缺失
--   A) list_staff：security definer 函数体内**无身份校验**，仅靠 grant，
--      导致任意 authenticated、甚至匿名(anon) 都能拉取任意门店员工名册。
--      → 函数体加门店 owner 校验（与 upsert_staff / delete_staff 同门禁），并从 anon 收回执行权。
--   B) refund_order_by_id：0015 已 revoke public / grant service_role，但线上库因
--      迁移账本回填(0001-0019 标记已应用而未实跑) 未真正生效，anon/收银员仍可进入退款函数体。
--      → 本迁移(新文件，会实跑) 显式收紧执行权限至 service_role。
-- 幂等可重跑。依赖 0011(store_owner) / 0015 / 0016。
-- ============================================================

-- A) list_staff：仅门店 owner 可读本店员工
create or replace function list_staff(p_store_id uuid)
returns setof jsonb language plpgsql security definer set search_path=public stable as $$
begin
  if not exists (select 1 from store_owner where store_id = p_store_id and user_id = auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  return query
    select jsonb_build_object(
      'user_id', s.user_id, 'store_id', s.store_id, 'name', s.name,
      'role_id', s.role_id, 'role_name', r.name, 'created_at', s.created_at
    )
    from staff s
    left join role r on r.id = s.role_id
    where s.store_id = p_store_id
    order by s.created_at;
end $$;
revoke all on function list_staff(uuid) from public;
revoke execute on function list_staff(uuid) from anon;
grant execute on function list_staff(uuid) to authenticated;

-- B) refund_order_by_id：仅 service_role（经 wxpay-refund Edge Function 调用）
revoke all on function refund_order_by_id(uuid, text, text) from public;
revoke execute on function refund_order_by_id(uuid, text, text) from anon, authenticated;
grant execute on function refund_order_by_id(uuid, text, text) to service_role;
