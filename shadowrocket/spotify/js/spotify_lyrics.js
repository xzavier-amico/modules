// Spotify Lyrics — 官方没有歌词时，用第三方歌词补上。
//
// 只处理 color-lyrics/v{N}/track/{id} 的响应：
//   200 且歌词非空  -> 清掉额度限制后原样放行（官方歌词质量更好）
//   404 / 空歌词    -> 取曲目元数据，按配置的歌词源查找，合成同结构响应
//
// 补全的只是 Now Playing 界面（封面下方那行同步歌词）。客户端进程内的
// 「完整歌词页」入口由 Lyrics_NPVCommunicatorImpl.ScrollProvider 决定，
// 代理层改不到，本脚本也无法创建那个入口。
//
// 元数据：open.spotify.com/oembed（公开接口，不需要 token）
// 歌词源：LRCLIB / Musixmatch / 网易云 / QQ 音乐
//
// 任何一步失败都原样放行，App 仍然显示它自己的「暂无歌词」，不会卡住播放。

(() => {
  "use strict";

  // Shadowrocket 的 JS 运行时不一定提供 TextEncoder / TextDecoder（Loon、Egern 自带）。
  // 这里补一份严格实现；已有原生对象时整段跳过，三端共用同一份脚本。
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
        else if (first >= 0xc2 && first <= 0xdf) { cp = first & 0x1f; need = 1; }
        else if (first >= 0xe0 && first <= 0xef) { cp = first & 0x0f; need = 2; }
        else if (first >= 0xf0 && first <= 0xf4) { cp = first & 7; need = 3; }
        else need = -1;
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

  const res = typeof $response !== "undefined" && $response ? $response : null;
  const url = (res && res.url) || ($request && $request.url) || "";

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { lyrics_source: raw[0], enable_lyrics: raw[1] };
    else if (typeof raw === "string") {
      try {
        opt = JSON.parse(raw || "{}") || {};
      } catch (e) {
        // Loon 单参数时可能直接传字符串
        opt = { lyrics_source: raw };
      }
    } else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

  // 这个脚本只在响应阶段被调用；请求阶段或参数关闭时直接放行。
  // Loon 靠 enable= 决定是否加载脚本，Egern 不支持条件加载，只能在这里早退。
  if (!res || !flag(opt.enable_lyrics, true)) {
    $done({});
    return;
  }

  const match = /\/color-lyrics\/v\d\/track\/([A-Za-z0-9]+)/.exec(url);
  if (!match) {
    $done({});
    return;
  }
  const trackId = match[1];

  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const utf8 = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  // 歌词页配色，ARGB。客户端缺省是 0（全透明），必须显式给。
  const COLOR_BG = 0xff121212;
  const COLOR_LINE = 0xb3ffffff;
  const COLOR_ACTIVE = 0xffffffff;

  // 响应体上限：官方歌词正常 < 300 KiB，第三方 JSON 也远小于 2 MiB。
  // 超过上限直接放行 / 当作没查到，避免异常响应把脚本内存打爆。
  const MAX_LYRICS_BYTES = 2 * 1024 * 1024;
  const MAX_HTTP_JSON_BYTES = 2 * 1024 * 1024;

  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    $done(value);
  };

  // 外部接口慢的时候不要拖住 App，超过 8 秒就按「没有歌词」放行。
  if (typeof setTimeout === "function") setTimeout(() => finish({}), 8000);

  const rawBody = res.body;
  const rawBytes = toBytes(rawBody);
  const rawLength = "string" == typeof rawBody ? rawBody.length : rawBytes.length;
  if (rawLength > MAX_LYRICS_BYTES) {
    // 超大的官方响应不解析，原样放行；超大 404 也当作没有歌词。
    finish({});
    return;
  }

  const body = toText(rawBody);
  const trimmed = body.trim();
  const hasBody = trimmed.length > 0;
  const status = Number(res.status);

  // 新版客户端要 protobuf（0a 开头的一棵 message 树），旧版要 JSON。
  // 拿不到 body 时只能看 URL 上的 format 参数；没有这个参数就按新版算。
  const wantsProto = /[?&]format=protobuf/i.test(url);
  const protoMode = hasBody ? wantsProto || trimmed.charAt(0) !== "{" : wantsProto || !/[?&]format=json/i.test(url);

  // 200 就是「官方有歌词」：拿不到 body 时直接放行，避免把官方歌词顶掉。
  if (status === 200 && !hasBody) {
    finish({});
    return;
  }

  if (status === 200) {
    if (protoMode) {
      // 解析不了（拿不到原始字节）时返回 -1，宁可放行也不要顶掉官方歌词。
      const count = rawBytes.length ? protoLineCount(rawBytes) : -1;
      if (count !== 0) {
        // 免费号的歌词有每月额度，用完服务端会在 restriction（字段 14）里回
        // monthlyLimitReached，客户端就只显示「额度已用完」。归一成 showLyrics 再放行。
        const cleaned = count > 0 ? normalizeRestrictionProto(rawBytes) : null;
        if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: cleaned });
        else finish({});
        return;
      }
    } else if (hasLyrics(trimmed)) {
      const cleaned = stripRestrictionJson(trimmed);
      if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: cleaned });
      else finish({});
      return;
    }
  }

  resolveLyrics((payload) => {
    if (!payload) {
      finish({});
      return;
    }
    emit(payload);
  });

  // 取曲目元数据 -> 按配置的歌词源找 -> 回调 payload
  function resolveLyrics(cb) {
    const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + trackId);
    httpGetJson(oembedUrl, (meta) => {
      if (!meta || !meta.title) {
        cb(null);
        return;
      }

      const title = String(meta.title);
      const artist = String(meta.author_name || "").split(",")[0].trim();

      runSource(sourceOrder(), 0, title, artist, (record) => {
        if (!record) {
          cb(null);
          return;
        }
        const payload = buildPayload(record);
        if (!payload) {
          cb(null);
          return;
        }
        cb(payload);
      });
    });
  }

  // ---- 歌词源 -----------------------------------------------------------

  function sourceOrder() {
    const wanted = String(opt.lyrics_source || "lrclib").toLowerCase();
    if (wanted === "auto") return ["lrclib", "musixmatch", "netease", "qq"];
    if (wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq") return [wanted];
    return ["lrclib"];
  }

  function runSource(order, index, title, artist, done) {
    if (index >= order.length) {
      done(null);
      return;
    }
    lookup(order[index], title, artist, (record) => {
      if (record) {
        done(record);
        return;
      }
      runSource(order, index + 1, title, artist, done);
    });
  }

  function lookup(name, title, artist, cb) {
    if (name === "lrclib") return lookupLrclib(title, artist, cb);
    if (name === "netease") return lookupNetease(title, artist, cb);
    if (name === "qq") return lookupQq(title, artist, cb);
    if (name === "musixmatch") return lookupMusixmatch(title, artist, cb);
    cb(null);
  }

  // LRCLIB：/api/get 只认精确的曲名+歌手，命中时可能只有纯文本没有时间轴，
  // 所以拿它的时长当锚点，再去 /api/search 挑一版时长接近、带时间轴的。
  function lookupLrclib(title, artist, cb) {
    const query = "track_name=" + encodeURIComponent(title) + (artist ? "&artist_name=" + encodeURIComponent(artist) : "");
    httpGetJson("https://lrclib.net/api/get?" + query, (record) => {
      let anchor = NaN;
      if (record && "object" == typeof record && Number.isFinite(Number(record.duration))) {
        anchor = Number(record.duration);
      }
      if (record && isSynced(record)) {
        cb(withProvider(record, "LRCLIB"));
        return;
      }

      httpGetJson("https://lrclib.net/api/search?" + query, (list) => {
        const picked = pickRecord(list, title, anchor);
        if (picked) {
          cb(withProvider(picked, "LRCLIB"));
          return;
        }
        cb(record && hasAnyLyrics(record) ? withProvider(record, "LRCLIB") : null);
      });
    });
  }

  // 网易云：搜索接口不需要 token，中文曲库覆盖最好。
  function lookupNetease(title, artist, cb) {
    const query = encodeURIComponent(title + (artist ? " " + artist : ""));
    const headers = { Referer: "https://music.163.com/" };
    httpGetJson("https://music.163.com/api/search/get?s=" + query + "&type=1&limit=5&offset=0", (data) => {
      const songs = data && data.result && data.result.songs;
      const picked = pickSong(songs, title, (item) => item.name);
      if (!picked) {
        cb(null);
        return;
      }
      httpGetJson("https://music.163.com/api/song/lyric?id=" + picked.id + "&lv=-1&kv=-1&tv=-1", (lyric) => {
        const text = lyric && lyric.lrc && lyric.lrc.lyric;
        if (!text) {
          cb(null);
          return;
        }
        cb({ provider: "NetEase", providerId: String(picked.id), syncedLyrics: text });
      }, headers);
    }, headers);
  }

  // QQ 音乐：搜索拿 songmid，再用 nobase64=1 取明文 LRC。
  function lookupQq(title, artist, cb) {
    const query = encodeURIComponent(title + (artist ? " " + artist : ""));
    const headers = { Referer: "https://y.qq.com/" };
    httpGetJson("https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=" + query + "&format=json&n=5&p=1", (data) => {
      const list = data && data.data && data.data.song && data.data.song.list;
      const picked = pickSong(list, title, (item) => item.songname);
      if (!picked) {
        cb(null);
        return;
      }
      httpGetJson(
        "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" + picked.songmid + "&format=json&nobase64=1&g_tk=5381",
        (lyric) => {
          const text = lyric && lyric.lyric;
          if (!text) {
            cb(null);
            return;
          }
          cb({ provider: "QQ Music", providerId: String(picked.songmid), syncedLyrics: text });
        },
        headers,
      );
    }, headers);
  }

  // Musixmatch：沿用 EeveeSpotify 的做法，先用固定 app_id 换匿名 token，
  // 再调 macro.subtitles.get 拿逐行字幕。
  function lookupMusixmatch(title, artist, cb) {
    const APP_ID = "mac-ios-v2.0";
    httpGetJson("https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + APP_ID, (token) => {
      const userToken = token && token.message && token.message.body && token.message.body.user_token;
      if (!userToken) {
        cb(null);
        return;
      }
      const target =
        "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" + APP_ID +
        "&usertoken=" + userToken +
        "&q_track=" + encodeURIComponent(title) +
        (artist ? "&q_artist=" + encodeURIComponent(artist) : "") +
        "&user_language=zh";
      httpGetJson(target, (data) => {
        const calls = data && data.message && data.message.body && data.message.body.macro_calls;
        const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
        const list = sub && sub.body && sub.body.subtitle_list;
        const first = Array.isArray(list) ? list[0] : null;
        const body = first && first.subtitle && first.subtitle.subtitle_body;
        if (!body) {
          cb(null);
          return;
        }
        cb({ provider: "Musixmatch", providerId: String(first.subtitle.subtitle_id || ""), syncedLyrics: body });
      });
    });
  }

  function withProvider(record, name) {
    const out = {};
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    out.provider = name;
    return out;
  }

  function isSynced(record) {
    return Boolean(record && "string" == typeof record.syncedLyrics && record.syncedLyrics.trim());
  }

  function hasAnyLyrics(record) {
    return Boolean(
      record &&
        ((typeof record.syncedLyrics === "string" && record.syncedLyrics.trim()) ||
          (typeof record.plainLyrics === "string" && record.plainLyrics.trim())),
    );
  }

  function pickSong(list, title, nameOf) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = normalize(title);
    let fallback = null;
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      if (!item) continue;
      if (!fallback) fallback = item;
      const name = normalize(nameOf(item));
      if (name === wanted || name.indexOf(wanted) === 0) return item;
    }
    return fallback;
  }

  // ---- 工具函数 ---------------------------------------------------------

  function toText(value) {
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) return utf8.decode(new Uint8Array(value));
    if (value && ArrayBuffer.isView(value)) return utf8.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return "";
  }

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }

  function hasLyrics(text) {
    try {
      const data = JSON.parse(text);
      const lines = data && data.lyrics && data.lyrics.lines;
      return Array.isArray(lines) && lines.some((line) => line && String(line.words || "").trim());
    } catch (e) {
      return false;
    }
  }

  function httpGetJson(target, callback, extraHeaders) {
    let done = false;
    const reply = (value) => {
      if (done) return;
      done = true;
      callback(value);
    };
    try {
      const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
      if (extraHeaders) {
        for (const key in extraHeaders) {
          if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) headers[key] = extraHeaders[key];
        }
      }
      $httpClient.get(
        {
          url: target,
          headers: headers,
          timeout: 2500,
        },
        (error, response, data) => {
          if (error || !response || Number(response.status) >= 400 || !data) {
            reply(null);
            return;
          }
          // 第三方接口不可控：超长响应不解析，避免 JSON.parse 占满内存。
          if ("string" != typeof data || data.length > MAX_HTTP_JSON_BYTES) {
            reply(null);
            return;
          }
          try {
            reply(JSON.parse(data));
          } catch (e) {
            reply(null);
          }
        },
      );
    } catch (e) {
      reply(null);
    }
  }

  function emit(payload) {
    if (protoMode) {
      const bytes = encodeProto(payload.lyrics.lines, payload.lyrics.syncType, payload.lyrics.provider);
      finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: bytes });
      return;
    }

    finish({
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
  }

  // ---- protobuf ---------------------------------------------------------
  //
  // 结构来自 EeveeSpotify 的 lyrics.proto（SwiftProtobuf 生成代码）：
  //   message Response   { LyricsData data = 1; LyricsColors colors = 2; }
  //   message LyricsData { bool timeSynchronized = 1; repeated LyricsLine lines = 2;
  //                        string providedBy = 5; LyricsTranslation translation = 9;
  //                        LyricsRestriction restriction = 14; }
  //   message LyricsLine { int32 offsetMs = 1; string content = 2; }
  //   message LyricsColors { uint32 backgroundColor = 1; uint32 lineColor = 2; uint32 activeLineColor = 3; }
  //
  // 和真实响应 0a c2 09 08 01 12 1b 08 b2 3c 12 16 … 对得上：
  // 0a=Response.data，c2 09=长度 1218，08 01=timeSynchronized=true，
  // 12 1b=第一条 line，08 b2 3c=offsetMs 7730，12 16=content 长度 22。

  function encodeProto(lines, syncType, provider) {
    const lineOut = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const content = encoder.encode(String(line.words || ""));
      const body = pbUint(1, Number(line.startTimeMs) || 0).concat(pbBytes(2, content));
      lineOut.push.apply(lineOut, pbBytes(2, body));
    }
    const lyrics = pbUint(1, syncType === "LINE_SYNCED" ? 1 : 0)
      .concat(lineOut)
      .concat(pbBytes(5, encoder.encode(provider || "LRCLIB")))
      // restriction = 1 (showLyrics)。官方响应带这个值，缺省时按 0 处理。
      .concat(pbUint(14, 1));
    // colors 必须给：客户端拿它刷歌词页的背景和文字，字段缺失时是 0，alpha 也是 0，
    // 整页歌词就成了透明的。取值是 ARGB（见 EeveeSpotify 的 Color.uInt32），
    // 这里用深底浅字，不依赖封面取色。
    const colors = pbUint(1, COLOR_BG)
      .concat(pbUint(2, COLOR_LINE))
      .concat(pbUint(3, COLOR_ACTIVE));
    return new Uint8Array(pbBytes(1, lyrics).concat(pbBytes(2, colors)));
  }

  function protoLineCount(bytes) {
    if (!bytes || !bytes.length) return 0;
    try {
      const top = pbFields(bytes);
      for (let i = 0; i < top.length; i += 1) {
        const field = top[i];
        if (field.field !== 1 || field.wire !== 2) continue;
        const inner = pbFields(field.bytes);
        let count = 0;
        for (let j = 0; j < inner.length; j += 1) {
          if (inner[j].field === 2 && inner[j].wire === 2 && inner[j].bytes && inner[j].bytes.length) count += 1;
        }
        return count;
      }
    } catch (e) {
      return 0;
    }
    return 0;
  }

  // 把 LyricsData.restriction（字段 14）统一成 1 = showLyrics。
  //
  // 枚举：0 unrestricted / 1 showLyrics / 2 showLyricsMonthlyLimit / 3 monthlyLimitReached。
  // 免费号的每月额度用完时服务端回 3，客户端只弹额度提示、不出歌词页；这里一律
  // 改回 1。没有这个字段、或者本来就是 1，就返回 null，调用方原样放行。
  function normalizeRestrictionProto(bytes) {
    let top;
    try {
      top = pbFields(bytes);
    } catch (e) {
      return null;
    }
    if (!top.length) return null;
    let changed = false;
    const outTop = [];
    for (let i = 0; i < top.length; i += 1) {
      const f = top[i];
      if (f.field !== 1 || f.wire !== 2) {
        outTop.push(pbEncodeField(f));
        continue;
      }
      const inner = pbFields(f.bytes);
      const outInner = [];
      for (let j = 0; j < inner.length; j += 1) {
        const g = inner[j];
        if (g.field === 14 && g.wire === 0) {
          if (g.value !== 1) {
            g.value = 1;
            changed = true;
          }
          outInner.push(pbEncodeField(g));
          continue;
        }
        outInner.push(pbEncodeField(g));
      }
      outTop.push(pbBytes(1, pbConcat(outInner)));
    }
    return changed ? new Uint8Array(pbConcat(outTop)) : null;
  }

  function stripRestrictionJson(text) {
    try {
      const data = JSON.parse(text);
      const lyrics = data && data.lyrics;
      if (!lyrics || !Object.prototype.hasOwnProperty.call(lyrics, "restriction")) return null;
      delete lyrics.restriction;
      return JSON.stringify(data);
    } catch (e) {
      return null;
    }
  }

  function pbEncodeField(f) {
    return f.wire === 0 ? pbUint(f.field, f.value) : pbBytes(f.field, f.bytes);
  }

  function pbConcat(list) {
    const out = [];
    for (let i = 0; i < list.length; i += 1) out.push.apply(out, list[i]);
    return out;
  }

  function pbFields(bytes) {
    const out = [];
    let pos = 0;
    while (pos < bytes.length) {
      const key = pbReadVarint(bytes, pos);
      if (key.next < 0) break;
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (wire === 0) {
        const value = pbReadVarint(bytes, key.next);
        if (value.next < 0) break;
        out.push({ field: field, wire: 0, value: value.value });
        pos = value.next;
      } else if (wire === 2) {
        const len = pbReadVarint(bytes, key.next);
        if (len.next < 0) break;
        out.push({ field: field, wire: 2, bytes: bytes.subarray(len.next, len.next + len.value) });
        pos = len.next + len.value;
      } else if (wire === 5) {
        pos = key.next + 4;
      } else if (wire === 1) {
        pos = key.next + 8;
      } else {
        break;
      }
    }
    return out;
  }

  function pbReadVarint(bytes, pos) {
    let value = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos];
      value += (byte & 0x7f) * Math.pow(2, shift);
      pos += 1;
      if ((byte & 0x80) === 0) return { value: value, next: pos };
      shift += 7;
      if (shift > 56) break;
    }
    return { value: 0, next: -1 };
  }

  function pbWriteVarint(value) {
    const out = [];
    let rest = Math.max(0, Math.floor(value));
    while (rest >= 128) {
      out.push((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    out.push(rest);
    return out;
  }

  function pbUint(field, value) {
    return pbWriteVarint(field * 8).concat(pbWriteVarint(value));
  }

  function pbBytes(field, bytes) {
    const head = pbWriteVarint(field * 8 + 2).concat(pbWriteVarint(bytes.length));
    const tail = [];
    for (let i = 0; i < bytes.length; i += 1) tail.push(bytes[i]);
    return head.concat(tail);
  }

  function buildPayload(record) {
    if (!record || "object" != typeof record || record.instrumental) return null;

    if (typeof record.syncedLyrics === "string") {
      const lines = parseLrc(record.syncedLyrics);
      if (lines.length) return makePayload("LINE_SYNCED", lines, record);
    }

    if (typeof record.plainLyrics === "string") {
      const lines = record.plainLyrics
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((words) => ({ startTimeMs: "0", words: words, syllables: [], endTimeMs: "0" }));
      if (lines.length) return makePayload("UNSYNCED", lines, record);
    }

    return null;
  }

  function makePayload(syncType, lines, record) {
    const provider = record.provider || "LRCLIB";
    const id = record.providerId !== undefined ? record.providerId : record.id;
    // JSON 版把 colors 放在 lyrics 里面，值是 32 位有符号整数。
    const signed = (v) => (v > 0x7fffffff ? v - 0x100000000 : v);
    return {
      lyrics: {
        syncType: syncType,
        lines: lines,
        provider: provider,
        providerLyricsId: id === undefined || id === null ? "" : String(id),
        providerDisplayName: provider,
        syncLyricsUri: "",
        isDirty: false,
        live: false,
        language: detectLanguage(lines),
        colors: {
          background: signed(COLOR_BG),
          text: signed(COLOR_LINE),
          highlight: signed(COLOR_ACTIVE),
        },
      },
    };
  }

  // LRC -> Spotify 的 lines。支持一行多个时间戳、[offset:±ms]、两位或三位毫秒。
  function parseLrc(text) {
    const out = [];
    let offset = 0;

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      const off = /^\[offset:\s*(-?\d+)\s*\]$/i.exec(line);
      if (off) {
        offset = parseInt(off[1], 10) || 0;
        continue;
      }

      const stamps = [];
      const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      let m;
      while ((m = re.exec(line))) stamps.push(m);
      if (!stamps.length) continue;

      const words = line.replace(/\[[^\]]*\]/g, "").trim();
      if (!words) continue;

      for (const s of stamps) {
        const minutes = parseInt(s[1], 10);
        const seconds = parseInt(s[2], 10);
        const fracRaw = s[3] || "0";
        const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
        let ms = Math.round((minutes * 60 + seconds + frac) * 1000) - offset;
        if (ms < 0) ms = 0;
        out.push({ startTimeMs: String(ms), words: words, syllables: [], endTimeMs: "0" });
      }
    }

    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  // 同名曲目往往有好几版（原版、Video Edit、Extended Mix）。打分选版本：
  // 时长贴近的优先（时间轴才对得上），其次要有同步时间轴，其次曲名精确匹配。
  function pickRecord(list, title, duration) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = normalize(title);
    const usable = list.filter((item) => {
      if (!item || "object" != typeof item || item.instrumental) return false;
      return Boolean(
        (typeof item.syncedLyrics === "string" && item.syncedLyrics.trim()) ||
          (typeof item.plainLyrics === "string" && item.plainLyrics.trim()),
      );
    });
    if (!usable.length) return null;

    const synced = (item) => Boolean(item.syncedLyrics && item.syncedLyrics.trim());
    const named = (item) => normalize(item.trackName) === wanted;
    const near = (item) =>
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(Number(item.duration)) &&
      Math.abs(Number(item.duration) - duration) <= 3;
    const score = (item) => (synced(item) ? 2 : 0) + (named(item) ? 1 : 0) + (near(item) ? 4 : 0);

    let best = usable[0];
    let bestScore = score(best);
    for (let i = 1; i < usable.length; i += 1) {
      const current = score(usable[i]);
      if (current > bestScore) {
        best = usable[i];
        bestScore = current;
      }
    }
    return best;
  }

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^0-9a-z\u00c0-\uffff]+/gi, "");
  }

  function detectLanguage(lines) {
    const sample = lines
      .slice(0, 20)
      .map((line) => line.words)
      .join("");
    if (/[\u3040-\u30ff]/.test(sample)) return "ja";
    if (/[\uac00-\ud7af]/.test(sample)) return "ko";
    if (/[\u4e00-\u9fff]/.test(sample)) return "zh";
    return "en";
  }
})();
