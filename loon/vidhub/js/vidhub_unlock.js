//=======================================================================================
// VidHub Unlock — /api/v1/licenses 响应伪造（测试）
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// VidHub 授权测试脚本
//
// 只改写 /api/v1/licenses 与 /api/v1/licenses/apple 的响应，不动请求签名。
// 参数（Loon 按位置传入）：mode, vip, expire, raw
//   mode: array  -> data = [{vip, expire}]
//         object -> data = {vip, expire}
//         string -> data = JSON.stringify([{vip, expire}])
//         raw    -> data = raw（用于手动传入 AES base64）
(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const url = req.url || "";
  const isApple = /\/api\/v1\/licenses\/apple(?:\?|$)/.test(url);

  let opt = {};
  const rawArg = typeof $argument !== "undefined" ? $argument : undefined;
  if (Array.isArray(rawArg)) {
    opt = { mode: rawArg[0], vip: rawArg[1], expire: rawArg[2], raw: rawArg[3] };
  } else if (typeof rawArg === "string") {
    try {
      opt = JSON.parse(rawArg || "{}") || {};
    } catch (e) {
      opt = {};
    }
  } else if (rawArg && typeof rawArg === "object") {
    opt = rawArg;
  }

  const mode = String(opt.mode || "array").toLowerCase();
  const vip = Number(opt.vip || 1);
  const expire = String(opt.expire || "2099-12-31 23:59:59");

  const lic = { vip, expire };
  let data;
  if (mode === "object") {
    data = lic;
  } else if (mode === "string") {
    data = JSON.stringify([lic]);
  } else if (mode === "raw") {
    data = String(opt.raw || "");
  } else {
    data = [lic];
  }

  // /licenses/apple 先只回成功，让客户端继续走 GET /licenses。
  // 如果确认它必须在这里就拿到 license，把 data 改成和下面一样的伪造对象。
  const payload = isApple
    ? { code: 200, msg: "ok", data: null }
    : { code: 200, msg: "ok", data: data };

  try {
    console.log(
      "[VidHub Unlock] " +
        (isApple ? "apple" : "licenses") +
        " -> " +
        JSON.stringify(payload).slice(0, 400)
    );
  } catch (e) {}

  $done({ body: JSON.stringify(payload) });
})();
