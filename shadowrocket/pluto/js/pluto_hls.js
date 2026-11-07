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
