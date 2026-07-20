-- ============================================================
-- WX-46 员工管理 RBAC 完整化
--   1) 补 permission / role_permission 只读 RLS 策略（角色·权限矩阵可读）
--   2) delete_staff：老板解除员工的门店绑定（解绑移除）
-- 幂等可重跑。依赖 0016(RBAC 表) / 0011(store_owner)。
-- ============================================================

-- 1) 权限字典 + 角色权限映射 只读策略
--    0016 对 permission / role_permission 开了 RLS，但漏建 select 策略，
--    导致 authenticated（含老板端）读到 0 行 → 角色·权限矩阵为空。这里补齐。
drop policy if exists permission_read on permission;
create policy permission_read on permission for select to authenticated using (true);

drop policy if exists role_permission_read on role_permission;
create policy role_permission_read on role_permission for select to authenticated
  using (
    exists (
      select 1 from role r
      where r.id = role_permission.role_id
        and (r.store_id is null
             or r.store_id in (select store_id from store_owner where user_id = auth.uid()))
    )
  );

-- 2) 解绑/移除员工（老板用）：删除本店 staff 绑定；
--    Auth 账号保留，但失去本店访问（current_staff_store() 变为 null）。
--    不允许移除门店老板本身。
create or replace function delete_staff(p_user_id uuid, p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from store_owner where store_id=p_store_id and user_id=auth.uid()) then
    raise exception 'not_store_owner';
  end if;
  if exists(select 1 from store_owner where store_id=p_store_id and user_id=p_user_id) then
    raise exception 'cannot_remove_owner';
  end if;
  delete from staff where user_id=p_user_id and store_id=p_store_id;
  if not found then raise exception 'staff_not_found'; end if;
  return jsonb_build_object('deleted', p_user_id);
end $$;
revoke all on function delete_staff(uuid,uuid) from public;
grant execute on function delete_staff(uuid,uuid) to authenticated;
