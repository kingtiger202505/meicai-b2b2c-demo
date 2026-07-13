// Edge Function: wxpay-create
// 微信支付 JSAPI 统一下单 —— 服务商模式(sp_mchid + sub_mchid)
// 资质到位前用 sandbox 模式跑通全链路,live 模式实现 v3 签名后切换
//
// 部署: supabase functions deploy wxpay-create
//
// 机密只放 Supabase Function Secrets(绝不进小程序、绝不入库):
//   WXPAY_MODE=sandbox|live              # sandbox: mock paySign; live: 真签名
//   WXPAY_SP_MCHID=<服务商商户号>         # 服务商模式: 平台的 mchid
//   WXPAY_APIV3_KEY=<APIv3密钥>           # 服务商 APIv3 密钥
//   WXPAY_SP_CERT_SERIAL=<服务商证书序列号>
//   WXPAY_SP_PRIVATE_KEY=<服务商API私钥PEM>
//   WX_APPID=<服务商小程序AppID>          # 必须已绑定到服务商商户号
//   NOTIFY_URL=https://<icp域名>/wxpay-notify
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

    // 用 service_role 读订单(金额一律以库为准,绝不信前端传值)
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: detail, error } = await sb.rpc('query_order', { p_order_token: order_token });
    if (error || !detail?.order) return json({ error: 'order_not_found' }, 404);
    const order = detail.order;
    if (order.status !== 'created') return json({ error: 'order_not_payable' }, 409);

    const amountFen = Math.round(Number(order.total) * 100); // 微信支付单位为分

    // 查门店的 sub_mchid(服务商模式下,资金直清到特约商户号)
    const { data: subMchid } = await sb.rpc('get_store_sub_mchid', { p_store_id: order.store_id });
    if (!subMchid) {
      // 门店未进件: sandbox 模式允许继续(mock),live 模式拒绝
      if (MODE === 'live') return json({ error: 'merchant_not_onboarded', store_id: order.store_id }, 403);
    }

    // out_trade_no: 用 orders.id 去掉'-'(uuid hex, 全局唯一; order_no 仅店内唯一不能直接用)
    const outTradeNo = (order.id as string).replace(/-/g, '');

    if (MODE === 'sandbox') {
      // sandbox: 返回占位 paySign,前端走 mock 支付分支联调整条链路
      // 小程序拿到这些参数后,可直接调 mock_pay_order 跑通下游(建会员/券/状态)
      return json({
        mode: 'sandbox',
        order_no: order.order_no,
        out_trade_no: outTradeNo,
        amount_fen: amountFen,
        sub_mchid: subMchid ?? 'MOCK_SUB_MCHID',
        payParams: {
          timeStamp: String(Math.floor(Date.now() / 1000)),
          nonceStr: Math.random().toString(36).slice(2, 18),
          package: 'prepay_id=wx_sandbox_' + outTradeNo,
          signType: 'RSA',
          paySign: 'MOCK_SIGN_' + Math.random().toString(36).slice(2, 10),
        },
        hint: '接入服务商资质后切 WXPAY_MODE=live',
      });
    }

    // === live: 调微信支付 v3 服务商模式 JSAPI 统一下单 ===
    // TODO(资质到位后实现):
    //  1) POST https://api.mch.weixin.qq.com/v3/pay/partner/transactions/jsapi
    //     body: {
    //       sp_appid: WX_APPID,
    //       sp_mchid: WXPAY_SP_MCHID,
    //       sub_appid: WX_APPID,            // 若子商户用同一小程序则为同值;否则用子商户 appid
    //       sub_mchid: subMchid,
    //       description: `订单 ${order.order_no}`,
    //       out_trade_no: outTradeNo,
    //       time_expire: '...',
    //       attach: JSON.stringify({ order_id: order.id, store_id: order.store_id }),
    //       notify_url: NOTIFY_URL,
    //       amount: { total: amountFen, currency: 'CNY' },
    //       payer: { openid, sub_openid: openid }  // 服务商模式用 sub_openid
    //     }
    //     用服务商私钥做 v3 请求签名(Authorization: WECHATPAY2-SHA256-RSA2048)
    //  2) 拿到 prepay_id,再用 WX_APPID + timeStamp + nonceStr + package=prepay_id=xxx
    //     二次签名(RSA) 生成 paySign
    //  3) 返回 { timeStamp, nonceStr, package, signType:'RSA', paySign }
    return json({
      error: 'live_not_implemented',
      need: 'WXPAY_SP_* secrets + v3 签名实现 + 平台证书下载',
      mode: 'live',
      out_trade_no: outTradeNo,
      amount_fen: amountFen,
      sub_mchid: subMchid,
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
