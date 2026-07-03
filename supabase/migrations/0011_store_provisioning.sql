-- ============================================================
-- WX-19 门店与老板的开通/分配 —— 生产可用的「开店」机制
--   复用 WX-18(0009) 的 store / store_owner / list_my_stores() 数据模型,
--   不改动 0009 的菜单维护逻辑;0009 的门店/映射 seed 仅 demo 用途。
--
--   点1(必做)provision_store(...)  —— 运营开店,SECURITY DEFINER,仅 service_role 可调
--     一次执行产出:① Supabase Auth 老板用户(role=owner) ② store 一条 ③ store_owner 关联一条
--     幂等:相同(老板邮箱 + 门店名)重复执行不产生重复门店/重复关联,明确返回 status=already_exists
--   点2(可选)create_store(...)      —— 老板自助加分店,SECURITY DEFINER,authenticated 可调
--     插 store 同时写 store_owner(auth.uid(), 新店);谁建谁拥有,越权/未登录拒绝、不静默建店
--
-- 幂等可重跑。additive-only,不改动既有迁移。
-- ============================================================

-- ---------- 餐饮默认术语(与 0009 seed 同形态,新店开箱即用) ----------
-- 供 provision_store / create_store 缺省填充,前端 miniapp/POS 依赖 terminology 渲染文案。

-- ============================================================
-- 点1: provision_store —— 运营开店(service_role 调用)
--   输入:门店名 + 老板邮箱 + 初始密码(+ 可选 行业/术语/主题)
--   幂等键:(老板邮箱, lower(门店名))
--     · 老板按 email 查回;不存在则 best-effort 直建 auth 用户(同 0009 的自包含 seed 手法)
--     · 门店按「该老板名下同名店」判重;已存在则复用,不新建、不重复绑定
--   返回 jsonb: {status, owner_id, owner_email, owner_created, store_id, store_name, store_created}
-- ============================================================
create or replace function provision_store(
  p_store_name     text,
  p_owner_email    text,
  p_owner_password text  default null,
  p_industry_type  text  default 'restaurant',
  p_terminology    jsonb default null,
  p_theme          jsonb default '{"primary":"#E43D30","tone":"warm"}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_owner         uuid;
  v_store         uuid;
  v_created_owner boolean := false;
  v_created_store boolean := false;
  v_email text := lower(btrim(coalesce(p_owner_email, '')));
  v_name  text := btrim(coalesce(p_store_name, ''));
  v_term  jsonb := coalesce(p_terminology, '{
    "point":"桌台","point_short":"桌","session":"就餐","item":"菜品",
    "kitchen_ticket":"后厨单","customer_ticket":"小票","sold_out":"沽清",
    "processing":"备餐中","fulfill":"上菜"
  }'::jsonb);
begin
  if length(v_name)  = 0 then raise exception 'store_name_required'; end if;
  if length(v_email) = 0 then raise exception 'owner_email_required'; end if;

  -- 1) 老板 Auth 用户:按 email 复用,否则 best-effort 直建(role=owner)
  select id into v_owner from auth.users where lower(email) = v_email limit 1;

  if v_owner is null then
    if p_owner_password is null or length(btrim(p_owner_password)) = 0 then
      raise exception 'owner_password_required_to_create_user';
    end if;
    v_owner := gen_random_uuid();
    begin
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        raw_app_meta_data, raw_user_meta_data, is_super_admin
      ) values (
        '00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
        v_email, crypt(p_owner_password, gen_salt('bf')),
        now(), now(), now(),
        '', '', '', '',
        '{"provider":"email","providers":["email"],"role":"owner"}'::jsonb,
        '{"role":"owner"}'::jsonb, false
      );
      insert into auth.identities (
        provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        v_owner::text, v_owner,
        jsonb_build_object('sub', v_owner::text, 'email', v_email, 'email_verified', true),
        'email', now(), now(), now()
      );
      v_created_owner := true;
    exception when others then
      -- 目标 Supabase 的 auth schema 形状不同 → 忽略直建,回退到「按 email 查回」
      select id into v_owner from auth.users where lower(email) = v_email limit 1;
      if v_owner is null then
        raise exception
          'owner_auth_create_failed: 请先在 Supabase Auth 建好 %(或用 scripts/provision-store.mjs 走 Admin API)再重跑本函数。cause: %',
          v_email, sqlerrm;
      end if;
    end;
  else
    -- 已存在的老板:补打 role=owner 标记(幂等、不覆盖其它 metadata)
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"owner"}'::jsonb
     where id = v_owner
       and coalesce(raw_app_meta_data ->> 'role', '') <> 'owner';
  end if;

  -- 2) 门店:按「该老板名下同名店」判重,幂等
  select s.id into v_store
    from store s
    join store_owner o on o.store_id = s.id
   where o.user_id = v_owner and lower(s.name) = lower(v_name)
   limit 1;

  if v_store is null then
    insert into store (name, industry_type, terminology, theme)
      values (v_name, coalesce(nullif(btrim(p_industry_type), ''), 'restaurant'),
              v_term, coalesce(p_theme, '{}'::jsonb))
      returning id into v_store;
    v_created_store := true;
  end if;

  -- 3) 归属关联(幂等)
  insert into store_owner (user_id, store_id) values (v_owner, v_store)
    on conflict do nothing;

  return jsonb_build_object(
    'status',        case when v_created_store then 'created' else 'already_exists' end,
    'owner_id',      v_owner,
    'owner_email',   v_email,
    'owner_created', v_created_owner,
    'store_id',      v_store,
    'store_name',    v_name,
    'store_created', v_created_store
  );
end $$;

-- provision_store 会建 Auth 用户 + 建店 → 严禁 anon/authenticated 调用,仅 service_role(运营)可调
revoke all on function provision_store(text,text,text,text,jsonb,jsonb) from public;
revoke all on function provision_store(text,text,text,text,jsonb,jsonb) from anon, authenticated;
grant execute on function provision_store(text,text,text,text,jsonb,jsonb) to service_role;

-- ============================================================
-- 点2: create_store —— 老板自助加分店(authenticated 调用)
--   · 校验:已登录 且 已是 owner(在 store_owner 中拥有 ≥1 家店);未登录/非 owner 拒绝、不静默建店
--   · 谁建谁拥有:插 store 同时写 store_owner(auth.uid(), 新店)
--   · 幂等:同名店(本人名下)已存在则复用,不新建
--   注:老板的「第一家店」由运营经 provision_store 开出;create_store 仅用于既有老板加分店。
-- ============================================================
create or replace function create_store(
  p_name          text,
  p_industry_type text  default 'restaurant',
  p_terminology   jsonb default null,
  p_theme         jsonb default '{"primary":"#E43D30","tone":"warm"}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_store uuid;
  v_name  text := btrim(coalesce(p_name, ''));
  v_term  jsonb := coalesce(p_terminology, '{
    "point":"桌台","point_short":"桌","session":"就餐","item":"菜品",
    "kitchen_ticket":"后厨单","customer_ticket":"小票","sold_out":"沽清",
    "processing":"备餐中","fulfill":"上菜"
  }'::jsonb);
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  -- owner 判定:必须已拥有至少一家门店(与 admin 进入门槛一致);店员/顾客被拒
  if not exists (select 1 from store_owner where user_id = v_uid) then
    raise exception 'not_owner';
  end if;
  if length(v_name) = 0 then
    raise exception 'name_required';
  end if;

  -- 幂等:本人名下同名店已存在则复用
  select s.id into v_store
    from store s
    join store_owner o on o.store_id = s.id
   where o.user_id = v_uid and lower(s.name) = lower(v_name)
   limit 1;

  if v_store is null then
    insert into store (name, industry_type, terminology, theme)
      values (v_name, coalesce(nullif(btrim(p_industry_type), ''), 'restaurant'),
              v_term, coalesce(p_theme, '{}'::jsonb))
      returning id into v_store;
    insert into store_owner (user_id, store_id) values (v_uid, v_store)
      on conflict do nothing;
  end if;

  return jsonb_build_object('store_id', v_store, 'name', v_name);
end $$;

revoke all on function create_store(text,text,jsonb,jsonb) from public;
revoke all on function create_store(text,text,jsonb,jsonb) from anon;
grant execute on function create_store(text,text,jsonb,jsonb) to authenticated;
