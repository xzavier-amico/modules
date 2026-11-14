//=======================================================================================
// YouTube Enhance — youtubei 响应 + initplayback UMP
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
    let out = "";
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

if ("undefined" == typeof Object.hasOwn) {
  Object.hasOwn = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };
}

// Uint8Array.fromBase64 / toBase64 是较新的 API，部分 Shadowrocket 的 JSC 没有。
// 这里补标准 base64（带填充），并保留命名函数供冒烟测试直接调用。
function shadowrocketBase64From(text) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(text)
    .replace(/[-_]/g, (ch) => (ch === "-" ? "+" : "/"))
    .replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean.charAt(i));
    const b = chars.indexOf(clean.charAt(i + 1));
    const c = chars.indexOf(clean.charAt(i + 2));
    const d = chars.indexOf(clean.charAt(i + 3));
    const n = (a << 18) | ((b & 63) << 12) | ((c & 63) << 6) | (d & 63);
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return new Uint8Array(out);
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
  // §1 常量
  //=====================================================================================

  const CONFIG_KEY = "YouTubeConfig"; // clientKey / encryptKey 缓存
  const QUALITY_KEY = "YouTubeQuality"; // 视频 id -> 可用 itag 缓存
  // 超过上限的响应直接放行：解码 / 重编码会占用数倍于原始大小的内存，宁可漏改也不能把 Loon 打崩。
  // 实测 player / browse 响应大多在 1 MiB 以内，8 MiB 已经留了很大余量。
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  // UMP 还要解密、解压、重编码、再加密，内存峰值更高，保持 5 MiB。
  const MAX_UMP_RESPONSE_BYTES = 5 * 1024 * 1024;
  const MAX_QUALITY_JSON = 65536; // 画质缓存序列化后的上限
  const MAX_QUALITY_ENTRIES = 16; // 画质缓存保留的视频数

  const textEncoder = new TextEncoder();
  const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

  // 用来在字节流里认东西的标记。
  const PREMIUM_UPSELL_MARKER = textEncoder.encode("PAyouchat");
  const AI_SUMMARY_MARKER = textEncoder.encode("ai_summary_");
  const PAGEAD_MARKER = textEncoder.encode("/pagead/");
  const MINI_GAME_MARKER = textEncoder.encode("mini_game_card.eml");
  const SHOPPING_LIST_MARKER = textEncoder.encode("shopping_item_card_list.eml");
  const STORE_TAB_MARKER = textEncoder.encode("store");
  const VERTICAL_LIVE_ICON = textEncoder.encode("youtube_outline_experimental/live_24pt");
  const IMMERSIVE_LIVE_MARKER = textEncoder.encode("immersive_live");
  const PREMIUM_TAB_MARKER = textEncoder.encode("SPunlimited");

  // 信息流里这些版式都是广告位。
  const FEED_AD_LAYOUT =
    /^(?:inline_injection_entrypoint_layout|video_display_button_group_layout|full_width_portrait_image_layout|full_width_square_image_layout|video_display_full_buttoned_layout)\.eml(?:-js)?(?:-fe)?$/;
  // 带货/商品版式。
  const SHOPPING_LAYOUT = /^(?:shopping_|products?_in_video_)[a-z0-9_]+\.eml(?:-js)?(?:-fe)?$/;

  // 会员专属徽章的文案，用来在列表里认出会员视频。
  const MEMBERS_ONLY_LABELS = [
    "Members only",
    "会员专享",
    "會員專享",
    "メンバー限定",
    "멤버 전용",
    "BADGE_MEMBERS_ONLY",
  ];

  // 侧栏/首页菜单项：值是可读别名，id 是 guide 响应里的 browseId。
  // home_menu 用别名或 browseId 都可以，多个用英文逗号分隔。
  const MENU_ITEMS = [
    { id: "FEwhat_to_watch", keys: ["home", "首页"] },
    { id: "FEshorts", keys: ["shorts"] },
    { id: "FEsubscriptions", keys: ["subscriptions", "subs", "订阅"] },
    { id: "FEexplore", keys: ["explore", "探索"] },
    { id: "FEtrending", keys: ["trending", "时下流行"] },
    { id: "FEuploads", keys: ["upload", "uploads", "上传"] },
    { id: "FEhistory", keys: ["history", "历史"] },
    { id: "FEplaylist_aggregation", keys: ["playlists", "playlist", "播放列表"] },
    { id: "FElibrary", keys: ["library", "媒体库"] },
    { id: "FEwatch_later", keys: ["watch_later", "later", "稍后观看"] },
    { id: "FEliked_videos", keys: ["liked", "likes", "喜欢的视频"] },
    { id: "FEmusic", keys: ["music", "音乐"] },
    { id: "FEdownloads", keys: ["downloads", "download", "下载"] },
  ];

  //=====================================================================================
  // §2 持久化
  //=====================================================================================

  // 读一个 JSON 对象；内容超长或解析失败都当成空对象。
  function readStore(key = CONFIG_KEY, maxLength = Infinity) {
    const raw = $persistentStore.read(key);
    if (typeof raw === "string" && raw.length > maxLength) return {};
    try {
      const value = JSON.parse(raw || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function writeStore(value, key = CONFIG_KEY) {
    return $persistentStore.write(JSON.stringify(value), key);
  }

  //=====================================================================================
  // §3 字节工具
  //
  // 拼接 / 比较 / varint 编码在 src/proto/wire.js，三端共用；
  // 这里保留 YouTube 专用的 base64、packed varint 与子串搜索。
  //=====================================================================================

  const concatBytes = wireConcat;
  const bytesEqual = wireEqual;
  const encodeVarint = wireEncodeVarint;

  // 解一个 varint 的数值（不带长度语义），溢出直接抛错。
  // 大多数值的长度不超过 4 字节，先走位运算快路径；超过后再用乘法累加。
  function readVarintValue(bytes) {
    let value = 0;
    let shift = 0;
    for (const byte of bytes) {
      if (shift < 28) value |= (127 & byte) << shift;
      else value += (127 & byte) * 2 ** shift;
      if (!(128 & byte)) {
        if (!Number.isSafeInteger(value)) throw new Error("Unsafe decoded integer");
        return value;
      }
      shift += 7;
      if (shift > 63) break;
    }
    throw new Error("Truncated varint");
  }

  // 解 packed repeated varint（proto3 默认把 repeated 数字字段打包成一个 bytes）。
  function decodePackedVarints(bytes) {
    const values = [];
    let offset = 0;
    while (offset < bytes.length) {
      let value = 0;
      let shift = 0;
      let byte;
      do {
        if (offset >= bytes.length) throw new Error("Truncated packed varint");
        byte = bytes[offset++];
        if (shift < 28) value |= (127 & byte) << shift;
        else value += (127 & byte) * 2 ** shift;
        shift += 7;
      } while (128 & byte);
      if (!Number.isSafeInteger(value)) throw new Error("Unsafe packed integer");
      values.push(value);
    }
    return values;
  }

  // YouTube 的 params 是 URL-safe base64，去掉填充后长度可能差一位。
  function base64ToBytes(text) {
    const normalized = text.replace(/[-_\s=]/g, (ch) => (ch === "-" ? "+" : ch === "_" ? "/" : ""));
    const needsPad = normalized.length % 4 === 1;
    const bytes = Uint8Array.fromBase64(needsPad ? normalized + "A" : normalized);
    return needsPad ? bytes.subarray(0, -1) : bytes;
  }

  // 在字节流里找一段子串。先顺序扫，命中太稀疏时切成两段再找，
  // 避免在超大响应上退化成 O(n*m)。
  function containsBytes(haystack, needle = PAGEAD_MARKER) {
    if (!needle.length) return true;
    const lastStart = haystack.length - needle.length;
    let probes = 0;
    let lastProbeAt = 0;
    for (let start = haystack.indexOf(needle[0]); start >= 0 && start <= lastStart; start = haystack.indexOf(needle[0], start + 1)) {
      let hit = true;
      for (let i = 1; i < needle.length; i++) {
        if (haystack[start + i] !== needle[i]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
      if (8 === ++probes) {
        // 连续 8 次没中且都挤在 256 字节内，说明这段是噪声，直接往后跳。
        if (start - lastProbeAt < 256) return containsBytesSlow(haystack, needle, start + 1);
        lastProbeAt = start;
        probes = 0;
      }
    }
    return false;
  }

  function containsBytesSlow(haystack, needle, from) {
    outer: for (let start = from; start <= haystack.length - needle.length; start++) {
      for (let i = 0; i < needle.length; i++) {
        if (haystack[start + i] !== needle[i]) continue outer;
      }
      return true;
    }
    return false;
  }

  function toBytes(value) {
    if (!value) return undefined;
    if (value instanceof Uint8Array) return value;
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === "string") {
      const out = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code > 255) return undefined;
        out[i] = code;
      }
      return out;
    }
    return undefined;
  }

  //=====================================================================================
  // §4 protobuf 基础
  //
  // 字段切分、varint 与字段编码在 src/proto/wire.js，三端共用。
  // 这里只做 YouTube 需要的路径查找、按字段替换与深度替换；
  // 未建模的字段原样保留，所以改不动的接口最多是不生效，不会把响应写坏。
  //=====================================================================================

  // 返回 [{ no, wire, data, raw }]，data 是字段值，raw 是含 tag 的整段字节。
  const parseFields = wireParseFields;

  // 取第一个（或最后一个）指定字段的值。
  function fieldData(bytes, fieldNo, last = false) {
    let found;
    for (const field of parseFields(bytes)) {
      if (field.no === fieldNo && 2 === field.wire) {
        if (!last) return field.data;
        if (found) return;
        found = field.data;
      }
    }
    return found;
  }

  // 按字段号逐层往下钻，任意一层缺失就返回 undefined。
  function descendPath(bytes, path) {
    let current = bytes;
    for (const fieldNo of path) {
      current = fieldData(current, fieldNo, true);
      if (!current) return;
    }
    return current;
  }

  // 把值编码成单字段：number -> uint，string -> string，其余按 bytes。
  function encodeScalarField(fieldNo, value) {
    const kind = "number" == typeof value ? "uint" : "string" == typeof value ? "string" : "bytes";
    return encodeField([fieldNo, "", kind], value);
  }

  // 从里往外套：D([1,2,3], v) 等价于 field 1 { field 2 { field 3 = v } }。
  function encodePathValue(path, value) {
    for (let i = path.length - 1; i >= 0; i--) value = encodeScalarField(path[i], value);
    return value;
  }

  function encodeField(spec, value) {
    const [fieldNo, , kind] = spec;
    const wireType = "bool" === kind || "uint" === kind ? 0 : 2;
    const encoded =
      "bytes" === kind
        ? value
        : "string" === kind
          ? textEncoder.encode(value)
          : "bool" === kind
            ? encodeVarint(value ? 1 : 0)
            : "uint" === kind
              ? encodeVarint(value)
              : encodeMessage(kind, value);
    return concatBytes(
      2 === wireType ? [encodeVarint(8 * fieldNo + wireType), encodeVarint(encoded.length), encoded] : [encodeVarint(8 * fieldNo), encoded],
    );
  }

  // 把一组数字编码成 packed repeated 字段（wire type 2）。
  function encodePackedField(spec, values) {
    const [fieldNo, , kind] = spec;
    const payload = concatBytes(values.map((value) => encodeVarint("bool" === kind ? (value ? 1 : 0) : value)));
    return concatBytes([encodeVarint(8 * fieldNo + 2), encodeVarint(payload.length), payload]);
  }

  // 判断某条嵌套路径上的最后一个值是否等于 marker（prefixOnly 时只比前缀）。
  function matchesPath(bytes, path, marker = PAGEAD_MARKER, prefixOnly = false) {
    return path.length
      ? parseFields(bytes).some((field) => field.no === path[0] && 2 === field.wire && matchesPath(field.data, path.slice(1), marker, prefixOnly))
      : bytesEqual(prefixOnly ? bytes.subarray(0, marker.length) : bytes, marker);
  }

  // 对某个字段的每个出现位置跑一次 rewriter，返回 undefined 表示整条删掉。
  function rewriteRepeatedField(bytes, fieldNo, rewriter) {
    let changed = false;
    const parts = parseFields(bytes).flatMap((field) => {
      if (field.no !== fieldNo || 2 !== field.wire) return [field.raw];
      const next = rewriter(field.data);
      return next && bytesEqual(next, field.data) ? [field.raw] : ((changed = true), next ? [encodeField([fieldNo, "", "bytes"], next)] : []);
    });
    return changed ? concatBytes(parts) : bytes;
  }

  // 按路径下钻，对命中位置的字节跑 rewriter。
  function rewritePath(bytes, path, rewriter) {
    if (!path.length) return rewriter(bytes);
    let changed = false;
    const parts = parseFields(bytes).map((field) => {
      if (field.no !== path[0] || 2 !== field.wire) return field.raw;
      const next = rewritePath(field.data, path.slice(1), rewriter);
      return bytesEqual(next, field.data) ? field.raw : ((changed = true), encodeField([field.no, "", "bytes"], next));
    });
    return changed ? concatBytes(parts) : bytes;
  }

  // 判断请求是不是 YouTube Music（iOS App 的 UA / client-name 都带 music）。
  function isMusicRequest(request) {
    if (/^https?:\/\/music\.youtube\.com\//i.test(String(request?.url ?? ""))) return true;
    for (const [key, value] of Object.entries(request?.headers ?? {})) {
      const name = key.toLowerCase();
      const text = String(value ?? "");
      if ("user-agent" === name && /music/i.test(text)) return true;
      // WEB_REMIX（YouTube Music Web/iOS 的 InnerTube 客户端）的 client-name 是 67。
      if ("x-youtube-client-name" === name && ("67" === text.trim() || /music|remix/i.test(text))) return true;
      if ("x-youtube-client-version" === name && /music|remix/i.test(text)) return true;
    }
    return false;
  }

  // 网页版 YouTube / YouTube Music。移动网页最终也会落到 www.youtube.com。
  function isWebRequest(request) {
    return /^https?:\/\/(?:www|m|music)\.youtube\.com\//i.test(String(request?.url ?? ""));
  }

  function clientKeyFor(request) {
    return isMusicRequest(request) ? "youtubeMusic" : "youtube";
  }

  function isQualityEntry(entry) {
    return !!(
      entry &&
      "object" == typeof entry &&
      !Array.isArray(entry) &&
      Number.isInteger(entry.height) &&
      entry.height > 0 &&
      entry.height <= 2147483647 &&
      Array.isArray(entry.itags) &&
      entry.itags.length > 0 &&
      entry.itags.length <= 256 &&
      entry.itags.every((itag) => Number.isInteger(itag) && itag > 0 && itag <= 4294967295) &&
      new Set(entry.itags).size === entry.itags.length &&
      (void 0 === entry.premiumItags ||
        (Array.isArray(entry.premiumItags) &&
          entry.premiumItags.length <= entry.itags.length &&
          new Set(entry.premiumItags).size === entry.premiumItags.length &&
          entry.premiumItags.every((itag) => entry.itags.includes(itag))))
    );
  }

  function sameQuality(left, right) {
    return (
      void 0 !== left &&
      left.height === right.height &&
      left.itags.length === right.itags.length &&
      right.itags.every((itag) => left.itags.includes(itag)) &&
      (left.premiumItags?.length ?? 0) === (right.premiumItags?.length ?? 0) &&
      (right.premiumItags ?? []).every((itag) => left.premiumItags?.includes(itag))
    );
  }

  //=====================================================================================
  // §5 选项
  //
  // Loon 传 snake_case 对象，Egern 传 camelCase JSON 字符串，这里统一成 camelCase。
  //=====================================================================================

  const ARG_ALIASES = {
    block_ads: "blockAds",
    block_ai: "blockAi",
    max_height: "maxHeight",
    caption_lang: "captionLang",
    home_menu: "homeMenu",
    block_shorts_feed: "blockShortsFeed",
    youtube_music: "youtubeMusic",
    block_members_only: "blockMembersOnly",
    home_cleanup: "homeCleanup",
    jump_ahead: "jumpAhead",
    max_speed: "maxSpeed",
    web: "web",
  };

  // 旧版插件的 26 个参数顺序。Loon 旧版按位置传数组时用它还原；
  // 新版按参数名传对象，不受影响。
  // onTheGo / onTheGoAudio / onTheGoChapters 已移除，保留占位是为了旧位置数组不串位。
  const LEGACY_ARG_ORDER = [
    "blockUpload",
    "blockShorts",
    "blockShortsFeed",
    "blockMembersOnly",
    "autoHd",
    "blockGames",
    "blockVerticalLive",
    "jumpAhead",
    "blockStore",
    "blockAi",
    "onTheGo",
    "backgroundPlay",
    "pip",
    "maxSpeed",
    "hidePremium",
    "preferPremium",
    "maxHeight",
    "blockPlayerAds",
    "blockFeedAds",
    "blockShortsAds",
    "removePaidPromotion",
    "blockAdTracking",
    "blockGuideItems",
    "onTheGoAudio",
    "onTheGoChapters",
    "stripHotHash",
  ];

  // 当前 Loon 位置数组（12 项，最后一项是 web）。web 是布尔值；
  // 上一版 12 项数组的最后一项是 max_speed 字符串，用这个区分新旧 tuple。
  const CURRENT_ARG_ORDER = [
    "block_ads",
    "block_ai",
    "max_height",
    "caption_lang",
    "home_menu",
    "block_shorts_feed",
    "youtube_music",
    "block_members_only",
    "home_cleanup",
    "jump_ahead",
    "max_speed",
    "web",
  ];

  // 上一版 Loon 位置数组（12 项，含 on_the_go）。升级插件前客户端可能还缓存着
  // 旧 tuple；按长度和最后一项类型区分，避免把旧数组当成新数组。
  const PREV_ARG_ORDER = [
    "block_ads",
    "block_ai",
    "max_height",
    "caption_lang",
    "home_menu",
    "block_shorts_feed",
    "on_the_go",
    "youtube_music",
    "block_members_only",
    "home_cleanup",
    "jump_ahead",
    "max_speed",
  ];

  // Loon 传 snake_case 对象或位置数组，Egern 传 JSON 字符串，这里统一成普通对象。
  function readArgument() {
    let raw = typeof $argument !== "undefined" ? $argument : undefined;
    if ("string" == typeof raw) {
      if (raw.includes("{{{")) return {};
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        return {};
      }
    }
    if (Array.isArray(raw)) {
      const out = {};
      const order =
        raw.length === LEGACY_ARG_ORDER.length
          ? LEGACY_ARG_ORDER
          : raw.length === PREV_ARG_ORDER.length && "string" == typeof raw[raw.length - 1]
            ? PREV_ARG_ORDER
            : raw.length === CURRENT_ARG_ORDER.length
              ? CURRENT_ARG_ORDER
              : Object.keys(ARG_ALIASES);
      order.forEach((key, index) => {
        if (index < raw.length) out[key] = raw[index];
      });
      return out;
    }
    return raw && "object" == typeof raw ? raw : {};
  }

  // 参数可能来自 Loon（boolean）或 Egern（字符串 "true"/"false"），统一成布尔值。
  function asBool(value, fallback = true) {
    if (void 0 === value || null === value || "" === value) return fallback;
    if (false === value || 0 === value) return false;
    if (true === value) return true;
    const text = String(value).trim().toLowerCase();
    if ("false" === text || "0" === text || "off" === text || "no" === text) return false;
    if ("true" === text || "1" === text || "on" === text || "yes" === text) return true;
    return fallback;
  }

  // 把 home_menu 里的一个 token 归一成 { hide, id }；认不出就返回 undefined。
  function menuToken(token) {
    const text = String(token ?? "").trim();
    if (!text) return undefined;

    const hide = text.startsWith("-") || text.startsWith("!");
    const name = (hide ? text.slice(1) : text).trim().toLowerCase();
    if (!name) return undefined;

    const item = MENU_ITEMS.find((entry) => entry.id.toLowerCase() === name || entry.keys.some((key) => key.toLowerCase() === name));
    if (item) return { hide, id: item.id };
    // 也允许直接写 browseId；只接受像 ID 的字符串，避免把说明文字当成入口。
    if (/^[a-z0-9_]+$/i.test(name)) return { hide, id: name };
    return undefined;
  }

  // home_menu 语义：
  //   空              -> 旧默认：只隐藏上传
  //   all             -> 全部保留
  //   none            -> 全部隐藏
  //   upload,shorts   -> 只保留这两项
  //   -shorts         -> 保留全部，只隐藏 Shorts
  //   all,-shorts     -> 保留全部，但隐藏 Shorts
  // 以 - 或 ! 开头的 token 表示隐藏；其余表示保留。
  function resolveHiddenMenu(value, blockAds) {
    const hidden = new Set();
    const tokens = String(value ?? "")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    if (!tokens.length) {
      hidden.add("FEuploads");
    } else {
      const keep = new Set();
      const extraHide = new Set();
      let keepAll = false;
      let hideAll = false;

      for (const token of tokens) {
        const lower = token.toLowerCase();
        if ("all" === lower) {
          keepAll = true;
          continue;
        }
        if ("none" === lower) {
          hideAll = true;
          continue;
        }
        const parsed = menuToken(token);
        if (!parsed) continue;
        (parsed.hide ? extraHide : keep).add(parsed.id);
      }

      if (hideAll) {
        for (const item of MENU_ITEMS) hidden.add(item.id);
      } else if (!keepAll && keep.size) {
        for (const item of MENU_ITEMS) if (!keep.has(item.id)) hidden.add(item.id);
      }
      for (const id of extraHide) hidden.add(id);
    }

    if (blockAds) hidden.add("SPunlimited");
    return [...hidden];
  }

  // 同一次脚本执行里 options 可能被 applyQuality / 广告过滤 / 画质缓存反复读取：
  // 参数解析（读 env、展开默认值、计算隐藏菜单）只做一次。
  let OPTIONS_CACHE = null;

  function readOptions(defaults = {}) {
    const noDefaults = !defaults || !Object.keys(defaults).length;
    if (noDefaults && OPTIONS_CACHE) return OPTIONS_CACHE;
    const raw = readArgument();
    const options = raw && "object" == typeof raw ? { ...raw } : {};
    for (const snakeKey in ARG_ALIASES) {
      if (void 0 !== options[snakeKey] && void 0 === options[ARG_ALIASES[snakeKey]]) {
        options[ARG_ALIASES[snakeKey]] = options[snakeKey];
      }
    }

    // 广告总开关：播放器 / 信息流 / Shorts / 付费推广 / 广告追踪 / Premium 推广 / 创作者商店。
    const blockAds = asBool(options.blockAds, true);
    options.blockAds = blockAds;
    options.blockPlayerAds = blockAds;
    options.blockFeedAds = blockAds;
    options.blockShortsAds = blockAds;
    options.removePaidPromotion = blockAds;
    options.blockAdTracking = blockAds;
    options.hidePremium = blockAds;

    // 默认分辨率：max / 4320 / 2160 / ... / off。off 表示完全不改画质。
    if (void 0 === options.maxHeight && void 0 !== options.autoHd && !asBool(options.autoHd, true)) {
      options.maxHeight = "off";
    }
    const height = String(options.maxHeight ?? "max").toLowerCase();
    if ("off" === height || "false" === height) {
      options.autoHd = false;
      options.maxHeight = 4320;
    } else {
      const parsed = parseInt(height, 10);
      options.autoHd = true;
      options.maxHeight = "max" === height || !Number.isFinite(parsed) ? 4320 : Math.max(144, Math.min(4320, parsed));
    }
    options.preferPremium = true;

    // 这些是系统设置里能开的，脚本直接常开，不再单独给开关。
    options.backgroundPlay = true;
    options.pip = true;
    options.stripHotHash = true;

    // 首页清理：off 全关，standard 只清 Playables，all 再加竖屏直播。
    // 创作者商店/商品卡属于付费推广，跟随 blockAds。
    let cleanup = String(options.homeCleanup ?? "").toLowerCase();
    if (!cleanup) {
      const games = void 0 === options.blockGames ? true : asBool(options.blockGames, true);
      const vertical = void 0 !== options.blockVerticalLive && asBool(options.blockVerticalLive, false);
      cleanup = vertical ? "all" : games ? "standard" : "off";
    }
    options.blockStore = blockAds;
    options.blockGames = "off" !== cleanup;
    options.blockVerticalLive = "all" === cleanup;

    // 旧版参数没有 home_menu，用 block_upload / block_shorts / block_guide_items 还原。
    if (void 0 === options.homeMenu) {
      const tokens = [];
      if (void 0 === options.blockUpload || asBool(options.blockUpload, true)) tokens.push("-FEuploads");
      if (void 0 !== options.blockShorts && asBool(options.blockShorts, false)) tokens.push("-FEshorts");
      options.homeMenu = tokens.length ? tokens.join(",") : "all";
    }
    if (options.blockGuideItems) {
      const extra = String(options.blockGuideItems)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (extra.length) options.homeMenu = [options.homeMenu, ...extra.map((item) => `-${item}`)].filter(Boolean).join(",");
    }

    options.hiddenGuideItems = resolveHiddenMenu(options.homeMenu, blockAds);

    const speed = String(options.maxSpeed ?? "4").toLowerCase();
    options.maxSpeed = "off" === speed || false === options.maxSpeed ? false : Math.max(2, Math.min(4, parseInt(speed) || 4));

    const caption = String(options.captionLang ?? "zh-Hans").trim();
    options.captionLang = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/i.test(caption) ? caption : "off";

    options.blockAi = asBool(options.blockAi, true);
    // 这两项插件默认关闭，参数缺失时不能按「非 false 即 true」处理。
    options.blockShortsFeed = asBool(options.blockShortsFeed, false);
    options.blockMembersOnly = asBool(options.blockMembersOnly, false);
    options.jumpAhead = asBool(options.jumpAhead, true);
    options.youtubeMusic = asBool(options.youtubeMusic, true);
    // 网页版 YouTube / YouTube Music 的 JSON 响应处理，默认开启。
    options.web = asBool(options.web, true);

    const result = { ...defaults, ...options };
    if (noDefaults) OPTIONS_CACHE = result;
    return result;
  }

  //=====================================================================================
  // §6 schema
  //
  // 每条是 [字段号, JS 属性名, 值类型, 是否数组]：
  //   值类型是 "string" / "bytes" / "bool" / "uint" 时是标量，
  //   否则是 §6 里另一个消息类型名，按嵌套消息处理。
  //=====================================================================================

  const SCHEMA = {
    Browse: [
      [9, "content", "BrowseContent"],
      [10, "onResponseReceivedAction", "BrowseContent"],
    ],
    BrowseContent: [
      [58173949, "singleColumnResultsRenderer", "SingleColumnResultsRenderer"],
      [52123031, "twoColumnBrowseResultsRenderer", "TwoColumnBrowseResultsRenderer"],
      [255072793, "richGridRenderer", "RichGridRenderer"],
      [153515154, "elementRenderer", "ElementRenderer"],
      [49399797, "sectionListRenderer", "SectionListRenderer"],
    ],
    TwoColumnBrowseResultsRenderer: [[3, "tabs", "BrowseTabSupportedRenderer", true]],
    RichGridRenderer: [[1, "richItemContents", "RichItemContent", true]],
    SingleColumnResultsRenderer: [[1, "tabs", "BrowseTabSupportedRenderer", true]],
    BrowseTabSupportedRenderer: [[58174010, "tabRenderer", "TabRenderer"]],
    TabRenderer: [
      [1, "endpoint", "TabEndpoint"],
      [4, "content", "BrowseContent"],
    ],
    TabEndpoint: [[48687626, "browse", "TabBrowseEndpoint"]],
    TabBrowseEndpoint: [[3, "params", "string"]],
    ElementRenderer: [[172660663, "videoRendererContent", "VideoRendererContent"]],
    VideoRendererContent: [
      [1, "richItemContents", "VideoInfo", true],
      [2, "renderInfo", "RenderInfo"],
    ],
    VideoInfo: [[168777401, "videoContext", "VideoContext"]],
    VideoContext: [
      [3, "layout", "ElementLayout"],
      [5, "videoContent", "VideoContent"],
    ],
    ElementLayout: [[172035250, "layoutRender", "LayoutRender"]],
    VideoContent: [
      [413471385, "element", "ElementModel"],
      [512694658, "smartSkipButton", "SmartSkipButton"],
      [232954548, "videoLockup", "VideoLockup"],
      [454362329, "sponsoredVideo", "bytes"],
      [491441836, "sponsoredDisplay", "bytes"],
    ],
    ElementModel: [[1, "data", "ElementData"]],
    ElementData: [[1829, "shoppingShelf", "bytes"]],
    SmartSkipButton: [
      [1, "actions", "SmartSkipActions"],
      [13, "controller", "SmartSkipController"],
      [17, "displayLimit", "uint"],
    ],
    SmartSkipActions: [[3, "items", "SmartSkipAction", true]],
    SmartSkipAction: [[9, "displayLimit", "uint"]],
    SmartSkipController: [[7, "promotionMode", "bool"]],
    VideoLockup: [
      [33, "attachments", "Attachment", true],
      [34, "attachmentStateKey", "bytes"],
    ],
    Attachment: [[9, "products", "bytes", true]],
    RenderInfo: [[183314536, "layoutRender", "LayoutRender"]],
    LayoutRender: [[1, "eml", "string"]],
    SectionListRenderer: [
      [1, "sectionListSupportedRenderers", "SectionListSupportedRenderer", true],
      [32, "promotedContents", "bytes", true],
    ],
    SectionListSupportedRenderer: [
      [50195462, "itemSectionRenderer", "ItemSectionRenderer"],
      [51845067, "shelfRenderer", "ShelfRenderer"],
    ],
    ItemSectionRenderer: [[1, "richItemContents", "RichItemContent", true]],
    RichItemContent: [[153515154, "videoWithContextRenderer", "ElementRenderer"]],
    ShelfRenderer: [[5, "richSectionContent", "RichSectionContent"]],
    RichSectionContent: [[51431404, "reelShelfRenderer", "ReelShelfRenderer"]],
    ReelShelfRenderer: [[1, "richItemContents", "RichItemContent", true]],
    Next: [
      [7, "content", "NextContent"],
      [8, "onResponseReceivedAction", "BrowseContent"],
      [14, "playerOverlays", "PlayerOverlays"],
      [25, "engagementPanels", "EngagementPanel", true],
      [777, "frameworkUpdates", "bytes"],
    ],
    EngagementPanel: [[138681066, "renderer", "EngagementPanelRenderer"]],
    EngagementPanelRenderer: [[3, "content", "BrowseContent"]],
    NextContent: [[51779735, "nextResult", "NextResult"]],
    NextResult: [[1, "content", "BrowseContent"]],
    PlayerOverlays: [[78882851, "renderer", "PlayerOverlayRenderer"]],
    PlayerOverlayRenderer: [
      [2, "overflowMenu", "bytes"],
      [3, "related", "RelatedOverlay"],
      [42, "overlayCollections", "OverlayCollection", true],
    ],
    OverlayCollection: [[401855120, "renderer", "OverlayCollectionRenderer"]],
    OverlayCollectionRenderer: [[2, "overlays", "OverlayItem", true]],
    OverlayItem: [[401855122, "content", "OverlayContent"]],
    OverlayContent: [[1, "item", "RichItemContent"]],
    RelatedOverlay: [[29209665, "contents", "RelatedOverlayContents"]],
    RelatedOverlayContents: [[2, "contents", "RichItemContent", true]],
    Player: [
      [15, "playerConfig", "PlayerConfig"],
      [60, "overlayCollections", "OverlayCollection", true],
      [61, "paidPromotion", "bytes"],
      [7, "adPlacements", "bytes", true],
      [2, "playabilityStatus", "PlayabilityStatus"],
      [9, "playbackTracking", "PlaybackTracking"],
      [68, "adSlots", "bytes", true],
      [10, "captions", "Captions"],
    ],
    Captions: [[51621377, "playerCaptionsTrackListRenderer", "PlayerCaptionsTrackListRenderer"]],
    PlayerCaptionsTrackListRenderer: [
      [1, "captionTracks", "CaptionTrack", true],
      [2, "audioTracks", "AudioTrack", true],
      [3, "translationLanguages", "TranslationLanguage", true],
      [4, "defaultAudioTrackIndex", "uint"],
      [6, "defaultCaptionTrackIndex", "uint"],
    ],
    CaptionTrack: [
      [1, "baseUrl", "string"],
      [2, "name", "Text"],
      [3, "vssId", "string"],
      [4, "languageCode", "string"],
      [5, "kind", "string"],
      [6, "rtl", "bool"],
      [7, "isTranslatable", "bool"],
    ],
    Text: [[1, "runs", "TextRun", true]],
    TextRun: [[1, "text", "string"]],
    AudioTrack: [
      [2, "captionTrackIndices", "uint", true],
      [3, "defaultCaptionTrackIndex", "uint"],
      [4, "forcedCaptionTrackIndex", "uint"],
      [5, "visibility", "uint"],
      [6, "hasDefaultTrack", "bool"],
      [7, "hasForcedTrack", "bool"],
      [8, "audioTrackId", "string"],
      [11, "captionsInitialState", "uint"],
    ],
    TranslationLanguage: [
      [1, "languageCode", "string"],
      [2, "languageName", "Text"],
    ],
    PlayerConfig: [[1, "granularVariableSpeedConfig", "PlaybackSpeedConfig"]],
    PlaybackSpeedConfig: [
      [1, "minimumPlaybackRate", "uint"],
      [2, "maximumPlaybackRate", "uint"],
    ],
    PlayabilityStatus: [
      [21, "pictureInPictureRender", "PictureInPictureSupportedRenderer"],
      [11, "backgroundPlayerRender", "BackgroundSupportedRenderer"],
    ],
    PictureInPictureSupportedRenderer: [[151635310, "pictureInPictureAbility", "PictureInPictureAbility"]],
    PictureInPictureAbility: [
      [1, "active", "bool"],
      [4, "f4", "uint"],
      [6, "f6", "uint"],
      [8, "f8", "uint"],
    ],
    BackgroundSupportedRenderer: [[64657230, "backgroundAbility", "BackgroundAbility"]],
    BackgroundAbility: [[1, "active", "bool"]],
    PlaybackTracking: [[18, "pageadViewthroughconversion", "bytes"]],
    Search: [
      [4, "content", "BrowseContent"],
      [7, "onResponseReceivedCommand", "OnResponseReceivedCommand"],
    ],
    OnResponseReceivedCommand: [
      [50195462, "itemSectionRenderer", "ItemSectionRenderer"],
      [49399797, "appendContinuationItemsAction", "SectionListRenderer"],
    ],
    Shorts: [[2, "entries", "Entry", true]],
    Entry: [[1, "command", "Command"]],
    Command: [[139608561, "reelWatchEndpoint", "ReelWatchEndpoint"]],
    ReelWatchEndpoint: [[16, "adClientParams", "AdClientParams"]],
    AdClientParams: [[1, "isAd", "bool"]],
    Guide: [
      [4, "labelItems", "GuideItem", true],
      [6, "iconItems", "GuideItem", true],
    ],
    GuideItem: [[117866661, "guideSectionRenderer", "GuideSectionRenderer"]],
    GuideSectionRenderer: [[1, "rendererItems", "RendererItem", true]],
    RendererItem: [
      [318370163, "iconRender", "guideEntryRenderer"],
      [117501096, "labelRender", "guideEntryRenderer"],
    ],
    guideEntryRenderer: [[1, "browseId", "string"]],
    Setting: [
      [6, "settingItems", "SettingItem", true],
      [7, "collectionItems", "SettingItem", true],
    ],
    SettingItem: [
      [88478200, "backgroundPlayBackSettingRenderer", "BackgroundPlayBackSettingRenderer"],
      [66930374, "settingCategoryCollectionRenderer", "SettingCategoryCollectionRenderer"],
    ],
    BackgroundPlayBackSettingRenderer: [
      [2, "backgroundPlayback", "bool"],
      [14, "icon", "Icon"],
    ],
    Icon: [[1, "iconType", "uint"]],
    SettingCategoryCollectionRenderer: [
      [3, "subSettings", "SubSetting", true],
      [4, "categoryId", "uint"],
    ],
    SubSetting: [[61331416, "settingBooleanRenderer", "SettingBooleanRenderer"]],
    SettingBooleanRenderer: [
      [5, "enableServiceEndpoint", "ServiceEndpoint"],
      [6, "disableServiceEndpoint", "ServiceEndpoint"],
      [15, "itemId", "uint"],
    ],
    ServiceEndpoint: [[81212182, "setClientSettingEndpoint", "SetClientSettingEndpoint"]],
    SetClientSettingEndpoint: [[1, "settingData", "SettingData"]],
    SettingData: [
      [1, "clientSettingEnum", "ClientSettingEnum"],
      [3, "boolValue", "bool"],
    ],
    ClientSettingEnum: [[1, "item", "uint"]],
    Watch: [[1, "contents", "WatchContent", true]],
    ResolveUrl: [[2, "endpoint", "NavigationEndpoint"]],
    NavigationEndpoint: [[48687757, "watch", "NavigationWatch"]],
    NavigationWatch: [[68146959, "embedded", "EmbeddedPlayer"]],
    EmbeddedPlayer: [[68202535, "response", "EmbeddedPlayerBody"]],
    EmbeddedPlayerBody: [[1, "player", "Player"]],
    WatchContent: [
      [2, "player", "Player"],
      [3, "next", "Next"],
    ],
    // 只有 UMP 会用到
    EncryptedResponsePart: [
      [1, "encryptedContent", "bytes"],
      [2, "hmac", "bytes"],
      [3, "iv", "bytes"],
      [4, "compressionAlgorithm", "uint"],
    ],
    OnesieInnertubeResponse: [[4, "contents", "WatchContent", true]],
  };

  // 惰性解码的例外表：列在这里的类型即使作为子消息出现也立刻展开。
  // 遍历器要看到这些节点内部的广告字段，不能等到真正读取时才展开。
  //
  // 这两个入口是两份略有差异的表，这里原样保留，避免改变遍历深度：
  // youtubei 响应多出 Browse / EmbeddedPlayer / NavigationEndpoint 等入口类型，
  // UMP 响应多出 OnesieInnertubeResponse。
  const EAGER_TYPES = {
    youtubei: new Set([
      "Browse",
      "BrowseContent",
      "TwoColumnBrowseResultsRenderer",
      "RichGridRenderer",
      "BrowseTabSupportedRenderer",
      "ElementRenderer",
      "EmbeddedPlayer",
      "EmbeddedPlayerBody",
      "EngagementPanel",
      "EngagementPanelRenderer",
      "ItemSectionRenderer",
      "NavigationEndpoint",
      "NavigationWatch",
      "Next",
      "NextContent",
      "NextResult",
      "OnResponseReceivedCommand",
      "OverlayCollection",
      "OverlayCollectionRenderer",
      "OverlayContent",
      "OverlayItem",
      "Player",
      "PlayerOverlayRenderer",
      "PlayerOverlays",
      "ReelShelfRenderer",
      "RelatedOverlay",
      "RelatedOverlayContents",
      "ResolveUrl",
      "RichItemContent",
      "RichSectionContent",
      "Search",
      "SectionListRenderer",
      "SectionListSupportedRenderer",
      "ShelfRenderer",
      "SingleColumnResultsRenderer",
      "TabRenderer",
      "VideoContent",
      "VideoContext",
      "VideoInfo",
      "VideoLockup",
      "VideoRendererContent",
      "Watch",
      "WatchContent",
    ]),
    ump: new Set([
      "BrowseContent",
      "TwoColumnBrowseResultsRenderer",
      "RichGridRenderer",
      "BrowseTabSupportedRenderer",
      "ElementRenderer",
      "EngagementPanel",
      "EngagementPanelRenderer",
      "ItemSectionRenderer",
      "Next",
      "NextContent",
      "NextResult",
      "OnesieInnertubeResponse",
      "OverlayCollection",
      "OverlayCollectionRenderer",
      "OverlayContent",
      "OverlayItem",
      "Player",
      "PlayerOverlayRenderer",
      "PlayerOverlays",
      "ReelShelfRenderer",
      "RelatedOverlay",
      "RelatedOverlayContents",
      "RichItemContent",
      "RichSectionContent",
      "SectionListRenderer",
      "SectionListSupportedRenderer",
      "ShelfRenderer",
      "SingleColumnResultsRenderer",
      "TabRenderer",
      "VideoContent",
      "VideoContext",
      "VideoInfo",
      "VideoLockup",
      "VideoRendererContent",
      "WatchContent",
    ]),
  };

  //=====================================================================================
  // §7 惰性解码与重编码
  //
  // 解码时不复制整棵消息树：只把字段列表挂在对象上，子消息等真正被读到才展开。
  // 改写时在对象上记 changed，重编码只重写变过的字段，其余字节原样拼回去。
  //=====================================================================================

  const WIRE_STATE = Symbol("wireState");
  const NO_FIELDS = [];

  function markChanged(state, fieldName) {
    for (; state; ) {
      (state.changed ??= new Set()).add(fieldName);
      fieldName = state.parentName;
      state = state.parent;
    }
  }

  function setField(obj, key, value) {
    const previous = obj[key];
    const unchanged =
      Array.isArray(previous) && Array.isArray(value)
        ? previous.length === value.length && previous.every((item, i) => item === value[i])
        : previous === value;
    if (unchanged) return false;
    obj[key] = value;
    if (obj[WIRE_STATE]) markChanged(obj[WIRE_STATE], key);
    return true;
  }

  function deleteField(obj, key) {
    if (void 0 === obj[key]) return false;
    delete obj[key];
    if (obj[WIRE_STATE]) markChanged(obj[WIRE_STATE], key);
    return true;
  }

  // 按 schema 把字节解成对象。depth 超过 64 层视为异常响应。
  // eager 决定哪些子类型立即展开，其余挂 getter 等第一次读取。
  function decodeMessage(typeName, bytes, depth = 0, parentState, parentName, eager = EAGER_TYPES.youtubei) {
    if (depth > 64) throw new Error("Protobuf nesting limit");

    const obj = {};
    const fields = parseFields(bytes);
    const repeatedCount = fields.length > 1 ? new Map() : null;
    const state = { bytes, fields, parent: parentState, parentName, eager };
    const specsByNo = (SPEC_CACHE[typeName] ??= new Map(SCHEMA[typeName].map((spec) => [spec[0], spec])));

    Object.defineProperty(obj, WIRE_STATE, { value: state });
    for (const [, name, , repeated] of SCHEMA[typeName]) if (repeated) obj[name] = [];

    // 先给每个字段挂上 spec，并统计同名字段出现次数。
    if (repeatedCount) {
      for (const field of fields) {
        const spec = specsByNo.get(field.no);
        if (spec && (field.wire === wireTypeOf(spec[2]) || isPackedNumeric(spec, field))) {
          field.spec = spec;
          if (!spec[3]) repeatedCount.set(spec[1], (repeatedCount.get(spec[1]) ?? 0) + 1);
        }
      }
    }

    let deferredNames;
    for (const field of fields) {
      const spec = repeatedCount ? field.spec : specsByNo.get(field.no);
      if (!spec || (field.wire !== wireTypeOf(spec[2]) && !isPackedNumeric(spec, field))) continue;
      field.spec = spec;

      const [, name, valueType, repeated] = spec;
      if (isPackedNumeric(spec, field)) {
        let values;
        try {
          values = decodePackedVarints(field.data);
        } catch (e) {
          // 不是合法 packed 数据时按未知字段原样保留，避免整条响应改写失败。
          delete field.spec;
          continue;
        }
        for (const value of values) obj[name].push("bool" === valueType ? 0 !== value : value);
        continue;
      }
      if (!repeated && (repeatedCount?.get(name) ?? 0) > 1) {
        delete field.spec;
        continue;
      }
      if (SCHEMA[valueType] && !eager.has(valueType)) {
        // 同一名字段只挂一个 getter，第一次读时才真正展开。
        if (deferredNames?.has(name)) continue;
        (deferredNames ??= new Set()).add(name);
        const group = fields.filter((item) => item.spec?.[1] === name);
        state.type = typeName;
        state.deferred = true;
        Object.defineProperty(obj, name, {
          enumerable: true,
          configurable: true,
          get() {
            const value = repeated ? group.map((item) => readFieldValue(item, depth, state, eager)) : readFieldValue(group[0], depth, state, eager);
            Object.defineProperty(obj, name, { value, enumerable: true, writable: true, configurable: true });
            return value;
          },
        });
      } else {
        const value = readFieldValue(field, depth, state, eager);
        if (repeated) obj[name].push(value);
        else obj[name] = value;
      }
    }
    return obj;
  }

  function wireTypeOf(valueType) {
    return "bool" === valueType || "uint" === valueType ? 0 : 2;
  }

  // proto3 的 repeated 数字字段默认 packed（wire type 2），解码时要当成一串 varint。
  function isPackedNumeric(spec, field) {
    return !!spec[3] && 2 === field.wire && ("uint" === spec[2] || "bool" === spec[2]);
  }

  function readFieldValue(field, depth, state, eager) {
    const [, name, valueType] = field.spec;
    if ("bytes" === valueType) return field.data;
    if ("string" === valueType) return strictUtf8.decode(field.data);
    if ("bool" === valueType) return 0 !== readVarintValue(field.data);
    if ("uint" === valueType) return readVarintValue(field.data);
    return decodeMessage(valueType, field.data, depth + 1, state, name, eager);
  }

  // 按 schema 把对象写回字节。没有改动时直接返回原始字节。
  function encodeMessage(typeName, obj) {
    const state = obj[WIRE_STATE];
    if (state && !state.changed) return state.bytes;

    const parts = [];
    const repeatedPool = new Map();
    const written = new Set();
    const numericWritten = new Set();
    const rawOf = (value, valueType) => (SCHEMA[valueType] ? (value[WIRE_STATE]?.bytes ?? value) : value);
    const valuesOf = (spec) => {
      const [, name, , repeated] = spec;
      return repeated ? (obj[name] ?? []) : void 0 === obj[name] ? [] : [obj[name]];
    };

    // 数组字段：先把改动过的元素按原始字节做一次索引，重写时按原顺序取。
    // 数字数组单独处理（可能 packed），不放进这个索引。
    for (const spec of SCHEMA[typeName]) {
      const [, name, valueType, repeated] = spec;
      if (repeated && state?.changed?.has(name) && "uint" !== valueType && "bool" !== valueType) {
        repeatedPool.set(name, new Map(valuesOf(spec).map((value) => [rawOf(value, valueType), value])));
      }
    }

    for (const field of state?.fields ?? []) {
      if (!field.spec || !state.changed.has(field.spec[1])) {
        parts.push(field.raw);
        continue;
      }
      const [, name, valueType, repeated] = field.spec;
      written.add(name);

      // repeated 数字字段可能是 packed 或 unpacked：整体按原形式重写一次，避免逐条对不上。
      if (repeated && ("uint" === valueType || "bool" === valueType)) {
        if (!numericWritten.has(name)) {
          const values = obj[name] ?? [];
          if (2 === field.wire) parts.push(encodePackedField(field.spec, values));
          else for (const value of values) parts.push(encodeField(field.spec, value));
          numericWritten.add(name);
        }
        continue;
      }

      if (repeated) {
        const pool = repeatedPool.get(name);
        if (!pool.has(field.data)) continue;
        const value = pool.get(field.data);
        pool.delete(field.data);
        parts.push(SCHEMA[valueType] && value[WIRE_STATE]?.changed ? encodeField(field.spec, value) : field.raw);
      } else {
        const value = obj[name];
        if (void 0 === value) continue;
        const needsWrite = rawOf(value, valueType) !== field.data || (SCHEMA[valueType] && value[WIRE_STATE]?.changed);
        parts.push(needsWrite ? encodeField(field.spec, value) : field.raw);
      }
    }

    // 新增的字段（原消息里没有、代码里刚塞进去的）统一补在后面。
    for (const spec of SCHEMA[typeName]) {
      const [, name, , repeated] = spec;
      if (state && !state.changed.has(name)) continue;
      if (repeated && repeatedPool.has(name)) {
        for (const value of repeatedPool.get(name).values()) parts.push(encodeField(spec, value));
      } else if (!written.has(name)) {
        for (const value of valuesOf(spec)) parts.push(encodeField(spec, value));
      }
    }

    const encoded = concatBytes(parts);
    return state && bytesEqual(encoded, state.bytes) ? state.bytes : encoded;
  }

  // 未被 schema 建模的字段（保持原始顺序，用于局部改写）。
  function unknownFields(obj) {
    const state = obj[WIRE_STATE];
    if (!state) return NO_FIELDS;
    if (state.unknown) return state.unknown;
    if (!state.fields.length || (1 === state.fields.length && state.fields[0].spec)) return NO_FIELDS;

    let unknown;
    for (const field of state.fields) if (!field.spec) (unknown ??= []).push(field);
    return (state.unknown = unknown ?? NO_FIELDS);
  }

  // 对未建模的字段跑 rewriter，返回 undefined 表示删掉。
  function rewriteUnknownField(obj, fieldNo, rewriter) {
    let updates;
    for (const field of unknownFields(obj)) {
      if (field.no !== fieldNo || 2 !== field.wire) continue;
      const next = rewriter(field.data);
      if (next && bytesEqual(next, field.data)) continue;
      (updates ??= []).push({ field, data: next });
    }
    if (!updates) return false;

    const state = obj[WIRE_STATE];
    for (const { field, data } of updates) {
      if (data) {
        field.data = data;
        field.raw = encodeField([fieldNo, "", "bytes"], data);
      } else {
        state.fields.splice(state.fields.indexOf(field), 1);
      }
    }
    state.unknown = void 0;
    markChanged(state, "");
    return true;
  }

  const SPEC_CACHE = Object.create(null);

  function messageCodec(typeName, eager = EAGER_TYPES.youtubei) {
    return { fromBinary: (bytes) => decodeMessage(typeName, bytes, 0, undefined, undefined, eager), toBinary: (obj) => encodeMessage(typeName, obj) };
  }

  // 深度优先遍历所有对象节点（不看数组内部之外的原始字节）。
  function walkObjects(root, visit) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || "object" != typeof node || ArrayBuffer.isView(node)) continue;
      visit(node);
      for (const value of Object.values(node)) stack.push(value);
    }
  }

  //=====================================================================================

  // §8 广告与推广位过滤
  //=====================================================================================


  // 复用解码器；会员徽章文案最长二十多个字节，超过阈值的字段不可能是徽章本身。
  const looseUtf8 = new TextDecoder("utf-8");
  const MAX_MEMBERS_LABEL_BYTES = 64;


  // 播放倍速菜单：把上限抬到 maxSpeed，并按需删掉 Premium 推广。
  function rewriteSpeedMenu(node, maxSpeed, hidePremium) {
    const renderer = node.playerOverlays?.renderer;
    if (!renderer?.overflowMenu) return false;
    try {
      const updated = rewritePath(
        renderer.overflowMenu,
        [66439850, 1, 153515154, 172660663, 1, 168777401, 5, 407694004, 4, 4, 170382688, 1, 169495254, 443434441, 1, 1, 441573002, 4, 153515154, 172660663, 1, 168777401, 5, 413471385, 1, 1602],
        (bytes) => {
          const fields = parseFields(bytes);
          const rateField = fields.find((field) => 5 === field.no && 5 === field.wire);
          if (!rateField) return bytes;

          const currentRate = new DataView(rateField.data.buffer, rateField.data.byteOffset, 4).getFloat32(0, true);
          if (!(currentRate > 0)) return bytes;

          let next = bytes;
          const maxRate = false === maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(maxSpeed) || 4));
          if (maxRate > 0 && currentRate < maxRate) {
            const encodedRate = new Uint8Array(4);
            new DataView(encodedRate.buffer).setFloat32(0, maxRate, true);
            next = concatBytes(fields.map((field) => (field === rateField ? concatBytes([encodeVarint(45), encodedRate]) : field.raw)));
          }

          if (false === hidePremium) return next;
          return rewritePath(next, [10, 1674], (chunk) => {
            const inner = parseFields(chunk);
            const kept = inner.filter((field) => 3 !== field.no || 2 !== field.wire || !containsBytes(field.data, PREMIUM_UPSELL_MARKER));
            return kept.length === inner.length ? chunk : concatBytes(kept.map((field) => field.raw));
          });
        },
      );
      const changed = !bytesEqual(updated, renderer.overflowMenu);
      if (changed) setField(renderer, "overflowMenu", updated);
      return changed;
    } catch (e) {
      return false;
    }
  }

  // 会员专属徽章：按文案在原始字节里逐层找。
  function hasMembersOnlyBadge(node) {
    try {
      const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
      if (!bytes || !bytes.length) return false;

      function scan(buffer, depth) {
        if (depth > 14) return false;
        let offset = 0;
        while (offset < buffer.length) {
          let tag = 0;
          let shift = 0;
          let byte;
          do {
            if (offset >= buffer.length) return false;
            byte = buffer[offset++];
            tag += (byte & 127) * 2 ** shift;
            shift += 7;
            if (shift > 35) return false;
          } while (byte & 128);

          const fieldNo = Math.floor(tag / 8);
          const wireType = tag % 8;
          if (wireType === 0) {
            do {
              if (offset >= buffer.length) return false;
              byte = buffer[offset++];
            } while (byte & 128);
          } else if (wireType === 1) {
            offset += 8;
          } else if (wireType === 5) {
            offset += 4;
          } else if (wireType === 2) {
            let length = 0;
            shift = 0;
            do {
              if (offset >= buffer.length) return false;
              byte = buffer[offset++];
              length += (byte & 127) * 2 ** shift;
              shift += 7;
              if (shift > 35) return false;
            } while (byte & 128);
            if (offset + length > buffer.length) return false;
            const chunk = buffer.subarray(offset, offset + length);
            if (length <= MAX_MEMBERS_LABEL_BYTES) {
              try {
                if (MEMBERS_ONLY_LABELS.includes(strictUtf8.decode(chunk))) return true;
              } catch {}
            }
            if (scan(chunk, depth + 1)) return true;
            offset += length;
          } else {
            return false;
          }
        }
        return false;
      }

      return scan(bytes, 0);
    } catch {
      return false;
    }
  }

  // 一个卡片/货架里的视频是否全都是会员专属（混排货架不能整块删）。
  function isAllMembersOnly(node) {
    try {
      const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
      if (!bytes || !bytes.length) return false;
      const text = looseUtf8.decode(bytes);
      const videoIds = text.match(/\/vi\/[A-Za-z0-9_-]{11}\//g);
      if (!videoIds) return false;

      const unique = new Set();
      for (const match of videoIds) unique.add(match.slice(4, 15));
      let badges = 0;
      let index;
      for (const label of MEMBERS_ONLY_LABELS) for (index = -1; (index = text.indexOf(label, index + 1)) >= 0; ) badges++;
      return badges >= unique.size;
    } catch {
      return false;
    }
  }

  // 侧栏里指向商店的 tab。
  function isStoreTab(tab) {
    const params = tab.tabRenderer?.endpoint?.browse?.params;
    if (!params) return false;
    try {
      const field = parseFields(base64ToBytes(decodeURIComponent(params))).find((entry) => 2 === entry.no && 2 === entry.wire);
      return !!field && bytesEqual(field.data, STORE_TAB_MARKER);
    } catch {
      return false;
    }
  }

  const CONTAINER_KEYS = new Set(["richItemContents", "overlays"]);
  const LIST_KEYS = new Set(["richItemContents", "contents", "sectionListSupportedRenderers", "overlayCollections"]);
  const RENDERER_KEYS = new Set([
    "videoWithContextRenderer",
    "videoRendererContent",
    "itemSectionRenderer",
    "shelfRenderer",
    "richSectionContent",
    "reelShelfRenderer",
    "renderer",
    "content",
    "item",
  ]);

  // ---- 小工具：删掉播放器里成对的推广按钮 ----

  function dropShortVideoButtons(bytes) {
    return rewriteRepeatedField(bytes, 1, (chunk) =>
      matchesPath(chunk, [10, 461054335, 4, 169495254, 138681778, 1])
        ? void 0
        : rewritePath(chunk, [10, 37098], (inner) =>
            rewriteRepeatedField(inner, 3, (item) => (matchesPath(item, [489973921, 997, 3, 3, 169495254, 138681778, 1]) ? void 0 : item)),
          ),
    );
  }

  function dropPlayerAdButtons(bytes) {
    return rewriteRepeatedField(bytes, 10, (chunk) =>
      matchesPath(chunk, [15, 461054335, 4, 169495254, 138681778, 1])
        ? void 0
        : rewritePath(chunk, [6], (inner) =>
            rewriteRepeatedField(inner, 3, (item) => (matchesPath(item, [4, 16, 461054335, 4, 169495254, 138681778, 1]) ? void 0 : item)),
          ),
    );
  }

  function dropSpeedMenuPair(bytes) {
    return rewritePath(bytes, [1], (chunk) => {
      const fields = parseFields(chunk);
      const first = fields.filter((field) => 1 === field.no && 2 === field.wire);
      const second = fields.filter((field) => 2 === field.no && 2 === field.wire);
      if (first.length !== second.length) return chunk;

      const drop = new Set();
      second.forEach((field, index) => {
        if (matchesPath(field.data, [8, 2, 169495254, 138681778, 1])) {
          drop.add(field);
          drop.add(first[index]);
        }
      });
      return drop.size ? concatBytes(fields.filter((field) => !drop.has(field)).map((field) => field.raw)) : chunk;
    });
  }

  function dropVideoAds(bytes) {
    let next = rewriteRepeatedField(bytes, 386137609, dropPlayerAdButtons);
    next = rewritePath(next, [413471385, 1], (inner) => rewriteRepeatedField(inner, 2185, dropShortVideoButtons));
    return rewriteRepeatedField(next, 408379376, dropSpeedMenuPair);
  }

  function dropAiSummary(bytes) {
    return rewritePath(
      rewriteRepeatedField(bytes, 45, (chunk) => (matchesPath(chunk, [], AI_SUMMARY_MARKER, true) ? void 0 : chunk)),
      [1, 19, 1, 1, 4, 424915055, 1],
      (chunk) => rewriteRepeatedField(chunk, 31, (inner) => (matchesPath(inner, [1, 204158123, 194114827, 1], AI_SUMMARY_MARKER, true) ? void 0 : inner)),
    );
  }

  // ---- 广告节点判定 ----

  function isVerticalLiveLockup(lockup) {
    let bytes = unknownFields(lockup).find((field) => 18 === field.no && 2 === field.wire)?.data;
    try {
      for (const fieldNo of [4, 169495254, 462702848, 1, 139608561, 50, 7, 3]) {
        if (!bytes) return false;
        bytes = parseFields(bytes).find((field) => field.no === fieldNo && 2 === field.wire)?.data;
      }
      return !!bytes && bytesEqual(bytes, IMMERSIVE_LIVE_MARKER);
    } catch {
      return false;
    }
  }

  // 325515470 下面这条链的末尾是不是 SPunlimited（Premium tab）。
  function isPremiumTab(bytes) {
    const path = [2, 11, 1, 4, 170382656, 1, 169495254, 48687626, 2];
    try {
      return (function walk(current, depth) {
        if (depth === path.length) return bytesEqual(current, PREMIUM_TAB_MARKER);
        const next = parseFields(current).filter((field) => field.no === path[depth] && 2 === field.wire);
        return (5 === depth || 1 === next.length) && next.some((field) => walk(field.data, depth + 1));
      })(bytes, 0);
    } catch {
      return false;
    }
  }

  // AI 摘要块：408379376 下面 1/2 号字段成对出现且都指向 ai_summary。
  function isAiBlock(node) {
    try {
      return unknownFields(node).some((field) => {
        if (408379376 !== field.no || 2 !== field.wire) return false;
        const entries = parseFields(field.data).filter((entry) => 1 === entry.no && 2 === entry.wire);
        if (1 !== entries.length) return false;

        const inner = parseFields(entries[0].data);
        const first = inner.filter((entry) => 1 === entry.no && 2 === entry.wire);
        const second = inner.filter((entry) => 2 === entry.no && 2 === entry.wire);
        return second.length > 0 && second.length === first.length && second.every((entry) => matchesPath(entry.data, [8, 2, 169495254, 138681778, 1]));
      });
    } catch {
      return false;
    }
  }

  // 一条信息流节点是不是广告。
  function isFeedAdNode(node, options) {
    const layout = node.layoutRender?.eml?.split("|")[0];
    const adByLayout = layout && ((false !== options.blockFeedAds && FEED_AD_LAYOUT.test(layout)) || (options.blockStore && SHOPPING_LAYOUT.test(layout)));

    if (adByLayout) return true;
    if (options.blockStore && node.shoppingShelf) return true;
    if (false !== options.blockFeedAds && node.sponsoredVideo) return true;
    if (false !== options.blockFeedAds && node.sponsoredDisplay) return true;
    if (options.blockVerticalLive && node.videoLockup && isVerticalLiveLockup(node.videoLockup)) return true;
    if (false !== options.blockMembersOnly && node.videoLockup && hasMembersOnlyBadge(node.videoLockup)) return true;

    for (const field of unknownFields(node)) {
      if (2 !== field.wire) continue;

      if (false !== options.blockFeedAds && field.data.length >= PAGEAD_MARKER.length && containsBytes(field.data)) return true;
      if (false !== options.blockFeedAds && 325515470 === field.no && isPremiumTab(field.data)) return true;
      if (options.blockStore && 400157044 === field.no) return true;
      if (false !== options.blockFeedAds && 455507059 === field.no) return true;
      if (options.blockVerticalLive && 519005951 === field.no && field.data.length >= VERTICAL_LIVE_ICON.length && containsBytes(field.data, VERTICAL_LIVE_ICON)) return true;
      if (312131490 === field.no) {
        if (options.blockGames && field.data.length >= MINI_GAME_MARKER.length && containsBytes(field.data, MINI_GAME_MARKER)) return true;
        if (options.blockStore && field.data.length >= SHOPPING_LIST_MARKER.length && containsBytes(field.data, SHOPPING_LIST_MARKER)) return true;
      }
    }
    return false;
  }

  // 遍历树时每个节点都会走 stripAiControls；先用一次字段扫描判断有没有目标字段，
  // 没有就跳过对应的 rewriteUnknownField，避免对每个节点白跑十几遍。
  function hasUnknownField(obj, fieldNo) {
    const fields = unknownFields(obj);
    for (let i = 0; i < fields.length; i += 1) {
      if (fields[i].no === fieldNo && fields[i].wire === 2) return true;
    }
    return false;
  }

  // 删掉 Ask / AI 摘要相关的控件。
  function stripAiControls(node) {
    let changed = false;
    try {
      if (node.engagementPanels?.length) {
        const panels = node.engagementPanels.filter((panel) => {
          const renderer = panel.renderer;
          return !renderer || !unknownFields(renderer).some((field) => 1 === field.no && 2 === field.wire && bytesEqual(field.data, PREMIUM_UPSELL_MARKER));
        });
        changed = setField(node, "engagementPanels", panels) || changed;
        for (const panel of panels) {
          if (!panel.renderer) continue;
          changed =
            rewriteUnknownField(panel.renderer, 10, (bytes) =>
              matchesPath(bytes, [260791572, 1, 153515154, 172660663, 1, 168777401, 5, 413471385, 1, 2553, 997, 3, 3, 170382688, 1, 169495254, 138681778, 1]) ? void 0 : bytes,
            ) || changed;
        }
      }

      if (node.playerOverlays?.renderer && hasUnknownField(node.playerOverlays.renderer, 37)) {
        changed = rewriteUnknownField(node.playerOverlays.renderer, 37, dropVideoAds) || changed;
      }
      if (hasUnknownField(node, 216561405)) changed = rewriteUnknownField(node, 216561405, (bytes) => rewritePath(bytes, [1], dropVideoAds)) || changed;
      if (hasUnknownField(node, 386137609)) changed = rewriteUnknownField(node, 386137609, dropPlayerAdButtons) || changed;
      if (hasUnknownField(node, 408379376)) changed = rewriteUnknownField(node, 408379376, dropSpeedMenuPair) || changed;

      if (node.element?.data && hasUnknownField(node.element.data, 2185)) {
        changed = rewriteUnknownField(node.element.data, 2185, dropShortVideoButtons) || changed;
      }
      if (node.videoLockup && hasUnknownField(node.videoLockup, 18)) {
        changed = rewriteUnknownField(node.videoLockup, 18, dropAiSummary) || changed;
      }
      if (node.videoContent?.videoLockup && hasUnknownField(node, 6)) {
        changed =
          rewriteUnknownField(node, 6, (bytes) =>
            rewritePath(bytes, [188490103], (inner) => rewriteRepeatedField(inner, 1, (item) => (matchesPath(item, [1], AI_SUMMARY_MARKER, true) ? void 0 : item))),
          ) || changed;
      }
    } catch (e) {
      // 结构对不上就当没改，放原响应过去。
    }
    return changed;
  }

  // 关掉 Jump Ahead 的推广模式，并把展示次数上限放开。
  function disableSmartSkip(button) {
    let changed = false;
    const controller = button.controller;
    if (true === controller?.promotionMode) {
      setField(controller, "promotionMode", false);
      changed = true;
    }
    if (button.actions?.items?.length) {
      for (const item of [button, ...button.actions.items]) {
        if (2147483647 !== item.displayLimit) {
          setField(item, "displayLimit", 2147483647);
          changed = true;
        }
      }
    }
    return changed;
  }

  // ---- 浏览树遍历：边遍历边删广告、Shorts 货架、会员视频、AI 控件 ----

  function filterBrowseTree(root, options) {
    const opts = {
      blockGames: true,
      blockVerticalLive: false,
      jumpAhead: true,
      blockStore: true,
      blockAi: true,
      maxSpeed: 4,
      hidePremium: true,
      blockFeedAds: true,
      blockShortsFeed: false,
      blockMembersOnly: false,
      ...(options || {}),
    };

    let changed = rewriteSpeedMenu(root, opts.maxSpeed, opts.hidePremium);

    function visit(node, inList = false) {
      if (!node || "object" != typeof node || ArrayBuffer.isView(node)) return 0;
      if (inList && false !== opts.blockMembersOnly && hasMembersOnlyBadge(node) && isAllMembersOnly(node)) return 1;
      if (false !== opts.blockShortsFeed && node.reelShelfRenderer) return 2;

      if (Array.isArray(node)) {
        let result = 0;
        for (const item of node) result |= 1 & visit(item, inList);
        return result;
      }

      let isAd = inList && (isFeedAdNode(node, opts) || (opts.blockAi && isAiBlock(node)));

      const layout = node.renderInfo?.layoutRender?.eml?.split("|")[0];
      let isShortsShelf = !!layout && ((false !== opts.blockFeedAds && FEED_AD_LAYOUT.test(layout)) || (opts.blockStore && SHOPPING_LAYOUT.test(layout)));
      if (inList && (isAd || isShortsShelf)) return 1;

      if (opts.blockAi) changed = stripAiControls(node) || changed;

      const state = node[WIRE_STATE];
      for (const key in node) {
        // 延迟解析的节点只在需要时才展开，跳过不可能命中广告的字段。
        if (!inList && state?.deferred) {
          const spec = SCHEMA[state.type].find(([, name]) => name === key);
          if (
            spec &&
            !state.eager.has(spec[2]) &&
            !CONTAINER_KEYS.has(key) &&
            !LIST_KEYS.has(key) &&
            "promotedContents" !== key &&
            (!opts.blockStore || ("tabs" !== key && "attachments" !== key))
          ) {
            continue;
          }
        }

        const value = node[key];
        if (!value || "object" != typeof value || ArrayBuffer.isView(value)) continue;

        if (!Array.isArray(value)) {
          const result = visit(value, inList);
          if (inList && 1 & result) return 1;
          isAd = !!(1 & result) || isAd;
          if (2 & result && RENDERER_KEYS.has(key)) isShortsShelf = true;
          continue;
        }

        let kept;
        const isContainer = CONTAINER_KEYS.has(key);
        const isList = LIST_KEYS.has(key);
        const isTabs = opts.blockStore && "tabs" === key;
        const isAttachments = opts.blockStore && "attachments" === key;
        const isPromoted = "promotedContents" === key;

        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const drop =
            (isTabs && isStoreTab(item)) ||
            (isAttachments && item.products?.length) ||
            (isPromoted && false !== opts.blockFeedAds && containsBytes(item));
          const result = drop && !inList ? 0 : visit(item, inList || isContainer);

          if (inList && 1 & result) return 1;
          isAd = !!(1 & result) || isAd;
          if (drop || (isContainer && 1 & result) || (isList && 2 & result)) kept ??= value.slice(0, i);
          else if (kept) kept.push(item);
        }

        if (kept) {
          setField(node, key, kept);
          changed = true;
          if (!kept.length && (isContainer || isList)) isShortsShelf = true;
        }
        if (opts.blockStore && "attachments" === key && !(kept ?? value).length && void 0 !== node.attachmentStateKey) {
          changed = deleteField(node, "attachmentStateKey") || changed;
        }
      }

      if (opts.jumpAhead && node.smartSkipButton) changed = disableSmartSkip(node.smartSkipButton) || changed;

      return (isAd ? 1 : 0) | (isShortsShelf ? 2 : 0);
    }

    visit(root);
    return changed;
  }

  // ---- 播放器响应 ----

  // 字幕翻译：在原字幕轨道后面补一条带 tlang 的翻译轨道，并把它设为默认。
  // 目标语言本身就在轨道列表里时直接选中它，不再重复添加。
  function applyCaptionTranslation(player, lang) {
    const renderer = player.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    let changed = false;
    let bestIndex = 0;
    let bestScore = 0;
    const target = String(lang).toLowerCase();
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const code = String(track.languageCode ?? "").toLowerCase();
      const score = code === target ? 2 : /^en(?:-|$)/.test(code) ? 1 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      if (track.isTranslatable !== true) changed = setField(track, "isTranslatable", true) || changed;
    }

    let selected = bestIndex;
    if (bestScore !== 2) {
      const base = tracks[bestIndex];
      const baseUrl = String(base.baseUrl ?? "");
      if (!baseUrl) return changed;
      const translated = {
        baseUrl: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}tlang=${encodeURIComponent(lang)}`,
        name: { runs: [{ text: `@Enhance (${lang})` }] },
        vssId: `.${lang}`,
        languageCode: lang,
        isTranslatable: true,
      };
      selected = tracks.length;
      changed = setField(renderer, "captionTracks", [...tracks, translated]) || changed;
    }

    changed = setField(renderer, "defaultCaptionTrackIndex", selected) || changed;
    if (Array.isArray(renderer.audioTracks)) {
      for (const audio of renderer.audioTracks) {
        const indices = Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
        if (!indices.includes(selected)) changed = setField(audio, "captionTrackIndices", [...indices, selected]) || changed;
        changed = setField(audio, "defaultCaptionTrackIndex", selected) || changed;
        changed = setField(audio, "captionsInitialState", 3) || changed;
      }
    }
    return changed;
  }

  function rewritePlayer(player, options) {
    let changed = filterBrowseTree(player, options);

    if (options.captionLang && "off" !== String(options.captionLang).toLowerCase()) {
      // 字幕轨道结构异常时只跳过字幕，不能连累广告清理。
      try {
        changed = applyCaptionTranslation(player, options.captionLang) || changed;
      } catch (e) {
        // ignore
      }
    }

    if (false !== options.removePaidPromotion) changed = deleteField(player, "paidPromotion") || changed;

    if (false !== options.blockPlayerAds) {
      for (const key of ["adPlacements", "adSlots"]) {
        if (player[key]?.length) {
          setField(player, key, []);
          changed = true;
        }
      }
    }

    const speedConfig = player.playerConfig?.granularVariableSpeedConfig;
    const maxRate = false === options.maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(options.maxSpeed) || 4)) * 100;
    if (maxRate > 0 && void 0 !== speedConfig?.maximumPlaybackRate && speedConfig.maximumPlaybackRate > 0 && speedConfig.maximumPlaybackRate < maxRate) {
      setField(speedConfig, "maximumPlaybackRate", maxRate);
      changed = true;
    }

    if (false !== options.blockAdTracking && player.playbackTracking) {
      changed = deleteField(player.playbackTracking, "pageadViewthroughconversion") || changed;
    }

    const playability = player.playabilityStatus;
    if (playability) {
      if (false !== options.pip) {
        const render = playability.pictureInPictureRender ?? {};
        setField(playability, "pictureInPictureRender", render);
        const ability = render.pictureInPictureAbility ?? {};
        setField(render, "pictureInPictureAbility", ability);
        changed = setField(ability, "active", true) || changed;
        changed = setField(ability, "f4", 0) || changed;
        changed = setField(ability, "f6", 0) || changed;
        changed = setField(ability, "f8", 1) || changed;
      }
      if (false !== options.backgroundPlay) {
        const render = playability.backgroundPlayerRender ?? {};
        setField(playability, "backgroundPlayerRender", render);
        const ability = render.backgroundAbility ?? {};
        setField(render, "backgroundAbility", ability);
        changed = setField(ability, "active", true) || changed;
      }
    }

    return changed;
  }

  //=====================================================================================
  // §9 网页版 JSON 响应
  //
  // www.youtube.com / m.youtube.com / music.youtube.com 的 youtubei 响应是 JSON，
  // 字段名和 protobuf 的 lowerCamelCase 属性一致。这里只做保守的结构删除：
  // 认识的广告 renderer、播放器广告字段、Shorts 货架、会员徽章、AI 控件。
  // 结构对不上就原样放行，最差是某个开关不生效，不会把页面改坏。
  //=====================================================================================

  const JSON_AD_RENDERERS = new Set([
    "adSlotRenderer",
    "displayAdRenderer",
    "promotedSparklesTextRenderer",
    "promotedSparklesWebRenderer",
    "promotedVideoRenderer",
    "compactPromotedVideoRenderer",
    "compactPromotedItemRenderer",
    "brandVideoShelfRenderer",
    "videoMastheadAdV3Renderer",
    "inFeedAdLayoutRenderer",
    "searchPyvRenderer",
    "pyvRenderer",
    "bannerPromoRenderer",
    "statementBannerRenderer",
    "adsCoordinationRenderer",
    "adInfoRenderer",
    "feedNudgeRenderer",
    "adBadgeRenderer",
    "adCtaRenderer",
  ]);

  const JSON_AI_RENDERERS = new Set([
    "clarificationRenderer",
    "macroMarkersListRenderer",
    "aiSummaryRenderer",
    "aiSummaryViewModel",
  ]);

  const JSON_STORE_RENDERERS = new Set([
    "shoppingShelfRenderer",
    "productSummaryRenderer",
    "paidContentOverlayRenderer",
    "paidContentOverlayViewModel",
  ]);

  const JSON_PLAYER_AD_FIELDS = new Set(["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams"]);

  function jsonHasAnyKey(node, keys) {
    if (!node || "object" != typeof node || Array.isArray(node)) return false;
    for (const key of keys) if (key in node) return true;
    return false;
  }

  function jsonBadgeLabel(badge) {
    if (!badge || "object" != typeof badge) return "";
    const label = badge.metadataBadgeRenderer?.label ?? badge.label ?? badge.accessibilityData?.label;
    return "string" == typeof label ? label : "";
  }

  function jsonIsMembersOnly(node) {
    if (!node || "object" != typeof node) return false;
    for (const key of ["badges", "ownerBadges"]) {
      const list = node[key];
      if (!Array.isArray(list)) continue;
      for (const badge of list) {
        const label = jsonBadgeLabel(badge);
        if (label && MEMBERS_ONLY_LABELS.some((text) => label.indexOf(text) >= 0)) return true;
      }
    }
    return false;
  }

  function jsonIsAdNode(node, options) {
    if (!node || "object" != typeof node || Array.isArray(node)) return false;
    if (false !== options.blockFeedAds && jsonHasAnyKey(node, JSON_AD_RENDERERS)) return true;
    if (false !== options.blockAi && jsonHasAnyKey(node, JSON_AI_RENDERERS)) return true;
    if (options.blockStore && jsonHasAnyKey(node, JSON_STORE_RENDERERS)) return true;
    if (false !== options.blockShortsFeed && ("reelShelfRenderer" in node || "shortsLockupViewModel" in node)) return true;
    if (false !== options.blockMembersOnly) {
      if (jsonIsMembersOnly(node)) return true;
      // 列表项通常是 { videoRenderer: { badges } }，徽章在下一层。
      for (const key of Object.keys(node)) {
        if (jsonIsMembersOnly(node[key])) return true;
      }
    }
    return false !== options.blockFeedAds && true === node.adClientParams?.isAd;
  }

  function jsonSmartSkip(button) {
    if (!button || "object" != typeof button) return false;
    let changed = false;
    if (button.controller && true === button.controller.promotionMode) {
      button.controller.promotionMode = false;
      changed = true;
    }
    const items = [button].concat(Array.isArray(button.actions?.items) ? button.actions.items : []);
    for (const item of items) {
      if (!item || "object" != typeof item) continue;
      if (void 0 !== item.displayLimit && 2147483647 !== item.displayLimit) {
        item.displayLimit = 2147483647;
        changed = true;
      }
    }
    return changed;
  }

  // 递归删除广告 / Shorts / 会员视频 / AI 控件；返回是否真的改过。
  function jsonPruneTree(root, options) {
    let changed = false;

    function visit(node) {
      if (!node || "object" != typeof node) return;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          if (jsonIsAdNode(node[i], options)) {
            node.splice(i, 1);
            changed = true;
            continue;
          }
          visit(node[i]);
        }
        return;
      }

      for (const key of Object.keys(node)) {
        const value = node[key];
        if (false !== options.blockFeedAds && (JSON_PLAYER_AD_FIELDS.has(key) || JSON_AD_RENDERERS.has(key))) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.blockAi && JSON_AI_RENDERERS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (options.blockStore && JSON_STORE_RENDERERS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.blockShortsFeed && ("reelShelfRenderer" === key || "shortsLockupViewModel" === key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.jumpAhead && "smartSkipButton" === key) changed = jsonSmartSkip(value) || changed;
        // 会员视频节点通常直接挂在 content / item 上，在父对象这一层删掉。
        if (false !== options.blockMembersOnly && jsonIsMembersOnly(value)) {
          delete node[key];
          changed = true;
          continue;
        }
        visit(value);
      }
    }

    visit(root);
    return changed;
  }

  // 网页版侧栏：guideEntryRenderer 的 browseId 在 hiddenGuideItems 里就删。
  function jsonFilterGuide(root, options) {
    const hidden = new Set(options.hiddenGuideItems ?? []);
    if (!hidden.size) return false;
    let changed = false;

    function visit(node) {
      if (!node || "object" != typeof node) return;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          const entry = node[i];
          const id = entry?.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
          if (id && hidden.has(id)) {
            node.splice(i, 1);
            changed = true;
            continue;
          }
          visit(entry);
        }
        return;
      }
      for (const key of Object.keys(node)) visit(node[key]);
    }

    visit(root);
    return changed;
  }

  // 字幕翻译：与 App 版逻辑一致，但直接操作 JSON 属性。
  function jsonApplyCaptionTranslation(player, lang) {
    const renderer = player?.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    let changed = false;
    let bestIndex = 0;
    let bestScore = 0;
    const target = String(lang).toLowerCase();
    for (let i = 0; i < tracks.length; i++) {
      const code = String(tracks[i]?.languageCode ?? "").toLowerCase();
      const score = code === target ? 2 : /^en(?:-|$)/.test(code) ? 1 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      if (true !== tracks[i]?.isTranslatable) {
        tracks[i].isTranslatable = true;
        changed = true;
      }
    }

    let selected = bestIndex;
    if (bestScore !== 2) {
      const baseUrl = String(tracks[bestIndex]?.baseUrl ?? "");
      if (!baseUrl) return changed;
      const translated = {
        baseUrl: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}tlang=${encodeURIComponent(lang)}`,
        name: { runs: [{ text: `@Enhance (${lang})` }] },
        vssId: `.${lang}`,
        languageCode: lang,
        isTranslatable: true,
      };
      selected = tracks.length;
      tracks.push(translated);
      changed = true;
    }

    if (renderer.defaultCaptionTrackIndex !== selected) {
      renderer.defaultCaptionTrackIndex = selected;
      changed = true;
    }
    if (Array.isArray(renderer.audioTracks)) {
      for (const audio of renderer.audioTracks) {
        if (!audio || "object" != typeof audio) continue;
        const indices = Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
        if (!indices.includes(selected)) {
          audio.captionTrackIndices = [...indices, selected];
          changed = true;
        }
        if (audio.defaultCaptionTrackIndex !== selected) {
          audio.defaultCaptionTrackIndex = selected;
          changed = true;
        }
        if (audio.captionsInitialState !== 3) {
          audio.captionsInitialState = 3;
          changed = true;
        }
      }
    }
    return changed;
  }

  // 网页播放器按 adaptiveFormats 里实际给的档位选画质。只保留目标高度
  // （max_height 与最高可用值取较小者），音频格式不动。
  function jsonApplyQuality(streamingData, maxHeight) {
    const formats = streamingData?.adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length) return false;

    const cap = Math.max(144, Math.min(4320, parseInt(maxHeight, 10) || 4320));
    // 选「不超过 max_height 的最高档」；如果所有视频档都高于上限，
    // 退到最低的视频档，避免把视频轨全删光只剩音频。
    let target = 0;
    let lowest = 0;
    for (const format of formats) {
      const height = parseInt(format?.height, 10);
      if (!Number.isFinite(height) || height <= 0) continue;
      if (!lowest || height < lowest) lowest = height;
      if (height <= cap && height > target) target = height;
    }
    if (!target) target = lowest;
    if (!target) return false;
    const kept = formats.filter((format) => {
      const height = parseInt(format?.height, 10);
      return !Number.isFinite(height) || height === target;
    });
    if (kept.length === formats.length) return false;
    streamingData.adaptiveFormats = kept;
    return true;
  }

  function jsonRewritePlayer(player, options) {
    let changed = jsonPruneTree(player, options);

    if (options.captionLang && "off" !== String(options.captionLang).toLowerCase()) {
      try {
        changed = jsonApplyCaptionTranslation(player, options.captionLang) || changed;
      } catch (e) {
        // 字幕结构异常时只跳过字幕，不影响广告清理。
      }
    }

    if (false !== options.autoHd && player.streamingData) {
      changed = jsonApplyQuality(player.streamingData, options.maxHeight) || changed;
    }

    const speedConfig = player.playerConfig?.granularVariableSpeedConfig;
    const maxRate = false === options.maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(options.maxSpeed) || 4)) * 100;
    if (
      maxRate > 0 &&
      speedConfig &&
      "number" == typeof speedConfig.maximumPlaybackRate &&
      speedConfig.maximumPlaybackRate > 0 &&
      speedConfig.maximumPlaybackRate < maxRate
    ) {
      speedConfig.maximumPlaybackRate = maxRate;
      changed = true;
    }

    // 网页版不一定带这两个结构；带了才改，不凭空插入。
    const playability = player.playabilityStatus;
    if (playability && "object" == typeof playability) {
      if (false !== options.pip && playability.pictureInPictureRender && "object" == typeof playability.pictureInPictureRender) {
        const render = playability.pictureInPictureRender;
        const ability = render.pictureInPictureAbility ?? (render.pictureInPictureAbility = {});
        if (true !== ability.active) {
          ability.active = true;
          changed = true;
        }
        if (0 !== ability.f4) {
          ability.f4 = 0;
          changed = true;
        }
        if (0 !== ability.f6) {
          ability.f6 = 0;
          changed = true;
        }
        if (1 !== ability.f8) {
          ability.f8 = 1;
          changed = true;
        }
      }
      if (false !== options.backgroundPlay && playability.backgroundPlayerRender && "object" == typeof playability.backgroundPlayerRender) {
        const render = playability.backgroundPlayerRender;
        const ability = render.backgroundAbility ?? (render.backgroundAbility = {});
        if (true !== ability.active) {
          ability.active = true;
          changed = true;
        }
      }
    }

    return changed;
  }

  function rewriteJsonRoute(route, data, options) {
    if ("player" === route) return jsonRewritePlayer(data, options);
    if ("guide" === route) return jsonFilterGuide(data, options);

    if ("navigation/resolve_url" === route) {
      let changed = jsonPruneTree(data, options);
      const player = data?.endpoint?.watch?.embedded?.response?.player;
      if (player) changed = jsonRewritePlayer(player, options) || changed;
      return changed;
    }

    if ("get_watch" === route) {
      let changed = jsonPruneTree(data, options);
      for (const item of data?.contents ?? []) {
        if (item?.player) changed = jsonRewritePlayer(item.player, options) || changed;
        if (item?.next) changed = jsonPruneTree(item.next, options) || changed;
      }
      return changed;
    }

    // browse / next / search / reel/reel_watch_sequence 共用同一套 renderer 过滤；
    // 侧栏偶尔也塞在 browse 响应里，所以 guide 过滤一起跑。
    let changed = jsonPruneTree(data, options);
    changed = jsonFilterGuide(data, options) || changed;
    return changed;
  }

  //=====================================================================================
  // §9 画质缓存
  //
  // 从 player 响应里挑出每个视频可用的 itag 存起来，videoplayback 请求时按 id 取用。
  //=====================================================================================

  function updateQualityCache(players, options) {
    if (!players.length) return;

    const maxHeight = Math.max(144, Math.min(4320, parseInt(options.maxHeight) || 4320));
    const metadata = players.map((player) => unknownFields(player).find((field) => 4 === field.no && 2 === field.wire)?.data).filter(Boolean);
    if (!metadata.length) return;

    let cache;
    try {
      cache = readStore(QUALITY_KEY, MAX_QUALITY_JSON);
    } catch (e) {
      return;
    }

    const next = Object.create(null);
    let dirty = false;
    const keys = Object.keys(cache);
    if (keys.length > MAX_QUALITY_ENTRIES) dirty = true;

    for (const videoId of keys.slice(-MAX_QUALITY_ENTRIES)) {
      const entry = cache[videoId];
      if (videoId.length > 256 || !isQualityEntry(entry) || entry.height > maxHeight) {
        dirty = true;
      } else {
        next[videoId] = { height: entry.height, itags: entry.itags };
        if (entry.premiumItags?.length) next[videoId].premiumItags = entry.premiumItags;
        if (Object.keys(entry).length !== Object.keys(next[videoId]).length) dirty = true;
      }
    }

    for (const bytes of metadata) {
      try {
        const fields = parseFields(bytes);
        const urlField = fields.find((field) => 15 === field.no && 2 === field.wire);
        const match = urlField && /[?&]id=([^&]+)/.exec(strictUtf8.decode(urlField.data));
        if (!match) continue;

        const videoId = decodeURIComponent(match[1]);
        const entry = { height: 0, itags: [] };
        if (videoId.length > 256) continue;

        const seen = new Set();
        let truncated = false;
        for (const field of fields) {
          if (3 !== field.no || 2 !== field.wire) continue;

          const format = parseFields(field.data);
          const mime = format.find((item) => 5 === item.no && 2 === item.wire);
          if (!mime || !strictUtf8.decode(mime.data).startsWith("video/")) continue;

          const numberField = (fieldNo) => {
            const item = format.find((entry) => entry.no === fieldNo && 0 === entry.wire);
            return item ? readVarintValue(item.data) : 0;
          };
          const height = Math.min(numberField(7), numberField(8));
          const itag = numberField(1);
          if (!itag || !height || height > 2147483647 || height > maxHeight || height < entry.height) continue;

          if (height > entry.height) {
            entry.height = height;
            entry.itags = [];
            delete entry.premiumItags;
            seen.clear();
            truncated = false;
          }
          if (truncated || seen.has(itag)) continue;
          if (256 === seen.size) {
            truncated = true;
            continue;
          }

          seen.add(itag);
          entry.itags.push(itag);
          const premium = format.find((item) => 26 === item.no && 2 === item.wire);
          if (premium && /\bPremium\b/i.test(strictUtf8.decode(premium.data))) (entry.premiumItags ??= []).push(itag);
        }

        if (truncated || !isQualityEntry(entry) || sameQuality(next[videoId], entry)) continue;
        delete next[videoId];
        next[videoId] = entry;
        dirty = true;
      } catch (e) {
        // 单条画质记录异常不影响其它记录。
      }
    }

    if (!dirty) return;

    const trimmed = Object.keys(next);
    for (const videoId of trimmed.slice(0, Math.max(0, trimmed.length - MAX_QUALITY_ENTRIES))) delete next[videoId];

    try {
      let json = JSON.stringify(next);
      while (textEncoder.encode(json).length > MAX_QUALITY_JSON) {
        delete next[Object.keys(next)[0]];
        json = JSON.stringify(next);
      }
      writeStore(next, QUALITY_KEY);
    } catch (e) {
      // 存不进去就算了，不影响本次播放。
    }
  }

  //=====================================================================================
  // §10 UMP
  //
  // initplayback 的响应是分片容器：type 10 是明文头，type 11 是加密体。
  // 加密体用 AES-256-CBC + HMAC-SHA256，密钥来自 config/log_event 里的 clientKey。
  // 这里解密 -> 按 schema 改写 -> 重新加密，只动被改过的分片。
  //=====================================================================================

  // 读 UMP 分片头（可变长前缀编码，不是标准 varint）。
  class UmpReader {
    constructor(buffer) {
      this.buffer = buffer;
      this.offset = 0;
    }

    readByte() {
      if (this.offset >= this.buffer.length) throw new Error("Truncated UMP header");
      return this.buffer[this.offset++];
    }

    readVarint() {
      const first = this.readByte();
      let width = 5;
      for (let i = 1; i < 5; i++) {
        if (!(first & (128 >> (i - 1)))) {
          width = i;
          break;
        }
      }
      let shift = 5 === width ? 0 : 8 - width;
      let value = 5 === width ? 0 : first & ((1 << shift) - 1);
      for (let i = 1; i < width; i++, shift += 8) value += this.readByte() * 2 ** shift;
      return value;
    }

    readPart() {
      const start = this.offset;
      const type = this.readVarint();
      const length = this.readVarint();
      if (length > this.buffer.length - this.offset) {
        throw new Error(`Truncated UMP payload: type=${type}, offset=${this.offset}, expected=${length}, available=${this.buffer.length - this.offset}`);
      }
      const data = this.buffer.subarray(this.offset, this.offset + length);
      this.offset += length;
      return { type, data, originalData: data, raw: this.buffer.subarray(start, this.offset) };
    }

    get hasNext() {
      return this.offset < this.buffer.length;
    }
  }

  class UmpWriter {
    constructor(size = 1024) {
      this.buffer = new Uint8Array(size);
      this.length = 0;
    }

    ensureCapacity(extra) {
      if (this.length + extra <= this.buffer.length) return;
      const grown = new Uint8Array(Math.max(2 * this.buffer.length, this.length + extra));
      grown.set(this.buffer);
      this.buffer = grown;
    }

    writeByte(byte) {
      this.ensureCapacity(1);
      this.buffer[this.length++] = 255 & byte;
    }

    writeVarint(value) {
      if (!Number.isInteger(value) || value < 0 || value > 4294967295) throw new Error("Invalid UMP integer");
      const width = value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : value < 268435456 ? 4 : 5;
      if (1 === width) return this.writeByte(value);
      5 === width ? this.writeByte(240) : this.writeByte((256 - (256 >> (width - 1))) | (value & ((1 << (8 - width)) - 1)));
      for (let i = 1, shift = 5 === width ? 0 : 8 - width; i < width; i++, shift += 8) this.writeByte(Math.floor(value / 2 ** shift));
    }

    writePart({ type, data }) {
      this.writeVarint(type);
      this.writeVarint(data.length);
      this.ensureCapacity(data.length);
      this.buffer.set(data, this.length);
      this.length += data.length;
    }

    finish() {
      return this.buffer.subarray(0, this.length);
    }
  }

  async function gzipStream(bytes, decompress) {
    const stream = decompress ? new DecompressionStream("gzip") : new CompressionStream("gzip");
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();

    const collected = (async () => {
      const chunks = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (decompress && total > 16777216) throw new Error("UMP decompression exceeds 16 MiB");
        chunks.push(value);
      }
      return concatBytes(chunks);
    })();
    const written = (async () => {
      await writer.write(bytes);
      await writer.close();
    })();

    try {
      return (await Promise.all([collected, written]))[0];
    } catch (e) {
      await Promise.allSettled([reader.cancel(e), writer.abort(e)]);
      throw e;
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  }

  // ---- 内联的 @noble/ciphers + @noble/hashes（MIT，版权与许可见下方注释）----
  function createUmpCrypto() {
    /*
    Third-party components bundled below use the MIT License.

    @noble/ciphers
    Copyright (c) 2022 Paul Miller (https://paulmillr.com)
    Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>

    @noble/hashes
    Copyright (c) 2022 Paul Miller (https://paulmillr.com)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    return (function () {
    function g(g, ...I) {
      if (!(
        g instanceof Uint8Array ||
        (ArrayBuffer.isView(g) && "Uint8Array" === g.constructor.name)
      ))
        throw new Error("Uint8Array expected");
      if (I.length && !I.includes(g.length)) throw new Error("Invalid byte length: " + g.length);
    }
    function I(g) {
      return new Uint32Array(g.buffer, g.byteOffset, Math.floor(g.byteLength / 4));
    }
    function A(...g) {
      for (const I of g) I.fill(0);
    }
    function C(g) {
      return g.byteOffset % 4 == 0;
    }
    function E(g) {
      return Uint8Array.from(g);
    }
    if (68 !== new Uint8Array(new Uint32Array([287454020]).buffer)[0])
      throw new Error("Non little-endian hardware is not yet supported");
    function o(g) {
      return (g << 1) ^ (283 & -(g >> 7));
    }
    function e(g, I) {
      let A = 0;
      for (; I > 0; I >>= 1) ((A ^= g & -(1 & I)), (g = o(g)));
      return A;
    }
    var B = (g) => (g << 24) | (g >>> 8),
      t = (g) => (g << 8) | (g >>> 24);
    function n(g, I) {
      if (256 !== g.length) throw new Error("Wrong sbox length");
      let A = new Uint32Array(256).map((A, C) => I(g[C])),
        C = A.map(t),
        E = C.map(t),
        o = E.map(t),
        e = new Uint32Array(65536),
        B = new Uint32Array(65536),
        n = new Uint16Array(65536);
      for (let I = 0; I < 256; I++)
        for (let t = 0; t < 256; t++) {
          let S = 256 * I + t;
          ((e[S] = A[I] ^ C[t]), (B[S] = E[I] ^ o[t]), (n[S] = (g[I] << 8) | g[t]));
        }
      return { sbox2: n, T01: e, T23: B };
    }
    var S = n(
        (() => {
          let g = new Uint8Array(256);
          for (let I = 0, A = 1; I < 256; I++, A ^= o(A)) g[I] = A;
          let I = new Uint8Array(256);
          I[0] = 99;
          for (let A = 0; A < 255; A++) {
            let C = g[255 - A];
            ((C |= C << 8), (I[g[A]] = 255 & (C ^ (C >> 4) ^ (C >> 5) ^ (C >> 6) ^ (C >> 7) ^ 99)));
          }
          return (A(g), I);
        })(),
        (g) => (e(g, 3) << 24) | (g << 16) | (g << 8) | e(g, 2),
      ),
      i = (() => {
        let g = new Uint8Array(16);
        for (let I = 0, A = 1; I < 16; I++, A = o(A)) g[I] = A;
        return g;
      })();
    function r(g, I, A, C, E, o) {
      return g[((A << 8) & 65280) | ((C >>> 8) & 255)] ^ I[((E >>> 8) & 65280) | ((o >>> 24) & 255)];
    }
    function h(g, I, A, C, E) {
      return g[(255 & I) | (65280 & A)] | (g[((C >>> 16) & 255) | ((E >>> 16) & 65280)] << 16);
    }
    function a(g, I, A, C, E) {
      let { sbox2: o, T01: e, T23: B } = S,
        t = 0;
      ((I ^= g[t++]), (A ^= g[t++]), (C ^= g[t++]), (E ^= g[t++]));
      let n = g.length / 4 - 2;
      for (let o = 0; o < n; o++) {
        let o = g[t++] ^ r(e, B, I, A, C, E),
          n = g[t++] ^ r(e, B, A, C, E, I),
          S = g[t++] ^ r(e, B, C, E, I, A),
          i = g[t++] ^ r(e, B, E, I, A, C);
        ((I = o), (A = n), (C = S), (E = i));
      }
      return {
        s0: g[t++] ^ h(o, I, A, C, E),
        s1: g[t++] ^ h(o, A, C, E, I),
        s2: g[t++] ^ h(o, C, E, I, A),
        s3: g[t++] ^ h(o, E, I, A, C),
      };
    }
    function K(o, e, B) {
      const t = E(e),
        n = C(B) ? B : E(B);
      try {
        return (function (C, E, o) {
          (g(E, 16), g(o));
          let e = o.length;
          const B = new Uint8Array(e);
          let t = E,
            n = I(t),
            { s0: S, s1: i, s2: r, s3: h } = a(C, n[0], n[1], n[2], n[3]),
            K = I(o),
            s = I(B);
          for (let g = 0; g + 4 <= K.length; g += 4) {
            ((s[g + 0] = K[g + 0] ^ S),
              (s[g + 1] = K[g + 1] ^ i),
              (s[g + 2] = K[g + 2] ^ r),
              (s[g + 3] = K[g + 3] ^ h));
            let I = 1;
            for (let g = t.length - 1; g >= 0; g--)
              ((I = (I + (255 & t[g])) | 0), (t[g] = 255 & I), (I >>>= 8));
            ({ s0: S, s1: i, s2: r, s3: h } = a(C, n[0], n[1], n[2], n[3]));
          }
          let c = 16 * Math.floor(K.length / 4);
          if (c < e) {
            let g = new Uint32Array([S, i, r, h]),
              I = new Uint8Array(g.buffer);
            for (let g = c, A = 0; g < e; g++, A++) B[g] = o[g] ^ I[A];
            A(g);
          }
          return B;
        })(o, t, n);
      } finally {
        (A(t), n !== B && A(n));
      }
    }
    function s(g) {
      return new DataView(g.buffer, g.byteOffset, g.byteLength);
    }
    function c(g, I) {
      return (g << (32 - I)) | (g >>> I);
    }
    function Q(g, I, A) {
      return (g & I) ^ (~g & A);
    }
    function w(g, I, A) {
      return (g & I) ^ (g & A) ^ (I & A);
    }
    const l = Uint32Array.from([
      1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225,
    ]);
    var R = Uint32Array.from([
        1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
        3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
        3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
        2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
        666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
        2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
        430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
        1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479,
        3329325298,
      ]),
      M = new Uint32Array(64),
      G = class {
        constructor() {
          ((this.length = 0),
            (this.pos = 0),
            (this.buffer = new Uint8Array(64)),
            (this.view = s(this.buffer)),
            this.set(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7]));
        }
        update(g) {
          const { view: I, buffer: C } = this,
            E = g.length;
          for (let A = 0; A < E;) {
            const o = Math.min(64 - this.pos, E - A);
            if (64 === o) {
              const I = s(g);
              for (; 64 <= E - A; A += 64) this.process(I, A);
              continue;
            }
            (C.set(g.subarray(A, A + o), this.pos),
              (this.pos += o),
              (A += o),
              64 === this.pos && (this.process(I, 0), (this.pos = 0)));
          }
          return ((this.length += g.length), A(M), this);
        }
        digest() {
          const { buffer: g, view: I, pos: C } = this;
          ((g[C] = 128),
            g.fill(0, C + 1),
            C >= 56 && (this.process(I, 0), g.fill(0)),
            I.setBigUint64(56, BigInt(8 * this.length), !1),
            this.process(I, 0));
          const E = new Uint8Array(32),
            o = s(E),
            { A: e, B, C: t, D: n, E: S, F: i, G: r, H: h } = this,
            a = [e, B, t, n, S, i, r, h];
          for (let g = 0; g < 8; g++) o.setUint32(4 * g, a[g], !1);
          return (this.set(0, 0, 0, 0, 0, 0, 0, 0), A(g), E);
        }
        set(g, I, A, C, E, o, e, B) {
          ((this.A = 0 | g),
            (this.B = 0 | I),
            (this.C = 0 | A),
            (this.D = 0 | C),
            (this.E = 0 | E),
            (this.F = 0 | o),
            (this.G = 0 | e),
            (this.H = 0 | B));
        }
        process(g, I) {
          for (let A = 0; A < 16; A++, I += 4) M[A] = g.getUint32(I, !1);
          for (let g = 16; g < 64; g++) {
            let I = M[g - 15],
              A = M[g - 2],
              C = c(I, 7) ^ c(I, 18) ^ (I >>> 3),
              E = c(A, 17) ^ c(A, 19) ^ (A >>> 10);
            M[g] = (E + M[g - 7] + C + M[g - 16]) | 0;
          }
          let { A, B: C, C: E, D: o, E: e, F: B, G: t, H: n } = this;
          for (let g = 0; g < 64; g++) {
            let I = (n + (c(e, 6) ^ c(e, 11) ^ c(e, 25)) + Q(e, B, t) + R[g] + M[g]) | 0,
              S = ((c(A, 2) ^ c(A, 13) ^ c(A, 22)) + w(A, C, E)) | 0;
            ((n = t),
              (t = B),
              (B = e),
              (e = (o + I) | 0),
              (o = E),
              (E = C),
              (C = A),
              (A = (I + S) | 0));
          }
          ((A = (A + this.A) | 0),
            (C = (C + this.B) | 0),
            (E = (E + this.C) | 0),
            (o = (o + this.D) | 0),
            (e = (e + this.E) | 0),
            (B = (B + this.F) | 0),
            (t = (t + this.G) | 0),
            (n = (n + this.H) | 0),
            this.set(A, C, E, o, e, B, t, n));
        }
      };
    return {
      CryptoContext: class {
        constructor(o) {
          ((this.expandedKey = (function (o) {
            g(o);
            let e = o.length;
            if (![16, 24, 32].includes(e))
              throw new Error("aes: invalid key size, should be 16, 24 or 32, got " + e);
            let { sbox2: t } = S,
              n = [];
            C(o) || n.push((o = E(o)));
            let r = I(o),
              a = r.length,
              K = (g) => h(t, g, g, g, g),
              s = new Uint32Array(e + 28);
            s.set(r);
            for (let g = a; g < s.length; g++) {
              let I = s[g - 1];
              (g % a === 0 ? (I = K(B(I)) ^ i[g / a - 1]) : a > 6 && g % a === 4 && (I = K(I)),
                (s[g] = s[g - a] ^ I));
            }
            return (A(...n), s);
          })(o.slice(0, 16))),
            (this.hmacKey = o.slice(16)));
        }
        signature(g) {
          const I = new Uint8Array(64);
          I.set(this.hmacKey.length > 64 ? new G().update(this.hmacKey).digest() : this.hmacKey);
          for (let g = 0; g < I.length; g++) I[g] ^= 54;
          const C = new G().update(I).update(g).update(this.iv).digest();
          for (let g = 0; g < I.length; g++) I[g] ^= 106;
          const E = new G().update(I).update(C).digest();
          return (A(I, C), E);
        }
        decrypt(g) {
          if (
            ((this.iv = g.iv),
            !(function (g, I) {
              if (g.length !== I.length) return !1;
              let A = 0;
              for (let C = 0; C < g.length; C++) A |= g[C] ^ I[C];
              return 0 === A;
            })(this.signature(g.encryptedContent), g.hmac))
          )
            throw new Error("HMAC verification failed");
          return K(this.expandedKey, this.iv, g.encryptedContent);
        }
        encrypt(g) {
          const I = K(this.expandedKey, this.iv, g);
          return { encryptedContent: I, hmac: this.signature(I) };
        }
      },
    };
  })();
  }

  async function decryptUmp(body, options, keys) {
    let contexts;
    const EncryptedPart = messageCodec("EncryptedResponsePart", EAGER_TYPES.ump);
    const Onesie = messageCodec("OnesieInnertubeResponse", EAGER_TYPES.ump);
    const reader = new UmpReader(body);
    const out = [];
    const players = [];
    let changed = false;
    let expectingEncrypted = false;

    async function processPart(partBytes) {
      const envelope = EncryptedPart.fromBinary(partBytes);
      if (!(envelope.encryptedContent instanceof Uint8Array) || 16 !== envelope.iv?.length || 32 !== envelope.hmac?.length) {
        throw new Error("Malformed encrypted UMP envelope");
      }
      if ((envelope.compressionAlgorithm ?? 0) > 1) throw new Error("Unsupported UMP compression");

      if (!contexts) {
        const { CryptoContext } = createUmpCrypto();
        contexts = keys.map((key) => new CryptoContext(key));
      }

      let plaintext;
      let context;
      for (const candidate of contexts) {
        try {
          plaintext = candidate.decrypt(envelope);
          context = candidate;
          break;
        } catch (e) {
          if ("HMAC verification failed" !== e.message) throw e;
        }
      }
      if (!plaintext || !context) throw new Error("HMAC verification failed");

      const isGzip = 31 === plaintext[0] && 139 === plaintext[1];
      if (1 === envelope.compressionAlgorithm && !isGzip) throw new Error("Invalid UMP gzip payload");

      const decoded = isGzip ? await gzipStream(plaintext, true) : plaintext;
      const response = Onesie.fromBinary(decoded);

      if (false !== options.autoHd) {
        for (const item of response.contents) if (item.player) players.push(item.player);
      }

      const modified = (function (node, opts) {
        let result = false;
        for (const item of node.contents) {
          if (item.player) result = rewritePlayer(item.player, opts) || result;
          if (item.next) result = filterBrowseTree(item.next, opts) || result;
        }
        return result;
      })(response, options);
      if (!modified) return partBytes;

      const reencoded = Onesie.toBinary(response);
      if (bytesEqual(reencoded, decoded)) return partBytes;

      const recompressed = isGzip ? await gzipStream(reencoded, false) : reencoded;
      const encrypted = context.encrypt(recompressed);
      setField(envelope, "encryptedContent", encrypted.encryptedContent);
      setField(envelope, "hmac", encrypted.hmac);
      return EncryptedPart.toBinary(envelope);
    }

    for (; reader.hasNext; ) {
      const part = reader.readPart();
      if (10 === part.type) {
        const marker = parseFields(part.data).find((field) => 1 === field.no && 0 === field.wire);
        expectingEncrypted = !!marker && 25 === readVarintValue(marker.data);
      } else if (11 === part.type && expectingEncrypted) {
        part.data = await processPart(part.data);
        expectingEncrypted = false;
      }

      if (part.data === part.originalData) {
        out.push(part.raw);
      } else {
        changed = true;
        const writer = new UmpWriter(part.data.length + 10);
        writer.writePart(part);
        out.push(writer.finish());
      }
    }

    return { body: changed ? concatBytes(out) : body, players };
  }

  //=====================================================================================
  // §13 响应分发
  //=====================================================================================

  const RESPONSE_ROUTES = {
    "navigation/resolve_url": [
      "ResolveUrl",
      function (node, options) {
        const player = node.endpoint?.watch?.embedded?.response?.player;
        return !!player && rewritePlayer(player, options);
      },
    ],
    browse: ["Browse", filterBrowseTree],
    next: ["Next", filterBrowseTree],
    player: ["Player", rewritePlayer],
    search: ["Search", filterBrowseTree],
    "reel/reel_watch_sequence": [
      "Shorts",
      function (node, options) {
        if (false === options.blockShortsAds) return false;
        const kept = node.entries.filter((entry) => !entry.command?.reelWatchEndpoint?.adClientParams?.isAd);
        const changed = kept.length !== node.entries.length;
        if (changed) setField(node, "entries", kept);
        return changed;
      },
    ],
    guide: [
      "Guide",
      function (node, options) {
        const hidden = new Set(options.hiddenGuideItems ?? []);
        let changed = false;
        walkObjects(node, (item) => {
          const items = item.rendererItems;
          if (!Array.isArray(items)) return;
          const kept = items.filter((entry) => !hidden.has(entry.iconRender?.browseId ?? entry.labelRender?.browseId));
          changed = kept.length !== items.length || changed;
          if (kept.length !== items.length) setField(item, "rendererItems", kept);
        });
        return changed;
      },
    ],
    "account/get_setting": [
      "Setting",
      function (node, options) {
        if (false === options.backgroundPlay) return false;
        let changed = false;

        walkObjects(node, (item) => {
          if (10135 !== item.categoryId) return;
          const endpoint = (value) => ({
            setClientSettingEndpoint: { settingData: { clientSettingEnum: { item: 151 }, boolValue: value } },
          });
          const exists = item.subSettings.some(
            (entry) => 151 === entry.settingBooleanRenderer?.enableServiceEndpoint?.setClientSettingEndpoint?.settingData?.clientSettingEnum?.item,
          );
          if (exists) return;
          changed = true;
          setField(item, "subSettings", [
            ...item.subSettings,
            { settingBooleanRenderer: { itemId: 0, enableServiceEndpoint: endpoint(true), disableServiceEndpoint: endpoint(false) } },
          ]);
        });

        const renderer = node.settingItems.find((item) => item.backgroundPlayBackSettingRenderer)?.backgroundPlayBackSettingRenderer;
        if (renderer) {
          changed = setField(renderer, "backgroundPlayback", true) || changed;
        } else {
          changed = true;
          setField(node, "settingItems", [
            ...node.settingItems,
            { backgroundPlayBackSettingRenderer: { backgroundPlayback: true, icon: { iconType: 1093 } } },
          ]);
        }
        return changed;
      },
    ],
    get_watch: [
      "Watch",
      function (node, options) {
        let changed = false;
        for (const item of node.contents) {
          if (item.player) changed = rewritePlayer(item.player, options) || changed;
          if (item.next) changed = filterBrowseTree(item.next, options) || changed;
        }
        return changed;
      },
    ],
  };

  function responseHeader(name) {
    const headers = $response.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) return String(value ?? "");
    }
    return "";
  }

  // 网页版 youtubei 返回 JSON；不能拿 protobuf 解码器硬解。
  function responseLooksJson(raw) {
    if ("string" == typeof raw) return /^\s*[\[{]/.test(raw);
    const bytes = toBytes(raw);
    if (!bytes?.length) return false;
    let i = 0;
    while (i < bytes.length && (32 === bytes[i] || 9 === bytes[i] || 10 === bytes[i] || 13 === bytes[i])) i++;
    return 123 === bytes[i] || 91 === bytes[i];
  }

  function handleYouTubeiJsonResponse(route, raw) {
    try {
      const text = "string" == typeof raw ? raw : new TextDecoder().decode(toBytes(raw));
      if (!text || text.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }
      const data = JSON.parse(text);
      const options = readOptions();
      if (isMusicRequest($request) && false === options.youtubeMusic) {
        $done({});
        return;
      }
      if (!rewriteJsonRoute(route, data, options)) {
        $done({});
        return;
      }
      const out = JSON.stringify(data);
      $done(out === text ? {} : { body: out });
    } catch (e) {
      $done({});
    }
  }

  function handleYouTubeiResponse() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const handler = Object.hasOwn(RESPONSE_ROUTES, route) && RESPONSE_ROUTES[route];
      if (!handler || Number($response.status) >= 300) {
        $done({});
        return;
      }
      if (isWebRequest($request) && false === readOptions().web) {
        $done({});
        return;
      }

      if (/json/i.test(responseHeader("content-type")) || responseLooksJson($response.body)) {
        handleYouTubeiJsonResponse(route, $response.body);
        return;
      }

      const body = toBytes($response.body);
      if (!body?.length || body.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }

      const [typeName, rewrite] = handler;
      const codec = messageCodec(typeName);
      const node = codec.fromBinary(body);
      const options = readOptions();
      if (isMusicRequest($request) && false === options.youtubeMusic) {
        $done({});
        return;
      }

      if (false !== options.autoHd) {
        const players = (function () {
          if ("Player" === typeName) return [node];
          if ("Watch" === typeName) return node.contents.map((item) => item.player).filter(Boolean);
          if ("ResolveUrl" === typeName) {
            const player = node.endpoint?.watch?.embedded?.response?.player;
            return player ? [player] : [];
          }
          return [];
        })();
        updateQualityCache(players, options);
      }

      $done(rewrite(node, options) ? { body: codec.toBinary(node) } : {});
    } catch (e) {
      $done({});
    }
  }

  async function handleUmpResponse() {
    try {
      const body = toBytes($response.body);
      if (Number($response.status) >= 300 || !body?.length || body.length > MAX_UMP_RESPONSE_BYTES) {
        $done({});
        return;
      }

      const contentType = Object.entries($response.headers ?? {}).find(([key]) => "content-type" === key.toLowerCase())?.[1];
      if (contentType && !/^application\/vnd\.yt-ump(?:\s*;|\s*$)/i.test(contentType)) {
        $done({});
        return;
      }

      const options = readOptions();
      if (isMusicRequest($request) && false === options.youtubeMusic) {
        $done({});
        return;
      }
      const stored = readStore()[clientKeyFor($request)];
      // clientKey 本身就是 32 字节：前 16 字节做 AES-256 密钥，后 16 字节做 HMAC 密钥。
      // encryptKey 只用来校验 initplayback 请求体，不参与解密。
      const keys = (stored ? [stored, ...(Array.isArray(stored.previous) ? stored.previous.slice(0, 3) : [])] : [])
        .filter(
          (entry) =>
            entry &&
            "string" == typeof entry.clientKey &&
            "string" == typeof entry.encryptKey &&
            entry.clientKey.length > 0 &&
            entry.clientKey.length <= 5500 &&
            entry.encryptKey.length > 0 &&
            entry.encryptKey.length <= 5500,
        )
        .map((entry) => base64ToBytes(entry.clientKey))
        .filter((key) => key.length >= 16);
      if (!keys.length) throw new Error("YouTubeConfig requires a valid stored clientKey");

      const result = await decryptUmp(body, options, keys);
      if (false !== options.autoHd) updateQualityCache(result.players, options);
      $done(result.body === body ? {} : { body: result.body });
    } catch (e) {
      // 运行时缺少 CompressionStream / DecompressionStream（部分 Shadowrocket 版本）时，
      // 回空响应会让视频直接播不了；原样放行，最多是 UMP 段广告没去掉。
      if ("undefined" == typeof CompressionStream || "undefined" == typeof DecompressionStream) {
        $done({});
        return;
      }
      $done({ status: 200, headers: { "Content-Type": "text/plain" }, body: new Uint8Array() });
    }
  }

  // 入口：youtubei 常规响应 + initplayback 的 UMP 响应。
  (function main() {
    const request = (typeof $request !== "undefined" && $request) || {};
    const response = typeof $response !== "undefined" && $response ? $response : undefined;
    const url = (response && response.url) || request.url || "";
    if (!url || !response) {
      $done({});
      return;
    }
    if (/\/initplayback(?:\?|$)/.test(url)) {
      handleUmpResponse();
      return;
    }
    handleYouTubeiResponse();
  })();

})();
