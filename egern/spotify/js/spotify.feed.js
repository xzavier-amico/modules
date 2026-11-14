//=======================================================================================
// Spotify Premium — 信息流广告过滤
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

  // ---------------------------------------------------------------- options

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      const modeInFifth = ["full", "no_card", "metadata_only", "response_only", "card_only"].indexOf(raw[4]) >= 0;
      opt = { spoof_premium: raw[0], block_ads: raw[1], unlock_playback: raw[2], enable_lyrics: raw[3], desktop: modeInFifth ? false : raw[4], lyrics_mode: modeInFifth ? raw[4] : raw[5] };
    } else if (typeof raw === "string") {
      opt = JSON.parse(raw || "{}") || {};
    } else if (raw && "object" == typeof raw) {
      opt = raw;
    }
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

  // 客户端模式：auto 按 User-Agent 识别；拿不到 UA 时再看 Loon 运行环境。
  // 识别结果只影响桌面端专属的改写路径，失败时按移动端处理。
  const requestUserAgent = () => {
    const req = typeof $request !== "undefined" && $request ? $request : null;
    const headers = req && req.headers;
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== "user-agent") continue;
      const value = headers[key];
      return String(Array.isArray(value) ? value[0] || "" : value == null ? "" : value);
    }
    return "";
  };
  const detectDesktop = () => {
    const ua = requestUserAgent();
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
    if (/Macintosh|Mac OS X|Darwin|Windows NT/i.test(ua)) return true;
    const loon = typeof $loon !== "undefined" ? String($loon) : "";
    return /^Mac\b/i.test(loon);
  };
  const desktopMode = (v) => {
    if (v === undefined || v === null || v === "") return detectDesktop();
    const mode = String(v).trim().toLowerCase();
    if (mode === "auto") return detectDesktop();
    if (mode === "macos" || mode === "mac" || mode === "desktop") return true;
    if (mode === "ios" || mode === "iphone" || mode === "ipad" || mode === "mobile") return false;
    return flag(v, false);
  };
  const autoPlay = (v) => v === undefined || v === null || /^auto$/i.test(String(v));

  const spoof = flag(opt.spoof_premium, true);
  const adsOn = flag(opt.block_ads, true);
  // macOS 桌面版：bootstrap 外层结构可能和 iOS 不同，且播放授权由服务端判定。
  const desktop = desktopMode(opt.desktop);
  // unlock_playback=auto 时移动端开启、桌面端关闭；桌面端强行写播放授权容易跳歌。
  const playOn = autoPlay(opt.unlock_playback) ? !desktop : flag(opt.unlock_playback, !desktop);
  const lyricsOn = flag(opt.enable_lyrics, true);
  // full / no_card / metadata_only 处理元数据和歌词响应；card_only 只补歌词 section。
  // 保留旧值解析，兼容已保存的参数。
  const lyricsMode = ["full", "no_card", "metadata_only", "response_only", "card_only"].indexOf(opt.lyrics_mode) >= 0 ? opt.lyrics_mode : "full";
  const lyricsMetaOn = lyricsOn && (lyricsMode === "full" || lyricsMode === "no_card" || lyricsMode === "metadata_only");
  // 歌词卡片：full / card_only 时向 scrollsita 列表补一个真实的歌词 section。
  const lyricsCardOn = lyricsOn && (lyricsMode === "full" || lyricsMode === "card_only");

  // 响应体上限：超过上限直接放行，避免异常响应占满内存。
  const MAX_META_BYTES = 12 * 1024 * 1024; // extended-metadata / context-resolve / connect-state / metadata
  const MAX_FEED_BYTES = 12 * 1024 * 1024; // home / browse / scroll / remote-config / nebula
  const MAX_BOOTSTRAP_BYTES = 40 * 1024 * 1024; // bootstrap / user-customization

  // ---------------------------------------------------------------- protobuf
  //
  // 底层 varint / 字段切分 / 字段编码在 src/proto/wire.js，三端共用。
  // 这里只保留 Spotify 需要的消息级封装：parse 失败返回 null，
  // edit 在重编码前后做一次字节比对，防止把不认识的响应写坏。

  const TE = WIRE_TEXT;
  const TD = WIRE_UTF8;
  const readVarint = wireReadVarint;

  // 字节不是合法消息时返回 null。
  function parse(b) {
    let fields;
    try {
      fields = wireParseFields(b);
    } catch (e) {
      return null;
    }
    return fields.map((f) =>
      f.wire === 0
        ? { no: f.no, w: 0, v: wireReadVarint(f.data, { i: 0 }), raw: f.raw }
        : { no: f.no, w: f.wire, p: f.data, raw: f.raw },
    );
  }

  function serialize(fields) {
    return wireConcat(fields.map((f) => wireEncodeField(f.no, f.w, f.w === 0 ? wireEncodeVarint(f.v) : f.p)));
  }

  // 判断整条消息是否本来就是规范编码。等价于 same(serialize(parse(buffer)), buffer)，
  // 但只比较每个字段的 tag / 长度，不复制大 payload，避免 12MB 响应白拷贝一遍。
  function samePrefix(bytes, prefix) {
    if (bytes.length !== prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  function allCanonical(fields) {
    for (const f of fields) {
      if (!f.raw) return false;
      const tag = wireEncodeVarint(BigInt(f.no) * 8n + BigInt(f.w));
      if (f.raw.length < tag.length || !samePrefix(f.raw.subarray(0, tag.length), tag)) return false;
      if (f.w === 0) {
        const value = wireEncodeVarint(f.v);
        if (!samePrefix(f.raw.subarray(tag.length), value)) return false;
      } else if (f.w === 2) {
        const length = wireEncodeVarint(f.p.length);
        if (f.raw.length !== tag.length + length.length + f.p.length) return false;
        if (!samePrefix(f.raw.subarray(tag.length, tag.length + length.length), length)) return false;
      } else if (f.raw.length !== tag.length + (f.w === 1 ? 8 : 4)) {
        return false;
      }
    }
    return true;
  }

  const first = (fields, no) => {
    for (const f of fields) if (f.no === no) return f;
    return null;
  };
  const fieldString = (no, text) => ({ no: no, w: 2, p: TE.encode(text) });
  const fieldBytes = (no, payload) => ({ no: no, w: 2, p: payload });
  const fieldVarint = (no, value) => ({ no: no, w: 0, v: BigInt(value) });

  function text(f) {
    if (!f || f.w !== 2) return null;
    return wireDecodeText(f.p);
  }

  // 用 fn 的返回值替换 path 指向的消息；路径缺失或解析失败时返回 null。
  function edit(message, path, fn) {
    if (!path.length) return fn(message);
    const fields = parse(message);
    if (!fields || !same(serialize(fields), message)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = wireEqual;

  // -------------------------------------------------------- content ad slots
  // 过滤首页 / 搜索 / 滚动页响应里的赞助内容。所有函数在结构异常时返回 null，
  // 调用方随即原样放行。

  const HOME_AD_NAME = /\|(?:brand-ad|hpto|[a-z0-9-]*-ad)$/;
  const HOME_AD_FIELDS = new Set([20, 21]);

  function describeHomeSection(section) {
    const fields = parse(section);
    if (!fields || !fields.length) return null;
    const header = fields[0];
    if (!header || header.no !== 1 || header.w !== 2) return null;
    const name = text(header);
    if (name === null) return null;
    let contentField = -1;
    if (fields.length > 1) contentField = fields[1].no;
    return { name: name, contentField: contentField };
  }

  function isHomeAd(info) {
    if (!info) return false;
    return HOME_AD_NAME.test(info.name) || HOME_AD_FIELDS.has(info.contentField);
  }

  // 首页（casita/v1/home）与搜索 / 浏览页（browsita/v1/browse）的 section 列表
  // 结构相同：顶层字段 1 = repeated { 1: section }，section 里 1 = 名称、2 = 内容。
  // 只丢掉名字以 -ad 结尾（或无名字但内容字段是 20/21）的 section，其余原样保留。
  function filterSectionList(list) {
    let sections;
    try {
      sections = wireParseFields(list);
    } catch (e) {
      return null;
    }
    const kept = [];
    let removed = 0;
    for (const section of sections) {
      if (section.wire === 2) {
        let info = null;
        try {
          info = describeHomeSection(section.data);
        } catch (e) {
          info = null;
        }
        if (isHomeAd(info)) {
          removed++;
          continue;
        }
      }
      kept.push(section.raw);
    }
    return removed ? wireConcat(kept) : null;
  }

  function stripSectionAds(buffer) {
    if (!buffer || !buffer.length) return null;
    let fields;
    try {
      fields = wireParseFields(buffer);
    } catch (e) {
      return null;
    }
    let changed = false;
    const parts = [];
    for (const field of fields) {
      if (field.no === 1 && field.wire === 2) {
        const list = filterSectionList(field.data);
        if (list) {
          parts.push(wireEncodeField(1, 2, list));
          changed = true;
          continue;
        }
      }
      parts.push(field.raw);
    }
    return changed ? wireConcat(parts) : null;
  }

  // 兼容旧入口：首页与浏览页共用同一套 section 过滤。
  function stripHomeAds(buffer) {
    return stripSectionAds(buffer);
  }

  const BROWSE_AD_FIELD = 6;
  const BROWSE_AD_MIN_SIZE = 12000;
  const BROWSE_AD_MAX_DEPTH = 4;

  // 搜索页的赞助内容是较大的字段 6；改号为未知字段 1000，让客户端跳过。
  // 直接在原始字节上重写，未命中的字段连同原始 tag / 长度原样保留：
  // 既不会因为非规范 varint 被整包放弃，也不会漏掉第二个及以后的广告字段。
  function renameDeepField(buffer, depth) {
    let fields;
    try {
      fields = wireParseFields(buffer);
    } catch (e) {
      return null;
    }
    let changed = false;
    const parts = [];
    for (const field of fields) {
      if (field.wire === 2) {
        if (field.no === BROWSE_AD_FIELD && field.data.length > BROWSE_AD_MIN_SIZE) {
          parts.push(wireEncodeField(1000, 2, field.data));
          changed = true;
          continue;
        }
        if (depth < BROWSE_AD_MAX_DEPTH) {
          const inner = renameDeepField(field.data, depth + 1);
          if (inner) {
            parts.push(wireEncodeField(field.no, 2, inner));
            changed = true;
            continue;
          }
        }
      }
      parts.push(field.raw);
    }
    return changed ? wireConcat(parts) : null;
  }

  function hideBrowseAds(buffer) {
    if (!buffer || !buffer.length) return null;
    // 先按 section 名字删（和首页同一套规则），再处理深层的超大赞助字段。
    let out = stripSectionAds(buffer);
    if (buffer.length <= BROWSE_AD_MIN_SIZE) return out;
    const renamed = renameDeepField(out || buffer, 0);
    if (renamed) out = renamed;
    return out;
  }

  // 滚动页的赞助卡是整整一个 section：section 里通常只有 section id（字段 23）和
  // 广告内容（字段 30）。这里直接丢掉整个 section，让列表和客户端的卡片数一起少
  // 一项，避免留下「有 id、没有内容」的空卡片。实际拼接在 feed/lyrics.js 的
  // patchScroll 里和补歌词 section 一起做，只遍历一次。
  // 服务端 patcher 只删广告，不补歌词卡，所以单独保留这个入口。
  function hideScrollAds(buffer) {
    return patchScroll(buffer, "", true, false);
  }

  // ------------------------------------------------------------ lyrics card
  //
  // 歌词卡是 Now Playing 滚动列表里的一格：列表里必须存在一个「歌词 section」，
  // 客户端才会把这一格排进卡片列表。结构：
  //
  //   section { field 5 { field 1: "spotify:track:{id}" }
  //             field 23 { field 1: "spotify:section:{section_id}" } }
  //
  // 官方没有歌词的曲目，服务端不下发这一格。这里按真实形状补一格，section id
  // 复用真实歌词 section 的值；只补当前曲目的列表，已有歌词 section 时不重复补。
  const LYRICS_SECTION_ID = "spotify:section:0JQ5DB6s3cssW5Bo6cGq21";

  function scrollTrackId(url) {
    const match = /\/scrollsita\/v\d+\/scroll\/(?:spotify%3Atrack%3A|spotify:track:)([A-Za-z0-9]{22})/i.exec(url);
    return match ? match[1] : "";
  }

  function lyricsSection(trackId) {
    return serialize([
      fieldBytes(5, serialize([fieldString(1, "spotify:track:" + trackId)])),
      fieldBytes(23, serialize([fieldString(1, LYRICS_SECTION_ID)])),
    ]);
  }

  // 滚动页一次遍历：删广告 section + 补歌词 section。
  //
  // 只重建顶层字段 1 的 payload，保留的 section 和其余字段直接复用原始字节，
  // 不做整包 parse → serialize 校验。10MB 级别的响应在手机上重编码一次就要
  // 好几秒，客户端等不到就先渲染空列表了。
  function patchScroll(buffer, trackId, wantAds, wantCard) {
    if (!buffer || !buffer.length) return null;
    let top;
    let structure = null;
    let sections;
    try {
      top = wireParseFields(buffer);
      for (const f of top) {
        if (f.no === 1 && f.wire === 2) {
          structure = f;
          break;
        }
      }
      if (!structure) return null;
      sections = wireParseFields(structure.data);
    } catch (e) {
      return null;
    }

    const kept = [];
    let removed = 0;
    let hasLyrics = false;
    for (const section of sections) {
      if (section.no !== 1 || section.wire !== 2) {
        kept.push(section.raw);
        continue;
      }
      let ad = false;
      let card = false;
      try {
        // 只扫字段号：看到 30（广告内容）或 5（曲目）就够判断了。
        wireScanFields(section.data, (no) => {
          if (no === 30) ad = true;
          else if (no === 5) card = true;
          return ad && card;
        });
      } catch (e) {
        return null;
      }
      if (wantAds && ad) {
        removed++;
        continue;
      }
      if (card) hasLyrics = true;
      kept.push(section.raw);
    }

    const addCard = wantCard && !!trackId && !hasLyrics;
    if (!removed && !addCard) return null;
    if (addCard) kept.unshift(wireEncodeField(1, 2, lyricsSection(trackId)));

    const rebuilt = wireEncodeField(1, 2, wireConcat(kept));
    const parts = [];
    for (const f of top) parts.push(f === structure ? rebuilt : f.raw);
    const out = wireConcat(parts);
    return wireEqual(out, buffer) ? null : out;
  }

  // 入口：首页 / 搜索 / 滚动页的赞助内容过滤，滚动页额外补歌词卡对应的 section。
  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  const url = res.url || (typeof $request !== "undefined" && $request && $request.url) || "";
  const status = Number(res.status || res.statusCode);

  if (status >= 300) {
    $done({});
    return;
  }

  // 查询串很常见（?locale=zh / ?market=US）；只用 (?:\/|$) 会把这些请求整个放行。
  const HOME_URL = /\/casita\/v\d+\/home(?:\/|\?|$)/;
  const BROWSE_URL = /\/browsita\/v\d+\/browse(?:\/|\?|$)/;
  const SCROLL_URL = /\/scrollsita\/v\d+\/scroll\//;

  const isHome = HOME_URL.test(url);
  const isBrowse = BROWSE_URL.test(url);
  const isScroll = SCROLL_URL.test(url);
  const wantAds = adsOn;
  const wantCard = isScroll && lyricsCardOn;
  if (!(isHome || isBrowse || isScroll) || !(wantAds || wantCard)) {
    $done({});
    return;
  }

  let body = res.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  if (body.length > MAX_FEED_BYTES) {
    $done({});
    return;
  }

  let out = null;
  if (isHome) {
    out = wantAds ? stripHomeAds(body) : null;
  } else if (isBrowse) {
    out = wantAds ? hideBrowseAds(body) : null;
  } else {
    // 滚动页一次遍历完成：先删广告 section，再按过滤后的列表补歌词 section，
    // 避免补在会被丢弃的 section 之后。
    out = patchScroll(body, scrollTrackId(url), wantAds, wantCard);
  }

  if (!out || same(out, body)) {
    $done({});
    return;
  }

  $done({ body: out });

})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
