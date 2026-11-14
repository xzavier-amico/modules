//=======================================================================================
// YouTube Enhance — UMP 密钥提取（config / log_event 响应）
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

  //=====================================================================================
  // §12 从 config / log_event 响应里抓 UMP 密钥
  //=====================================================================================

  function extractUmpKeys() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const body = toBytes($response.body);
      if (("config" !== route && "log_event" !== route) || !body?.length || body.length > MAX_RESPONSE_BYTES) {
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
        const entry = { clientKey: clientKey.toBase64(), encryptKey: encryptKey.toBase64() };

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

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
