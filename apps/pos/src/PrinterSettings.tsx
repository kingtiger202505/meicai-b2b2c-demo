import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  getPrinterConfig, savePrinterConfig, testPrintCloud, testPrintNetwork,
  type PrinterConfigView, type ProviderType, type SaveInput, type TestPrintResult,
} from './printerConfig';
import {
  bluetoothSupported, detectSupport, printBluetooth, printUsbSerial, usbSerialSupported,
} from './print/providers';

const TYPES: { key: ProviderType; label: string }[] = [
  { key: 'cloud', label: '云小票机' },
  { key: 'usb_serial', label: 'USB / 串口' },
  { key: 'network', label: '网口机' },
  { key: 'bluetooth', label: '蓝牙' },
];

interface FormState {
  type: ProviderType;
  cloudVendor: string;
  cloudSN: string;
  cloudKey: string;
  netIP: string;
  netPort: string;
  netAgentURL: string;
  netToken: string;
  usbBaud: string;
}

function initialForm(): FormState {
  return {
    type: 'cloud', cloudVendor: 'feie', cloudSN: '', cloudKey: '',
    netIP: '', netPort: '9100', netAgentURL: '', netToken: '', usbBaud: '9600',
  };
}

function fromView(v: PrinterConfigView): FormState {
  return {
    type: v.type ?? 'cloud',
    cloudVendor: v.cloud.vendor || 'feie',
    cloudSN: v.cloud.sn,
    cloudKey: '',
    netIP: v.network.ip,
    netPort: v.network.port ? String(v.network.port) : '9100',
    netAgentURL: v.network.agent_url,
    netToken: '',
    usbBaud: v.usb_serial.baud_rate ? String(v.usb_serial.baud_rate) : '9600',
  };
}

export default function PrinterSettings() {
  const support = useMemo(detectSupport, []);
  const [view, setView] = useState<PrinterConfigView | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<TestPrintResult | null>(null);
  const [testing, setTesting] = useState(false);

  const usbOK = usbSerialSupported(support);
  const btOK = bluetoothSupported(support);

  const typeDisabled = (t: ProviderType): boolean =>
    (t === 'usb_serial' && !usbOK) || (t === 'bluetooth' && !btOK);

  async function load() {
    setLoading(true);
    setBanner(null);
    setTestResult(null);
    setErrors({});
    try {
      const v = await getPrinterConfig();
      setView(v);
      setForm(v.configured ? fromView(v) : initialForm());
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      setView(null);
      setForm(initialForm());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function set<K extends keyof FormState>(k: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [k]: val }));
  }

  function buildInput(): SaveInput {
    const input: SaveInput = { type: form.type };
    if (form.type === 'cloud') {
      input.cloud = { vendor: form.cloudVendor, sn: form.cloudSN.trim() };
      if (form.cloudKey) input.cloud.key = form.cloudKey;
    } else if (form.type === 'network') {
      input.network = { ip: form.netIP.trim(), port: Number(form.netPort) || 0, agent_url: form.netAgentURL.trim() };
      if (form.netToken) input.network.agent_token = form.netToken;
    } else if (form.type === 'usb_serial') {
      input.usb_serial = { baud_rate: Number(form.usbBaud) || 9600 };
    } else {
      input.bluetooth = {};
    }
    return input;
  }

  async function onSave() {
    setSaving(true);
    setBanner(null);
    setErrors({});
    setTestResult(null);
    try {
      const res = await savePrinterConfig(buildInput());
      if (res.ok && res.view) {
        setView(res.view);
        setForm(fromView(res.view));
        setBanner({ kind: 'ok', text: '配置已保存' });
      } else if (res.fields) {
        setErrors(res.fields);
        setBanner({ kind: 'error', text: '配置校验未通过' });
      } else {
        setBanner({ kind: 'error', text: res.error ?? '保存失败' });
      }
    } catch (e) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  const configuredType = view?.configured ? view.type : undefined;
  const canTest = Boolean(view?.configured && configuredType === form.type);

  async function onTestPrint() {
    setTesting(true);
    setTestResult(null);
    setBanner(null);
    try {
      if (form.type === 'usb_serial') {
        await printUsbSerial(view?.store_id ?? 'store', Number(form.usbBaud) || 9600);
        setTestResult({ ok: true, message: '已经浏览器 USB/串口发送 ESC/POS，请查看打印机出票' });
        return;
      }
      if (form.type === 'bluetooth') {
        await printBluetooth(view?.store_id ?? 'store');
        setTestResult({ ok: true, message: '已经浏览器蓝牙发送 ESC/POS，请查看打印机出票' });
        return;
      }
      setTestResult(form.type === 'cloud' ? await testPrintCloud() : await testPrintNetwork());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cancelled = /cancel|no port|no device|user gesture|chooser|selected/i.test(msg);
      setTestResult({ ok: false, message: cancelled ? `未选择设备或已取消：${msg}` : `打印失败：${msg}` });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section style={S.card}>
      <div style={S.headerRow}>
        <h2 style={{ fontSize: 18, margin: 0 }}>打印机</h2>
        <span style={{ fontSize: 12, color: '#6b7280' }}>门店：{view?.store_id ?? '—'}</span>
      </div>
      <p style={{ marginTop: 4, color: '#6b7280', fontSize: 13 }}>
        选择打印机类型并填写凭据/设备信息，保存后系统按门店级 printer_config 路由出票。
      </p>

      {!support.secure && (
        <div style={{ ...S.banner, ...S.bannerInfo }}>
          当前非 HTTPS 环境，USB/串口与蓝牙已被浏览器禁用。云小票机不受影响。
        </div>
      )}

      <div style={S.tabs}>
        {TYPES.map((t) => {
          const disabled = typeDisabled(t.key);
          const active = form.type === t.key;
          return (
            <button
              key={t.key}
              type="button"
              disabled={disabled}
              onClick={() => { setForm((f) => ({ ...f, type: t.key })); setErrors({}); setTestResult(null); }}
              title={disabled ? '仅支持 Chrome/Edge 桌面端 + HTTPS：当前环境未检测到对应 Web 能力' : undefined}
              style={{ ...S.tab, ...(active ? S.tabActive : {}), ...(disabled ? S.tabDisabled : {}) }}
            >
              {t.label}{disabled ? ' （不可用）' : ''}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p style={{ color: '#6b7280' }}>加载中…</p>
      ) : (
        <>
          {!view?.configured && (
            <div style={{ ...S.banner, ...S.bannerInfo }}>
              该门店尚未接入打印机。请选择类型、填写信息并保存后再打印测试小票。
            </div>
          )}

          {(form.type === 'usb_serial' || form.type === 'bluetooth') && (
            <div style={{ ...S.banner, ...S.bannerInfo }}>
              该类型仅支持 Chrome / Edge 桌面端 + HTTPS，通过浏览器授权弹窗选择设备后直连出票。
            </div>
          )}

          {form.type === 'cloud' && <CloudForm form={form} set={set} errors={errors} view={view} />}
          {form.type === 'network' && <NetworkForm form={form} set={set} errors={errors} view={view} />}
          {form.type === 'usb_serial' && <UsbForm form={form} set={set} errors={errors} />}
          {form.type === 'bluetooth' && <BluetoothInfo />}

          {banner && (
            <div style={{ ...S.banner, ...(banner.kind === 'ok' ? S.bannerOK : banner.kind === 'error' ? S.bannerErr : S.bannerInfo) }}>
              {banner.text}
            </div>
          )}

          <div style={S.actions}>
            <button type="button" onClick={onSave} disabled={saving || typeDisabled(form.type)} style={S.primaryBtn}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              onClick={onTestPrint}
              disabled={testing || !canTest || typeDisabled(form.type)}
              title={!canTest ? '请先保存当前类型的配置后再测试' : undefined}
              style={S.secondaryBtn}
            >
              {testing ? '打印中…' : '打印测试小票'}
            </button>
          </div>

          {testResult && (
            <div style={{ ...S.banner, ...(testResult.ok ? S.bannerOK : S.bannerErr) }}>
              {testResult.message}
              {testResult.ticket_id ? `（小票号 ${testResult.ticket_id}）` : ''}
              {testResult.simulated ? '　[测试环境模拟]' : ''}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type SetFn = <K extends keyof FormState>(k: K, val: FormState[K]) => void;

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
      {error && <span style={S.errText}>{error}</span>}
    </label>
  );
}

function CloudForm({ form, set, errors, view }: { form: FormState; set: SetFn; errors: Record<string, string>; view: PrinterConfigView | null }) {
  return (
    <div style={S.form}>
      <Field label="厂商" error={errors['cloud.vendor']}>
        <select value={form.cloudVendor} onChange={(e) => set('cloudVendor', e.target.value)} style={S.input}>
          <option value="feie">飞鹅</option>
          <option value="yilianyun">易联云</option>
        </select>
      </Field>
      <Field label="SN（设备编号）" error={errors['cloud.sn']}>
        <input value={form.cloudSN} onChange={(e) => set('cloudSN', e.target.value)} style={S.input} placeholder="打印机 SN" />
      </Field>
      <Field label="KEY（敏感）" error={errors['cloud.key']}>
        <input
          value={form.cloudKey}
          onChange={(e) => set('cloudKey', e.target.value)}
          style={S.input}
          type="password"
          placeholder={view?.cloud.key_set ? `已保存（${view.cloud.key_hint}），留空则不修改` : '厂商开放平台 KEY'}
        />
      </Field>
    </div>
  );
}

function NetworkForm({ form, set, errors, view }: { form: FormState; set: SetFn; errors: Record<string, string>; view: PrinterConfigView | null }) {
  return (
    <div style={S.form}>
      <Field label="打印机 IP" error={errors['network.ip']}>
        <input value={form.netIP} onChange={(e) => set('netIP', e.target.value)} style={S.input} placeholder="192.168.1.100" />
      </Field>
      <Field label="端口（默认 9100）" error={errors['network.port']}>
        <input value={form.netPort} onChange={(e) => set('netPort', e.target.value)} style={S.input} inputMode="numeric" />
      </Field>
      <Field label="本地代理地址" error={errors['network.agent_url']}>
        <input value={form.netAgentURL} onChange={(e) => set('netAgentURL', e.target.value)} style={S.input} placeholder="http://门店内网:port/print" />
      </Field>
      <Field label="代理共享 token（敏感）" error={errors['network.agent_token']}>
        <input
          value={form.netToken}
          onChange={(e) => set('netToken', e.target.value)}
          style={S.input}
          type="password"
          placeholder={view?.network.agent_token_set ? `已保存（${view.network.agent_token_hint}），留空则不修改` : '门店级共享 token'}
        />
      </Field>
    </div>
  );
}

function UsbForm({ form, set, errors }: { form: FormState; set: SetFn; errors: Record<string, string> }) {
  return (
    <div style={S.form}>
      <Field label="波特率（串口可选）" error={errors['usb_serial.baud_rate']}>
        <input value={form.usbBaud} onChange={(e) => set('usbBaud', e.target.value)} style={S.input} inputMode="numeric" />
      </Field>
      <p style={{ gridColumn: '1 / -1', margin: 0, color: '#6b7280', fontSize: 13 }}>
        点击「打印测试小票」时，浏览器会弹出设备授权弹窗，请选择你的 USB/串口打印机。设备选择即用户手势授权，不会预先保存具体设备。
      </p>
    </div>
  );
}

function BluetoothInfo() {
  return (
    <p style={{ margin: '4px 0', color: '#6b7280', fontSize: 13 }}>
      点击「打印测试小票」时，浏览器会弹出蓝牙设备授权弹窗，请选择已配对的蓝牙热敏打印机。配对与授权由浏览器完成，不在服务端保存凭据。
    </p>
  );
}

const S: Record<string, CSSProperties> = {
  card: { marginTop: 8, padding: 20, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', maxWidth: 720 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  tabs: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' },
  tab: { padding: '8px 14px', borderRadius: 999, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 },
  tabActive: { background: '#111827', color: '#fff', borderColor: '#111827' },
  tabDisabled: { opacity: 0.45, cursor: 'not-allowed', background: '#f3f4f6' },
  form: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, margin: '8px 0 4px' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 13, color: '#374151', fontWeight: 600 },
  input: { padding: '8px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14 },
  errText: { color: '#dc2626', fontSize: 12 },
  actions: { display: 'flex', gap: 12, marginTop: 20 },
  primaryBtn: { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', cursor: 'pointer', fontSize: 14 },
  secondaryBtn: { padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 14 },
  banner: { marginTop: 14, padding: '10px 14px', borderRadius: 8, fontSize: 14 },
  bannerOK: { background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' },
  bannerErr: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' },
  bannerInfo: { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' },
};
