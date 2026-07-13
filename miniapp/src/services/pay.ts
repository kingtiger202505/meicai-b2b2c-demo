import Taro from '@tarojs/taro';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isBackendConfigured } from './supabase';

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

const WXPAY_CREATE_URL = `${SUPABASE_URL}/functions/v1/wxpay-create`;

/**
 * 调用 wxpay-create Edge Function 创建微信支付订单(服务商模式)
 * sandbox 模式: 返回占位 paySign,前端直接走 mock 支付成功
 * live 模式: 返回真 paySign,前端调 wx.requestPayment 唤起微信支付
 */
export async function createWxPayOrder(params: {
  orderToken: string;      // 订单 token(Edge Function 用它查订单金额)
  orderId: string;
  amount: number;
  openId: string;
  description?: string;
}): Promise<{ payParams: PayParams; mode: string; outTradeNo?: string }> {
  // 后端未配置: 返回纯 mock(兼容旧 demo)
  if (!isBackendConfigured()) {
    return {
      payParams: {
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: Math.random().toString(36).slice(2, 18),
        package: 'prepay_id=wx' + Date.now(),
        signType: 'RSA',
        paySign: 'MOCK_SIGN_' + Math.random().toString(36).slice(2, 10),
      },
      mode: 'local-mock',
    };
  }

  // 调 Edge Function
  const res = await Taro.request({
    url: WXPAY_CREATE_URL,
    method: 'POST',
    header: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    data: {
      order_token: params.orderToken,
      openid: params.openId,
    },
  });

  if (res.statusCode >= 400) {
    const msg = res.data?.error || `wxpay-create 失败(${res.statusCode})`;
    throw new Error(msg);
  }

  const data = res.data;
  if (!data?.payParams) {
    throw new Error(data?.error || 'wxpay-create 未返回 payParams');
  }

  return {
    payParams: data.payParams as PayParams,
    mode: data.mode ?? 'unknown',
    outTradeNo: data.out_trade_no,
  };
}

/**
 * 发起微信支付
 * 调用 wx.requestPayment 唤起微信支付弹窗
 * sandbox 模式下 paySign 是假的,wx.requestPayment 会失败 —— 由调用方走 mock 分支
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
 * 会员卡储值支付(前端模拟,实际由后端扣减余额)
 * @deprecated 已由 services/member.ts payWithBalance 真接口取代,保留仅为兼容
 */
export async function payWithMemberCard(_params: {
  orderId: string;
  amount: number;
  openId: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(true), 500);
  });
}

/**
 * 完整支付流程:选支付方式 → 创建支付单 → 唤起支付 → 通知后端
 * 仅用于"我的订单"页重新支付(本地订单 mock);新下单走 menu 页的 settleOrder
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
      const payParams = await createWxPayOrder({
        orderToken: '',
        orderId: params.orderId,
        amount: params.amount,
        openId: params.openId,
      });
      success = await requestWxPayment(payParams.payParams);
      if (!success) return { success: false, reason: '用户取消支付' };
    } else if (params.method === '会员卡') {
      success = await payWithMemberCard(params);
      if (!success) return { success: false, reason: '储值余额不足' };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, reason: e.message || '支付失败' };
  }
}
