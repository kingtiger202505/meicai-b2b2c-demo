import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isServiceRoleMode } from './supabase';
import {
  listMerchantApplications, approveMerchantApplication, listAllStores,
  isBoss,
  type MerchantApplicationRow, type MerchantStatus, type StoreRow,
} from './api';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="center">加载中…</div>;
  return session ? <Platform /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState('platform@chuanxiaozao.local');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  };
  return (
    <div className="center">
      <form className="login" onSubmit={submit}>
        <h1>平台管理端</h1>
        <p className="sub">平台超管登录 · 商户进件审核与全局看板</p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="平台超管账号" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
        {err && <div className="err">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
        <p className="hint">demo: platform@chuanxiaozao.local / platform-demo-1234</p>
      </form>
    </div>
  );
}

function Platform() {
  const [bossChecked, setBossChecked] = useState(false);
  const [isBossUser, setIsBossUser] = useState(false);

  useEffect(() => {
    // 检查 raw_app_meta_data.role === 'boss'(Supabase 映射到 session.user.app_metadata.role)
    const check = async () => {
      const { data } = await supabase.auth.getUser();
      const appMeta = data.user?.app_metadata as Record<string, unknown> | undefined;
      const boss = isBoss(appMeta);
      setIsBossUser(boss);
      setBossChecked(true);
    };
    check();
  }, []);

  if (!bossChecked) return <div className="center">校验权限…</div>;

  if (!isBossUser) {
    return (
      <div className="center">
        <div className="denied">
          <h1>非平台超管账号</h1>
          <p>此账号无平台管理权限。平台管理端仅限 raw_app_meta_data.role='boss' 的超管账号登录。</p>
          <button onClick={() => supabase.auth.signOut()}>退出登录</button>
        </div>
      </div>
    );
  }

  return <PlatformMain />;
}

function PlatformMain() {
  const [tab, setTab] = useState<'applications' | 'stores'>('applications');

  return (
    <div className="app">
      <header>
        <div className="brand">
          <b>平台管理端</b>
          {!isServiceRoleMode && (
            <span className="warn-tag" title="未配置 VITE_PLATFORM_MODE=1 与 VITE_SUPABASE_SERVICE_ROLE_KEY">
              仅读模式
            </span>
          )}
        </div>
        <button onClick={() => supabase.auth.signOut()}>退出</button>
      </header>
      <nav className="tabs">
        <button className={tab === 'applications' ? 'tab active' : 'tab'} onClick={() => setTab('applications')}>商户进件管理</button>
        <button className={tab === 'stores' ? 'tab active' : 'tab'} onClick={() => setTab('stores')}>商户列表</button>
      </nav>
      {tab === 'applications' && <ApplicationsTab />}
      {tab === 'stores' && <StoresTab />}
      <div className="foot">
        平台超管模式 · {isServiceRoleMode ? 'service_role 已启用(可跨店读写)' : 'service_role 未启用(受 RLS 限制)'}
      </div>
    </div>
  );
}

// ---------- Tab 1: 商户进件管理 ----------

const STATUS_LABEL: Record<MerchantStatus, string> = {
  pending: '待审批',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已拒绝',
};

function ApplicationsTab() {
  const [rows, setRows] = useState<MerchantApplicationRow[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<MerchantStatus | 'all'>('all');
  const [approving, setApproving] = useState<MerchantApplicationRow | null>(null);

  const reload = useCallback(async () => {
    setErr('');
    try {
      const list = await listMerchantApplications();
      setRows(list);
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = rows?.filter((r) => filter === 'all' ? true : r.application_status === filter) ?? [];

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>商户进件管理{rows === null ? ' · 加载中…' : ` · 共 ${filtered.length} 条`}</h2>
          <div className="filter-bar">
            <select value={filter} onChange={(e) => setFilter(e.target.value as MerchantStatus | 'all')} className="filter-select">
              <option value="all">全部状态</option>
              <option value="pending">待审批</option>
              <option value="submitted">已提交</option>
              <option value="approved">已通过</option>
              <option value="rejected">已拒绝</option>
            </select>
            <button onClick={reload}>刷新</button>
          </div>
        </div>
        {err && <div className="banner err">加载失败：{err}</div>}
        {!err && rows !== null && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>门店名</th>
                  <th>法人</th>
                  <th>联系电话</th>
                  <th>营业执照号</th>
                  <th>状态</th>
                  <th>sub_mchid</th>
                  <th>申请时间</th>
                  <th>审批时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.store_id}>
                    <td>{r.store_name || <span className="muted">（未命名）</span>}</td>
                    <td>{r.legal_name ?? <span className="muted">-</span>}</td>
                    <td>{r.contact_phone ?? <span className="muted">-</span>}</td>
                    <td className="mono">{r.business_license_no ?? <span className="muted">-</span>}</td>
                    <td><StatusBadge status={r.application_status} /></td>
                    <td className="mono">{r.sub_mchid ?? <span className="muted">-</span>}</td>
                    <td className="muted">{fmtTime(r.applied_at)}</td>
                    <td className="muted">{r.approved_at ? fmtTime(r.approved_at) : '-'}</td>
                    <td>
                      {(r.application_status === 'pending' || r.application_status === 'submitted' || r.application_status === 'rejected') && (
                        <button className="primary" onClick={() => setApproving(r)}>审批通过</button>
                      )}
                      {r.application_status === 'approved' && <span className="muted">已通过</span>}
                      {r.application_status === 'rejected' && r.rejected_reason && (
                        <span className="muted" title={r.rejected_reason}>原因</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="empty">暂无进件记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {approving && (
        <ApproveModal
          row={approving}
          onClose={() => setApproving(null)}
          onDone={() => { setApproving(null); reload(); }}
        />
      )}
    </div>
  );
}

function ApproveModal({ row, onClose, onDone }: {
  row: MerchantApplicationRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [subMchid, setSubMchid] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subMchid.trim()) { setErr('请填写 sub_mchid（测试可填 mock 值，如 1000010001）'); return; }
    setBusy(true); setErr('');
    try {
      await approveMerchantApplication(row.store_id, subMchid.trim());
      onDone();
    } catch (e2) {
      setErr(errText(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-body form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>审批通过 · {row.store_name || row.store_id}</h3>
        <label>微信特约商户号 sub_mchid
          <input value={subMchid} onChange={(e) => setSubMchid(e.target.value)} placeholder="如 1000010001（测试可填 mock）" />
        </label>
        <p className="hint">
          确认后该门店进件状态置为「已通过」，sub_mchid 落库。
          真实环境此值由微信进件 API 返回；当前测试可直接填 mock 值。
        </p>
        {err && <div className="err">{err}</div>}
        <div className="modal-acts">
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="primary" type="submit" disabled={busy}>{busy ? '提交中…' : '确认通过'}</button>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: MerchantStatus }) {
  return <span className={'badge ' + status}>{STATUS_LABEL[status]}</span>;
}

// ---------- Tab 2: 商户列表 ----------

function StoresTab() {
  const [rows, setRows] = useState<StoreRow[] | null>(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    setErr('');
    try {
      const list = await listAllStores();
      setRows(list);
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>商户列表{rows === null ? ' · 加载中…' : ` · 共 ${rows.length} 家`}</h2>
          <button onClick={reload}>刷新</button>
        </div>
        {err && <div className="banner err">加载失败：{err}</div>}
        {!err && rows !== null && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>门店名</th>
                  <th>行业</th>
                  <th>老板 user_id</th>
                  <th>创建时间</th>
                  <th>进件状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="muted">{r.industry_type}</td>
                    <td className="mono small">{r.owner_user_id ?? <span className="muted">-</span>}</td>
                    <td className="muted">{fmtTime(r.created_at)}</td>
                    <td>{r.merchant_status ? <StatusBadge status={r.merchant_status} /> : <span className="muted">未进件</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="empty">暂无门店</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- 工具 ----------

function fmtTime(iso: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

function errText(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { message?: string; error_description?: string; details?: string };
    return o.message || o.error_description || o.details || JSON.stringify(e);
  }
  return String(e);
}
