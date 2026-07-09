// 浏览器端出票通道（WX-25）：WebUSB / Web Serial（usb_serial）与 Web Bluetooth（bluetooth）。
// 含特性检测与 ESC/POS 测试小票构造。这些 Web 能力仅在 Chromium 系桌面浏览器 + 安全上下文（HTTPS 或 localhost）可用。

export interface Support {
  secure: boolean;
  webusb: boolean;
  webserial: boolean;
  webbluetooth: boolean;
}

export function detectSupport(): Support {
  const nav = navigator as Navigator & { usb?: unknown; serial?: unknown; bluetooth?: unknown };
  return {
    secure: typeof window !== 'undefined' && window.isSecureContext,
    webusb: typeof nav.usb !== 'undefined',
    webserial: typeof nav.serial !== 'undefined',
    webbluetooth: typeof nav.bluetooth !== 'undefined',
  };
}

export function usbSerialSupported(s: Support): boolean {
  return s.secure && (s.webserial || s.webusb);
}

export function bluetoothSupported(s: Support): boolean {
  return s.secure && s.webbluetooth;
}

// 构造一张 ESC/POS 测试小票字节流（内容尽量 ASCII，避免热敏机中文乱码）。
export function buildEscposReceipt(storeId: string): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const push = (bytes: number[]) => parts.push(...bytes);
  const text = (s: string) => push(Array.from(enc.encode(s)));

  push([0x1b, 0x40]); // ESC @ 初始化
  push([0x1b, 0x61, 0x01]); // 居中
  push([0x1d, 0x21, 0x11]); // 倍高倍宽
  text('TEST\n');
  push([0x1d, 0x21, 0x00]);
  push([0x1b, 0x61, 0x00]); // 左对齐
  text('--------------------------------\n');
  text(`store: ${storeId}\n`);
  text(`time : ${new Date().toISOString()}\n`);
  text('--------------------------------\n');
  text('minimize test receipt (WX-25)\n');
  push([0x0a, 0x0a, 0x0a]);
  push([0x1d, 0x56, 0x00]); // 切纸
  return new Uint8Array(parts);
}

async function printViaWebSerial(data: Uint8Array, baudRate: number): Promise<void> {
  const nav = navigator as Navigator & { serial: { requestPort(): Promise<SerialPortLike> } };
  const port = await nav.serial.requestPort(); // 用户手势 + 授权弹窗
  await port.open({ baudRate: baudRate || 9600 });
  try {
    const writer = port.writable.getWriter();
    await writer.write(data);
    writer.releaseLock();
  } finally {
    await port.close();
  }
}

async function printViaWebUSB(data: Uint8Array): Promise<void> {
  const nav = navigator as Navigator & { usb: { requestDevice(o: { filters: unknown[] }): Promise<USBDeviceLike> } };
  const device = await nav.usb.requestDevice({ filters: [] }); // 授权弹窗
  await device.open();
  if (device.configuration == null) await device.selectConfiguration(1);
  const config = device.configuration;
  if (config == null) throw new Error('USB 设备未就绪（无可用配置）');
  const iface = config.interfaces[0];
  await device.claimInterface(iface.interfaceNumber);
  const ep = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
  if (!ep) throw new Error('未找到可用的 USB bulk-out 端点');
  await device.transferOut(ep.endpointNumber, data);
  await device.close();
}

// 优先 Web Serial，回退 WebUSB。
export async function printUsbSerial(storeId: string, baudRate: number): Promise<void> {
  const s = detectSupport();
  if (!s.secure) throw new Error('当前环境非 HTTPS，浏览器禁用 USB/串口访问');
  const data = buildEscposReceipt(storeId);
  if (s.webserial) return printViaWebSerial(data, baudRate);
  if (s.webusb) return printViaWebUSB(data);
  throw new Error('当前浏览器不支持 WebUSB / Web Serial，请用 Chrome/Edge 桌面端');
}

// 经 Web Bluetooth 连接并写入 ESC/POS（尝试常见热敏服务）。
export async function printBluetooth(storeId: string): Promise<void> {
  const s = detectSupport();
  if (!s.secure) throw new Error('当前环境非 HTTPS，浏览器禁用蓝牙访问');
  if (!s.webbluetooth) throw new Error('当前浏览器不支持 Web Bluetooth，请用 Chrome/Edge 桌面端');

  const knownServices = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  ];
  const nav = navigator as Navigator & {
    bluetooth: {
      requestDevice(o: { acceptAllDevices?: boolean; optionalServices?: string[] }): Promise<BluetoothDeviceLike>;
    };
  };
  const device = await nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: knownServices });
  const server = await device.gatt.connect();

  let characteristic: BluetoothCharacteristicLike | undefined;
  for (const svc of knownServices) {
    try {
      const service = await server.getPrimaryService(svc);
      const chars = await service.getCharacteristics();
      characteristic = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (characteristic) break;
    } catch {
      /* 该服务不存在，尝试下一个 */
    }
  }
  if (!characteristic) {
    server.disconnect();
    throw new Error('未在该蓝牙设备上找到可写的打印特征值');
  }

  const data = buildEscposReceipt(storeId);
  const chunk = 180; // 分片，避免超过 BLE MTU
  for (let i = 0; i < data.length; i += chunk) {
    const slice = data.slice(i, i + chunk);
    if (characteristic.properties.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(slice);
    } else {
      await characteristic.writeValue(slice);
    }
  }
  server.disconnect();
}

// ---- 精简的 Web 设备类型声明（避免引入额外 @types 依赖）----

interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): { write(d: Uint8Array): Promise<void>; releaseLock(): void } };
}
interface USBEndpointLike {
  direction: string;
  type: string;
  endpointNumber: number;
}
interface USBInterfaceLike {
  interfaceNumber: number;
  alternate: { endpoints: USBEndpointLike[] };
}
interface USBDeviceLike {
  configuration: { interfaces: USBInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(ep: number, data: Uint8Array): Promise<unknown>;
}
interface BluetoothCharacteristicLike {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(d: Uint8Array): Promise<void>;
  writeValueWithoutResponse(d: Uint8Array): Promise<void>;
}
interface BluetoothServiceLike {
  getCharacteristics(): Promise<BluetoothCharacteristicLike[]>;
}
interface BluetoothServerLike {
  getPrimaryService(uuid: string): Promise<BluetoothServiceLike>;
  disconnect(): void;
}
interface BluetoothDeviceLike {
  gatt: { connect(): Promise<BluetoothServerLike> };
}
