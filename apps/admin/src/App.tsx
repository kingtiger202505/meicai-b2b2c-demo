import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Category, Item, ItemStatus, Store } from '@meicai/shared';
import { supabase } from './supabase';
import {
  listMyStores, createStore, listCategories, listItems,
  upsertItem, deleteItem, setItemStatus, setItemShelf, reorderItems,
  upsertCategory, deleteCategory, reorderCategories,
  fetchDailyStats, fetchDailyTrend,
  fetchStoreOrders, fetchStoreRefunds, fetchStoreMembers, fetchStaffLogs,
  listCouponTemplates, upsertCouponTemplate, listMarketingRules, upsertMarketingRule,
  type ItemInput, type DailyStatsResult, type DailyTrendItem,
  type StoreOrderRow, type StoreRefundRow, type StoreMemberRow, type StaffLogRow,
  type CouponTemplate, type MarketingRule,
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
  return session ? <Admin /> : <Login />;
}

function Login() {
  const [email, setEmail] = useState('owner@chuanxiaozao.local');
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
        <h1>菜品管理后台</h1>
        <p className="sub">老板登录 · 维护多门店菜单</p>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="老板账号" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" />
        {err && <div className="err">{err}</div>}
        <button className="primary" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
      </form>
    </div>
  );
}

function Admin() {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeId, setStoreId] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [tab, setTab] = useState<'menu' | 'marketing' | 'daily' | 'orders' | 'refunds' | 'members' | 'logs' | 'staff'>('menu');

  const loadStores = useCallback(async (selectId?: string) => {
    try {
      const s = await listMyStores();
      setStores(s);
      if (selectId) setStoreId(selectId);
      else if (s.length > 0) setStoreId((prev) => prev || s[0].id);
    } catch (e) {
      setLoadErr(errText(e));
      setStores([]);
    }
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  const addStore = async () => {
    const name = prompt('新增门店名称');
    if (!name?.trim()) return;
    try {
      const newId = await createStore(name.trim());
      await loadStores(newId);
    } catch (e) {
      setLoadErr(errText(e));
    }
  };

  if (stores === null && !loadErr) return <div className="center">加载门店…</div>;

  // 非 owner（例如店员登录）→ 无门店可管，拒绝进入
  if (stores !== null && stores.length === 0) {
    return (
      <div className="center">
        <div className="denied">
          <h1>无菜品管理权限</h1>
          <p>此账号未绑定任何门店的老板权限。菜品管理仅限门店老板；店员请使用 POS。</p>
          <button onClick={() => supabase.auth.signOut()}>退出登录</button>
        </div>
      </div>
    );
  }

  const current = stores?.find((s) => s.id === storeId) ?? null;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <b>管理后台</b>
          {stores && stores.length > 0 && (
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="store-switch">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button className="add-store" onClick={addStore}>+ 新增门店</button>
        </div>
        <button onClick={() => supabase.auth.signOut()}>退出</button>
      </header>
      <nav className="tabs">
        <button className={tab === 'menu' ? 'tab active' : 'tab'} onClick={() => setTab('menu')}>菜品管理</button>
        <button className={tab === 'marketing' ? 'tab active' : 'tab'} onClick={() => setTab('marketing')}>营销管理</button>
        <button className={tab === 'daily' ? 'tab active' : 'tab'} onClick={() => setTab('daily')}>营业统计</button>
        <button className={tab === 'orders' ? 'tab active' : 'tab'} onClick={() => setTab('orders')}>订单查询</button>
        <button className={tab === 'refunds' ? 'tab active' : 'tab'} onClick={() => setTab('refunds')}>退款明细</button>
        <button className={tab === 'members' ? 'tab active' : 'tab'} onClick={() => setTab('members')}>会员列表</button>
        <button className={tab === 'logs' ? 'tab active' : 'tab'} onClick={() => setTab('logs')}>操作日志</button>
        <button className={tab === 'staff' ? 'tab active' : 'tab'} onClick={() => setTab('staff')}>员工管理</button>
      </nav>
      {loadErr && <div className="banner err">加载失败：{loadErr}</div>}
      {current && tab === 'menu' && <MenuManager key={current.id} store={current} />}
      {current && tab === 'marketing' && <MarketingTab key={current.id + '-marketing'} storeId={current.id} />}
      {current && tab === 'daily' && <DailyReport key={current.id + '-daily'} storeId={current.id} />}
      {current && tab === 'orders' && <OrdersTab key={current.id + '-orders'} storeId={current.id} />}
      {current && tab === 'refunds' && <RefundsTab key={current.id + '-refunds'} storeId={current.id} />}
      {current && tab === 'members' && <MembersTab key={current.id + '-members'} storeId={current.id} />}
      {current && tab === 'logs' && <LogsTab key={current.id + '-logs'} storeId={current.id} />}
      {current && tab === 'staff' && <StaffTab key={current.id + '-staff'} storeId={current.id} />}
    </div>
  );
}

function MenuManager({ store }: { store: Store }) {
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [msg, setMsg] = useState('');

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [c, i] = await Promise.all([listCategories(store.id), listItems(store.id)]);
      setCats(c); setItems(i);
    } catch (e) {
      setMsg('读取失败：' + errText(e));
    } finally {
      setBusy(false);
    }
  }, [store.id]);

  useEffect(() => { reload(); }, [reload]);

  const run = async (p: PromiseLike<{ error: unknown }>, ok?: string) => {
    const { error } = await p;
    if (error) { setMsg('操作失败：' + errText(error)); return false; }
    if (ok) setMsg(ok);
    await reload();
    return true;
  };

  // 按分类分组展示（未分类置底）
  const grouped = useMemo(() => {
    const groups: { cat: Category | null; items: Item[] }[] = [];
    for (const c of cats) groups.push({ cat: c, items: items.filter((it) => it.category_id === c.id) });
    const uncategorized = items.filter((it) => !it.category_id || !cats.some((c) => c.id === it.category_id));
    if (uncategorized.length) groups.push({ cat: null, items: uncategorized });
    return groups;
  }, [cats, items]);

  const moveItem = async (list: Item[], idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const a = list[idx], b = list[j];
    await run(reorderItems([{ item_id: a.id, sort: b.sort }, { item_id: b.id, sort: a.sort }]));
  };
  const moveCat = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= cats.length) return;
    const a = cats[idx], b = cats[j];
    await run(reorderCategories([{ category_id: a.id, sort: b.sort }, { category_id: b.id, sort: a.sort }]));
  };

  return (
    <div className="wrap">
      {msg && <div className="banner" onClick={() => setMsg('')}>{msg}（点击关闭）</div>}

      <section className="panel">
        <div className="panel-head">
          <h2>分类</h2>
          <button onClick={async () => {
            const name = prompt('新增分类名称');
            if (name?.trim()) await run(upsertCategory({ store_id: store.id, name: name.trim(), sort: cats.length }), '已新增分类');
          }}>+ 新增分类</button>
        </div>
        <div className="cat-list">
          {cats.map((c, i) => (
            <div className="cat-row" key={c.id}>
              <span className="cat-name">{c.name}</span>
              <span className="cat-count">{items.filter((it) => it.category_id === c.id).length} 项</span>
              <div className="row-acts">
                <button onClick={() => moveCat(i, -1)} disabled={i === 0}>↑</button>
                <button onClick={() => moveCat(i, 1)} disabled={i === cats.length - 1}>↓</button>
                <button onClick={async () => {
                  const name = prompt('修改分类名称', c.name);
                  if (name?.trim() && name.trim() !== c.name) await run(upsertCategory({ id: c.id, store_id: store.id, name: name.trim() }), '已改名');
                }}>改名</button>
                <button className="danger" onClick={async () => {
                  if (confirm(`删除分类「${c.name}」？其菜品将移到「未分类」，不会被删除。`)) await run(deleteCategory(c.id), '已删除分类');
                }}>删除</button>
              </div>
            </div>
          ))}
          {cats.length === 0 && <div className="empty">暂无分类</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>菜品{busy ? ' · 加载中…' : ''}</h2>
          <button className="primary" onClick={() => setEditing('new')}>+ 新增菜品</button>
        </div>
        {grouped.map((g) => (
          <div className="group" key={g.cat?.id ?? '__none'}>
            <h3>{g.cat?.name ?? '未分类'}</h3>
            {g.items.map((it, i) => (
              <div className={'item-row ' + it.status} key={it.id}>
                {it.img && <img src={it.img} alt="" className="thumb" />}
                <div className="item-main">
                  <div className="item-name">{it.name} <span className="price">¥{it.price}</span> {it.unit && <span className="unit">/ {it.unit}</span>}</div>
                  <div className="item-sub">
                    <StatusBadge status={it.status} />
                    {it.descr && <span className="descr">{it.descr}</span>}
                  </div>
                </div>
                <div className="row-acts">
                  <button onClick={() => moveItem(g.items, i, -1)} disabled={i === 0}>↑</button>
                  <button onClick={() => moveItem(g.items, i, 1)} disabled={i === g.items.length - 1}>↓</button>
                  <button onClick={() => setEditing(it)}>编辑</button>
                  {it.status === 'off_shelf'
                    ? <button className="primary" onClick={() => run(setItemShelf(it.id, true), '已上架')}>上架</button>
                    : <button onClick={() => run(setItemShelf(it.id, false), '已下架')}>下架</button>}
                  {it.status === 'sold_out'
                    ? <button onClick={() => run(setItemStatus(it.id, 'on_sale'), '已恢复在售')}>恢复</button>
                    : it.status === 'on_sale' && <button className="danger" onClick={() => run(setItemStatus(it.id, 'sold_out'), '已沽清')}>沽清</button>}
                  <button className="danger" onClick={async () => {
                    if (confirm(`删除菜品「${it.name}」？此操作不可撤销（历史订单不受影响）。`)) await run(deleteItem(it.id), '已删除菜品');
                  }}>删除</button>
                </div>
              </div>
            ))}
            {g.items.length === 0 && <div className="empty">该分类暂无菜品</div>}
          </div>
        ))}
        {items.length === 0 && !busy && <div className="empty">本店暂无菜品，点右上「新增菜品」开始</div>}
      </section>

      {editing && (
        <ItemModal
          store={store}
          cats={cats}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const okDone = await run(upsertItem(input), input.id ? '已保存修改' : '已新增菜品');
            if (okDone) setEditing(null);
          }}
        />
      )}
      <div className="foot">当前门店：<b>{store.name}</b> · 所有增删改仅作用于此门店（<code>{store.id}</code>）</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, string> = { on_sale: '在售', sold_out: '沽清', off_shelf: '已下架' };
  return <span className={'badge ' + status}>{map[status]}</span>;
}

function ItemModal({ store, cats, item, onClose, onSave }: {
  store: Store; cats: Category[]; item: Item | null;
  onClose: () => void; onSave: (i: ItemInput) => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [price, setPrice] = useState(String(item?.price ?? ''));
  const [categoryId, setCategoryId] = useState(item?.category_id ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [img, setImg] = useState(item?.img ?? '');
  const [descr, setDescr] = useState(item?.descr ?? '');
  const [err, setErr] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('请填写菜品名称'); return; }
    const p = Number(price);
    if (Number.isNaN(p) || p < 0) { setErr('价格需为 ≥0 的数字'); return; }
    onSave({
      id: item?.id ?? null,
      store_id: store.id,
      name: name.trim(),
      price: p,
      category_id: categoryId || null,
      unit: unit.trim() || null,
      img: img.trim() || null,
      descr: descr.trim() || null,
    });
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-body form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{item ? '编辑菜品' : '新增菜品'}</h3>
        <label>名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 番茄炒蛋" /></label>
        <div className="two">
          <label>价格(¥)<input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" inputMode="decimal" /></label>
          <label>单位<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="份 / 杯" /></label>
        </div>
        <label>分类
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">未分类</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>图片 URL<input value={img} onChange={(e) => setImg(e.target.value)} placeholder="https://…（仅填链接，暂不支持上传）" /></label>
        {img && <img src={img} alt="" className="preview" />}
        <label>描述<textarea value={descr} onChange={(e) => setDescr(e.target.value)} placeholder="简短卖点" rows={2} /></label>
        {err && <div className="err">{err}</div>}
        <div className="modal-acts">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  );
}

function DailyReport({ storeId }: { storeId: string }) {
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  const [stats, setStats] = useState<DailyStatsResult | null>(null);
  const [trend, setTrend] = useState<DailyTrendItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [s, t] = await Promise.all([
        fetchDailyStats(storeId, date),
        fetchDailyTrend(storeId, 7),
      ]);
      setStats(s);
      setTrend(t);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }, [storeId, date]);

  useEffect(() => { load(); }, [load]);

  const maxRev = Math.max(...trend.map((t) => t.revenue), 1);

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>营业统计{loading ? ' · 加载中…' : ''}</h2>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="date-pick" />
        </div>
        {err && <div className="banner err">{err}</div>}
        {stats && (
          <div className="stat-cards">
            <div className="stat-card">
              <span className="stat-label">营业额</span>
              <span className="stat-value revenue">¥{Number(stats.revenue).toFixed(2)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">订单数</span>
              <span className="stat-value">{stats.order_count}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">客单价</span>
              <span className="stat-value">¥{Number(stats.avg_price).toFixed(2)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">退款</span>
              <span className="stat-value refund">¥{Number(stats.refund).toFixed(2)}</span>
            </div>
          </div>
        )}
      </section>

      {stats && stats.pay_methods.length > 0 && (
        <section className="panel">
          <h2>支付方式分布</h2>
          <div className="pay-list">
            {stats.pay_methods.map((p) => (
              <div className="pay-row" key={p.method}>
                <span className="pay-method">{p.method}</span>
                <span className="pay-amount">¥{Number(p.amount).toFixed(2)}</span>
                <span className="pay-count">{p.count} 笔</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {trend.length > 0 && (
        <section className="panel">
          <h2>近 7 日营业趋势</h2>
          <div className="trend-chart">
            {trend.map((t) => (
              <div className="trend-bar-wrap" key={t.date}>
                <div className="trend-bar" style={{ height: `${Math.max((t.revenue / maxRev) * 120, 2)}px` }}>
                  <span className="trend-val">{t.revenue > 0 ? `¥${Number(t.revenue).toFixed(0)}` : '-'}</span>
                </div>
                <span className="trend-date">{t.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------- 营销管理 Tab ----------
function MarketingTab({ storeId }: { storeId: string }) {
  const [subTab, setSubTab] = useState<'coupon' | 'rule'>('coupon');
  const [coupons, setCoupons] = useState<CouponTemplate[]>([]);
  const [rules, setRules] = useState<MarketingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editingCoupon, setEditingCoupon] = useState<CouponTemplate | 'new' | null>(null);
  const [editingRule, setEditingRule] = useState<MarketingRule | 'new' | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [c, r] = await Promise.all([
        listCouponTemplates(storeId),
        listMarketingRules(storeId),
      ]);
      setCoupons(c);
      setRules(r);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveCoupon = async (input: Parameters<typeof upsertCouponTemplate>[0]) => {
    const { error } = await upsertCouponTemplate(input);
    if (error) {
      alert('保存优惠券模板失败：' + errText(error));
      return;
    }
    setEditingCoupon(null);
    loadData();
  };

  const handleSaveRule = async (input: Parameters<typeof upsertMarketingRule>[0]) => {
    const { error } = await upsertMarketingRule(input);
    if (error) {
      alert('保存营销规则失败：' + errText(error));
      return;
    }
    setEditingRule(null);
    loadData();
  };

  const toggleCouponStatus = async (coupon: CouponTemplate) => {
    const { error } = await upsertCouponTemplate({
      id: coupon.id,
      store_id: coupon.store_id,
      name: coupon.name,
      kind: coupon.kind,
      threshold: coupon.threshold,
      value: coupon.value,
      valid_days: coupon.valid_days,
      total_quota: coupon.total_quota,
      enabled: !coupon.enabled,
    });
    if (error) {
      alert('修改状态失败：' + errText(error));
    } else {
      loadData();
    }
  };

  const toggleRuleStatus = async (rule: MarketingRule) => {
    const { error } = await upsertMarketingRule({
      id: rule.id,
      store_id: rule.store_id,
      name: rule.name,
      trigger: rule.trigger,
      action: rule.action,
      enabled: !rule.enabled,
      priority: rule.priority,
    });
    if (error) {
      alert('修改状态失败：' + errText(error));
    } else {
      loadData();
    }
  };

  return (
    <div className="wrap">
      <div className="sub-tabs">
        <button
          className={subTab === 'coupon' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setSubTab('coupon')}
        >
          优惠券模板
        </button>
        <button
          className={subTab === 'rule' ? 'sub-tab active' : 'sub-tab'}
          onClick={() => setSubTab('rule')}
        >
          自动发券规则
        </button>
      </div>

      {err && <div className="banner err">{err}</div>}

      {subTab === 'coupon' && (
        <section className="panel">
          <div className="panel-head">
            <h2>优惠券模板{loading ? ' · 加载中…' : ` · 共 ${coupons.length} 个`}</h2>
            <button className="primary" onClick={() => setEditingCoupon('new')}>
              + 新增模板
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>门槛 (￥)</th>
                  <th>优惠额度 (￥)</th>
                  <th>有效天数</th>
                  <th>发行限量</th>
                  <th>已发数量</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id}>
                    <td className="mono small">{c.id.slice(0, 8)}...</td>
                    <td>{c.name}</td>
                    <td>
                      {c.kind === 'full_reduce'
                        ? '满减券'
                        : c.kind === 'cash'
                        ? '无门槛现金券'
                        : c.kind === 'new_user'
                        ? '新人券'
                        : c.kind}
                    </td>
                    <td>{Number(c.threshold).toFixed(2)}</td>
                    <td>{Number(c.value).toFixed(2)}</td>
                    <td>{c.valid_days} 天</td>
                    <td>{c.total_quota === null ? '无限制' : c.total_quota}</td>
                    <td>{c.issued_count}</td>
                    <td>
                      <span className={`badge ${c.enabled ? 'on_sale' : 'off_shelf'}`}>
                        {c.enabled ? '已启用' : '已禁用'}
                      </span>
                    </td>
                    <td>
                      <div className="row-acts">
                        <button className="small-btn" onClick={() => setEditingCoupon(c)}>
                          编辑
                        </button>
                        <button
                          className={`small-btn ${c.enabled ? 'danger' : 'primary'}`}
                          onClick={() => toggleCouponStatus(c)}
                        >
                          {c.enabled ? '禁用' : '启用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {coupons.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="empty">
                      暂无优惠券模板
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'rule' && (
        <section className="panel">
          <div className="panel-head">
            <h2>自动发券规则{loading ? ' · 加载中…' : ` · 共 ${rules.length} 条`}</h2>
            <button className="primary" onClick={() => setEditingRule('new')}>
              + 新增规则
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>规则名称</th>
                  <th>触发事件</th>
                  <th>赠送券模板名称</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => {
                  const targetCoupon = coupons.find(
                    (c) => c.id === r.action?.coupon_template_id
                  );
                  return (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>
                        {r.trigger === 'first_order'
                          ? '用户首单成功'
                          : r.trigger}
                      </td>
                      <td>
                        {targetCoupon ? (
                          targetCoupon.name
                        ) : (
                          <span className="muted">
                            未知模板 (ID: {r.action?.coupon_template_id || '-'})
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${r.enabled ? 'on_sale' : 'off_shelf'}`}>
                          {r.enabled ? '已启用' : '已禁用'}
                        </span>
                      </td>
                      <td>
                        <div className="row-acts">
                          <button className="small-btn" onClick={() => setEditingRule(r)}>
                            编辑
                          </button>
                          <button
                            className={`small-btn ${r.enabled ? 'danger' : 'primary'}`}
                            onClick={() => toggleRuleStatus(r)}
                          >
                            {r.enabled ? '禁用' : '启用'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rules.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="empty">
                      暂无自动发券规则
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editingCoupon && (
        <CouponModal
          storeId={storeId}
          coupon={editingCoupon === 'new' ? null : editingCoupon}
          onClose={() => setEditingCoupon(null)}
          onSave={handleSaveCoupon}
        />
      )}

      {editingRule && (
        <RuleModal
          storeId={storeId}
          rule={editingRule === 'new' ? null : editingRule}
          coupons={coupons.filter((c) => c.enabled)}
          onClose={() => setEditingRule(null)}
          onSave={handleSaveRule}
        />
      )}
    </div>
  );
}

function CouponModal({
  storeId,
  coupon,
  onClose,
  onSave,
}: {
  storeId: string;
  coupon: CouponTemplate | null;
  onClose: () => void;
  onSave: (t: Parameters<typeof upsertCouponTemplate>[0]) => void;
}) {
  const [name, setName] = useState(coupon?.name ?? '');
  const [kind, setKind] = useState<'full_reduce' | 'cash' | 'new_user'>(
    coupon?.kind ?? 'full_reduce'
  );
  const [threshold, setThreshold] = useState(String(coupon?.threshold ?? ''));
  const [value, setValue] = useState(String(coupon?.value ?? ''));
  const [validDays, setValidDays] = useState(String(coupon?.valid_days ?? '30'));
  const [totalQuota, setTotalQuota] = useState(
    coupon?.total_quota !== undefined && coupon?.total_quota !== null
      ? String(coupon.total_quota)
      : ''
  );
  const [err, setErr] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr('请填写模板名称');
      return;
    }
    const th = Number(threshold);
    if (Number.isNaN(th) || th < 0) {
      setErr('使用门槛需为 ≥0 的数字');
      return;
    }
    const val = Number(value);
    if (Number.isNaN(val) || val <= 0) {
      setErr('优惠额度需为 >0 的数字');
      return;
    }
    const days = Number(validDays);
    if (Number.isNaN(days) || days <= 0 || !Number.isInteger(days)) {
      setErr('有效天数需为正整数');
      return;
    }
    let quota: number | null = null;
    if (totalQuota.trim() !== '') {
      quota = Number(totalQuota);
      if (Number.isNaN(quota) || quota < 0 || !Number.isInteger(quota)) {
        setErr('发行限量需为负数以外的整数，或留空表示不限制');
        return;
      }
    }

    onSave({
      id: coupon?.id ?? null,
      store_id: storeId,
      name: name.trim(),
      kind,
      threshold: th,
      value: val,
      valid_days: days,
      total_quota: quota,
      enabled: coupon?.enabled ?? true,
    });
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-body form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{coupon ? '编辑优惠券模板' : '新增优惠券模板'}</h3>
        <label>
          模板名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 满30减5优惠券"
          />
        </label>
        <label>
          优惠券类型
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'full_reduce' | 'cash' | 'new_user')}
          >
            <option value="full_reduce">满减券(full_reduce)</option>
            <option value="cash">无门槛现金券(cash)</option>
          </select>
        </label>
        <div className="two">
          <label>
            使用门槛(¥)
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              disabled={kind === 'cash'}
            />
          </label>
          <label>
            优惠额度(¥)
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="5"
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="two">
          <label>
            有效天数
            <input
              value={validDays}
              onChange={(e) => setValidDays(e.target.value)}
              placeholder="30"
              inputMode="numeric"
            />
          </label>
          <label>
            发行限量 (留空不限)
            <input
              value={totalQuota}
              onChange={(e) => setTotalQuota(e.target.value)}
              placeholder="无限制"
              inputMode="numeric"
            />
          </label>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="modal-acts">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function RuleModal({
  storeId,
  rule,
  coupons,
  onClose,
  onSave,
}: {
  storeId: string;
  rule: MarketingRule | null;
  coupons: CouponTemplate[];
  onClose: () => void;
  onSave: (r: Parameters<typeof upsertMarketingRule>[0]) => void;
}) {
  const [name, setName] = useState(rule?.name ?? '');
  const [trigger, setTrigger] = useState(rule?.trigger ?? 'first_order');
  const [couponTemplateId, setCouponTemplateId] = useState(
    rule?.action?.coupon_template_id ?? ''
  );
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!couponTemplateId && coupons.length > 0) {
      setCouponTemplateId(coupons[0].id);
    }
  }, [coupons, couponTemplateId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErr('请填写规则名称');
      return;
    }
    if (!couponTemplateId) {
      setErr('请选择赠送券模板');
      return;
    }

    onSave({
      id: rule?.id ?? null,
      store_id: storeId,
      name: name.trim(),
      trigger,
      action: {
        type: 'issue_coupon',
        coupon_template_id: couponTemplateId,
      },
      enabled: rule?.enabled ?? true,
      priority: rule?.priority ?? 0,
    });
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-body form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{rule ? '编辑自动发券规则' : '新增自动发券规则'}</h3>
        <label>
          规则名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如 新人首单送券"
          />
        </label>
        <label>
          触发事件
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            <option value="first_order">用户首单成功(first_order)</option>
          </select>
        </label>
        <label>
          赠送券模板
          <select
            value={couponTemplateId}
            onChange={(e) => setCouponTemplateId(e.target.value)}
          >
            {coupons.length === 0 ? (
              <option value="">-- 无已启用模板，请先去创建或启用优惠券模板 --</option>
            ) : (
              coupons.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (门槛: ￥{c.threshold}, 额度: ￥{c.value})
                </option>
              ))
            )}
          </select>
        </label>
        {err && <div className="err">{err}</div>}
        <div className="modal-acts">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit" disabled={coupons.length === 0}>
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- 时间格式化(数据看板用) ----------
function fmtTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

// 订单状态中文映射
const ORDER_STATUS_LABEL: Record<string, string> = {
  created: '待支付',
  paid: '已支付',
  processing: '制作中',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已退款',
};

// ---------- 订单查询 Tab ----------
function OrdersTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<StoreOrderRow[] | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setErr('');
    setRows(null);
    try {
      const list = await fetchStoreOrders(storeId, filter || undefined);
      setRows(list);
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  }, [storeId, filter]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>订单查询{rows === null ? ' · 加载中…' : ` · 共 ${rows.length} 单`}</h2>
          <div className="filter-bar">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
              <option value="">全部状态</option>
              <option value="created">待支付</option>
              <option value="paid">已支付</option>
              <option value="processing">制作中</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
              <option value="refunded">已退款</option>
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
                  <th>订单号</th>
                  <th>桌台</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>支付方式</th>
                  <th>下单时间</th>
                  <th>明细</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="mono">{r.order_no}{r.is_addon && r.addon_seq ? `+${r.addon_seq}` : ''}</td>
                      <td>{r.point_name ?? <span className="muted">-</span>}</td>
                      <td>¥{Number(r.total).toFixed(2)}</td>
                      <td><span className={'badge order-' + r.status}>{ORDER_STATUS_LABEL[r.status] ?? r.status}</span></td>
                      <td className="muted">{r.pay_method ?? '-'}</td>
                      <td className="muted">{fmtTime(r.created_at)}</td>
                      <td>
                        <button className="small-btn" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                          {expanded === r.id ? '收起' : '展开'}
                        </button>
                      </td>
                    </tr>
                    {expanded === r.id && r.items.length > 0 && (
                      <tr className="detail-row">
                        <td colSpan={7}>
                          <div className="order-items">
                            {r.items.map((it, i) => (
                              <span key={i} className="order-item-chip">
                                {it.name} ×{it.qty} <span className="muted">¥{Number(it.price).toFixed(2)}</span>
                                {it.note && <span className="muted">({it.note})</span>}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="empty">暂无订单</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- 退款明细 Tab ----------
function RefundsTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<StoreRefundRow[] | null>(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    setErr('');
    setRows(null);
    try {
      const list = await fetchStoreRefunds(storeId);
      setRows(list);
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  }, [storeId]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>退款明细{rows === null ? ' · 加载中…' : ` · 共 ${rows.length} 笔`}</h2>
          <button onClick={reload}>刷新</button>
        </div>
        {err && <div className="banner err">加载失败：{err}</div>}
        {!err && rows !== null && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>金额</th>
                  <th>支付方式</th>
                  <th>退款原因</th>
                  <th>桌台</th>
                  <th>下单时间</th>
                  <th>支付时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.order_no}</td>
                    <td className="refund-amount">¥{Number(r.total).toFixed(2)}</td>
                    <td className="muted">{r.pay_method ?? '-'}</td>
                    <td>{r.cancel_reason ?? <span className="muted">-</span>}</td>
                    <td>{r.point_name ?? <span className="muted">-</span>}</td>
                    <td className="muted">{fmtTime(r.created_at)}</td>
                    <td className="muted">{fmtTime(r.paid_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="empty">暂无退款记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- 会员列表 Tab ----------
function MembersTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<StoreMemberRow[] | null>(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    setErr('');
    setRows(null);
    try {
      const list = await fetchStoreMembers(storeId);
      setRows(list);
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  }, [storeId]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>会员列表{rows === null ? ' · 加载中…' : ` · 共 ${rows.length} 位`}</h2>
          <button onClick={reload}>刷新</button>
        </div>
        {err && <div className="banner err">加载失败：{err}</div>}
        {!err && rows !== null && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>openid 尾号</th>
                  <th>手机号</th>
                  <th>余额</th>
                  <th>累计充值</th>
                  <th>消费累计</th>
                  <th>到店次数</th>
                  <th>注册时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">…{r.openid_tail}</td>
                    <td>{r.phone ?? <span className="muted">-</span>}</td>
                    <td className="balance-amount">¥{Number(r.balance).toFixed(2)}</td>
                    <td className="muted">¥{Number(r.topup_total).toFixed(2)}</td>
                    <td>¥{Number(r.total_spent).toFixed(2)}</td>
                    <td>{r.visit_count}</td>
                    <td className="muted">{fmtTime(r.created_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="empty">暂无会员</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- 操作日志 Tab ----------
function LogsTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<StaffLogRow[] | null>(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    setErr('');
    setRows(null);
    try {
      const list = await fetchStaffLogs(storeId);
      setRows(list);
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  }, [storeId]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>操作日志{rows === null ? ' · 加载中…' : ` · 共 ${rows.length} 条`}</h2>
          <button onClick={reload}>刷新</button>
        </div>
        {err && <div className="banner err">加载失败：{err}</div>}
        {!err && rows !== null && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>操作</th>
                  <th>状态</th>
                  <th>金额</th>
                  <th>桌台</th>
                  <th>操作时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{r.order_no}</td>
                    <td>{r.action}</td>
                    <td><span className={'badge order-' + r.status}>{ORDER_STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td>¥{Number(r.total).toFixed(2)}</td>
                    <td>{r.point_name ?? <span className="muted">-</span>}</td>
                    <td className="muted">{fmtTime(r.acted_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="empty">暂无操作记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- 员工管理 Tab ----------
function StaffTab({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<StaffRow | 'new' | null>(null);

  const reload = useCallback(async () => {
    setErr('');
    setRows(null);
    try {
      const list = await listStaff(storeId);
      setRows(list);
    } catch (e) {
      setErr(errText(e));
      setRows([]);
    }
  }, [storeId]);

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async (userId: string, name: string, roleId: string) => {
    try {
      const { error } = await upsertStaff(userId, storeId, name, roleId);
      if (error) throw error;
      setEditing(null);
      reload();
    } catch (e) {
      alert('保存员工失败：' + errText(e));
    }
  };

  return (
    <div className="wrap">
      <section className="panel">
        <div className="panel-head">
          <h2>员工管理{rows === null ? ' · 加载中…' : ` · 共 ${rows.length} 位`}</h2>
          <button className="primary" onClick={() => setEditing('new')}>+ 新增员工</button>
        </div>
        {err && <div className="banner err">加载失败：{err}</div>}
        {!err && rows !== null && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>用户ID (Auth UUID)</th>
                  <th>姓名</th>
                  <th>角色</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id}>
                    <td className="mono small">{r.user_id}</td>
                    <td>{r.name}</td>
                    <td>
                      <span className="badge on_sale">{r.role_name}</span>
                    </td>
                    <td className="muted">{fmtTime(r.created_at)}</td>
                    <td>
                      <button className="small-btn" onClick={() => setEditing(r)}>编辑角色</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="empty">暂无员工</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <StaffModal
          staff={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

interface StaffModalProps {
  staff: StaffRow | null;
  onClose: () => void;
  onSave: (userId: string, name: string, roleId: string) => void;
}

function StaffModal({ staff, onClose, onSave }: StaffModalProps) {
  const [userId, setUserId] = useState(staff?.user_id ?? '');
  const [name, setName] = useState(staff?.name ?? '');
  // 内置角色 ID：manager (店长), cashier (收银员)
  const [roleId, setRoleId] = useState(staff?.role_id ?? '00000000-0000-0000-0000-000000000004');
  const [err, setErr] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) { setErr('请填写用户ID'); return; }
    if (!name.trim()) { setErr('请填写姓名'); return; }
    onSave(userId.trim(), name.trim(), roleId);
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal-body form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{staff ? '编辑员工' : '新增员工'}</h3>
        <label>
          用户 ID (Supabase Auth uuid)
          <input 
            value={userId} 
            onChange={(e) => setUserId(e.target.value)} 
            placeholder="在 Supabase 注册的 Auth User ID" 
            disabled={!!staff}
          />
        </label>
        <label>
          姓名
          <input 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="输入员工姓名" 
          />
        </label>
        <label>
          选择角色
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="00000000-0000-0000-0000-000000000004">收银员 (cashier)</option>
            <option value="00000000-0000-0000-0000-000000000003">店长 (manager)</option>
          </select>
        </label>
        {err && <div className="err">{err}</div>}
        <div className="modal-acts">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  );
}

function errText(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { message?: string; error_description?: string; details?: string };
    return o.message || o.error_description || o.details || JSON.stringify(e);
  }
  return String(e);
}
