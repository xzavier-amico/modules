//=======================================================================================
// BiliBili Enhance — gRPC 响应（详情 / 评论 / 动态）
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


const ENV_BODY_BINARY = true;

//=====================================================================================
// Egern 原生模式适配层
//
// Egern 的脚本入口是 export default async function (ctx)，参数从 ctx.env 读；
// 而 Loon / Shadowrocket 用的仍是 Surge 兼容全局（$request / $response / $done /
// $persistentStore / $argument）。为了三端共用同一份脚本主体，这里把 ctx 适配成
// 那几个全局变量，脚本主体一行都不用改。
//
// 参数：env_schema 生成的设置项会以字符串写进 ctx.env，直接作为 $argument 交给脚本；
// 各脚本的 flag() / asBool() 已经能处理 "true" / "false" 字符串。
//=====================================================================================

export default async function (ctx) {
  const plainHeaders = (headers) => {
    const out = {};
    if (!headers) return out;
    if ("function" == typeof headers.forEach) {
      headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    for (const key of Object.keys(headers)) out[key] = headers[key];
    return out;
  };

  // ctx 的 body 是只能读一次的流，先整体读出来交给兼容代码按字符串 / 字节处理。
  // 文本脚本按字符串给 body，protobuf / 二进制脚本给字节。
  // 构建时按目标注入 ENV_BODY_BINARY。
  const binaryBody = "undefined" != typeof ENV_BODY_BINARY && ENV_BODY_BINARY;
  const readBody = async (message) => {
    if (!message || !message.body) return undefined;
    try {
      const bytes = new Uint8Array(await message.arrayBuffer());
      return binaryBody ? bytes : new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      return undefined;
    }
  };

  const requestBody = await readBody(ctx.request);
  const responseBody = await readBody(ctx.response);

  const request = ctx.request
    ? { url: ctx.request.url, method: ctx.request.method, headers: plainHeaders(ctx.request.headers), body: requestBody }
    : undefined;
  const response = ctx.response
    ? {
        url: ctx.request && ctx.request.url,
        status: ctx.response.status,
        statusCode: ctx.response.status,
        headers: plainHeaders(ctx.response.headers),
        body: responseBody,
      }
    : undefined;

  // $httpClient 的 callback 形式（error, response, data）。
  const httpOptions = (options) => ("string" == typeof options ? { url: options } : options || {});
  const httpCall = (method, options, callback) => {
    const opt = httpOptions(options);
    Promise.resolve()
      .then(() =>
        ctx.http[method](opt.url, {
          headers: opt.headers,
          body: opt.body,
          timeout: opt.timeout,
        }),
      )
      .then(async (res) => {
        const headers = plainHeaders(res.headers);
        callback(null, { status: res.status, statusCode: res.status, headers }, await res.text());
      })
      .catch((error) => callback(error || new Error("request failed"), null, null));
  };

  // 数组是 Loon 旧版的位置参数，原样透传，脚本自己按位置还原。
  const $argument = Array.isArray(ctx.env) ? ctx.env : Object.assign({}, ctx.env || {});
  const $request = request;
  const $response = response;
  const $persistentStore = {
    read: (key) => (ctx.storage ? ctx.storage.get(key) : null),
    write: (value, key) => {
      if (ctx.storage) ctx.storage.set(key, value);
      return true;
    },
  };
  const $httpClient = {
    get: (options, callback) => httpCall("get", options, callback),
    post: (options, callback) => httpCall("post", options, callback),
  };

  return await new Promise((resolve) => {
    let settled = false;

    // 把 $done 的返回值翻译成 ctx 的返回值。
    const finish = (value) => {
      if (settled) return;
      settled = true;

      // 请求阶段直接返回本地响应。
      if (value && value.response) {
        resolve(ctx.respond ? ctx.respond(value.response) : value.response);
        return;
      }

      const body = ctx.response ? responseBody : requestBody;

      // 原样放行：body 已经被读走，必须显式还回去，否则请求 / 响应体会变成空。
      if (!value || !Object.keys(value).length) {
        resolve(body === undefined ? undefined : { body });
        return;
      }

      const next = Object.assign({}, value);
      if (next.body === undefined && body !== undefined) next.body = body;
      resolve(next);
    };

    function $done(value) {
      finish(value);
    }

    try {

// BiliBili Enhance — gRPC 部分（详情页 / 评论区 / 播放器）。
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
//     32 tab                  播放页定制标签（otype=3 或带 ad_tab_info 时是广告）
//   bilibili.app.view.v1.Relate               相关推荐条目
//     7 goto / 28 cm / 32 unique_id
//     广告判定：goto 是 cm 或 game，或者带 cm / unique_id
//
//   bilibili.app.viewunite.v1.ViewReply       新版详情页
//     7 cm                    视频下方广告
//     5 tab                   详情 Tab：模块 18/29/55 是推广位，
//                             模块 28 里的 RelateCard 混广告（见下）
//   bilibili.app.viewunite.common.Module      详情页模块
//     1 type / 22 relates     22 是推荐模块数据，cards 在 Relates.cards=1
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
    opt = { block_ads: arg[0]};
  } else if (arg && typeof arg === "object") {
    opt = arg;
  }

  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  const blockAds = flag(opt.block_ads, true);

  if (!blockAds) {
    $done({});
    return;
  }

  //=====================================================================================
  // protobuf wire —— 三端脚本共用的底层编解码
  //
  // 只做「把一段字节拆成字段列表」「按字段号编码」「varint 读写」，
  // 不建模具体消息。未建模的字段按 raw 原样保留，改不动时最多不生效，
  // 不会把响应写坏。
  //=====================================================================================

  const WIRE_TEXT = new TextEncoder();
  const WIRE_UTF8 = new TextDecoder("utf-8", { fatal: true });

  // varint 用 BigInt 读，避免 64 位字段（时间戳、ID）超过 2^53 后丢低位。
  function wireReadVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    let value = 0n;
    let shift = 0n;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
      shift += 7n;
      if (shift > 63n) throw new Error("Invalid protobuf varint");
    }
    throw new Error("Truncated protobuf varint");
  }

  // 字段号 / 长度这类小整数走 Number，避免每个字段都分配 BigInt；
  // 真的超过 4 字节时退回 BigInt 保证正确（实际只有超长字段才可能）。
  function wireReadCount(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    const start = state.i;
    let value = 0;
    let shift = 0;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      if (shift < 28) {
        value |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) return value >>> 0;
        shift += 7;
        continue;
      }
      // 超过 4 字节：退回去用 BigInt 重读整个 varint。
      state.i = start;
      return Number(wireReadVarint(bytes, state, limit));
    }
    throw new Error("Truncated protobuf varint");
  }

  // 只跳过 wire 0 的 varint，不构造 BigInt。字段切分 / 扫描时不需要这个值，
  // 大响应里能省掉每个数值字段一次 BigInt 分配。
  function wireSkipVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    while (state.i < limit) {
      if (!(bytes[state.i++] & 0x80)) return;
    }
    throw new Error("Truncated protobuf varint");
  }

  function wireVarintLength(value) {
    let length = 1;
    while (value >= 0x80n) {
      length++;
      value >>= 7n;
    }
    return length;
  }

  function wireEncodeVarint(value) {
    let rest = BigInt(value);
    const out = new Uint8Array(wireVarintLength(rest));
    let at = 0;
    while (rest >= 0x80n) {
      out[at++] = Number(rest & 0x7fn) | 0x80;
      rest >>= 7n;
    }
    out[at] = Number(rest);
    return out;
  }

  function wireConcat(parts) {
    let size = 0;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function wireEqual(left, right) {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  // 返回 [{ no, wire, data, raw }]；data 是字段值，raw 是含 tag 的整段字节。
  function wireParseFields(bytes) {
    const fields = [];
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const rawStart = state.i;
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");

      let dataStart = state.i;
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        dataStart = state.i;
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");

      fields.push({
        no: no,
        wire: wire,
        data: bytes.subarray(dataStart, state.i),
        raw: bytes.subarray(rawStart, state.i),
      });
    }
    return fields;
  }

  // 只扫字段号、不建对象、不切子数组；onField(no) 返回 true 时提前结束。
  // 用于大响应里判断「有没有某个字段」，比完整 parse 快很多。
  function wireScanFields(bytes, onField) {
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no)) return true;
    }
    return false;
  }

  // 按 no / wire 编码一个字段；payload 对 wire 0 是 varint 字节，其余是字段值。
  function wireEncodeField(no, wire, payload) {
    const tag = wireEncodeVarint(BigInt(no) * 8n + BigInt(wire));
    return wire === 2 ? wireConcat([tag, wireEncodeVarint(payload.length), payload]) : wireConcat([tag, payload]);
  }

  function wireDecodeText(bytes) {
    try {
      return WIRE_UTF8.decode(bytes);
    } catch (e) {
      return null;
    }
  }

  //=====================================================================================
  // gRPC 公共层 —— 帧拆分 / 重组 + protobuf 字段级改写
  //
  // 依赖 wire.js 的底层编解码。只提供「按字段号删」「按条件删重复项」两类操作，
  // 没有改动返回 null，调用方原样放行；改不动时最多不生效，不会把消息写坏。
  //=====================================================================================

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
    return wireConcat(parts);
  }

  function same(a, b) {
    return wireEqual(a, b);
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
    const state = { i: p };
    try {
      return [Number(wireReadVarint(b, state, end)), state.i];
    } catch (e) {
      return null;
    }
  }

  // 把一段消息拆成字段列表：{ no, wt, s, e, ds, de }
  // s..e 是整个字段（含 tag），ds..de 是字段值。
  function parseFields(b, start, end) {
    let fields;
    try {
      fields = wireParseFields(b.subarray(start, end));
    } catch (e) {
      return null;
    }
    const out = [];
    let at = start;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const s = at;
      const e = at + f.raw.length;
      out.push({ no: f.no, wt: f.wire, s: s, e: e, ds: e - f.data.length, de: e });
      at = e;
    }
    return out;
  }

  function encodeVarint(value) {
    return wireEncodeVarint(value);
  }

  function encodeField(no, wt, payload) {
    return wireEncodeField(no, wt, payload);
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

  // 读某个 varint 字段的值；没有就返回 null。
  function fieldVarint(b, s, e, no) {
    const fields = parseFields(b, s, e);
    if (!fields) return null;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === no && f.wt === 0) {
        const r = readVarint(b, f.ds, f.de);
        if (r) return r[0];
      }
    }
    return null;
  }

  // 对 no 字段的每个 length-delimited 载荷调用 fn，fn 返回新字节或 null（不改）。
  function mapSub(msg, no, fn) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    const parts = [];
    let changed = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === no && f.wt === 2) {
        const sub = msg.subarray(f.ds, f.de);
        const next = fn(sub);
        if (next && !same(next, sub)) {
          parts.push(encodeField(no, 2, next));
          changed = true;
          continue;
        }
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    return changed ? concat(parts) : null;
  }

  // 过滤重复字段：keep 返回 false 的整条删掉。
  function filterRepeated(msg, no, keep) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    const parts = [];
    let changed = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === no && f.wt === 2 && !keep(msg.subarray(f.ds, f.de))) {
        changed = true;
        continue;
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    return changed ? concat(parts) : null;
  }

  // ---- gRPC 帧 ----------------------------------------------------------

  // 响应是「1 字节 flag + 4 字节大端长度 + 消息体」的帧序列。
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

  // ---- 详情页模块（viewunite）------------------------------------------

  // ModuleType：18 番剧活动横幅 / 29 番剧标题下大会员横幅 / 55 up 主分享好物。
  const PROMO_MODULES = [18, 29, 55];
  const RELATED_RECOMMEND = 28;

  // Module.relates = 22，Relates.cards = 1。只处理推荐模块里的广告卡。
  function cleanModule(mod) {
    if (fieldVarint(mod, 0, mod.length, 1) !== RELATED_RECOMMEND) return null;
    return mapSub(mod, 22, (relates) => filterRepeated(relates, 1, (card) => !unifiedRelateAd(card, 0, card.length)));
  }

  // 模块容器里删推广模块，并把推荐模块里的广告卡过滤掉。no 是 modules 的字段号：
  // IntroductionTab.modules = 2，AIRelateTab.modules = 1。
  function cleanModules(container, no) {
    const mapped = mapSub(container, no, cleanModule);
    const base = mapped || container;
    const filtered = filterRepeated(base, no, (mod) => PROMO_MODULES.indexOf(fieldVarint(mod, 0, mod.length, 1)) < 0);
    return filtered || mapped;
  }

  // Tab.tab_module = 1，TabModule.introduction = 2
  function cleanTab(tab) {
    return mapSub(tab, 1, (mod) => mapSub(mod, 2, (intro) => cleanModules(intro, 2)));
  }

  // 播放页定制标签：otype=3（CmURI）或带 ad_tab_info(11) 就是广告。
  function adTab(b, s, e) {
    if (fieldVarint(b, s, e, 2) === 3) return true;
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].no === 11 && fields[i].wt === 2) return true;
    }
    return false;
  }

  // ---- 动态页（dynamic.v2）---------------------------------------------

  // DynamicItem.card_type = 1，DynamicType.ad = 15。
  const DYNAMIC_AD_TYPE = 15;

  // DynamicList.list = 1 / CardVideoDynList.list = 1
  function cleanDynamicList(list) {
    return filterRepeated(list, 1, (item) => fieldVarint(item, 0, item.length, 1) !== DYNAMIC_AD_TYPE);
  }

  // ---- 接口表 -----------------------------------------------------------

  const VIEW = "/bilibili.app.view.v1.View/";
  const UNITE = "/bilibili.app.viewunite.v1.View/";
  const REPLY = "/bilibili.main.community.reply.v1.Reply/";
  const DYNAMIC = "/bilibili.app.dynamic.v2.Dynamic/";

  const RULES = {};

  // 旧版详情页
  RULES[VIEW + "View"] = (m) => rewrite(m, [30, 31, 34, 41, 48], { 10: legacyRelateAd, 32: adTab });
  RULES[VIEW + "RelatesFeed"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "PlayerRelates"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "ViewProgress"] = (m) => rewrite(m, [1]);
  RULES[VIEW + "TFInfo"] = (m) => rewrite(m, [2, 3]);

  // 新版详情页：顶层 cm(7) + 详情 Tab 里的推广模块与推荐广告卡。
  RULES[UNITE + "View"] = (m) => {
    const dropped = rewrite(m, [7]);
    const tabbed = mapSub(dropped || m, 5, cleanTab);
    return tabbed || dropped;
  };
  // 异步补充的详情页：cm(1) + tab(2) 里的模块（AIRelateTab.modules = 1）
  RULES[UNITE + "AIRelateAsync"] = (m) => {
    const dropped = rewrite(m, [1]);
    const tabbed = mapSub(dropped || m, 2, (tab) => cleanModules(tab, 1));
    return tabbed || dropped;
  };
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

  // 动态页：综合页和视频页的 dynamic_list(1) 里删广告卡。
  RULES[DYNAMIC + "DynAll"] = (m) => mapSub(m, 1, cleanDynamicList);
  RULES[DYNAMIC + "DynVideo"] = (m) => mapSub(m, 1, cleanDynamicList);

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
        $done({});
        return;
      }

      let msg = bytes.subarray(f.start, f.end);
      if (f.flag & 0x01) {
        msg = toBytes(await gunzip(msg));
        if (!msg) {
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
    $done({ body: body });
  }

  run().catch((e) => {
    $done({});
  });

})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
