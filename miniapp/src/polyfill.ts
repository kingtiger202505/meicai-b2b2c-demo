// H5 兜底：浏览器没有 Node 的 `process` 全局。
// 构建期本应由 defineConstants 把 process.env.TARO_APP_* 内联成字符串常量；
// 万一某处 process.env.* 未被替换，这里保证 process/process.env 存在，
// 避免整站因 `ReferenceError: process is not defined` 在挂载前崩溃(白屏)。
// 必须作为 app 入口的第一个 import，早于任何读取 process.env 的模块。
declare const globalThis: any;
if (typeof globalThis !== 'undefined' && typeof globalThis.process === 'undefined') {
  globalThis.process = { env: {} };
}
export {};
