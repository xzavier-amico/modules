// Pluto TV Ad-Free — HLS 清单过滤（Loon / Egern）.
//
// boot 那边把 serverSideAds 改成 false 之后，stitcher 不再往清单里缝第三方广告，
// 但转场 bumper 还在（分片名带 _ad_bumper），部分片源也会残留 _ad/creative 的广告段。
// 这里在清单层面把带广告标记的分片整段删掉：
//
//   _ad/creative、_ad%2Fcreative、_ad_bumper
//
// 另外按 HLS 标准的广告区间标记兜底：落在 #EXT-X-CUE-OUT 与 #EXT-X-CUE-IN 之间的
// 分片一并删掉，这样不依赖分片命名也能命中。
//
// 只处理点播清单（有 #EXT-X-ENDLIST、且不是 master）。直播清单原样放行——直播的
// 广告就是当时的播出内容，删段会让时间轴错位、反复重缓冲。
//
// 删段时保留 #EXT-X-DISCONTINUITY：广告前后的正片来自不同编码，时间戳本来就有跳变，
// 去掉会让播放器接不上。EXT-X-CUE-OUT / CUE-IN 则去掉，广告没了就不该再有倒计时。
// 裁掉超过 40% 时长视为异常，整份清单原样放行——宁可留广告，不能把正片删了。

(() => {
  "use strict";

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

  const host = ((url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").split(":")[0].toLowerCase();
  if (!/(^|\.)pluto\.tv$/.test(host) && !/(^|\.)plutotv\.net$/.test(host)) {
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
  if (!body || body.indexOf("#EXTM3U") < 0) {
    $done({});
    return;
  }
  if (body.length > 4 * 1024 * 1024) {
    $done({});
    return;
  }

  // master 清单里没有分片；没有 ENDLIST 的是直播清单。都不动。
  if (body.indexOf("#EXT-X-STREAM-INF") >= 0) {
    $done({});
    return;
  }
  if (body.indexOf("#EXT-X-ENDLIST") < 0) {
    $done({});
    return;
  }

  const lines = body.split(/\r?\n/);

  // 第一段 #EXTINF 之前都是全局头（EXTM3U / VERSION / TARGETDURATION / KEY…）。
  let first = 0;
  while (first < lines.length && !/^#EXTINF:/i.test(lines[first].trim())) first++;
  if (first >= lines.length) {
    $done({});
    return;
  }
  const head = [];
  for (let i = 0; i < first; i++) {
    const t = lines[i].trim();
    if (t) head.push(t);
  }

  // 切块：每块 = 若干标签 + 一行分片地址。
  const blocks = [];
  let cur = null;
  let next = [];
  for (let i = first; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.charAt(0) === "#") {
      if (/^#EXTINF:/i.test(t)) {
        const m = /^#EXTINF:\s*([0-9.]+)/i.exec(t);
        cur = { tags: next.concat([t]), uri: "", dur: m ? parseFloat(m[1]) : 0 };
        next = [];
        blocks.push(cur);
      } else if (cur && !cur.uri) {
        cur.tags.push(t);
      } else {
        next.push(t);
      }
      continue;
    }
    if (cur && !cur.uri) {
      cur.uri = t;
      cur = null;
    }
  }
  const tail = next;

  const isAdUri = (u) =>
    /_ad(?:%2F|%252F|\/)(?:creative|bumper)/i.test(u) || /_ad[_-]?bumper/i.test(u);
  const isTag = (t, name) => new RegExp("^#EXT-X-" + name, "i").test(t);

  const kept = [];
  let total = 0;
  let keptDur = 0;
  let dropped = 0;
  let inCue = false;
  let carryDisc = false;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    total += b.dur;

    let hasOut = false;
    let hasIn = false;
    let hasDisc = false;
    for (let j = 0; j < b.tags.length; j++) {
      if (isTag(b.tags[j], "CUE-OUT")) hasOut = true;
      else if (isTag(b.tags[j], "CUE-IN")) hasIn = true;
      else if (isTag(b.tags[j], "DISCONTINUITY")) hasDisc = true;
    }
    if (hasIn) inCue = false;
    if (hasOut) inCue = true;

    if (b.uri && (isAdUri(b.uri) || inCue)) {
      dropped++;
      if (hasDisc) carryDisc = true;
      continue;
    }

    if (carryDisc && !hasDisc) b.tags.unshift("#EXT-X-DISCONTINUITY");
    carryDisc = false;
    kept.push(b);
    keptDur += b.dur;
  }

  if (dropped === 0) {
    $done({});
    return;
  }
  // 过度裁剪保护：正片本来就占大头，裁掉一半以上说明标记判断错了。
  if (total > 0 && keptDur < total * 0.4) {
    $done({});
    return;
  }

  const out = head.slice();
  for (let i = 0; i < kept.length; i++) {
    const tags = kept[i].tags;
    for (let j = 0; j < tags.length; j++) {
      if (isTag(tags[j], "CUE-OUT") || isTag(tags[j], "CUE-IN")) continue;
      out.push(tags[j]);
    }
    out.push(kept[i].uri);
  }
  for (let i = 0; i < tail.length; i++) {
    if (isTag(tail[i], "CUE-OUT") || isTag(tail[i], "CUE-IN")) continue;
    out.push(tail[i]);
  }

  $done({ body: out.join("\n") + "\n" });
})();
