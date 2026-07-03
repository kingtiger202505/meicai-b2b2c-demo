export type { ReceiptPair } from './receipt';
export { receiptStyles, receiptBodyHtml, receiptDocument } from './receipt';
export type { PrintService, PrintChannel } from './service';
export {
  BrowserPrintService, CloudPrintService, WebUsbPrintService,
  getPrintService, setPrintChannel,
} from './service';
