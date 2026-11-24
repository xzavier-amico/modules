//=======================================================================================
// YouTube Enhance — UMP 密钥提取（config / log_event 响应）
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
  // §1 常量
  //=====================================================================================

  const CONFIG_KEY = "YouTubeConfig"; // clientKey / encryptKey 缓存
  const QUALITY_KEY = "YouTubeQuality"; // 视频 id -> 可用 itag 缓存
  // 超过上限的响应直接放行：解码 / 重编码会占用数倍于原始大小的内存，宁可漏改也不能把 Loon 打崩。
  // player / browse 响应大多在 1 MiB 以内，8 MiB 留有很大余量。
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  // UMP 还要解密、解压、重编码、再加密，内存峰值更高，保持 5 MiB。
  const MAX_UMP_RESPONSE_BYTES = 5 * 1024 * 1024;
  const MAX_QUALITY_JSON = 65536; // 画质缓存序列化后的上限
  const MAX_QUALITY_ENTRIES = 16; // 画质缓存保留的视频数

  const textEncoder = new TextEncoder();
  const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
  const looseUtf8 = new TextDecoder("utf-8");

  // 用来在字节流里认东西的标记。
  // PAyouchat 是 YouTube Ask AI（YouChat）面板的 targetId；SPunlimited 是 Premium 入口/推广标识。
  const ASK_AI_MARKER = textEncoder.encode("PAyouchat");
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

  // App 里 Shorts 卡片/货架的 element 标识（uYou / YTLite 用的也是这几个）。
  // 最后一个是 reelWatchEndpoint 的字段标签：混在推荐流里的单个 Shorts 卡片。
  const SHORTS_MARKERS = [
    textEncoder.encode("shorts_video_cell"),
    textEncoder.encode("shorts_shelf"),
    new Uint8Array([0x8a, 0x9f, 0xc8, 0x94, 0x04]),
  ];

  // 播放页的评论区面板：engagementPanels 里靠这两个内部标识认出来，
  // 和网页版 JSON 的 sectionIdentifier 是同一套名字，不随界面语言变化。
  const COMMENT_PANEL_MARKERS = [textEncoder.encode("comment-item-section"), textEncoder.encode("comments-section")];

  // 会员专属徽章的文案，用来在列表里认出会员视频。
  // App 的 protobuf 里只有本地化文案（枚举是 varint，脚本里没为它建模），
  // 所以原生端按这几种语言的徽章文字精确匹配；网页版 JSON 有 style 枚举，
  // 优先按 BADGE_STYLE_TYPE_MEMBERS_ONLY 判定，文案只作兜底。
  const MEMBERS_ONLY_LABELS = [
    "Members only",
    "会员专享",
    "會員專享",
    "メンバー限定",
    "멤버 전용",
  ];
  const MEMBERS_ONLY_LABEL_BYTES = MEMBERS_ONLY_LABELS.map((label) => textEncoder.encode(label));
  const MAX_MEMBERS_LABEL_BYTES = 64;

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

  const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64DecodeTable;

  function decodeBase64Fallback(clean) {
    if (!base64DecodeTable) {
      base64DecodeTable = new Int16Array(128).fill(-1);
      for (let i = 0; i < BASE64_CHARS.length; i++) base64DecodeTable[BASE64_CHARS.charCodeAt(i)] = i;
    }
    const len = clean.length;
    const outLen = Math.floor((len * 3) / 4);
    const out = new Uint8Array(outLen);
    let pos = 0;
    for (let i = 0; i < len; i += 4) {
      const c0 = clean.charCodeAt(i);
      const c1 = i + 1 < len ? clean.charCodeAt(i + 1) : 65;
      const c2 = i + 2 < len ? clean.charCodeAt(i + 2) : 65;
      const c3 = i + 3 < len ? clean.charCodeAt(i + 3) : 65;
      const a = c0 < 128 ? base64DecodeTable[c0] : -1;
      const b = c1 < 128 ? base64DecodeTable[c1] : -1;
      const c = c2 < 128 ? base64DecodeTable[c2] : -1;
      const d = c3 < 128 ? base64DecodeTable[c3] : -1;
      if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("Invalid base64");
      const n = (a << 18) | (b << 12) | (c << 6) | d;
      if (pos < outLen) out[pos++] = (n >> 16) & 255;
      if (pos < outLen) out[pos++] = (n >> 8) & 255;
      if (pos < outLen) out[pos++] = n & 255;
    }
    return out;
  }

  function bytesToBase64(bytes) {
    if ("function" == typeof bytes.toBase64) return bytes.toBase64();
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += BASE64_CHARS[b0 >> 2];
      out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=";
      out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : "=";
    }
    return out;
  }

  // YouTube 的 params 是 URL-safe base64，去掉填充后长度可能差一位；
  // 兼容缺少 Uint8Array.fromBase64 的旧版 JSC（iOS < 18.2 的 Loon / Egern）。
  function base64ToBytes(text) {
    const normalized = text.replace(/[-_\s=]/g, (ch) => (ch === "-" ? "+" : ch === "_" ? "/" : ""));
    const needsPad = normalized.length % 4 === 1;
    const input = needsPad ? normalized + "A" : normalized;
    const bytes = "function" == typeof Uint8Array.fromBase64 ? Uint8Array.fromBase64(input) : decodeBase64Fallback(input);
    return needsPad ? bytes.subarray(0, -1) : bytes;
  }

  // 在字节流里找一段子串：全程走原生 TypedArray.indexOf（C++/SIMD），
  // 先校验尾字节过滤掉绝大多数假命中，避免退化成纯 JS 逐字节循环。
  function containsBytes(haystack, needle = PAGEAD_MARKER) {
    const nLen = needle.length;
    if (!nLen) return true;
    const lastStart = haystack.length - nLen;
    if (lastStart < 0) return false;
    const first = needle[0];
    if (1 === nLen) return haystack.indexOf(first) >= 0;
    const lastIdx = nLen - 1;
    const last = needle[lastIdx];
    for (let start = haystack.indexOf(first); start >= 0 && start <= lastStart; start = haystack.indexOf(first, start + 1)) {
      if (haystack[start + lastIdx] !== last) continue;
      let hit = true;
      for (let i = 1; i < lastIdx; i++) {
        if (haystack[start + i] !== needle[i]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
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

  // 取第一个（或最后一个）指定 wire-2 字段的值；走流式扫描避免构建完整字段数组。
  function fieldData(bytes, fieldNo, last = false) {
    let foundStart = -1;
    let foundEnd = -1;
    wireForEachField(bytes, (no, wire, dataStart, dataEnd) => {
      if (no === fieldNo && 2 === wire) {
        foundStart = dataStart;
        foundEnd = dataEnd;
        if (!last) return true;
      }
      return false;
    });
    return foundStart >= 0 ? bytes.subarray(foundStart, foundEnd) : undefined;
  }

  // 取第一个指定 wire-0 字段的 varint 数值；找不到返回 undefined。
  function firstVarintField(bytes, fieldNo) {
    let result;
    wireForEachField(bytes, (no, wire, dataStart, dataEnd) => {
      if (no === fieldNo && 0 === wire) {
        result = readVarintValue(bytes.subarray(dataStart, dataEnd));
        return true;
      }
      return false;
    });
    return result;
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
  // 默认匹配 ASK_AI_MARKER（PAyouchat），用于识别 Ask AI 的命令/面板路径。
  function matchesPath(bytes, path, marker = ASK_AI_MARKER, prefixOnly = false, depth = 0) {
    if (depth >= path.length) {
      if (prefixOnly) return bytes.length >= marker.length && bytesEqual(bytes.subarray(0, marker.length), marker);
      return bytesEqual(bytes, marker);
    }
    const targetNo = path[depth];
    return wireForEachField(
      bytes,
      (no, wire, dataStart, dataEnd) => no === targetNo && 2 === wire && matchesPath(bytes.subarray(dataStart, dataEnd), path, marker, prefixOnly, depth + 1),
    );
  }

  // 对某个字段的每个出现位置跑一次 rewriter，返回 undefined 表示整条删掉。
  function rewriteRepeatedField(bytes, fieldNo, rewriter) {
    let changed = false;
    const fields = parseFields(bytes);
    const parts = [];
    for (const field of fields) {
      if (field.no !== fieldNo || 2 !== field.wire) {
        parts.push(field.raw);
        continue;
      }
      const next = rewriter(field.data);
      if (next && bytesEqual(next, field.data)) {
        parts.push(field.raw);
      } else {
        changed = true;
        if (next) parts.push(encodeField([fieldNo, "", "bytes"], next));
      }
    }
    return changed ? concatBytes(parts) : bytes;
  }

  // 按路径下钻，对命中位置的字节跑 rewriter。
  function rewritePath(bytes, path, rewriter, depth = 0) {
    if (depth >= path.length) return rewriter(bytes);
    const targetNo = path[depth];
    let changed = false;
    const fields = parseFields(bytes);
    const parts = new Array(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (field.no !== targetNo || 2 !== field.wire) {
        parts[i] = field.raw;
        continue;
      }
      const next = rewritePath(field.data, path, rewriter, depth + 1);
      if (bytesEqual(next, field.data)) {
        parts[i] = field.raw;
      } else {
        changed = true;
        parts[i] = encodeField([field.no, "", "bytes"], next);
      }
    }
    return changed ? concatBytes(parts) : bytes;
  }

  const WEB_HOST_RE = /^https?:\/\/(?:www|m|music)\.youtube\.com(?:\/|$)/i;
  const MUSIC_HOST_RE = /^https?:\/\/music\.youtube\.com(?:\/|$)/i;

  let cachedReqInfoRef = null;
  let cachedReqInfo = null;

  function inspectRequest(request) {
    if (request && request === cachedReqInfoRef) return cachedReqInfo;
    const url = String(request?.url ?? "");
    let isMusic = MUSIC_HOST_RE.test(url);
    let isWeb = WEB_HOST_RE.test(url);
    const headers = request?.headers;
    if (headers && (!isMusic || !isWeb)) {
      for (const key in headers) {
        if (!Object.hasOwn(headers, key)) continue;
        const name = key.toLowerCase();
        const text = String(headers[key] ?? "");
        if (!isMusic) {
          if ("user-agent" === name && /music/i.test(text)) isMusic = true;
          // WEB_REMIX（YouTube Music Web/iOS 的 InnerTube 客户端）的 client-name 是 67。
          else if ("x-youtube-client-name" === name && ("67" === text.trim() || /music|remix/i.test(text))) isMusic = true;
          else if ("x-youtube-client-version" === name && /music|remix/i.test(text)) isMusic = true;
          else if (("origin" === name || "referer" === name) && MUSIC_HOST_RE.test(text)) isMusic = true;
        }
        if (!isWeb && ("origin" === name || "referer" === name) && WEB_HOST_RE.test(text)) isWeb = true;
        if (isMusic && isWeb) break;
      }
    }
    const info = { isMusic, isWeb };
    if (request && "object" == typeof request) {
      cachedReqInfoRef = request;
      cachedReqInfo = info;
    }
    return info;
  }

  // 判断请求是不是 YouTube Music（iOS App 的 UA / client-name，以及网页版 URL / Origin / Referer）。
  function isMusicRequest(request) {
    return inspectRequest(request).isMusic;
  }

  // 网页版 YouTube / YouTube Music；含从网页发往 googlevideo.com 的播放请求（看 Origin / Referer）。
  function isWebRequest(request) {
    return inspectRequest(request).isWeb;
  }

  function clientKeyFor(request) {
    return isMusicRequest(request) ? "youtubeMusic" : "youtube";
  }

  //=====================================================================================
  // §12 从 config / log_event 响应里抓 UMP 密钥
  //=====================================================================================

  function extractUmpKeys() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const body = toBytes($response.body);
      // UMP 密钥路径深达 5 层且含 32+16 字节密钥，总长至少 56 字节；JSON 响应（0x7b '{'）或短响应直接跳过。
      if (("config" !== route && "log_event" !== route) || !body || body.length < 56 || body.length > MAX_RESPONSE_BYTES || 123 === body[0]) {
        $done({});
        return;
      }

      let current = body;
      for (const fieldNo of [1, 16, 7, 138536474, 146311580]) {
        current = fieldData(current, fieldNo, true);
        if (!current) {
          $done({});
          return;
        }
      }

      const clientKey = fieldData(current, 1, true);
      const encryptKey = fieldData(current, 2, true);
      if (clientKey?.length && encryptKey?.length && clientKey.length <= 4096 && encryptKey.length <= 4096) {
        const key = clientKeyFor($request);
        const config = readStore();
        const entry = { clientKey: bytesToBase64(clientKey), encryptKey: bytesToBase64(encryptKey) };

        if (config[key]?.clientKey !== entry.clientKey || config[key]?.encryptKey !== entry.encryptKey) {
          const previous = (
            config[key]
              ? [config[key], ...(Array.isArray(config[key].previous) ? config[key].previous.slice(0, 3) : [])].filter(
                  (item) =>
                    item &&
                    "string" == typeof item.clientKey &&
                    "string" == typeof item.encryptKey &&
                    item.clientKey.length > 0 &&
                    item.clientKey.length <= 5500 &&
                    item.encryptKey.length > 0 &&
                    item.encryptKey.length <= 5500,
                )
              : []
          )
            .filter((item) => item.clientKey !== entry.clientKey || item.encryptKey !== entry.encryptKey)
            .slice(0, 3)
            .map(({ clientKey, encryptKey }) => ({ clientKey, encryptKey }));

          if (previous.length) entry.previous = previous;
          config[key] = entry;
          writeStore(config);
        }
      }
      $done({});
    } catch (e) {
      $done({});
    }
  }

  // 入口：只处理 config / log_event 响应，提取 UMP 密钥。
  (function main() {
    const response = typeof $response !== "undefined" && $response ? $response : undefined;
    if (!response) {
      $done({});
      return;
    }
    extractUmpKeys();
  })();

})();
