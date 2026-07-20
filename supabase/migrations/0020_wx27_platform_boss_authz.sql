-- ============================================================
-- WX-27 修复: 平台管理端(商家 KYC 审核)走 boss 鉴权,无需把 service_role 打进公网 :8083
--
-- 背景(两个叠加根因,QA 07-17 复现):
--   ① :8083 以 anon 模式部署(不含 service_role,安全上正确)→ platformClient 用登录后的
--      authenticated 会话查 wxpay_merchant;
--   ② 线上库 wxpay_merchant 缺 authenticated 的 SELECT 授权 → 连老板查自己店都 403。
--      根因: 0015 的 `revoke all ... from authenticated` 与 `grant select ... to authenticated`
--      是两条独立语句;线上重跑 0015 时在中间的 `create policy`(已存在)处报错中断,
--      revoke 已提交而 re-grant 未执行 → 授权漂移。
--
-- 本迁移: 补回授权 + 加 boss 跨店只读策略 + 放开 approve 给 authenticated(函数内校验 boss)。
-- 幂等可重跑(grant 幂等 / drop policy if exists / create or replace)。
-- ============================================================

-- 平台超管判定: 请求 JWT 的 app_metadata.role = 'boss'
-- (用 current_setting 直读 request.jwt.claims,不依赖 auth.jwt() 是否存在;缺失时安全返回 false)
create or replace function is_platform_boss() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb
       -> 'app_metadata' ->> 'role') = 'boss',
    false
  );
$$;
revoke all on function is_platform_boss() from public;
grant execute on function is_platform_boss() to authenticated;

-- 1) 修授权漂移: 补回 authenticated 的 SELECT(幂等)
grant select on wxpay_merchant to authenticated;

-- 2) boss 跨店只读策略(与既有 wxpay_merchant_owner_read 叠加, permissive OR):
--    平台超管可读全部进件;普通老板仍只读自己店。
drop policy if exists wxpay_merchant_boss_read on wxpay_merchant;
create policy wxpay_merchant_boss_read on wxpay_merchant for select to authenticated
  using (is_platform_boss());

-- 2b) boss 跨店读 store_owner(平台"商户列表"要显示门店归属;store_owner 原策略仅本人可读)
drop policy if exists store_owner_boss_read on store_owner;
create policy store_owner_boss_read on store_owner for select to authenticated
  using (is_platform_boss());

-- 3) approve_merchant_application: 放开给 authenticated,但函数体内校验 boss(防越权),
--    这样平台端无需 service_role 即可审批。函数体与 0015 一致,仅加首行 boss 校验。
create or replace function approve_merchant_application(
  p_store_id uuid, p_sub_mchid text, p_raw_response jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare m wxpay_merchant%rowtype;
begin
  if not is_platform_boss() then raise exception 'not_platform_boss'; end if;
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
grant execute on function approve_merchant_application(uuid,text,jsonb) to authenticated, service_role;
