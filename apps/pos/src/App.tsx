import { useEffect, useState, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { buildTickets, resolveTerminology } from '@meicai/shared';
import type { Item, ServicePoint, Store } from '@meicai/shared';
import { supabase } from './supabase';
import {
  getStoreId, getStore, listActiveOrders, listItems, listOccupiedPoints,
  acceptOrder, completeOrder, cancelOrder, reprintOrder, setItemStatus, clearTable,
  toOrderDetail, type OrderRow,
} from './api';
import { getPrintService, receiptStyles, receiptBodyHtml, type ReceiptPair } from './print';

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
  const [tab, setTab] = useState<'board' | 'items'>('board');

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
          <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>沽清管理</button>
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
      ) : (
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
