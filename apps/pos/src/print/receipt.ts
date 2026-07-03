import type { KitchenTicket, CustomerTicket } from '@meicai/shared';

// 一次打印的两联数据
export interface ReceiptPair {
  kitchen: KitchenTicket;
  customer: CustomerTicket;
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const money = (n: number): string => `¥${(Number(n) || 0).toFixed(2)}`;

const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

// 58mm 版式 + @media print（去页眉页脚、固定纸宽）。预览与打印共用同一套样式。
export function receiptStyles(): string {
  return `
  @page { size: 58mm auto; margin: 0; }
  .rcpt-sheet { width: 58mm; margin: 0 auto; color: #000;
    font-family: "PingFang SC", "Microsoft YaHei", monospace; }
  .rcpt-sheet * { box-sizing: border-box; }
  .rcpt { padding: 3mm 2.5mm 4mm; font-size: 12px; line-height: 1.5; }
  .rcpt + .rcpt { border-top: 2px dashed #000; }
  .rcpt .title { text-align: center; font-size: 15px; font-weight: 700; margin: 0 0 2px; }
  .rcpt .store { text-align: center; font-size: 12px; margin-bottom: 2px; }
  .rcpt .pickup { text-align: center; font-size: 20px; font-weight: 800; margin: 3px 0; }
  .rcpt .pickup small { font-size: 11px; font-weight: 500; display: block; }
  .rcpt .meta { font-size: 11px; }
  .rcpt .sep { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  .rcpt .row { display: flex; justify-content: space-between; gap: 6px; }
  .rcpt .row .n { flex: 1; word-break: break-all; }
  .rcpt .note { font-size: 11px; padding-left: 2px; }
  .rcpt .addon { display: inline-block; border: 1px solid #000; border-radius: 3px;
    padding: 0 4px; font-size: 11px; font-weight: 700; margin-left: 4px; }
  .rcpt .strong { font-weight: 700; font-size: 13px; }
  .rcpt .center { text-align: center; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; }
    .rcpt + .rcpt { page-break-before: always; }
  }`;
}

function kitchenHtml(k: KitchenTicket): string {
  const lines = k.lines.map((l) => {
    const addon = k.addon ? ` <span class="addon">加菜</span>` : '';
    const note = l.note ? `<div class="note">↳ ${esc(l.note)}</div>` : '';
    return `<div class="row"><span class="n">${esc(l.name)}${addon}</span><span>×${esc(l.qty)}</span></div>${note}`;
  }).join('');
  const addonBadge = k.addon
    ? `<span class="addon">加菜${k.addon_seq ? '·' + esc(k.addon_seq) : ''}</span>`
    : '';
  return `<div class="rcpt">
    <div class="title">${esc(k.title)} ${addonBadge}</div>
    <div class="pickup"><small>${esc(k.pickup.label)}</small>${esc(k.pickup.value)}</div>
    <div class="meta">流水号：${esc(k.order_no)}</div>
    <div class="meta">下单：${fmtTime(k.created_at)}</div>
    <hr class="sep" />
    ${lines || '<div class="center">（无菜品）</div>'}
  </div>`;
}

function customerHtml(c: CustomerTicket): string {
  const lines = c.lines.map((l) => {
    const amt = money((l.price ?? 0) * l.qty);
    return `<div class="row"><span class="n">${esc(l.name)} ×${esc(l.qty)}</span><span>${amt}</span></div>`;
  }).join('');
  const discountRow = c.discount > 0
    ? `<div class="row"><span class="n">优惠</span><span>-${money(c.discount)}</span></div>`
    : '';
  // 会员余额：仅会员订单显示；非会员 member_balance 为 null，整行隐藏。
  const memberRow = c.member_balance != null
    ? `<div class="row"><span class="n">会员余额</span><span>${money(c.member_balance)}</span></div>`
    : '';
  return `<div class="rcpt">
    <div class="title">${esc(c.title)}</div>
    <div class="store">${esc(c.store_name)}</div>
    <div class="pickup"><small>${esc(c.pickup.label)}</small>${esc(c.pickup.value)}</div>
    <div class="meta">流水号：${esc(c.order_no)}</div>
    <div class="meta">下单：${fmtTime(c.created_at)}</div>
    <hr class="sep" />
    ${lines}
    <hr class="sep" />
    <div class="row"><span class="n">小计</span><span>${money(c.subtotal)}</span></div>
    ${discountRow}
    <div class="row strong"><span class="n">合计</span><span>${money(c.total)}</span></div>
    <div class="row strong"><span class="n">实付</span><span>${money(c.paid)}</span></div>
    <div class="row"><span class="n">支付方式</span><span>${esc(c.pay_method ?? '—')}</span></div>
    ${memberRow}
  </div>`;
}

// 两联主体（不含 <html>/<style>），预览弹窗与 iframe 打印共用。
export function receiptBodyHtml(pair: ReceiptPair): string {
  return `<div class="rcpt-sheet">${kitchenHtml(pair.kitchen)}${customerHtml(pair.customer)}</div>`;
}

// 完整可打印文档（供 iframe 打印用，自带 58mm 样式）。
export function receiptDocument(pair: ReceiptPair): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
    <title>小票 ${esc(pair.customer.order_no)}</title>
    <style>${receiptStyles()}</style></head>
    <body>${receiptBodyHtml(pair)}</body></html>`;
}
