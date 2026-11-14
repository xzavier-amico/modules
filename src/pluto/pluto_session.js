// Pluto TV Ad-Free — 清空会话里的 adBreaks（Loon / Egern）.
//
// 播放器的广告块标记、左上角 Ad 角标、广告期间禁止拖动，都来自 stitcher 会话里的
// adBreaks 数组。清单里的广告分片由 pluto_hls.js 删掉，这里把对应元数据一起清空，
// 否则会出现「画面已经是正片，进度条还在报广告」的错位。
//
// 直播不动：直播的广告没法删，留着角标至少能让人知道现在在广告里。
// 只做字符串级替换（session.json 有 1.7MB），不解析整份 JSON，避免序列化把
// 其他字段改坏。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { block_ads: raw[0], web: raw[1] };
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
  // 网页版 stitcher 请求带 appName=web / deviceType=web；关闭网页版后只处理 App。
  if (!flag(opt.web, true) && /[?&](?:appName|deviceType)=web(?:[&#]|$)/i.test(url)) {
    $done({});
    return;
  }

  const host = ((url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").split(":")[0].toLowerCase();
  if (!/(^|\.)pluto\.tv$/.test(host)) {
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
  if (!body || body.indexOf('"adBreaks"') < 0) {
    $done({});
    return;
  }
  if (body.length > 16 * 1024 * 1024) {
    $done({});
    return;
  }
  // 直播的广告删不掉，角标留着。
  if (/"streamType"\s*:\s*"channel"/i.test(body)) {
    $done({});
    return;
  }

  // 找到 "adBreaks": [ ... ] 的数组区间，按字符串状态和括号层级扫。
  const key = /"adBreaks"\s*:\s*\[/i.exec(body);
  if (!key) {
    $done({});
    return;
  }
  const start = key.index + key[0].length - 1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < body.length; i++) {
    const c = body.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    $done({});
    return;
  }
  if (body.slice(start, end) === "[]") {
    $done({});
    return;
  }

  $done({ body: body.slice(0, start) + "[]" + body.slice(end) });
})();
