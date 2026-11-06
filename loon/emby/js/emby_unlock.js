// Emby Unlock — Loon / Egern.
//
// Emby 官方 iOS 客户端的播放权限分两档：免费版只能试看一分钟，解锁（App 内购
// 的 App Unlock，或服务器带 Premiere）后才能完整播放。客户端判断这件事时，
// 会拿自己的购买凭据去 Emby 的授权服务器 mb3admin.com 做校验；服务器带 Premiere
// 时也是它去校验。也就是说这条链路是普通 HTTPS，可以在代理层接管。
//
// 这里把那几个校验接口的响应改成「已注册」：
//
//   /admin/service/appstore/register        App 内购凭据登记
//   /admin/service/registration/validate    按 feature 校验授权（premiere / MBSupporter …）
//   /admin/service/registration/validateDevice
//   /admin/service/registration/getStatus   订阅状态
//
// 接口路径和字段名来自社区脚本（eggleader-zhang/Unlock-Emby-Surge，对应 Emby
// iOS 1.9.9）。2026-11 实测这几个接口仍然在线：validate 返回的仍是
// {"featId":"…","registered":false,"expDate":"1900-01-01","key":""} 这个结构，
// appstore/register 对无效凭据返回 402。
//
// 边界：只能解客户端这一档（Full Playback）。服务器端的 Premiere 能力
// （硬件转码、离线下载、Live TV、并发数）由服务器自己的授权决定，手机上的
// 代理碰不到。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  let opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const verbose = flag(opt.verbose_log, false);
  // Loon 的脚本 API 只保证 console.log 可用，console.warn 不一定存在，统一走 log。
  const log = (msg) => {
    if (!verbose) return;
    console.log("emby: " + msg);
  };

  if (!flag(opt.unlock_playback, true)) {
    $done({});
    return;
  }

  const host = ((url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").split(":")[0].toLowerCase();
  if (!/(^|\.)mb3admin\.com$/.test(host)) {
    $done({});
    return;
  }
  const lower = url.toLowerCase();

  // 请求里带的 feature 名要原样回给客户端，客户端会拿它做匹配。
  let feature = "";
  const query = url.indexOf("?") >= 0 ? url.slice(url.indexOf("?") + 1) : "";
  const sources = [query, typeof req.body === "string" ? req.body : ""];
  for (const src of sources) {
    const m = src.match(/(?:^|[&?])(?:feature|featId)=([^&]*)/i);
    if (m) {
      try {
        feature = decodeURIComponent(m[1]);
      } catch (e) {
        feature = m[1];
      }
      break;
    }
  }

  let body = null;
  let what = "";

  if (lower.indexOf("/admin/service/appstore/register") >= 0) {
    what = "appstore/register";
    body = JSON.stringify({ featId: feature, registered: true, expDate: "2099-01-01", key: "" });
  } else if (lower.indexOf("/admin/service/registration/validatedevice") >= 0) {
    what = "validateDevice";
    body = JSON.stringify({ cacheExpirationDays: 365, message: "Device Valid", resultCode: "GOOD" });
  } else if (lower.indexOf("/admin/service/registration/getstatus") >= 0) {
    what = "getStatus";
    body = JSON.stringify({ deviceStatus: "0", planType: "Lifetime", subscriptions: {} });
  } else if (lower.indexOf("/admin/service/registration/validate") >= 0) {
    what = "validate";
    body = JSON.stringify({ featId: feature, registered: true, expDate: "2099-01-01", key: "" });
  }

  if (!body) {
    log("no rule for " + url);
    $done({});
    return;
  }

  log(what + " -> registered" + (feature ? " (" + feature + ")" : ""));
  // 真实接口对无效凭据返回 400/402，这里统一改成 200，客户端才会当成校验通过。
  $done({ status: 200, body: body });
})();
