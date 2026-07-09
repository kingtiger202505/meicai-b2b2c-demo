-- ============================================================
-- 商家自有打印机接入（WX-25）：门店级 printer_config + 四类可插拔 Provider
--   cloud       云小票机（飞鹅 feie / 易联云 yilianyun），后端 Edge Function 下发
--   usb_serial  USB/串口热敏，浏览器端 WebUSB/Web Serial 出票
--   network     网口机，门店本地代理转 TCP:9100（携带门店级共享 token）
--   bluetooth   蓝牙，浏览器端 Web Bluetooth 出票
-- 安全：敏感凭据（cloud_key / network_agent_token）只存服务端；锁全表 RLS，
--       仅经 security-definer RPC 读写；读接口只回 *_set 与 *_hint 掩码，绝不回明文。
-- 幂等可重跑。
-- ============================================================

create table if not exists printer_config (
  store_id             uuid primary key references store(id) on delete cascade,
  type                 text not null default 'cloud'
                         check (type in ('cloud','usb_serial','network','bluetooth')),
  cloud_vendor         text,
  cloud_sn             text,
  cloud_key            text,               -- 敏感，绝不出站
  network_ip           text,
  network_port         int default 9100,
  network_agent_url    text,
  network_agent_token  text,               -- 敏感，绝不出站
  usb_baud             int default 9600,
  bt_service_uuid      text,
  updated_at           timestamptz not null default now()
);

alter table printer_config enable row level security;
-- 锁全表：不开放任何 anon/authenticated 直接读写，全部经 security-definer RPC（与本项目既有约定一致）。
revoke all on printer_config from anon, authenticated;

-- 掩码：保留末 4 位；短值全掩码；空值空串。
create or replace function _printer_mask_hint(p text)
returns text language sql immutable as $$
  select case
    when p is null or p = '' then ''
    when length(p) <= 4 then '****'
    else '****' || right(p, 4)
  end
$$;

-- 读：返回当前员工所属门店的配置；绝不含明文密钥，只给 *_set 与 *_hint。
create or replace function get_printer_config()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_row printer_config%rowtype;
begin
  v_store := current_staff_store();
  if v_store is null then raise exception 'no_store'; end if;
  select * into v_row from printer_config where store_id = v_store;
  if v_row.store_id is null then
    return jsonb_build_object('store_id', v_store, 'configured', false);
  end if;
  return jsonb_build_object(
    'store_id', v_store,
    'configured', true,
    'type', v_row.type,
    'cloud', jsonb_build_object(
      'vendor', coalesce(v_row.cloud_vendor, ''),
      'sn', coalesce(v_row.cloud_sn, ''),
      'key_set', (v_row.cloud_key is not null and v_row.cloud_key <> ''),
      'key_hint', _printer_mask_hint(v_row.cloud_key)),
    'network', jsonb_build_object(
      'ip', coalesce(v_row.network_ip, ''),
      'port', coalesce(v_row.network_port, 9100),
      'agent_url', coalesce(v_row.network_agent_url, ''),
      'agent_token_set', (v_row.network_agent_token is not null and v_row.network_agent_token <> ''),
      'agent_token_hint', _printer_mask_hint(v_row.network_agent_token)),
    'usb_serial', jsonb_build_object('baud_rate', coalesce(v_row.usb_baud, 9600)),
    'bluetooth', jsonb_build_object('service_uuid', coalesce(v_row.bt_service_uuid, '')),
    'updated_at', v_row.updated_at
  );
end $$;

-- 存：校验所选类型的必填字段；敏感字段留空则保留旧值；其它类型字段不被本次覆盖。
-- 校验失败以 exception 'validation_failed' + detail(字段错误 JSON) 抛出，前端读 error.details。
create or replace function save_printer_config(
  p_type                text,
  p_cloud_vendor        text default null,
  p_cloud_sn            text default null,
  p_cloud_key           text default null,
  p_network_ip          text default null,
  p_network_port        int  default null,
  p_network_agent_url   text default null,
  p_network_agent_token text default null,
  p_usb_baud            int  default null,
  p_bt_service_uuid     text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_prev printer_config%rowtype; v_errs jsonb := '{}'::jsonb;
begin
  v_store := current_staff_store();
  if v_store is null then raise exception 'no_store'; end if;
  select * into v_prev from printer_config where store_id = v_store;

  if p_type not in ('cloud','usb_serial','network','bluetooth') then
    raise exception 'invalid_type';
  end if;

  if p_type = 'cloud' then
    if coalesce(p_cloud_vendor, '') not in ('feie','yilianyun') then
      v_errs := v_errs || jsonb_build_object('cloud.vendor', '请选择厂商（飞鹅 feie 或 易联云 yilianyun）');
    end if;
    if coalesce(trim(p_cloud_sn), '') = '' then
      v_errs := v_errs || jsonb_build_object('cloud.sn', 'SN（设备编号）为必填');
    end if;
    if coalesce(p_cloud_key, '') = '' and coalesce(v_prev.cloud_key, '') = '' then
      v_errs := v_errs || jsonb_build_object('cloud.key', 'KEY 为必填');
    end if;
  elsif p_type = 'network' then
    if coalesce(trim(p_network_ip), '') = '' or p_network_ip !~ '^\d{1,3}(\.\d{1,3}){3}$' then
      v_errs := v_errs || jsonb_build_object('network.ip', 'IP 格式不合法');
    end if;
    if coalesce(p_network_port, 0) <= 0 or coalesce(p_network_port, 0) > 65535 then
      v_errs := v_errs || jsonb_build_object('network.port', '端口需在 1-65535 之间（默认 9100）');
    end if;
    if coalesce(p_network_agent_url, '') !~ '^https?://' then
      v_errs := v_errs || jsonb_build_object('network.agent_url', '本地代理地址需为合法 http(s) URL');
    end if;
    if coalesce(p_network_agent_token, '') = '' and coalesce(v_prev.network_agent_token, '') = '' then
      v_errs := v_errs || jsonb_build_object('network.agent_token', '门店级共享 token 为必填');
    end if;
  end if;

  if v_errs <> '{}'::jsonb then
    raise exception 'validation_failed' using detail = v_errs::text;
  end if;

  insert into printer_config as pc (
    store_id, type, cloud_vendor, cloud_sn, cloud_key,
    network_ip, network_port, network_agent_url, network_agent_token,
    usb_baud, bt_service_uuid, updated_at
  ) values (
    v_store, p_type,
    coalesce(nullif(trim(p_cloud_vendor), ''), v_prev.cloud_vendor),
    coalesce(nullif(trim(p_cloud_sn), ''), v_prev.cloud_sn),
    case when coalesce(p_cloud_key, '') = '' then v_prev.cloud_key else p_cloud_key end,
    coalesce(nullif(trim(p_network_ip), ''), v_prev.network_ip),
    coalesce(p_network_port, v_prev.network_port, 9100),
    coalesce(nullif(trim(p_network_agent_url), ''), v_prev.network_agent_url),
    case when coalesce(p_network_agent_token, '') = '' then v_prev.network_agent_token else p_network_agent_token end,
    coalesce(p_usb_baud, v_prev.usb_baud, 9600),
    coalesce(nullif(trim(p_bt_service_uuid), ''), v_prev.bt_service_uuid),
    now()
  )
  on conflict (store_id) do update set
    type                = excluded.type,
    cloud_vendor        = excluded.cloud_vendor,
    cloud_sn            = excluded.cloud_sn,
    cloud_key           = excluded.cloud_key,
    network_ip          = excluded.network_ip,
    network_port        = excluded.network_port,
    network_agent_url   = excluded.network_agent_url,
    network_agent_token = excluded.network_agent_token,
    usb_baud            = excluded.usb_baud,
    bt_service_uuid     = excluded.bt_service_uuid,
    updated_at          = now();

  return get_printer_config();
end $$;

-- 云机测试打印：读本店 cloud 配置（含服务端密钥）→ 模拟厂商 Edge Function 下发。
-- 无真机/真账号的测试环境：校验通过即成功；SN 以 FAIL 开头或 KEY=invalid 视为厂商拒绝（便于验收失败分支）。
create or replace function test_print_cloud()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_row printer_config%rowtype; v_label text;
begin
  v_store := current_staff_store();
  if v_store is null then raise exception 'no_store'; end if;
  select * into v_row from printer_config where store_id = v_store;
  if v_row.store_id is null or v_row.type <> 'cloud' then
    return jsonb_build_object('ok', false, 'message', '当前门店未配置云小票机，请先保存云机配置');
  end if;
  if coalesce(v_row.cloud_sn, '') = '' or coalesce(v_row.cloud_key, '') = '' then
    return jsonb_build_object('ok', false, 'message', '云机 SN/KEY 不完整，请先补全并保存');
  end if;
  v_label := case v_row.cloud_vendor when 'feie' then '飞鹅' when 'yilianyun' then '易联云' else coalesce(v_row.cloud_vendor, '云机') end;
  if upper(v_row.cloud_sn) like 'FAIL%' or lower(v_row.cloud_key) = 'invalid' then
    return jsonb_build_object('ok', false, 'dispatched_via', 'cloud-edge-function', 'simulated', true,
      'message', v_label || ' 下发失败：SN 或 KEY 无效（厂商拒绝）');
  end if;
  return jsonb_build_object('ok', true, 'dispatched_via', 'cloud-edge-function', 'simulated', true,
    'ticket_id', 'SIM-' || substr(md5(v_store::text || v_row.cloud_sn || clock_timestamp()::text), 1, 8),
    'message', v_label || ' Edge Function 下发测试小票成功（测试环境为模拟下发）');
end $$;

-- 网口机测试打印：经门店本地代理转 TCP:9100。服务端无法直达商家内网代理，
-- 测试环境返回“代理不可达”，与真机在线时的下发路径一致（AC-8 离线分支）。
create or replace function test_print_network()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_store uuid; v_row printer_config%rowtype;
begin
  v_store := current_staff_store();
  if v_store is null then raise exception 'no_store'; end if;
  select * into v_row from printer_config where store_id = v_store;
  if v_row.store_id is null or v_row.type <> 'network' then
    return jsonb_build_object('ok', false, 'message', '当前门店未配置网口机，请先保存网口机配置');
  end if;
  return jsonb_build_object('ok', false, 'dispatched_via', 'local-agent',
    'message', format('本地代理不可达：需门店侧代理在线并可从服务端访问 %s（打印机 %s:%s）。测试环境无真机代理，属预期离线结果。',
      coalesce(v_row.network_agent_url, ''), coalesce(v_row.network_ip, ''), coalesce(v_row.network_port, 9100)));
end $$;

-- grants（新函数需显式授权；沿用本项目 authenticated + service_role 约定）
grant execute on function get_printer_config()                                          to authenticated, service_role;
grant execute on function save_printer_config(text,text,text,text,text,int,text,text,int,text) to authenticated, service_role;
grant execute on function test_print_cloud()                                            to authenticated, service_role;
grant execute on function test_print_network()                                          to authenticated, service_role;
