// 门店打印机配置的 RPC 封装（对应 supabase/migrations/0014_printer_config.sql）。
// 敏感凭据永不明文回传：读取只拿到 *_set 与 *_hint 掩码。
import { supabase } from './supabase';

export type ProviderType = 'cloud' | 'usb_serial' | 'network' | 'bluetooth';

export interface PrinterConfigView {
  store_id: string;
  configured: boolean;
  type?: ProviderType;
  cloud: { vendor: string; sn: string; key_set: boolean; key_hint: string };
  network: {
    ip: string; port: number; agent_url: string;
    agent_token_set: boolean; agent_token_hint: string;
  };
  usb_serial: { baud_rate: number };
  bluetooth: { service_uuid: string };
  updated_at?: string;
}

// 未接入时后端只回 {store_id, configured:false}，前端补默认空壳，简化渲染。
function normalize(raw: Partial<PrinterConfigView> & { store_id: string; configured: boolean }): PrinterConfigView {
  return {
    store_id: raw.store_id,
    configured: raw.configured,
    type: raw.type,
    cloud: raw.cloud ?? { vendor: '', sn: '', key_set: false, key_hint: '' },
    network: raw.network ?? { ip: '', port: 9100, agent_url: '', agent_token_set: false, agent_token_hint: '' },
    usb_serial: raw.usb_serial ?? { baud_rate: 9600 },
    bluetooth: raw.bluetooth ?? { service_uuid: '' },
    updated_at: raw.updated_at,
  };
}

export async function getPrinterConfig(): Promise<PrinterConfigView> {
  const { data, error } = await supabase.rpc('get_printer_config');
  if (error) throw error;
  return normalize(data as PrinterConfigView);
}

export interface SaveInput {
  type: ProviderType;
  cloud?: { vendor: string; sn: string; key?: string };
  network?: { ip: string; port: number; agent_url: string; agent_token?: string };
  usb_serial?: { baud_rate?: number };
  bluetooth?: { service_uuid?: string };
}

export interface SaveResult {
  ok: boolean;
  view?: PrinterConfigView;
  fields?: Record<string, string>;
  error?: string;
}

export async function savePrinterConfig(input: SaveInput): Promise<SaveResult> {
  const { data, error } = await supabase.rpc('save_printer_config', {
    p_type: input.type,
    p_cloud_vendor: input.cloud?.vendor ?? null,
    p_cloud_sn: input.cloud?.sn ?? null,
    p_cloud_key: input.cloud?.key ?? null,
    p_network_ip: input.network?.ip ?? null,
    p_network_port: input.network?.port ?? null,
    p_network_agent_url: input.network?.agent_url ?? null,
    p_network_agent_token: input.network?.agent_token ?? null,
    p_usb_baud: input.usb_serial?.baud_rate ?? null,
    p_bt_service_uuid: input.bluetooth?.service_uuid ?? null,
  });
  if (!error) return { ok: true, view: normalize(data as PrinterConfigView) };

  // 校验失败：字段错误 JSON 放在 error.details（save_printer_config 用 raise ... using detail 抛出）
  const details = (error as { details?: string }).details;
  if (error.message?.includes('validation_failed') && details) {
    try {
      return { ok: false, fields: JSON.parse(details) as Record<string, string> };
    } catch {
      /* fallthrough */
    }
  }
  return { ok: false, error: humanizeError(error.message) };
}

export interface TestPrintResult {
  ok: boolean;
  message: string;
  ticket_id?: string;
  dispatched_via?: string;
  simulated?: boolean;
}

export async function testPrintCloud(): Promise<TestPrintResult> {
  const { data, error } = await supabase.rpc('test_print_cloud');
  if (error) return { ok: false, message: humanizeError(error.message) };
  return data as TestPrintResult;
}

export async function testPrintNetwork(): Promise<TestPrintResult> {
  const { data, error } = await supabase.rpc('test_print_network');
  if (error) return { ok: false, message: humanizeError(error.message) };
  return data as TestPrintResult;
}

function humanizeError(msg: string): string {
  if (!msg) return '操作失败';
  if (msg.includes('no_store')) return '未能解析当前员工所属门店，请重新登录';
  if (msg.includes('invalid_type')) return '未知打印机类型';
  if (msg.includes('function') && msg.includes('does not exist')) {
    return '后端打印机配置接口尚未就绪（数据库迁移 0014 未应用）';
  }
  return msg;
}
