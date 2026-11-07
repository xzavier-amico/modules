// Spotify Lyrics — 官方没有歌词时，用 LRCLIB 注入第三方歌词。
//
// 只处理 color-lyrics/v2/track/{id} 的响应：
//   官方 200 且 lyrics.lines 非空  -> 原样放行（官方歌词质量更好）
//   官方 404 / 空歌词 / 解析失败   -> 取曲目元数据，查 LRCLIB，合成同结构的 JSON
//
// 元数据：open.spotify.com/oembed（公开接口，不需要 token）
// 歌词：lrclib.net（免费，返回逐行时间轴的 syncedLyrics）
//
// 任何一步失败都原样放行，App 仍然显示它自己的「暂无歌词」，不会卡住播放。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const hasResponse = typeof $response !== "undefined" && !!$response;
  const res = hasResponse ? $response : {};
  const url = res.url || req.url || "";

  // Loon 传位置数组或对象，Egern 传 JSON 字符串。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { lyrics_source: raw[0] };
    else if (typeof raw === "string") {
      try {
        opt = JSON.parse(raw || "{}") || {};
      } catch (e) {
        // Loon 单参数时可能直接传字符串
        opt = { lyrics_source: raw };
      }
    }
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  // 排查时把这两个空实现换成 console.log / $notification.post。
  const log = () => {};
  const notify = () => {};

  const match = /\/color-lyrics\/v\d\/track\/([A-Za-z0-9]+)/.exec(url);
  if (!match) {
    $done({});
    return;
  }
  const trackId = match[1];

  // 临时探针：确认客户端到底有没有请求 color-lyrics、回来什么状态。
  // 每首歌只提示一次，验证通过后连同调用一起删掉。
  const notifyOnce = (key, body) => {
    try {
      const store = typeof $persistentStore !== "undefined" && $persistentStore;
      const name = "spotify_lyrics_" + key;
      if (store && store.read(name)) return;
      if (typeof $notification !== "undefined" && $notification && "function" == typeof $notification.post) {
        $notification.post("Spotify 歌词 v5", trackId.slice(0, 8), body);
        if (store) store.write("1", name);
      }
    } catch (e) {
      // 通知失败不影响主流程
    }
  };

  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const utf8 = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  // 歌词页配色，ARGB。客户端缺省是 0（全透明），必须显式给。
  const COLOR_BG = 0xff121212;
  const COLOR_LINE = 0xb3ffffff;
  const COLOR_ACTIVE = 0xffffffff;

  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    // 请求阶段要短路的话，必须包成 response 字段，Loon/Surge 都是这个约定。
    if (!hasResponse && value && value.status !== undefined) {
      $done({ response: value });
      return;
    }
    $done(value);
  };

  // 外部接口慢的时候不要拖住 App，超过 8 秒就按「没有歌词」放行。
  if (typeof setTimeout === "function") setTimeout(() => finish({}), 8000);

  const rawBody = res.body;
  const body = toText(rawBody);
  const trimmed = body.trim();
  const hasBody = trimmed.length > 0;
  const status = Number(res.status);

  // 新版客户端要 protobuf（0a 开头的一棵 message 树），旧版要 JSON。
  // 拿不到 body 时只能看 URL 上的 format 参数；没有这个参数就按新版算。
  const rawBytes = toBytes(rawBody);
  const wantsProto = /[?&]format=protobuf/i.test(url);
  const protoMode = hasBody ? wantsProto || trimmed.charAt(0) !== "{" : wantsProto || !/[?&]format=json/i.test(url);

  notifyOnce(
    "hit_" + trackId,
    (hasResponse ? "响应 " + status : "请求") + (hasBody ? " 有 body" : " 无 body") + (protoMode ? " proto" : " json"),
  );

  // 请求阶段：先探一下官方有没有歌词，没有才去找第三方。
  // 之所以不在响应阶段做，是因为没有歌词时官方返回 404 且 body 为空，
  // 响应脚本在那种情况下根本不会被执行（实测一条通知都收不到）。
  if (!hasResponse) {
    runRequestPhase();
    return;
  }

  log("命中 " + trackId + "，状态 " + res.status + "，body " + (hasBody ? trimmed.length + " 字节" : "为空") + "，url=" + url);
  notify("命中，状态 " + res.status + "，" + (hasBody ? "有 body" : "无 body") + (protoMode ? "，protobuf" : "，json"));

  // 200 就是「官方有歌词」：拿不到 body 时直接放行，避免把官方歌词顶掉。
  if (status === 200 && !hasBody) {
    log("200 但没有 body（没开 requires_body），按官方有歌词放行");
    notify("放行：200 无 body");
    finish({});
    return;
  }

  if (status === 200) {
    if (protoMode) {
      // 解析不了（拿不到原始字节）时返回 -1，宁可放行也不要顶掉官方歌词。
      const count = rawBytes.length ? protoLineCount(rawBytes) : -1;
      if (count !== 0) {
        // 免费号的歌词有每月额度，用完服务端会在 restriction（字段 14）里回
        // monthlyLimitReached，客户端就只显示「额度已用完」。抹成 unrestricted 再放行。
        const cleaned = count > 0 ? stripRestrictionProto(rawBytes) : null;
        log("官方已有歌词（protobuf " + (count > 0 ? count + " 行" : "无法判断") + "），" + (cleaned ? "清掉 restriction 后放行" : "放行"));
        notify("放行：官方有歌词（protobuf " + (count > 0 ? count + " 行" : "未知") + "）");
        if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: cleaned });
        else finish({});
        return;
      }
    } else if (hasLyrics(trimmed)) {
      const cleaned = stripRestrictionJson(trimmed);
      log("官方已有歌词，" + (cleaned ? "清掉 restriction 后放行" : "放行"));
      notify("放行：官方已有歌词");
      if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: cleaned });
      else finish({});
      return;
    }
    log("官方 200 但歌词为空，准备注入；前 24 字节: " + hexHead(rawBody));
    notify("官方歌词为空，开始找第三方歌词");
  }

  resolveLyrics((payload, title, artist) => {
    if (!payload) {
      finish({});
      return;
    }
    emit(payload, title, artist);
  });

  // ---- 请求阶段 ---------------------------------------------------------

  function runRequestPhase() {
    if (isProbeRequest()) {
      // 自己发出去的探测请求，直接放行，避免递归。
      $done({});
      return;
    }

    log("探测官方歌词接口");
    probeOfficial((hasOfficial) => {
      if (hasOfficial === null) {
        log("探测失败，放行");
        $done({});
        return;
      }
      if (hasOfficial) {
        log("官方有歌词，放行");
        $done({});
        return;
      }
      log("官方没有歌词，开始找第三方");
      notify("官方没有歌词，开始找第三方");
      resolveLyrics((payload, title, artist) => {
        if (!payload) {
          $done({});
          return;
        }
        emit(payload, title, artist);
      });
    });
  }

  function isProbeRequest() {
    const headers = req.headers || {};
    for (const key in headers) {
      if (!Object.prototype.hasOwnProperty.call(headers, key)) continue;
      if (key.toLowerCase() === "x-xz-lyrics-probe") return true;
    }
    return false;
  }

  // 原样重放一次官方请求，只看状态码：200 说明官方有歌词。
  function probeOfficial(cb) {
    const headers = {};
    const source = req.headers || {};
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) headers[key] = source[key];
    }
    headers["x-xz-lyrics-probe"] = "1";

    try {
      $httpClient.get({ url: url, headers: headers, timeout: 3000 }, (error, response) => {
        if (error || !response) {
          cb(null);
          return;
        }
        const code = Number(response.status) || 0;
        // 200 = 官方有歌词；404/204 = 明确没有；其他状态说不准，一律当未知处理。
        if (code === 200) cb(true);
        else if (code === 404 || code === 204) cb(false);
        else cb(null);
      });
    } catch (e) {
      cb(null);
    }
  }

  // 取曲目元数据 -> 按配置的歌词源找 -> 回调 payload
  function resolveLyrics(cb) {
    const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + trackId);
    httpGetJson(oembedUrl, (meta) => {
      if (!meta || !meta.title) {
        log("oembed 没有返回元数据");
        notify("失败：拿不到曲目元数据");
        cb(null);
        return;
      }

      const title = String(meta.title);
      const artist = String(meta.author_name || "").split(",")[0].trim();
      const order = sourceOrder();
      log("歌词源顺序: " + order.join(" -> ") + "，曲目 " + title + " / " + artist);
      notify("查找 " + title + "（" + order.join(" → ") + "）");

      runSource(order, 0, title, artist, (record) => {
        if (!record) {
          log("所有歌词源都没有找到 " + title);
          notify("失败：所有歌词源都没有 " + title);
          cb(null);
          return;
        }
        const payload = buildPayload(record);
        if (!payload) {
          log("歌词源返回了空内容");
          notify("失败：歌词源返回空内容");
          cb(null);
          return;
        }
        cb(payload, title, artist);
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
    const name = order[index];
    lookup(name, title, artist, (record) => {
      if (record) {
        log(name + " 命中");
        done(record);
        return;
      }
      log(name + " 没有命中，换下一个");
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
      const picked = pickSong(songs, title, (item) => item.name, (item) => (item.artists || []).map((a) => a.name).join(" "));
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
      const picked = pickSong(list, title, (item) => item.songname, (item) => (item.singer || []).map((s) => s.name).join(" "));
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

  function pickSong(list, title, nameOf, artistOf) {
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

  // 排查用：把响应体开头几个字节打成十六进制，好判断是 protobuf、gzip 还是别的。
  function hexHead(value) {
    let bytes;
    if (value instanceof ArrayBuffer) bytes = new Uint8Array(value, 0, Math.min(24, value.byteLength));
    else if (value && ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, Math.min(24, value.byteLength));
    else return "(非二进制)";
    const parts = [];
    for (let i = 0; i < bytes.length; i += 1) parts.push(("0" + bytes[i].toString(16)).slice(-2));
    return parts.join(" ");
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

  function emit(payload, title, artist) {
    const kind = payload.lyrics.syncType === "LINE_SYNCED" ? "同步" : "纯文本";
    log("注入 " + title + " / " + artist + "（" + kind + " " + payload.lyrics.lines.length + " 行）");
    notify("注入 " + kind + " " + payload.lyrics.lines.length + " 行 · " + title);
    notifyOnce("inj_" + trackId, "注入 " + kind + " " + payload.lyrics.lines.length + " 行");

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
  // colors 不写：客户端对缺失的 colors 有默认主题，写错反而会把字刷成看不见的颜色。

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
      .concat(pbBytes(5, encoder.encode(provider || "LRCLIB")));
    // colors 必须给：客户端拿它刷歌词页的背景和文字，字段缺失时是 0，alpha 也是 0，
    // 整页歌词就成了透明的 —— 表现是「封面下面那行有，点进歌词页一片空白」。
    // 取值是 ARGB（见 EeveeSpotify 的 Color.uInt32），这里用深底浅字，不依赖封面取色。
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

  // 把 LyricsData.restriction（字段 14）去掉。没有这个字段就返回 null，
  // 调用方据此原样放行，不动官方响应的任何一个字节。
  function stripRestrictionProto(bytes) {
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
          changed = true;
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
