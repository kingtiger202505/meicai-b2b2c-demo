import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { buildTickets, resolveTerminology } from '@meicai/shared';
import type { Item, ServicePoint, Store } from '@meicai/shared';
import { supabase } from './supabase';
import {
  getStoreId, getStore, listActiveOrders, listItems, listOccupiedPoints,
  acceptOrder, completeOrder, cancelOrder, reprintOrder, setItemStatus, clearTable,
  toOrderDetail, type OrderRow,
  listAllPoints, setPointStatus, settleOrderCash, listUnpaidOrders,
  openShift, closeShift, currentShift, shiftSummary,
  type ServicePointFull, type Shift,
} from './api';
import { getPrintService, receiptStyles, receiptBodyHtml, type ReceiptPair } from './print';
import PrinterSettings from './PrinterSettings';

// 由订单行构造两联小票（接单副作用打印与预览/重打共用同一逻辑）
function pairFor(row: OrderRow, store: Store): ReceiptPair {
  const term = resolveTerminology(store.industry_type, store.terminology);
  const { kitchen, customer } = buildTickets(
    toOrderDetail(row),
    store,
    row.service_point ? { name: row.service_point.name } : null,
    term,
    { memberBalance: row.member?.balance ?? null },
  );
  return { kitchen, customer };
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="center">加载中…</div>;
  return session ? <Board /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState('pos@chuanxiaozao.local');
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
        <h1>门店 POS 登录</h1>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="门店账号" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
        {err && <div className="err">{err}</div>}
        <button disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      </form>
    </div>
  );
}

function Board() {
  const [storeId, setStoreId] = useState('');
  const [store, setStore] = useState<Store | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [points, setPoints] = useState<ServicePoint[]>([]);
  const [ticket, setTicket] = useState<OrderRow | null>(null);
  const [tab, setTab] = useState<'board' | 'cashier' | 'tables' | 'items' | 'shift' | 'printer'>('board');

  const reload = useCallback(async (sid: string) => {
    const [os, its, pts] = await Promise.all([listActiveOrders(sid), listItems(sid), listOccupiedPoints(sid)]);
    setOrders(os); setItems(its); setPoints(pts);
  }, []);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const sid = await getStoreId();
      setStoreId(sid);
      setStore(await getStore(sid));
      await reload(sid);
      channel = supabase
        .channel('pos-orders')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${sid}` },
          () => reload(sid))
        .subscribe();
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [reload]);

  const act = async (fn: PromiseLike<{ error: unknown }>) => {
    const { error } = await fn;
    if (error) alert('操作失败：' + JSON.stringify(error));
    if (storeId) reload(storeId);
  };

  // 接单：paid→processing + 首次写 printed_at；接单副作用仅首次自动打印一次
  const accept = async (o: OrderRow) => {
    const { data, error } = await acceptOrder(o.id);
    if (error) { alert('接单失败：' + JSON.stringify(error)); return; }
    if (store && (data as { first_print?: boolean } | null)?.first_print) {
      try { await getPrintService().print(pairFor(o, store)); }
      catch (e) { console.error('接单自动打印失败', e); }
    }
    if (storeId) reload(storeId);
  };

  const pending = orders.filter((o) => o.status === 'paid');
  const cooking = orders.filter((o) => o.status === 'processing');

  return (
    <div className="app">
      <header>
        <b>{store?.name ?? '门店 POS'}</b>
        <nav>
          <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>订单看板</button>
          <button className={tab === 'cashier' ? 'on' : ''} onClick={() => setTab('cashier')}>收银台</button>
          <button className={tab === 'tables' ? 'on' : ''} onClick={() => setTab('tables')}>桌台管理</button>
          <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>沽清管理</button>
          <button className={tab === 'shift' ? 'on' : ''} onClick={() => setTab('shift')}>交接班</button>
          <button className={tab === 'printer' ? 'on' : ''} onClick={() => setTab('printer')}>打印机</button>
          <button onClick={() => supabase.auth.signOut()}>退出</button>
        </nav>
      </header>

      {tab === 'board' ? (
        <div className="board">
          <Column title={`待接单 (${pending.length})`}>
            {pending.map((o) => (
              <OrderCard key={o.id} o={o}
                actions={<>
                  <button className="primary" onClick={() => accept(o)}>接单 · 打印</button>
                  <button onClick={() => setTicket(o)}>预览/重打</button>
                  <button className="danger" onClick={() => act(cancelOrder(o.id, '前台取消'))}>退款</button>
                </>} />
            ))}
          </Column>
          <Column title={`备餐中 (${cooking.length})`}>
            {cooking.map((o) => (
              <OrderCard key={o.id} o={o}
                actions={<>
                  <button className="primary" onClick={() => act(completeOrder(o.id))}>完成</button>
                  <button onClick={() => setTicket(o)}>重打</button>
                  <button className="danger" onClick={() => act(cancelOrder(o.id, '前台取消'))}>退款</button>
                </>} />
            ))}
          </Column>
          <Column title={`占用桌台 (${points.length})`}>
            {points.map((p) => (
              <div className="tablecard" key={p.id}>
                <b>{p.name}</b>
                <button onClick={() => act(clearTable(p.id))}>清台</button>
              </div>
            ))}
            {points.length === 0 && <div className="empty">暂无占用</div>}
          </Column>
        </div>
      ) : tab === 'cashier' ? (
        <CashierTab storeId={storeId} />
      ) : tab === 'tables' ? (
        <TablesTab storeId={storeId} />
      ) : tab === 'items' ? (
        <div className="items">
          {items.map((it) => (
            <div className={'itemrow ' + (it.status === 'sold_out' ? 'soldout' : '')} key={it.id}>
              <span>{it.name} · ¥{it.price}</span>
              {it.status === 'sold_out'
                ? <button onClick={() => act(setItemStatus(it.id, 'on_sale'))}>恢复在售</button>
                : <button className="danger" onClick={() => act(setItemStatus(it.id, 'sold_out'))}>沽清</button>}
            </div>
          ))}
        </div>
      ) : tab === 'shift' ? (
        <ShiftTab storeId={storeId} />
      ) : (
        <div className="printer-tab"><PrinterSettings /></div>
      )}

      {ticket && store && (
        <TicketModal row={ticket} store={store} onClose={() => setTicket(null)} />
      )}
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="col"><h2>{title}</h2><div className="col-body">{children}</div></section>;
}

function OrderCard({ o, actions }: { o: OrderRow; actions: React.ReactNode }) {
  const t = new Date(o.created_at);
  return (
    <div className="card">
      <div className="card-head">
        <b>{o.service_point?.name ?? '—'}</b>
        <span className="no">{o.order_no}</span>
        {o.is_addon && <span className="addon">加菜·{o.addon_seq}</span>}
      </div>
      <ul>{o.order_item?.map((i) => <li key={i.id}>{i.name_snapshot} ×{i.qty}{i.note ? ` (${i.note})` : ''}</li>)}</ul>
      <div className="card-foot">
        <span>¥{o.total} · {o.pay_method ?? ''}</span>
        <span>{t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="acts">{actions}</div>
    </div>
  );
}

function TicketModal({ row, store, onClose }: { row: OrderRow; store: Store; onClose: () => void }) {
  const pairRef = useRef<ReceiptPair>(pairFor(row, store));
  const [busy, setBusy] = useState(false);
  const printed = row.printed_at != null; // 已首次打印过 → 本次为重打

  const doPrint = async () => {
    setBusy(true);
    // 已打印过的订单：记录一次重打审计（不改写首次 printed_at）；未打印则为预览，RPC 自动跳过
    try { await reprintOrder(row.id); } catch (e) { console.error('重打记录失败', e); }
    try { await getPrintService().print(pairRef.current); } finally { setBusy(false); }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{printed ? '重打小票（两联）' : '小票预览（两联）'}</div>
        <style>{receiptStyles()}</style>
        <div className="ticket-preview" dangerouslySetInnerHTML={{ __html: receiptBodyHtml(pairRef.current) }} />
        {printed && row.reprint_count > 0 && (
          <div className="reprint-hint">已重打 {row.reprint_count} 次</div>
        )}
        <div className="modal-acts">
          <button className="primary" disabled={busy} onClick={doPrint}>
            {busy ? '打印中…' : printed ? '重打两联' : '打印两联'}
          </button>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ===== v4 阶段3: 桌台管理 =====
// 后端 point_status 已扩展 reserved/cleaning,前端类型暂未同步,用本地扩展类型断言
type PointStatusFull = 'idle' | 'occupied' | 'reserved' | 'cleaning';

const POINT_STATUS_LABEL: Record<PointStatusFull, string> = {
  idle: '空闲',
  occupied: '占用',
  reserved: '预订',
  cleaning: '待清洁',
};

const POINT_STATUS_CLASS: Record<PointStatusFull, string> = {
  idle: 'st-idle',
  occupied: 'st-occupied',
  reserved: 'st-reserved',
  cleaning: 'st-cleaning',
};

function TablesTab({ storeId }: { storeId: string }) {
  const [allPoints, setAllPoints] = useState<ServicePointFull[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuPoint, setMenuPoint] = useState<ServicePointFull | null>(null);

  const reload = useCallback(async () => {
    if (!storeId) return;
    try { setAllPoints(await listAllPoints(storeId)); }
    catch (e) { alert('加载桌台失败：' + JSON.stringify(e)); }
  }, [storeId]);

  useEffect(() => { reload(); }, [reload]);

  const doAct = async (pointId: string, fn: PromiseLike<{ error: unknown }>) => {
    setBusyId(pointId);
    const { error } = await fn;
    setBusyId(null);
    if (error) { alert('操作失败：' + JSON.stringify(error)); return; }
    setMenuPoint(null);
    await reload();
  };

  // 按 area 分组(空 area 归入"未分组")
  const groups = useMemo(() => {
    const m = new Map<string, ServicePointFull[]>();
    for (const p of allPoints) {
      const k = p.area || '未分组';
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [allPoints]);

  return (
    <div className="tables-tab">
      <div className="tables-legend">
        <span className="legend-item"><i className="dot st-idle" />空闲</span>
        <span className="legend-item"><i className="dot st-occupied" />占用</span>
        <span className="legend-item"><i className="dot st-reserved" />预订</span>
        <span className="legend-item"><i className="dot st-cleaning" />待清洁</span>
        <span className="legend-count">共 {allPoints.length} 桌</span>
      </div>
      {groups.map(([area, pts]) => (
        <div className="table-area" key={area}>
          <h3 className="area-title">{area}</h3>
          <div className="table-grid">
            {pts.map((p) => {
              const st = p.status as PointStatusFull;
              return (
                <button
                  key={p.id}
                  className={`table-cell ${POINT_STATUS_CLASS[st]}`}
                  disabled={busyId === p.id}
                  onClick={() => setMenuPoint(p)}
                >
                  <b className="t-name">{p.name}</b>
                  <span className="t-seat">{p.seat_count ?? 0} 座</span>
                  <span className="t-status">{POINT_STATUS_LABEL[st]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {allPoints.length === 0 && <div className="empty">暂无桌台</div>}

      {menuPoint && (
        <PointMenuModal
          point={menuPoint}
          busy={busyId === menuPoint.id}
          onAction={(status) => {
            if (status === 'clear') {
              doAct(menuPoint.id, clearTable(menuPoint.id));
            } else {
              doAct(menuPoint.id, setPointStatus(menuPoint.id, status));
            }
          }}
          onClose={() => setMenuPoint(null)}
        />
      )}
    </div>
  );
}

function PointMenuModal({
  point, busy, onAction, onClose,
}: {
  point: ServicePointFull;
  busy: boolean;
  onAction: (status: PointStatusFull | 'clear') => void;
  onClose: () => void;
}) {
  const st = point.status as PointStatusFull;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {point.name} · {POINT_STATUS_LABEL[st]}
          {point.seat_count != null && <span className="modal-sub">（{point.seat_count} 座）</span>}
        </div>
        <div className="point-menu-acts">
          {st === 'idle' && (
            <>
              <button className="primary" disabled={busy} onClick={() => onAction('reserved')}>预订</button>
              <button disabled={busy} onClick={() => onAction('occupied')}>开台</button>
            </>
          )}
          {st === 'occupied' && (
            <button className="primary" disabled={busy} onClick={() => onAction('clear')}>清台</button>
          )}
          {st === 'reserved' && (
            <>
              <button className="primary" disabled={busy} onClick={() => onAction('occupied')}>到店开台</button>
              <button disabled={busy} onClick={() => onAction('idle')}>释放预订</button>
            </>
          )}
          {st === 'cleaning' && (
            <button className="primary" disabled={busy} onClick={() => onAction('idle')}>清洁完成</button>
          )}
        </div>
        <div className="modal-acts">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// ===== v4 阶段3: 收银台 =====
type PayMethod = 'cash' | 'wechat' | 'balance';
const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: '现金',
  wechat: '微信',
  balance: '余额',
};

function CashierTab({ storeId }: { storeId: string }) {
  const [unpaid, setUnpaid] = useState<OrderRow[]>([]);
  const [settle, setSettle] = useState<OrderRow | null>(null);
  const [current, setCurrent] = useState<Shift | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!storeId) return;
    try { setUnpaid(await listUnpaidOrders(storeId)); }
    catch (e) { alert('加载未支付订单失败：' + JSON.stringify(e)); }
  }, [storeId]);

  const reloadShift = useCallback(async () => {
    if (!storeId) return;
    setShiftLoading(true);
    try {
      const { data, error } = await currentShift(storeId);
      if (error) throw error;
      setCurrent((data as Shift | null) ?? null);
    } catch (e) {
      // 当前班次为空时 RPC 返回 null,不弹窗
      setCurrent(null);
    } finally {
      setShiftLoading(false);
    }
  }, [storeId]);

  useEffect(() => { reload(); reloadShift(); }, [reload, reloadShift]);

  return (
    <div className="cashier-tab">
      <div className="cashier-shift-bar">
        {shiftLoading ? '班次加载中…' : current ? (
          <span>当前班次:开班 {new Date(current.started_at).toLocaleString('zh-CN')} · 备用金 ¥{current.opening_float}</span>
        ) : (
          <span className="cashier-no-shift">当前未开班(请到「交接班」tab 开班)</span>
        )}
      </div>
      <div className="cashier-list">
        <h3 className="area-title">待结账订单 ({unpaid.length})</h3>
        {unpaid.length === 0 && <div className="empty">暂无待结账订单</div>}
        {unpaid.map((o) => (
          <div className="cashier-row" key={o.id}>
            <div className="cr-main">
              <b>{o.service_point?.name ?? '—'}</b>
              <span className="no">{o.order_no}</span>
              <span className="cr-time">{new Date(o.created_at).toLocaleString('zh-CN')}</span>
            </div>
            <div className="cr-right">
              <span className="cr-total">¥{o.total}</span>
              <button className="primary" onClick={() => setSettle(o)}>结账</button>
            </div>
          </div>
        ))}
      </div>

      {settle && (
        <SettleModal
          order={settle}
          onClose={() => setSettle(null)}
          onOk={async (cashReceived, roundOff, payMethod) => {
            const { error } = await settleOrderCash(settle.id, cashReceived, roundOff, payMethod);
            if (error) { alert('结账失败：' + JSON.stringify(error)); return false; }
            setSettle(null);
            await reload();
            return true;
          }}
        />
      )}
    </div>
  );
}

function SettleModal({
  order, onClose, onOk,
}: {
  order: OrderRow;
  onClose: () => void;
  onOk: (cashReceived: number, roundOff: number, payMethod: PayMethod) => Promise<boolean>;
}) {
  const [cashReceived, setCashReceived] = useState<string>(String(order.total));
  const [roundOff, setRoundOff] = useState<string>('0');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [busy, setBusy] = useState(false);

  const total = order.total;
  const rOff = Number(roundOff) || 0;
  const received = Number(cashReceived) || 0;
  const need = Math.max(total - rOff, 0);
  const change = received - need;

  const submit = async () => {
    if (payMethod === 'cash' && received < need) {
      alert('实收现金不足,还差 ¥' + (need - received).toFixed(2));
      return;
    }
    setBusy(true);
    await onOk(received, rOff, payMethod);
    setBusy(false);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body settle-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          结账 · {order.service_point?.name ?? '—'} · {order.order_no}
        </div>
        <div className="settle-row"><span>应付金额</span><b>¥{total}</b></div>
        <div className="settle-row">
          <span>抹零</span>
          <input
            type="number" min={0} step={0.01} value={roundOff}
            onChange={(e) => setRoundOff(e.target.value)}
          />
        </div>
        <div className="settle-row">
          <span>实收现金</span>
          <input
            type="number" min={0} step={0.01} value={cashReceived}
            onChange={(e) => setCashReceived(e.target.value)}
          />
        </div>
        <div className="settle-row"><span>应找零</span><b>¥{change >= 0 ? change.toFixed(2) : '—'}</b></div>
        <div className="settle-row">
          <span>支付方式</span>
          <div className="pay-methods">
            {(Object.keys(PAY_METHOD_LABEL) as PayMethod[]).map((m) => (
              <button
                key={m}
                className={payMethod === m ? 'on' : ''}
                onClick={() => setPayMethod(m)}
              >
                {PAY_METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-acts">
          <button className="primary" disabled={busy} onClick={submit}>
            {busy ? '结账中…' : '确认结账'}
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

// ===== v4 阶段3: 交接班 =====
interface ShiftSummaryData {
  shift_id: string;
  cash_total: number;
  wechat_total: number;
  balance_total: number;
  order_count: number;
  expected_cash: number;
  opening_float: number;
}

function ShiftTab({ storeId }: { storeId: string }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [summary, setSummary] = useState<ShiftSummaryData | null>(null);
  const [loading, setLoading] = useState(false);

  // 开班表单
  const [openFloat, setOpenFloat] = useState('0');
  // 交接班表单
  const [countedCash, setCountedCash] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { data, error } = await currentShift(storeId);
      if (error) throw error;
      const cur = (data as Shift | null) ?? null;
      setShift(cur);
      if (cur) {
        const { data: sumData, error: sumErr } = await shiftSummary(cur.id);
        if (sumErr) throw sumErr;
        setSummary(sumData as ShiftSummaryData);
        // 默认实点现金 = 应有现金
        setCountedCash(String((sumData as ShiftSummaryData)?.expected_cash ?? 0));
      } else {
        setSummary(null);
      }
    } catch (e) {
      alert('加载班次失败：' + JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { reload(); }, [reload]);

  const doOpen = async () => {
    const f = Number(openFloat) || 0;
    if (f < 0) { alert('备用金不能为负'); return; }
    const { error } = await openShift(storeId, f);
    if (error) { alert('开班失败：' + JSON.stringify(error)); return; }
    await reload();
  };

  const doClose = async () => {
    if (!shift) return;
    const counted = Number(countedCash) || 0;
    if (counted < 0) { alert('实点现金不能为负'); return; }
    const { error } = await closeShift(shift.id, counted, note || undefined);
    if (error) { alert('交接班失败：' + JSON.stringify(error)); return; }
    setNote('');
    await reload();
  };

  const expected = summary?.expected_cash ?? 0;
  const counted = Number(countedCash) || 0;
  const diff = counted - expected;

  return (
    <div className="shift-tab">
      {loading && <div className="empty">加载中…</div>}

      {!shift ? (
        <div className="shift-card">
          <h3 className="area-title">开班</h3>
          <div className="empty">当前未开班,请输入开班备用金后开班</div>
          <div className="settle-row">
            <span>开班备用金</span>
            <input
              type="number" min={0} step={0.01} value={openFloat}
              onChange={(e) => setOpenFloat(e.target.value)}
            />
          </div>
          <div className="modal-acts">
            <button className="primary" onClick={doOpen}>开班</button>
          </div>
        </div>
      ) : (
        <div className="shift-card">
          <h3 className="area-title">当前班次</h3>
          <div className="settle-row"><span>开班时间</span><b>{new Date(shift.started_at).toLocaleString('zh-CN')}</b></div>
          <div className="settle-row"><span>开班备用金</span><b>¥{shift.opening_float}</b></div>
          <div className="settle-row"><span>班次状态</span><b>{shift.status === 'open' ? '进行中' : '已关闭'}</b></div>

          {summary && (
            <>
              <h3 className="area-title shift-sub-title">班次汇总</h3>
              <div className="settle-row"><span>现金收入</span><b>¥{summary.cash_total}</b></div>
              <div className="settle-row"><span>微信收入</span><b>¥{summary.wechat_total}</b></div>
              <div className="settle-row"><span>余额收入</span><b>¥{summary.balance_total}</b></div>
              <div className="settle-row"><span>订单数</span><b>{summary.order_count}</b></div>
              <div className="settle-row"><span>应有现金</span><b className="hl">¥{summary.expected_cash}</b></div>
            </>
          )}

          {shift.status === 'open' && (
            <>
              <h3 className="area-title shift-sub-title">交接班</h3>
              <div className="settle-row">
                <span>实点现金</span>
                <input
                  type="number" min={0} step={0.01} value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                />
              </div>
              <div className="settle-row">
                <span>差异 = 实点 - 应有</span>
                <b className={Math.abs(diff) < 0.001 ? 'hl' : 'diff-warn'}>
                  {diff >= 0 ? '+' : ''}¥{diff.toFixed(2)}
                </b>
              </div>
              <div className="settle-row">
                <span>备注</span>
                <input
                  type="text" value={note}
                  placeholder="可选,异常时填写"
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="modal-acts">
                <button className="primary" onClick={doClose}>交接班</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
