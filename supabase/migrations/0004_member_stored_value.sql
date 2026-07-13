-- ============================================================
-- P2.5 会员 + 储值 + 券（私域护城河核心）—— 幂等可重跑
-- 余额/流水只经 RPC 变更；顾客不可直改
-- ============================================================
do $$ begin
  create type sv_txn_type as enum ('topup','consume','refund','gift');
exception when duplicate_object then null; end $$;
do $$ begin
  create type coupon_kind as enum ('full_reduce','cash','new_user');
exception when duplicate_object then null; end $$;
do $$ begin
  create type coupon_status as enum ('unused','used','expired');
exception when duplicate_object then null; end $$;

create table if not exists member (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  openid text not null,
  unionid text,
  phone text,
  balance numeric(10,2) not null default 0,
  total_spent numeric(12,2) not null default 0,
  visit_count int not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  unique(store_id, openid)
);
create index if not exists member_store_phone_idx on member(store_id, phone);

create table if not exists stored_value_txn (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  member_id uuid not null references member(id) on delete cascade,
  type sv_txn_type not null,
  amount numeric(10,2) not null,          -- 正=入账(topup/gift/refund) 负=支出(consume)
  balance_after numeric(10,2) not null,
  order_id uuid references orders(id) on delete set null,
  wx_transaction_id text,                 -- 微信支付单号(充值/退款)
  created_at timestamptz not null default now()
);
create index if not exists svt_member_idx on stored_value_txn(member_id, created_at desc);
create unique index if not exists svt_wx_transaction_id_uniq_idx on stored_value_txn(wx_transaction_id) where wx_transaction_id is not null;

create table if not exists coupon (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store(id) on delete cascade,
  member_id uuid references member(id) on delete cascade,
  kind coupon_kind not null,
  threshold numeric(10,2) not null default 0,  -- 满减门槛
  value numeric(10,2) not null,                -- 减免金额
  status coupon_status not null default 'unused',
  expire_at timestamptz,
  used_order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists coupon_member_idx on coupon(member_id, status);

-- orders 关联会员
alter table orders add column if not exists member_id uuid references member(id) on delete set null;
create index if not exists orders_member_idx on orders(member_id);

-- RLS
alter table member           enable row level security;
alter table stored_value_txn enable row level security;
alter table coupon           enable row level security;
revoke all on member, stored_value_txn, coupon from anon, authenticated;
-- 不开放任何直读/直写；全部经 security definer RPC
