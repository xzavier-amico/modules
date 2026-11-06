// BiliBili Clean — gRPC 部分（详情页 / 评论区 / 播放器）。
//
// B 站 App 的视频详情、评论、播放器状态走的是 gRPC（protobuf over HTTP/2），
// 不是 REST，所以 bilibili_clean.js 碰不到这些接口。这里按字段号就地删，
// 只做「删整字段」和「按条件删重复项」两种操作，其余字节原样保留，
// 未知字段、字段顺序、编码方式都不动，最差是不生效，不会把消息改坏。
//
// 用到的字段号（来自 B 站 App 的 proto）：
//
//   bilibili.app.view.v1.ViewReply            旧版详情页
//     10 relates              相关推荐（里面混广告）
//     30 cms                  广告卡片
//     31 cm_config            广告配置
//     34 tf_panel_customized  办卡免流推广
//     41 cm_ipad              iPad 广告
//     48 cm_under_player      播放器下方广告
//   bilibili.app.view.v1.Relate               相关推荐条目
//     7 goto / 28 cm / 32 unique_id
//     广告判定：goto 是 cm 或 game，或者带 cm / unique_id
//
//   bilibili.app.viewunite.v1.ViewReply       新版详情页
//     7 cm                    视频下方广告
//   bilibili.app.viewunite.common.RelateCard  新版推荐卡
//     1 relate_card_type / 6 cm / 11 cm_stock
//     广告判定：类型是 B 站标记的广告类型（4/5/11），或带 cm / cm_stock
//
//   bilibili.main.community.reply.v1.MainListReply   评论列表
//     11 cm                   评论列表广告
//     28 subject_top_cards    评论区顶部卡片（type=3 是带货卡）
//     4 up_top / 5 admin_top / 6 vote_top / 14 top_replies
//     置顶评论里带 b23.tv/cm、b23.tv/mall、cm.bilibili.com 带货链接的删掉
//
//   bilibili.app.viewunite.v1.View/PlayPause    暂停广告，整条返回空消息
//   bilibili.app.viewunite.v1.View/ViewEndPage  播放结束页广告，同上
//
// gRPC 的响应是「1 字节 flag + 4 字节大端长度 + 消息体」的帧。B 站会用
// flag=1 表示消息体是 gzip 的（帧级压缩，不是 Content-Encoding），这里解压
// 后按未压缩回写。解压不了就整条放行，不做半截修改。

(() => {
  "use strict";

  const EMPTY = new Uint8Array(0);

  const res = (typeof $response !== "undefined" && $response) || {};
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = res.url || req.url || "";

  // ---- 参数 -------------------------------------------------------------

  let opt = {};
  const arg = typeof $argument !== "undefined" ? $argument : undefined;
  if (typeof arg === "string") {
    try {
      opt = JSON.parse(arg) || {};
    } catch (e) {
      opt = {};
    }
  } else if (Array.isArray(arg)) {
    opt = { block_ads: arg[0], verbose_log: arg[1] };
  } else if (arg && typeof arg === "object") {
    opt = arg;
  }

  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  const blockAds = flag(opt.block_ads, true);
  const verbose = flag(opt.verbose_log, false);
  // Loon 的脚本 API 只保证 console.log 可用，console.warn 不一定存在，统一走 log。
  const log = (msg) => {
    if (!verbose) return;
    console.log("bilibili-grpc: " + msg);
  };

  if (!blockAds) {
    $done({});
    return;
  }

  // ---- 字节工具 ---------------------------------------------------------

  function toBytes(b) {
    if (!b) return null;
    if (b instanceof Uint8Array) return b;
    if (typeof ArrayBuffer !== "undefined" && b instanceof ArrayBuffer) return new Uint8Array(b);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(b)) {
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }
    if (typeof b === "string") {
      // 二进制串：每个字符就是一个字节。含非 Latin-1 字符说明是被当文本解码过
      // 的二进制，直接放弃，避免改出乱码。
      const out = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) {
        const c = b.charCodeAt(i);
        if (c > 0xff) return null;
        out[i] = c;
      }
      return out;
    }
    return null;
  }

  function concat(parts) {
    let n = 0;
    for (let i = 0; i < parts.length; i++) n += parts[i].length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }

  function asciiBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function containsAscii(b, s, e, needle) {
    const first = needle[0];
    const last = e - needle.length;
    for (let i = s; i <= last; i++) {
      if (b[i] !== first) continue;
      let hit = true;
      for (let j = 1; j < needle.length; j++) {
        if (b[i + j] !== needle[j]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
    return false;
  }

  function ascii(b, s, e) {
    let out = "";
    for (let i = s; i < e; i++) {
      const c = b[i];
      if (c === 0) break;
      if (c > 0x7f) return null;
      out += String.fromCharCode(c);
    }
    return out;
  }

  // ---- protobuf ---------------------------------------------------------

  // 读 varint，返回 [值, 新位置]；越界或过长返回 null。
  function readVarint(b, p, end) {
    let v = 0;
    let mul = 1;
    while (p < end) {
      const c = b[p++];
      v += (c & 0x7f) * mul;
      if (!(c & 0x80)) return [v, p];
      mul *= 128;
      if (mul > 0x10000000000000) return null;
    }
    return null;
  }

  // 把一段消息拆成字段列表：{ no, wt, s, e, ds, de }
  // s..e 是整个字段（含 tag），ds..de 是字段值。
  function parseFields(b, start, end) {
    const out = [];
    let p = start;
    while (p < end) {
      const s = p;
      const t = readVarint(b, p, end);
      if (!t) return null;
      const key = t[0];
      p = t[1];
      const no = Math.floor(key / 8);
      const wt = key & 7;
      if (no <= 0) return null;

      let ds = p;
      let de;
      if (wt === 0) {
        const r = readVarint(b, p, end);
        if (!r) return null;
        p = r[1];
        de = p;
      } else if (wt === 1) {
        if (p + 8 > end) return null;
        p += 8;
        de = p;
      } else if (wt === 2) {
        const r = readVarint(b, p, end);
        if (!r) return null;
        const len = r[0];
        const d0 = r[1];
        if (d0 + len > end) return null;
        ds = d0;
        p = d0 + len;
        de = p;
      } else if (wt === 5) {
        if (p + 4 > end) return null;
        p += 4;
        de = p;
      } else {
        // 3/4 是已废弃的 group，不碰。
        return null;
      }
      out.push({ no: no, wt: wt, s: s, e: p, ds: ds, de: de });
    }
    return out;
  }

  // drop 里的字段号整条删；filters 里的字段号按条件删（只处理 length-delimited）。
  // 没有改动返回 null，调用方据此原样放行。
  function rewrite(msg, drop, filters) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;

    const parts = [];
    let changed = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (drop && drop.indexOf(f.no) >= 0) {
        changed = true;
        continue;
      }
      if (filters && f.wt === 2 && filters[f.no] && filters[f.no](msg, f.ds, f.de)) {
        changed = true;
        continue;
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    if (!changed) return null;
    return concat(parts);
  }

  // ---- 广告判定 ---------------------------------------------------------

  // 旧版相关推荐：goto 是 cm/game，或带 cm / unique_id。
  function legacyRelateAd(b, s, e) {
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 7 && f.wt === 2) {
        const goto = ascii(b, f.ds, f.de);
        if (goto === "cm" || goto === "game") return true;
      } else if (f.no === 28) {
        return true;
      } else if (f.no === 32 && f.de > f.ds) {
        return true;
      }
    }
    return false;
  }

  // 新版推荐卡：B 站标成广告的类型（4/5/11），或带 cm / cm_stock。
  function unifiedRelateAd(b, s, e) {
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 1 && f.wt === 0) {
        const v = readVarint(b, f.ds, f.de);
        if (v && (v[0] === 4 || v[0] === 5 || v[0] === 11)) return true;
      } else if (f.no === 6 || f.no === 11) {
        return true;
      }
    }
    return false;
  }

  // 评论区顶部卡片：type=3 是带货卡。
  function commercialTopCard(b, s, e) {
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 1 && f.wt === 0) {
        const v = readVarint(b, f.ds, f.de);
        return !!v && v[0] === 3;
      }
    }
    return false;
  }

  // 带货评论：正文或跳转链接里出现 b23.tv/cm、b23.tv/mall、商品页。
  // 直接扫字节，不用解出字符串字段，省事也不会漏。
  const REPLY_AD_NEEDLES = [
    asciiBytes("b23.tv/cm"),
    asciiBytes("b23.tv/mall"),
    asciiBytes("cm.bilibili.com/ad-showcase-h5"),
  ];

  function commercialReply(b, s, e) {
    for (let i = 0; i < REPLY_AD_NEEDLES.length; i++) {
      if (containsAscii(b, s, e, REPLY_AD_NEEDLES[i])) return true;
    }
    return false;
  }

  // ---- 接口表 -----------------------------------------------------------

  const VIEW = "/bilibili.app.view.v1.View/";
  const UNITE = "/bilibili.app.viewunite.v1.View/";
  const REPLY = "/bilibili.main.community.reply.v1.Reply/";

  const RULES = {};

  // 旧版详情页
  RULES[VIEW + "View"] = (m) => rewrite(m, [30, 31, 34, 41, 48], { 10: legacyRelateAd });
  RULES[VIEW + "RelatesFeed"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "PlayerRelates"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "ViewProgress"] = (m) => rewrite(m, [1]);
  RULES[VIEW + "TFInfo"] = (m) => rewrite(m, [2, 3]);

  // 新版详情页
  RULES[UNITE + "View"] = (m) => rewrite(m, [7]);
  RULES[UNITE + "AIRelateAsync"] = (m) => rewrite(m, [1]);
  RULES[UNITE + "RelatesFeed"] = (m) => rewrite(m, null, { 1: unifiedRelateAd });
  RULES[UNITE + "ViewProgress"] = (m) => rewrite(m, [1]);
  RULES[UNITE + "PlayPause"] = () => EMPTY;
  RULES[UNITE + "ViewEndPage"] = () => EMPTY;

  // 评论区
  RULES[REPLY + "MainList"] = (m) =>
    rewrite(m, [11], {
      4: commercialReply,
      5: commercialReply,
      6: commercialReply,
      14: commercialReply,
      28: commercialTopCard,
    });

  // ---- 解压 -------------------------------------------------------------

  async function gunzip(b) {
    try {
      if (typeof $utils !== "undefined" && $utils && typeof $utils.ungzip === "function") {
        const r = $utils.ungzip(b);
        return r && typeof r.then === "function" ? await r : r;
      }
      if (typeof ctx !== "undefined" && ctx && ctx.compress && typeof ctx.compress.gunzip === "function") {
        return await ctx.compress.gunzip(b);
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // ---- 主流程 -----------------------------------------------------------

  function parseFrames(b) {
    const out = [];
    let p = 0;
    while (p + 5 <= b.length) {
      const flagByte = b[p];
      const len = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0;
      const start = p + 5;
      const end = start + len;
      if (end > b.length) return null;
      out.push({ flag: flagByte, hdr: p, start: start, end: end });
      p = end;
    }
    if (p !== b.length) return null;
    return out.length ? out : null;
  }

  function frame(flagByte, msg) {
    const out = new Uint8Array(5 + msg.length);
    out[0] = flagByte;
    out[1] = (msg.length >>> 24) & 0xff;
    out[2] = (msg.length >>> 16) & 0xff;
    out[3] = (msg.length >>> 8) & 0xff;
    out[4] = msg.length & 0xff;
    out.set(msg, 5);
    return out;
  }

  async function run() {
    // gRPC 的方法名就在 URL 的 path 上，去掉 scheme / host / query。
    const m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)/i.exec(url);
    const path = m ? m[1] : url.split("?")[0];
    const rule = RULES[path];
    if (!rule) {
      $done({});
      return;
    }

    const headers = res.headers || {};
    const ct = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
    if (ct && ct.indexOf("grpc") < 0) {
      $done({});
      return;
    }
    const ce = String(headers["content-encoding"] || headers["Content-Encoding"] || "").toLowerCase();
    if (ce && ce !== "identity") {
      log("skip content-encoding " + ce);
      $done({});
      return;
    }

    const bytes = toBytes(res.body);
    if (!bytes || !bytes.length) {
      $done({});
      return;
    }

    const frames = parseFrames(bytes);
    if (!frames) {
      log("bad grpc framing");
      $done({});
      return;
    }

    const out = [];
    let changed = false;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];

      // 0x80 是 gRPC-Web 的 trailer 帧，原样保留。
      if (f.flag & 0x80) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      // 只认识 0x00 和 0x01（gzip），别的 flag 一律放行。
      if (f.flag & 0x7e) {
        log("unknown frame flag " + f.flag);
        $done({});
        return;
      }

      let msg = bytes.subarray(f.start, f.end);
      if (f.flag & 0x01) {
        msg = toBytes(await gunzip(msg));
        if (!msg) {
          log("gunzip unavailable");
          $done({});
          return;
        }
      }

      const next = rule(msg);
      if (next === null) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      changed = true;
      out.push(frame(0, next));
    }

    if (!changed) {
      $done({});
      return;
    }
    const body = concat(out);
    log(path + " " + bytes.length + " -> " + body.length);
    $done({ body: body });
  }

  run().catch((e) => {
    log("error " + (e && e.message ? e.message : e));
    $done({});
  });
})();
