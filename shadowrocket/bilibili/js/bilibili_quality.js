//=======================================================================================
// BiliBili Enhance — 播放请求画质（REST + gRPC）
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// Shadowrocket 运行时兼容层。
//
// 只拼接到 shadowrocket/ 下的成品；Loon / Egern 自带这些 API，不会加载本文件。
// 全部按需安装：已有原生实现时整段跳过，不覆盖更快的原生版本。

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
    const codes = [];
    let out = "";
    const flush = () => {
      if (codes.length) {
        out += String.fromCharCode.apply(null, codes);
        codes.length = 0;
      }
    };
    for (let i = 0; i < b.length; ) {
      const start = i;
      const first = b[i++];
      let cp = 0;
      let need = 0;
      if (first < 0x80) cp = first;
      else if (first >= 0xc2 && first <= 0xdf) {
        cp = first & 0x1f;
        need = 1;
      } else if (first >= 0xe0 && first <= 0xef) {
        cp = first & 0x0f;
        need = 2;
      } else if (first >= 0xf0 && first <= 0xf4) {
        cp = first & 7;
        need = 3;
      } else need = -1;
      let ok = need >= 0 && i + need <= b.length;
      for (let k = 0; ok && k < need; k++) {
        if ((b[i + k] & 0xc0) !== 0x80) ok = false;
        else cp = (cp << 6) | (b[i + k] & 63);
      }
      if (ok && need === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) ok = false;
      if (ok && need === 3 && (cp < 0x10000 || cp > 0x10ffff)) ok = false;
      if (!ok) {
        if (this.fatal) throw new TypeError("invalid utf-8");
        codes.push(0xfffd);
        if (codes.length >= 4096) flush();
        i = start + 1;
        continue;
      }
      i += need;
      if (cp > 0xffff) {
        cp -= 0x10000;
        codes.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        codes.push(cp);
      }
      if (codes.length >= 4096) flush();
    }
    flush();
    return out;
  };
}

if ("undefined" == typeof Object.hasOwn) {
  Object.hasOwn = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };
}

// Uint8Array.fromBase64 / toBase64 是较新的 API，部分 Shadowrocket 的 JSC 没有。
// 这里补标准 base64（带填充），并保留命名函数供冒烟测试直接调用。
let shadowrocketB64Dec = null;

function shadowrocketBase64From(text) {
  if (!shadowrocketB64Dec) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    shadowrocketB64Dec = new Int16Array(128).fill(-1);
    for (let i = 0; i < chars.length; i++) shadowrocketB64Dec[chars.charCodeAt(i)] = i;
    shadowrocketB64Dec[45] = 62;
    shadowrocketB64Dec[95] = 63;
  }
  const s = String(text);
  const out = new Uint8Array(((s.length + 3) >>> 2) * 3);
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 128) continue;
    const v = shadowrocketB64Dec[code];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >>> bits) & 0xff;
    }
  }
  return p === out.length ? out : out.subarray(0, p);
}

function shadowrocketBase64To(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars.charAt(b0 >> 2);
    out += chars.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? chars.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < bytes.length ? chars.charAt(b2 & 63) : "=";
  }
  return out;
}

if ("undefined" == typeof Uint8Array.fromBase64) {
  Uint8Array.fromBase64 = shadowrocketBase64From;
}
if ("undefined" == typeof Uint8Array.prototype.toBase64) {
  Uint8Array.prototype.toBase64 = function () {
    return shadowrocketBase64To(this);
  };
}

(() => {
  "use strict";

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

// BiliBili Enhance — 画质请求改写（REST + gRPC）。
//
// 客户端请求播放地址时带 qn（清晰度编号），这里按档位参数改写（默认 4K qn=120，
// 补 fourk=1 和 fnval 对应高位）。服务端会按账号权限返回「实际能给的最高档」：
// 大会员给 4K/8K/杜比/HDR，普通账号自动落到 1080P，不会因为要不到高画质就报错。
//
// 两条路径都改：
//   REST  api/app.bilibili.com|biliapi.net 的 */playurl —— 改 query 里的 qn / fourk / fnval
//   gRPC  bilibili.app.playurl.v1.PlayURL/PlayView
//         bilibili.pgc.gateway.player.v2.PlayURL/PlayView
//         bilibili.app.playerunite.v1.Player/PlayViewUnite
//         改请求体里的 qn(3) / fnval(5) / fourk(8)；playerunite 的字段在 vod(1) 里面

  const req = (typeof $request !== "undefined" && $request) || {};
  const url = req.url || "";

  // Loon 传位置数组或对象，Egern / Shadowrocket 传 JSON 字符串或对象。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { auto_quality: raw[0], web: raw[1] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const QUALITY_TIERS = {
    "8k": { enabled: true, qn: 127, fnvalMask: 128 | 1024, fourk: 1 },
    dolby: { enabled: true, qn: 126, fnvalMask: 128 | 512, fourk: 1 },
    hdr: { enabled: true, qn: 125, fnvalMask: 128 | 64, fourk: 1 },
    "4k": { enabled: true, qn: 120, fnvalMask: 128, fourk: 1 },
    "1080p60": { enabled: true, qn: 116, fnvalMask: 0, fourk: null },
    "1080p+": { enabled: true, qn: 112, fnvalMask: 0, fourk: null },
    "1080p": { enabled: true, qn: 80, fnvalMask: 0, fourk: null },
  };
  function resolveQualityTier(v) {
    if (v === false || v === "false" || v === 0 || v === "0") return { enabled: false };
    if (v === undefined || v === null || v === "" || v === true || v === "true" || v === 1 || v === "1") {
      return QUALITY_TIERS["4k"];
    }
    const key = String(v).trim().toLowerCase();
    if (key === "off" || key === "false" || key === "0") return { enabled: false };
    return Object.prototype.hasOwnProperty.call(QUALITY_TIERS, key) ? QUALITY_TIERS[key] : QUALITY_TIERS["4k"];
  }

  const tier = resolveQualityTier(opt.auto_quality);
  if (!tier.enabled) {
    $done({});
    return;
  }
  // 网页版播放请求只改 query；关闭网页版支持时直接放行。
  const web = flag(opt.web, true);
  const isWebPlayurl = /\/x\/player\/wbi\/playurl|\/pgc\/player\/web\/playurl|\/x\/web-interface\//i.test(url);
  if (!web && isWebPlayurl) {
    $done({});
    return;
  }

  const QN_VALUES = [0, 6, 16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127];

  // 把 qn(3) 改成目标清晰度；高画质档顺带补 fnval(5) 与 fourk(8)=1。
  function patchVod(msg) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    let qn = null;
    let fnval = null;
    let fourk = null;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.wt !== 0) continue;
      const r = readVarint(msg, f.ds, f.de);
      if (!r) continue;
      if (f.no === 3) qn = r[0];
      else if (f.no === 5) fnval = r[0];
      else if (f.no === 8) fourk = r[0];
    }
    if (qn !== null && QN_VALUES.indexOf(qn) < 0) return null;
    if (qn === null && fnval === null && fourk === null) return null;

    const targetQn = tier.qn;
    const needFnval = tier.fnvalMask !== 0 && fnval !== null && (fnval & tier.fnvalMask) !== tier.fnvalMask;
    const needFourk = tier.fourk === 1 && fourk !== 1;
    if (qn === targetQn && !needFnval && !needFourk) return null;

    const parts = [];
    let sawQn = false;
    let sawFourk = false;
    let changed = qn !== targetQn;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 3 && f.wt === 0) {
        sawQn = true;
        parts.push(qn === targetQn ? msg.subarray(f.s, f.e) : encodeField(3, 0, encodeVarint(targetQn)));
        continue;
      }
      if (f.no === 5 && f.wt === 0 && needFnval) {
        parts.push(encodeField(5, 0, encodeVarint(fnval | tier.fnvalMask)));
        changed = true;
        continue;
      }
      if (f.no === 8 && f.wt === 0 && tier.fourk === 1) {
        sawFourk = true;
        if (fourk !== 1) {
          parts.push(encodeField(8, 0, encodeVarint(1)));
          changed = true;
          continue;
        }
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    if (!sawQn) {
      parts.push(encodeField(3, 0, encodeVarint(targetQn)));
      changed = true;
    }
    if (tier.fourk === 1 && !sawFourk) {
      parts.push(encodeField(8, 0, encodeVarint(1)));
      changed = true;
    }
    return changed ? concat(parts) : null;
  }

  const GRPC = /\/bilibili\.(?:app\.playurl\.v1\.PlayURL|pgc\.gateway\.player\.v2\.PlayURL|app\.playerunite\.v1\.Player)\/(?:PlayView|PlayViewUnite)$/;

  function patchGrpc() {
    const headers = req.headers || {};
    const ct = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
    if (ct.indexOf("grpc") < 0) return null;
    const ce = String(headers["content-encoding"] || headers["Content-Encoding"] || "").toLowerCase();
    if (ce && ce !== "identity") return null;

    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
    if (!GRPC.test(path)) return null;
    const nested = path.indexOf("playerunite") >= 0;

    const bytes = toBytes(req.body);
    if (!bytes || !bytes.length) return null;
    const frames = parseFrames(bytes);
    if (!frames || !frames.length) return null;

    const out = [];
    let changed = false;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      // 压缩帧和 trailer 帧一律不动。
      if (f.flag !== 0) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      const msg = bytes.subarray(f.start, f.end);
      const next = nested ? mapSub(msg, 1, patchVod) : patchVod(msg);
      if (!next) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      changed = true;
      out.push(frame(0, next));
    }
    return changed ? concat(out) : null;
  }

  const grpcBody = patchGrpc();
  if (grpcBody) {
    $done({ body: grpcBody });
    return;
  }

  // gRPC 请求没改成（不是目标方法 / 已是最优 / 格式不认识）就原样放行，
  // 不能落到下面的 REST 分支去拼 query。
  const ct = String((req.headers || {})["content-type"] || (req.headers || {})["Content-Type"] || "");
  if (ct.toLowerCase().indexOf("grpc") >= 0) {
    $done({});
    return;
  }

  // ---- REST -------------------------------------------------------------

  if (!/^https?:\/\/(?:api|app|bangumi)\.bili(?:bili\.com|api\.net)\//i.test(url)) {
    $done({});
    return;
  }
  if (url.indexOf("/playurl") < 0) {
    $done({});
    return;
  }

  let out = url.replace(/([?&])qn=\d*/i, "$1qn=" + tier.qn);
  if (!/[?&]qn=/i.test(out)) {
    out += (out.indexOf("?") < 0 ? "?" : "&") + "qn=" + tier.qn;
  }
  if (tier.fourk === 1) {
    if (/[?&]fourk=\d*/i.test(out)) {
      out = out.replace(/([?&])fourk=\d*/i, "$1fourk=1");
    } else {
      out += "&fourk=1";
    }
  }
  // fnval 补对应高画质位，否则服务端不会给 4K/8K/HDR/杜比档。
  if (tier.fnvalMask) {
    const fn = /([?&])fnval=(\d+)/i.exec(out);
    if (fn) {
      const v = Number(fn[2]) | tier.fnvalMask;
      if (String(v) !== fn[2]) out = out.replace(fn[0], fn[1] + "fnval=" + v);
    }
  }

  if (out === url) {
    $done({});
    return;
  }
  $done({ url: out });

})();
