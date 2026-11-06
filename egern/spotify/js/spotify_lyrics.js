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
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = res.url || req.url || "";

  // Loon 传位置数组或对象，Egern 传 JSON 字符串。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { verbose_log: raw[0] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));
  const verbose = flag(opt.verbose_log, false);
  const log = (msg) => {
    if (verbose) console.log("spotify-lyrics: " + msg);
  };

  const match = /\/color-lyrics\/v2\/track\/([A-Za-z0-9]+)/.exec(url);
  if (!match) {
    $done({});
    return;
  }
  const trackId = match[1];

  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const utf8 = new TextDecoder("utf-8");

  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    $done(value);
  };

  // 外部接口慢的时候不要拖住 App，超过 4.5 秒就按「没有歌词」放行。
  if (typeof setTimeout === "function") setTimeout(() => finish({}), 4500);

  const body = toText(res.body);
  if (Number(res.status) === 200 && body && hasLyrics(body)) {
    log("官方已有歌词，放行");
    finish({});
    return;
  }

  const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + trackId);
  httpGetJson(oembedUrl, (meta) => {
    if (!meta || !meta.title) {
      log("oembed 没有返回元数据");
      finish({});
      return;
    }

    const title = String(meta.title);
    const artist = String(meta.author_name || "").split(",")[0].trim();
    const query =
      "track_name=" + encodeURIComponent(title) + (artist ? "&artist_name=" + encodeURIComponent(artist) : "");

    httpGetJson("https://lrclib.net/api/get?" + query, (record) => {
      if (tryRecord(record, title, artist)) return;

      httpGetJson("https://lrclib.net/api/search?" + query, (list) => {
        if (!Array.isArray(list) || !list.length) {
          log("LRCLIB 没有找到 " + title);
          finish({});
          return;
        }
        const picked = pickRecord(list, title);
        if (!picked) {
          log("LRCLIB 结果里没有可用歌词");
          finish({});
          return;
        }
        tryRecord(picked, title, artist);
      });
    });
  });

  // ---- 工具函数 ---------------------------------------------------------

  function toText(value) {
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) return utf8.decode(new Uint8Array(value));
    if (value && ArrayBuffer.isView(value)) return utf8.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return "";
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

  function httpGetJson(target, callback) {
    let done = false;
    const reply = (value) => {
      if (done) return;
      done = true;
      callback(value);
    };
    try {
      $httpClient.get(
        {
          url: target,
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          timeout: 3000,
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

  function tryRecord(record, title, artist) {
    const payload = buildPayload(record);
    if (!payload) return false;
    log("注入 " + title + " / " + artist + "（" + payload.lyrics.lines.length + " 行）");
    finish({
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return true;
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
    return {
      lyrics: {
        syncType: syncType,
        lines: lines,
        provider: "LRCLIB",
        providerLyricsId: record.id ? String(record.id) : "",
        providerDisplayName: "LRCLIB",
        syncLyricsUri: "",
        isDirty: false,
        live: false,
        language: detectLanguage(lines),
      },
      colors: { background: -1, text: -1, highlight: -1 },
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

  function pickRecord(list, title) {
    const wanted = normalize(title);
    let fallback = null;
    for (const item of list) {
      if (!item || "object" != typeof item || item.instrumental) continue;
      const has =
        (typeof item.syncedLyrics === "string" && item.syncedLyrics.trim()) ||
        (typeof item.plainLyrics === "string" && item.plainLyrics.trim());
      if (!has) continue;
      if (normalize(item.trackName) === wanted) return item;
      fallback = fallback || item;
    }
    return fallback;
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
