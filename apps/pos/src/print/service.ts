import { receiptDocument, type ReceiptPair } from './receipt';

// ============================================================
// PrintService 抽象层
// 门店出单不写死浏览器打印：统一走 PrintService.print(pair)。
// 当前实现为浏览器打印（方案 C）；云打印 / WebUSB 为预留扩展点，
// 接口就位即可，本期不落地具体驱动（PRD Out of scope）。
// ============================================================

export type PrintChannel = 'browser' | 'cloud' | 'webusb';

export interface PrintService {
  /** 打印通道标识 */
  readonly channel: PrintChannel;
  /** 该通道当前是否可用 */
  isAvailable(): boolean;
  /** 打印两联小票（后厨单 + 顾客联） */
  print(pair: ReceiptPair): Promise<void>;
}

// ---------- 浏览器打印实现（方案 C）----------
// 通过隐藏 iframe 写入 58mm 版式文档并调用 print()，
// 不依赖当前页面 DOM，接单副作用可无弹窗静默出单。
export class BrowserPrintService implements PrintService {
  readonly channel = 'browser' as const;

  isAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.print === 'function';
  }

  print(pair: ReceiptPair): Promise<void> {
    return new Promise<void>((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      Object.assign(iframe.style, {
        position: 'fixed', right: '0', bottom: '0',
        width: '0', height: '0', border: '0', visibility: 'hidden',
      } as CSSStyleDeclaration);
      document.body.appendChild(iframe);

      const cleanup = () => { try { iframe.remove(); } catch { /* noop */ } resolve(); };
      const doc = iframe.contentWindow?.document;
      if (!doc) { cleanup(); return; }

      doc.open();
      doc.write(receiptDocument(pair));
      doc.close();

      const win = iframe.contentWindow!;
      const fire = () => {
        try {
          win.focus();
          win.print();
        } finally {
          // 给打印对话框留出时间再回收 iframe
          setTimeout(cleanup, 800);
        }
      };
      // 等 iframe 文档就绪再打印
      if (doc.readyState === 'complete') setTimeout(fire, 50);
      else win.addEventListener('load', () => setTimeout(fire, 50), { once: true });
    });
  }
}

// ---------- 云打印扩展点（飞鹅云等，本期不实现）----------
export class CloudPrintService implements PrintService {
  readonly channel = 'cloud' as const;
  isAvailable(): boolean { return false; }
  print(_pair: ReceiptPair): Promise<void> {
    return Promise.reject(new Error('CloudPrintService 未实现：云打印驱动为后续扩展点'));
  }
}

// ---------- WebUSB 直连扩展点（ESC/POS，本期不实现）----------
export class WebUsbPrintService implements PrintService {
  readonly channel = 'webusb' as const;
  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }
  print(_pair: ReceiptPair): Promise<void> {
    return Promise.reject(new Error('WebUsbPrintService 未实现：WebUSB/ESC-POS 驱动为后续扩展点'));
  }
}

// 通道注册表——后续接入云打印/WebUSB 只需在此登记，调用方无需改动。
const REGISTRY: Record<PrintChannel, () => PrintService> = {
  browser: () => new BrowserPrintService(),
  cloud: () => new CloudPrintService(),
  webusb: () => new WebUsbPrintService(),
};

let active: PrintService = REGISTRY.browser();

/** 获取当前打印服务（默认浏览器打印） */
export function getPrintService(): PrintService {
  return active;
}

/** 切换打印通道（为云打印/WebUSB 预留；不可用则回退浏览器） */
export function setPrintChannel(channel: PrintChannel): PrintService {
  const svc = (REGISTRY[channel] ?? REGISTRY.browser)();
  active = svc.isAvailable() ? svc : REGISTRY.browser();
  return active;
}
