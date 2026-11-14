// Spotify Mock — shared HTTP handler.
//
// This file is the Cloudflare Worker entry point and is also imported by the
// local Node server (src/node.js). It only uses Web-standard Request/Response
// and fetch, so the same code runs in Workers, Node 18+, Deno and Bun.
//
// The module rewrites a few spclient requests to this service:
//
//   /music/bootstrap
//   /music/user-customization-service...
//   /music/extended-metadata/...
//   /music/context-resolve/...
//   /music/connect-state/...
//   /music/metadata/4/track/...
//   /music/color-lyrics/v{N}/track/...
//
// Everything else is rejected. The service forwards the request to the real
// spclient host with the client's own Authorization / app headers, patches the
// protobuf response, and returns it. It is deliberately not a general proxy.
//
// color-lyrics is handled entirely here (see src/lyrics.js): the official
// response is passed through after removing the free-account restriction, or
// third-party lyrics are synthesized when Spotify has none. The client modules
// therefore contain no response scripts.
//
// The official request and the third-party lookup run in parallel; a 404 reuses
// the lookup result. LYRICS_PARALLEL=false restores the serial flow.

import { createPatcher } from "./patcher.js";
import {
  buildJsonPayload,
  cleanOfficialLyrics,
  detectLyricsFormat,
  encodeLyricsProto,
  clearLyricsMiss,
  findLyrics,
  lyricsInfo,
  lyricsMiss,
  lyricsOptions,
  markLyricsMiss,
  markOfficialLyricsHit,
  officialLyricsHit,
} from "./lyrics.js";

const SERVICE = "spotify-mock";
const VERSION = "1.1.3";
const UPSTREAM = "https://spclient.wg.spotify.com";
const MUSIC_PREFIX = "/music";
// 滚动页补卡前等待歌词查询的窗口：查到就补，确认没有就不补，超时乐观补卡。
const SCROLL_CARD_WAIT_MS = 8000;
// 查到歌词后再等一小会儿，让并行的 color-lyrics 响应先返回客户端。
const SCROLL_CARD_GRACE_MS = 200;

const ROUTES = [
  // Spotify versions the bootstrap endpoint (/bootstrap/v1/bootstrap,
  // /bootstrap/v3/bootstrap). Accept any version while still rejecting paths
  // that merely start with the same word.
  { kind: "bootstrap", test: (p) => p === "/bootstrap" || p.startsWith("/bootstrap/") },
  {
    kind: "customize",
    test: (p) => p === "/user-customization-service" || p.startsWith("/user-customization-service/"),
  },
  { kind: "metadata", stripEtags: true, test: (p) => p.startsWith("/extended-metadata/") },
  { kind: "metadata", test: (p) => p.startsWith("/context-resolve/") },
  { kind: "metadata", test: (p) => p.startsWith("/connect-state/") },
  { kind: "metadata", test: (p) => p.startsWith("/metadata/4/track/") },
  { kind: "lyrics", test: (p) => p.startsWith("/color-lyrics/") },
  // Sponsored content is injected into these feed responses, so removing the
  // account ad switches is not enough; the bodies need filtering too.
  { kind: "home", test: (p) => /^\/casita\/v\d+\/home(?:\/|$)/.test(p) },
  { kind: "browse", test: (p) => /^\/browsita\/v\d+\/browse(?:\/|$)/.test(p) },
  // The scroll path ends with the context URI, e.g. spotify:track:..., not
  // just "spotify". Matching only "/scroll/spotify" made the service answer
  // 404 and the client kept using its cached now-playing cards.
  { kind: "scroll", test: (p) => /^\/scrollsita\/v\d+\/scroll\//.test(p) },
  // 9.1.98+ re-fetches these configuration endpoints after bootstrap; patching
  // them with the same rules keeps the ad switches from being re-enabled.
  // Unauthenticated startup uses /remote-config-resolver/v3/unauth/configuration,
  // so match the whole service instead of only "/configuration".
  { kind: "configuration", test: (p) => /^\/remote-config-resolver\//.test(p) },
  { kind: "attributes", test: (p) => /^\/nebula\//.test(p) },
];

// Routes whose response body is a feed / config payload where a successful
// patch means an ad surface was actually hidden.
const AD_KINDS = new Set(["home", "browse", "scroll", "configuration", "attributes"]);

// Any other /music path is proxied untouched. The client modules rewrite whole
// service prefixes (casita / browsita / scrollsita / …), not just the handful
// of paths we patch, and returning 404 for the rest made Spotify fall back to
// stale cached responses (including old sponsored cards).
const PASSTHROUGH = { kind: "passthrough" };

const BINARY_TYPE = /(protobuf|octet-stream|application\/x-protobuf)/i;
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
];

const patcherCache = new Map();

function flag(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === "0" || text === "false" || text === "no" || text === "off") return false;
  return true;
}

// DESKTOP: auto | true | false. "auto" (the default) detects the client from
// its User-Agent, so one deployment can serve iPhone, iPad, Mac and Windows at
// the same time. true/false force a mode for unusual clients that hide their UA.
function desktopOverride(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || /^auto$/i.test(text)) return null;
  return flag(text, false);
}

function isDesktopRequest(request) {
  const ua = request && request.headers ? request.headers.get("user-agent") || "" : "";
  if (!ua) return false;
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
  return /Macintosh|Mac OS X|Darwin|Windows NT/i.test(ua);
}

function patchOptions(env, request) {
  const override = desktopOverride(env.DESKTOP);
  const desktop = override === null ? isDesktopRequest(request) : override;
  return {
    spoofPremium: flag(env.SPOOF_PREMIUM, true),
    blockAds: flag(env.BLOCK_ADS, true),
    // Desktop playback authorization makes Spotify think it has a Premium
    // audio key, then skip the track after a few seconds. Keep it off for
    // desktop by default; mobile keeps the old unlock behaviour. An explicit
    // UNLOCK_PLAYBACK=true still forces it on for every client.
    unlockPlayback: flag(env.UNLOCK_PLAYBACK, !desktop),
    desktop,
  };
}

function getPatcher(env, request, forceDesktop) {
  const options = patchOptions(env, request);
  if (forceDesktop !== undefined) options.desktop = forceDesktop;
  const key = JSON.stringify(options);
  let patcher = patcherCache.get(key);
  if (!patcher) {
    patcher = createPatcher(options);
    patcherCache.set(key, patcher);
  }
  return patcher;
}

function normalizePrefix(raw) {
  let value = String(raw || "").trim();
  if (!value || value === "/") return "";
  if (!value.startsWith("/")) value = "/" + value;
  return value.replace(/\/+$/, "");
}

function routeFor(path) {
  for (const route of ROUTES) {
    if (route.test(path)) return route;
  }
  return null;
}

// Only the current track's scroll list is patched. Spotify sends the track URI
// in the path; episode / show contexts do not get a lyrics card.
function scrollTrackId(path) {
  const match = /\/scrollsita\/v\d+\/scroll\/(?:spotify%3Atrack%3A|spotify:track:)([A-Za-z0-9]{22})/i.exec(path);
  return match ? match[1] : "";
}

function json(body, status = 200) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  return new Response(JSON.stringify(body, null, 2) + "\n", { status, headers });
}

function info(env) {
  const options = patchOptions(env);
  const desktop = desktopOverride(env.DESKTOP);
  const unlockRaw = env.UNLOCK_PLAYBACK;
  const unlockAuto = unlockRaw === undefined || unlockRaw === null || String(unlockRaw).trim() === "";
  return {
    ok: true,
    service: SERVICE,
    version: VERSION,
    upstream: UPSTREAM,
    endpoints: [
      "/music/bootstrap[/v{N}/bootstrap]",
      "/music/user-customization-service/v1/customize",
      "/music/extended-metadata/v0/extended-metadata",
      "/music/context-resolve/v1/context-resolve",
      "/music/connect-state/v1/...",
      "/music/metadata/4/track/...",
      "/music/color-lyrics/v2/track/...",
      "/music/casita/v{N}/home",
      "/music/browsita/v{N}/browse",
      "/music/scrollsita/v{N}/scroll/{uri}",
      "/music/remote-config-resolver/v{N}/...",
      "/music/nebula/v{N}/...",
      "/music/* (proxied unchanged)",
    ],
    options: {
      spoofPremium: options.spoofPremium,
      blockAds: options.blockAds,
      unlockPlayback: unlockAuto ? "auto" : options.unlockPlayback,
      desktop: desktop === null ? "auto" : desktop,
      lyrics: lyricsInfo(env),
    },
    prefix: normalizePrefix(env.MOCK_PREFIX) || null,
  };
}

function sanitizeRequestHeaders(input, stripValidators) {
  const headers = new Headers(input);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  for (const name of HOP_BY_HOP) headers.delete(name);
  if (stripValidators) {
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
  }
  // Ask the upstream for identity so the bytes we hand to the patcher are the
  // bytes we can forward. Cloudflare may still decompress for us; the response
  // headers are cleaned below either way.
  headers.set("accept-encoding", "identity");
  return headers;
}

function sanitizeResponseHeaders(input, patched) {
  const headers = new Headers(input);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("transfer-encoding");
  headers.delete("connection");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.delete("content-md5");
  headers.delete("digest");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-spotify-mock", patched ? "patched" : "passthrough");
  headers.set("x-spotify-mock-version", VERSION);
  return headers;
}

function patchResponse(patcher, desktopPatcher, route, targetPath, bytes, contentType, scrollCard) {
  if (!bytes.length) return null;
  // A JSON error / HTML login page must never be walked as a protobuf tree.
  if (contentType && !BINARY_TYPE.test(contentType)) return null;

  try {
    if (route.kind === "bootstrap") {
      const patched = patcher.patchBootstrap(bytes);
      if (patched) return patched;
      return desktopPatcher.patchBootstrapDesktop(bytes);
    }
    if (route.kind === "customize") {
      const patched = patcher.patchCustomize(bytes);
      if (patched) return patched;
      return desktopPatcher.patchCustomizeDesktop(bytes);
    }
    if (route.kind === "metadata") {
      return patcher.patchMeta(bytes, targetPath);
    }
    if (route.kind === "home") {
      return patcher.stripHomeAds(bytes);
    }
    if (route.kind === "browse") {
      return patcher.hideBrowseAds(bytes);
    }
    if (route.kind === "scroll") {
      return patcher.hideScrollAds(
        bytes,
        scrollCard ? scrollCard.trackId : "",
        scrollCard ? scrollCard.wantCard : false,
      );
    }
    if (route.kind === "configuration") {
      return patcher.patchConfigurationResponse(bytes);
    }
    if (route.kind === "attributes") {
      return patcher.patchAttributesResponse(bytes);
    }
  } catch (error) {
    console.warn(`${SERVICE}: patch failed for ${route.kind}:`, error && error.message);
  }
  return null;
}

// color-lyrics: keep the official body when it has lines (after dropping the
// free-account monthly-limit restriction), otherwise synthesize a response
// from a third-party provider. Returns null to pass the upstream response
// through untouched. lyricsLookup is the lookup started alongside the upstream
// fetch in handle(); reusing it avoids a second full provider round trip.
const LYRICS_PATH = /\/color-lyrics\/v\d+\/track\/([A-Za-z0-9]+)/;
const lyricsTrackId = (targetPath) => {
  const match = LYRICS_PATH.exec(targetPath);
  return match ? match[1] : null;
};

// 官方请求与第三方查询在 handle() 里同时发出；lyricsLookup 是那条已经开跑的
// Promise，官方 404 时直接复用它的结果（通常已经就绪），不必再等一整轮查询。
async function patchLyrics(env, request, targetPath, bytes, upstream, desktop, lyricsLookup) {
  const trackId = lyricsTrackId(targetPath);
  if (!trackId) return null;

  const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
  const status = upstream.status;
  const official = status >= 200 && status < 300 ? cleanOfficialLyrics(bytes, contentType) : null;

  if (official && official.hasLyrics) {
    markOfficialLyricsHit(trackId);
    clearLyricsMiss(trackId);
    if (!official.body) return { bytes: null, status, contentType: null, lyrics: "official" };
    return {
      bytes: official.body,
      status,
      contentType: official.json
        ? "application/json; charset=utf-8"
        : "application/x-protobuf",
      lyrics: "official",
    };
  }

  // A 200 with no body means "Spotify has lyrics but the body is unavailable";
  // never replace it with a third-party copy.
  if (status === 200 && !bytes.length) {
    return { bytes: null, status, contentType: null, lyrics: "official-empty" };
  }

  const options = lyricsOptions(env);
  const found = await (lyricsLookup || findLyrics(trackId, options));
  if (!found.lyrics) {
    // 卡片已经乐观补上了：确认没歌词后短期内不再补空卡。
    markLyricsMiss(trackId);
    return {
      bytes: null,
      status,
      contentType: null,
      lyrics: `none-${found.cache}`,
    };
  }
  clearLyricsMiss(trackId);
  const lyrics = found.lyrics;

  const format = detectLyricsFormat({
    url: request.url,
    accept: request.headers.get("accept") || "",
    upstreamContentType: contentType,
    body: bytes,
    desktop,
  });
  const info = `${String(lyrics.provider || "unknown").toLowerCase().replace(/\s+/g, "")}-${found.cache}`;
  if (format === "json") {
    return {
      bytes: new TextEncoder().encode(JSON.stringify(buildJsonPayload(lyrics, { desktop }))),
      status: 200,
      contentType: "application/json; charset=utf-8",
      lyrics: info,
    };
  }
  return {
    bytes: encodeLyricsProto(lyrics),
    status: 200,
    contentType: "application/x-protobuf",
    lyrics: info,
  };
}

async function handle(request, env = {}) {
  const url = new URL(request.url);
  const prefix = normalizePrefix(env.MOCK_PREFIX);

  let path = url.pathname;
  if (prefix) {
    if (path !== prefix && !path.startsWith(prefix + "/")) return json({ error: "not found" }, 404);
    path = path.slice(prefix.length) || "/";
  }

  if (path === "/" || path === "/health" || path === "/healthz") {
    return json(info(env));
  }

  if (path !== MUSIC_PREFIX && !path.startsWith(MUSIC_PREFIX + "/")) {
    return json({ error: "not found", service: SERVICE }, 404);
  }

  let targetPath = path.slice(MUSIC_PREFIX.length) || "/";
  // Compatibility with the first Loon rewrite: its regex consumed the slash
  // after "color-lyrics", so deployed plugins request /color-lyricsv2/... .
  // Accept that shape until the updated module is installed everywhere.
  if (targetPath.startsWith("/color-lyricsv")) {
    targetPath = targetPath.replace(/^\/color-lyrics(v\d+)/, "/color-lyrics/$1");
  }
  const route = routeFor(targetPath) || (targetPath === "/" ? null : PASSTHROUGH);
  if (!route) {
    return json(
      {
        error: "unsupported endpoint",
        service: SERVICE,
        hint: "request a path under /music; unknown /music paths are proxied unchanged",
      },
      404,
    );
  }
  const method = request.method.toUpperCase();
  if (method === "TRACE" || method === "CONNECT") {
    return json({ error: "method not allowed" }, 405);
  }

  const patcher = getPatcher(env, request);
  const options = patchOptions(env, request);
  const desktopPatcher = options.desktop ? patcher : getPatcher(env, request, true);
  const headers = sanitizeRequestHeaders(request.headers, true);
  let body;
  if (method !== "GET" && method !== "HEAD") {
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.length) {
      if (route.stripEtags) {
        const stripped = patcher.stripRequestEtags(raw);
        body = stripped || raw;
      } else {
        body = raw;
      }
      if (flag(env.MOCK_LOG_TRACKS, false) && targetPath.indexOf("/extended-metadata/") >= 0) {
        // Metadata requests carry the track URIs in the body. Logging them is
        // the quickest way to identify a track that crashes a client.
        const text = new TextDecoder("latin1").decode(raw);
        const ids = Array.from(new Set(text.match(/spotify:(?:track|episode):[A-Za-z0-9]+/g) || []));
        if (ids.length) console.log(`${SERVICE}: metadata ${ids.join(",")}`);
      }
    }
  }

  // color-lyrics：官方请求和第三方查询同时发出。官方 200 有歌词时用官方结果，
  // 404 时第三方结果往往已经就绪，总耗时接近两者中较慢的那个，而不是相加。
  // 官方曾命中过歌词的曲目跳过并行查询，避免每次打开歌词页都白跑一轮第三方源。
  let lyricsLookup = null;
  if (route.kind === "lyrics") {
    const trackId = lyricsTrackId(targetPath);
    const opts = lyricsOptions(env);
    if (trackId && opts.enabled && opts.parallel && !officialLyricsHit(trackId)) {
      lyricsLookup = findLyrics(trackId, opts).catch((error) => {
        console.warn(`${SERVICE}: parallel lyrics lookup failed:`, error && (error.message || error));
        return { lyrics: null, cache: "error" };
      });
    }
  }

  const target = UPSTREAM + targetPath + url.search;
  const upstream = await fetch(target, {
    method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  // 204 / 304 / HEAD responses have no body to patch. Return the status and
  // headers so the client can keep using its cache.
  if (method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
    return new Response(null, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: sanitizeResponseHeaders(upstream.headers, false),
    });
  }

  const original = new Uint8Array(await upstream.arrayBuffer());
  let bytes = original;
  let status = upstream.status;
  let patched = null;
  let contentTypeOut = null;
  let lyricsOut = null;

  if (route.kind === "lyrics") {
    const result = await patchLyrics(env, request, targetPath, original, upstream, options.desktop, lyricsLookup);
    if (result) {
      lyricsOut = result.lyrics || null;
      if (result.bytes) {
        bytes = result.bytes;
        status = result.status;
        contentTypeOut = result.contentType;
        patched = true;
      }
    }
  } else if (upstream.status >= 200 && upstream.status < 300) {
    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    // The scroll list needs its lyrics section in the first response; the client
    // will not insert a card later. A recently confirmed miss skips it.
    let scrollCard = null;
    if (route.kind === "scroll" && original.length) {
      const trackId = scrollTrackId(targetPath);
      const lyrics = lyricsOptions(env);
      if (trackId && lyrics.enabled && !patcher.hasLyricsCard(original) && !lyricsMiss(trackId)) {
        // 第一次渲染就要有这一格：先等查询给出结论，超时再乐观补卡。
        // 查询不取消，超时后仍会写缓存供 color-lyrics 复用。
        const lookup = findLyrics(trackId, lyrics).catch((error) => {
          console.warn(`${SERVICE}: scroll lyrics lookup failed:`, error && (error.message || error));
          return { lyrics: null };
        });
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve({ lyrics: null, timedOut: true }), SCROLL_CARD_WAIT_MS);
        });
        const result = await Promise.race([lookup, timeout]);
        clearTimeout(timer);
        // 歌词查到了也要等歌词响应先回到客户端：color-lyrics 是并行的另一个
        // 请求，scroll 先到会让列表按「没有歌词」渲染，卡片被丢掉。
        if (result.lyrics) await new Promise((resolve) => setTimeout(resolve, SCROLL_CARD_GRACE_MS));
        scrollCard = { trackId, wantCard: Boolean(result.lyrics) || Boolean(result.timedOut) };
      }
    }
    const result = patchResponse(patcher, desktopPatcher, route, targetPath, original, contentType, scrollCard);
    if (result && result.length) {
      bytes = result;
      patched = true;
    }
  }

  const headersOut = sanitizeResponseHeaders(upstream.headers, !!patched);
  headersOut.set("x-spotify-mock-desktop", options.desktop ? "1" : "0");
  if (AD_KINDS.has(route.kind)) headersOut.set("x-spotify-mock-ads", patched ? route.kind : "none");
  if (lyricsOut) headersOut.set("x-spotify-mock-lyrics", lyricsOut);
  if (contentTypeOut) {
    headersOut.set("content-type", contentTypeOut);
  } else if (patched && !headersOut.get("content-type")) {
    headersOut.set("content-type", "application/x-protobuf");
  }

  return new Response(bytes, {
    status,
    statusText: status === upstream.status ? upstream.statusText : "",
    headers: headersOut,
  });
}

export default {
  async fetch(request, env = {}) {
    try {
      return await handle(request, env);
    } catch (error) {
      console.error(`${SERVICE}: unhandled error:`, error && (error.stack || error.message || error));
      return json({ error: "upstream request failed", service: SERVICE }, 502);
    }
  },
};

export { handle, normalizePrefix, routeFor, info, patchOptions, VERSION };
