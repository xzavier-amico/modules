// Spotify Mock — server-side lyrics.
//
// The client modules only rewrite color-lyrics to this service. This file does
// the two jobs that used to run in the Spotify Enhance client script:
//
//   * official 200 with lyrics: remove the free-account monthly-limit
//     restriction and pass the (possibly cleaned) body through;
//   * official 404 / empty: look the track up through open.spotify.com/oembed,
//     search third-party lyric providers, and synthesize the JSON or protobuf
//     response the client expects.
//
// On the server the provider lookup can start while the official request is
// still in flight (see index.js), so the 404 path usually just awaits a result
// that is already there. LYRICS_PARALLEL=false disables that behaviour.
//
// All third-party traffic happens here, so iPhone / iPad / Mac clients do not
// need a response script at all.

import { createPatcher } from "./patcher.js";

const hanVariants = createPatcher().hanVariants;

// LRCLIB asks callers to identify themselves, so the descriptive UA stays the
// default. NetEase / QQ Music are web endpoints: a browser UA is what their
// anti-bot rules expect (and what the client scripts send).
const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const SOURCES = ["lrclib", "musixmatch", "netease", "qq"];
const AUTO_SOURCES = ["lrclib", "musixmatch", "netease", "qq"];

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL = 21600;
const MAX_CACHE_ENTRIES = 500;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 4000;

// Lyrics screen colours, ARGB. The client defaults to 0 (fully transparent),
// so synthesized responses must always include them.
// Official responses carry at most 5 preview lines for the lyrics card.
const PREVIEW_LINES = 5;
function previewFromLines(lines) {
  return lines.slice(0, PREVIEW_LINES);
}
const COLOR_BG = 0xff121212;
const COLOR_LINE = 0xb3ffffff;
const COLOR_ACTIVE = 0xffffffff;

const TE = new TextEncoder();
const TD = new TextDecoder("utf-8");

function flag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === "0" || text === "false" || text === "no" || text === "off") return false;
  return true;
}

function numberIn(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseSources(raw) {
  const text = String(raw || "").trim().toLowerCase();
  // Unset keeps the old client default; "auto" is the explicit fallback chain.
  if (!text) return { label: "lrclib", list: ["lrclib"] };
  if (text === "auto") return { label: "auto", list: AUTO_SOURCES.slice() };
  const list = [];
  for (const part of text.split(",")) {
    const name = part.trim();
    if (SOURCES.indexOf(name) >= 0 && list.indexOf(name) < 0) list.push(name);
  }
  if (!list.length) return { label: "lrclib", list: ["lrclib"] };
  return { label: list.join(","), list };
}

export function lyricsOptions(env = {}) {
  const sources = parseSources(env.LYRICS_SOURCE);
  const script = String(env.LYRICS_SCRIPT || "hans").trim().toLowerCase();
  return {
    enabled: flag(env.LYRICS_ENABLED, true),
    source: sources.label,
    sources: sources.list,
    timeoutMs: numberIn(env.LYRICS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 30000),
    cacheTtlMs: numberIn(env.LYRICS_CACHE_TTL, DEFAULT_CACHE_TTL, 0, 604800) * 1000,
    // 官方请求与第三方查询并行；关掉退回「先等官方、404 再查」。
    parallel: flag(env.LYRICS_PARALLEL, true),
    hansLyrics: script !== "source" && script !== "original" && script !== "keep",
    ignoreHanVariants: flag(env.LYRICS_IGNORE_HAN_VARIANTS, true),
    syncPlainLyrics: flag(env.LYRICS_SYNC_PLAIN, true),
    isrcLookup: flag(env.LYRICS_ISRC, true),
  };
}

export function lyricsInfo(env = {}) {
  const options = lyricsOptions(env);
  return {
    enabled: options.enabled,
    source: options.source,
    timeoutMs: options.timeoutMs,
    cacheTtl: Math.round(options.cacheTtlMs / 1000),
    parallel: options.parallel,
  };
}

// ---------------------------------------------------------------- HTTP / JSON

// countAnswer=false is used for the metadata request: it succeeds even when every
// lyric provider is unreachable, so it must not count as a provider answer.
async function getJson(target, ctx, extraHeaders, countAnswer = true) {
  const remaining = ctx.deadline - Date.now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timeout = Math.min(remaining, REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeout);
  const answered = () => {
    if (countAnswer && ctx) ctx.answered = (ctx.answered || 0) + 1;
  };
  try {
    const headers = { "user-agent": USER_AGENT, accept: "application/json" };
    if (extraHeaders) {
      for (const key of Object.keys(extraHeaders)) headers[key] = extraHeaders[key];
    }
    const response = await fetch(target, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response) return null;
    // 404 / 400 is the provider's authoritative "not in our catalogue"; 5xx / 429
    // and timeouts are transient and must never be reported as "no lyrics".
    if (response.status === 404 || response.status === 400) {
      answered();
      return null;
    }
    if (response.status < 200 || response.status >= 300) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_JSON_BYTES) return null;
    const text = await response.text();
    // Third-party APIs are not trusted: never JSON.parse an unbounded response.
    if (!text || text.length > MAX_JSON_BYTES) return null;
    answered();
    return JSON.parse(text);
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getText(target, ctx, extraHeaders) {
  const remaining = ctx.deadline - Date.now();
  if (remaining <= 0) return "";
  const controller = new AbortController();
  const timeout = Math.min(remaining, REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { "user-agent": BROWSER_UA };
    if (extraHeaders) {
      for (const key of Object.keys(extraHeaders)) headers[key] = extraHeaders[key];
    }
    const response = await fetch(target, { headers, signal: controller.signal, redirect: "follow" });
    if (!response || response.status < 200 || response.status >= 300) return "";
    const text = await response.text();
    return text && text.length <= MAX_JSON_BYTES ? text : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function parseEmbedTrack(html) {
  if (!html) return null;
  const startToken = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(startToken);
  if (start < 0) return null;
  const bodyStart = start + startToken.length;
  const end = html.indexOf("</script>", bodyStart);
  if (end < 0) return null;
  try {
    const nextData = JSON.parse(html.slice(bodyStart, end));
    const entity = nextData?.props?.pageProps?.state?.data?.entity;
    if (!entity || !entity.name) return null;
    const artists = Array.isArray(entity.artists)
      ? entity.artists.map((a) => String((a && a.name) || "").trim()).filter(Boolean).join(", ")
      : "";
    const durationMs = Number(entity.duration || 0);
    return {
      title: String(entity.name),
      artist: artists,
      duration: Number.isFinite(durationMs) && durationMs > 10000 ? durationMs / 1000 : NaN,
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- metadata

async function lookupMetadata(trackId, ctx) {
  const target =
    "https://open.spotify.com/oembed?url=" +
    encodeURIComponent("https://open.spotify.com/track/" + trackId);
  const meta = await getJson(target, ctx, null, false);
  const oembedTitle = meta && meta.title ? String(meta.title) : "";
  const oembedArtist = meta && meta.author_name ? String(meta.author_name).trim() : "";
  if (oembedTitle && oembedArtist && !isLive(oembedTitle)) {
    return { title: oembedTitle, artist: oembedArtist, duration: NaN };
  }
  const embedHtml = await getText("https://open.spotify.com/embed/track/" + trackId, ctx);
  const page = parseEmbedTrack(embedHtml);
  const title = (isLive(oembedTitle) && page && page.title) || oembedTitle || (page && page.title) || "";
  if (!title) return null;
  const artist = oembedArtist || (page && page.artist) || "";
  return { title: String(title), artist: String(artist).trim(), duration: page ? page.duration : NaN };
}

// --------------------------------------------------------------------- sources

function durationSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return n > 10000 ? n / 1000 : n;
}

function foldHan(value, ignoreHan = true) {
  const text = String(value || "");
  return ignoreHan && hanVariants ? hanVariants.fold(text) : text;
}

async function lookupLrclib(title, artist, duration, ctx, options = {}) {
  const ignoreHan = options.ignoreHanVariants !== false;
  const query = (name, singer = artist) =>
    "track_name=" + encodeURIComponent(name) + (singer ? "&artist_name=" + encodeURIComponent(singer) : "");
  const clean = queryTitle(title);
  const foldedTitle = foldHan(title, ignoreHan);
  const foldedClean = foldHan(clean, ignoreHan);
  const foldedArtist = foldHan(artist, ignoreHan);

  const getSpecs = [];
  const addGet = (name, singer) => {
    if (!name) return;
    const url = "https://lrclib.net/api/get?" + query(name, singer);
    if (!getSpecs.includes(url)) getSpecs.push(url);
  };
  addGet(title, artist);
  if (clean && clean !== title) addGet(clean, artist);
  if (ignoreHan && (foldedTitle !== title || foldedArtist !== artist)) addGet(foldedTitle, foldedArtist);
  if (ignoreHan && foldedClean && foldedClean !== clean) addGet(foldedClean, foldedArtist);

  const searchUrls = [];
  const addSearch = (name, singer) => {
    if (!name) return;
    const url = "https://lrclib.net/api/search?" + query(name, singer);
    if (!searchUrls.includes(url)) searchUrls.push(url);
  };
  addSearch(clean || title, artist);
  if (ignoreHan && foldedClean && foldedClean !== (clean || title)) addSearch(foldedClean, foldedArtist);

  const validateExact = (rec) => {
    if (!hasAnyLyrics(rec) || rec.instrumental) return false;
    if (!rec.trackName) return true;
    return (
      matchesSong(title, artist, duration, rec.trackName, rec.artistName, rec.duration, ignoreHan) ||
      matchesSongLoose(title, artist, duration, rec.trackName, rec.artistName, rec.duration, ignoreHan)
    );
  };

  const results = await Promise.all([
    ...getSpecs.map((url) => getJson(url, ctx).then((rec) => ({ kind: "get", rec }))),
    ...searchUrls.map((url) => getJson(url, ctx).then((list) => ({ kind: "search", list }))),
  ]);

  let getRecord = null;
  const searchItems = [];
  for (const r of results) {
    if (r.kind === "get" && validateExact(r.rec)) {
      if (!getRecord || isSynced(r.rec)) getRecord = r.rec;
    } else if (r.kind === "search" && Array.isArray(r.list)) {
      for (const item of r.list) searchItems.push(item);
    }
  }
  if (getRecord && isSynced(getRecord)) {
    const out = buildLyrics(withProvider(getRecord, "LRCLIB"), options);
    if (out) return out;
  }
  const anchor = Number.isFinite(duration) && duration > 0
    ? duration
    : getRecord && Number.isFinite(Number(getRecord.duration))
      ? durationSeconds(getRecord.duration)
      : NaN;
  const picked = pickRecord(searchItems, title, artist, anchor, ignoreHan);
  if (picked) {
    const out = buildLyrics(withProvider(picked, "LRCLIB"), options);
    if (out) return out;
  }
  return getRecord ? buildLyrics(withProvider(getRecord, "LRCLIB"), options) : null;
}

async function lookupNetease(title, artist, duration, ctx, options = {}) {
  const ignoreHan = options.ignoreHanVariants !== false;
  const queryArtist = isDj(title) ? "" : artist;
  const qName = queryTitle(title);
  const query = encodeURIComponent(foldHan(qName, ignoreHan) + (queryArtist ? " " + foldHan(queryArtist, ignoreHan) : ""));
  const headers = { Referer: "https://music.163.com/", "User-Agent": BROWSER_UA };
  const data = await getJson(
    "https://music.163.com/api/search/get?s=" + query + "&type=1&limit=5&offset=0",
    ctx,
    headers,
  );
  const songs = data && data.result && data.result.songs;
  const pickedList = pickSongs(
    songs,
    title,
    artist,
    duration,
    (item) => item.name,
    (item) => (item.artists || item.ar || []).map((a) => a && a.name).filter(Boolean).join(", "),
    (item) => item.duration,
    ignoreHan,
  );
  if (!pickedList.length) return null;

  const builtList = await Promise.all(
    pickedList.map(async (item) => {
      const lyric = await getJson(
        "https://music.163.com/api/song/lyric?id=" + item.id + "&lv=-1&kv=-1&tv=-1",
        ctx,
        headers,
      );
      const text = lyric && lyric.lrc && lyric.lrc.lyric;
      if (!text) return null;
      return buildLyrics({ provider: "NetEase", providerId: String(item.id), duration, syncedLyrics: text }, options);
    }),
  );
  return builtList.find((r) => r && r.syncType === "LINE_SYNCED" && !r.pseudo) || builtList.find(Boolean) || null;
}

const HTML_ENTITIES = { apos: "'", quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " " };
function decodeHtmlEntities(text) {
  if (typeof text !== "string" || text.indexOf("&") < 0) return String(text || "");
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|apos|quot|amp|lt|gt|nbsp);/g, (whole, body) => {
    if (body.charAt(0) === "#") {
      const code = body.charAt(1) === "x" || body.charAt(1) === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return HTML_ENTITIES[body] || whole;
  });
}

async function lookupQq(title, artist, duration, ctx, options = {}) {
  const ignoreHan = options.ignoreHanVariants !== false;
  const queryArtist = isDj(title) ? "" : artist;
  const qName = queryTitle(title);
  const query = encodeURIComponent(foldHan(qName, ignoreHan) + (queryArtist ? " " + foldHan(queryArtist, ignoreHan) : ""));
  const headers = { Referer: "https://y.qq.com/", "User-Agent": MOBILE_UA };
  const data = await getJson(
    "https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=" + query + "&format=json&n=5&p=1",
    ctx,
    headers,
  );
  const list = data && data.data && data.data.song && data.data.song.list;
  const pickedList = pickSongs(
    list,
    title,
    artist,
    duration,
    (item) => item.songname,
    (item) => (item.singer || []).map((s) => s && s.name).filter(Boolean).join(", "),
    (item) => item.interval,
    ignoreHan,
  );
  if (!pickedList.length) return null;

  const builtList = await Promise.all(
    pickedList.map(async (item) => {
      const lyric = await getJson(
        "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" +
          encodeURIComponent(String(item.songmid)) +
          "&format=json&nobase64=1&g_tk=5381",
        ctx,
        headers,
      );
      const text = lyric && lyric.lyric ? decodeHtmlEntities(lyric.lyric) : "";
      if (!text) return null;
      return buildLyrics({ provider: "QQ Music", providerId: String(item.songmid), duration, syncedLyrics: text }, options);
    }),
  );
  return builtList.find((r) => r && r.syncType === "LINE_SYNCED" && !r.pseudo) || builtList.find(Boolean) || null;
}

// Musixmatch: exchange the public app id for an anonymous token (cached 8 min),
// then ask the macro endpoint for line-synced subtitles (same approach as EeveeSpotify).
const MMX_TOKEN_TTL_MS = 8 * 60 * 1000;
let cachedMmxToken = { token: "", at: 0 };

async function getMmxToken(ctx) {
  const APP_ID = "mac-ios-v2.0";
  let userToken = cachedMmxToken.token && Date.now() - cachedMmxToken.at < MMX_TOKEN_TTL_MS ? cachedMmxToken.token : "";
  if (userToken) return userToken;
  const token = await getJson("https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + APP_ID, ctx, null, false);
  userToken = token && token.message && token.message.body && token.message.body.user_token;
  if (!userToken) return "";
  cachedMmxToken = { token: String(userToken), at: Date.now() };
  return cachedMmxToken.token;
}

async function lookupMusixmatch(title, artist, duration, ctx, options = {}) {
  const ignoreHan = options.ignoreHanVariants !== false;
  const APP_ID = "mac-ios-v2.0";
  const userToken = await getMmxToken(ctx);
  if (!userToken) return null;

  const target =
    "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" +
    APP_ID +
    "&usertoken=" +
    encodeURIComponent(userToken) +
    "&subtitle_format=lrc&q_track=" +
    encodeURIComponent(queryTitle(title)) +
    (artist ? "&q_artist=" + encodeURIComponent(artist) : "") +
    "&user_language=zh";
  const data = await getJson(target, ctx);
  const status = data && data.message && data.message.header && data.message.header.status_code;
  if (data && Number(status) !== 200) {
    cachedMmxToken = { token: "", at: 0 };
    return null;
  }
  const calls = data && data.message && data.message.body && data.message.body.macro_calls;
  const matched = calls && calls["matcher.track.get"] && calls["matcher.track.get"].message;
  const track = matched && matched.body && matched.body.track;
  if (track && Number(track.instrumental) === 1) return null;
  if (
    track &&
    track.track_name &&
    !matchesSongLoose(title, artist, duration, track.track_name, track.artist_name, track.track_length, ignoreHan)
  ) {
    return null;
  }
  const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
  const list = sub && sub.body && sub.body.subtitle_list;
  const first = Array.isArray(list) ? list[0] : null;
  const body = first && first.subtitle && first.subtitle.subtitle_body;
  if (!body || Number(first.subtitle.restricted) === 1) return null;
  return buildLyrics(
    { provider: "Musixmatch", providerId: String(first.subtitle.subtitle_id || ""), duration, syncedLyrics: body },
    options,
  );
}

async function lookupMusixmatchByIsrc(isrc, duration, ctx, options = {}) {
  if (!isrc) return null;
  const APP_ID = "mac-ios-v2.0";
  const userToken = await getMmxToken(ctx);
  if (!userToken) return null;
  const target =
    "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" +
    APP_ID +
    "&usertoken=" +
    encodeURIComponent(userToken) +
    "&subtitle_format=lrc&track_isrc=" +
    encodeURIComponent(isrc) +
    "&user_language=zh";
  const data = await getJson(target, ctx);
  const status = data && data.message && data.message.header && data.message.header.status_code;
  if (data && Number(status) !== 200) {
    cachedMmxToken = { token: "", at: 0 };
    return null;
  }
  const calls = data && data.message && data.message.body && data.message.body.macro_calls;
  const matched = calls && calls["matcher.track.get"] && calls["matcher.track.get"].message;
  const track = matched && matched.body && matched.body.track;
  if (track && Number(track.instrumental) === 1) return null;
  const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
  const list = sub && sub.body && sub.body.subtitle_list;
  const first = Array.isArray(list) ? list[0] : null;
  const body = first && first.subtitle && first.subtitle.subtitle_body;
  if (!body || Number(first.subtitle.restricted) === 1) return null;
  return buildLyrics(
    { provider: "Musixmatch", providerId: String(first.subtitle.subtitle_id || ""), duration, syncedLyrics: body },
    options,
  );
}

async function lookupDeezer(title, artist, duration, ctx, ignoreHan) {
  const primary = String(artist || "").split(",")[0].trim();
  const q = queryTitle(title) + (primary ? " " + primary : "");
  const search = await getJson("https://api.deezer.com/search?q=" + encodeURIComponent(q) + "&limit=5", ctx, null, false);
  const list = search && Array.isArray(search.data) ? search.data : [];
  let picked = null;
  for (const item of list) {
    if (!item || !item.id) continue;
    const candArtist = item.artist && item.artist.name ? item.artist.name : "";
    if (
      matchesSong(title, artist, duration, item.title, candArtist, item.duration, ignoreHan) ||
      matchesSongLoose(title, artist, duration, item.title, candArtist, item.duration, ignoreHan)
    ) {
      picked = item;
      break;
    }
  }
  if (!picked) return null;
  const detail = await getJson("https://api.deezer.com/track/" + encodeURIComponent(String(picked.id)), ctx, null, false);
  if (!detail || !detail.title) return null;
  return {
    title: String(detail.title),
    artist: String((detail.artist && detail.artist.name) || (picked.artist && picked.artist.name) || "").trim(),
    isrc: String(detail.isrc || ""),
    duration: Number.isFinite(Number(detail.duration)) ? Number(detail.duration) : duration,
  };
}

function lookupSource(name, title, artist, duration, ctx, options) {
  if (name === "lrclib") return lookupLrclib(title, artist, duration, ctx, options);
  if (name === "netease") return lookupNetease(title, artist, duration, ctx, options);
  if (name === "qq") return lookupQq(title, artist, duration, ctx, options);
  if (name === "musixmatch") return lookupMusixmatch(title, artist, duration, ctx, options);
  return Promise.resolve(null);
}

// ------------------------------------------------------------------ lyric data

function withProvider(record, name) {
  const out = {};
  for (const key of Object.keys(record)) out[key] = record[key];
  out.provider = name;
  return out;
}

function isSynced(record) {
  return Boolean(record && typeof record.syncedLyrics === "string" && record.syncedLyrics.trim());
}

function hasAnyLyrics(record) {
  return Boolean(
    record &&
      ((typeof record.syncedLyrics === "string" && record.syncedLyrics.trim()) ||
        (typeof record.plainLyrics === "string" && record.plainLyrics.trim())),
  );
}

const LIVE_MARK = /(?:\blive\b|live版|现场|現場|[一二三四五六七八九十\d]+公)/i;
const INSTRUMENTAL_MARK = /伴奏|instrumental|karaoke/i;
const ARTIST_SPLIT = /[,，、/;&]|\b(?:feat\.?|ft\.?|featuring|with)\b/i;

function isLive(title) {
  return LIVE_MARK.test(String(title || ""));
}

function normalize(text, ignoreHan = true) {
  return foldHan(text, ignoreHan)
    .toLowerCase()
    .replace(/[^0-9a-z\u00c0-\uffff]+/gi, "");
}

function stripParenGroups(text, shouldDrop) {
  const s = String(text || "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    const openIdx = ch === "(" ? 0 : ch === "（" ? 1 : ch === "[" ? 2 : -1;
    if (openIdx < 0) {
      out += ch;
      i += 1;
      continue;
    }
    const closeCh = openIdx === 0 ? ")" : openIdx === 1 ? "）" : "]";
    let depth = 0;
    let j = i;
    let matched = false;
    while (j < s.length) {
      const c = s.charAt(j);
      if (c === ch) depth += 1;
      else if (c === closeCh) {
        depth -= 1;
        if (depth === 0) {
          matched = true;
          break;
        }
      }
      j += 1;
    }
    if (!matched) {
      out += ch;
      i += 1;
      continue;
    }
    const group = s.slice(i, j + 1);
    const inner = s.slice(i + 1, j);
    if (shouldDrop(group, inner)) out += " ";
    else out += group;
    i = j + 1;
  }
  return out;
}

function titleKeys(title, ignoreHan = true) {
  const keys = [];
  for (const value of [normalize(title, ignoreHan), normalize(queryTitle(title), ignoreHan)]) {
    if (value && keys.indexOf(value) < 0) keys.push(value);
  }
  return keys;
}

function matchTitles(wantedTitle, candidateTitle, ignoreHan = true) {
  const w = titleKeys(wantedTitle, ignoreHan);
  const c = titleKeys(candidateTitle, ignoreHan);
  for (const wk of w) {
    for (const ck of c) {
      if (wk === ck) return true;
      if (wk.length >= 2 && ck.length >= 2 && (ck.indexOf(wk) === 0 || wk.indexOf(ck) === 0)) return true;
    }
  }
  return false;
}

function matchesArtist(wantedArtist, candidateArtist, ignoreHan = true) {
  const parts = (s) =>
    String(s || "")
      .split(ARTIST_SPLIT)
      .map((p) => normalize(p, ignoreHan))
      .filter(Boolean);
  const wList = parts(wantedArtist);
  const cList = parts(candidateArtist);
  if (!wList.length || !cList.length) return !wList.length;
  for (const w of wList) {
    for (const c of cList) {
      if (w === c || (w.length >= 2 && c.length >= 2 && (w.includes(c) || c.includes(w)))) return true;
    }
  }
  return false;
}

function matchesSong(title, artist, duration, candidateTitle, candidateArtist, candidateDuration, ignoreHan = true) {
  if (!candidateTitle || !matchTitles(title, candidateTitle, ignoreHan)) return false;
  if (isLive(title) !== isLive(candidateTitle)) return false;
  if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
  const dj = isDj(title) || isDj(candidateTitle);
  const singer = normalize(artist, ignoreHan);
  if (singer && !dj && candidateArtist && !matchesArtist(artist, candidateArtist, ignoreHan)) return false;
  const wd = durationSeconds(duration);
  const cd = durationSeconds(candidateDuration);
  if (Number.isFinite(wd) && wd > 0 && Number.isFinite(cd) && cd > 0) {
    if (Math.abs(cd - wd) > (dj ? 60 : isLive(title) ? 8 : 10)) return false;
  }
  return true;
}

function matchesSongLoose(title, artist, duration, candidateTitle, candidateArtist, candidateDuration, ignoreHan = true) {
  if (!candidateTitle) return false;
  const w = titleKeys(title, ignoreHan);
  const c = titleKeys(candidateTitle, ignoreHan);
  if (!w.length || !c.some((k) => w.includes(k))) return false;
  if (isLive(title) !== isLive(candidateTitle)) return false;
  if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
  const wd = durationSeconds(duration);
  const cd = durationSeconds(candidateDuration);
  if (Number.isFinite(wd) && wd > 0 && Number.isFinite(cd) && cd > 0) {
    if (Math.abs(cd - wd) > 12) return false;
    return true;
  }
  const singer = normalize(artist, ignoreHan);
  return !singer || !candidateArtist || isDj(title) || isDj(candidateTitle) || matchesArtist(artist, candidateArtist, ignoreHan);
}

function pickSongs(list, title, artist, duration, nameOf, artistOf, durOf, ignoreHan = true) {
  if (!Array.isArray(list) || !list.length) return [];
  const strict = [];
  const loose = [];
  for (const item of list) {
    if (!item) continue;
    const candTitle = nameOf(item);
    const candArtist = artistOf ? artistOf(item) : "";
    const candDur = durOf ? durOf(item) : NaN;
    if (matchesSong(title, artist, duration, candTitle, candArtist, candDur, ignoreHan)) strict.push(item);
    else if (matchesSongLoose(title, artist, duration, candTitle, candArtist, candDur, ignoreHan)) loose.push(item);
  }
  const matched = strict.length ? strict : loose;
  const wanted = titleKeys(title, ignoreHan);
  matched.sort((a, b) => {
    const exactA = normalize(nameOf(a), ignoreHan) === wanted[0] ? 1 : 0;
    const exactB = normalize(nameOf(b), ignoreHan) === wanted[0] ? 1 : 0;
    return exactB - exactA;
  });
  return matched.slice(0, 3);
}

// Same title often has several versions (original, video edit, extended mix).
// Prefer validated strict matches, close duration, synced lyrics, exact title.
function pickRecord(list, title, artist, duration, ignoreHan = true) {
  if (!Array.isArray(list) || !list.length) return null;
  const usable = list.filter((item) => {
    if (!item || typeof item !== "object" || item.instrumental) return false;
    if (!hasAnyLyrics(item)) return false;
    return !item.trackName || matchesSong(title, artist, duration, item.trackName, item.artistName, item.duration, ignoreHan) ||
      matchesSongLoose(title, artist, duration, item.trackName, item.artistName, item.duration, ignoreHan);
  });
  if (!usable.length) return null;

  const wanted = titleKeys(title, ignoreHan);
  const synced = (item) => Boolean(item.syncedLyrics && item.syncedLyrics.trim());
  const strict = (item) =>
    !item.trackName || matchesSong(title, artist, duration, item.trackName, item.artistName, item.duration, ignoreHan);
  const named = (item) => titleKeys(item.trackName, ignoreHan).some((key) => wanted.indexOf(key) >= 0);
  const near = (item) =>
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(durationSeconds(item.duration)) &&
    Math.abs(durationSeconds(item.duration) - duration) <= 3;
  const score = (item) => (strict(item) ? 8 : 0) + (near(item) ? 4 : 0) + (synced(item) ? 2 : 0) + (named(item) ? 1 : 0);

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

// Decorative parentheses are common in Spotify metadata but absent from lyric
// databases: "Song (电影《…》主题曲)", "Song (电视剧片尾曲)", "Song (歌手名)".
// Remove those groups, but keep version-defining ones such as (Live), (Remix)
// and (伴奏) so a studio track is not matched to a live recording.
const TITLE_VERSION_BRACKET =
  /\b(?:live|acoustic|unplugged|remix|mix|version|edit|remaster(?:ed)?|instrumental|karaoke|demo|cover|session|mono|stereo|deluxe|bonus|explicit|clean)\b|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|混音|重制|重製|翻唱|翻自|试听|試聽|片段|版/i;
const TITLE_NOISE_BRACKET =
  /\b(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|feat\.?|ft\.?|featuring|with|prod\.?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\b/i;
const TITLE_DASH_FEAT = /\s*[-–—]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)\b.*$/i;
const TITLE_DASH_EDITION =
  /\s*[-–—]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\s*$/i;

// Spotify often writes "Song (DJ版)" / "Song - DJ Remix" while the lyric
// databases only list "Song". Drop the DJ marker before searching and skip the
// artist constraint, since the DJ edit is usually credited to someone else.
const DJ_VERSION_MARK =
  /dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club)|(?:^|[\s\-–—])dj\s*$/i;
const TITLE_DASH_DJ =
  /\s*[-–—]\s*dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club).*$|\s*[-–—]\s*dj\s*$/i;
const TITLE_LEADING_DJ = /^\s*dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club)\s*[-–—:]?\s*/i;

function isDj(title) {
  const s = String(title || "");
  if (DJ_VERSION_MARK.test(s)) return true;
  return /[（(\[]\s*dj\s*[)）\]]/i.test(s);
}

function stripDjVersion(title) {
  let text = stripParenGroups(title, (whole, inner) => DJ_VERSION_MARK.test(inner) || /^\s*dj\s*$/i.test(inner));
  return text.replace(TITLE_DASH_DJ, "").replace(TITLE_LEADING_DJ, "");
}

function queryTitle(title) {
  let text = stripDjVersion(title);
  text = text.replace(TITLE_DASH_FEAT, "").replace(TITLE_DASH_EDITION, "");
  text = stripParenGroups(text, (whole, inner) => {
    if (TITLE_NOISE_BRACKET.test(inner)) return true;
    return !TITLE_VERSION_BRACKET.test(inner);
  });
  return text.replace(/\s+/g, " ").trim() || String(title || "");
}

// LRC -> Spotify lines. Supports multiple timestamps per line, [offset:±ms],
// and two- or three-digit milliseconds.
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
    let match;
    while ((match = re.exec(line))) stamps.push(match);
    if (!stamps.length) continue;

    const words = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!words) continue;

    for (const stamp of stamps) {
      const minutes = parseInt(stamp[1], 10);
      const seconds = parseInt(stamp[2], 10);
      const fracRaw = stamp[3] || "0";
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
      let ms = Math.round((minutes * 60 + seconds + frac) * 1000) - offset;
      if (ms < 0) ms = 0;
      out.push({ startTimeMs: String(ms), words, syllables: [], endTimeMs: "0" });
    }
  }

  out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
  return out;
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

function buildLyrics(record, options = {}) {
  if (!record || typeof record !== "object" || record.instrumental) return null;

  if (typeof record.syncedLyrics === "string") {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length) return makeLyrics("LINE_SYNCED", lines, record, options);
  }

  if (typeof record.plainLyrics === "string") {
    const rawLines = record.plainLyrics
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (rawLines.length) {
      const durationSec = durationSeconds(record.duration);
      if (options.syncPlainLyrics !== false && Number.isFinite(durationSec) && durationSec > 10) {
        const spanMs = Math.max(1000, Math.round(durationSec * 1000) - 2000);
        const step = spanMs / rawLines.length;
        const synced = rawLines.map((words, idx) => ({
          startTimeMs: String(Math.round(idx * step)),
          words,
          syllables: [],
          endTimeMs: "0",
        }));
        const out = makeLyrics("LINE_SYNCED", synced, record, options);
        if (out) out.pseudo = true;
        return out;
      }
      const lines = rawLines.map((words) => ({ startTimeMs: "0", words, syllables: [], endTimeMs: "0" }));
      return makeLyrics("UNSYNCED", lines, record, options);
    }
  }

  return null;
}

function makeLyrics(syncType, lines, record, options = {}) {
  const provider = record.provider || "LRCLIB";
  const id = record.providerId !== undefined ? record.providerId : record.id;
  const sample = lines.slice(0, 20).map((line) => line.words).join("");
  let finalLines = lines;
  let language = detectLanguage(lines);
  if (options.hansLyrics !== false && hanVariants && hanVariants.isTraditional(sample)) {
    finalLines = lines.map((line) => ({
      startTimeMs: line.startTimeMs,
      words: hanVariants.fold(line.words),
      syllables: line.syllables,
      endTimeMs: line.endTimeMs,
    }));
    language = "zh-Hans";
  }
  return {
    syncType,
    lines: finalLines,
    provider,
    providerId: id === undefined || id === null ? "" : String(id),
    language,
  };
}

// ------------------------------------------------------------------ cache

const cache = new Map();
const inflight = new Map();
// 官方有歌词的曲目记一笔：下次打开同一首歌的歌词页不再并行空跑一轮第三方源。
// 只决定「要不要提前发第三方请求」，不改变响应内容，也不缓存官方歌词本身。
const officialHits = new Map();
const OFFICIAL_HIT_TTL_MS = 6 * 60 * 60 * 1000;
// 乐观补出来的歌词卡需要知道「这次确实没歌词」，避免同一首歌反复显示空卡。
const misses = new Map();
const MISS_TTL_MS = 5 * 60 * 1000;

export function resetLyricsCache() {
  cache.clear();
  inflight.clear();
  officialHits.clear();
  misses.clear();
  cachedMmxToken = { token: "", at: 0 };
}

export function lyricsMiss(trackId) {
  const at = misses.get(trackId);
  if (!at) return false;
  if (Date.now() - at >= MISS_TTL_MS) {
    misses.delete(trackId);
    return false;
  }
  return true;
}

export function markLyricsMiss(trackId) {
  if (!trackId) return;
  if (misses.size >= MAX_CACHE_ENTRIES) {
    const oldest = misses.keys().next().value;
    if (oldest !== undefined) misses.delete(oldest);
  }
  misses.set(trackId, Date.now());
}

export function clearLyricsMiss(trackId) {
  misses.delete(trackId);
}

export function officialLyricsHit(trackId) {
  const at = officialHits.get(trackId);
  if (!at) return false;
  if (Date.now() - at >= OFFICIAL_HIT_TTL_MS) {
    officialHits.delete(trackId);
    return false;
  }
  return true;
}

export function markOfficialLyricsHit(trackId) {
  if (!trackId) return;
  if (officialHits.size >= MAX_CACHE_ENTRIES) {
    const oldest = officialHits.keys().next().value;
    if (oldest !== undefined) officialHits.delete(oldest);
  }
  officialHits.set(trackId, Date.now());
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return { value: entry.value };
}

function cacheSet(key, value, options) {
  // 只缓存真正拿到的歌词；查不到 / 超时都不写，下一次请求立刻重试。
  if (!value || !options.cacheTtlMs) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + options.cacheTtlMs });
}

// `authoritative` tells the caller whether "no lyrics" is a real answer from at
// least one provider or just a network failure. Only the former may be recorded
// as a miss: a backgrounded client whose provider requests all failed would
// otherwise keep its lyrics card suppressed for the whole miss window.
async function runSources(sources, title, artist, duration, ctx, options) {
  if (!sources.length) return null;
  if (sources.length === 1) return lookupSource(sources[0], title, artist, duration, ctx, options);
  return await new Promise((resolve) => {
    let pending = sources.length;
    let settled = false;
    let fallback = null;
    for (const source of sources) {
      Promise.resolve()
        .then(() => lookupSource(source, title, artist, duration, ctx, options))
        .catch(() => null)
        .then((res) => {
          pending -= 1;
          if (settled) return;
          if (res && res.syncType === "LINE_SYNCED" && !res.pseudo) {
            settled = true;
            resolve(res);
            return;
          }
          if (res && (!fallback || (!fallback.pseudo && res.pseudo))) {
            if (!fallback || res.syncType === "LINE_SYNCED") fallback = res;
          }
          if (pending <= 0) {
            settled = true;
            resolve(fallback);
          }
        });
    }
  });
}

async function resolveLyrics(trackId, options) {
  const deadline = Date.now() + options.timeoutMs;
  const ctx = { deadline, answered: 0 };
  const meta = await lookupMetadata(trackId, ctx);
  if (!meta) return { lyrics: null, authoritative: false };

  const orderedSources =
    options.source === "auto" && /[\u3400-\u9fff]/.test(meta.title + meta.artist)
      ? ["netease", "qq", "lrclib", "musixmatch"]
      : options.sources;
  let lyrics = await runSources(orderedSources, meta.title, meta.artist, meta.duration, ctx, options);
  if (!lyrics && options.isrcLookup && (ctx.answered || 0) > 0 && ctx.deadline - Date.now() > 200) {
    const canonical = await lookupDeezer(meta.title, meta.artist, meta.duration, ctx, options.ignoreHanVariants !== false);
    if (canonical) {
      const tries = [];
      if (canonical.isrc) tries.push(lookupMusixmatchByIsrc(canonical.isrc, canonical.duration, ctx, options));
      tries.push(runSources(orderedSources, canonical.title, canonical.artist, canonical.duration, ctx, options));
      const found = await Promise.all(tries);
      lyrics = found.find((r) => r && r.syncType === "LINE_SYNCED" && !r.pseudo) || found.find(Boolean) || null;
    }
  }
  if (lyrics && "pseudo" in lyrics) delete lyrics.pseudo;
  return { lyrics, authoritative: (ctx.answered || 0) > 0 };
}

export async function findLyrics(trackId, options = lyricsOptions()) {
  if (!options || !options.enabled) return { lyrics: null, cache: "off" };
  const key = options.source + ":" + trackId;

  const cached = cacheGet(key);
  if (cached) return { lyrics: cached.value, cache: "hit" };
  if (inflight.has(key)) return inflight.get(key);

  const task = resolveLyrics(trackId, options).then((result) => {
    cacheSet(key, result.lyrics, options);
    return { lyrics: result.lyrics, cache: "miss", authoritative: result.authoritative };
  });
  const tracked = task.finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, tracked);
  return tracked;
}

// --------------------------------------------------------- official responses

function firstNonSpaceByte(bytes) {
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return byte;
  }
  return 0;
}

function jsonHasLyrics(text) {
  try {
    const data = JSON.parse(text);
    const lines = data && data.lyrics && data.lyrics.lines;
    return Array.isArray(lines) && lines.some((line) => line && String(line.words || "").trim());
  } catch (error) {
    return false;
  }
}

export function stripRestrictionJson(text) {
  try {
    const data = JSON.parse(text);
    const lyrics = data && data.lyrics;
    if (!lyrics || !Object.prototype.hasOwnProperty.call(lyrics, "restriction")) return null;
    delete lyrics.restriction;
    return JSON.stringify(data);
  } catch (error) {
    return null;
  }
}

// Returns { hasLyrics, body, json }. `body` is the cleaned replacement, or
// null when the original response can be passed through unchanged.
export function cleanOfficialLyrics(body, contentType, options = {}) {
  if (!body || !body.length) return { hasLyrics: false, body: null, json: false };

  const hans = options.hansLyrics !== false;
  const type = String(contentType || "").toLowerCase();
  const first = firstNonSpaceByte(body);
  const looksJson = type.indexOf("json") >= 0 || first === 0x7b;

  if (looksJson) {
    let text;
    try {
      text = TD.decode(body);
    } catch (error) {
      return { hasLyrics: false, body: null, json: true };
    }
    if (!jsonHasLyrics(text)) return { hasLyrics: false, body: null, json: true };
    try {
      const data = JSON.parse(text);
      const lyrics = data && data.lyrics;
      let changed = false;
      if (lyrics && Object.prototype.hasOwnProperty.call(lyrics, "restriction")) {
        delete lyrics.restriction;
        changed = true;
      }
      if (hans && hanVariants && lyrics && Array.isArray(lyrics.lines)) {
        const lang = String(lyrics.language || "");
        const sample = lyrics.lines.slice(0, 20).map((l) => (l && l.words) || "").join("");
        if (/^zh-(?:hant|tw|hk|mo)\b/i.test(lang) || hanVariants.isTraditional(sample)) {
          for (const line of lyrics.lines) {
            if (line && typeof line.words === "string") {
              const folded = hanVariants.fold(line.words);
              if (folded !== line.words) {
                line.words = folded;
                changed = true;
              }
            }
          }
          if (lyrics.language !== "zh-Hans") {
            lyrics.language = "zh-Hans";
            changed = true;
          }
        }
      }
      return { hasLyrics: true, body: changed ? TE.encode(JSON.stringify(data)) : null, json: true };
    } catch {
      const cleaned = stripRestrictionJson(text);
      return { hasLyrics: true, body: cleaned ? TE.encode(cleaned) : null, json: true };
    }
  }

  const count = protoLineCount(body);
  if (count <= 0) return { hasLyrics: false, body: null, json: false };
  return { hasLyrics: true, body: normalizeRestrictionProto(body, { hans }), json: false };
}

// Pick the format for synthesized lyrics. When the official response has a
// body, its own shape wins (JSON starts with "{", protobuf does not). Without a
// body the URL / Accept / User-Agent rules mirror the old on-device script:
// mobile defaults to protobuf, desktop to JSON.
export function detectLyricsFormat(input = {}) {
  const url = String(input.url || "");
  const accept = String(input.accept || "").toLowerCase();
  const contentType = String(input.upstreamContentType || "").toLowerCase();
  const desktop = Boolean(input.desktop);

  const explicitJson = /[?&]format=json/i.test(url);
  const explicitProto = /[?&]format=protobuf/i.test(url);

  if (input.body && input.body.length) {
    if (explicitProto) return "protobuf";
    return firstNonSpaceByte(input.body) === 0x7b ? "json" : "protobuf";
  }

  const wantsProto =
    explicitProto ||
    (!explicitJson &&
      desktop &&
      (contentType.indexOf("protobuf") >= 0 ||
        (!contentType && accept.indexOf("protobuf") >= 0)));

  if (wantsProto) return "protobuf";
  if (explicitJson) return "json";
  if (desktop) return "json";
  return "protobuf";
}

export function buildJsonPayload(lyrics, options = {}) {
  const desktop = Boolean(options.desktop);
  // JSON colours are 32-bit signed integers in the real response.
  const signed = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
  const payload = {
    syncType: lyrics.syncType,
    lines: lyrics.lines,
    provider: lyrics.provider,
    providerLyricsId: lyrics.providerId || "",
    providerDisplayName: lyrics.provider,
    syncLyricsUri: "",
    language: lyrics.language || "en",
  };

  if (!desktop) {
    payload.isDirty = false;
    payload.live = false;
    payload.colors = {
      background: signed(COLOR_BG),
      text: signed(COLOR_LINE),
      highlight: signed(COLOR_ACTIVE),
    };
    return { lyrics: payload };
  }

  // color-lyrics/v2 desktop JSON keeps colours at the top level and calls the
  // active colour highlightText. Putting them inside lyrics makes the page
  // transparent.
  payload.isDenseTypeface = false;
  payload.alternatives = [];
  payload.isRtlLanguage = false;
  payload.fullscreenAction = "FULLSCREEN_LYRICS";
  // The desktop client maps lyrics.previewLines directly (for the lyrics card);
  // a missing field throws and the whole page falls back to "couldn't load".
  payload.previewLines = previewFromLines(payload.lines);
  return {
    lyrics: payload,
    colors: {
      background: signed(COLOR_BG),
      text: signed(COLOR_LINE),
      highlightText: signed(COLOR_ACTIVE),
    },
    hasVocalRemoval: false,
  };
}

// ---------------------------------------------------------------- protobuf

// Response   { LyricsData data = 1; LyricsColors colors = 2; }
// LyricsData { bool timeSynchronized = 1; repeated LyricsLine lines = 2;
//              string providedBy = 5; LyricsRestriction restriction = 14; }
// LyricsLine { int32 offsetMs = 1; string content = 2; }
// LyricsColors { uint32 backgroundColor = 1; uint32 lineColor = 2;
//                uint32 activeLineColor = 3; }
function pbReadVarint(bytes, pos) {
  let value = 0n;
  let shift = 0n;
  while (pos < bytes.length) {
    const byte = bytes[pos];
    value |= BigInt(byte & 0x7f) << shift;
    pos += 1;
    if ((byte & 0x80) === 0) return { value, next: pos };
    shift += 7n;
    if (shift > 63n) break;
  }
  return { value: 0n, next: -1 };
}

function pbWriteVarint(value) {
  const out = [];
  let rest = BigInt(value);
  if (rest < 0n) rest = 0n;
  while (rest >= 128n) {
    out.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  out.push(Number(rest));
  return out;
}

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

function pbUint(field, value) {
  return pbConcat([pbWriteVarint(field * 8), pbWriteVarint(value)]);
}

function pbBytes(field, bytes) {
  return pbConcat([pbWriteVarint(field * 8 + 2), pbWriteVarint(bytes.length), bytes]);
}

function pbFields(bytes) {
  const out = [];
  let pos = 0;
  while (pos < bytes.length) {
    const start = pos;
    const key = pbReadVarint(bytes, pos);
    if (key.next < 0 || key.value < 8n || key.value > 0xffffffffn) throw new Error("protobuf key");
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (wire === 0) {
      const value = pbReadVarint(bytes, key.next);
      if (value.next < 0) throw new Error("protobuf varint");
      pos = value.next;
      out.push({ field, wire: 0, value: value.value, raw: bytes.subarray(start, pos) });
    } else if (wire === 2) {
      const length = pbReadVarint(bytes, key.next);
      if (length.next < 0 || length.value > BigInt(bytes.length - length.next)) throw new Error("protobuf length");
      const size = Number(length.value);
      pos = length.next + size;
      out.push({
        field,
        wire: 2,
        bytes: bytes.subarray(length.next, pos),
        raw: bytes.subarray(start, pos),
      });
    } else if (wire === 5) {
      if (key.next + 4 > bytes.length) throw new Error("protobuf fixed32");
      pos = key.next + 4;
      out.push({ field, wire: 5, bytes: bytes.subarray(key.next, pos), raw: bytes.subarray(start, pos) });
    } else if (wire === 1) {
      if (key.next + 8 > bytes.length) throw new Error("protobuf fixed64");
      pos = key.next + 8;
      out.push({ field, wire: 1, bytes: bytes.subarray(key.next, pos), raw: bytes.subarray(start, pos) });
    } else {
      throw new Error("protobuf wire");
    }
  }
  return out;
}

function pbEncodeField(field) {
  if (field.raw) return field.raw;
  if (field.wire === 0) return pbUint(field.field, field.value);
  if (field.wire === 2) return pbBytes(field.field, field.bytes);
  return pbConcat([pbWriteVarint(field.field * 8 + field.wire), field.bytes]);
}

export function protoLineCount(bytes) {
  if (!bytes || !bytes.length) return 0;
  try {
    for (const field of pbFields(bytes)) {
      if (field.field !== 1 || field.wire !== 2) continue;
      let count = 0;
      for (const inner of pbFields(field.bytes)) {
        if (inner.field === 2 && inner.wire === 2 && inner.bytes && inner.bytes.length) count += 1;
      }
      return count;
    }
  } catch (error) {
    return 0;
  }
  return 0;
}

// LyricsRestriction: 0 unrestricted / 1 showLyrics / 2 showLyricsMonthlyLimit /
// 3 monthlyLimitReached. Free accounts hit 3 after the monthly quota; the
// client then refuses to render even when lines are present. Set it back to 1.
export function normalizeRestrictionProto(bytes, options = {}) {
  let top;
  try {
    top = pbFields(bytes);
  } catch (error) {
    return null;
  }
  if (!top.length) return null;

  const hans = options.hans !== false && hanVariants;
  let changed = false;
  const outTop = [];
  for (const outer of top) {
    if (outer.field !== 1 || outer.wire !== 2) {
      outTop.push(pbEncodeField(outer));
      continue;
    }
    let innerFields;
    try {
      innerFields = pbFields(outer.bytes);
    } catch (error) {
      return null;
    }
    let isTrad = false;
    if (hans) {
      let lang = "";
      const sample = [];
      for (const f of innerFields) {
        if (f.field === 10 && f.wire === 2) {
          lang = TD.decode(f.bytes);
        } else if (f.field === 2 && f.wire === 2 && sample.length < 20) {
          try {
            const wf = pbFields(f.bytes).find((x) => x.field === 2 && x.wire === 2);
            if (wf) sample.push(TD.decode(wf.bytes));
          } catch {}
        }
      }
      isTrad = /^zh-(?:hant|tw|hk|mo)\b/i.test(lang) || hanVariants.isTraditional(sample.join(""));
    }

    const rewriteLineField = (lineBytes) => {
      try {
        const sub = pbFields(lineBytes);
        let subChanged = false;
        const parts = sub.map((sf) => {
          if (sf.field === 2 && sf.wire === 2) {
            const w = TD.decode(sf.bytes);
            const fw = hanVariants.fold(w);
            if (fw !== w) {
              subChanged = true;
              return pbBytes(2, TE.encode(fw));
            }
          }
          return pbEncodeField(sf);
        });
        return subChanged ? pbConcat(parts) : null;
      } catch {
        return null;
      }
    };

    const outInner = [];
    let found = false;
    let foundLang = false;
    for (const inner of innerFields) {
      if (inner.field === 14 && inner.wire === 0) {
        found = true;
        if (inner.value !== 1n) {
          outInner.push(pbUint(14, 1));
          changed = true;
          continue;
        }
      }
      if (isTrad && (inner.field === 2 || inner.field === 17) && inner.wire === 2) {
        const nextLine = rewriteLineField(inner.bytes);
        if (nextLine) {
          outInner.push(pbBytes(inner.field, nextLine));
          changed = true;
          continue;
        }
      }
      if (isTrad && inner.field === 10 && inner.wire === 2) {
        foundLang = true;
        if (TD.decode(inner.bytes) !== "zh-Hans") {
          outInner.push(pbBytes(10, TE.encode("zh-Hans")));
          changed = true;
          continue;
        }
      }
      outInner.push(pbEncodeField(inner));
    }
    if (isTrad && !foundLang) {
      outInner.push(pbBytes(10, TE.encode("zh-Hans")));
      changed = true;
    }
    if (!found && !changed) {
      outTop.push(pbEncodeField(outer));
      continue;
    }
    outTop.push(pbBytes(1, pbConcat(outInner)));
  }
  return changed ? pbConcat(outTop) : null;
}

function encodeLineProto(line) {
  const content = TE.encode(String(line.words || ""));
  return pbConcat([pbUint(1, Number(line.startTimeMs) || 0), pbBytes(2, content)]);
}

export function encodeLyricsProto(lyrics) {
  const parts = [pbUint(1, lyrics.syncType === "LINE_SYNCED" ? 1 : 0)];
  for (let i = 0; i < lyrics.lines.length; i += 1) {
    parts.push(pbBytes(2, encodeLineProto(lyrics.lines[i])));
  }
  const provider = lyrics.provider || "LRCLIB";
  parts.push(pbBytes(3, TE.encode(provider)));
  parts.push(pbBytes(4, TE.encode(String(lyrics.providerId || ""))));
  parts.push(pbBytes(5, TE.encode(provider)));
  const lang = String(lyrics.language || "");
  if (/^(?:zh|ja|ko)(?:-|$)/i.test(lang)) parts.push(pbUint(8, 1));
  if (lang) parts.push(pbBytes(10, TE.encode(lang)));
  parts.push(pbUint(14, 1));
  const preview = previewFromLines(lyrics.lines);
  for (let i = 0; i < preview.length; i += 1) {
    parts.push(pbBytes(17, encodeLineProto(preview[i])));
  }
  const data = pbConcat(parts);
  const colors = pbConcat([
    pbUint(1, COLOR_BG),
    pbUint(2, COLOR_LINE),
    pbUint(3, COLOR_ACTIVE),
  ]);
  return pbConcat([pbBytes(1, data), pbBytes(2, colors)]);
}
