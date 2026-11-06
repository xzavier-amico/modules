// Pluto TV Ad-Free — Loon / Egern.
//
// Pluto 的广告是服务端拼接（SSAI），不是客户端单独请求广告素材：
// 直播和点播都走自家 stitcher（cfd-v4-service-channel-stitcher-*.prd.pluto.tv），
// 广告片被直接缝进 HLS，用 EXT-X-DISCONTINUITY / EXT-X-CUE-OUT 和 ID3 标出。
// 所以去拦广告素材域名是没用的，拦了只会让正片跟着断。
//
// 但 stitcher 的会话 JWT 里有一个 serverSideAds 标志，它来自 boot 接口的查询参数：
//
//   GET https://boot.pluto.tv/v4/start?...&serverSideAds=true
//   → 返回的 JWT payload: {"serverSideAds": true, ...}
//
// 网页端传的是 false（网页自己用 IMA 做客户端广告），App 传 true 走服务端拼接。
// 把 App 的这个参数改成 false，stitcher 返回的就是纯内容清单，没有广告段。
//
// 所以这里只改 boot 请求，不碰视频流、不碰 stitcher。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
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
  const log = (msg) => {
    if (verbose) console.log("pluto: " + msg);
  };

  if (!flag(opt.block_ads, true)) {
    $done({});
    return;
  }
  if (url.indexOf("boot.pluto.tv") < 0) {
    $done({});
    return;
  }

  let out = url.replace(/([?&])serverSideAds=[^&]*/i, "$1serverSideAds=false");
  if (!/[?&]serverSideAds=/i.test(out)) {
    out += (out.indexOf("?") < 0 ? "?" : "&") + "serverSideAds=false";
  }

  const body = req.body;
  if (typeof body === "string" && /"serverSideAds"\s*:\s*true/i.test(body)) {
    log("boot body -> serverSideAds=false");
    $done({
      url: out,
      body: body.replace(/("serverSideAds"\s*:\s*)true/i, "$1false"),
    });
    return;
  }

  if (out === url) {
    log("boot already serverSideAds=false");
    $done({});
    return;
  }

  log("boot -> serverSideAds=false");
  $done({ url: out });
})();
