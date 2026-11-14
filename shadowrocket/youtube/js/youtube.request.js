//=======================================================================================
// YouTube Enhance — 请求阶段（ad_break / log_event / initplayback / videoplayback）
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

  // 上一版 Loon 位置数组（12 项，含 on_the_go）。升级插件前客户端可能还缓存着
  // 旧 tuple；按长度区分，避免 12 项数组被当成 26 项旧版参数串位。
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
          : raw.length === PREV_ARG_ORDER.length
            ? PREV_ARG_ORDER
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

    const result = { ...defaults, ...options };
    if (noDefaults) OPTIONS_CACHE = result;
    return result;
  }

  //=====================================================================================
  // §11 请求改写
  //=====================================================================================

  function emptyProtobufResponse() {
    return { response: { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: new Uint8Array() } };
  }

  function readRequestBody(request) {
    const body = request.body;
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (body?.length) throw new Error("YouTube requires binary-body-mode for request bodies");
    const contentLength = Object.entries(request.headers ?? {}).find(([key]) => "content-length" === key.toLowerCase())?.[1];
    if (Number(contentLength) > 0) throw new Error("YouTube request body unavailable; requires-body must be enabled");
  }

  // 把请求里的 itag 相关字段改成缓存里的目标值；quality 为空表示只要最高分辨率。
  function applyQuality(bytes, quality) {
    const targets = new Map(
      quality
        ? [
            [13, 0],
            [14, 2],
            [16, quality.height],
            [21, quality.height],
            [26, 3],
            [30, 0],
          ]
        : [
            [16, Math.max(144, Math.min(4320, parseInt(readOptions().maxHeight) || 4320))],
            [26, 1],
            [30, 0],
          ],
    );

    const touched = new Set();
    const parts = [];
    let changed = false;

    for (const field of parseFields(bytes)) {
      const target = 0 === field.wire ? targets.get(field.no) : void 0;
      if (void 0 !== target) {
        if (readVarintValue(field.data) === target) {
          parts.push(field.raw);
        } else {
          parts.push(encodeVarint(8 * field.no), encodeVarint(target));
          changed = true;
        }
        touched.add(field.no);
      } else {
        parts.push(field.raw);
      }
    }

    for (const [fieldNo, value] of targets) {
      if (!touched.has(fieldNo)) {
        parts.push(encodeVarint(8 * fieldNo), encodeVarint(value));
        changed = true;
      }
    }
    return changed ? concatBytes(parts) : bytes;
  }

  function removeStoredKey(key, stored) {
    if (void 0 === key || void 0 === stored) return;
    const config = readStore();
    if (!Object.hasOwn(config, key)) return;
    if (JSON.stringify(config[key]) === JSON.stringify(stored)) {
      delete config[key];
      writeStore(config);
    }
  }

  // initplayback 请求：校验请求里带的密钥是不是我们存的；不匹配就回空，让客户端重协商。
  function handleInitPlaybackRequest(request, options) {
    const body = readRequestBody(request);
    if (void 0 === body || 0 === body.length) return undefined;

    const key = clientKeyFor(request);
    const stored = readStore()[key];
    const outer = fieldData(body, 3);
    const inner = outer && fieldData(outer, 5);
    if (!inner?.length) return emptyProtobufResponse();

    const candidates = stored
      ? [stored, ...(Array.isArray(stored.previous) ? stored.previous.slice(0, 3) : [])].filter(
          (entry) =>
            entry &&
            "string" == typeof entry.clientKey &&
            "string" == typeof entry.encryptKey &&
            entry.clientKey.length > 0 &&
            entry.clientKey.length <= 5500 &&
            entry.encryptKey.length > 0 &&
            entry.encryptKey.length <= 5500,
        )
      : [];
    for (const entry of candidates) {
      try {
        if (bytesEqual(inner, base64ToBytes(entry.encryptKey))) return undefined;
      } catch {}
    }

    removeStoredKey(key, stored);
    return emptyProtobufResponse();
  }

  // 只有一条 chunk 的 initplayback 请求：把画质字段改成最高档。
  function rewriteInitPlaybackBody(body) {
    const fields = parseFields(body);
    const chunks = fields.filter((field) => 2 === field.no && 2 === field.wire);
    if (1 !== chunks.length) return body;

    const chunk = chunks[0];
    const next = applyQuality(chunk.data, void 0);
    if (next === chunk.data) return body;
    return concatBytes(fields.map((field) => (field === chunk ? concatBytes([encodeVarint(18), encodeVarint(next.length), next]) : field.raw)));
  }

  // videoplayback 请求：按缓存挑一组 itag，替换请求里的 17 号字段。
  function rewriteVideoPlaybackBody(body, url) {
    const fields = parseFields(body);

    const quality = (function () {
      try {
        const match = /[?&]id=([^&]+)/.exec(url);
        if (!match) return;

        const chunk = fields.find((field) => 5 === field.no && 2 === field.wire);
        const inner = chunk && fieldData(chunk.data, 1);
        if (!inner?.length) return;

        const cached = readStore(QUALITY_KEY, MAX_QUALITY_JSON)?.[decodeURIComponent(match[1])];
        if (!isQualityEntry(cached)) return;

        const formats = [];
        const premiumFormats = [];
        for (const format of parseFields(inner)) {
          if (6 !== format.no || 2 !== format.wire) continue;
          const itagField = parseFields(format.data).find((field) => 1 === field.no && 0 === field.wire);
          if (!itagField) continue;
          const itag = readVarintValue(itagField.data);
          if (!cached.itags.includes(itag)) continue;
          formats.push(format.data);
          if (cached.premiumItags?.includes(itag)) premiumFormats.push(format.data);
        }
        return formats.length ? { height: cached.height, formats: premiumFormats.length && false !== readOptions().preferPremium ? premiumFormats : formats } : void 0;
      } catch {
        return;
      }
    })();

    const existing = fields.filter((field) => 17 === field.no && 2 === field.wire);
    const replaceFormats = quality && (existing.length !== quality.formats.length || existing.some((field, i) => !bytesEqual(field.data, quality.formats[i])));

    const parts = [];
    let sawChunk = false;
    let changed = !!replaceFormats;

    for (const field of fields) {
      if (1 === field.no && 2 === field.wire) {
        const next = applyQuality(field.data, quality);
        if (next === field.data) {
          parts.push(field.raw);
        } else {
          parts.push(encodeVarint(10), encodeVarint(next.length), next);
          changed = true;
        }
        sawChunk = true;
      } else {
        if (replaceFormats && 17 === field.no && 2 === field.wire) continue;
        parts.push(field.raw);
      }
    }

    if (!sawChunk) {
      const empty = applyQuality(new Uint8Array(), quality);
      parts.push(encodeVarint(10), encodeVarint(empty.length), empty);
      changed = true;
    }
    if (replaceFormats) {
      for (const format of quality.formats) parts.push(encodeVarint(138), encodeVarint(format.length), format);
    }
    return changed ? concatBytes(parts) : body;
  }

  // log_event 请求：删掉热更新哈希头，避免服务端用新配置覆盖模块。
  function stripHotHashHeader(request, options) {
    if (false === options.stripHotHash) return undefined;

    const headers = Object.keys(request.headers ?? {}).filter((key) => "x-youtube-hot-hash-data" === key.toLowerCase());
    if (!headers.length || readStore()[clientKeyFor(request)]?.clientKey) return undefined;

    const next = { ...request.headers };
    for (const key of headers) delete next[key];
    return { headers: next };
  }

  function handleRequest(request) {
    const path = request.url.split("?")[0];

    try {
      // 参数解析也放进 try：任何异常都不能让 ad_break 漏过去。
      const options = readOptions();
      const musicDisabled = isMusicRequest(request) && false === options.youtubeMusic;

      if (path.endsWith("/ad_break")) {
        $done(!musicDisabled && false !== options.blockPlayerAds ? emptyProtobufResponse() : undefined);
        return;
      }
      if (path.endsWith("/log_event")) {
        $done(stripHotHashHeader(request, options));
        return;
      }
      if (path.endsWith("/initplayback")) {
        if (musicDisabled) {
          $done(undefined);
          return;
        }
        let result = handleInitPlaybackRequest(request, options);
        const body = readRequestBody(request);
        if (!result && body?.length && false !== options.autoHd) {
          const rewritten = rewriteInitPlaybackBody(body);
          if (rewritten !== body) result = { body: rewritten };
        }
        $done(result);
        return;
      }
      if (path.endsWith("/videoplayback")) {
        if (musicDisabled) {
          $done(undefined);
          return;
        }
        const body = false === options.autoHd ? undefined : readRequestBody(request);
        if (body?.length) {
          const rewritten = rewriteVideoPlaybackBody(body, request.url);
          $done(rewritten !== body ? { body: rewritten } : undefined);
          return;
        }
      }
      $done(undefined);
    } catch (e) {
      // ad_break / initplayback 失败时也要给出空响应，避免退回服务端广告或原始数据。
      $done(path.endsWith("/ad_break") || path.endsWith("/initplayback") ? emptyProtobufResponse() : {});
    }
  }

  // 入口：只处理请求阶段。插件已按 URL 分流，这里不再判断响应。
  (function main() {
    const request = (typeof $request !== "undefined" && $request) || {};
    if (!request.url) {
      $done({});
      return;
    }
    handleRequest(request);
  })();

})();
