// Edge Function: wx-login
// 小程序登录: wx.login code 换 openid + 手机号快捷验证解密
// 资质到位前用 sandbox 模式: 返回 dev 伪 openid + 尾号占位手机号
// 资质到位后切 live: 调微信 API 换真 openid + 解密真手机号
//
// 部署: supabase functions deploy wx-login --no-verify-jwt
// (小程序 wx.login 调用,无用户 JWT)
//
// 机密(Supabase Function Secrets):
//   WX_LOGIN_MODE=sandbox|live
//   WX_APPID=<小程序AppID>
//   WX_APPSECRET=<小程序AppSecret>
//
// 入参(POST JSON): { code, phone_code? }
//   code: wx.login 返回的 code
//   phone_code: 可选,wx.getPhoneNumber 返回的 code(用户点击"手机号快捷验证"按钮)
// 出参: { openid, phone? }

// deno-lint-ignore-file no-explicit-any
const MODE = Deno.env.get('WX_LOGIN_MODE') ?? 'sandbox';
const WX_APPID = Deno.env.get('WX_APPID') ?? '';
const WX_APPSECRET = Deno.env.get('WX_APPSECRET') ?? '';

Deno.serve(async (req: Request) => {
  try {
    const { code, phone_code } = await req.json();
    if (!code) return json({ error: 'missing_code' }, 400);

    if (MODE === 'sandbox') {
      // sandbox: 返回伪 openid(设备级稳定),手机号用尾号占位
      // 注意: sandbox 模式仍用前端生成的 dev_openid 作为会员主键,保证跨会话稳定
      const mockOpenid = 'dev_' + code.slice(-12);
      const mockPhone = phone_code ? '138****' + code.slice(-4) : null;
      return json({ mode: 'sandbox', openid: mockOpenid, phone: mockPhone });
    }

    // === live: 调微信 API ===
    // 1) code 换 openid + session_key
    const loginUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_APPSECRET}&js_code=${code}&grant_type=authorization_code`;
    const loginRes = await fetch(loginUrl);
    const loginData = await loginRes.json();
    if (loginData.errcode) {
      return json({ error: 'wx_login_failed', detail: loginData }, 401);
    }
    const openid = loginData.openid;

    // 2) 手机号解密(若传了 phone_code)
    //    微信新规: 用 phone_code 调 getPhoneNumber 接口，需要 access_token
    let phone: string | null = null;
    let phone_error: unknown = null;   // 把真实失败原因透传回前端/日志，便于定位(IP白名单/能力未开通等)
    if (phone_code) {
      // 先获取 access_token(client_credential 模式)
      const tokenUrl = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${WX_APPID}&secret=${WX_APPSECRET}`;
      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        // 用 access_token + phone_code 换取真实手机号
        const phoneUrl = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${tokenData.access_token}`;
        const phoneRes = await fetch(phoneUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: phone_code }),
        });
        const phoneData = await phoneRes.json();
        if (phoneData.errcode === 0 && phoneData.phone_info) {
          phone = phoneData.phone_info.purePhoneNumber || phoneData.phone_info.phoneNumber || null;
        } else {
          // 常见: 40097 参数错误/能力未开通; 需要企业主体 + 已开通「手机号快速验证」
          console.warn('getPhoneNumber failed:', phoneData);
          phone_error = { step: 'getuserphonenumber', ...phoneData };
        }
      } else {
        // 常见: 40164 invalid ip(启用了 IP 白名单，而 Edge Function 出口 IP 不固定)
        console.warn('get access_token failed:', tokenData);
        phone_error = { step: 'access_token', ...tokenData };
      }
    }

    return json({ mode: 'live', openid, phone, phone_error });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}
