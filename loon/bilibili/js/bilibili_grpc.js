//=======================================================================================
// BiliBili Enhance — gRPC 响应（详情 / 评论 / 动态）
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


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
    opt = { block_ads: arg[0], hide_vip: arg[1] };
  } else if (arg && typeof arg === "object") {
    opt = arg;
  }

  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  const blockAds = flag(opt.block_ads, true);
  const hideVip = flag(opt.hide_vip, true);

  if (!blockAds && !hideVip) {
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
    if ("number" == typeof value && value >= 0 && value <= 0x7fffffff) {
      let n = value | 0;
      const len = n < 0x80 ? 1 : n < 0x4000 ? 2 : n < 0x200000 ? 3 : n < 0x10000000 ? 4 : 5;
      const out = new Uint8Array(len);
      let at = 0;
      while (n >= 0x80) {
        out[at++] = (n & 0x7f) | 0x80;
        n >>>= 7;
      }
      out[at] = n;
      return out;
    }
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

  // 旧式 group（wire type 3）：从 start 之后开始找匹配的 end group，返回结束位置。
  // Spotify 的元数据响应里偶尔会带 group，不认它的话整条响应只能原样放行。
  function wireSkipGroup(bytes, from, no) {
    const state = { i: from };
    while (state.i < bytes.length) {
      const tag = wireReadCount(bytes, state);
      const inner = tag >>> 3;
      const wire = tag & 7;
      if (!inner) throw new Error("Invalid protobuf field");
      if (wire === 4) {
        if (inner !== no) throw new Error("Mismatched protobuf end group");
        return state.i;
      }
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
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, inner);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
    }
    throw new Error("Truncated protobuf group");
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
      } else if (wire === 3) {
        // group：整段（含起止 tag）当 opaque 值保留，重新编码时原样写回。
        state.i = wireSkipGroup(bytes, state.i, no);
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
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no)) return true;
    }
    return false;
  }

  // 流式遍历字段，不分配字段对象与子数组；回调返回 true 时提前停止。
  function wireForEachField(bytes, onField) {
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
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no, wire, dataStart, state.i, rawStart, state.i)) return true;
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

  // 一次扫描多组 needle；任意命中即返回 true。大响应里比逐组扫快 len(needles) 倍。
  function containsAnyAscii(b, s, e, needles) {
    const last = e - 1;
    for (let i = s; i <= last; i++) {
      const c = b[i];
      for (let k = 0; k < needles.length; k++) {
        const needle = needles[k];
        if (c !== needle[0]) continue;
        if (i + needle.length > e) continue;
        let hit = true;
        for (let j = 1; j < needle.length; j++) {
          if (b[i + j] !== needle[j]) {
            hit = false;
            break;
          }
        }
        if (hit) return true;
      }
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

  // drop 里的字段号整条删；filters 里的字段号按条件删（只处理 length-delimited）；
  // maps 里的字段号改写载荷（只处理 length-delimited）。
  // 单次扫描完成，不建完整字段列表；采用懒切片（Lazy slice），未改动时 0 子数组分配；
  // 没有改动返回 null，调用方据此原样放行。
  function rewrite(msg, drop, filters, maps) {
    let parts = null;
    let keepFrom = 0;
    const state = { i: 0 };
    try {
      while (state.i < msg.length) {
        const start = state.i;
        const tag = wireReadCount(msg, state);
        const no = tag >>> 3;
        const wt = tag & 7;
        if (!no) throw new Error("Invalid protobuf field");
        let ds = state.i;
        let de;
        if (wt === 2) {
          const length = wireReadCount(msg, state);
          if (length > msg.length - state.i) throw new Error("Truncated protobuf field");
          ds = state.i;
          state.i += length;
          de = state.i;
        } else if (wt === 1) {
          state.i += 8;
          de = state.i;
        } else if (wt === 5) {
          state.i += 4;
          de = state.i;
        } else if (wt === 0) {
          wireSkipVarint(msg, state);
          de = state.i;
        } else {
          throw new Error("Unsupported protobuf wire type " + wt);
        }
        if (state.i > msg.length) throw new Error("Truncated protobuf field");
        const end = state.i;
        if (drop && drop.indexOf(no) >= 0) {
          if (!parts) parts = [];
          if (start > keepFrom) parts.push(msg.subarray(keepFrom, start));
          keepFrom = end;
          continue;
        }
        if (filters && wt === 2 && filters[no] && filters[no](msg, ds, de)) {
          if (!parts) parts = [];
          if (start > keepFrom) parts.push(msg.subarray(keepFrom, start));
          keepFrom = end;
          continue;
        }
        if (maps && wt === 2 && maps[no]) {
          const sub = msg.subarray(ds, de);
          const next = maps[no](sub);
          if (next && !same(next, sub)) {
            if (!parts) parts = [];
            if (start > keepFrom) parts.push(msg.subarray(keepFrom, start));
            parts.push(encodeField(no, 2, next));
            keepFrom = end;
            continue;
          }
        }
      }
    } catch (e) {
      return null;
    }
    if (!parts) return null;
    if (keepFrom < msg.length) parts.push(msg.subarray(keepFrom, msg.length));
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

  // 用扫描找某个 varint 字段的值，不建完整字段列表。
  // 找到字段号匹配且 wire=0 的就取值，否则返回 null。
  function fieldVarintFast(b, s, e, no) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        if (wire === 0) {
          if (fn === no) {
            return Number(wireReadVarint(sub, state));
          }
          wireSkipVarint(sub, state);
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          state.i += length;
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // 扫描判断某个字段号是否存在（不区分 wire type），不建字段列表。
  function hasField(b, s, e, no) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        if (wire === 0) {
          wireSkipVarint(sub, state);
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          state.i += length;
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
        if (fn === no) return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // 对 no 字段的每个 length-delimited 载荷调用 fn，fn 返回新字节或 null（不改）。
  // 单次扫描 + 懒切片，未改动时 0 子数组分配。
  function mapSub(msg, no, fn) {
    let parts = null;
    let keepFrom = 0;
    const state = { i: 0 };
    try {
      while (state.i < msg.length) {
        const start = state.i;
        const tag = wireReadCount(msg, state);
        const fieldNo = tag >>> 3;
        const wt = tag & 7;
        if (!fieldNo) throw new Error("Invalid protobuf field");
        let ds = state.i;
        let de;
        if (wt === 2) {
          const length = wireReadCount(msg, state);
          if (length > msg.length - state.i) throw new Error("Truncated protobuf field");
          ds = state.i;
          state.i += length;
          de = state.i;
        } else if (wt === 1) {
          state.i += 8;
          de = state.i;
        } else if (wt === 5) {
          state.i += 4;
          de = state.i;
        } else if (wt === 0) {
          wireSkipVarint(msg, state);
          de = state.i;
        } else {
          throw new Error("Unsupported protobuf wire type " + wt);
        }
        if (state.i > msg.length) throw new Error("Truncated protobuf field");
        const end = state.i;
        if (fieldNo === no && wt === 2) {
          const sub = msg.subarray(ds, de);
          const next = fn(sub);
          if (next && !same(next, sub)) {
            if (!parts) parts = [];
            if (start > keepFrom) parts.push(msg.subarray(keepFrom, start));
            parts.push(encodeField(no, 2, next));
            keepFrom = end;
            continue;
          }
        }
      }
    } catch (e) {
      return null;
    }
    if (!parts) return null;
    if (keepFrom < msg.length) parts.push(msg.subarray(keepFrom, msg.length));
    return concat(parts);
  }

  // 过滤重复字段：keep 返回 false 的整条删掉。单次扫描 + 懒切片，未改动时 0 子数组分配。
  function filterRepeated(msg, no, keep) {
    let parts = null;
    let keepFrom = 0;
    const state = { i: 0 };
    try {
      while (state.i < msg.length) {
        const start = state.i;
        const tag = wireReadCount(msg, state);
        const fieldNo = tag >>> 3;
        const wt = tag & 7;
        if (!fieldNo) throw new Error("Invalid protobuf field");
        let ds = state.i;
        let de;
        if (wt === 2) {
          const length = wireReadCount(msg, state);
          if (length > msg.length - state.i) throw new Error("Truncated protobuf field");
          ds = state.i;
          state.i += length;
          de = state.i;
        } else if (wt === 1) {
          state.i += 8;
          de = state.i;
        } else if (wt === 5) {
          state.i += 4;
          de = state.i;
        } else if (wt === 0) {
          wireSkipVarint(msg, state);
          de = state.i;
        } else {
          throw new Error("Unsupported protobuf wire type " + wt);
        }
        if (state.i > msg.length) throw new Error("Truncated protobuf field");
        const end = state.i;
        if (fieldNo === no && wt === 2 && !keep(msg.subarray(ds, de))) {
          if (!parts) parts = [];
          if (start > keepFrom) parts.push(msg.subarray(keepFrom, start));
          keepFrom = end;
          continue;
        }
      }
    } catch (e) {
      return null;
    }
    if (!parts) return null;
    if (keepFrom < msg.length) parts.push(msg.subarray(keepFrom, msg.length));
    return concat(parts);
  }

  // 一次扫描同时做 filter + map：keep 返回 false 的删掉，
  // keep 返回 true 的再调 mapFn（可返回 null 表示不改）。懒切片避免无改动时的子数组分配。
  function filterAndMap(msg, no, keep, mapFn) {
    let parts = null;
    let keepFrom = 0;
    const state = { i: 0 };
    try {
      while (state.i < msg.length) {
        const start = state.i;
        const tag = wireReadCount(msg, state);
        const fieldNo = tag >>> 3;
        const wt = tag & 7;
        if (!fieldNo) throw new Error("Invalid protobuf field");
        let ds = state.i;
        let de;
        if (wt === 2) {
          const length = wireReadCount(msg, state);
          if (length > msg.length - state.i) throw new Error("Truncated protobuf field");
          ds = state.i;
          state.i += length;
          de = state.i;
        } else if (wt === 1) {
          state.i += 8;
          de = state.i;
        } else if (wt === 5) {
          state.i += 4;
          de = state.i;
        } else if (wt === 0) {
          wireSkipVarint(msg, state);
          de = state.i;
        } else {
          throw new Error("Unsupported protobuf wire type " + wt);
        }
        if (state.i > msg.length) throw new Error("Truncated protobuf field");
        const end = state.i;
        if (fieldNo === no && wt === 2) {
          const sub = msg.subarray(ds, de);
          if (!keep(sub)) {
            if (!parts) parts = [];
            if (start > keepFrom) parts.push(msg.subarray(keepFrom, start));
            keepFrom = end;
            continue;
          }
          if (mapFn) {
            const next = mapFn(sub);
            if (next && !same(next, sub)) {
              if (!parts) parts = [];
              if (start > keepFrom) parts.push(msg.subarray(keepFrom, start));
              parts.push(encodeField(no, 2, next));
              keepFrom = end;
              continue;
            }
          }
        }
      }
    } catch (e) {
      return null;
    }
    if (!parts) return null;
    if (keepFrom < msg.length) parts.push(msg.subarray(keepFrom, msg.length));
    return concat(parts);
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

// 共享 GZIP 解压（Loon $utils.ungzip / Egern ctx.compress / DecompressionStream / 纯 JS 兜底）

function gunzipJs(raw) {
  const src =
    raw instanceof Uint8Array
      ? raw
      : ArrayBuffer.isView(raw)
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : null;
  if (!src || src.length < 18 || src[0] !== 0x1f || src[1] !== 0x8b || src[2] !== 8) {
    throw new Error("not gzip");
  }
  const flg = src[3];
  if (flg & 0xe0) throw new Error("bad gzip flags");
  const end = src.length - 8;
  let p = 10;
  if (flg & 4) {
    if (p + 2 > end) throw new Error("truncated gzip fextra");
    p += 2 + (src[p] | (src[p + 1] << 8));
  }
  if (flg & 8) {
    while (p < end && src[p] !== 0) p++;
    if (p >= end) throw new Error("truncated gzip fname");
    p++;
  }
  if (flg & 16) {
    while (p < end && src[p] !== 0) p++;
    if (p >= end) throw new Error("truncated gzip fcomment");
    p++;
  }
  if (flg & 2) p += 2;
  if (p > end) throw new Error("truncated gzip header");

  const MAX_OUT = 16777216;
  let bitBuf = 0;
  let bitLen = 0;
  function readBits(n) {
    while (bitLen < n) {
      if (p >= end) throw new Error("unexpected end of deflate stream");
      bitBuf |= src[p++] << bitLen;
      bitLen += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitLen -= n;
    return val;
  }

  function buildTree(lengths) {
    const counts = new Uint16Array(16);
    let maxBits = 0;
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (len) {
        counts[len]++;
        if (len > maxBits) maxBits = len;
      }
    }
    if (!maxBits) return { counts, syms: new Uint16Array(0), maxBits: 0 };
    const offs = new Uint16Array(16);
    let left = 1;
    for (let b = 1; b <= 15; b++) {
      left <<= 1;
      left -= counts[b];
      if (left < 0) throw new Error("oversubscribed huffman tree");
      if (b < 15) offs[b + 1] = offs[b] + counts[b];
    }
    const syms = new Uint16Array(lengths.length);
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len) syms[offs[len]++] = sym;
    }
    return { counts, syms, maxBits };
  }

  function decodeSym(tree) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= tree.maxBits; len++) {
      code |= readBits(1);
      const count = tree.counts[len];
      if (code - count < first) return tree.syms[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error("invalid huffman symbol");
  }

  const fixedLitLens = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) fixedLitLens[i] = 8;
  for (let i = 144; i <= 255; i++) fixedLitLens[i] = 9;
  for (let i = 256; i <= 279; i++) fixedLitLens[i] = 7;
  for (let i = 280; i <= 287; i++) fixedLitLens[i] = 8;
  const fixedLit = buildTree(fixedLitLens);
  const fixedDistLens = new Uint8Array(32);
  fixedDistLens.fill(5);
  const fixedDist = buildTree(fixedDistLens);

  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const LEN_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  let out = new Uint8Array(Math.min(Math.max(end * 3, 256), MAX_OUT));
  let outLen = 0;
  function ensureOut(add) {
    const req = outLen + add;
    if (req > MAX_OUT) throw new Error("gunzip output exceeds 16 MiB");
    if (req <= out.length) return;
    let nextLen = out.length * 2;
    while (nextLen < req) nextLen *= 2;
    const next = new Uint8Array(Math.min(nextLen, MAX_OUT));
    next.set(out.subarray(0, outLen));
    out = next;
  }

  let bfinal = 0;
  do {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      bitBuf = 0;
      bitLen = 0;
      if (p + 4 > end) throw new Error("truncated stored block");
      const len = src[p] | (src[p + 1] << 8);
      const nlen = src[p + 2] | (src[p + 3] << 8);
      p += 4;
      if ((len ^ nlen) !== 0xffff || p + len > end) throw new Error("bad stored block");
      ensureOut(len);
      out.set(src.subarray(p, p + len), outLen);
      outLen += len;
      p += len;
      continue;
    }

    let litTree = fixedLit;
    let distTree = fixedDist;
    if (btype === 2) {
      const hlit = readBits(5) + 257;
      const hdist = readBits(5) + 1;
      const hclen = readBits(4) + 4;
      const clLens = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
      const clTree = buildTree(clLens);
      const total = hlit + hdist;
      const allLens = new Uint8Array(total);
      let idx = 0;
      while (idx < total) {
        const sym = decodeSym(clTree);
        if (sym < 16) {
          allLens[idx++] = sym;
        } else {
          let rep = 0;
          let val = 0;
          if (sym === 16) {
            if (idx === 0) throw new Error("bad repeat length");
            val = allLens[idx - 1];
            rep = 3 + readBits(2);
          } else if (sym === 17) {
            rep = 3 + readBits(3);
          } else {
            rep = 11 + readBits(7);
          }
          if (idx + rep > total) throw new Error("huffman lengths overflow");
          while (rep-- > 0) allLens[idx++] = val;
        }
      }
      if (!allLens[256]) throw new Error("missing eob symbol");
      litTree = buildTree(allLens.subarray(0, hlit));
      distTree = buildTree(allLens.subarray(hlit));
    } else if (btype !== 1) {
      throw new Error("reserved deflate block");
    }

    for (;;) {
      const sym = decodeSym(litTree);
      if (sym < 256) {
        ensureOut(1);
        out[outLen++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        if (li >= LEN_BASE.length) throw new Error("invalid length symbol");
        const len = LEN_BASE[li] + (LEN_EXTRA[li] ? readBits(LEN_EXTRA[li]) : 0);
        const di = decodeSym(distTree);
        if (di >= DIST_BASE.length) throw new Error("invalid distance symbol");
        const dist = DIST_BASE[di] + (DIST_EXTRA[di] ? readBits(DIST_EXTRA[di]) : 0);
        if (dist <= 0 || dist > outLen) throw new Error("invalid back-reference distance");
        ensureOut(len);
        for (let i = 0; i < len; i++) {
          out[outLen] = out[outLen - dist];
          outLen++;
        }
      }
    }
  } while (!bfinal);

  const isize = (src[end + 4] | (src[end + 5] << 8) | (src[end + 6] << 16) | (src[end + 7] << 24)) >>> 0;
  if ((outLen >>> 0) !== isize) throw new Error("gzip isize mismatch");
  return out.subarray(0, outLen);
}

async function gunzipBytes(raw) {
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : ArrayBuffer.isView(raw)
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : null;
  if (!bytes || bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
    return null;
  }
  const emptyExpected =
    (bytes[bytes.length - 4] | bytes[bytes.length - 3] | bytes[bytes.length - 2] | bytes[bytes.length - 1]) === 0;
  const coerce = (out) => {
    const u =
      out instanceof Uint8Array
        ? out
        : ArrayBuffer.isView(out)
          ? new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
          : out instanceof ArrayBuffer
            ? new Uint8Array(out)
            : null;
    return u && (u.length > 0 || emptyExpected) ? u : null;
  };

  if ("undefined" != typeof $utils && $utils && "function" == typeof $utils.ungzip) {
    try {
      const u = coerce($utils.ungzip(bytes));
      if (u) return u;
    } catch {}
  }
  if ("undefined" != typeof ctx && ctx && ctx.compress && "function" == typeof ctx.compress.gunzip) {
    try {
      const u = coerce(await ctx.compress.gunzip(bytes));
      if (u) return u;
    } catch {}
  }
  if ("undefined" != typeof DecompressionStream) {
    let reader = null;
    let writer = null;
    try {
      const stream = new DecompressionStream("gzip");
      reader = stream.readable.getReader();
      writer = stream.writable.getWriter();
      const collected = (async () => {
        const chunks = [];
        let total = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > 16777216) throw new Error("gunzip exceeds 16 MiB");
          chunks.push(value);
        }
        const out = new Uint8Array(total);
        let pos = 0;
        for (let i = 0; i < chunks.length; i++) {
          out.set(chunks[i], pos);
          pos += chunks[i].length;
        }
        return out;
      })();
      const written = (async () => {
        await writer.write(bytes);
        await writer.close();
      })();
      const u = coerce((await Promise.all([collected, written]))[0]);
      if (u) return u;
    } catch (e) {
      if (reader || writer) {
        try {
          await Promise.allSettled([reader && reader.cancel(e), writer && writer.abort(e)]);
        } catch {}
      }
    } finally {
      try {
        if (reader) reader.releaseLock();
      } catch {}
      try {
        if (writer) writer.releaseLock();
      } catch {}
    }
  }
  try {
    return coerce(gunzipJs(bytes));
  } catch {
    return null;
  }
}

  // ---- 广告判定 ---------------------------------------------------------

  // 旧版相关推荐：goto(7) 是 cm/game，或带 cm(28) / unique_id(32) 非空。
  // 用扫描遍历字段，找到目标字段就判定，不建完整字段列表。
  function legacyRelateAd(b, s, e) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        let ds = state.i;
        if (wire === 0) {
          wireSkipVarint(sub, state);
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          ds = state.i;
          state.i += length;
          if (fn === 7) {
            const goto = ascii(sub, ds, state.i);
            if (goto === "cm" || goto === "game") return true;
          } else if (fn === 28) {
            return true;
          } else if (fn === 32 && state.i > ds) {
            return true;
          }
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // 新版推荐卡：type(1) 是广告类型（4/5/11），或带 cm(6) / cm_stock(11)。
  function unifiedRelateAd(b, s, e) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        if (wire === 0) {
          if (fn === 1) {
            const v = Number(wireReadVarint(sub, state));
            if (v === 4 || v === 5 || v === 11) return true;
          } else {
            wireSkipVarint(sub, state);
          }
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          state.i += length;
          if (fn === 6 || fn === 11) return true;
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // 评论区顶部卡片：type=3 是带货卡。
  function commercialTopCard(b, s, e) {
    return fieldVarintFast(b, s, e, 1) === 3;
  }

  // 带货评论：正文或跳转链接里出现 b23.tv/cm、b23.tv/mall、商品页。
  // 一次扫描全部 needle，不逐组扫。
  const REPLY_AD_NEEDLES = [
    asciiBytes("b23.tv/cm"),
    asciiBytes("b23.tv/mall"),
    asciiBytes("cm.bilibili.com/ad-showcase-h5"),
    asciiBytes("gaoneng.bilibili.com"),
    asciiBytes("huahuo.bilibili.com"),
    asciiBytes("mall.bilibili.com"),
    asciiBytes("ad.bilibili.com"),
  ];

  function commercialReply(b, s, e) {
    return containsAnyAscii(b, s, e, REPLY_AD_NEEDLES);
  }

  // ---- 详情页模块（viewunite）------------------------------------------

  // ModuleType：18 番剧活动横幅 / 29 番剧标题下大会员横幅 / 55 up 主分享好物。
  // 29 归 hideVip 管，18 与 55 归 blockAds 管。
  const RELATED_RECOMMEND = 28;

  function isDroppedPromoModule(type) {
    if (blockAds && (type === 18 || type === 55)) return true;
    if (hideVip && type === 29) return true;
    return false;
  }

  // Module.relates = 22，Relates.cards = 1。只处理推荐模块里的广告卡。
  // 先用 fieldVarintFast 判模块类型（不建字段列表），不是推荐模块就跳过。
  function cleanModule(mod) {
    if (!blockAds) return null;
    if (fieldVarintFast(mod, 0, mod.length, 1) !== RELATED_RECOMMEND) return null;
    return mapSub(mod, 22, (relates) => filterRepeated(relates, 1, (card) => !unifiedRelateAd(card, 0, card.length)));
  }

  // 模块容器里删推广模块，并把推荐模块里的广告卡过滤掉。no 是 modules 的字段号：
  // IntroductionTab.modules = 2，AIRelateTab.modules = 1。
  // 一次解析同时做 filter + map，比分别调省一次 parseFields。
  function cleanModules(container, no) {
    return filterAndMap(
      container,
      no,
      (mod) => !isDroppedPromoModule(fieldVarintFast(mod, 0, mod.length, 1)),
      blockAds ? cleanModule : null
    );
  }

  // Tab.tab_module = 1，TabModule.introduction = 2
  function cleanTab(tab) {
    return mapSub(tab, 1, (mod) => mapSub(mod, 2, (intro) => cleanModules(intro, 2)));
  }

  // 播放页定制标签：otype=3（CmURI）或带 ad_tab_info(11) 就是广告。
  function adTab(b, s, e) {
    if (fieldVarintFast(b, s, e, 2) === 3) return true;
    return hasField(b, s, e, 11);
  }

  // ---- 动态页（dynamic.v2）---------------------------------------------

  // DynamicItem.card_type = 1，DynamicType.ad = 15。
  const DYNAMIC_AD_TYPE = 15;

  // DynamicList.list = 1 / CardVideoDynList.list = 1
  function cleanDynamicList(list) {
    return filterRepeated(list, 1, (item) => fieldVarintFast(item, 0, item.length, 1) !== DYNAMIC_AD_TYPE);
  }

  // ---- 搜索页（polymer.app.search.v1）----------------------------------

  // SearchAllResponse.item = 4；Item 里 card_item oneof：
  // cm(10) / brand_ad(24) / game(13) / special_guide(25) / brand_star_ad(45) / cm_ad(49) 是广告推广卡。
  function isSearchAdItem(item) {
    try {
      const state = { i: 0 };
      while (state.i < item.length) {
        const tag = wireReadCount(item, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        if (wire === 2) {
          const length = wireReadCount(item, state);
          if (length > item.length - state.i) throw new Error("Truncated protobuf field");
          const ds = state.i;
          state.i += length;
          if (fn === 10 || fn === 24 || fn === 25 || fn === 45 || fn === 49) return true;
          if (fn === 3) {
            const goto = ascii(item, ds, state.i);
            if (goto === "ad" || goto === "cm" || goto === "banner_ad") return true;
          }
        } else if (wire === 0) {
          wireSkipVarint(item, state);
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > item.length) throw new Error("Truncated protobuf field");
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // ---- 接口表 -----------------------------------------------------------

  const VIEW = "/bilibili.app.view.v1.View/";
  const UNITE = "/bilibili.app.viewunite.v1.View/";
  const REPLY = "/bilibili.main.community.reply.v1.Reply/";
  const DYNAMIC = "/bilibili.app.dynamic.v2.Dynamic/";
  const SEARCH = "/bilibili.polymer.app.search.v1.Search/";

  const RULES = {};

  if (blockAds) {
    // 旧版详情页：删广告字段，过滤相关推荐与定制 Tab。
    // rewrite 单次扫描，没有目标字段或没有改动时返回 null。
    RULES[VIEW + "View"] = (m) => rewrite(m, [30, 31, 34, 41, 48], { 10: legacyRelateAd, 32: adTab });
    RULES[VIEW + "RelatesFeed"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
    RULES[VIEW + "PlayerRelates"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
    RULES[VIEW + "ViewProgress"] = (m) => rewrite(m, [1]);
    RULES[VIEW + "TFInfo"] = (m) => rewrite(m, [2, 3]);

    RULES[UNITE + "RelatesFeed"] = (m) => rewrite(m, null, { 1: unifiedRelateAd });
    RULES[UNITE + "ViewProgress"] = (m) => rewrite(m, [1]);
    RULES[UNITE + "PlayPause"] = () => EMPTY;
    RULES[UNITE + "ViewEndPage"] = () => EMPTY;

    // 评论区：删广告字段，过滤置顶带货评论与顶部带货卡。
    // 普通评论页没有目标字段时，单次扫描直接返回 null。
    RULES[REPLY + "MainList"] = (m) =>
      rewrite(m, [11], {
        4: commercialReply,
        5: commercialReply,
        6: commercialReply,
        14: commercialReply,
        28: commercialTopCard,
      });

    // 动态页：综合页、视频页及个人筛选流的 dynamic_list(1) 里删广告卡。
    RULES[DYNAMIC + "DynAll"] = (m) => mapSub(m, 1, cleanDynamicList);
    RULES[DYNAMIC + "DynVideo"] = (m) => mapSub(m, 1, cleanDynamicList);
    RULES[DYNAMIC + "DynAllPersonal"] = (m) => mapSub(m, 1, cleanDynamicList);
    RULES[DYNAMIC + "DynVideoPersonal"] = (m) => mapSub(m, 1, cleanDynamicList);

    // 综合搜索结果：删 item(4) 里的广告条目。
    RULES[SEARCH + "SearchAll"] = (m) => filterRepeated(m, 4, (item) => !isSearchAdItem(item));
  }

  // 新版详情页：顶层 cm(7)（blockAds） + 详情 Tab(5) 里的推广模块（blockAds / hideVip）与推荐广告卡（blockAds）。
  // 删除与改写一次扫描完成。
  RULES[UNITE + "View"] = (m) => rewrite(m, blockAds ? [7] : null, null, { 5: cleanTab });
  // 异步补充的详情页：cm(1) + tab(2) 里的模块（AIRelateTab.modules = 1）
  RULES[UNITE + "AIRelateAsync"] = (m) => rewrite(m, blockAds ? [1] : null, null, { 2: (tab) => cleanModules(tab, 1) });

  // ---- gRPC 状态头 ------------------------------------------------------

  function headerValue(headers, lowerName, capName) {
    if (!headers) return undefined;
    if (headers[lowerName] !== undefined) return headers[lowerName];
    if (capName && headers[capName] !== undefined) return headers[capName];
    for (const k in headers) {
      if (k.toLowerCase() === lowerName) return headers[k];
    }
    return undefined;
  }

  // 复制响应头并按客户端类型补齐 / 去掉 grpc-status。
  //
  // B 站手机版 / HD / 海外版走 Moss 引擎（请求头 x-bili-moss-engine-type: 1）时，
  // 只认响应头里的 grpc-status，不读 HTTP/2 trailers；Loon 改写响应体后 trailers
  // 还可能丢失，表现就是详情页 / 评论区一直转圈。蓝版同理。国际版相反，响应头里
  // 不能带 grpc-status: 0。已有非零状态保持原值，避免把服务端错误改成成功。
  function fixHeaders(reqHeaders, resHeaders, h2Trailers) {
    const ua = String(headerValue(reqHeaders, "user-agent", "User-Agent") || "");
    const universal =
      ua.indexOf("bili-universal/") >= 0 ||
      ua.indexOf("bili-hd2/") >= 0 ||
      ua.indexOf("bili-overseas/") >= 0;
    const blue = ua.indexOf("bili-blue/") >= 0;
    const inter = ua.indexOf("bili-inter/") >= 0;
    if (!universal && !blue && !inter) return null;
    const status = headerValue(resHeaders, "grpc-status", "Grpc-Status");
    // trailers 里已经是错误码时不能补 0，否则客户端会把失败当成功。
    const trailerStatus = headerValue(h2Trailers, "grpc-status", "Grpc-Status");
    const ok = trailerStatus === undefined || String(trailerStatus) === "0";
    let out = null;
    const edit = () => out || (out = Object.assign({}, resHeaders || {}));

    // 手机版 / HD / 海外版对响应头状态是「有就必须正确，没有则回退读 trailers」，
    // 这里统一补 0；国际版去掉 0，非零状态保持原样。
    if ((universal || blue) && status === undefined && ok) {
      edit()["grpc-status"] = "0";
    } else if (inter && String(status) === "0") {
      const headers = edit();
      for (const k in headers) {
        if (k.toLowerCase() === "grpc-status") delete headers[k];
      }
    }
    return out;
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

    const fixed = fixHeaders(req.headers || {}, headers, res.h2_trailers);
    const pass = () => {
      if (fixed) $done({ headers: fixed });
      else $done({});
    };

    const ce = String(headers["content-encoding"] || headers["Content-Encoding"] || "").toLowerCase();
    if (ce && ce !== "identity") {
      pass();
      return;
    }

    const bytes = toBytes(res.body);
    if (!bytes || !bytes.length) {
      pass();
      return;
    }

    const frames = parseFrames(bytes);
    if (!frames) {
      pass();
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
        pass();
        return;
      }

      let msg = bytes.subarray(f.start, f.end);
      if (f.flag & 0x01) {
        const rawMsg = await gunzipBytes(msg);
        if (!rawMsg) {
          pass();
          return;
        }
        msg = rawMsg;
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
      pass();
      return;
    }
    const body = concat(out);
    const result = { body: body };
    let outHeaders = fixed;
    for (const k in headers) {
      if (k.toLowerCase() === "content-length") {
        outHeaders = outHeaders || Object.assign({}, headers);
        delete outHeaders[k];
      }
    }
    if (outHeaders) {
      for (const k in outHeaders) {
        if (k.toLowerCase() === "content-length") delete outHeaders[k];
      }
      result.headers = outHeaders;
    }
    // 显式带回 trailers；Loon 不会因为改过 body 就把 grpc-status 丢掉。
    if (res.h2_trailers !== undefined) result.h2_trailers = res.h2_trailers;
    $done(result);
  }

  run().catch((e) => {
    $done({});
  });

})();
