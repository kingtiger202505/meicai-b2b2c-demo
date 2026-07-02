// Edge Function: wxpay-notify
// 微信支付结果异步回调。验签+解密后：幂等置订单 paid，并无感沉淀会员。
// 部署: supabase functions deploy wxpay-notify --no-verify-jwt
// (回调由微信服务器发起，无用户 JWT，需 --no-verify-jwt)
//
// 机密同 wxpay-create（WXPAY_APIV3_KEY 用于回调验签/解密，微信支付平台证书用于验签）。
//
// 微信支付支付通知 v3: POST，body 为加密的支付结果；需:
//  1) 用 平台证书 验 Wechatpay-Signature 头（防伪造）
//  2) 用 WXPAY_APIV3_KEY 对 resource(AEAD_AES_256_GCM) 解密得明文
//  3) 幂等处理 out_trade_no(=order_no) 与 transaction_id
//  4) 成功后：pay_order 置 paid；若是储值充值单，改调 topup_member

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json();

    // TODO(接真商户后实现):
    //  - 验 Wechatpay-Signature（用微信支付平台证书），失败返回 401
    //  - 用 APIv3 key 解密 body.resource → 明文 { out_trade_no, transaction_id, trade_state, amount, payer{openid}, attach }
    //  const paid = 明文.trade_state === 'SUCCESS'
    //
    //  普通订单(out_trade_no 还原为 orders.id uuid)：
    //    await sb.rpc('pay_order_by_id', { p_order_id, p_wx_transaction_id, p_pay_method:'wechat' })  // 幂等
    //    // 顺手沉淀会员：get_or_create_member(store_id, openid) —— openid 来自 payer
    //  储值充值单(attach 标记 topup)：
    //    await sb.rpc('topup_member', { p_member_id, p_amount, p_wx_transaction_id, p_gift })  // 幂等(按 wx_txn 去重)

    // 未接真商户前占位：直接回 200 让微信不重推（联调期用 mock 触发下游 RPC）
    void body; void sb;
    return new Response(JSON.stringify({ code: 'SUCCESS', message: 'OK (skeleton)' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    // 返回非 200，微信会按策略重推
    return new Response(JSON.stringify({ code: 'FAIL', message: String(e?.message ?? e) }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
});
