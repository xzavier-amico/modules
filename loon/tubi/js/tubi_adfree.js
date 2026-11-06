// Tubi Ad-Free — Loon / Egern.
//
// Tubi 的广告是客户端插入（CSAI），不是把广告缝进视频流：内容清单是一份干净的
// VOD playlist（实测 833 个分片，没有任何 EXT-X-DISCONTINUITY / CUE-OUT），
// 广告位来自内容元数据里的 monetization.cue_points，播放到该秒数时播放器再单独
// 向广告服务要一批广告，拿到 { ads: [...] } 后插在中间播。
//
// 所以这里不碰视频，只让广告请求返回「没有广告」：
//
//   rainmaker*.production-public.tubi.io/api/v2/rev/vod/...   → {"ads":[],"metrics":{...}}
//   ads.adrise.tv / ads.tubi.io / ads.production-public.tubi.io → 空 VAST / 空 VMAP
//
// 为什么不直接 reject：Tubi 带反广告拦截。网页端会去拉
// https://mcdn.tubitv.com/js/ads.js 这个诱饵，播放器里还有
// MAX_AD_REQUEST_BLOCKED_CONTINUOUS_COUNT 计数，连续失败会走到
// AD_REQUEST_BLOCKED_ERROR。返回一个合法的空广告响应走的是「这次没广告」的
// 正常分支，不触发这些检测。
//
// 只改写 JSON 里确实是数组的 ads 字段和 VAST/VMAP 文档，其他响应原样放行，
// 所以就算 Tubi 换了接口形状，最差也只是这个脚本不生效。

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
    console.log("tubi: " + msg);
  };
  const finish = (body) => {
    if (body === undefined) $done({});
    else $done({ body: body });
  };

  if (!flag(opt.block_ads, true)) {
    $done({});
    return;
  }

  const status = Number(res.status || res.statusCode || 0);
  if (status >= 400) {
    log("skip status " + status);
    $done({});
    return;
  }

  let body = res.body;
  if (body === null || body === undefined) {
    $done({});
    return;
  }
  if (typeof body !== "string") {
    if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    if (!ArrayBuffer.isView(body)) {
      $done({});
      return;
    }
    try {
      body = new TextDecoder("utf-8").decode(body);
    } catch (e) {
      $done({});
      return;
    }
  }
  if (!body) {
    $done({});
    return;
  }
  if (body.length > 1024 * 1024) {
    log("body too large " + body.length);
    $done({});
    return;
  }

  const host = ((url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").split(":")[0].toLowerCase();
  const isRainmaker = /^rainmaker\d*\.production-public\.tubi\.io$/.test(host);
  const isAdHost = /^(?:ads\.adrise\.tv|ads\.tubi\.io|ads\.production-public\.tubi\.io)$/.test(host);
  if (!isRainmaker && !isAdHost) {
    $done({});
    return;
  }

  const text = body.trim();

  // 1. 广告决策接口：{"ads":[...],"metrics":{...}} —— 清空 ads 保留其余字段。
  if (text.charAt(0) === "{") {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
    if (data && typeof data === "object" && Array.isArray(data.ads)) {
      const count = data.ads.length;
      data.ads = [];
      // 播放器会无条件读 metrics.responseTime，缺了会抛错并被当成广告请求失败。
      if (!data.metrics || typeof data.metrics !== "object" || Array.isArray(data.metrics)) {
        data.metrics = { responseTime: 1 };
      } else if (typeof data.metrics.responseTime !== "number") {
        data.metrics.responseTime = 1;
      }
      log("ads " + count + " -> 0 on " + host);
      finish(JSON.stringify(data));
      return;
    }
  }

  // 2. VAST：保留原来的版本号，返回一个合法的空文档。
  if (/<VAST[\s>]/i.test(text)) {
    const version = (text.match(/<VAST[^>]*\bversion\s*=\s*"([^"]+)"/i) || [])[1] || "3.0";
    log("empty VAST " + version + " on " + host);
    finish('<?xml version="1.0" encoding="UTF-8"?><VAST version="' + version + '"></VAST>');
    return;
  }

  // 3. VMAP：广告排期表，空表就是没有广告位。
  if (/<vmap:VMAP[\s>]|<VMAP[\s>]/i.test(text)) {
    log("empty VMAP on " + host);
    finish(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"></vmap:VMAP>'
    );
    return;
  }

  log("nothing to patch on " + host);
  $done({});
})();
