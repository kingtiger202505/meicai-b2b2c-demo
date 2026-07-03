-- ============================================================
-- P3.5 小票两联：重打审计 + 接单打印幂等（WX-9）
-- 首次 printed_at 为幂等锚点，一经写入不可覆盖；
-- 重打仅累加 reprint_count + last_reprinted_at，绝不改写 printed_at。
-- 幂等可重跑。
-- ============================================================

-- 重打审计字段
alter table orders add column if not exists reprint_count int not null default 0;
alter table orders add column if not exists last_reprinted_at timestamptz;

-- 接单：paid -> processing，首次写入 printed_at（幂等锚点）。
-- 返回 first_print：本次是否为首次打印（printed_at 由 null 变为非空），
-- 前端据此决定“接单副作用”是否自动出单一次；已打印过则不重复自动打印。
create or replace function accept_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_had_print boolean;
begin
  select printed_at is not null into v_had_print
    from orders where id=p_order_id and status='paid';
  update orders set status='processing', printed_at=coalesce(printed_at, now())
    where id=p_order_id and status='paid' returning id into v_id;
  if v_id is null then raise exception 'order_not_acceptable'; end if;
  return jsonb_build_object(
    'order_id', v_id,
    'status', 'processing',
    'first_print', not coalesce(v_had_print, false)
  );
end $$;

-- 重打：记录一次重打（不改写首次 printed_at）。
-- 尚未首次打印的订单（如待接单预览）返回 recorded=false，不计入审计。
create or replace function reprint_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row orders%rowtype;
begin
  select * into v_row from orders where id=p_order_id;
  if v_row.id is null then raise exception 'order_not_found'; end if;
  if v_row.printed_at is null then
    return jsonb_build_object('order_id', p_order_id, 'recorded', false,
                              'reprint_count', v_row.reprint_count);
  end if;
  update orders
     set reprint_count = reprint_count + 1,
         last_reprinted_at = now()
   where id = p_order_id
   returning reprint_count, last_reprinted_at
        into v_row.reprint_count, v_row.last_reprinted_at;
  return jsonb_build_object('order_id', p_order_id, 'recorded', true,
                            'reprint_count', v_row.reprint_count,
                            'last_reprinted_at', v_row.last_reprinted_at);
end $$;

-- grants（create or replace 保留原有授权；reprint_order 为新函数需显式授权）
grant execute on function reprint_order(uuid) to authenticated, service_role;
