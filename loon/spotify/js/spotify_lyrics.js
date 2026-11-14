//=======================================================================================
// Spotify Lyrics — 官方无歌词时补第三方歌词
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// Spotify Lyrics — 官方没有歌词时，用第三方歌词补上。
//
// 只处理 color-lyrics/v{N}/track/{id} 的响应：
//   200 且歌词非空  -> 清掉额度限制后原样放行（官方歌词质量更好）
//   404 / 空歌词    -> 取曲目元数据，按配置的歌词源查找，合成同结构响应
//
// spotify.js 补曲目 has_lyrics；feed 脚本在 scrollsita 缺少歌词 section 时补一格。
//
// 元数据：优先读 spotify.js 存下的客户端元数据（connect-state / context-resolve /
// metadata/4/track），命中时零外部请求；没命中才退回 open.spotify.com 的 oEmbed
// 与 embed 页面（公开接口，不需要 token）。
// 歌词源：LRCLIB / Musixmatch / 网易云 / QQ 音乐
//
// 客户端模式：Loon 传第 3 个参数 desktop=auto / ios / macos；auto 按 User-Agent
// 识别。没有 body 的 404 会优先按客户端请求的格式（JSON / protobuf）合成，
// 桌面端默认 JSON，iOS 无格式提示时默认 protobuf。
//
// 任何一步失败都原样放行，App 仍然显示它自己的「暂无歌词」，不会卡住播放。

(() => {
  "use strict";

  // feed / 元数据脚本以辅助模式加载：只暴露缓存查询与补卡判断，不处理响应。
  const PREFETCH = typeof SPOTIFY_LYRICS_PREFETCH !== "undefined" && SPOTIFY_LYRICS_PREFETCH;

  const req = typeof $request !== "undefined" && $request ? $request : null;
  const res = typeof $response !== "undefined" && $response ? $response : null;
  const url = (res && res.url) || (req && req.url) || "";

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  if (PREFETCH) {
    // feed 的位置参数和歌词脚本不同，由 feed/lyrics-prefetch.js 解析后传入。
    opt = typeof SPOTIFY_PREFETCH_OPTIONS !== "undefined" && SPOTIFY_PREFETCH_OPTIONS ? SPOTIFY_PREFETCH_OPTIONS : {};
  } else {
    try {
      const raw = typeof $argument !== "undefined" ? $argument : undefined;
      if (Array.isArray(raw)) {
        const modes = ["full", "no_card", "metadata_only", "response_only", "card_only"];
        const modeInThird = modes.indexOf(raw[2]) >= 0;
        opt = { lyrics_source: raw[0], enable_lyrics: raw[1], desktop: modeInThird ? false : raw[2],
          lyrics_mode: modeInThird ? raw[2] : modes.includes(raw[3]) ? raw[3] : undefined };
      }
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
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));
  // 客户端模式：auto 按 User-Agent 识别，拿不到 UA 时再看 Loon 运行环境。
  const requestUserAgent = () => {
    if (!req || !req.headers || "object" != typeof req.headers) return "";
    for (const key in req.headers) {
      if (String(key).toLowerCase() !== "user-agent") continue;
      const value = req.headers[key];
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
  const desktop = desktopMode(opt.desktop);

  // 参数关闭时直接放行；请求阶段的缓存命中在下面处理，未命中同样立即放行。
  // Loon 靠 enable= 决定是否加载脚本，Egern 不支持条件加载，只能在这里早退。
  if (!PREFETCH && (!flag(opt.enable_lyrics, true) || opt.lyrics_mode === "metadata_only" || opt.lyrics_mode === "card_only")) {
    $done({});
    return;
  }

  const match = /\/color-lyrics\/v\d\/track\/([A-Za-z0-9]+)/.exec(url);
  let trackId = PREFETCH ? "" : match ? match[1] : "";
  if (!PREFETCH && !match) {
    $done({});
    return;
  }

  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const utf8 = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  // spotify.js 在改写曲目元数据时，顺手把曲名 / 歌手 / 时长存进了本地存储。
  // 命中时连 oEmbed 都不用请求，只留 embed 页面取封面配色。
  const TRACK_CACHE_KEY = "spotify.track.meta";
  const TRACK_CACHE_MAX = 24;

  // 歌词结果缓存：同一首歌的播放器、歌词页与歌词卡会重复请求 color-lyrics，
  // 命中后直接回缓存，不再打第三方源。命中的歌词基本不会变，存久一点；
  // 查不到 / 超时都不写缓存，避免一次网络抖动把这首歌判成「无歌词」。
  const LYRICS_CACHE_KEY = "spotify.lyrics.cache";
  const LYRICS_CACHE_MAX = 24;
  const LYRICS_CACHE_HIT_TTL = 24 * 60 * 60 * 1000;
  const LYRICS_CACHE_MAX_LINES = 400;
  const LYRICS_CACHE_MAX_BYTES = 400 * 1024;
  const LYRICS_DEADLINE_MS = 8000;
  const PLAIN_FALLBACK_MS = 6000;

  // 确认没有歌词的曲目，短期内不再补空卡。
  const MISS_KEY = "spotify.lyrics.miss";
  const MISS_TTL_MS = 5 * 60 * 1000;

  // 歌词请求进度：请求阶段写 pending，响应阶段写出歌词前写 served。
  // feed 脚本补卡时要等 served，而不是只等缓存：缓存写入后歌词响应还在编码 /
  // 返回路上，scroll 先到客户端的话，列表会先按「没有歌词」渲染，歌词卡被丢掉。
  const PENDING_KEY = "spotify.lyrics.pending";
  // 歌词脚本自己的 deadline 是 8s；超过 10s 还没清掉就是脚本被杀了，按失效处理。
  const PENDING_TTL_MS = 10 * 1000;
  const SERVED_KEY = "spotify.lyrics.served";
  // served 只表示「这首歌的歌词至少完整交给过客户端一次」，和歌词缓存同寿命；
  // 它挡住的是缓存写完到响应返回之间的几毫秒，不需要很短的有效期。
  const SERVED_TTL_MS = LYRICS_CACHE_HIT_TTL;

  const storeBackend = () =>
    typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;

  function readJsonMap(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const map = raw ? JSON.parse(raw) : null;
      return map && "object" == typeof map && !Array.isArray(map) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function writeJsonMap(key, map) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(JSON.stringify(map), key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 预取接力标记：不同脚本实例（歌词 / connect-state / feed）之间只靠持久化
  // 存储通信，标记一律带时间戳，脚本被超时杀掉时也不会长期阻塞后续调度。
  function readMark(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && "object" == typeof value ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writeMark(key, value) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(value ? JSON.stringify(value) : "", key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  function activeMark(key, id, ttl) {
    const mark = readMark(key);
    return mark && (!id || mark.id === id) && Number(mark.at) && Date.now() - Number(mark.at) < ttl ? mark : null;
  }

  // 歌词请求已经开始（请求阶段放行官方请求之前），feed 据此把等待窗口从
  // scroll 到达时刻顺延到歌词请求自己的 deadline。
  const markPending = () => {
    if (trackId) writeMark(PENDING_KEY, { id: trackId, at: Date.now() });
  };

  // 歌词已经查好、马上要交给客户端（$done 之前最后一步）。feed 看到它再等一个
  // 很短的宽限就放行 scroll，尽量让客户端先拿到歌词再渲染卡片列表。
  const markServed = () => {
    if (trackId) writeMark(SERVED_KEY, { id: trackId, at: Date.now() });
  };

  function cachedTrackMeta(id) {
    const map = readJsonMap(TRACK_CACHE_KEY);
    const value = map && map[id];
    if (!value || !value[0]) return null;
    const ms = Number(value[2]);
    const color = value[4];
    return {
      title: String(value[0]),
      artist: String(value[1] || "").trim(),
      duration: Number.isFinite(ms) && ms > 10000 ? ms / 1000 : undefined,
      color: color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))
        ? { r: Number(color.r), g: Number(color.g), b: Number(color.b) }
        : null,
    };
  }

  // 从 oEmbed / embed 拿到的元数据也写回同一份缓存：下次播放直接命中，
  // 连 open.spotify.com 都不用请求。顺便缓存封面色，歌词页背景保持一致。
  function rememberTrackMeta(id, title, artist, durationMs, color) {
    if (!id || !title) return;
    const map = readJsonMap(TRACK_CACHE_KEY) || {};
    const next = [String(title), String(artist || ""), Number(durationMs) || 0, Date.now()];
    if (color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))) {
      next[4] = { r: Number(color.r), g: Number(color.g), b: Number(color.b) };
    }
    const old = map[id];
    if (
      old &&
      old[0] === next[0] &&
      old[1] === next[1] &&
      Number(old[2]) === next[2] &&
      (!next[4] || (old[4] && old[4].r === next[4].r && old[4].g === next[4].g && old[4].b === next[4].b))
    ) return;
    map[id] = next;
    const ids = Object.keys(map).sort((a, b) => Number(map[b][3] || 0) - Number(map[a][3] || 0));
    for (const key of ids.slice(TRACK_CACHE_MAX)) delete map[key];
    writeJsonMap(TRACK_CACHE_KEY, map);
  }

  function lyricsSourceKey() {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    return wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq" ? wanted : "auto";
  }

  const lyricsCacheKey = (id) => lyricsSourceKey() + "|" + id;

  function readLyricsCache(key, id) {
    const map = readJsonMap(LYRICS_CACHE_KEY);
    const valid = (value) => !!value && "object" == typeof value && !value.m &&
      Date.now() - Number(value.t || 0) < LYRICS_CACHE_HIT_TTL;
    let entry = map && map[key];
    // 配置换过歌词源（auto ↔ lrclib）时旧缓存 key 会不同；按曲目 id 再找一次，
    // 避免同一首歌已经缓存过却因为前缀不同重新查源。
    if (!valid(entry) && id) {
      const suffix = "|" + id;
      for (const name of Object.keys(map || {})) {
        if (name.slice(-suffix.length) !== suffix) continue;
        const candidate = map[name];
        if (valid(candidate)) {
          entry = candidate;
          break;
        }
      }
    }
    if (!valid(entry)) return null;
    const lines = Array.isArray(entry.a) ? entry.a : [];
    if (!lines.length) return null;
    const signed = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
    const provider = String(entry.p || "LRCLIB");
    return {
      payload: {
        lyrics: {
          syncType: entry.s === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
          lines: lines.map((pair) => ({
            startTimeMs: String(Number(pair && pair[0]) || 0),
            words: String((pair && pair[1]) || ""),
            syllables: [],
            endTimeMs: "0",
          })),
          provider: provider,
          providerLyricsId: entry.i === undefined || entry.i === null ? "" : String(entry.i),
          providerDisplayName: provider,
          syncLyricsUri: "",
          isDenseTypeface: false,
          alternatives: [],
          language: String(entry.l || "en"),
          isRtlLanguage: false,
          fullscreenAction: "FULLSCREEN_LYRICS",
        },
        colors: {
          background: signed(Number(entry.c && entry.c[0]) || 0xff808080),
          text: signed(Number(entry.c && entry.c[1]) || 0xff000000),
          highlightText: signed(Number(entry.c && entry.c[2]) || 0xffffffff),
        },
        hasVocalRemoval: false,
      },
    };
  }

  function writeLyricsCache(key, payload) {
    // 只缓存真正拿到的歌词；查不到 / 超时都不写，下一次打开可以立刻重试。
    if (!payload) return;
    const map = readJsonMap(LYRICS_CACHE_KEY) || {};
    const now = Date.now();
    const lyrics = payload.lyrics || {};
    const colors = payload.colors || {};
    const lines = [];
    const raw = Array.isArray(lyrics.lines) ? lyrics.lines : [];
    for (let i = 0; i < raw.length && i < LYRICS_CACHE_MAX_LINES; i += 1) {
      const line = raw[i];
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      lines.push([Number(line.startTimeMs) || 0, line.words.slice(0, 200)]);
    }
    if (!lines.length) return;
    map[key] = {
      t: now,
      m: 0,
      s: lyrics.syncType === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
      p: String(lyrics.provider || "LRCLIB"),
      i: lyrics.providerLyricsId === undefined || lyrics.providerLyricsId === null ? "" : String(lyrics.providerLyricsId),
      l: String(lyrics.language || "en"),
      c: [Number(colors.background) || 0xff808080, Number(colors.text) || 0xff000000, Number(colors.highlightText) || 0xffffffff],
      a: lines,
    };
    for (const id of Object.keys(map)) {
      const entry = map[id];
      // 清掉旧版本留下的 miss 记录和过期条目。
      if (!entry || entry.m || !(now - Number(entry.t || 0) < LYRICS_CACHE_HIT_TTL)) delete map[id];
    }
    const byAge = () => Object.keys(map).sort((a, b) => Number(map[b].t || 0) - Number(map[a].t || 0));
    for (const id of byAge().slice(LYRICS_CACHE_MAX)) delete map[id];

    // 存储空间和解析成本都要控住：整包超过上限时继续按时间淘汰最旧的。
    const store = storeBackend();
    if (!store) return;
    try {
      let json = JSON.stringify(map);
      for (const id of byAge()) {
        if (json.length <= LYRICS_CACHE_MAX_BYTES || Object.keys(map).length <= 1) break;
        delete map[id];
        json = JSON.stringify(map);
      }
      store.write(json, LYRICS_CACHE_KEY);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 歌词页配色在 albumColors() 里按官方规则计算：封面主色做背景，未激活行黑色，
  // 当前 / 已唱行白色。三项都是 alpha=0xFF 的不透明色，不能依赖 alpha 区分。
  // 官方 previewLines 给 5 行；超过歌词总行数时按实际行数截断。
  const PREVIEW_LINES = 5;

  // 这些正则会在逐行解析里反复用到，提到外层只创建一次。
  const LRC_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const LRC_OFFSET = /^\[offset:\s*(-?\d+)\s*\]$/i;
  const LRC_BRACKET = /\[[^\]]*\]/g;
  const NORMALIZE_DROP = /[^\p{L}\p{M}\p{N}]+/gu;
  const LIVE_MARK = /(?:\blive\b|live版|现场|現場|[一二三四五六七八九十\d]+公)/i;
  const STAGE_MARK = /([一二三四五六七八九十\d]+公)/;
  const INSTRUMENTAL_MARK = /伴奏|instrumental|karaoke/i;
  const SONG_TITLE_LIVE = /\s*[-–—]\s*[^-–—]*(?:\blive\b|live版|现场|現場).*$/i;
  const SONG_TITLE_LIVE_BRACKET = /[（(][^()（）]*(?:live|现场|現場)[^()（）]*[)）]/gi;
  const SONG_TITLE_BRACKET_GROUP = /[（(]([^()（）]*)[)）]/g;
  // 括号里带这些词时说明是不同版本（Live / Remix / 伴奏…），不能当装饰信息删掉。
  const SONG_TITLE_VERSION_BRACKET = /\b(?:live|acoustic|unplugged|remix|mix|version|edit|remaster(?:ed)?|instrumental|karaoke|demo|cover|session|mono|stereo|deluxe|bonus|explicit|clean)\b|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|混音|重制|重製|翻唱|翻自|试听|試聽|片段|版/i;
  const SONG_TITLE_BRACKET_NOISE = /[（(\[][^()（）\[\]]*\b(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|feat\.?|ft\.?|featuring|with|prod\.?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\b[^()（）\[\]]*[)）\]]/gi;
  const SONG_TITLE_DASH_FEAT = /\s*[-–—]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)\b.*$/i;
  const SONG_TITLE_DASH_EDITION = /\s*[-–—]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\s*$/i;
  const ARTIST_SPLIT = /[,，、/;&]|\b(?:feat\.?|ft\.?|featuring|with)\b/i;
  const CJK_MARK = /[\u3400-\u9fff]/;
  const KANA_MARK = /[\u3040-\u30ff]/;
  const HANGUL_MARK = /[\uac00-\ud7af]/;
  const HAN_MARK = /[\u4e00-\u9fff]/;

  // 响应体上限：官方歌词正常 < 300 KiB，第三方 JSON 也远小于 2 MiB。
  // 超过上限直接放行 / 当作没查到，避免异常响应把脚本内存打爆。
  const MAX_LYRICS_BYTES = 2 * 1024 * 1024;
  const MAX_HTTP_JSON_BYTES = 2 * 1024 * 1024;

  let settled = false;
  let deadline;
  let plainTimer;
  let plainFallback = null;
  let cacheKey = "";
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (deadline !== undefined && typeof clearTimeout === "function") clearTimeout(deadline);
    if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
    // 请求阶段没有 $response：Loon / Egern / Shadowrocket 用 { response } 直接
    // 返回合成结果，跳过官方 color-lyrics 请求。
    if (!res) {
      $done(value && (value.status || value.body) ? { response: value } : {});
      return;
    }
    // 响应已经交给客户端，这次歌词请求不会再产出结果；清掉 pending，
    // 让 feed 不用一直按「还在查」延长等待（超时后晚到的结果仍会写缓存）。
    writeMark(PENDING_KEY, null);
    $done(value);
  };

  if (PREFETCH) {
    // 辅助模式：feed / 元数据脚本只复用缓存查询与补卡判断，不发起歌词查询。

    // 轮询歌词进度，直到歌词响应已经交给客户端（served）再放行 scroll。
    //   * 缓存 + served  -> 再等 grace 毫秒（让客户端先处理歌词响应）后补卡；
    //   * 只有缓存        -> 歌词还在编码 / 返回路上，继续等 served；
    //   * 确认没歌词      -> 不补卡；
    //   * 歌词请求在路上  -> 按 pending 的起始时间顺延等待窗口（最多 extendMax）；
    //   * 等满窗口        -> 乐观补卡（内容由随后到达的 color-lyrics 请求填充）。
    // 步长分段由 feed 传入：max / fastUntil / fastStep / slowStep / grace / extendMax。
    globalThis.__spotifyLyricsWait = (id, callback, options) => {
      if (!id || typeof callback !== "function") {
        if (typeof callback === "function") callback(false, true);
        return;
      }
      const conf = options && "object" == typeof options ? options : {};
      const maxMs = Number(conf.max) > 0 ? Number(conf.max) : 8000;
      const fastUntil = Number(conf.fastUntil) > 0 ? Number(conf.fastUntil) : 2000;
      const fastStep = Number(conf.fastStep) > 0 ? Number(conf.fastStep) : 200;
      const slowStep = Number(conf.slowStep) > 0 ? Number(conf.slowStep) : 500;
      const grace = Number(conf.grace) >= 0 ? Number(conf.grace) : 200;
      const extendMax = Number(conf.extendMax) > 0 ? Number(conf.extendMax) : 4000;
      // 歌词请求自己的 deadline 与补卡窗口可能刚好对齐，多留一点余量，
      // 避免在歌词脚本写出缓存 / served 之前就超时。
      const settle = Number(conf.settle) > 0 ? Number(conf.settle) : 1000;
      const key = lyricsCacheKey(id);
      const hasTimer = typeof setTimeout === "function";
      const startedAt = Date.now();
      let elapsed = 0;

      const ready = () => {
        if (hasTimer && grace > 0) setTimeout(() => callback(true, false), grace);
        else callback(true, false);
      };

      const poll = () => {
        const cached = readLyricsCache(key, id);
        const served = activeMark(SERVED_KEY, id, SERVED_TTL_MS);
        const pending = activeMark(PENDING_KEY, id, PENDING_TTL_MS);
        // 还有歌词请求在路上时继续等：客户端可能先查了歌词页、再查卡片，
        // 只看到上一次的 served 就放行，卡片那次响应仍可能晚于 scroll。
        // 歌词已经返回给客户端（缓存里也有内容）且没有新请求：留宽限后放行。
        if (!pending && cached && served) {
          ready();
          return;
        }
        // 歌词请求还在路上时，旧的 miss 标记不作数：这次请求可能就查到了。
        if (!cached && !pending && activeMark(MISS_KEY, id, MISS_TTL_MS)) {
          callback(false, false);
          return;
        }
        // 歌词请求比 scroll 晚开始：按请求开始时间顺延，别在歌词 deadline
        // 之前就放弃。顺延量有上限，避免客户端根本不请求歌词时一直卡住。
        const lead = pending && pending.at > startedAt ? pending.at - startedAt : 0;
        const limit = maxMs + (pending ? settle : 0) + Math.min(lead, extendMax);
        if (!hasTimer || elapsed >= limit) {
          // 等满窗口：确认没歌词就不补，否则乐观补卡。
          if (!cached && activeMark(MISS_KEY, id, MISS_TTL_MS)) callback(false, false);
          else callback(false, true);
          return;
        }
        const step = elapsed < fastUntil ? fastStep : slowStep;
        elapsed += step;
        setTimeout(poll, step);
      };
      poll();
    };

    // 最近确认没有歌词的曲目不再补空卡；已经查到歌词、或有歌词请求在路上时
    // 以实际进度为准，避免旧的 miss 标记把这次可能成功的歌词挡掉。
    globalThis.__spotifyLyricsCard = (id) => {
      if (!id || !flag(opt.enable_lyrics, true)) return false;
      if (readLyricsCache(lyricsCacheKey(id), id)) return true;
      if (activeMark(PENDING_KEY, id, PENDING_TTL_MS)) return true;
      if (activeMark(MISS_KEY, id, MISS_TTL_MS)) return false;
      return true;
    };
    return;
  }

  // 请求阶段：缓存命中直接返回合成歌词，跳过官方请求；未命中立即放行。
  if (!res) {
    if (!PREFETCH && trackId && flag(opt.enable_lyrics, true)) {
      cacheKey = lyricsCacheKey(trackId);
      const cached = readLyricsCache(cacheKey, trackId);
      if (cached) {
        writeMark(MISS_KEY, null);
        writeMark(PENDING_KEY, null);
        if (requestedProtoMode()) {
          const bytes = encodeProto(cached.payload.lyrics.lines, cached.payload.lyrics.syncType,
            cached.payload.lyrics.provider, cached.payload.lyrics.providerLyricsId,
            cached.payload.lyrics.language, cached.payload.colors);
          // 缓存命中时请求阶段直接返回歌词，同样要告诉 feed「歌词已经交给客户端」。
          markServed();
          finish({
            status: 200,
            headers: { "Content-Type": "application/vnd.google.protobuf" },
            body: bytes,
          });
        } else {
          const body = JSON.stringify(cached.payload);
          markServed();
          finish({
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: body,
          });
        }
        return;
      }
    }
    // 未命中：官方请求还要飞一会儿，先标 pending，feed 据此延长补卡等待。
    markPending();
    finish({});
    return;
  }

  const rawBody = res.body;
  const rawBytes = toBytes(rawBody);
  const rawLength = "string" == typeof rawBody ? rawBody.length : rawBytes.length;
  if (rawLength > MAX_LYRICS_BYTES) {
    // 超大的官方响应不解析，原样放行；超大 404 也当作没有歌词。
    finish({});
    return;
  }

  // protobuf 不先转 UTF-8：只检查第一个非空白字节来区分 JSON。
  let start = 0;
  while (start < rawBytes.length && (rawBytes[start] === 32 || rawBytes[start] === 9 || rawBytes[start] === 10 || rawBytes[start] === 13)) start++;
  const trimmed = typeof rawBody === "string" ? rawBody.trim() : rawBytes[start] === 123 ? toText(rawBytes).trim() : "";
  const hasBody = typeof rawBody === "string" ? trimmed.length > 0 : rawBytes.length > 0;
  const status = Number(res.status || res.statusCode);

  function headerValue(headers, name) {
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== name) continue;
      const value = headers[key];
      if (Array.isArray(value)) return String(value[0] || "");
      return String(value === undefined || value === null ? "" : value);
    }
    return "";
  }

  // 404 的 body 和 Content-Type 都描述错误，不能用来推断歌词响应格式。
  // 补全时遵循请求的 format / Accept；没有提示则用客户端默认格式。
  function requestedProtoMode() {
    const accept = headerValue(req && req.headers, "accept").toLowerCase();
    const format = /[?&]format=(json|protobuf)(?:&|$)/i.exec(url);
    const requested = format ? format[1].toLowerCase() === "protobuf"
      : accept.indexOf("protobuf") >= 0 ? true
      : accept.indexOf("json") >= 0 ? false
      : null;
    return requested !== null ? requested : !desktop;
  }
  const protoMode = status === 200 && hasBody
    ? trimmed.charAt(0) !== "{"
    : requestedProtoMode();

  // 不把登录、限流或服务端错误伪装成有歌词。
  if (status !== 200 && status !== 404) {
    finish({});
    return;
  }

  // 官方「没有歌词」不一定回 404：protobuf 请求经常是 200 + 空体。
  // 空体有两种情况，必须区分开：
  //   * 上游确实没内容（content-length 缺失或 0）-> 当作没有歌词，去第三方补；
  //   * body 没交到脚本手里（content-length > 0）-> 原样放行，不能把官方歌词顶掉。
  if (status === 200 && !hasBody) {
    const declared = Number(headerValue(res && res.headers, "content-length"));
    if (Number.isFinite(declared) && declared > 0) {
      finish({});
      return;
    }
  } else if (status === 200) {
    if (protoMode) {
      // 解析不了（拿不到原始字节）时返回 -1，宁可放行也不要顶掉官方歌词。
      const inspected = rawBytes.length ? inspectProto(rawBytes) : null;
      const count = inspected ? inspected.count : -1;
      if (count !== 0) {
        // 免费号的歌词有每月额度，用完服务端会在 restriction（字段 14）里回
        // monthlyLimitReached，客户端就只显示「额度已用完」。归一成 showLyrics 再放行。
        const cleaned = count > 0 ? normalizeRestrictionProto(inspected) : null;
        if (cleaned) {
          markServed();
          finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: cleaned });
        } else {
          // 原样放行，但 count > 0 说明官方歌词确实有内容。
          if (count > 0) markServed();
          finish({});
        }
        return;
      }
    } else if (hasLyrics(trimmed)) {
      const cleaned = stripRestrictionJson(trimmed);
      if (cleaned) {
        markServed();
        finish({ status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: cleaned });
      } else {
        markServed();
        finish({});
      }
      return;
    }
  }

  // 歌词结果缓存：同一首歌在播放器 / 歌词页 / 歌词卡之间的重复请求不再重复查源。
  // 只缓存「官方没有歌词」的分支，官方歌词不会走到这里。
  cacheKey = lyricsCacheKey(trackId);
  const cachedLyrics = readLyricsCache(cacheKey, trackId);
  if (cachedLyrics) {
    writeMark(MISS_KEY, null);
    emit(cachedLyrics.payload);
    return;
  }

  // 总时限；超时后用纯文本兜底，没有就放行。超时不写 miss 标记：第三方歌词
  // 可能还在路上，feed 脚本的 8s 轮询窗口与这里的 8s deadline 对齐，后续到达
  // 的歌词会写进缓存供轮询命中。只有所有第三方源都确认没歌词时才写 miss。
  if (typeof setTimeout === "function") deadline = setTimeout(() => {
    if (settled) return;
    if (plainFallback) {
      writeLyricsCache(cacheKey, plainFallback);
      writeMark(MISS_KEY, null);
      emit(plainFallback);
    } else {
      finish({});
    }
  }, LYRICS_DEADLINE_MS);
  resolveLyrics((payload) => {
    if (settled) {
      // deadline 超时放行后，所有源都确认没歌词时补写 miss 标记，
      // feed 轮询读到 miss 就不再乐观补空卡。拿到了歌词则由 runSource 写缓存。
      if (!payload) writeMark(MISS_KEY, { id: trackId, at: Date.now() });
      return;
    }
    writeLyricsCache(cacheKey, payload);
    if (!payload) {
      writeMark(MISS_KEY, { id: trackId, at: Date.now() });
      finish({});
      return;
    }
    writeMark(MISS_KEY, null);
    emit(payload);
  });

  // 取曲目元数据 -> 按配置的歌词源找 -> 回调 payload
  function resolveLyrics(cb) {
    resolvePublicLyrics(cb);
  }

  function resolvePublicLyrics(cb) {
    // 客户端拉过的元数据优先：命中时直接查歌词，open.spotify.com 一次都不请求，
    // 歌词页背景用默认底色（不再为封面配色抓 embed 页面）。
    const cached = cachedTrackMeta(trackId);
    if (cached) {
      runSource(sourceOrder(cached.title, cached.artist), cached.title, cached.artist, cb, cached.duration, () => cached.color || null);
      return;
    }
    const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + trackId);
    const embedUrl = "https://open.spotify.com/embed/track/" + trackId;
    let meta = null;
    let embed = null;
    let metaDone = false;
    let embedStarted = false;
    let embedDone = false;
    let started = false;
    const merged = () => {
      const oembed = {
        title: String((meta && meta.title) || ""),
        artist: String((meta && meta.author_name) || "").trim(),
      };
      const page = embed || {};
      // 缺歌手或 Live 曲目时以 embed 的写法 / 时长为准，其余优先 oEmbed。
      const preferEmbed = !oembed.title || !oembed.artist || isLive(oembed.title);
      return {
        title: String((preferEmbed ? page.title : oembed.title) || oembed.title || page.title || ""),
        artist: String((preferEmbed ? page.artist : oembed.artist) || oembed.artist || page.artist || "").trim(),
        duration: page.duration,
      };
    };
    const colorOf = () => (embed && embed.color) || null;
    const start = () => {
      if (started) return;
      const info = merged();
      if (!info.title) {
        started = true;
        cb(null);
        return;
      }
      started = true;
      rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, colorOf());
      runSource(sourceOrder(info.title, info.artist), info.title, info.artist,
        (payload) => cb(payload), info.duration, colorOf);
    };
    // embed 提供封面主色与兜底元数据；请求与歌词查询并行，不阻塞歌词响应。
    const beginEmbed = () => {
      if (embedStarted) return;
      embedStarted = true;
      httpGetText(embedUrl, (html) => {
        embed = parseEmbedTrack(html);
        embedDone = true;
        // 歌词可能已经先返回了；embed 晚到时只补一份封面配色与更准确的元数据。
        if (started && embed && embed.color) {
          const info = merged();
          rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, embed.color);
        }
        maybeStart();
      });
    };
    const maybeStart = () => {
      if (started) return;
      const info = merged();
      if (!metaDone) return;
      if (!info.title) {
        // oEmbed 没给曲名时靠 embed 补；embed 也失败才放弃。
        if (!embedDone) {
          beginEmbed();
          return;
        }
        start();
        return;
      }
      // 缺歌手、或 Live 曲目要靠 embed 的歌手 / 时长做校验，才等 embed。
      if ((!info.artist || isLive(info.title)) && !embedDone) {
        beginEmbed();
        return;
      }
      // 正常曲目立即开始查歌词，同时发出配色请求，但不等待它。
      beginEmbed();
      start();
    };
    httpGetJson(oembedUrl, (data) => {
      meta = data;
      metaDone = true;
      maybeStart();
    });
  }

  // ---- 歌词源 -----------------------------------------------------------

  function sourceOrder(title, artist) {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    // Musixmatch 是 Spotify 的官方歌词上游，auto 不使用，仅在显式选择时查询。
    const auto = CJK_MARK.test(title + artist)
      ? ["netease", "qq", "lrclib"] : ["lrclib", "netease", "qq"];
    if (wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq") return [wanted];
    return auto;
  }

  // 并发查询所有来源：首个通过校验的同步歌词胜出；只有纯文本时等全部结束。
  // settled 后不再 emit（响应已放行），但仍然写缓存：feed 脚本的轮询窗口比
  // deadline 长，后续到达的歌词写进缓存供轮询命中。全部源都确认没歌词时
  // 写 miss 标记，feed 轮询读到 miss 就不再乐观补空卡。
  function runSource(order, title, artist, done, duration, colorOf) {
    if (settled) return;
    if (!order.length) {
      done(null);
      return;
    }
    let remaining = order.length;
    let finished = false;
    const checkAllDone = () => {
      if (!remaining && !finished) {
        finished = true;
        done(plainFallback);
      }
    };
    for (const name of order) {
      if (settled || finished) return;
      lookup(name, title, artist, duration, (record) => {
        if (settled) {
          // deadline 超时放行：歌词晚到时写缓存供 feed 轮询命中。
          if (record && colorOf) record.albumColor = colorOf();
          const latePayload = buildPayload(record);
          if (latePayload) writeLyricsCache(cacheKey, latePayload);
          remaining -= 1;
          checkAllDone();
          return;
        }
        if (finished) return;
        if (record && colorOf) record.albumColor = colorOf();
        const payload = buildPayload(record);
        if (payload && (payload.lyrics.syncType === "LINE_SYNCED" || order.length === 1)) {
          finished = true;
          done(payload);
          return;
        }
        if (payload && !plainFallback) {
          plainFallback = payload;
          // 有纯文本但同步歌词还在路上时，先把纯文本发出去，后续结果不再覆盖。
          // deadline 超时放行后仍然写缓存，供 feed 轮询命中。
          if (typeof setTimeout === "function") plainTimer = setTimeout(() => {
            if (!plainFallback) return;
            writeLyricsCache(cacheKey, plainFallback);
            if (!settled) emit(plainFallback);
          }, PLAIN_FALLBACK_MS);
        }
        remaining -= 1;
        checkAllDone();
      });
    }
  }

  function lookup(name, title, artist, duration, cb) {
    if (name === "lrclib") return lookupLrclib(title, artist, duration, cb);
    if (name === "netease") return lookupNetease(title, artist, duration, cb);
    if (name === "qq") return lookupQq(title, artist, duration, cb);
    if (name === "musixmatch") return lookupMusixmatch(title, artist, duration, cb);
    cb(null);
  }

  // LRCLIB：/api/get 与 /api/search 都会带回歌词。完整曲名和去掉装饰括号后的
  // 曲名各发 get + search，四路并行；首个通过校验的同步歌词立即返回，只有全都
  // 没命中时才用歌名再搜一次（歌手写法不一致的兜底）。
  function lookupLrclib(title, artist, duration, cb) {
    const cleanTitle = queryTitle(title);
    const names = cleanTitle && cleanTitle !== title ? [title, cleanTitle] : [title];
    const lists = [];
    const records = [];
    let pending = names.length * 2;
    let done = false;

    const all = () => lists.concat(records);
    const syncedPick = () => {
      const synced = [];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) if (isSynced(item)) synced.push(item);
      }
      for (const record of records) if (isSynced(record)) synced.push(record);
      return pickRecord(synced, title, duration, artist);
    };

    const finish = () => {
      if (done || pending) return;
      done = true;
      const picked = pickRecord(all(), title, duration, artist);
      if (picked) {
        cb(withProvider(picked, "LRCLIB"));
        return;
      }
      // 歌手写法不一致（feat. / 多歌手 / 翻译名）时，用歌名再搜一次；
      // pickRecord 仍会按 artist 过滤，不会把别人的同名歌当成结果。
      if (!artist) {
        cb(null);
        return;
      }
      httpGetJson("https://lrclib.net/api/search?track_name=" + encodeURIComponent(names[names.length - 1]), (list) => {
        const fallback = pickRecord(list, title, duration, artist);
        cb(fallback ? withProvider(fallback, "LRCLIB") : null);
      });
    };

    const settle = () => {
      pending -= 1;
      if (done) return;
      const hit = syncedPick();
      if (hit) {
        done = true;
        cb(withProvider(hit, "LRCLIB"));
        return;
      }
      finish();
    };

    for (const name of names) {
      const query = "track_name=" + encodeURIComponent(name) + (artist ? "&artist_name=" + encodeURIComponent(artist) : "");
      httpGetJson("https://lrclib.net/api/get?" + query, (record) => {
        if (record && "object" === typeof record) records.push(record);
        settle();
      });
      httpGetJson("https://lrclib.net/api/search?" + query, (list) => {
        if (Array.isArray(list)) lists.push(list);
        settle();
      });
    }
  }

  // 网易云：搜索接口不需要 token，中文曲库覆盖最好。
  function lookupNetease(title, artist, duration, cb) {
    const query = encodeURIComponent(queryTitle(title) + (artist ? " " + artist : ""));
    const headers = { Referer: "https://music.163.com/" };
    httpGetJson("https://music.163.com/api/search/get?s=" + query + "&type=1&limit=10&offset=0", (data) => {
      const songs = data && data.result && data.result.songs;
      const select = () => {
        const candidates = rankSongs(songs, title, artist, duration, (item) => item.name,
          (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.duration) / 1000);
        tryCandidates(candidates, (picked, next) => {
          httpGetJson("https://music.163.com/api/song/lyric?id=" + picked.id + "&lv=-1&kv=-1&tv=-1", (lyric) => {
            const text = lyric && lyric.lrc && lyric.lrc.lyric;
            next(text ? { provider: "NetEase", providerId: String(picked.id), syncedLyrics: text } : null);
          }, headers);
        }, cb);
      };
      // 搜索结果可能缺少歌手别名：只对匹配的曲目按歌手 ID 补全，最多 3 次请求。
      const pending = [];
      if (rankSongs(songs, title, artist, duration, (item) => item.name,
          (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.duration) / 1000).length) {
        select();
        return;
      }
      if (artist && Array.isArray(songs)) {
        for (const song of songs) {
          if (!song || !matchesSong(title, "", duration, song.name, "", Number(song.duration) / 1000)) continue;
          const people = Array.isArray(song.artists) ? song.artists : [];
          if (matchesArtist(artist, people.reduce((names, a) => names.concat(artistNames(a)), []))) continue;
          for (const person of people) {
            if (!person || !/^\d+$/.test(String(person.id)) || pending.some((p) => p.id === person.id)) continue;
            if (pending.length < 3) pending.push(person);
          }
        }
      }
      const resolve = () => {
        if (!pending.length) { select(); return; }
        // 歌手详情请求并行发出，全部回来后再统一补 alias；旧实现一个个等，
        // 最多 3 个歌手会串成 3 个 RTT。
        let left = pending.length;
        for (const person of pending) {
          httpGetJson("https://music.163.com/api/artist/" + person.id, (details) => {
            const verified = details && details.artist;
            if (verified && String(verified.id) === String(person.id) && Array.isArray(songs)) {
              for (const song of songs) {
                for (const candidate of (song && Array.isArray(song.artists) ? song.artists : [])) {
                  if (candidate && candidate.id === person.id) candidate.alias = artistNames(candidate).concat(artistNames(verified));
                }
              }
            }
            left -= 1;
            if (!left) select();
          }, headers);
        }
      };
      resolve();
    }, headers);
  }

  // QQ 音乐：搜索拿 songmid，再用 nobase64=1 取明文 LRC。
  function lookupQq(title, artist, duration, cb) {
    const query = encodeURIComponent(queryTitle(title) + (artist ? " " + artist : ""));
    const headers = { Referer: "https://y.qq.com/" };
    // QQ 旧版 client_search_cp 在部分网络下会直接 500 且要等 5 秒；
    // search_for_qq_cp 是同一个搜索服务的移动端入口，返回结构一致。
    httpGetJson("https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=" + query + "&format=json&n=10&p=1", (data) => {
      const list = data && data.data && data.data.song && data.data.song.list;
      const candidates = rankSongs(list, title, artist, duration, (item) => item.songname,
        (item) => (item.singer || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.interval));
      tryCandidates(candidates, (picked, next) => {
        httpGetJson(
          "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" + picked.songmid + "&format=json&nobase64=1&g_tk=5381",
          (lyric) => {
            const text = lyric && lyric.lyric;
            next(text ? { provider: "QQ Music", providerId: String(picked.songmid), syncedLyrics: text } : null);
          },
          headers,
        );
      }, cb);
    }, headers);
  }

  // Musixmatch：沿用 EeveeSpotify 的做法，先用固定 app_id 换匿名 token，
  // 再调 macro.subtitles.get 拿逐行字幕。
  function lookupMusixmatch(title, artist, duration, cb) {
    // 该接口不提供足够的场次信息，Live 曲目直接跳过。
    if (isLive(title)) { cb(null); return; }
    const APP_ID = "mac-ios-v2.0";
    httpGetJson("https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + APP_ID, (token) => {
      const userToken = token && token.message && token.message.body && token.message.body.user_token;
      if (!userToken) {
        cb(null);
        return;
      }
      const target =
        "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" + APP_ID +
        "&usertoken=" + encodeURIComponent(userToken) +
        "&track_spotify_id=" + encodeURIComponent(trackId) +
        "&subtitle_format=lrc" +
        "&q_track=" + encodeURIComponent(title) +
        (artist ? "&q_artist=" + encodeURIComponent(artist) : "") +
        "&user_language=zh";
      httpGetJson(target, (data) => {
        const status = data && data.message && data.message.header && data.message.header.status_code;
        const calls = data && data.message && data.message.body && data.message.body.macro_calls;
        const matched = calls && calls["matcher.track.get"] && calls["matcher.track.get"].message;
        const track = matched && matched.body && matched.body.track;
        // 字幕接口可能返回无关的默认结果，需同时校验曲目匹配与字幕状态。
        if (Number(status) !== 200 || !matched || !matched.header || Number(matched.header.status_code) !== 200 || !track || Number(track.instrumental) === 1 ||
            !matchesSong(title, artist, duration, track.track_name, track.artist_name, Number(track.track_length))) {
          cb(null);
          return;
        }
        const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
        const list = sub && sub.body && sub.body.subtitle_list;
        const first = Array.isArray(list) ? list[0] : null;
        const body = first && first.subtitle && first.subtitle.subtitle_body;
        if (!sub || !sub.header || Number(sub.header.status_code) !== 200 || !body || Number(first.subtitle.restricted) === 1) {
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

  function rankSongs(list, title, artist, duration, nameOf, artistOf, durationOf) {
    if (!Array.isArray(list)) return [];
    const wanted = normalize(queryTitle(title));
    const singer = normalize(artist);
    const score = (item) => {
      const name = normalize(nameOf(item));
      const seconds = durationOf(item);
      return (name === wanted ? 4 : name.indexOf(wanted) === 0 ? 2 : 0)
        + (singer && matchesArtist(artist, artistOf(item)) ? 8 : 0)
        + (Number.isFinite(duration) && duration > 0 && Math.abs(seconds - duration) <= 4 ? 6 : 0);
    };
    return list.filter((item) => item && matchesSong(title, artist, duration, nameOf(item), artistOf(item), durationOf(item)))
      .sort((a, b) => score(b) - score(a)).slice(0, 3);
  }

  function isLive(title) {
    return LIVE_MARK.test(String(title));
  }

  function songTitle(title) {
    let text = String(title).replace(SONG_TITLE_LIVE, "").replace(SONG_TITLE_LIVE_BRACKET, "");
    // 歌手名、版本说明不参与歌名比较：Spotify 常见 "Song (feat. X)"、
    // "Song - 2011 Remaster" 而曲库只写 "Song"。
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    return normalize(text);
  }

  // 查询第三方曲库时也先去掉 feat / remaster 等后缀；Live / Acoustic / Remix
  // 这类真正决定版本的信息保留，避免把现场版查成录音室版。
  // 括号里的影视 / 节目 / 歌手等装饰信息也一并去掉；只有包含版本词时才保留。
  function queryTitle(title) {
    let text = String(title);
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    text = text.replace(SONG_TITLE_BRACKET_GROUP, (whole, inner) =>
      SONG_TITLE_VERSION_BRACKET.test(inner) ? whole : " ");
    return text.replace(/\s+/g, " ").trim() || String(title);
  }

  // 曲名可能是 "Song (电影《…》主题曲)"，曲库只写 "Song"；两边都按完整曲名
  // 和去掉装饰括号后的曲名各比一次。版本词、Live、歌手等校验仍在 matchesSong
  // 里单独进行。
  function matchTitles(title, candidateTitle) {
    const wanted = [];
    for (const value of [songTitle(title), normalize(queryTitle(title))]) {
      if (value && wanted.indexOf(value) < 0) wanted.push(value);
    }
    for (const value of [songTitle(candidateTitle), normalize(queryTitle(candidateTitle))]) {
      if (value && wanted.indexOf(value) >= 0) return true;
    }
    return false;
  }

  function artistNames(person) {
    if (!person || "object" != typeof person) return [];
    return [person.name, person.trans].concat(Array.isArray(person.alias) ? person.alias : [],
      Array.isArray(person.transNames) ? person.transNames : []).filter((name) => typeof name === "string" && name.trim());
  }

  function matchesArtist(artist, candidates) {
    const names = [];
    const add = (value) => {
      if (typeof value !== "string") return;
      const text = value.trim();
      if (!text) return;
      names.push(text);
      for (const part of text.split(ARTIST_SPLIT)) {
        const name = part.trim();
        if (name) names.push(name);
      }
    };
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) add(candidate);
    } else {
      add(candidates);
    }
    // 兼容曲库的“姓, 名”写法。
    const key = (name) => normalize(String(name || "").replace(/^([^,，]+)[,，]\s*([^,，]+)$/, "$2 $1"));
    const wanted = new Set([key(artist)]);
    for (const part of String(artist || "").split(ARTIST_SPLIT)) {
      if (part.trim()) wanted.add(key(part));
    }
    wanted.delete("");
    return names.some((name) => wanted.has(key(name)));
  }

  // LRCLIB 用秒，网易云搜索用毫秒，QQ 用秒；时长可能来自任一方。
  // 大于 10000 的值按毫秒归一，避免同一首歌因为单位不同被判成两首。
  function durationSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 10000 ? number / 1000 : number;
  }

  function matchesSong(title, artist, duration, candidateTitle, candidateArtist, candidateDuration) {
    if (!candidateTitle || !matchTitles(title, candidateTitle)) return false;
    if (isLive(title) !== isLive(candidateTitle)) return false;
    if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
    const singer = normalize(artist);
    if (singer && !matchesArtist(artist, candidateArtist)) return false;
    const stage = STAGE_MARK.exec(title);
    const otherStage = STAGE_MARK.exec(candidateTitle);
    if (stage && otherStage && stage[1] !== otherStage[1]) return false;
    // 时长是最便宜的「同名翻唱 / 伴奏 / 剪辑版」过滤器：两边都有时长时，
    // 相差超过 10 秒基本不是同一版。缺时长（Spotify 元数据没拿到）时不拦。
    const wantedDuration = durationSeconds(duration);
    const candidateSeconds = durationSeconds(candidateDuration);
    const timed = Number.isFinite(wantedDuration) && wantedDuration > 0 &&
      Number.isFinite(candidateSeconds) && candidateSeconds > 0;
    const delta = timed ? Math.abs(candidateSeconds - wantedDuration) : 0;
    // 仅凭 “Live” 无法确定具体场次，需再核对时长和场次信息。
    if (isLive(title)) {
      if (timed && delta > 8) return false;
      if (stage && !otherStage && (!timed || !singer)) return false;
    } else if (timed && delta > 10) {
      return false;
    }
    return true;
  }

  // 候选歌词请求并行发出（最多 3 个），首个拿到可解析歌词的胜出；全部没歌词
  // 时返回 null。旧实现按排名一个个试，候选越多越慢。
  function tryCandidates(candidates, fetch, cb, limit = 3) {
    if (settled) return;
    const picked = Array.isArray(candidates) ? candidates.slice(0, limit) : [];
    if (!picked.length) { cb(null); return; }
    let pending = picked.length;
    let done = false;
    for (const candidate of picked) {
      fetch(candidate, (record) => {
        if (settled || done) return;
        if (buildPayload(record)) {
          done = true;
          cb(record);
          return;
        }
        pending -= 1;
        if (!pending) {
          done = true;
          cb(null);
        }
      });
    }
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
    httpGetText(target, (data) => {
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch (e) {}
      callback(parsed);
    }, extraHeaders);
  }

  function httpGetText(target, callback, extraHeaders, timeoutMs) {
    if (settled) return;
    let done = false;
    const reply = (value) => {
      if (done || settled) return;
      done = true;
      callback(value);
    };
    try {
      const headers = { "User-Agent": USER_AGENT, Accept: target.indexOf("/embed/track/") >= 0 ? "text/html" : "application/json" };
      if (extraHeaders) {
        for (const key in extraHeaders) {
          if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) headers[key] = extraHeaders[key];
        }
      }
      const options = { url: target, headers: headers, timeout: timeoutMs || 4000 };
      const onReply = (error, response, data) => {
        if (done || settled) return;
        const statusCode = Number(response && response.status);
        if (error || !response) {
          reply(null);
          return;
        }
        if (statusCode >= 400 || !data) {
          reply(null);
          return;
        }
        // 第三方接口不可控：超长响应不解析，避免 JSON.parse 占满内存。
        if ("string" != typeof data || data.length > MAX_HTTP_JSON_BYTES) {
          reply(null);
          return;
        }
        reply(data);
      };

      // 优先用客户端的 $httpClient；没有注入时回退到 QX 的 $task.fetch 和
      // 运行时自带的 fetch。某个客户端只实现了其中一种时也不会静默失败。
      if (typeof $httpClient !== "undefined" && $httpClient && typeof $httpClient.get === "function") {
        $httpClient.get(options, onReply);
        return;
      }
      if (typeof $task !== "undefined" && $task && typeof $task.fetch === "function") {
        $task.fetch({ url: target, headers: headers, timeout: timeoutMs || 4000 }).then(
          (res) => onReply(null, { status: res.statusCode || res.status }, res.body),
          (err) => onReply(err, null, null),
        );
        return;
      }
      if (typeof fetch === "function") {
        fetch(target, { headers: headers }).then(
          (res) => res.text().then((text) => onReply(null, { status: res.status }, text)),
          (err) => onReply(err, null, null),
        );
        return;
      }
      onReply(new Error("no http client"), null, null);
    } catch (e) {
      reply(null);
    }
  }

  function emit(payload) {
    if (protoMode) {
      const bytes = encodeProto(payload.lyrics.lines, payload.lyrics.syncType, payload.lyrics.provider,
        payload.lyrics.providerLyricsId, payload.lyrics.language, payload.colors);
      // 编码完成、马上 $done 时才标 served：feed 看到它说明歌词响应即将交给
      // 客户端，再等一个宽限就可以放行 scroll。
      markServed();
      // 与官方响应头保持一致。
      finish({ status: 200, headers: { "Content-Type": "application/vnd.google.protobuf" }, body: bytes });
      return;
    }

    const body = JSON.stringify(payload);
    markServed();
    finish({
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: body,
    });
  }

  // ---- protobuf ---------------------------------------------------------
  //
  // 字段与官方 color-lyrics 响应一致（Content-Type: application/vnd.google.protobuf）：
  //   message Response   { LyricsData data = 1; LyricsColors colors = 2; }
  //   message LyricsData {
  //     bool timeSynchronized = 1;         // 1 = 逐行同步
  //     repeated LyricsLine lines = 2;     // 完整歌词
  //     string provider = 3;               // "MusixMatch"
  //     string providerLyricsId = 4;       // "9539392"
  //     string providerDisplayName = 5;    // "Musixmatch"
  //     bool isDenseTypeface = 8;          // 中日韩用更紧的字形
  //     string language = 10;              // "zh-Hant"
  //     LyricsRestriction restriction = 14;// 1 = showLyrics
  //     repeated LyricsLine previewLines = 17;  // 歌词卡用的前几行
  //   }
  //   message LyricsLine { int32 offsetMs = 1; string content = 2; }
  //   message LyricsColors { uint32 backgroundColor = 1; uint32 lineColor = 2; uint32 activeLineColor = 3; }
  //
  // previewLines 供 Now Playing 歌词卡使用，必须和完整歌词一起返回。

  function encodeLine(line) {
    const content = encoder.encode(String(line.words || ""));
    return pbConcat([pbUint(1, Number(line.startTimeMs) || 0), pbBytes(2, content)]);
  }

  function encodeProto(lines, syncType, provider, providerId, language, colors) {
    const parts = [pbUint(1, syncType === "LINE_SYNCED" ? 1 : 0)];
    for (let i = 0; i < lines.length; i += 1) parts.push(pbBytes(2, encodeLine(lines[i])));
    parts.push(pbBytes(3, encoder.encode(provider || "LRCLIB")));
    parts.push(pbBytes(4, encoder.encode(String(providerId === undefined || providerId === null ? "" : providerId))));
    parts.push(pbBytes(5, encoder.encode(provider || "LRCLIB")));

    const lang = String(language || "");
    const dense = /^(?:zh|ja|ko)(?:-|$)/i.test(lang);
    if (dense) parts.push(pbUint(8, 1));
    if (lang) parts.push(pbBytes(10, encoder.encode(lang)));
    parts.push(pbUint(14, 1));
    for (let i = 0; i < lines.length && i < PREVIEW_LINES; i += 1) parts.push(pbBytes(17, encodeLine(lines[i])));

    const lyrics = pbConcat(parts);
    // colors 必须给：客户端拿它刷歌词页的背景和文字，字段缺失时是 0，alpha 也是 0，
    // 整页歌词就成了透明的。JSON 用有符号整数，protobuf 这里必须还原成 uint32。
    const argb = (value) => Number(value) >>> 0;
    const palette = colors || {};
    const colorsBytes = pbConcat([
      pbUint(1, argb(palette.background === undefined ? 0xff808080 : palette.background)),
      pbUint(2, argb(palette.text === undefined ? 0xff000000 : palette.text)),
      pbUint(3, argb(palette.highlightText === undefined ? 0xffffffff : palette.highlightText)),
    ]);
    return pbConcat([pbBytes(1, lyrics), pbBytes(2, colorsBytes)]);
  }

  function inspectProto(bytes) {
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
        return { count, top, lyrics: field, inner };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // 把 LyricsData.restriction（字段 14）统一成 1 = showLyrics。
  // 免费号额度用完时服务端回 3，客户端只显示额度提示；这里改回 1 后正常放行。
  function normalizeRestrictionProto(inspected) {
    const top = inspected.top;
    let changed = false;
    const outTop = [];
    for (let i = 0; i < top.length; i += 1) {
      const f = top[i];
      if (f !== inspected.lyrics) {
        outTop.push(pbEncodeField(f));
        continue;
      }
      const inner = inspected.inner;
      const outInner = [];
      for (let j = 0; j < inner.length; j += 1) {
        const g = inner[j];
        if (g.field === 14 && g.wire === 0) {
          if (g.value !== 1) {
            changed = true;
          }
          outInner.push(pbUint(14, 1));
          continue;
        }
        outInner.push(pbEncodeField(g));
      }
      outTop.push(pbBytes(1, pbConcat(outInner)));
    }
    return changed ? pbConcat(outTop) : null;
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
    return f.raw;
  }

  // 直接拼 Uint8Array，避免逐字节 push 到普通数组：长歌词时既慢，
  // 也可能撞上 Function.prototype.apply 的参数上限。
  function pbConcat(list) {
    let size = 0;
    for (let i = 0; i < list.length; i += 1) size += list[i].length;
    const out = new Uint8Array(size);
    let at = 0;
    for (let i = 0; i < list.length; i += 1) {
      out.set(list[i], at);
      at += list[i].length;
    }
    return out;
  }

  function pbFields(bytes) {
    const out = [];
    let pos = 0;
    while (pos < bytes.length) {
      const start = pos;
      const key = pbReadVarint(bytes, pos);
      if (key.next < 0 || !Number.isSafeInteger(key.value) || key.value < 8) throw new Error("protobuf key");
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (wire === 0) {
        const value = pbReadVarint(bytes, key.next);
        if (value.next < 0) throw new Error("protobuf varint");
        out.push({ field: field, wire: 0, value: value.value });
        pos = value.next;
      } else if (wire === 2) {
        const len = pbReadVarint(bytes, key.next);
        if (len.next < 0 || !Number.isSafeInteger(len.value) || len.value > bytes.length - len.next) throw new Error("protobuf length");
        out.push({ field: field, wire: 2, bytes: bytes.subarray(len.next, len.next + len.value) });
        pos = len.next + len.value;
      } else if (wire === 5) {
        pos = key.next + 4;
        out.push({ field, wire });
      } else if (wire === 1) {
        pos = key.next + 8;
        out.push({ field, wire });
      } else {
        throw new Error("protobuf wire");
      }
      if (pos > bytes.length) throw new Error("protobuf truncated");
      out[out.length - 1].raw = bytes.subarray(start, pos);
    }
    return out;
  }

  function pbReadVarint(bytes, pos) {
    let value = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos];
      // 绝大多数是 1-4 字节的小整数，走位运算快路径；超出后再退回乘法。
      if (shift < 28) value |= (byte & 0x7f) << shift;
      else value += (byte & 0x7f) * Math.pow(2, shift);
      pos += 1;
      if (shift === 63 && byte > 1) break;
      if ((byte & 0x80) === 0) return { value: value, next: pos };
      shift += 7;
      if (shift > 63) break;
    }
    return { value: 0, next: -1 };
  }

  function pbWriteVarint(value) {
    const out = [];
    let rest = Math.max(0, Math.floor(value));
    // 字段号 / 长度 / 毫秒时间戳都小于 2^31，位运算比 % 和 Math.floor 快。
    if (rest <= 0x7fffffff) {
      while (rest >= 128) {
        out.push((rest & 0x7f) | 0x80);
        rest >>>= 7;
      }
      out.push(rest);
      return out;
    }
    while (rest >= 128) {
      out.push((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    out.push(rest);
    return out;
  }

  function pbUint(field, value) {
    return pbConcat([pbWriteVarint(field * 8), pbWriteVarint(value)]);
  }

  function pbBytes(field, bytes) {
    return pbConcat([pbWriteVarint(field * 8 + 2), pbWriteVarint(bytes.length), bytes]);
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

  // 客户端按 startTimeMs 递增定位当前行，并据此滚动列表。外部来源的行统一在这里
  // 规范化：类型转字符串、丢掉无效和空行、按时间升序，避免乱序或空文本影响定位。
  function normalizeLines(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const line of raw) {
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      const ms = Number(line.startTimeMs);
      if (!Number.isSafeInteger(ms) || ms < 0) continue;
      out.push({ startTimeMs: String(ms), words: line.words, syllables: [], endTimeMs: "0" });
    }
    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  // 客户端按严格结构读取这个对象，字段形状需要与官方 color-lyrics/v2 一致：
  //
  //   { lyrics: { syncType, lines[], provider, providerLyricsId, providerDisplayName,
  //               syncLyricsUri, isDenseTypeface, alternatives, language,
  //               isRtlLanguage, fullscreenAction },
  //     colors: { background, text, highlightText },
  //     hasVocalRemoval }
  //
  // iOS 与桌面共用同一套 JSON 形状。
  function makePayload(syncType, rawLines, record) {
    const lines = normalizeLines(rawLines);
    if (!lines.length) return null;
    const provider = record.provider || "LRCLIB";
    const id = record.providerId !== undefined ? record.providerId : record.id;
    const language = detectLanguage(lines);
    // 值是 32 位有符号整数。
    const signed = (v) => (v > 0x7fffffff ? v - 0x100000000 : v);
    const palette = albumColors(record);
    return {
      lyrics: {
        syncType: syncType,
        lines: lines,
        provider: provider,
        providerLyricsId: id === undefined || id === null ? "" : String(id),
        providerDisplayName: provider,
        syncLyricsUri: "",
        isDenseTypeface: false,
        alternatives: [],
        language: language,
        isRtlLanguage: false,
        fullscreenAction: "FULLSCREEN_LYRICS",
      },
      colors: {
        background: signed(palette.background),
        text: signed(palette.line),
        highlightText: signed(palette.active),
      },
      hasVocalRemoval: false,
    };
  }

  // ---- 歌词页配色 -------------------------------------------------------
  //
  // 官方歌词页把封面主色当背景，未激活的行用黑字，当前 / 已唱行用白字
  // （参考 EeveeSpotify 的 LyricsColors：backgroundColor=封面提取色，
  // lineColor=黑，activeLineColor=白）。默认值 0 会让整页透明，所以必须显式给。
  // 封面色统一压到中等亮度，黑字才不会在深色封面上消失；拿不到封面色时用
  // 灰色底，与参考实现的 Color.gray 兜底一致。
  function albumColors(record) {
    const line = 0xff000000;
    const active = 0xffffffff;
    const fallback = 0xff808080;
    const source = record && record.albumColor;
    const channel = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    if (!source || !Number.isFinite(Number(source.r)) || !Number.isFinite(Number(source.g)) || !Number.isFinite(Number(source.b))) {
      return { background: fallback, line: line, active: active };
    }
    const r = channel(source.r);
    const g = channel(source.g);
    const b = channel(source.b);
    const brightness = (r * 299 + g * 587 + b * 114) / 255000;
    const amount = Math.abs(0.5 - brightness);
    const mix = (value) => (brightness < 0.5
      ? Math.round(value * (1 - amount) + 255 * amount)
      : Math.round(value * (1 - amount)));
    const background = (0xff000000 | (mix(r) << 16) | (mix(g) << 8) | mix(b)) >>> 0;
    return { background: background, line: line, active: active };
  }

  // 公开 embed 页面（__NEXT_DATA__）同时带曲目元数据与封面主色。
  function parseEmbedTrack(html) {
    try {
      const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ""));
      const data = match && JSON.parse(match[1]);
      const entity = data && data.props && data.props.pageProps && data.props.pageProps.state && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
      if (!entity || entity.type !== "track" || entity.id !== trackId || !(entity.title || entity.name)) return null;
      const artists = Array.isArray(entity.artists)
        ? entity.artists.filter(Boolean).map((item) => item && item.name).filter((name) => typeof name === "string" && name.trim())
        : [];
      const base = entity.visualIdentity && entity.visualIdentity.backgroundBase;
      const color = base && Number.isFinite(Number(base.red)) && Number.isFinite(Number(base.green)) && Number.isFinite(Number(base.blue))
        ? { r: Number(base.red), g: Number(base.green), b: Number(base.blue) }
        : null;
      return {
        title: String(entity.title || entity.name),
        artist: artists.join(", "),
        duration: Number(entity.duration) / 1000,
        color: color,
      };
    } catch (e) {
      return null;
    }
  }

  // LRC -> Spotify 的 lines。支持一行多个时间戳、[offset:±ms]、两位或三位毫秒。
  function parseLrc(text) {
    const out = [];
    let offset = 0;

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      const off = LRC_OFFSET.exec(line);
      if (off) {
        offset = parseInt(off[1], 10) || 0;
        continue;
      }

      const stamps = [];
      let m;
      LRC_STAMP.lastIndex = 0;
      while ((m = LRC_STAMP.exec(line))) stamps.push(m);
      if (!stamps.length) continue;

      const words = line.replace(LRC_BRACKET, "").trim();
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
  function pickRecord(list, title, duration, artist) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = normalize(title);
    const usable = list.filter((item) => {
      if (!item || "object" != typeof item || item.instrumental) return false;
      if (!matchesSong(title, artist, duration, item.trackName, item.artistName, Number(item.duration))) return false;
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
    const singer = normalize(artist);
    const score = (item) => (synced(item) ? 2 : 0) + (named(item) ? 1 : 0) + (near(item) ? 4 : 0)
      + (singer && matchesArtist(artist, item.artistName) ? 8 : 0);

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
    // NFKC 处理全角 / 组合字符；翻译与简繁转换需要来源提供对应文本。
    return String(text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(NORMALIZE_DROP, "");
  }

  function detectLanguage(lines) {
    const sample = lines
      .slice(0, 20)
      .map((line) => line.words)
      .join("");
    if (KANA_MARK.test(sample)) return "ja";
    if (HANGUL_MARK.test(sample)) return "ko";
    if (HAN_MARK.test(sample)) return "zh";
    return "en";
  }
})();
