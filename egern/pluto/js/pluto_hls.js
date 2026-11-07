// Pluto TV Ad-Free — HLS 清单过滤（Loon / Egern）.
//
// 实测一份带广告的清单（美国直播流，广告时段）长这样：
//
//   #EXT-X-DISCONTINUITY
//   #EXT-X-PROGRAM-DATE-TIME:2026-11-07T03:23:47.667Z
//   #EXT-X-KEY:...URI=".../494_Pluto_TV_OandO/clip/58e5..._plutotv_error_30_.../hls_300_keyfile_0.key"
//   #EXTINF:5,
//   https://siloh-ns1.plutotv.net/494_Pluto_TV_OandO/clip/58e5..._plutotv_error_30_.../hls_300-00000.ts
//
// 也就是说：广告没有 _ad/creative 这类标记，也没有 EXT-X-CUE-OUT，它只是
// **另一个 clip 的分片**，路径前缀和正片完全不同（正片是 .../c6009f_pluto/clip/604b...）。
//
// 所以按「clip 分组」判断：同一部片子所有分片都在同一个目录下，广告来自别的目录。
// 按目录累计时长，占绝对大头的就是正片，占比很小的目录整组删掉。
//
// 只处理点播清单。直播清单原样放行——直播删段会让客户端在缓冲里跳段、反复重缓冲。
//
// 删完按目录变化补 DISCONTINUITY：只有相邻两段来自不同 clip 时才需要，同一 clip
// 内部是连续的，多插一个反而会让播放器误判时间戳跳变。EXT-X-CUE-OUT / CUE-IN 一并去掉。
// 保留时长不足 60% 视为判断错了，整份清单原样放行——宁可留广告，不能把正片删了。

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

  // master 清单里没有分片，直接放行。
  if (body.indexOf("#EXT-X-STREAM-INF") >= 0) {
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

  // 点播判定：有 ENDLIST 或声明 VOD 都算；长清单 + media sequence 0 也算
  // （有的 stitcher 不给点播清单加 ENDLIST）。
  let mediaSeq = -1;
  const mseq = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/i.exec(body);
  if (mseq) mediaSeq = parseInt(mseq[1], 10);
  const isVod =
    body.indexOf("#EXT-X-ENDLIST") >= 0 ||
    /#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(body) ||
    (blocks.length >= 60 && mediaSeq === 0);
  if (!isVod) {
    $done({});
    return;
  }

  // clip 目录：同一部片子的分片都在同一个目录下，广告来自别的目录。
  const keyOf = (u) => {
    const noq = u.split("?")[0];
    const i = noq.lastIndexOf("/");
    return i > 0 ? noq.slice(0, i) : noq;
  };

  const groupDur = Object.create(null);
  let total = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b.uri) continue;
    total += b.dur;
    const k = keyOf(b.uri);
    groupDur[k] = (groupDur[k] || 0) + b.dur;
  }
  let biggest = 0;
  for (const k in groupDur) if (groupDur[k] > biggest) biggest = groupDur[k];

  const isAdUri = (u) =>
    /_ad(?:%2F|%252F|\/)(?:creative|bumper)/i.test(u) || /_ad[_-]?bumper/i.test(u);
  const isTag = (t, name) => new RegExp("^#EXT-X-" + name, "i").test(t);

  const kept = [];
  let keptDur = 0;
  let dropped = 0;
  let inCue = false;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let hasOut = false;
    let hasIn = false;
    for (let j = 0; j < b.tags.length; j++) {
      if (isTag(b.tags[j], "CUE-OUT")) hasOut = true;
      else if (isTag(b.tags[j], "CUE-IN")) hasIn = true;
    }
    if (hasIn) inCue = false;
    if (hasOut) inCue = true;

    const k = b.uri ? keyOf(b.uri) : "";
    // 广告判定：带广告标记 / 落在 CUE 区间 / 所在 clip 目录占比明显偏小。
    const smallGroup = k && biggest > 0 && groupDur[k] < biggest * 0.5;
    if (b.uri && (isAdUri(b.uri) || inCue || smallGroup)) {
      dropped++;
      continue;
    }
    kept.push(b);
    keptDur += b.dur;
  }

  if (dropped === 0) {
    $done({});
    return;
  }
  if (total > 0 && keptDur < total * 0.6) {
    $done({});
    return;
  }

  const out = head.slice();
  let prevKey = null;
  for (let i = 0; i < kept.length; i++) {
    const b = kept[i];
    const k = keyOf(b.uri);
    const tags = [];
    let hasDisc = false;
    for (let j = 0; j < b.tags.length; j++) {
      const t = b.tags[j];
      if (isTag(t, "CUE-OUT") || isTag(t, "CUE-IN")) continue;
      if (isTag(t, "DISCONTINUITY")) hasDisc = true;
      tags.push(t);
    }
    // 相邻两段来自不同 clip 才需要 discontinuity，同一 clip 内部是连续的。
    if (prevKey !== null && k !== prevKey && !hasDisc) tags.unshift("#EXT-X-DISCONTINUITY");
    for (let j = 0; j < tags.length; j++) out.push(tags[j]);
    out.push(b.uri);
    prevKey = k;
  }
  for (let i = 0; i < tail.length; i++) {
    if (isTag(tail[i], "CUE-OUT") || isTag(tail[i], "CUE-IN")) continue;
    out.push(tail[i]);
  }

  $done({ body: out.join("\n") + "\n" });
})();
