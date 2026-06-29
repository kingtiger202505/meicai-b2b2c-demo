import Taro from '@tarojs/taro';

export interface PayParams {
  timeStamp: string;
  nonceStr: string;
  package: string;       // prepay_id=xxx
  signType: 'MD5' | 'HMAC-SHA256' | 'RSA';
  paySign: string;
}

export interface CreateOrderResult {
  orderId: string;
  payParams: PayParams;
}

/**
 * 调用后端创建微信支付统一下单，返回支付参数
 * 实际项目：调用云函数 / 后端 API，用 openid + 金额 + 订单号 生成 prepay_id 并签名
 */
export async function createWxPayOrder(params: {
  orderId: string;
  amount: number;
  openId: string;
  description?: string;
}): Promise<PayParams> {
  // ===== 实际项目应这样写 =====
  // const res = await Taro.cloud.callFunction({
  //   name: 'createWxPayOrder',
  //   data: params
  // });
  // return res.result.payParams;

  // ===== 此处 mock 支付参数 =====
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: Math.random().toString(36).slice(2, 18),
        package: 'prepay_id=wx' + Date.now(),
        signType: 'RSA',
        paySign: 'MOCK_SIGN_' + Math.random().toString(36).slice(2, 10)
      });
    }, 300);
  });
}

/**
 * 发起微信支付
 * 调用 wx.requestPayment 唤起微信支付弹窗
 */
export async function requestWxPayment(payParams: PayParams): Promise<boolean> {
  return new Promise((resolve, reject) => {
    Taro.requestPayment({
      timeStamp: payParams.timeStamp,
      nonceStr: payParams.nonceStr,
      package: payParams.package,
      signType: payParams.signType as any,
      paySign: payParams.paySign,
      success: () => resolve(true),
      fail: (err) => {
        // 用户取消支付 errMsg: "requestPayment:fail cancel"
        if (err.errMsg && err.errMsg.indexOf('cancel') > -1) {
          resolve(false);
        } else {
          reject(err);
        }
      }
    });
  });
}

/**
 * 会员卡储值支付（前端模拟，实际由后端扣减余额）
 */
export async function payWithMemberCard(params: {
  orderId: string;
  amount: number;
  openId: string;
}): Promise<boolean> {
  // 实际项目：调用云函数扣减会员卡余额
  return new Promise((resolve) => {
    setTimeout(() => resolve(true), 500);
  });
}

/**
 * 完整支付流程：选支付方式 → 创建支付单 → 唤起支付 → 通知后端
 */
export async function payOrder(params: {
  orderId: string;
  amount: number;
  openId: string;
  method: '微信支付' | '会员卡';
}): Promise<{ success: boolean; reason?: string }> {
  try {
    let success = false;
    if (params.method === '微信支付') {
      const payParams = await createWxPayOrder(params);
      success = await requestWxPayment(payParams);
      if (!success) return { success: false, reason: '用户取消支付' };
    } else if (params.method === '会员卡') {
      success = await payWithMemberCard(params);
      if (!success) return { success: false, reason: '储值余额不足' };
    }
    // 通知后端支付结果（更新订单状态为已支付→待制作）
    // await Taro.cloud.callFunction({ name: 'confirmPay', data: { orderId: params.orderId } });
    return { success: true };
  } catch (e: any) {
    return { success: false, reason: e.message || '支付失败' };
  }
}
