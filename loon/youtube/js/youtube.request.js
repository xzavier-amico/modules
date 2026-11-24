//=======================================================================================
// YouTube Enhance — 请求阶段（ad_break / log_event / initplayback / videoplayback）
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


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

  // 编码偏好：any 不过滤，no_av1 去掉 AV1，avc 只留 H.264。
  // 认的是 mimeType 里的 codecs 串（avc1 / av01 / vp9…），与界面语言无关。
  function codecAllowed(mime, codec) {
    const text = String(mime ?? "").toLowerCase();
    if ("avc" === codec) return text.includes("avc1");
    if ("no_av1" === codec) return !text.includes("av01");
    return true;
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
      (void 0 === entry.codec || "any" === entry.codec || "no_av1" === entry.codec || "avc" === entry.codec) &&
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
      (left.codec ?? "any") === (right.codec ?? "any") &&
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
    // 新增参数放在末尾：12 项旧位置数组走 Object.keys 兜底时，前 12 位顺序不能变。
    player_cleanup: "playerCleanup",
    captions_mode: "captionsMode",
    feed_cleanup: "feedCleanup",
    watch_cleanup: "watchCleanup",
    video_codec: "videoCodec",
    web_cleanup: "webCleanup",
    music_cleanup: "musicCleanup",
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

  // 当前 Loon 位置数组（19 项）。
  // 旧长度的位置数组走下面按长度分的兼容表。
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
    "player_cleanup",
    "captions_mode",
    "feed_cleanup",
    "watch_cleanup",
    "video_codec",
    "web_cleanup",
    "music_cleanup",
  ];

  // 旧 tuple 仍可能包含已移除的 block_feed_cards 槽位，读取时忽略该值。
  const REMOVED_FEED_CARDS_ARG_ORDER = [...CURRENT_ARG_ORDER.slice(0, 12), "removedBlockFeedCards", ...CURRENT_ARG_ORDER.slice(12)];
  const FEED_CARDS_ARG_ORDER = [...CURRENT_ARG_ORDER.slice(0, 12), "removedBlockFeedCards"];

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
          : raw.length === REMOVED_FEED_CARDS_ARG_ORDER.length
            ? REMOVED_FEED_CARDS_ARG_ORDER
            : raw.length === PREV_ARG_ORDER.length && "string" == typeof raw[raw.length - 1]
              ? PREV_ARG_ORDER
              : raw.length === FEED_CARDS_ARG_ORDER.length
                ? FEED_CARDS_ARG_ORDER
                : raw.length === CURRENT_ARG_ORDER.length
                  ? CURRENT_ARG_ORDER
                  : // 其他长度（未来少传/多传）按别名表顺序兜底，前缀位置仍然对得上。
                    Object.keys(ARG_ALIASES);
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

  // 多级开关：off 关；基础档（standard / comments）；all 再多做一项。
  // 旧式布尔值也能吃：true = 基础档，false = off。
  function asLevel(value, base) {
    if (true === value) return base;
    if (false === value || 0 === value) return "off";
    const text = String(value ?? "").trim().toLowerCase();
    if (!text || "false" === text || "0" === text || "off" === text || "none" === text || "no" === text) return "off";
    if ("all" === text) return "all";
    if (base === text || "standard" === text || "true" === text || "1" === text || "on" === text || "yes" === text) return base;
    return "off";
  }

  // 把 home_menu 里的一个 token 归一成 { hide, id }；认不出就返回 undefined。
  function menuToken(token) {
    const text = String(token ?? "").trim();
    if (!text) return undefined;

    const hide = text.startsWith("-") || text.startsWith("!");
    const rawName = (hide ? text.slice(1) : text).trim();
    const name = rawName.toLowerCase();
    if (!name) return undefined;

    const item = MENU_ITEMS.find((entry) => entry.id.toLowerCase() === name || entry.keys.some((key) => key.toLowerCase() === name));
    if (item) return { hide, id: item.id };
    // 也允许直接写 browseId；保留原始大小写以匹配区分大小写的 browseId（如 FEmusic_explore / VLWL）。
    if (/^[a-z0-9_]+$/i.test(rawName)) return { hide, id: rawName };
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
    let cleanup;
    if (void 0 !== options.homeCleanup && null !== options.homeCleanup && "" !== String(options.homeCleanup).trim()) {
      cleanup = asLevel(options.homeCleanup, "standard");
    } else {
      const games = void 0 === options.blockGames ? true : asBool(options.blockGames, true);
      const vertical = void 0 !== options.blockVerticalLive && asBool(options.blockVerticalLive, false);
      cleanup = vertical ? "all" : games ? "standard" : "off";
    }
    options.homeCleanup = cleanup;
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

    // 延迟计算 hiddenGuideItems：请求阶段与非 guide 响应不会读它，省去每次构建 Set 与查表。
    const rawHomeMenu = options.homeMenu;
    Object.defineProperty(options, "hiddenGuideItems", {
      enumerable: true,
      configurable: true,
      get() {
        const list = resolveHiddenMenu(rawHomeMenu, blockAds);
        Object.defineProperty(this, "hiddenGuideItems", { value: list, enumerable: true, writable: true, configurable: true });
        return list;
      },
    });

    const speed = String(options.maxSpeed ?? "4").trim().toLowerCase();
    options.maxSpeed =
      "off" === speed || "false" === speed || "0" === speed || false === options.maxSpeed ? false : Math.max(2, Math.min(4, parseInt(speed, 10) || 4));

    const caption = String(options.captionLang ?? "zh-Hans").trim();
    options.captionLang =
      "off" !== caption.toLowerCase() && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,4}){0,2}$/i.test(caption) ? caption : "off";

    options.blockAi = asBool(options.blockAi, true);
    // 此开关默认关闭，参数缺失时不能按「非 false 即 true」处理。
    options.blockShortsFeed = asBool(options.blockShortsFeed, false);
    options.blockMembersOnly = asBool(options.blockMembersOnly, false);
    options.jumpAhead = asBool(options.jumpAhead, true);
    options.youtubeMusic = asBool(options.youtubeMusic, true);
    // 网页版 YouTube / YouTube Music 的 JSON 响应处理，默认开启。
    options.web = asBool(options.web, true);

    // 播放器清理：去播放结束推荐墙 / 信息卡 / 播放器相关浮层；all 再关掉自动播放下一首。
    const playerCleanup = asLevel(options.playerCleanup, "standard");
    options.playerCleanup = playerCleanup;
    options.blockEndscreen = "off" !== playerCleanup;
    options.blockInfoCards = "off" !== playerCleanup;
    options.blockAutoplay = "all" === playerCleanup;

    // 信息流清理：去「继续观看」卡片与顶部筛选条；all 再去掉直播 / 首映卡片。
    const feedCleanup = asLevel(options.feedCleanup, "standard");
    options.feedCleanup = feedCleanup;
    options.blockContinueWatching = "off" !== feedCleanup;
    options.blockChipCloud = "off" !== feedCleanup;
    options.blockLiveCards = "all" === feedCleanup;

    // 播放页清理：去掉评论区；all 再去掉相关视频列表。
    const watchCleanup = asLevel(options.watchCleanup, "comments");
    options.watchCleanup = watchCleanup;
    options.blockComments = "off" !== watchCleanup;
    options.blockRelatedVideos = "all" === watchCleanup;

    // 字幕：keep 保持现状，off 去掉自动生成（ASR）字幕轨且不自动开启，force 强制开启。
    const captionsMode = String(options.captionsMode ?? "keep").trim().toLowerCase();
    options.captionsMode = ["keep", "off", "force"].includes(captionsMode) ? captionsMode : "keep";
    options.stripAutoCaptions = "off" === options.captionsMode;
    options.forceCaptions = "force" === options.captionsMode;
    if (options.stripAutoCaptions) options.captionLang = "off";

    // 编码偏好：any 不动，no_av1 去掉 AV1，avc 只留 H.264。
    const codec = String(options.videoCodec ?? "any").trim().toLowerCase();
    options.videoCodec = ["any", "no_av1", "avc"].includes(codec) ? codec : "any";

    // 网页版 topbar 按钮与 YouTube Music 首页推荐。
    options.webCleanup = asBool(options.webCleanup, false);
    options.musicCleanup = asBool(options.musicCleanup, false);

    if (noDefaults) {
      OPTIONS_CACHE = options;
      return options;
    }
    return { ...defaults, ...options };
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
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return new Uint8Array(body);
    if (body?.length) throw new Error("YouTube requires binary-body-mode for request bodies");
    const contentLength = Object.entries(request.headers ?? {}).find(([key]) => "content-length" === key.toLowerCase())?.[1];
    if (Number(contentLength) > 0) throw new Error("YouTube request body unavailable; requires-body must be enabled");
  }

  // 把请求里的 itag 相关字段改成缓存里的目标值；quality 为空表示只要最高分辨率。
  function applyQuality(bytes, quality, maxHeight) {
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
            [16, Math.max(144, Math.min(4320, parseInt(maxHeight ?? readOptions().maxHeight, 10) || 4320))],
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
  function handleInitPlaybackRequest(request, options, body) {
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
  function rewriteInitPlaybackBody(body, options) {
    const fields = parseFields(body);
    const chunks = fields.filter((field) => 2 === field.no && 2 === field.wire);
    if (1 !== chunks.length) return body;

    const chunk = chunks[0];
    const next = applyQuality(chunk.data, void 0, options?.maxHeight);
    if (next === chunk.data) return body;
    return concatBytes(fields.map((field) => (field === chunk ? concatBytes([encodeVarint(18), encodeVarint(next.length), next]) : field.raw)));
  }

  // videoplayback 请求：按缓存挑一组 itag，替换请求里的 17 号字段。
  // 当 autoHd=false 但开启了 videoCodec 时，只改 17 号字段的编码格式列表，不强锁分辨率。
  function rewriteVideoPlaybackBody(body, url, options) {
    const opts = options ?? readOptions();
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
        if ((cached.codec ?? "any") !== (opts.videoCodec ?? "any")) return;

        const itagSet = new Set(cached.itags);
        const premiumSet = cached.premiumItags?.length ? new Set(cached.premiumItags) : null;
        const formats = [];
        const premiumFormats = [];
        wireForEachField(inner, (no, wire, dataStart, dataEnd) => {
          if (6 !== no || 2 !== wire) return false;
          const formatData = inner.subarray(dataStart, dataEnd);
          const itag = firstVarintField(formatData, 1);
          if (void 0 === itag || !itagSet.has(itag)) return false;
          formats.push(formatData);
          if (premiumSet?.has(itag)) premiumFormats.push(formatData);
          return false;
        });
        return formats.length ? { height: cached.height, formats: premiumFormats.length && false !== opts.preferPremium ? premiumFormats : formats } : void 0;
      } catch {
        return;
      }
    })();

    const lockHeight = false !== opts.autoHd;
    const existing = fields.filter((field) => 17 === field.no && 2 === field.wire);
    const replaceFormats = quality && (existing.length !== quality.formats.length || existing.some((field, i) => !bytesEqual(field.data, quality.formats[i])));

    if (!lockHeight && !replaceFormats) return body;

    const parts = [];
    let sawChunk = false;
    let changed = !!replaceFormats;

    for (const field of fields) {
      if (lockHeight && 1 === field.no && 2 === field.wire) {
        const next = applyQuality(field.data, quality, opts.maxHeight);
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

    if (lockHeight && !sawChunk) {
      const empty = applyQuality(new Uint8Array(), quality, opts.maxHeight);
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
      // 无请求体的 videoplayback（如常规 GET 媒体分片）最频繁，直接早退省去参数解析。
      // Egern 适配层对空请求体也会给一个 length=0 的 Uint8Array，因此要按 byteLength / length 判空。
      if (path.endsWith("/videoplayback") && !(request.body && (request.body.byteLength > 0 || request.body.length > 0))) {
        const contentLength = Object.entries(request.headers ?? {}).find(([key]) => "content-length" === key.toLowerCase())?.[1];
        if (!(Number(contentLength) > 0)) {
          $done(undefined);
          return;
        }
      }

      // 参数解析也放进 try：任何异常都不能让 ad_break 漏过去。
      const options = readOptions();
      // 网页版开关关闭时，网页请求完全放行，不拦 ad_break、不剥热更新头。
      if (isWebRequest(request) && false === options.web) {
        $done(undefined);
        return;
      }
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
        const body = readRequestBody(request);
        let result = handleInitPlaybackRequest(request, options, body);
        if (!result && body?.length && false !== options.autoHd) {
          const rewritten = rewriteInitPlaybackBody(body, options);
          if (rewritten !== body) result = { body: rewritten };
        }
        $done(result);
        return;
      }
      if (path.endsWith("/videoplayback")) {
        if (musicDisabled || (false === options.autoHd && "any" === options.videoCodec)) {
          $done(undefined);
          return;
        }
        const body = readRequestBody(request);
        if (body?.length) {
          const rewritten = rewriteVideoPlaybackBody(body, request.url, options);
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
