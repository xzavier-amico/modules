// Spotify Mock — server-side lyrics.
//
// The client modules only rewrite color-lyrics to this service. This file does
// the two jobs that used to run in the Spotify Premium client script:
//
//   * official 200 with lyrics: remove the free-account monthly-limit
//     restriction and pass the (possibly cleaned) body through;
//   * official 404 / empty: look the track up through open.spotify.com/oembed,
//     search third-party lyric providers, and synthesize the JSON or protobuf
//     response the client expects.
//
// All third-party traffic happens here, so iPhone / iPad / Mac clients do not
// need a response script at all.

const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";

const SOURCES = ["lrclib", "musixmatch", "netease", "qq"];
const AUTO_SOURCES = ["lrclib", "musixmatch", "netease", "qq"];

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CACHE_TTL = 21600;
const DEFAULT_NEGATIVE_CACHE_TTL = 600;
const MAX_CACHE_ENTRIES = 500;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 4000;

// Lyrics screen colours, ARGB. The client defaults to 0 (fully transparent),
// so synthesized responses must always include them.
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
  return {
    enabled: flag(env.LYRICS_ENABLED, true),
    source: sources.label,
    sources: sources.list,
    timeoutMs: numberIn(env.LYRICS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 30000),
    cacheTtlMs: numberIn(env.LYRICS_CACHE_TTL, DEFAULT_CACHE_TTL, 0, 604800) * 1000,
    negativeCacheTtlMs:
      numberIn(env.LYRICS_NEGATIVE_CACHE_TTL, DEFAULT_NEGATIVE_CACHE_TTL, 0, 86400) * 1000,
  };
}

export function lyricsInfo(env = {}) {
  const options = lyricsOptions(env);
  return {
    enabled: options.enabled,
    source: options.source,
    timeoutMs: options.timeoutMs,
    cacheTtl: Math.round(options.cacheTtlMs / 1000),
    negativeCacheTtl: Math.round(options.negativeCacheTtlMs / 1000),
  };
}

// ---------------------------------------------------------------- HTTP / JSON

async function getJson(target, ctx, extraHeaders) {
  const remaining = ctx.deadline - Date.now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const timeout = Math.min(remaining, REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeout);
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
    if (!response || response.status < 200 || response.status >= 300) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_JSON_BYTES) return null;
    const text = await response.text();
    // Third-party APIs are not trusted: never JSON.parse an unbounded response.
    if (!text || text.length > MAX_JSON_BYTES) return null;
    return JSON.parse(text);
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------- metadata

async function lookupMetadata(trackId, ctx) {
  const target =
    "https://open.spotify.com/oembed?url=" +
    encodeURIComponent("https://open.spotify.com/track/" + trackId);
  const meta = await getJson(target, ctx);
  if (!meta || !meta.title) return null;
  return {
    title: String(meta.title),
    artist: String(meta.author_name || "").split(",")[0].trim(),
  };
}

// --------------------------------------------------------------------- sources

async function lookupLrclib(title, artist, ctx) {
  const query =
    "track_name=" + encodeURIComponent(title) + (artist ? "&artist_name=" + encodeURIComponent(artist) : "");
  const record = await getJson("https://lrclib.net/api/get?" + query, ctx);

  let anchor = NaN;
  if (record && Number.isFinite(Number(record.duration))) anchor = Number(record.duration);
  if (record && isSynced(record)) return buildLyrics(withProvider(record, "LRCLIB"));

  const list = await getJson("https://lrclib.net/api/search?" + query, ctx);
  const picked = pickRecord(list, title, anchor);
  if (picked) return buildLyrics(withProvider(picked, "LRCLIB"));
  return record && hasAnyLyrics(record) ? buildLyrics(withProvider(record, "LRCLIB")) : null;
}

async function lookupNetease(title, artist, ctx) {
  const query = encodeURIComponent(title + (artist ? " " + artist : ""));
  const headers = { Referer: "https://music.163.com/" };
  const data = await getJson(
    "https://music.163.com/api/search/get?s=" + query + "&type=1&limit=5&offset=0",
    ctx,
    headers,
  );
  const songs = data && data.result && data.result.songs;
  const picked = pickSong(songs, title, (item) => item.name);
  if (!picked) return null;

  const lyric = await getJson(
    "https://music.163.com/api/song/lyric?id=" + picked.id + "&lv=-1&kv=-1&tv=-1",
    ctx,
    headers,
  );
  const text = lyric && lyric.lrc && lyric.lrc.lyric;
  if (!text) return null;
  return buildLyrics({ provider: "NetEase", providerId: String(picked.id), syncedLyrics: text });
}

async function lookupQq(title, artist, ctx) {
  const query = encodeURIComponent(title + (artist ? " " + artist : ""));
  const headers = { Referer: "https://y.qq.com/" };
  const data = await getJson(
    "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=" + query + "&format=json&n=5&p=1",
    ctx,
    headers,
  );
  const list = data && data.data && data.data.song && data.data.song.list;
  const picked = pickSong(list, title, (item) => item.songname);
  if (!picked) return null;

  const lyric = await getJson(
    "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" +
      picked.songmid +
      "&format=json&nobase64=1&g_tk=5381",
    ctx,
    headers,
  );
  const text = lyric && lyric.lyric;
  if (!text) return null;
  return buildLyrics({ provider: "QQ Music", providerId: String(picked.songmid), syncedLyrics: text });
}

// Musixmatch: exchange the public app id for an anonymous token, then ask the
// macro endpoint for line-synced subtitles (same approach as EeveeSpotify).
async function lookupMusixmatch(title, artist, ctx) {
  const APP_ID = "mac-ios-v2.0";
  const token = await getJson(
    "https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + APP_ID,
    ctx,
  );
  const userToken = token && token.message && token.message.body && token.message.body.user_token;
  if (!userToken) return null;

  const target =
    "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" +
    APP_ID +
    "&usertoken=" +
    userToken +
    "&q_track=" +
    encodeURIComponent(title) +
    (artist ? "&q_artist=" + encodeURIComponent(artist) : "") +
    "&user_language=zh";
  const data = await getJson(target, ctx);
  const calls = data && data.message && data.message.body && data.message.body.macro_calls;
  const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
  const list = sub && sub.body && sub.body.subtitle_list;
  const first = Array.isArray(list) ? list[0] : null;
  const body = first && first.subtitle && first.subtitle.subtitle_body;
  if (!body) return null;
  return buildLyrics({
    provider: "Musixmatch",
    providerId: String(first.subtitle.subtitle_id || ""),
    syncedLyrics: body,
  });
}

function lookupSource(name, title, artist, ctx) {
  if (name === "lrclib") return lookupLrclib(title, artist, ctx);
  if (name === "netease") return lookupNetease(title, artist, ctx);
  if (name === "qq") return lookupQq(title, artist, ctx);
  if (name === "musixmatch") return lookupMusixmatch(title, artist, ctx);
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

function pickSong(list, title, nameOf) {
  if (!Array.isArray(list) || !list.length) return null;
  const wanted = normalize(title);
  let fallback = null;
  for (const item of list) {
    if (!item) continue;
    if (!fallback) fallback = item;
    const name = normalize(nameOf(item));
    if (name === wanted || name.indexOf(wanted) === 0) return item;
  }
  return fallback;
}

// Same title often has several versions (original, video edit, extended mix).
// Prefer a close duration, then synced lyrics, then an exact title.
function pickRecord(list, title, duration) {
  if (!Array.isArray(list) || !list.length) return null;
  const wanted = normalize(title);
  const usable = list.filter((item) => {
    if (!item || typeof item !== "object" || item.instrumental) return false;
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

function buildLyrics(record) {
  if (!record || typeof record !== "object" || record.instrumental) return null;

  if (typeof record.syncedLyrics === "string") {
    const lines = parseLrc(record.syncedLyrics);
    if (lines.length) return makeLyrics("LINE_SYNCED", lines, record);
  }

  if (typeof record.plainLyrics === "string") {
    const lines = record.plainLyrics
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((words) => ({ startTimeMs: "0", words, syllables: [], endTimeMs: "0" }));
    if (lines.length) return makeLyrics("UNSYNCED", lines, record);
  }

  return null;
}

function makeLyrics(syncType, lines, record) {
  const provider = record.provider || "LRCLIB";
  const id = record.providerId !== undefined ? record.providerId : record.id;
  return {
    syncType,
    lines,
    provider,
    providerId: id === undefined || id === null ? "" : String(id),
    language: detectLanguage(lines),
  };
}

// ------------------------------------------------------------------ cache

const cache = new Map();
const inflight = new Map();

export function resetLyricsCache() {
  cache.clear();
  inflight.clear();
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
  const ttl = value ? options.cacheTtlMs : options.negativeCacheTtlMs;
  if (!ttl) return;
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + ttl });
}

async function resolveLyrics(trackId, options) {
  const deadline = Date.now() + options.timeoutMs;
  const ctx = { deadline };
  const meta = await lookupMetadata(trackId, ctx);
  if (!meta) return null;

  for (const source of options.sources) {
    if (Date.now() >= deadline) break;
    const lyrics = await lookupSource(source, meta.title, meta.artist, ctx);
    if (lyrics) return lyrics;
  }
  return null;
}

export async function findLyrics(trackId, options = lyricsOptions()) {
  if (!options || !options.enabled) return { lyrics: null, cache: "off" };
  const key = options.source + ":" + trackId;

  const cached = cacheGet(key);
  if (cached) return { lyrics: cached.value, cache: "hit" };
  if (inflight.has(key)) return inflight.get(key);

  const task = resolveLyrics(trackId, options).then((value) => {
    cacheSet(key, value, options);
    return { lyrics: value, cache: "miss" };
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
export function cleanOfficialLyrics(body, contentType) {
  if (!body || !body.length) return { hasLyrics: false, body: null, json: false };

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
    const cleaned = stripRestrictionJson(text);
    return { hasLyrics: true, body: cleaned ? TE.encode(cleaned) : null, json: true };
  }

  const count = protoLineCount(body);
  if (count <= 0) return { hasLyrics: false, body: null, json: false };
  return { hasLyrics: true, body: normalizeRestrictionProto(body), json: false };
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

function pbUint(field, value) {
  return pbWriteVarint(field * 8).concat(pbWriteVarint(value));
}

function pbBytes(field, bytes) {
  const head = pbWriteVarint(field * 8 + 2).concat(pbWriteVarint(bytes.length));
  const tail = [];
  for (let i = 0; i < bytes.length; i += 1) tail.push(bytes[i]);
  return head.concat(tail);
}

function pbConcat(list) {
  const out = [];
  for (const part of list) out.push.apply(out, part);
  return out;
}

function pbFields(bytes) {
  const out = [];
  let pos = 0;
  while (pos < bytes.length) {
    const key = pbReadVarint(bytes, pos);
    if (key.next < 0) break;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (wire === 0) {
      const value = pbReadVarint(bytes, key.next);
      if (value.next < 0) break;
      out.push({ field, wire: 0, value: value.value });
      pos = value.next;
    } else if (wire === 2) {
      const length = pbReadVarint(bytes, key.next);
      if (length.next < 0 || length.value > BigInt(bytes.length - length.next)) break;
      const size = Number(length.value);
      out.push({
        field,
        wire: 2,
        bytes: bytes.subarray(length.next, length.next + size),
      });
      pos = length.next + size;
    } else if (wire === 5) {
      out.push({ field, wire: 5, bytes: bytes.subarray(key.next, key.next + 4) });
      pos = key.next + 4;
    } else if (wire === 1) {
      out.push({ field, wire: 1, bytes: bytes.subarray(key.next, key.next + 8) });
      pos = key.next + 8;
    } else {
      break;
    }
  }
  return out;
}

function pbEncodeField(field) {
  if (field.wire === 0) return pbUint(field.field, field.value);
  if (field.wire === 2) return pbBytes(field.field, field.bytes);
  return pbWriteVarint(field.field * 8 + field.wire).concat(Array.from(field.bytes));
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
export function normalizeRestrictionProto(bytes) {
  let top;
  try {
    top = pbFields(bytes);
  } catch (error) {
    return null;
  }
  if (!top.length) return null;

  let changed = false;
  const outTop = [];
  for (const outer of top) {
    if (outer.field !== 1 || outer.wire !== 2) {
      outTop.push(pbEncodeField(outer));
      continue;
    }
    const outInner = [];
    let found = false;
    for (const inner of pbFields(outer.bytes)) {
      if (inner.field === 14 && inner.wire === 0) {
        found = true;
        if (inner.value !== 1n) {
          inner.value = 1n;
          changed = true;
        }
      }
      outInner.push(pbEncodeField(inner));
    }
    // No restriction field means the response is already unrestricted.
    if (!found) {
      outTop.push(pbEncodeField(outer));
      continue;
    }
    outTop.push(pbBytes(1, pbConcat(outInner)));
  }
  return changed ? new Uint8Array(pbConcat(outTop)) : null;
}

export function encodeLyricsProto(lyrics) {
  const lineOut = [];
  for (const line of lyrics.lines) {
    const content = TE.encode(String(line.words || ""));
    const body = pbUint(1, Number(line.startTimeMs) || 0).concat(pbBytes(2, content));
    lineOut.push.apply(lineOut, pbBytes(2, body));
  }
  const data = pbUint(1, lyrics.syncType === "LINE_SYNCED" ? 1 : 0)
    .concat(lineOut)
    .concat(pbBytes(5, TE.encode(lyrics.provider || "LRCLIB")))
    .concat(pbUint(14, 1));
  const colors = pbUint(1, COLOR_BG)
    .concat(pbUint(2, COLOR_LINE))
    .concat(pbUint(3, COLOR_ACTIVE));
  return new Uint8Array(pbBytes(1, data).concat(pbBytes(2, colors)));
}
