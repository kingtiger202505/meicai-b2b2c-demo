// Edge Function: wxpay-notify
// 微信支付结果异步回调(服务商模式)
// 资质到位前用 sandbox 模式: 由小程序 mock 支付成功后主动调用,绕过验签直走下游
// 资质到位后切 live: 验签 + 解密 + 幂等置 paid + 无感建会员
//
// 部署: supabase functions deploy wxpay-notify --no-verify-jwt
// (回调由微信服务器发起,无用户 JWT,需 --no-verify-jwt)
//
// 机密同 wxpay-create(WXPAY_APIV3_KEY 用于回调验签/解密,微信支付平台证书用于验签)
//
// 微信支付支付通知 v3: POST,body 为加密的支付结果;需:
//  1) 用 平台证书 验 Wechatpay-Signature 头(防伪造)
//  2) 用 WXPAY_APIV3_KEY 对 resource(AEAD_AES_256_GCM) 解密得明文
//  3) 幂等处理 out_trade_no(=order_id uuid hex) 与 transaction_id
//  4) 成功后: pay_order_by_id 置 paid;若是储值充值单(attach 标记 topup),改调 topup_member

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODE = Deno.env.get('WXPAY_MODE') ?? 'sandbox';

Deno.serve(async (req: Request) => {
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json();

    if (MODE === 'sandbox') {
      // sandbox: 小程序 mock 支付成功后主动调用,绕过验签直走下游
      // 入参: { order_id, openid, phone?, type: 'order'|'topup', member_id?, amount?, gift? }
      const { order_id, openid, phone, type, member_id, amount, gift } = body;

      if (type === 'topup' && member_id && amount) {
        // 储值充值: 调 topup_member(幂等,按 wx_transaction_id 去重)
        const mockTxnId = 'MOCK_TOPUP_' + Date.now();
        const { data, error } = await sb.rpc('topup_member', {
          p_member_id: member_id, p_amount: Number(amount),
          p_wx_transaction_id: mockTxnId, p_gift: Number(gift ?? 0),
        });
        if (error) return json({ code: 'FAIL', message: error.message }, 500);
        return json({ code: 'SUCCESS', message: 'OK (sandbox topup)', data });
      }

      // 普通订单支付: 调 pay_order_by_id(幂等)
      if (order_id) {
        const mockTxnId = 'MOCK_PAY_' + Date.now();
        const { data, error } = await sb.rpc('pay_order_by_id', {
          p_order_id: order_id, p_wx_transaction_id: mockTxnId, p_pay_method: 'wechat',
        });
        if (error) return json({ code: 'FAIL', message: error.message }, 500);

        // 无感建/更新会员(openid + 手机号) —— 这是私域护城河核心
        if (openid) {
          // 需 store_id: 从订单查
          const { data: orderDetail } = await sb.rpc('query_order', { p_order_token: body.order_token });
          const storeId = orderDetail?.order?.store_id;
          if (storeId) {
            await sb.rpc('get_or_create_member', {
              p_store_id: storeId, p_openid: openid, p_phone: phone ?? null,
            });
          }
        }
        return json({ code: 'SUCCESS', message: 'OK (sandbox order)', data });
      }

      return json({ code: 'FAIL', message: 'sandbox: missing order_id or topup params' }, 400);
    }

    // === live: 微信支付结果异步回调 ===
    // TODO(资质到位后实现):
    //  1) 验 Wechatpay-Signature 头(用微信支付平台证书),失败返回 401
    //     - 需先 GET https://api.mch.weixin.qq.com/v3/certificates 下载平台证书
    //     - 用 WXPAY_APIV3_KEY 解密证书的 encrypt_certificate 得平台公钥
    //     - 验签: Wechatpay-Timestamp + Wechatpay-Nonce + body + Wechatpay-Serial + Wechatpay-Signature
    //  2) 用 WXPAY_APIV3_KEY 对 body.resource(AEAD_AES_256_GCM)解密得明文
    //     明文结构: { out_trade_no, transaction_id, trade_state, amount, payer{openid}, attach }
    //  3) 幂等处理: 按 out_trade_no(还原为 order_id uuid) + transaction_id 去重
    //  4) 根据 attach 判断:
    //    - 普通订单(attach 无 topup 标记):
    //       await sb.rpc('pay_order_by_id', { p_order_id, p_wx_transaction_id: transaction_id, p_pay_method:'wechat' })
    //       无感建会员: get_or_create_member(store_id, openid) —— openid 来自 payer
    //    - 储值充值单(attach 含 {type:'topup', member_id, gift}):
    //       await sb.rpc('topup_member', { p_member_id, p_amount, p_wx_transaction_id: transaction_id, p_gift })
    const _ = body; void _; void sb;
    return json({ code: 'SUCCESS', message: 'OK (live skeleton - TODO 验签解密)' });
  } catch (e: any) {
    // 返回非 200,微信会按策略重推
    return json({ code: 'FAIL', message: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}
