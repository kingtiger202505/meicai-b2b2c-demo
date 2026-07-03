-- ============================================================
-- WX-18 多门店菜品管理后台(admin)——老板↔多店映射 + 菜品/分类写入 RPC(带 store 归属校验)
--   · 权限模型: staff.role='clerk'(POS 接单/沽清, 现状不变) 与 owner(可管菜品/多店)正交
--   · owner 的「一人多店」用独立映射表 store_owner(user_id, store_id)(Q1 决策: 方案 A)
--   · 菜品/分类所有写入一律走 security definer RPC, RPC 内校验「目标 store ∈ 调用者名下门店」
--   · 口径2: item.status 权限拆分 —— 沽清/恢复(on_sale⇄sold_out)店员+老板皆可(set_item_status,
--     已收窄拒绝 off_shelf); 上下架(off_shelf)仅老板端(set_item_shelf)
--   · seed 第二家门店并绑到同一 owner demo 账号(Q2 决策: 是), 供 QA 验「切换 + 隔离」
-- 幂等可重跑。不改动既有迁移。
-- ============================================================

-- ---------- 1. 老板↔多店映射表 ----------
create table if not exists store_owner (
  user_id  uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references store(id)      on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
alter table store_owner enable row level security;
grant select on store_owner to authenticated;
drop policy if exists store_owner_self on store_owner;
create policy store_owner_self on store_owner for select to authenticated
  using (user_id = auth.uid());

-- ---------- 2. 归属判定 helper(security definer, 绕过 store_owner 自身 RLS) ----------
create or replace function is_store_owner(p_store_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from store_owner where user_id = auth.uid() and store_id = p_store_id
  );
$$;

create or replace function assert_store_owner(p_store_id uuid) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if not is_store_owner(p_store_id) then
    raise exception 'not_store_owner';
  end if;
end $$;

-- 当前 owner 名下门店列表(供前端门店切换器)
create or replace function list_my_stores() returns setof jsonb
language sql stable security definer set search_path=public as $$
  select to_jsonb(s)
  from store s
  join store_owner o on o.store_id = s.id
  where o.user_id = auth.uid()
  order by s.name;
$$;

-- ---------- 3. owner 读策略: 可读本人名下门店的全部分类/菜品(含 off_shelf) ----------
-- 说明: RLS 策略为 permissive(OR), 叠加在既有 anon 只读(排除 off_shelf)之上;
--       owner 借此策略读到自己门店的下架菜品, 顾客/POS 读路径不变。
drop policy if exists cat_owner_read on category;
create policy cat_owner_read on category for select to authenticated
  using (is_store_owner(store_id));
drop policy if exists item_owner_read on item;
create policy item_owner_read on item for select to authenticated
  using (is_store_owner(store_id));

-- ---------- 4. 菜品/分类写入 RPC(全部 security definer + 归属校验) ----------

-- 新增/编辑菜品(p_item_id 为 null = 新增)——老板端专用
create or replace function upsert_item(
  p_item_id     uuid,
  p_store_id    uuid,
  p_name        text,
  p_price       numeric,
  p_category_id uuid  default null,
  p_unit        text  default null,
  p_img         text  default null,
  p_descr       text  default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform assert_store_owner(p_store_id);
  if p_name is null or length(btrim(p_name)) = 0 then raise exception 'name_required'; end if;
  -- 分类必须属于同一门店(防跨店塞分类)
  if p_category_id is not null
     and not exists(select 1 from category where id = p_category_id and store_id = p_store_id) then
    raise exception 'category_not_in_store';
  end if;

  if p_item_id is null then
    insert into item(store_id, category_id, name, price, unit, img, descr)
      values (p_store_id, p_category_id, btrim(p_name), coalesce(p_price,0), p_unit, p_img, p_descr)
      returning id into v_id;
  else
    -- 编辑: 目标菜品必须落在本人门店内
    if not exists(select 1 from item where id = p_item_id and store_id = p_store_id) then
      raise exception 'item_not_in_store';
    end if;
    update item set
      category_id = p_category_id,
      name        = btrim(p_name),
      price       = coalesce(p_price,0),
      unit        = p_unit,
      img         = p_img,
      descr       = p_descr
    where id = p_item_id
    returning id into v_id;
  end if;
  return jsonb_build_object('item_id', v_id);
end $$;

-- 删除菜品——老板端专用(历史订单 order_item.item_id on delete set null, 快照保留)
create or replace function delete_item(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid;
begin
  select store_id into v_store from item where id = p_item_id;
  if v_store is null then raise exception 'item_not_found'; end if;
  perform assert_store_owner(v_store);
  delete from item where id = p_item_id;
  return jsonb_build_object('deleted', p_item_id);
end $$;

-- 上架/下架(off_shelf ⇄ on_sale)——【仅老板端】, 收口口径2
create or replace function set_item_shelf(p_item_id uuid, p_on_shelf boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_new item_status;
begin
  select store_id into v_store from item where id = p_item_id;
  if v_store is null then raise exception 'item_not_found'; end if;
  perform assert_store_owner(v_store);          -- 店员无 owner 权限 → 无法上下架
  v_new := case when p_on_shelf then 'on_sale'::item_status else 'off_shelf'::item_status end;
  update item set status = v_new where id = p_item_id;
  return jsonb_build_object('item_id', p_item_id, 'status', v_new);
end $$;

-- 批量排序菜品: p_orders = [{"item_id":"...","sort":0}, ...]——老板端专用
create or replace function reorder_items(p_orders jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; v_item_id uuid; v_store uuid; v_sort int;
begin
  for r in select value from jsonb_array_elements(coalesce(p_orders,'[]'::jsonb)) loop
    v_item_id := (r->>'item_id')::uuid;
    v_sort    := coalesce((r->>'sort')::int, 0);
    select store_id into v_store from item where id = v_item_id;
    if v_store is null then raise exception 'item_not_found:%', v_item_id; end if;
    perform assert_store_owner(v_store);
    update item set sort = v_sort where id = v_item_id;
  end loop;
  return jsonb_build_object('updated', jsonb_array_length(coalesce(p_orders,'[]'::jsonb)));
end $$;

-- 新增/改名/改序分类(p_category_id 为 null = 新增)
create or replace function upsert_category(
  p_category_id uuid,
  p_store_id    uuid,
  p_name        text,
  p_sort        int default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform assert_store_owner(p_store_id);
  if p_name is null or length(btrim(p_name)) = 0 then raise exception 'name_required'; end if;
  if p_category_id is null then
    insert into category(store_id, name, sort)
      values (p_store_id, btrim(p_name), coalesce(p_sort,0))
      returning id into v_id;
  else
    if not exists(select 1 from category where id = p_category_id and store_id = p_store_id) then
      raise exception 'category_not_in_store';
    end if;
    update category set name = btrim(p_name), sort = coalesce(p_sort, sort)
      where id = p_category_id returning id into v_id;
  end if;
  return jsonb_build_object('category_id', v_id);
end $$;

-- 批量排序分类: p_orders = [{"category_id":"...","sort":0}, ...]——老板端专用
create or replace function reorder_categories(p_orders jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r jsonb; v_cat_id uuid; v_store uuid; v_sort int;
begin
  for r in select value from jsonb_array_elements(coalesce(p_orders,'[]'::jsonb)) loop
    v_cat_id := (r->>'category_id')::uuid;
    v_sort   := coalesce((r->>'sort')::int, 0);
    select store_id into v_store from category where id = v_cat_id;
    if v_store is null then raise exception 'category_not_found:%', v_cat_id; end if;
    perform assert_store_owner(v_store);
    update category set sort = v_sort where id = v_cat_id;
  end loop;
  return jsonb_build_object('updated', jsonb_array_length(coalesce(p_orders,'[]'::jsonb)));
end $$;

-- 删除分类(其菜品 category_id 置空, 落入「未分类」, 不删菜)
create or replace function delete_category(p_category_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid;
begin
  select store_id into v_store from category where id = p_category_id;
  if v_store is null then raise exception 'category_not_found'; end if;
  perform assert_store_owner(v_store);
  delete from category where id = p_category_id;   -- item.category_id on delete set null
  return jsonb_build_object('deleted', p_category_id);
end $$;

-- ---------- 5. 收窄 set_item_status(口径2)——沽清/恢复, 店员+老板皆可 ----------
-- 原实现两个隐患: (a) 任意 authenticated 可改任意店; (b) 可写 off_shelf → 店员借沽清接口下架。
-- 新实现:
--   · 只接受 on_sale ⇄ sold_out(沽清/恢复); 写 off_shelf 直接拒绝(上下架请走老板端 set_item_shelf)。
--   · 已下架(off_shelf)的菜品也不能经此路径改状态(上架属老板端)。
--   · 归属校验: 调用者须是该菜品门店的店员(current_staff_store)或 owner; 跨店越权被拒。
--   POS clerk 只命中自己门店的沽清/恢复 → 行为不变。
create or replace function set_item_status(p_item_id uuid, p_status item_status)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_cur item_status;
begin
  if p_status not in ('on_sale','sold_out') then
    raise exception 'shelf_change_not_allowed_here';   -- off_shelf 只允许 set_item_shelf(老板端)
  end if;
  select store_id, status into v_store, v_cur from item where id = p_item_id;
  if v_store is null then raise exception 'item_not_found'; end if;
  if v_cur = 'off_shelf' then
    raise exception 'item_off_shelf';                  -- 已下架, 上架属老板端
  end if;
  if not (v_store = current_staff_store() or is_store_owner(v_store)) then
    raise exception 'not_authorized_for_store';
  end if;
  update item set status = p_status where id = p_item_id;
  return jsonb_build_object('item_id', p_item_id, 'status', p_status);
end $$;

-- ---------- 6. grants ----------
revoke all on function is_store_owner(uuid)        from public;
revoke all on function list_my_stores()            from public;
revoke all on function upsert_item(uuid,uuid,text,numeric,uuid,text,text,text) from public;
revoke all on function delete_item(uuid)           from public;
revoke all on function set_item_shelf(uuid,boolean) from public;
revoke all on function reorder_items(jsonb)        from public;
revoke all on function upsert_category(uuid,uuid,text,int) from public;
revoke all on function reorder_categories(jsonb)   from public;
revoke all on function delete_category(uuid)       from public;

grant execute on function is_store_owner(uuid)     to authenticated;
grant execute on function list_my_stores()         to authenticated;
grant execute on function upsert_item(uuid,uuid,text,numeric,uuid,text,text,text) to authenticated;
grant execute on function delete_item(uuid)        to authenticated;
grant execute on function set_item_shelf(uuid,boolean) to authenticated;
grant execute on function reorder_items(jsonb)     to authenticated;
grant execute on function upsert_category(uuid,uuid,text,int) to authenticated;
grant execute on function reorder_categories(jsonb) to authenticated;
grant execute on function delete_category(uuid)    to authenticated;
-- set_item_status 已在 0002 授 authenticated, service_role; 重定义不改变授权。

-- ============================================================
-- 7. seed: 第二家门店(川小灶·三里屯店) + 菜单; 幂等(重跑先清该店)
-- ============================================================
do $$
declare
  s2 uuid := '22222222-2222-2222-2222-222222222222';
  c_hot uuid; c_zhu uuid; c_liang uuid; c_yin uuid;
begin
  delete from store where id = s2;   -- cascade 清 point/category/item...

  insert into store(id,name,industry_type,terminology,theme) values
   (s2,'川小灶·三里屯店','restaurant',
    '{"point":"桌台","point_short":"桌","session":"就餐","item":"菜品","kitchen_ticket":"后厨单","customer_ticket":"小票","sold_out":"沽清","processing":"备餐中","fulfill":"上菜"}'::jsonb,
    '{"primary":"#E43D30","tone":"warm"}'::jsonb);

  insert into service_point(store_id,code,name) values
   (s2,'T01','1号桌'),(s2,'T02','2号桌'),(s2,'T03','3号桌'),(s2,'T04','4号桌');

  insert into category(store_id,name,sort) values (s2,'热销',0)     returning id into c_hot;
  insert into category(store_id,name,sort) values (s2,'招牌热菜',1) returning id into c_zhu;
  insert into category(store_id,name,sort) values (s2,'凉菜',2)     returning id into c_liang;
  insert into category(store_id,name,sort) values (s2,'饮品',3)     returning id into c_yin;

  insert into item(store_id,category_id,name,price,unit,img,descr,sales,sort) values
   (s2,c_hot,  '毛血旺',      42,'份','https://picsum.photos/id/312/300/300','三里屯店招牌，麻辣鲜香',430,0),
   (s2,c_hot,  '辣子鸡',      46,'份','https://picsum.photos/id/326/300/300','外酥里嫩，干辣过瘾',380,1),
   (s2,c_zhu,  '酸菜鱼',      58,'份','https://picsum.photos/id/570/300/300','酸辣开胃，鱼片滑嫩',520,0),
   (s2,c_zhu,  '回锅肉',      36,'份','https://picsum.photos/id/835/300/300','肥而不腻，家常经典',410,1),
   (s2,c_liang,'夫妻肺片',    28,'份','https://picsum.photos/id/1080/300/300','红油浓郁，麻辣鲜香',360,0),
   (s2,c_yin,  '冰粉',         8,'份','https://picsum.photos/id/431/300/300','冰爽解辣，红糖桂花',640,0);
end $$;

-- ============================================================
-- 8. owner demo 账号 + 绑定两家门店
--   · 自包含 seed: 尝试在 auth.users/auth.identities 直建 owner demo(best-effort, 幂等)
--   · 无论 owner 由本迁移创建还是后台手建, 均按 email 查回并绑定 store_owner
--   · clerk demo 复用既有 POS 账号 pos@chuanxiaozao.local(仅在 staff, 不在 store_owner
--     → admin 会拒绝其进入, 满足验收 2)
-- ============================================================
do $$
declare
  v_owner uuid := '33333333-3333-3333-3333-333333333333';
  s1 uuid := '11111111-1111-1111-1111-111111111111';
  s2 uuid := '22222222-2222-2222-2222-222222222222';
begin
  -- best-effort 直建 auth 用户; 若目标 Supabase 的 auth schema 形状不同, 忽略并走后台手建兜底
  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated',
      'owner@chuanxiaozao.local', crypt('owner-demo-1234', gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
    ) on conflict (id) do nothing;

    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      v_owner::text, v_owner,
      jsonb_build_object('sub', v_owner::text, 'email', 'owner@chuanxiaozao.local', 'email_verified', true),
      'email', now(), now(), now()
    ) on conflict do nothing;
  exception when others then
    raise notice 'owner auth user auto-seed skipped (create owner@chuanxiaozao.local via dashboard, then re-run): %', sqlerrm;
  end;

  -- 按 email 查回 owner(兼容后台手建), 绑定两家门店
  select id into v_owner from auth.users where email = 'owner@chuanxiaozao.local' limit 1;
  if v_owner is not null then
    insert into store_owner(user_id, store_id) values (v_owner, s1), (v_owner, s2)
      on conflict do nothing;
  else
    raise notice 'owner@chuanxiaozao.local not found; create it in Auth then re-run this block to bind store_owner';
  end if;
end $$;
