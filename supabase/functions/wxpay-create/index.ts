// Edge Function: wxpay-create
// 微信支付 JSAPI 统一下单（普通商户直连模式，第一步）。
// 部署: supabase functions deploy wxpay-create
//
// 机密只放 Supabase Function Secrets（绝不进小程序、绝不入库）:
//   WXPAY_MODE=sandbox|live         # 未拿到商户号前用 sandbox 空跑联调
//   WXPAY_MCHID=<普通商户号>
//   WXPAY_APIV3_KEY=<APIv3密钥>
//   WXPAY_MCH_CERT_SERIAL=<商户证书序列号>
//   WXPAY_MCH_PRIVATE_KEY=<商户API私钥PEM>
//   WX_APPID=<小程序AppID>           # 必须已绑定到该商户号
//   NOTIFY_URL=https://<ref>.functions.supabase.co/wxpay-notify
//
// 入参(POST JSON): { order_token, openid }
// 出参: 小程序 wx.requestPayment 所需的签名参数

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODE = Deno.env.get('WXPAY_MODE') ?? 'sandbox';

Deno.serve(async (req: Request) => {
  try {
    const { order_token, openid } = await req.json();
    if (!order_token || !openid) return json({ error: 'missing_params' }, 400);

    // 用 service_role 读订单金额（金额一律以库为准，绝不信前端传值）
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: detail, error } = await sb.rpc('query_order', { p_order_token: order_token });
    if (error || !detail?.order) return json({ error: 'order_not_found' }, 404);
    const order = detail.order;
    if (order.status !== 'created') return json({ error: 'order_not_payable' }, 409);

    const amountFen = Math.round(Number(order.total) * 100); // 微信支付单位为分

    if (MODE === 'sandbox') {
      // 未接真商户前：返回占位参数，前端可走 mock 分支联调整条链路
      return json({
        mode: 'sandbox',
        order_no: order.order_no,
        amount_fen: amountFen,
        payParams: null,
        hint: '接入真实商户号后切 WXPAY_MODE=live',
      });
    }

    // === live: 调微信支付 v3 JSAPI 统一下单 ===
    // TODO(接真商户后实现):
    //  1) POST https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi
    //     out_trade_no: order.id 去掉'-'(uuid hex, 全局唯一; order_no 仅店内唯一不能直接用)
    //     body: { appid: WX_APPID, mchid, description, out_trade_no,
    //             notify_url: NOTIFY_URL, amount:{total:amountFen,currency:'CNY'},
    //             payer:{ openid } }
    //     用商户私钥做 v3 请求签名(Authorization: WECHATPAY2-SHA256-RSA2048 ...)
    //  2) 拿到 prepay_id，再用 WX_APPID + timeStamp + nonceStr + package=prepay_id=xxx
    //     二次签名(RSA) 生成 paySign
    //  3) 返回 { timeStamp, nonceStr, package, signType:'RSA', paySign }
    return json({ error: 'live_not_implemented', need: 'WXPAY_* secrets + 签名实现' }, 501);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}
