// Tubi Ad-Free — Loon / Egern.
//
// Tubi 的广告是客户端插入（CSAI），不是把广告缝进视频流：内容清单是一份干净的
// VOD playlist，广告位来自内容元数据里的 monetization.cue_points，播放到该秒数时
// 播放器再单独向广告服务要一批广告，拿到 { ads: [...] } 后插在中间播。
//
// 所以这里分两道防线，第一道才是主路径：
//
//   1. 内容元数据 /oz/videos/<id>/content 里的 cue_points 直接清空。
//      播放器没有广告位，就不会在 50 分钟那种中途位置发广告请求，也不会走到
//      「广告服务没返回 → 播备用推广片」的兜底分支。
//
//   2. 广告接口一律回答「没有广告」：
//      rainmaker*.production-public.tubi.io/api/v2/rev/vod/... → {"ads":[],"metrics":{...}}
//      ads.adrise.tv / ads.tubi.io / ads.production-public.tubi.io → 空 VAST / 空 VMAP
//
// 为什么不直接 reject：Tubi 带反广告拦截。网页端会去拉
// https://mcdn.tubitv.com/js/ads.js 这个诱饵，播放器里还有
// MAX_AD_REQUEST_BLOCKED_CONTINUOUS_COUNT 计数，连续失败会走到
// AD_REQUEST_BLOCKED_ERROR。返回一个合法的空广告响应走的是「这次没广告」的
// 正常分支，不触发这些检测。
//
// 只清空确实是数组的字段、确实是 VAST/VMAP 的文档，其他响应原样放行。

(() => {
  "use strict";

  // Shadowrocket 的 JS 运行时不一定提供 TextEncoder / TextDecoder（Loon、Egern 自带）。
  // 这里补一份严格实现；已有原生对象时整段跳过，三端共用同一份脚本。
  if ("undefined" == typeof TextEncoder) {
    globalThis.TextEncoder = function () {};
    TextEncoder.prototype.encode = function (s) {
      s = String(s);
      const out = [];
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
          const d = s.charCodeAt(i + 1);
          if (d >= 0xdc00 && d <= 0xdfff) {
            c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
            i++;
          }
        }
        if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return new Uint8Array(out);
    };
  }
  if ("undefined" == typeof TextDecoder) {
    globalThis.TextDecoder = function (label, options) {
      this.fatal = !!(options && options.fatal);
    };
    TextDecoder.prototype.decode = function (input) {
      const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
      let out = "";
      for (let i = 0; i < b.length; ) {
        const start = i;
        const first = b[i++];
        let cp = 0;
        let need = 0;
        if (first < 0x80) cp = first;
        else if (first >= 0xc2 && first <= 0xdf) { cp = first & 0x1f; need = 1; }
        else if (first >= 0xe0 && first <= 0xef) { cp = first & 0x0f; need = 2; }
        else if (first >= 0xf0 && first <= 0xf4) { cp = first & 7; need = 3; }
        else need = -1;
        let ok = need >= 0 && i + need <= b.length;
        for (let k = 0; ok && k < need; k++) {
          if ((b[i + k] & 0xc0) !== 0x80) ok = false;
          else cp = (cp << 6) | (b[i + k] & 63);
        }
        if (ok && need === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) ok = false;
        if (ok && need === 3 && (cp < 0x10000 || cp > 0x10ffff)) ok = false;
        if (!ok) {
          if (this.fatal) throw new TypeError("invalid utf-8");
          out += "\ufffd";
          i = start + 1;
          continue;
        }
        i += need;
        if (cp > 0xffff) {
          cp -= 0x10000;
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
        } else {
          out += String.fromCharCode(cp);
        }
      }
      return out;
    };
  }

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  // Loon 传位置数组，Egern 传 JSON 字符串，两种都兼容。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { block_ads: raw[0] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  if (!flag(opt.block_ads, true)) {
    $done({});
    return;
  }

  const status = Number(res.status || res.statusCode || 0);
  if (status >= 400) {
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
  // 内容元数据带 video_resources，偶尔会超过 1MB，放宽到 8MB。
  if (body.length > 8 * 1024 * 1024) {
    $done({});
    return;
  }

  const parts = url.match(/^https?:\/\/([^/?#]+)/i) || [];
  const host = (parts[1] || "").split(":")[0].toLowerCase();

  // 广告侧主机：ads.* / rainmaker* 以及 adrise.tv 自家域。
  const isAdHost =
    /(^|\.)(tubi\.io|tubitv\.com|tubi\.video|adrise\.tv)$/.test(host) &&
    (/^ads[.\-]/.test(host) || /^rainmaker/.test(host) || /(^|\.)adrise\.tv$/.test(host));

  // 这些字段是数组时，数组内容就是广告；清空即「这次没有广告」。
  const AD_KEYS = [
    "ads",
    "cue_points",
    "cuePoints",
    "ad_breaks",
    "adBreaks",
    "ad_pods",
    "adPods",
    "ad_list",
    "adList",
  ];

  const emptyAdArrays = (node, depth) => {
    let hits = 0;
    if (!node || typeof node !== "object" || depth > 16) return 0;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) hits += emptyAdArrays(node[i], depth + 1);
      return hits;
    }
    for (let i = 0; i < AD_KEYS.length; i++) {
      const k = AD_KEYS[i];
      if (Array.isArray(node[k]) && node[k].length > 0) {
        hits += node[k].length;
        node[k] = [];
      }
    }
    for (const k in node) {
      if (node[k] && typeof node[k] === "object") hits += emptyAdArrays(node[k], depth + 1);
    }
    return hits;
  };

  const emptyVast = (s) => {
    if (/<vmap:VMAP[\s>]|<VMAP[\s>]/i.test(s)) {
      return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"></vmap:VMAP>'
      );
    }
    const version = (s.match(/<VAST[^>]*\bversion\s*=\s*"([^"]+)"/i) || [])[1] || "3.0";
    return '<?xml version="1.0" encoding="UTF-8"?><VAST version="' + version + '"></VAST>';
  };

  const text = body.trim();

  if (text.charAt(0) === "{") {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
    if (data && typeof data === "object") {
      const hadAds = Array.isArray(data.ads) && data.ads.length > 0;
      const hits = emptyAdArrays(data, 0);
      if (hits > 0) {
        // 播放器会无条件读 metrics.responseTime，缺了会抛错并被当成广告请求失败。
        if (hadAds) {
          if (!data.metrics || typeof data.metrics !== "object" || Array.isArray(data.metrics)) {
            data.metrics = { responseTime: 1 };
          } else if (typeof data.metrics.responseTime !== "number") {
            data.metrics.responseTime = 1;
          }
        }
        $done({ body: JSON.stringify(data) });
        return;
      }
      // JSON 里内嵌 VAST/VMAP 的情况：只替换那个字符串字段，别把 JSON 换成 XML。
      let embedded = 0;
      for (const k in data) {
        if (typeof data[k] === "string" && /<(VAST|VMAP|vmap:VMAP)[\s>]/i.test(data[k])) {
          data[k] = emptyVast(data[k]);
          embedded++;
        }
      }
      if (embedded > 0) {
        $done({ body: JSON.stringify(data) });
        return;
      }
      $done({});
      return;
    }
  }

  if (/<VAST[\s>]|<vmap:VMAP[\s>]|<VMAP[\s>]/i.test(text)) {
    if (!isAdHost) {
      $done({});
      return;
    }
    $done({ body: emptyVast(text) });
    return;
  }

  $done({});
})();
