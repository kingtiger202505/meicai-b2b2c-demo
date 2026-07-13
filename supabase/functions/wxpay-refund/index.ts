// Edge Function: wxpay-refund
// 微信支付退款(服务商模式)
// 资质到位前用 sandbox 模式: 直接调 refund_order_by_id(库内置 refunded + 余额回滚)
// 资质到位后切 live: 调微信退款 API + 回写 refund_order_by_id
//
// 部署: supabase functions deploy wxpay-refund --no-verify-jwt
//
// 机密同 wxpay-create(WXPAY_SP_* + WXPAY_APIV3_KEY)
//
// 入参(POST JSON): { order_id, reason? }
// 出参: { order_id, status, wx_refund_id? }
//
// 退款逻辑:
//   1) 余额支付订单: 直接调 refund_order_by_id(余额回滚,无需调微信)
//   2) 微信支付订单:
//      - sandbox: 调 refund_order_by_id(库内置 refunded,资金未真退)
//      - live: 调微信退款 API /v3/refund/domestic/refunds,成功后调 refund_order_by_id

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODE = Deno.env.get('WXPAY_MODE') ?? 'sandbox';

Deno.serve(async (req: Request) => {
  try {
    const { order_id, reason } = await req.json();
    if (!order_id) return json({ error: 'missing_order_id' }, 400);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 查订单(确认支付方式 + 金额)
    const { data: detail, error } = await sb
      .from('orders')
      .select('id, store_id, total, pay_method, status, member_id')
      .eq('id', order_id)
      .single();
    if (error || !detail) return json({ error: 'order_not_found' }, 404);
    const order = detail;

    if (!['paid', 'processing'].includes(order.status)) {
      return json({ error: 'order_not_refundable', status: order.status }, 409);
    }

    // 余额支付订单: 直接库内回滚(无需调微信)
    if (order.pay_method === 'balance') {
      const { data, error: refundError } = await sb.rpc('refund_order_by_id', {
        p_order_id: order_id, p_wx_refund_id: null, p_reason: reason,
      });
      if (refundError) return json({ code: 'FAIL', message: refundError.message }, 500);
      return json({ code: 'SUCCESS', order_id, ...data });
    }

    // 微信支付订单
    if (MODE === 'sandbox') {
      // sandbox: 库内置 refunded(资金未真退,联调用)
      const { data, error: refundError } = await sb.rpc('refund_order_by_id', {
        p_order_id: order_id,
        p_wx_refund_id: 'MOCK_REFUND_' + Date.now(),
        p_reason: reason,
      });
      if (refundError) return json({ code: 'FAIL', message: refundError.message }, 500);
      return json({ code: 'SUCCESS', order_id, ...data, mode: 'sandbox' });
    }

    // === live: 调微信支付退款 API(服务商模式) ===
    // TODO(资质到位后实现):
    //  1) 查门店 sub_mchid
    //     const { data: subMchid } = await sb.rpc('get_store_sub_mchid', { p_store_id: order.store_id });
    //  2) POST https://api.mch.weixin.qq.com/v3/refund/domestic/refunds
    //     body: {
    //       sub_mchid: subMchid,
    //       out_trade_no: order.id.replace(/-/g,''),  // 原下单时的 out_trade_no
    //       out_refund_no: 'R' + Date.now(),          // 退款单号(全局唯一)
    //       reason: reason ?? '用户申请退款',
    //       amount: {
    //         refund: Math.round(order.total * 100),  // 退款金额(分)
    //         total: Math.round(order.total * 100),   // 原订单金额(分)
    //         currency: 'CNY'
    //       }
    //     }
    //     用服务商私钥做 v3 签名
    //  3) 微信返回 { refund_id, status } (status: SUCCESS/CLOSED/PROCESSING/ABNORMAL)
    //  4) status=SUCCESS 时调 refund_order_by_id 回写库
    //     退款有异步回调(可选),也可用此同步结果
    return json({
      error: 'live_not_implemented',
      need: 'WXPAY_SP_* secrets + v3 退款签名',
      mode: 'live',
      order_id,
    }, 501);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}
