-- ============================================================
-- 即时下单业态通用 MVP — P0 核心 schema + RLS + RPC + 幂等
-- 幂等可重跑
-- ============================================================
create extension if not exists pgcrypto;

do $$ begin
  create type item_status  as enum ('on_sale','sold_out','off_shelf');
exception when duplicate_object then null; end $$;
do $$ begin
  create type order_status as enum ('created','paid','processing','completed','cancelled','refunded');
exception when duplicate_object then null; end $$;
do $$ begin
  create type session_status as enum ('open','closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type point_status as enum ('idle','occupied');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------
create table if not exists store (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry_type text not null default 'restaurant',
  terminology jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists dining_session (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  point_id uuid not null,
  status session_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists service_point (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  code text not null,
  name text not null,
  point_secret text not null default encode(gen_random_bytes(8),'hex'),
  current_session_id uuid references dining_session(id) on delete set null,
  status point_status not null default 'idle',
  created_at timestamptz not null default now(),
  unique(store_id, code)
);
do $$ begin
  alter table dining_session add constraint ds_point_fk
    foreign key (point_id) references service_point(id) on delete cascade;
exception when duplicate_object then null; end $$;

create table if not exists category (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  name text not null,
  sort int not null default 0
);

create table if not exists item (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  category_id uuid references category(id) on delete set null,
  name text not null,
  price numeric(10,2) not null default 0,
  unit text,
  img text,
  descr text,
  status item_status not null default 'on_sale',
  sales int not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists item_store_idx on item(store_id, status);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  point_id uuid references service_point(id) on delete set null,
  session_id uuid references dining_session(id) on delete set null,
  order_no text not null,
  order_token uuid not null default gen_random_uuid(),
  customer_ref text,
  status order_status not null default 'created',
  total numeric(10,2) not null default 0,
  pay_method text,
  is_addon boolean not null default false,
  addon_seq int,
  cancel_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  printed_at timestamptz,
  completed_at timestamptz
);
create index if not exists orders_store_status_idx on orders(store_id, status);
create index if not exists orders_session_idx on orders(session_id);
create index if not exists orders_token_idx on orders(order_token);
create index if not exists orders_customer_idx on orders(store_id, customer_ref);

create table if not exists order_item (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid references item(id) on delete set null,
  name_snapshot text not null,
  price_snapshot numeric(10,2) not null,
  qty int not null check (qty > 0),
  note text
);
create index if not exists order_item_order_idx on order_item(order_id);

create table if not exists order_counter (
  store_id uuid not null references store(id) on delete cascade,
  day date not null,
  seq int not null default 0,
  primary key (store_id, day)
);

-- ---------- RLS ----------
alter table store          enable row level security;
alter table service_point  enable row level security;
alter table category       enable row level security;
alter table item           enable row level security;
alter table dining_session enable row level security;
alter table orders         enable row level security;
alter table order_item     enable row level security;
alter table order_counter  enable row level security;

-- lock everything, then open only read-only catalog to anon/authenticated
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on store, service_point, category, item to anon, authenticated;

drop policy if exists store_read on store;
create policy store_read on store for select to anon, authenticated using (true);
drop policy if exists sp_read on service_point;
create policy sp_read on service_point for select to anon, authenticated using (true);
drop policy if exists cat_read on category;
create policy cat_read on category for select to anon, authenticated using (true);
drop policy if exists item_read on item;
create policy item_read on item for select to anon, authenticated using (status <> 'off_shelf');
-- orders / order_item / dining_session / order_counter: NO direct anon access; RPC only.

-- realtime for POS
do $$ begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null; end $$;
