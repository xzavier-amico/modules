#!/usr/bin/env node
"use strict";

// 协议回归：离线样本，不访问外部接口，也不写客户端存储。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const concat = (...parts) => new Uint8Array(Buffer.concat(parts));
const pbContext = vm.createContext({ TextEncoder, TextDecoder, Uint8Array });
vm.runInContext(read("src/proto/wire.js") + read("src/spotify/core/protobuf.js") + "\nglobalThis.pb = { parse, serialize, fieldBytes, fieldString, fieldVarint, first, text };", pbContext);
const { parse, serialize, fieldBytes: b, fieldString: s, fieldVarint: v, first, text } = pbContext.pb;
let checks = 0;
function check(name, fn) { fn(); checks++; console.log("ok   " + name); }

// Egern 成品是 export default 的 ctx 脚本，这里按 ctx 调用；其余平台仍是兼容全局。
// 同一个脚本文件可能同时挂请求和响应，按响应处理（测试主要覆盖响应改写）。
const EGERN_PHASE = {};
for (const file of fs.readdirSync(path.join(ROOT, "egern"), { recursive: true })) {
  if (!String(file).endsWith(".yaml")) continue;
  const text = read(path.join("egern", file));
  for (const entry of text.split(/\n\s*-\s+(?=http_request:|http_response:)/)) {
    const kind = /^http_request:/.test(entry) ? "request" : /^http_response:/.test(entry) ? "response" : null;
    const url = /script_url:.*\/([\w.-]+\.js)/.exec(entry);
    if (!kind || !url) continue;
    EGERN_PHASE[url[1]] = EGERN_PHASE[url[1]] && EGERN_PHASE[url[1]] !== kind ? "response" : kind;
  }
}
const sameBytes = (a, b) => {
  if (typeof a === "string") a = new TextEncoder().encode(a);
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
function runEgern(file, body, url, argument, extra) {
  const phase = EGERN_PHASE[path.basename(file)] || "response";
  const response = extra.$response || {};
  const payload = response.body === undefined ? body : response.body;
  let bytes;
  if (payload !== undefined && payload !== null) {
    bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : new Uint8Array(payload.buffer ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) : payload);
  }

  const state = { done: false, value: undefined, error: null };
  const sandbox = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console: extra.console || console, state };
  for (const key of ["$loon", "$utils", "setTimeout", "clearTimeout"]) if (key in extra) sandbox[key] = extra[key];
  const context = vm.createContext(sandbox, { microtaskMode: "afterEvaluate" });

  // 测试是同步的：用 vm 自己的 Promise，microtaskMode 才能在 runInContext 返回前排空。
  const P = vm.runInContext("Promise", context);
  const http = extra.$httpClient;
  const callMock = (fn, target, options = {}) => {
    let outcome;
    fn({ url: target, headers: options.headers || {}, body: options.body }, (error, res, data) => {
      outcome = error
        ? { error }
        : { value: { status: res && res.status !== undefined ? res.status : 200, headers: (res && res.headers) || {}, text: () => P.resolve(data) } };
    });
    if (!outcome) throw new Error("http mock must call back synchronously");
    return outcome.error ? P.reject(outcome.error) : P.resolve(outcome.value);
  };
  const store = extra.$persistentStore;
  const ctx = {
    env: argument || {},
    request: {
      url: (extra.$request && extra.$request.url) || url,
      method: "POST",
      headers: (extra.$request && extra.$request.headers) || {},
      body: phase === "request" && bytes ? { arrayBuffer: () => P.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) } : undefined,
    },
    response:
      phase === "response" && bytes
        ? {
            status: response.status === undefined ? 200 : response.status,
            headers: response.headers || {},
            body: {},
            arrayBuffer: () => P.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
          }
        : undefined,
    storage: {
      get: (key) => (store ? store.read(key) : null),
      set: (key, value) => {
        if (store) store.write(value, key);
      },
    },
    http: http ? { get: (target, options) => callMock(http.get, target, options), post: (target, options) => callMock(http.post, target, options) } : { get: () => P.reject(new Error("no http mock")), post: () => P.reject(new Error("no http mock")) },
    respond: (value) => value,
  };
  sandbox.ctx = ctx;

  const code = read(file).replace(/^export default async function \(ctx\) \{/m, "globalThis.__entry = async function (ctx) {");
  vm.runInContext(code + "\n__entry(ctx).then((value) => { state.value = value; state.done = true; }, (error) => { state.error = String((error && error.stack) || error); state.done = true; });", context, { timeout: 10000 });
  assert.equal(state.done, true, file + " must finish once: " + (state.error || ""));
  const out = state.value;
  // 适配层会显式带回 body；内容没变时按「放行」处理，和兼容模式的 {} 等价。
  if (out && Object.keys(out).length === 1 && out.body !== undefined && bytes && sameBytes(out.body, bytes)) return {};
  return out;
}
async function runEgernAsync(file, body, url, argument) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body);
  const sandbox = { TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console };
  const context = vm.createContext(sandbox);
  const P = vm.runInContext("Promise", context);
  sandbox.ctx = {
    env: argument || {},
    request: { url, method: "POST", headers: {} },
    response: { status: 200, headers: {}, body: {}, arrayBuffer: () => P.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) },
    storage: { get: () => null, set: () => {} },
    http: { get: () => P.reject(new Error("no http mock")), post: () => P.reject(new Error("no http mock")) },
    respond: (value) => value,
  };
  const code = read(file).replace(/^export default async function \(ctx\) \{/m, "globalThis.__entry = async function (ctx) {");
  vm.runInContext(code + "\nglobalThis.__promise = __entry(ctx);", context, { timeout: 10000 });
  const out = await sandbox.__promise;
  if (out && Object.keys(out).length === 1 && out.body !== undefined && sameBytes(out.body, bytes)) return {};
  return out;
}
function run(file, body, url, argument = {}, extra = {}) {
  if (file.startsWith("egern/")) return runEgern(file, body, url, argument, extra);
  const calls = [];
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console,
    $request: { url }, $response: { status: 200, body }, $argument: argument,
    $done: (value) => calls.push(value), ...extra });
  vm.runInContext(read(file), context, { timeout: 10000 });
  assert.equal(calls.length, 1, file + " must finish once");
  return calls[0];
}
const track = "spotify:track:0VjIjW4GlUZAMYd2vXMi3b";
const scroll = "https://spclient.wg.spotify.com/scrollsita/v1/scroll/" + encodeURIComponent(track);
// feed 脚本补歌词卡前会先等歌词写进缓存；离线测试直接给一份已命中的缓存。
function lyricsStore(id, source = "auto") {
  const map = {
    "spotify.lyrics.cache": JSON.stringify({
      [source + "|" + id]: {
        t: Date.now(), m: 0, s: "LINE_SYNCED", p: "LRCLIB", i: "", l: "en",
        c: [-16777216, -1, -1], a: [[0, "line"]],
      },
    }),
  };
  return {
    read: (key) => (key in map ? map[key] : null),
    write: (value, key) => { map[key] = value; return true; },
  };
}
for (const platform of ["loon", "egern", "shadowrocket"]) {
  const feed = platform + "/spotify/js/spotify.feed.js";
  const originalList = serialize([b(1, serialize([s(2, "normal-card")])), v(99, 9007199254740999n)]);
  const body = serialize([b(1, originalList), v(8, 123n)]);
  check(platform + " scroll: drops sponsored sections and adds the lyrics section once", () => {
    const lyrics = serialize([b(5, serialize([s(1, track)])), b(23, serialize([s(1, "spotify:section:donor")]))]);
    const ad = serialize([b(23, serialize([s(1, "spotify:section:ad")])), b(30, new Uint8Array([1, 2, 3]))]);
    const official = serialize([b(1, concat(serialize([b(1, lyrics)]), originalList)), v(8, 123n)]);
    const withAd = serialize([b(1, concat(serialize([b(1, ad)]), originalList)), v(8, 123n)]);
    const sectionList = (out) => parse(first(parse(out.body), 1).p).filter((f) => f.no === 1);

    for (const mode of ["full", "no_card", "card_only", undefined]) {
      for (const ads of [true, false]) {
        const args = { block_ads: ads, enable_lyrics: true, lyrics_mode: mode };
        const wantCard = mode === undefined || mode === "full" || mode === "card_only";
        const store = lyricsStore("0VjIjW4GlUZAMYd2vXMi3b");

        assert.equal(Object.keys(run(feed, official, scroll, args)).length, 0, "an existing lyrics section must not be duplicated");

        const plain = run(feed, body, scroll, args, { $persistentStore: store });
        assert.equal(!!plain.body, wantCard);
        if (wantCard) {
          const sections = sectionList(plain);
          assert.equal(sections.length, parse(originalList).filter((f) => f.no === 1).length + 1);
          const added = parse(sections[0].p);
          assert.equal(text(first(parse(first(added, 5).p), 1)), track);
          assert.ok(first(parse(first(added, 23).p), 1), "a synthesized section needs its section id");
        }

        const filtered = run(feed, withAd, scroll, args, { $persistentStore: store });
        if (!ads) assert.equal(!!filtered.body, wantCard);
        else {
          const sections = sectionList(filtered);
          assert.ok(sections.every((section) => !first(parse(section.p), 30)), "sponsored section must be removed, not emptied");
          assert.equal(sections.length, wantCard ? 2 : 1);
          assert.equal(first(parse(filtered.body), 8).v, 123n);
        }
      }
    }

    assert.equal(Object.keys(run(feed, body, scroll, { block_ads: false, enable_lyrics: false })).length, 0);
    assert.equal(Object.keys(run(feed, body, scroll.replace("track", "episode"), { block_ads: false })).length, 0);
    assert.equal(Object.keys(run(feed, new Uint8Array([10, 127]), scroll)).length, 0);
  });

  check(platform + " event card responses are left untouched", () => {
    const eventUrl = "https://guc3-spclient.spotify.com/spotify.liveeventdistribution.v1.EventCardInfoService/EventCardInfo";
    for (const status of [200, 503]) {
      const out = run(feed, "upstream error", eventUrl, { block_ads: true, enable_lyrics: true }, {
        $request: { url: eventUrl }, $response: { url: eventUrl, status, body: "upstream error" },
      });
      assert.equal(Object.keys(out).length, 0, "the feed script must not replace EventCardInfo responses");
    }
  });

  const hls = platform + "/pluto/js/pluto_hls.js";
  const vodUrl = "https://service.pluto.tv/stitch/hls/movie/id/master.m3u8";
  const header = "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-TARGETDURATION:5\n";
  let id = 0;
  const segments = (clip, count) => Array.from({ length: count }, () => "#EXTINF:5,\nhttps://cdn.plutotv.net/clip/" + clip + "/" + id++ + ".ts\n").join("");
  check(platform + " Pluto repeated 30s ads exceed 60s total", () => {
    let playlist = header;
    for (let i = 0; i < 4; i++) playlist += segments("film", 60) + segments("opaque-commercial", 6);
    playlist += segments("film", 60) + "#EXT-X-ENDLIST\n";
    const out = run(hls, playlist, vodUrl).body;
    assert.ok(out && !out.includes("opaque-commercial"));
    assert.equal((out.match(/#EXTINF/g) || []).length, 300);
  });
  check(platform + " Pluto rolling VOD: ad majority, KEY/MAP restoration, original IV", () => {
    const playlist = header.replace("#EXT-X-PLAYLIST-TYPE:VOD\n", "") +
      '#EXT-X-MAP:URI="film.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="film.key"\n' + segments("film", 2) +
      '#EXT-X-KEY:METHOD=NONE\n#EXT-X-MAP:URI="ad.mp4"\n' + segments("commercial_ad", 24) +
      '#EXT-X-MAP:URI="film.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="film.key"\n' + segments("film", 1);
    const out = run(hls, playlist, vodUrl).body;
    assert.ok(out && !out.includes("commercial_ad") && !out.includes("ad.mp4"));
    assert.equal((out.match(/#EXTINF/g) || []).length, 3);
    assert.ok(out.includes("IV=0x" + (126).toString(16).padStart(32, "0")));
    assert.ok(out.includes("#EXT-X-DISCONTINUITY\n"));
    assert.equal(Object.keys(run(hls, playlist, vodUrl.replace("/movie/", "/channel/"))).length, 0);
  });
  check(platform + " Pluto inherited state on removed segment and explicit byte ranges", () => {
    const playlist = header + segments("film", 1) + '#EXT-X-KEY:METHOD=AES-128,URI="new.key",IV=0x12\n#EXT-X-MAP:URI="new.mp4"\n#EXT-X-BYTERANGE:10@0\n' + segments("spot_ad", 1) + '#EXT-X-BYTERANGE:10@10\n' + segments("film", 1) + "#EXT-X-ENDLIST\n";
    const out = run(hls, playlist, vodUrl).body;
    assert.ok(out.includes('URI="new.key"') && out.includes('URI="new.mp4"'));
    assert.ok(out.includes("#EXT-X-BYTERANGE:10@10"));
    assert.ok(!out.includes("spot_ad"));
  });
  check(platform + " Pluto preserves long secondary content and master playlists", () => {
    const playlist = header + segments("film", 100) + segments("part-two", 20) + segments("spot_ad", 6) + "#EXT-X-ENDLIST\n";
    const out = run(hls, playlist, vodUrl).body;
    assert.ok(out.includes("part-two") && !out.includes("spot_ad"));
    assert.equal(Object.keys(run(hls, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8\n", vodUrl)).length, 0);
  });
  check(platform + " Pluto web manifests obey the web switch", () => {
    const playlist = header + segments("film", 6) + segments("spot_ad", 2) + "#EXT-X-ENDLIST\n";
    const webUrl = vodUrl + "?appName=web&deviceType=web";
    const on = run(hls, playlist, webUrl, { block_ads: true, web: true });
    assert.ok(on.body && !on.body.includes("spot_ad"));
    assert.equal(Object.keys(run(hls, playlist, webUrl, { block_ads: true, web: false })).length, 0,
      "web=false must leave web manifests untouched");
    const appUrl = vodUrl + "?appName=android&deviceType=phone";
    const app = run(hls, playlist, appUrl, { block_ads: true, web: false });
    assert.ok(app.body && !app.body.includes("spot_ad"),
      "web=false must still filter the app manifests");
  });
  check(platform + " Tubi combined traversal: nested ad arrays, captions and metrics", () => {
    const data = { ads: [1], items: [{ monetization: { cue_points: [30, 60] }, subtitles: [{ url: "https://cdn.adrise.tv/en.srt", lang: "English" }] }] };
    const out = JSON.parse(run(platform + "/tubi/js/tubi_adfree.js", JSON.stringify(data), "https://api.tubitv.com/api/v2/mobile/contents", { caption_lang: "zh-Hans" }).body);
    assert.equal(out.ads.length, 0);
    assert.equal(out.items[0].monetization.cue_points.length, 0);
    assert.equal(out.items[0].subtitles.length, 2);
    assert.ok(out.items[0].subtitles[1].url.includes("tlang=zh-Hans"));
    assert.equal(out.metrics.responseTime, 1);
  });
  check(platform + " Tubi web metadata obeys the web switch", () => {
    const data = {
      monetization: { cue_points: [30, 60] },
      subtitles: [{ url: "https://cdn.adrise.tv/en.srt", lang: "English" }],
    };
    const file = platform + "/tubi/js/tubi_adfree.js";
    const webUrl = "https://tubitv.com/oz/videos/123/content";
    const args = { block_ads: true, caption_lang: "zh-Hans", web: true };
    const on = JSON.parse(run(file, JSON.stringify(data), webUrl, args).body);
    assert.equal(on.monetization.cue_points.length, 0);
    assert.equal(on.subtitles.length, 2);
    assert.equal(Object.keys(run(file, JSON.stringify(data), webUrl, { ...args, web: false })).length, 0,
      "web=false must leave the web content metadata untouched");
    const app = JSON.parse(run(file, JSON.stringify({ "123": data }), "https://api.tubitv.com/api/v2/mobile/contents", { ...args, web: false }).body);
    assert.equal(app["123"].monetization.cue_points.length, 0);
    assert.equal(app["123"].subtitles.length, 2, "web=false must still patch the app API");
  });
}

check("Spotify client plugins route scrollsita to the updated ad filter", () => {
  for (const file of ["loon/spotify/spotify-premium.plugin", "loon/spotify/spotify-premium-mac.plugin", "egern/spotify/spotify-premium.yaml", "shadowrocket/spotify/spotify-premium.sgmodule"]) {
    const rules = read(file).split("\n").filter((line) => !line.trim().startsWith("#"));
    assert.ok(rules.some((line) => line.includes("scrollsita")), file + " must match scrollsita");
    assert.ok(rules.some((line) => line.includes("spotify.feed.js?v=20261114-11")));
  }
});

check("Spotify modules route domestic lyrics sources directly", () => {
  for (const file of ["loon/spotify/spotify-premium.plugin", "loon/spotify/spotify-premium-mac.plugin", "shadowrocket/spotify/spotify-premium.sgmodule"]) {
    const text = read(file);
    assert.ok(text.includes("DOMAIN,music.163.com,DIRECT"), file + " must route NetEase directly");
    assert.ok(text.includes("DOMAIN,c.y.qq.com,DIRECT"), file + " must route QQ Music directly");
  }
  const egern = read("egern/spotify/spotify-premium.yaml");
  assert.match(egern, /match: "music\.163\.com"\s*\n\s*policy: DIRECT/);
  assert.match(egern, /match: "c\.y\.qq\.com"\s*\n\s*policy: DIRECT/);
});

check("Shadowrocket Spotify feed argument JSON exposes prefetch", () => {
  const line = read("shadowrocket/spotify/spotify-premium.sgmodule").split("\n")
    .find((item) => item.startsWith("spotify.feed ="));
  assert.ok(line, "spotify.feed entry");
  const raw = /argument="(.*)"$/.exec(line)[1].replace(/\{\{\{[^}]*\}\}\}/g, "true");
  assert.equal(JSON.parse(raw).prefetch, true);
});

check("Egern lyrics script declares body_required", () => {
  // 不开 body_required 时 Egern 既不把 body 交给脚本，也不接受脚本返回的 body，
  // 补出来的歌词会被丢掉。
  const yaml = read("egern/spotify/spotify-premium.yaml");
  const entries = yaml.split(/\n\s*-\s+(?=http_request:|http_response:)/).filter((entry) => entry.includes("color-lyrics"));
  const response = entries.find((entry) => /^http_response:/.test(entry) && entry.includes("spotify_lyrics.js"));
  assert.ok(response, "lyrics response entry must exist");
  assert.ok(/body_required:\s*true/.test(response), "lyrics response entry must set body_required");
});

check("Spotify client plugins short-circuit cached lyrics at request phase", () => {
  // 请求阶段命中缓存时直接返回歌词，跳过可能很慢的官方 color-lyrics 请求。
  for (const file of ["loon/spotify/spotify-premium.plugin", "loon/spotify/spotify-premium-mac.plugin", "shadowrocket/spotify/spotify-premium.sgmodule"]) {
    const rules = read(file).split("\n").filter((line) => line.includes("spotify_lyrics.js"));
    assert.equal(rules.length, 2, file + " must have request and response lyrics entries");
    assert.equal(rules.filter((line) => /tag="spotify(?:\.mac)?\.lyrics\.req"/.test(line) || line.startsWith("spotify.lyrics.req =")).length, 1, file);
  }
  const entries = read("egern/spotify/spotify-premium.yaml").split(/\n\s*-\s+(?=http_request:|http_response:)/)
    .filter((entry) => entry.includes("color-lyrics") && entry.includes("spotify_lyrics.js"));
  assert.equal(entries.filter((entry) => /^http_request:/.test(entry)).length, 1, "egern request entry");
  assert.equal(entries.filter((entry) => /^http_response:/.test(entry)).length, 1, "egern response entry");
});

check("Spotify request phase returns cached lyrics without hitting providers", () => {
  const id = "0VjIjW4GlUZAMYd2vXMi3b";
  const url = "https://spclient.wg.spotify.com/color-lyrics/v2/track/" + id + "?format=json";
  for (const platform of ["loon", "shadowrocket"]) {
    const out = run(platform + "/spotify/js/spotify_lyrics.js", "", url, ["auto", true], {
      $response: undefined,
      $persistentStore: lyricsStore(id),
      $httpClient: { get: () => assert.fail(platform + " cache hit must not query providers") },
    });
    assert.equal(out.response.status, 200, platform);
    const payload = JSON.parse(out.response.body);
    assert.equal(payload.lyrics.lines[0].words, "line", platform);
    assert.equal(payload.lyrics.provider, "LRCLIB", platform);
  }
});

check("Spotify request phase passes through when the cache is empty", () => {
  const url = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json";
  for (const platform of ["loon", "shadowrocket"]) {
    const out = run(platform + "/spotify/js/spotify_lyrics.js", "", url, ["auto", true], {
      $response: undefined,
      $persistentStore: { read: () => null, write: () => true },
      $httpClient: { get: () => assert.fail(platform + " cache miss must let the official request through") },
    });
    assert.equal(Object.keys(out).length, 0, platform);
  }
});

check("Spotify feed scripts get a 30s timeout", () => {
  // scrollsita 响应可以到 12MB，10 秒偶尔不够，超时会放行原始响应、歌词卡片不出现。
  const egern = read("egern/spotify/spotify-premium.yaml").split(/\n\s*-\s+(?=http_request:|http_response:)/)
    .find((entry) => entry.includes('name: "spotify.feed"'));
  assert.ok(/timeout:\s*30/.test(egern), "egern feed timeout");
  for (const file of ["loon/spotify/spotify-premium.plugin", "loon/spotify/spotify-premium-mac.plugin"]) {
    const line = read(file).split("\n").find((item) => /tag="spotify(?:\.mac)?\.feed"/.test(item));
    assert.ok(/timeout=30/.test(line), file + " feed timeout");
  }
  const sr = read("shadowrocket/spotify/spotify-premium.sgmodule").split("\n").find((line) => line.startsWith("spotify.feed ="));
  assert.ok(/timeout=30/.test(sr), "shadowrocket feed timeout");
});

check("Spotify official protobuf preserves opaque 64-bit and fixed-width fields", () => {
  const unknown = concat(serialize([v(90, 18446744073709551615n)]), new Uint8Array([0xed, 5, 1, 2, 3, 4]));
  const lyrics = concat(serialize([v(1, 1), b(2, serialize([v(1, 1000), s(2, "hello")])), v(14, 3)]), unknown);
  const body = serialize([b(1, lyrics), b(7, unknown)]);
  const out = run("loon/spotify/js/spotify_lyrics.js", body, "https://spclient.wg.spotify.com/color-lyrics/v2/track/id").body;
  const top = parse(out);
  assert.equal(first(parse(first(top, 1).p), 14).v, 1n);
  assert.deepEqual(first(top, 7).p, unknown);
  assert.deepEqual(first(top, 1).p.subarray(first(top, 1).p.length - unknown.length), unknown);
  assert.equal(Object.keys(run("loon/spotify/js/spotify_lyrics.js", new Uint8Array([10, 127]), "https://spclient.wg.spotify.com/color-lyrics/v2/track/id")).length, 0);
});

check("Spotify context metadata patches current track without losing opaque fields", () => {
  const entry = (key, value) => b(3, serialize([s(1, key), s(2, value)]));
  const context = serialize([s(1, track), s(2, "uid"), entry("track_title", "Song"), v(90, 18446744073709551615n)]);
  const file = "loon/spotify/js/spotify.js";
  const url = "https://spclient.wg.spotify.com/connect-state/v1/player";
  const result = run(file, context, url);
  const fields = parse(result.body);
  assert.equal(first(fields, 90).v, 18446744073709551615n);
  const entries = fields.filter((f) => f.no === 3).map((f) => parse(f.p));
  assert.ok(entries.some((f) => text(first(f, 1)) === "has_lyrics" && text(first(f, 2)) === "true"));
  assert.equal(Object.keys(run(file, result.body, url)).length, 0);
  const nonCanonical = concat(new Uint8Array([0xd0, 5, 0x81, 0]), context);
  assert.equal(Object.keys(run(file, nonCanonical, url)).length, 0);
});

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify caches the client's own track metadata for the lyrics script", () => {
    const map = {};
    const store = { read: (key) => (key in map ? map[key] : null), write: (value, key) => { map[key] = value; return true; } };
    const context = serialize([
      s(1, track), s(2, "uid"),
      b(3, serialize([s(1, "track_title"), s(2, "晚秋")])),
      b(3, serialize([s(1, "artist_name"), s(2, "毛宁")])),
      b(3, serialize([s(1, "duration"), s(2, "212000")])),
    ]);
    const url = "https://spclient.wg.spotify.com/connect-state/v1/player";
    run(platform + "/spotify/js/spotify.js", context, url, {}, { $persistentStore: store });
    const cached = JSON.parse(map["spotify.track.meta"])["0VjIjW4GlUZAMYd2vXMi3b"];
    assert.deepEqual(cached.slice(0, 3), ["晚秋", "毛宁", 212000]);

    // 同一条元数据重复到达时不重写存储。
    const before = map["spotify.track.meta"];
    run(platform + "/spotify/js/spotify.js", context, url, {}, { $persistentStore: store });
    assert.equal(map["spotify.track.meta"], before);

    // 歌词脚本命中缓存后不再访问 open.spotify.com（oEmbed 与 embed 都不请求）。
    const requests = [];
    const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/0VjIjW4GlUZAMYd2vXMi3b?format=json", ["lrclib", true], {
      $response: { status: 404, body: "" },
      $persistentStore: store,
      $httpClient: { get: (request, callback) => {
        requests.push(request.url);
        callback(null, { status: 200 }, JSON.stringify({ trackName: "晚秋", artistName: "毛宁", syncedLyrics: "[00:01.00]缓存歌词" }));
      } },
    });
    assert.ok(!requests.some((target) => target.includes("open.spotify.com")), "a cache hit must not call open.spotify.com");
    assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "缓存歌词");
  });

  check(platform + " Spotify caches metadata/4/track entities by id", () => {
    const map = {};
    const store = { read: (key) => (key in map ? map[key] : null), write: (value, key) => { map[key] = value; return true; } };
    const entity = serialize([
      b(1, new Uint8Array(16).fill(0xab)),
      s(2, "抽离"),
      b(4, serialize([s(2, "徐良")])),
      b(4, serialize([s(2, "吴琼")])),
      v(7, 210000n),
    ]);
    run(platform + "/spotify/js/spotify.js", entity,
      "https://spclient.wg.spotify.com/metadata/4/track/0VjIjW4GlUZAMYd2vXMi3b?market=from_token", {}, { $persistentStore: store });
    const cached = JSON.parse(map["spotify.track.meta"])["0VjIjW4GlUZAMYd2vXMi3b"];
    assert.deepEqual(cached.slice(0, 3), ["抽离", "徐良, 吴琼", 210000]);
  });
}

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify caches resolved lyrics and does not cache misses", () => {
    const file = platform + "/spotify/js/spotify_lyrics.js";
    const map = {};
    const store = { read: (key) => (key in map ? map[key] : null), write: (value, key) => { map[key] = value; return true; } };
    const url = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json";
    let calls = 0;
    const http = {
      get: (request, callback) => {
        calls += 1;
        callback(null, { status: 200 }, JSON.stringify(
          request.url.includes("oembed")
            ? { title: "Song", author_name: "Artist" }
            : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Cached lyric" },
        ));
      },
    };

    const first = run(file, "", url, ["lrclib", true], { $response: { status: 404, body: "" }, $persistentStore: store, $httpClient: http });
    assert.equal(JSON.parse(first.body).lyrics.lines[0].words, "Cached lyric", platform);
    assert.ok(calls > 0);
    const afterFirst = calls;
    assert.ok(map["spotify.lyrics.cache"], platform + " must persist the resolved lyrics");

    const second = run(file, "", url, ["lrclib", true], {
      $response: { status: 404, body: "" },
      $persistentStore: store,
      $httpClient: { get: () => assert.fail("a lyrics cache hit must not call any provider") },
    });
    assert.equal(JSON.parse(second.body).lyrics.lines[0].words, "Cached lyric", platform);
    assert.equal(calls, afterFirst, platform + " must not make extra requests on a cache hit");

    // 换歌词源（auto ↔ lrclib）后缓存 key 的前缀会变；仍按曲目 id 复用，避免重查。
    const crossSource = run(file, "", url, ["auto", true], {
      $response: { status: 404, body: "" },
      $persistentStore: store,
      $httpClient: { get: () => assert.fail("a cached track must be reused across lyrics sources") },
    });
    assert.equal(JSON.parse(crossSource.body).lyrics.lines[0].words, "Cached lyric", platform);

    // 查不到时不写缓存；下一次打开会重新查询。
    const missUrl = url.replace("/track/id", "/track/missing");
    let missCalls = 0;
    const missHttp = {
      get: (request, callback) => {
        missCalls += 1;
        callback(null, { status: 200 }, JSON.stringify({}));
      },
    };
    const miss = run(file, "", missUrl, ["lrclib", true], {
      $response: { status: 404, body: "" },
      $persistentStore: store,
      $httpClient: missHttp,
    });
    assert.equal(Object.keys(miss).length, 0, platform);
    const afterMiss = missCalls;
    assert.ok(afterMiss > 0, platform);
    const missCache = JSON.parse(map["spotify.lyrics.cache"] || "{}");
    assert.equal(missCache["lrclib|missing"], undefined, platform + " must not cache a miss");
    const repeated = run(file, "", missUrl, ["lrclib", true], {
      $response: { status: 404, body: "" },
      $persistentStore: store,
      $httpClient: missHttp,
    });
    assert.equal(Object.keys(repeated).length, 0, platform);
    assert.ok(missCalls > afterMiss, platform + " must retry on the next request");
  });

  check(platform + " Spotify browse drops named ad sections", () => {
    const file = platform + "/spotify/js/spotify.feed.js";
    const section = (name) => serialize([s(1, "spotify:section:" + name), b(2, Uint8Array.from([1]))]);
    const list = serialize([b(1, section("1|brand-ad")), b(1, section("2|discover-new"))]);
    const body = serialize([b(1, list)]);
    const out = run(file, body, "https://spclient.wg.spotify.com/browsita/v1/browse?market=US", { block_ads: true, enable_lyrics: true });
    const sections = parse(first(parse(out.body), 1).p).filter((field) => field.no === 1);
    assert.equal(sections.length, 1, platform);
    assert.ok(!text(first(parse(sections[0].p), 1)).includes("brand-ad"), platform);
    assert.ok(text(first(parse(sections[0].p), 1)).includes("discover-new"), platform);

    // 首页请求同样常带查询串；之前 (?:\/|$) 会把整条请求放行。
    const homeList = serialize([b(1, section("1|hpto")), b(1, section("2|recently-played"))]);
    const home = run(file, serialize([b(1, homeList)]), "https://spclient.wg.spotify.com/casita/v1/home?locale=zh", { block_ads: true, enable_lyrics: true });
    const homeSections = parse(first(parse(home.body), 1).p).filter((field) => field.no === 1);
    assert.equal(homeSections.length, 1, platform);
    assert.ok(text(first(parse(homeSections[0].p), 1)).includes("recently-played"), platform);
  });

  check(platform + " Spotify browse renumbers every oversized sponsored field", () => {
    const file = platform + "/spotify/js/spotify.feed.js";
    const big = () => new Uint8Array(13000).fill(7);
    const group = (name) => b(2, serialize([s(1, name), b(6, big())]));
    const body = serialize([v(1, 1n), group("genre"), group("genre-2")]);
    const out = run(file, body, "https://spclient.wg.spotify.com/browsita/v2/browse?market=US", { block_ads: true, enable_lyrics: true });
    const groups = parse(out.body).filter((field) => field.no === 2).map((field) => parse(field.p));
    assert.equal(groups.length, 2, platform);
    for (const fields of groups) {
      assert.equal(fields.some((field) => field.no === 6), false, platform);
      assert.ok(fields.some((field) => field.no === 1000 && field.w === 2), platform);
    }
  });
}

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify feed waits for lyrics before adding the card", () => {
    const file = platform + "/spotify/js/spotify.feed.js";
    const id = "0VjIjW4GlUZAMYd2vXMi3b";
    const body = serialize([b(1, serialize([b(1, serialize([s(2, "normal-card")]))]))]);
    const map = {
      "spotify.track.meta": JSON.stringify({ [id]: ["Song", "Artist", 210000, Date.now()] }),
    };
    const store = {
      read: (key) => (key in map ? map[key] : null),
      write: (value, key) => { map[key] = value; return true; },
    };
    let lookups = 0;
    const http = {
      get: (request, callback) => {
        let data = {};
        if (request.url.includes("lrclib.net/api/get")) {
          lookups++;
          data = { trackName: "Song", artistName: "Artist", duration: 210000, syncedLyrics: "[00:01.00]Ready" };
        } else if (request.url.includes("lrclib.net/api/search")) data = [];
        callback(null, { status: 200 }, JSON.stringify(data));
      },
    };
    const out = run(file, body, scroll, { block_ads: false, enable_lyrics: true, lyrics_source: "lrclib" }, {
      $persistentStore: store,
      $httpClient: http,
    });
    assert.ok(out.body, platform + " must add the card only after lyrics are ready");
    assert.equal(lookups, 1, platform);
    const cache = JSON.parse(map["spotify.lyrics.cache"] || "{}");
    assert.ok(cache["lrclib|" + id], platform + " must warm the color-lyrics cache first");

    // 查不到歌词时不补卡，避免客户端先显示一张空歌词卡。
    const emptyMap = { "spotify.track.meta": map["spotify.track.meta"] };
    const emptyStore = {
      read: (key) => (key in emptyMap ? emptyMap[key] : null),
      write: (value, key) => { emptyMap[key] = value; return true; },
    };
    const miss = run(file, body, scroll, { block_ads: false, enable_lyrics: true, lyrics_source: "lrclib" }, {
      $persistentStore: emptyStore,
      $httpClient: { get: (request, callback) => callback(null, { status: 200 }, JSON.stringify(request.url.includes("lrclib.net/api/search") ? [] : {})) },
    });
    assert.equal(Object.keys(miss).length, 0, platform + " must not add an empty lyrics card");
    const missCache = JSON.parse(emptyMap["spotify.lyrics.cache"] || "{}");
    assert.equal(missCache["lrclib|" + id], undefined, platform + " must not cache a miss");
  });
}

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify stores the connect-state queue for prefetching", () => {
    const current = "0VjIjW4GlUZAMYd2vXMi3b";
    const next = "4uLU6hMCjMI75M1A2tKUQC";
    const previous = "1uLU6hMCjMI75M1A2tKUQD";
    const provided = (id) => serialize([s(1, "spotify:track:" + id)]);
    const body = serialize([
      b(3, serialize([
        b(7, provided(current)),
        b(19, provided(previous)),
        b(20, provided(next)),
      ])),
    ]);
    const map = {};
    const store = {
      read: (key) => (key in map ? map[key] : null),
      write: (value, key) => { map[key] = value; return true; },
    };
    run(platform + "/spotify/js/spotify.js", body,
      "https://spclient.wg.spotify.com/connect-state/v1/player",
      { enable_lyrics: true, prefetch: false }, { $persistentStore: store });
    const queue = JSON.parse(map["spotify.queue"]);
    assert.equal(queue.current, current, platform);
    assert.deepEqual(queue.next, [next], platform + " must not mistake prev_tracks for next");
  });

  check(platform + " Spotify prefetches the current track then next across connect-state polls", () => {
    const current = "0VjIjW4GlUZAMYd2vXMi3b";
    const next = "4uLU6hMCjMI75M1A2tKUQC";
    const provided = (id) => serialize([s(1, "spotify:track:" + id)]);
    const body = serialize([b(3, serialize([b(7, provided(current)), b(20, provided(next))]))]);
    const map = {
      "spotify.track.meta": JSON.stringify({
        [current]: ["Song", "Artist", 210000, Date.now()],
        [next]: ["Next", "Artist", 220000, Date.now()],
      }),
      "spotify.queue": JSON.stringify({ current: current, next: [next], at: Date.now() }),
    };
    const store = {
      read: (key) => (key in map ? map[key] : null),
      write: (value, key) => { map[key] = value; return true; },
    };
    let calls = 0;
    const http = {
      get: (request, callback) => {
        calls += 1;
        if (request.url.includes("lrclib.net/api/get")) {
          const isNext = request.url.indexOf("track_name=Next") >= 0;
          callback(null, { status: 200 }, JSON.stringify({
            trackName: isNext ? "Next" : "Song",
            artistName: "Artist",
            duration: isNext ? 220000 : 210000,
            syncedLyrics: "[00:01.00]" + (isNext ? "Next" : "Song"),
          }));
          return;
        }
        callback(null, { status: 200 }, JSON.stringify([]));
      },
    };
    const extra = { $persistentStore: store, $httpClient: http, setTimeout: () => 1, clearTimeout: () => {} };
    const args = { enable_lyrics: true, lyrics_source: "lrclib", prefetch: true };

    // 第一次轮询：当前曲目；第二次轮询：next_tracks。
    run(platform + "/spotify/js/spotify.js", body,
      "https://spclient.wg.spotify.com/connect-state/v1/player", args, extra);
    let cache = JSON.parse(map["spotify.lyrics.cache"] || "{}");
    assert.ok(cache["lrclib|" + current], platform + " must prefetch the current track first");
    assert.equal(cache["lrclib|" + next], undefined, platform + " must not do both in one response");
    run(platform + "/spotify/js/spotify.js", body,
      "https://spclient.wg.spotify.com/connect-state/v1/player", args, extra);
    cache = JSON.parse(map["spotify.lyrics.cache"] || "{}");
    assert.ok(cache["lrclib|" + next], platform + " must prefetch next on the following poll");

    // 第三次轮询：两者都预取过，不再发请求。
    const before = calls;
    run(platform + "/spotify/js/spotify.js", body,
      "https://spclient.wg.spotify.com/connect-state/v1/player", args, extra);
    assert.equal(calls, before, platform + " must not repeat the same prefetch");
  });

  check(platform + " Spotify rapid track switch prefetches the new current", () => {
    const first = "0VjIjW4GlUZAMYd2vXMi3b";
    const second = "4uLU6hMCjMI75M1A2tKUQC";
    const provided = (id) => serialize([s(1, "spotify:track:" + id)]);
    const body = (id) => serialize([b(3, serialize([b(7, provided(id))]))]);
    const map = {
      "spotify.track.meta": JSON.stringify({
        [first]: ["Song", "Artist", 210000, Date.now()],
        [second]: ["Second", "Artist", 220000, Date.now()],
      }),
      "spotify.queue": JSON.stringify({ current: first, next: [], at: Date.now() }),
    };
    const store = {
      read: (key) => (key in map ? map[key] : null),
      write: (value, key) => { map[key] = value; return true; },
    };
    const http = {
      get: (request, callback) => {
        if (request.url.includes("lrclib.net/api/get")) {
          const isSecond = request.url.indexOf("track_name=Second") >= 0;
          callback(null, { status: 200 }, JSON.stringify({
            trackName: isSecond ? "Second" : "Song",
            artistName: "Artist",
            duration: isSecond ? 220000 : 210000,
            syncedLyrics: "[00:01.00]" + (isSecond ? "Second" : "Song"),
          }));
          return;
        }
        callback(null, { status: 200 }, JSON.stringify([]));
      },
    };
    const extra = { $persistentStore: store, $httpClient: http, setTimeout: () => 1, clearTimeout: () => {} };
    const args = { enable_lyrics: true, lyrics_source: "lrclib", prefetch: true };

    run(platform + "/spotify/js/spotify.js", body(first),
      "https://spclient.wg.spotify.com/connect-state/v1/player", args, extra);
    map["spotify.queue"] = JSON.stringify({ current: second, next: [], at: Date.now() });
    // 模拟两秒后切歌，越过快速切歌的冷却窗口。
    map["spotify.prefetch.last"] = JSON.stringify({ id: first, at: Date.now() - 5000 });
    run(platform + "/spotify/js/spotify.js", body(second),
      "https://spclient.wg.spotify.com/connect-state/v1/player", args, extra);
    const cache = JSON.parse(map["spotify.lyrics.cache"] || "{}");
    assert.ok(cache["lrclib|" + second], platform + " must prefetch the newly playing track");
  });
}

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify lyrics preserves ContextTrack GID and uses its field-4 metadata", () => {
    const file = platform + "/spotify/js/spotify.js";
    const url = "https://spclient.wg.spotify.com/context-resolve/v1/context";
    const gid = new Uint8Array(16).fill(0xab);
    const metadata = (key, value) => b(4, serialize([s(1, key), s(2, value)]));
    const context = serialize([s(1, track), s(2, "uid"), b(3, gid), metadata("track_title", "Song"), metadata("has_lyrics", "false")]);
    const out = parse(run(file, context, url).body);
    assert.equal(out.filter((f) => f.no === 3).length, 1, "GID must never get a duplicate field-3 map entry");
    assert.deepEqual(first(out, 3).p, gid);
    assert.equal(out.filter((f) => f.no === 4).length, 2);
    assert.ok(out.filter((f) => f.no === 4).some((f) => text(first(parse(f.p), 1)) === "has_lyrics" && text(first(parse(f.p), 2)) === "true"));
    const official = serialize([s(1, track), s(2, "uid"), b(3, gid), metadata("has_lyrics", "true")]);
    assert.equal(Object.keys(run(file, official, url)).length, 0, "official has_lyrics=true must pass through");
    const ambiguous = serialize([s(1, track), s(2, "uid"), b(3, gid)]);
    assert.equal(Object.keys(run(file, ambiguous, url)).length, 0, "URI and uid alone do not identify a metadata field");
    const page = serialize([s(1, "page"), b(4, context)]);
    const wrapped = serialize([s(1, "spotify:playlist:example"), b(5, page)]);
    const patchedPage = parse(first(parse(run(file, wrapped, url).body), 5).p);
    const nestedTrack = parse(first(patchedPage, 4).p);
    assert.deepEqual(first(nestedTrack, 3).p, gid, "GID must survive the actual Context -> page -> track wrapper");
    assert.equal(nestedTrack.filter((f) => f.no === 3).length, 1);
    assert.equal(Object.keys(run(file, wrapped, url, { enable_lyrics: false })).length, 0);
  });
}

check("Spotify empty 200 is treated as missing lyrics", () => {
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const file = platform + "/spotify/js/spotify_lyrics.js";
    const url = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json";
    const out = run(file, "", url, ["lrclib", true], {
      $response: { status: 200, body: "" },
      $httpClient: { get: (request, callback) => callback(null, { status: 200 }, JSON.stringify(
        request.url.includes("oembed") ? { title: "Song", author_name: "Artist" }
          : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Empty 200" })) },
    });
    assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "Empty 200", platform);

    // content-length > 0 说明上游有 body，只是没交到脚本手里：必须原样放行。
    const kept = run(file, "", url, ["lrclib", true], {
      $response: { status: 200, body: "", headers: { "content-length": "1234" } },
      $httpClient: { get: () => assert.fail("must not query providers when the body was dropped") },
    });
    assert.equal(Object.keys(kept).length, 0, platform + " must pass through");
  }
});

check("Spotify lyrics fetch fallback without $httpClient", () => {
  const url = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json";
  // 同步 thenable：回归 harness 是同步的，真实运行时是 Promise。
  const sync = (value) => ({ then: (resolve) => { resolve(value); return { catch: () => {} }; } });
  const payload = (target) => JSON.stringify(target.includes("oembed")
    ? { title: "Song", author_name: "Artist" }
    : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Hello" });
  const out = run("loon/spotify/js/spotify_lyrics.js", "", url,
    { lyrics_source: "lrclib", enable_lyrics: true },
    {
      $response: { status: 404, body: "" },
      fetch: (target) => sync({ status: 200, text: () => sync(payload(target)) }),
    });
  assert.ok(out.body, "fetch fallback must still return lyrics");
});

check("Egern YouTube moves ad_break out of the request script", () => {
  const yaml = read("egern/youtube/youtube-enhance.yaml");
  assert.ok(yaml.includes("url_rewrites:"), "must use Egern url_rewrites");
  assert.ok(yaml.includes('location: "http://reject-200/"'), "ad_break must return an empty 200");
  assert.ok(yaml.includes("youtube.request.log"), "log_event keeps its request script");
  assert.ok(!yaml.includes("youtube.request.meta"), "the old meta entry must be gone");
  assert.ok(!/^rewrites:/m.test(yaml), "Surge-style rewrites are not part of the Egern schema");
});

check("YouTube keeps current and previous Loon argument tuples aligned", () => {
  const file = "loon/youtube/js/youtube.request.js";
  const url = "https://youtubei.googleapis.com/youtubei/v1/player/ad_break";
  // 第 0 位 block_ads=false：解析正确时 ad_break 直接放行；如果 12 项旧 tuple
  // 被误当成 26 项旧版位置参数，block_ads 会回落到默认 true，返回空 protobuf。
  const current = [false, true, "max", "zh-Hans", "", false, true, false, "standard", true, "4", true];
  const previous = [false, true, "max", "zh-Hans", "", false, true, true, false, "standard", true, "4"];
  for (const args of [current, previous]) {
    assert.equal(run(file, new Uint8Array(), url, args), undefined);
  }
});

check("YouTube web JSON strips ads, Shorts shelves and members-only videos", () => {
  const body = JSON.stringify({
    contents: [
      { videoRenderer: { videoId: "ok" } },
      { adSlotRenderer: { adSlotMetadata: { slotId: "ad" } } },
      { reelShelfRenderer: { title: { simpleText: "Shorts" } } },
      { videoRenderer: { videoId: "members", badges: [{ metadataBadgeRenderer: { label: "会员专享" } }] } },
      { clarificationRenderer: { text: "AI" } },
      { shoppingShelfRenderer: { title: "shop" } },
    ],
    entries: [{ displayAdRenderer: {} }],
  });
  const args = { blockAds: true, blockAi: true, blockShortsFeed: true, blockMembersOnly: true, blockStore: true, web: true };
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const url = "https://www.youtube.com/youtubei/v1/browse";
    const out = run(platform + "/youtube/js/youtube.response.js", body, url, args, {
      $request: { url },
      $response: { url, status: 200, headers: { "content-type": "application/json" }, body },
    });
    assert.ok(out.body, platform + " must rewrite the JSON body");
    const data = JSON.parse(out.body);
    assert.deepEqual(data.contents.map((item) => Object.keys(item)[0]), ["videoRenderer"]);
    assert.equal(data.contents[0].videoRenderer.videoId, "ok");
    assert.deepEqual(data.entries, []);
  }
});

check("YouTube web player removes ad fields, keeps audio and caps video height", () => {
  const body = JSON.stringify({
    adPlacements: [{ ad: 1 }],
    adSlots: [{ ad: 2 }],
    streamingData: {
      adaptiveFormats: [
        { itag: 1, height: 2160, mimeType: "video/mp4" },
        { itag: 2, height: 1080, mimeType: "video/mp4" },
        { itag: 3, height: 720, mimeType: "video/mp4" },
        { itag: 4, mimeType: "audio/mp4" },
      ],
    },
  });
  const args = { blockAds: true, maxHeight: 1080, web: true };
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const url = "https://www.youtube.com/youtubei/v1/player";
    const out = run(platform + "/youtube/js/youtube.response.js", body, url, args, {
      $request: { url },
      $response: { url, status: 200, headers: { "content-type": "application/json" }, body },
    });
    const data = JSON.parse(out.body);
    assert.equal(data.adPlacements, undefined);
    assert.equal(data.adSlots, undefined);
    assert.deepEqual(data.streamingData.adaptiveFormats.map((item) => item.itag), [2, 4]);
  }
});

check("YouTube web toggle gates request and response rewriting", () => {
  const argsOff = { blockAds: true, web: false };
  const argsOn = { blockAds: true, web: true };
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const requestFile = platform + "/youtube/js/youtube.request.js";
    const responseFile = platform + "/youtube/js/youtube.response.js";
    const adBreak = "https://www.youtube.com/youtubei/v1/player/ad_break";
    const on = run(requestFile, new Uint8Array(), adBreak, argsOn);
    assert.equal(on.response ? on.response.status : on.status, 200);
    assert.equal(run(requestFile, new Uint8Array(), adBreak, argsOff), undefined);

    const url = "https://m.youtube.com/youtubei/v1/browse";
    const body = JSON.stringify({ contents: [{ adSlotRenderer: {} }, { videoRenderer: { videoId: "ok" } }] });
    const pass = run(responseFile, body, url, argsOff, {
      $request: { url },
      $response: { url, status: 200, headers: { "content-type": "application/json" }, body },
    });
    assert.deepEqual(Object.keys(pass), []);
  }
});

check("YouTube web JSON passes through unknown or malformed bodies", () => {
  const url = "https://www.youtube.com/youtubei/v1/browse";
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const file = platform + "/youtube/js/youtube.response.js";
    for (const body of ["{bad", JSON.stringify({ contents: [{ videoRenderer: { videoId: "ok" } }] })]) {
      const out = run(file, body, url, { web: true }, {
        $request: { url },
        $response: { url, status: 200, headers: { "content-type": "application/json" }, body },
      });
      assert.deepEqual(Object.keys(out), []);
    }
  }
});

check("Bilibili web endpoints strip ads behind the web toggle", () => {
  const base = "https://api.bilibili.com";
  const cases = [
    {
      path: "/x/web-interface/archive/related?bvid=BV1",
      body: { code: 0, data: [{ aid: 1 }, { aid: 2, is_ad: true }] },
      check: (data) => assert.deepEqual(data.data.map((item) => item.aid), [1]),
    },
    {
      path: "/x/web-interface/wbi/search/type?keyword=x",
      body: { code: 0, data: { result: [{ aid: 1 }, { aid: 2, goto: "ad" }, { aid: 3, card_type: "cm_video" }] } },
      check: (data) => assert.deepEqual(data.data.result.map((item) => item.aid), [1]),
    },
    {
      path: "/x/web-interface/view?bvid=BV1",
      body: { code: 0, data: { cm_config: { ads: [] }, relates: [{ aid: 1 }, { aid: 2, is_ad: true }] } },
      check: (data) => {
        assert.equal(data.data.cm_config, undefined);
        assert.deepEqual(data.data.relates.map((item) => item.aid), [1]);
      },
    },
    {
      path: "/x/polymer/web-dynamic/v1/feed/all?type=all",
      body: { code: 0, data: { items: [{ type: "DYNAMIC_TYPE_AV", id: "ok" }, { type: "DYNAMIC_TYPE_AD", id: "ad" }] } },
      check: (data) => assert.deepEqual(data.data.items.map((item) => item.id), ["ok"]),
    },
    {
      path: "/pgc/view/web/season?season_id=1",
      body: { code: 0, result: { payment: { price: "0" }, title: "番剧" } },
      check: (data) => {
        assert.equal(data.result.payment, undefined);
        assert.equal(data.result.title, "番剧");
      },
    },
    {
      path: "/pgc/page/bangumi?season_id=1",
      body: { code: 0, result: { modules: [{ module_style: "ad_banner" }, { module_style: "episode" }] } },
      check: (data) => assert.deepEqual(data.result.modules.map((item) => item.module_style), ["episode"]),
    },
    {
      path: "/xlive/web-interface/v1/index/getList?platform=web",
      body: { code: 0, data: { banner: [{ id: 1, is_ad: true }, { id: 2 }] } },
      check: (data) => assert.deepEqual(data.data.banner.map((item) => item.id), [2]),
    },
  ];
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const file = platform + "/bilibili/js/bilibili_clean.js";
    for (const item of cases) {
      const url = base + item.path;
      const on = run(file, JSON.stringify(item.body), url, { block_ads: true, hide_vip: true, clean_ui: true, web: true });
      assert.ok(on.body, platform + " " + item.path + " must rewrite");
      item.check(JSON.parse(on.body));

      const off = run(file, JSON.stringify(item.body), url, { block_ads: true, hide_vip: true, clean_ui: true, web: false });
      assert.deepEqual(Object.keys(off), [], platform + " " + item.path + " must pass through when web is off");
    }
  }
});

check("Bilibili web playurl gets 4K query behind the web toggle", () => {
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const file = platform + "/bilibili/js/bilibili_quality.js";
    const url = "https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1&cid=1&qn=64&fnval=16";
    const on = run(file, new Uint8Array(), url, { auto_quality: true, web: true });
    assert.ok(on.url.includes("qn=120"));
    assert.ok(on.url.includes("fourk=1"));
    assert.ok(on.url.includes("fnval=144"));
    const off = run(file, new Uint8Array(), url, { auto_quality: true, web: false });
    assert.ok(off === undefined || Object.keys(off).length === 0);
  }
});

check("Pluto / Tubi Loon plugins pass the web switch in order", () => {
  const tuple = (file, tag) => {
    const line = read(file).split("\n").find((item) => item.includes('tag="' + tag + '"'));
    assert.ok(line, tag);
    const raw = /then script\("[^"]+", (\{.*\})\) with/.exec(line)[1];
    return [...raw.matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]);
  };
  for (const tag of ["Pluto TV Ad-Free", "Pluto TV HLS", "Pluto TV Session"]) {
    assert.deepEqual(tuple("loon/pluto/pluto-adfree.plugin", tag), ["block_ads", "web"], tag);
  }
  for (const tag of ["Pluto TV Caption", "Pluto TV Subtitle"]) {
    assert.deepEqual(
      tuple("loon/pluto/pluto-adfree.plugin", tag),
      ["block_ads", "caption_lang", "bilingual", "translate_key", "translate_provider", "web"],
      tag,
    );
  }
  assert.deepEqual(
    tuple("loon/tubi/tubi-adfree.plugin", "Tubi Ad-Free"),
    ["block_ads", "caption_lang", "bilingual", "translate_key", "translate_provider", "web"],
  );
});

check("Shadowrocket Pluto / Tubi argument JSON stays valid with the web switch", () => {
  // {{{变量}}} 在客户端里由参数值替换；这里先替换成 true 再按 JSON 解析。
  for (const [file, name] of [
    ["shadowrocket/pluto/pluto-adfree.sgmodule", "pluto.hls"],
    ["shadowrocket/pluto/pluto-adfree.sgmodule", "pluto.manifest"],
    ["shadowrocket/tubi/tubi-adfree.sgmodule", "tubi.adfree"],
  ]) {
    const line = read(file).split("\n").find((item) => item.startsWith(name + " ="));
    assert.ok(line, file + " " + name);
    const raw = /argument="(.*)"$/.exec(line)[1].replace(/\{\{\{[^}]*\}\}\}/g, "true");
    assert.equal(JSON.parse(raw).web, true, file + " " + name);
  }
});

check("Egern and Shadowrocket modules do not hard-code a proxy policy", () => {
  for (const file of [
    "egern/tubi/tubi-adfree.yaml",
    "egern/pluto/pluto-adfree.yaml",
    "shadowrocket/tubi/tubi-adfree.sgmodule",
    "shadowrocket/pluto/pluto-adfree.sgmodule",
  ]) {
    const text = read(file);
    assert.ok(!/policy:\s*PROXY/.test(text), file + " must not use policy: PROXY");
    assert.ok(!/,PROXY$/m.test(text), file + " must not route to PROXY");
  }
});

check("Spotify third-party JSON has fullscreen action and top-level colors", () => {
  const out = run("loon/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", {}, {
    $response: { status: 404, body: "" },
    $httpClient: { get: (request, callback) => callback(null, { status: 200 }, JSON.stringify(request.url.includes("oembed") ? { title: "Song", author_name: "Artist" } : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Hello" })) },
  });
  const data = JSON.parse(out.body);
  assert.equal(data.lyrics.fullscreenAction, "FULLSCREEN_LYRICS");
  assert.ok(data.colors.highlightText);
});

check("Spotify lyrics handles metadata and source misses without diagnostic logs", () => {
  const url = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json";
  for (const scenario of ["metadata-missing", "source-miss", "emit"]) {
    const logs = [];
    const out = run("loon/spotify/js/spotify_lyrics.js", "", url, ["lrclib", true, "full"], {
      console: { log: (line) => logs.push(line) },
      $response: { status: 404, body: "" },
      $httpClient: { get: (request, callback) => {
        const meta = request.url.includes("oembed");
        callback(null, { status: 200 }, JSON.stringify(meta
          ? scenario === "metadata-missing" ? {} : { title: "Private Song Title", author_name: "Private Artist" }
          : scenario === "emit" ? { trackName: "Private Song Title", artistName: "Private Artist", syncedLyrics: "[00:01.00]Private lyric text" } : []));
      } },
    });
    assert.equal(logs.length, 0, "must not write diagnostic logs");
    assert.equal(!!out.body, scenario === "emit");
  }
});

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify auto recovers Chinese artist metadata and retries missing candidate lyrics", () => {
    const requests = [];
    const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["auto", true], {
      $response: { status: 404, body: "" },
      $httpClient: { get: (request, callback) => {
        requests.push(request.url);
        let data;
        if (request.url.includes("oembed")) data = { title: "晚秋" };
        else if (request.url.includes("/embed/track/")) {
          const entity = { id: "id", type: "track", title: "晚秋", artists: [{ name: "毛宁" }], duration: 212000 };
          callback(null, { status: 200 }, '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) + '</script>');
          return;
        } else if (request.url.includes("/search/get")) {
          assert.equal(new URL(request.url).searchParams.get("s"), "晚秋 毛宁");
          data = { result: { songs: [
            { id: 1, name: "晚秋", artists: [{ name: "其他歌手" }], duration: 212000 },
            { id: 2, name: "晚秋", artists: [{ name: "毛宁" }], duration: 212000 },
            { id: 3, name: "晚秋", artists: [{ name: "毛宁" }], duration: 213000 },
          ] } };
        } else if (request.url.includes("id=2&")) data = { lrc: {} };
        else if (request.url.includes("id=3&")) data = { lrc: { lyric: "[00:01.00]Matched version" } };
        // egern 走 ctx 适配层，回调是异步的，auto 的另外两个源会在 NetEase 定稿前先发起。
        else if (platform === "egern") data = {};
        else assert.fail("unexpected source or wrong artist: " + request.url);
        callback(null, { status: 200 }, JSON.stringify(data));
      } },
    });
    assert.equal(JSON.parse(out.body).lyrics.provider, "NetEase");
    assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "Matched version");
    assert.equal(requests.filter((url) => url.includes("music.163.com")).length, 3, "search + two lyric candidates");
    if (platform !== "egern") assert.equal(requests.length, 5, "synchronous mocks stop after NetEase");
  });
}

check("Spotify auto can finish with QQ when NetEase has no match", () => {
  const out = run("loon/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["auto", true], {
    $response: { status: 404, body: "" },
    $httpClient: { get: (request, callback) => {
      let data;
      if (request.url.includes("oembed")) data = { title: "晚秋", author_name: "毛宁" };
      else if (request.url.includes("/embed/track/")) data = {};
      else if (request.url.includes("music.163.com")) data = { result: { songs: [] } };
      else if (request.url.includes("search_for_qq_cp")) data = { data: { song: { list: [{ songmid: "qq-id", songname: "晚秋", singer: [{ name: "毛宁" }], interval: 212 }] } } };
      else if (request.url.includes("fcg_query_lyric")) data = { lyric: "[00:01.00]QQ result" };
      else assert.fail("slow fallback must not precede QQ: " + request.url);
      callback(null, { status: 200 }, JSON.stringify(data));
    } },
  });
  assert.equal(JSON.parse(out.body).lyrics.provider, "QQ Music");
});

check("Spotify auto queries the three sources concurrently, skips Musixmatch and uses the cover colour", () => {
  const requests = [];
  const pending = new Map();
  let done;
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    $request: { url: "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json" },
    $response: { status: 404, body: "" }, $argument: ["auto", true],
    setTimeout: () => 1, clearTimeout() {},
    $done: (value) => { done = value; },
    $httpClient: { get: (request, callback) => {
      requests.push(request.url);
      if (request.url.includes("oembed")) callback(null, { status: 200 }, JSON.stringify({ title: "Song", author_name: "Artist" }));
      else if (request.url.includes("/embed/track/")) {
        const entity = { id: "id", type: "track", title: "Song", artists: [{ name: "Artist" }], duration: 200000,
          visualIdentity: { backgroundBase: { red: 255, green: 140, blue: 0 } } };
        callback(null, { status: 200 }, '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) + "</script>");
      } else pending.set(request.url, callback);
    } },
  });
  vm.runInContext(read("loon/spotify/js/spotify_lyrics.js"), context);
  assert.equal(done, undefined);
  const providers = requests.filter((url) => !url.includes("oembed") && !url.includes("/embed/"));
  assert.equal(providers.length, 4, "LRCLIB get + search and the other two sources are all requested up front");
  assert.ok(providers.some((url) => url.includes("lrclib.net/api/get")));
  assert.ok(providers.some((url) => url.includes("lrclib.net/api/search")));
  assert.ok(providers.some((url) => url.includes("music.163.com/api/search")));
  assert.ok(providers.some((url) => url.includes("search_for_qq_cp")));
  assert.ok(!providers.some((url) => url.includes("client_search_cp")), "the legacy QQ search endpoint is unreliable");
  assert.ok(!requests.some((url) => url.includes("musixmatch")), "auto must skip Spotify's own upstream");

  const reply = (part) => [...pending.entries()].find(([url]) => url.includes(part));
  const [, netease] = reply("music.163.com/api/search");
  netease(null, { status: 200 }, JSON.stringify({ result: { songs: [
    { id: 1, name: "Song", artists: [{ name: "Artist" }], duration: 200000 },
  ] } }));
  const [, lyric] = reply("api/song/lyric");
  lyric(null, { status: 200 }, JSON.stringify({ lrc: { lyric: "[00:01.00]NetEase wins" } }));
  assert.ok(done);
  const payload = JSON.parse(done.body);
  assert.equal(payload.lyrics.provider, "NetEase");
  // 橙色封面压到 0.5 亮度 => #e07b00；未唱黑字，已唱白字。
  assert.equal(payload.colors.background, -2065664);
  assert.equal(payload.colors.text, -16777216);
  assert.equal(payload.colors.highlightText, -1);
  const [, lrclib] = reply("lrclib.net/api/get");
  lrclib(null, { status: 200 }, JSON.stringify({ trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Late LRCLIB" }));
  assert.equal(JSON.parse(done.body).lyrics.provider, "NetEase", "late results must not overwrite the first winner");
});

check("Spotify LRCLIB sends get and search for both titles up front", () => {
  const id = "0VjIjW4GlUZAMYd2vXMi3b";
  const title = "晚秋（电影《晚秋》主题曲）";
  const store = {
    read: (key) => key === "spotify.track.meta"
      ? JSON.stringify({ [id]: [title, "毛宁", 200000, Date.now()] })
      : null,
    write: () => true,
  };
  const requests = [];
  const pending = new Map();
  let done;
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    $request: { url: "https://spclient.wg.spotify.com/color-lyrics/v2/track/" + id + "?format=json" },
    $response: { status: 404, body: "" }, $argument: ["lrclib", true], $persistentStore: store,
    setTimeout: () => 1, clearTimeout() {}, $done: (value) => { done = value; },
    $httpClient: { get: (request, callback) => {
      requests.push(request.url);
      pending.set(request.url, callback);
    } },
  });
  vm.runInContext(read("loon/spotify/js/spotify_lyrics.js"), context);
  assert.equal(requests.length, 4, "get and search for both titles are sent before any response");
  assert.ok(requests[0].includes("/api/get?") && requests[0].includes(encodeURIComponent(title)));
  assert.ok(requests[1].includes("/api/search?") && requests[1].includes(encodeURIComponent(title)));
  assert.ok(requests[2].includes("/api/get?") && requests[2].includes(encodeURIComponent("晚秋") + "&"));
  assert.ok(requests[3].includes("/api/search?") && requests[3].includes(encodeURIComponent("晚秋") + "&"));
  const [, search] = [...pending.entries()].find(([url]) =>
    url.includes("/api/search?") && url.includes(encodeURIComponent("晚秋") + "&"));
  search(null, { status: 200 }, JSON.stringify([
    { trackName: "晚秋", artistName: "毛宁", duration: 200000, syncedLyrics: "[00:01.00]秋" },
  ]));
  assert.ok(done);
  assert.equal(JSON.parse(done.body).lyrics.lines[0].words, "秋");
});

check("Spotify NetEase requests candidate lyrics in parallel", () => {
  const id = "0VjIjW4GlUZAMYd2vXMi3b";
  const store = {
    read: (key) => key === "spotify.track.meta"
      ? JSON.stringify({ [id]: ["Song", "Artist", 210000, Date.now()] })
      : null,
    write: () => true,
  };
  const lyricRequests = [];
  let done;
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    $request: { url: "https://spclient.wg.spotify.com/color-lyrics/v2/track/" + id + "?format=json" },
    $response: { status: 404, body: "" }, $argument: ["netease", true], $persistentStore: store,
    setTimeout: () => 1, clearTimeout() {}, $done: (value) => { done = value; },
    $httpClient: { get: (request, callback) => {
      if (request.url.includes("music.163.com/api/search")) {
        callback(null, { status: 200 }, JSON.stringify({ result: { songs: [1, 2, 3].map((n) => ({
          id: n, name: "Song", artists: [{ id: String(n), name: "Artist" }], duration: 210000,
        })) } }));
        return;
      }
      if (request.url.includes("api/song/lyric")) lyricRequests.push(callback);
    } },
  });
  vm.runInContext(read("loon/spotify/js/spotify_lyrics.js"), context);
  assert.equal(lyricRequests.length, 3, "all candidate lyric requests are issued before any resolves");
  lyricRequests[2](null, { status: 200 }, JSON.stringify({ lrc: { lyric: "[00:01.00]Third" } }));
  assert.ok(done);
  assert.equal(JSON.parse(done.body).lyrics.lines[0].words, "Third");
});

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify Live validates artist, performance and duration before fetching lyrics", () => {
    for (const sample of [
      { title: "落叶归根-四公live", candidate: "落叶归根 (Live版)", accept: true },
      { title: "落葉歸根 - 四公 live", candidate: "落叶归根 (Live版)", accept: false },
      { title: "落叶归根（四公 LIVE）", candidate: "落叶归根 (Live版)", accept: true },
      { title: "落叶归根 - 四公现场", candidate: "落叶归根 (Live版)", accept: true },
      { title: "落叶归根 - 四公 live", candidate: "落叶归根", accept: false },
      { title: "落叶归根 - 四公 live", candidate: "落叶归根 (Live)", artist: "王力宏", accept: false },
      { title: "落叶归根 - 四公 live", candidate: "落叶归根 (Live)", artist: "蔡国庆合唱团", accept: false },
      { title: "落叶归根 - 四公 live", candidate: "落叶归根 (三公 live)", accept: false },
      { title: "落叶归根 - 四公 live", candidate: "落叶归根 (Live)", seconds: 328, accept: false },
      { title: "落叶归根 - 四公 live", candidate: "落叶归根 (Live)", seconds: 0, accept: false },
      { title: "落叶归根 - 四公 live", candidate: "落叶归根 (Live)", noMetadata: true, accept: false },
    ]) {
      const fetched = [];
      const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id", ["netease", true], {
        $response: { status: 404 },
        $httpClient: { get: (request, callback) => {
          let data;
          if (request.url.includes("oembed")) data = { title: sample.title, author_name: "蔡國慶" };
          else if (request.url.includes("/embed/track/")) {
            const entity = { id: "id", type: "track", title: sample.title, artists: [{ name: "蔡国庆" }], duration: 349546 };
            callback(null, { status: 200 }, sample.noMetadata ? "" : '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) + '</script>');
            return;
          } else if (request.url.includes("/search/get")) data = { result: { songs: [
            { id: 1, name: "其他歌名", artists: [{ name: "蔡国庆" }], duration: 349546 },
            { id: 2, name: "落叶归根", artists: [{ name: "王力宏" }], duration: 315000 },
            { id: 3, name: "落叶归根 (Live)", artists: [{ name: "王力宏" }], duration: 349546 },
            { id: 2090356012, name: sample.candidate, artists: [{ name: sample.artist || "蔡国庆" }, { name: "陈楚生" }], duration: (sample.seconds === undefined ? 349.546 : sample.seconds) * 1000 },
          ] } };
          else {
            fetched.push(new URL(request.url).searchParams.get("id"));
            data = { lrc: { lyric: "[00:00.00]四公演出\n[05:49.25]尾声" } };
          }
          callback(null, { status: 200 }, JSON.stringify(data));
        } },
      });
      assert.deepEqual(fetched, sample.accept ? ["2090356012"] : [], JSON.stringify(sample));
      assert.equal(!!out.body, sample.accept);
      if (sample.accept) {
        const lyrics = parse(first(parse(out.body), 1).p);
        const lines = lyrics.filter((field) => field.no === 2).map((field) => parse(field.p));
        assert.equal(text(first(lines[0], 2)), "四公演出");
        assert.equal(first(lines[1], 1).v, 349250n);
      }
    }
  });

  check(platform + " Spotify auto rejects wrong titles and artists across sources and continues", () => {
    for (const record of [
      { trackName: "Song", artistName: "Other Artist" },
      { trackName: "Other Song", artistName: "Artist" },
      { trackName: "Song (Live)", artistName: "Artist" },
      {},
    ]) {
      const fetched = [];
      const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["auto", true], {
        $response: { status: 404 },
        $httpClient: { get: (request, callback) => {
          let data;
          if (request.url.includes("oembed")) data = { title: "Song", author_name: "Artist" };
          else if (request.url.includes("/embed/track/")) data = {};
          else if (request.url.includes("/api/get?")) data = { ...record, syncedLyrics: "[00:01.00]Wrong result" };
          else if (request.url.includes("/api/search?")) data = [{ ...record, syncedLyrics: "[00:01.00]Wrong result" }];
          else if (request.url.includes("/search/get")) data = { result: { songs: [{ id: 1, name: "Other Song", artists: [{ name: "Artist" }] }] } };
          else if (request.url.includes("search_for_qq_cp")) data = { data: { song: { list: [
            { songmid: "wrong", songname: "Song", singer: [{ name: "Other Artist" }] },
            { songmid: "right", songname: "Song", singer: [{ name: "Artist" }] },
          ] } } };
          else {
            fetched.push(request.url);
            data = { lyric: "[00:01.00]Correct QQ result" };
          }
          callback(null, { status: 200 }, JSON.stringify(data));
        } },
      });
      assert.equal(fetched.length, 1);
      assert.ok(fetched[0].includes("songmid=right&"));
      assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "Correct QQ result");
    }
  });
}

check("Spotify auto keeps plain lyrics at deadline while looking for synchronized lyrics", () => {
  let timeout, lateReply, result;
  let calls = 0;
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    $request: { url: "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json" },
    $response: { status: 404, body: "" }, $argument: ["auto", true],
    setTimeout: (fn) => { timeout = fn; return 1; }, clearTimeout() {},
    $done: (value) => { calls++; result = value; },
    $httpClient: { get: (request, callback) => {
      if (request.url.includes("music.163.com")) { lateReply = callback; return; }
      const data = request.url.includes("oembed") ? { title: "Song", author_name: "Artist" }
        : request.url.includes("/api/get?") ? { trackName: "Song", artistName: "Artist", plainLyrics: "Plain fallback" } : [];
      callback(null, { status: 200 }, JSON.stringify(data));
    } },
  });
  vm.runInContext(read("loon/spotify/js/spotify_lyrics.js"), context);
  assert.equal(calls, 0);
  timeout();
  assert.equal(calls, 1);
  assert.equal(JSON.parse(result.body).lyrics.syncType, "UNSYNCED");
  lateReply(null, { status: 200 }, '{}');
  assert.equal(calls, 1);
});

check("Spotify auto leaves unmatched Live lyrics empty instead of using a studio fallback", () => {
  const requests = [];
  const out = run("loon/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id", ["auto", true], {
    $response: { status: 404 },
    $httpClient: { get: (request, callback) => {
      requests.push(request.url);
      assert.ok(!request.url.includes("musixmatch"), "unverified Live fallback must not run");
      const wrong = { trackName: "落叶归根", artistName: "王力宏", syncedLyrics: "[00:01.00]Studio lyrics" };
      let data;
      if (request.url.includes("oembed")) data = { title: "落叶归根 - 四公 live" };
      else if (request.url.includes("/embed/track/")) {
        const entity = { id: "id", type: "track", title: "落叶归根 - 四公 live", artists: [{ name: "蔡国庆" }], duration: 349546 };
        callback(null, { status: 200 }, '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) + '</script>');
        return;
      } else if (request.url.includes("/api/get?")) data = wrong;
      else if (request.url.includes("/api/search?")) data = [wrong];
      else data = {};
      callback(null, { status: 200 }, JSON.stringify(data));
    } },
  });
  assert.equal(Object.keys(out).length, 0);
  // oEmbed + embed + LRCLIB get / search / 歌名兜底 + NetEase 搜索 + QQ 搜索。
  assert.equal(requests.length, 7);
});

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify normalizes Unicode and catalogue name order without inventing translated names", () => {
    for (const sample of [
      { title: "書劍恩仇錄", artist: "Adam Cheng", name: "書劍恩仇錄", singer: "Cheng, Adam", accept: true },
      { title: "书剑恩仇录", artist: "Adam Cheng", name: "书剑恩仇录", singer: "郑少秋", accept: false },
      { title: "書劍恩仇錄", artist: "Adam Cheng", name: "书剑恩仇录", singer: "Adam Cheng", accept: false },
      { title: "Ｓｏｎｇ", artist: "Artist", name: "Song", singer: "Artist", accept: true },
      { title: "Cafe\u0301", artist: "Artist", name: "Café", singer: "Artist", accept: true },
      { title: "東京", artist: "歌手", name: "大阪", singer: "歌手", accept: false },
      { title: "أغنية", artist: "فنان", name: "أغنية", singer: "فنان", accept: true },
      { title: "노래", artist: "가수", name: "노래", singer: "다른 가수", accept: false },
    ]) {
      const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["lrclib", true], {
        $response: { status: 404 },
        $httpClient: { get: (request, callback) => {
          const record = { trackName: sample.name, artistName: sample.singer, syncedLyrics: "[00:01.00]Lyrics" };
          const data = request.url.includes("oembed") ? { title: sample.title, author_name: sample.artist }
            : request.url.includes("/api/search?") ? [record] : record;
          callback(null, { status: 200 }, JSON.stringify(data));
        } },
      });
      assert.equal(!!out.body, sample.accept, JSON.stringify(sample));
    }
  });

  check(platform + " Spotify ignores feat / remaster suffixes and featured artists when matching", () => {
    const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["lrclib", true], {
      $response: { status: 404 },
      $httpClient: { get: (request, callback) => {
        let data;
        if (request.url.includes("oembed")) data = { title: "Song (feat. Other) - 2011 Remaster", author_name: "Artist, Other" };
        else if (request.url.includes("/api/get?")) data = { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Base title lyric" };
        else data = {};
        callback(null, { status: 200 }, JSON.stringify(data));
      } },
    });
    assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "Base title lyric", platform);
  });

  check(platform + " Spotify strips decorative parentheses and retries the title", () => {
    const getCalls = [];
    const title = "晚秋（电影《晚秋》主题曲）";
    const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["lrclib", true], {
      $response: { status: 404 },
      $httpClient: { get: (request, callback) => {
        let data = {};
        if (request.url.includes("oembed")) data = { title: title, author_name: "毛宁" };
        else if (request.url.includes("/api/get?")) {
          getCalls.push(request.url);
          if (getCalls.length === 2) {
            data = { trackName: "晚秋", artistName: "毛宁", duration: 200000, syncedLyrics: "[00:01.00]秋" };
          }
        } else if (request.url.includes("/api/search?")) data = [];
        callback(null, { status: 200 }, JSON.stringify(data));
      } },
    });
    assert.equal(getCalls.length, 2, platform + " must retry without the parenthetical part");
    assert.ok(getCalls[0].includes(encodeURIComponent(title)), "first lookup keeps the full title");
    assert.ok(getCalls[1].includes("track_name=" + encodeURIComponent("晚秋") + "&"), platform);
    assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "秋", platform);
  });

  check(platform + " Spotify auto skips Musixmatch and retains correct plain lyrics", () => {
    let checkedSubtitle = false;
    const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["auto", true], {
      $response: { status: 404 },
      $httpClient: { get: (request, callback) => {
        let data = {};
        if (request.url.includes("oembed")) data = { title: "書劍恩仇錄", author_name: "Adam Cheng" };
        else if (request.url.includes("/api/get?")) data = { trackName: "書劍恩仇錄", artistName: "Adam Cheng", plainLyrics: "紅花會豪傑\n碧血染蠻夷" };
        else if (request.url.includes("/api/search?")) data = [];
        else if (request.url.includes("token.get")) data = { message: { body: { user_token: "token" } } };
        else if (request.url.includes("macro.subtitles.get")) {
          checkedSubtitle = true;
          data = { message: { header: { status_code: 200 }, body: { macro_calls: {
            "matcher.track.get": { message: { header: { status_code: 200 }, body: { track: { track_name: "Paradise", artist_name: "Coldplay" } } } },
            "track.subtitles.get": { message: { header: { status_code: 200 }, body: { subtitle_list: [{ subtitle: { subtitle_body: "[01:01.79]When she was just a girl" } }] } } },
          } } } };
        }
        callback(null, { status: 200 }, JSON.stringify(data));
      } },
    });
    assert.equal(checkedSubtitle, false, "auto must not query Spotify's own lyrics upstream");
    const lyrics = JSON.parse(out.body).lyrics;
    assert.equal(lyrics.provider, "LRCLIB");
    assert.equal(lyrics.syncType, "UNSYNCED");
    assert.equal(lyrics.lines[0].words, "紅花會豪傑");
  });

  check(platform + " Spotify validates provider artist aliases by ID without a built-in name mapping", () => {
    for (const sample of [
      { wanted: "Adam Cheng", translated: "郑少秋", alias: "Adam Cheng", id: 6498, accept: true },
      { wanted: "Example Artist", translated: "示例歌手", alias: "Example Artist", id: 6498, accept: true },
      { wanted: "예시 가수", translated: "示例歌手", alias: "예시 가수", id: 6498, accept: true },
      { wanted: "Example Artist", translated: "示例歌手", alias: "Example Artist", id: 9999, accept: false },
      { wanted: "Example Artist", translated: "示例歌手", alias: "Another Artist", id: 6498, accept: false },
    ]) {
      const fetched = [];
      const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["netease", true], {
        $response: { status: 404 },
        $httpClient: { get: (request, callback) => {
          let data;
          if (request.url.includes("oembed")) data = { title: "书剑恩仇录" };
          else if (request.url.includes("/embed/track/")) {
            const entity = { id: "id", type: "track", title: "书剑恩仇录", artists: [{ name: sample.wanted }], duration: 189753 };
            callback(null, { status: 200 }, '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } }) + '</script>');
            return;
          } else if (request.url.includes("/search/get")) data = { result: { songs: [
            { id: 1, name: "书剑恩仇录", artists: [{ id: 3698, name: "罗文" }], duration: 189753 },
            { id: 194499, name: "书剑恩仇录", artists: [{ id: 6498, name: sample.translated }], duration: 189694 },
          ] } };
          else if (request.url.endsWith("/artist/3698")) data = { artist: { id: 3698, name: "罗文", alias: ["Roman Tam"] } };
          else if (request.url.endsWith("/artist/6498")) data = { artist: { id: sample.id, name: sample.translated, alias: [sample.alias] } };
          else {
            fetched.push(new URL(request.url).searchParams.get("id"));
            data = { lrc: { lyric: "[00:32.00]红花会豪杰" } };
          }
          callback(null, { status: 200 }, JSON.stringify(data));
        } },
      });
      assert.deepEqual(fetched, sample.accept ? ["194499"] : []);
      assert.equal(!!out.body, sample.accept);
      if (out.body) assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "红花会豪杰");
    }
  });

  check(platform + " Musixmatch requires a successful matching track before using subtitles", () => {
    for (const scenario of ["correct", "reversed-name", "string-zero-flags", "wrong-title", "wrong-artist", "missing-track", "failed-macro", "failed-matcher", "failed-subtitle", "instrumental", "restricted"]) {
      const out = run(platform + "/spotify/js/spotify_lyrics.js", "", "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json", ["musixmatch", true], {
        $response: { status: 404 },
        $httpClient: { get: (request, callback) => {
          let data;
          if (request.url.includes("oembed")) data = { title: "書劍恩仇錄", author_name: "Adam Cheng" };
          else if (request.url.includes("/embed/track/")) data = {};
          else if (request.url.includes("token.get")) data = { message: { body: { user_token: "anonymous&token" } } };
          else {
            const params = new URL(request.url).searchParams;
            assert.equal(params.get("track_spotify_id"), "id");
            assert.equal(params.get("subtitle_format"), "lrc");
            assert.equal(params.get("usertoken"), "anonymous&token");
            const track = { track_name: scenario === "wrong-title" ? "Paradise" : "書劍恩仇錄", artist_name: scenario === "wrong-artist" ? "Coldplay" : scenario === "reversed-name" ? "Cheng, Adam" : "Adam Cheng", track_length: 190, instrumental: scenario === "instrumental" ? 1 : "0" };
            data = { message: { header: { status_code: scenario === "failed-macro" ? 403 : 200 }, body: { macro_calls: {
              "matcher.track.get": { message: { header: { status_code: scenario === "failed-matcher" ? 404 : 200 }, body: { track: scenario === "missing-track" ? null : track } } },
              "track.subtitles.get": { message: { header: { status_code: scenario === "failed-subtitle" ? 404 : 200 }, body: { subtitle_list: [{ subtitle: { subtitle_id: 123, restricted: scenario === "restricted" ? 1 : scenario === "string-zero-flags" ? "0" : 0, subtitle_body: "[00:32.00]红花会豪杰" } }] } } },
            } } } };
          }
          callback(null, { status: 200 }, JSON.stringify(data));
        } },
      });
      assert.equal(!!out.body, ["correct", "reversed-name", "string-zero-flags"].includes(scenario), scenario);
      if (out.body) assert.equal(JSON.parse(out.body).lyrics.provider, "Musixmatch");
    }
  });
}

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " filled lyrics keep their sync type and normalize provider lines", () => {
    const file = platform + "/spotify/js/spotify_lyrics.js";
    const base = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id";
    const lines = [{ startTimeMs: "41310", words: "First", syllables: [], endTimeMs: "0" },
      { startTimeMs: "48450", words: "Second", syllables: [], endTimeMs: "0" }];
    for (const format of ["json", "protobuf"]) {
      const out = run(file, "", base + "?format=" + format, { lyrics_source: "lrclib" }, {
        $response: { status: 404, body: "" },
        $httpClient: { get: (request, callback) => {
          const data = request.url.includes("oembed") ? { title: "Song", author_name: "Artist" }
            : { trackName: "Song", artistName: "Artist", id: 123, syncedLyrics: "[00:41.310]First\n[00:48.450]Second" };
          callback(null, { status: 200 }, JSON.stringify(data));
        } },
      });
      if (format === "json") {
        const lyrics = JSON.parse(out.body).lyrics;
        assert.equal(lyrics.syncType, "LINE_SYNCED");
        assert.deepEqual(lyrics.lines, lines);
        assert.equal(lyrics.provider, "LRCLIB");
        assert.equal(lyrics.providerLyricsId, "123");
      } else {
        const lyrics = parse(first(parse(out.body), 1).p);
        assert.equal(first(lyrics, 1).v, 1n);
        const decoded = Array.from(lyrics.filter((f) => f.no === 2), (f) => {
          const line = parse(f.p);
          return { startTimeMs: String(first(line, 1).v), words: text(first(line, 2)), syllables: [], endTimeMs: "0" };
        });
        assert.deepEqual(decoded, lines);
        assert.equal(text(first(lyrics, 5)), "LRCLIB");
      }
    }
    const officialJson = JSON.stringify({ lyrics: { syncType: "LINE_SYNCED", lines } });
    const officialProto = serialize([b(1, serialize([v(1, 1), b(2, serialize([v(1, 41310), s(2, "First")])), v(14, 1)]))]);
    for (const body of [officialJson, officialProto]) {
      const out = run(file, body, base, {}, {
        $httpClient: { get: () => assert.fail("official lyrics must not query providers") },
      });
      assert.equal(Object.keys(out).length, 0, "official synchronized response must pass through");
    }
  });

}

check("Loon uses normal arguments and retains legacy mode compatibility", () => {
  const plugin = read("loon/spotify/spotify-premium.plugin");
  assert.ok(!plugin.includes("lyrics_mode"), "plugin must not expose diagnostic modes");
  const scriptRules = plugin.split("\n").filter((line) => line.includes('then script("'));
  assert.equal(scriptRules.length, 7);
  for (const line of scriptRules) {
    const version = line.includes("spotify_lyrics.js") ? "20261114-13"
      : line.includes("spotify.feed.js") ? "20261114-11" : "20261114-11";
    assert.ok(line.includes("?v=" + version));
    const tuple = /then script\("[^"]+", (\{.*\})\) with/.exec(line)[1];
    assert.match(tuple, /^\{\$\{\w+\}(?:, \$\{\w+\})*\}$/, "Loon tuple must contain only declared argument references");
    const names = [...tuple.matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]);
    for (const name of names) assert.ok(new RegExp("^" + name + " = ", "m").test(plugin));
    if (line.includes("spotify_lyrics.js")) {
      assert.deepEqual(names, ["lyrics_source", "enable_lyrics", "desktop"]);
    } else if (line.includes("spotify.feed")) {
      assert.deepEqual(names, ["spoof_premium", "block_ads", "unlock_playback", "enable_lyrics", "desktop", "lyrics_source", "prefetch"]);
    } else {
      assert.deepEqual(names, ["spoof_premium", "block_ads", "unlock_playback", "enable_lyrics", "desktop", "lyrics_source", "prefetch"]);
    }
  }
  const context = serialize([s(1, track), s(2, "uid"), b(3, serialize([s(1, "has_lyrics"), s(2, "false")]))]);
  const cards = serialize([b(1, serialize([b(1, serialize([s(2, "ordinary-card")]))]))]);
  const lyricsUrl = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id?format=json";
  for (const mode of [undefined, "full", "no_card", "metadata_only", "response_only", "card_only"]) {
    const args = [true, false, true, true, mode];
    const meta = run("loon/spotify/js/spotify.js", context, "https://spclient.wg.spotify.com/connect-state/v1/player", args);
    assert.equal(!!meta.body, [undefined, "full", "no_card", "metadata_only"].includes(mode), mode + " metadata");
    const feed = run("loon/spotify/js/spotify.feed.js", cards, scroll, args, {
      $persistentStore: lyricsStore("0VjIjW4GlUZAMYd2vXMi3b"),
    });
    assert.equal(!!feed.body, [undefined, "full", "card_only"].includes(mode), mode + " lyrics section");
    let requests = 0;
    const response = run("loon/spotify/js/spotify_lyrics.js", "", lyricsUrl, ["lrclib", true, mode], {
      $response: { status: 404, body: "" },
      $httpClient: { get: (request, callback) => {
        requests++;
        callback(null, { status: 200 }, JSON.stringify(request.url.includes("oembed") ? { title: "Song", author_name: "Artist" } : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Hello" }));
      } },
    });
    const responseOn = [undefined, "full", "no_card", "response_only"].includes(mode);
    assert.equal(!!response.body, responseOn, mode + " response");
    assert.equal(requests > 0, responseOn, mode + " HTTP calls");
    args[3] = false;
    assert.equal(Object.keys(run("loon/spotify/js/spotify.js", context, "https://spclient.wg.spotify.com/connect-state/v1/player", args)).length, 0);
    assert.equal(Object.keys(run("loon/spotify/js/spotify.feed.js", cards, scroll, args)).length, 0);
  }
});

check("Loon Premium uses the plugin's original arguments independently of lyric diagnostics", () => {
  const plugin = read("loon/spotify/spotify-premium.plugin");
  const rule = plugin.split("\n").find((line) => line.includes('tag="Spotify Premium"'));
  const tuple = /then script\("[^"]+", (\{.*\})\) with/.exec(rule)[1];
  const attributes = serialize([b(1, serialize([s(1, "type"), b(2, serialize([s(4, "free")]))]))]);
  const body = serialize([b(1, serialize([b(3, attributes)]))]);
  for (const lyrics of [true, false]) {
    const values = { spoof_premium: true, block_ads: true, unlock_playback: true, enable_lyrics: lyrics, desktop: "ios" };
    const args = [...tuple.matchAll(/\$\{(\w+)\}/g)].map((match) => values[match[1]]);
    const out = run("loon/spotify/js/spotify.js", body, "https://spclient.wg.spotify.com/user-customization-service/v1/customize", args);
    const ucs = parse(first(parse(out.body), 1).p);
    const entries = parse(first(ucs, 3).p).filter((f) => f.no === 1).map((f) => parse(f.p));
    const type = entries.find((fields) => text(first(fields, 1)) === "type");
    assert.equal(text(first(parse(first(type, 2).p), 4)), "premium");
    args[0] = false;
    assert.equal(Object.keys(run("loon/spotify/js/spotify.js", body, "https://spclient.wg.spotify.com/user-customization-service/v1/customize", args)).length, 0);
  }
});

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify keeps crossfade configurable but forces AutoMix off", () => {
    const assigned = (scope, name, on) =>
      b(3, serialize([b(1, serialize([s(1, scope), s(2, name)])), b(3, on ? serialize([v(1, 1)]) : new Uint8Array(0))]));
    const config = serialize([
      assigned("ios-feature-settings", "crossfade_enabled", true),
      assigned("core-automix", "automix_enabled", true),
      assigned("ios-feature-settings", "use_playback_settings_crossfade", false),
      assigned("ios-feature-settings", "use_playback_settings_gapless", false),
    ]);
    const args = { spoof_premium: true, block_ads: true, unlock_playback: true, enable_lyrics: false };
    const out = run(platform + "/spotify/js/spotify.js", config,
      "https://spclient.wg.spotify.com/remote-config-resolver/v3/configuration", args);
    assert.ok(out.body, platform + " must still patch the remote configuration");
    const values = {};
    for (const f of parse(out.body)) {
      if (f.no !== 3 || f.w !== 2) continue;
      const value = parse(f.p);
      const identifier = parse(first(value, 1).p);
      const name = text(first(identifier, 2));
      const bool = first(value, 3);
      const inner = bool && bool.p.length ? parse(bool.p) : [];
      values[name] = inner.some((item) => item.no === 1 && item.v === 1n);
    }
    assert.equal(values.crossfade_enabled, true, platform + " must keep the crossfade setting available");
    assert.equal(values.automix_enabled, false, platform + " must force AutoMix off");
    assert.equal(values.use_playback_settings_crossfade, true, platform + " must honour the app crossfade setting");
    assert.equal(values.use_playback_settings_gapless, true, platform);

    const attrs = serialize([
      b(1, serialize([s(1, "enable-crossfade-product-state"), b(2, serialize([s(4, "0")]))])),
      b(1, serialize([s(1, "type"), b(2, serialize([s(4, "free")]))])),
    ]);
    const ucs = serialize([b(1, serialize([b(3, attrs)]))]);
    const attrOut = run(platform + "/spotify/js/spotify.js", ucs,
      "https://spclient.wg.spotify.com/user-customization-service/v1/customize", args);
    const entries = parse(first(parse(first(parse(attrOut.body), 1).p), 3).p);
    const crossfade = entries.find((f) => {
      const entry = f.no === 1 ? parse(f.p) : null;
      return entry && text(first(entry, 1)) === "enable-crossfade-product-state";
    });
    assert.ok(crossfade, platform + " must write the crossfade capability");
    const crossfadeValue = parse(first(parse(crossfade.p), 2).p);
    assert.equal(text(first(crossfadeValue, 4)), "1",
      platform + " must keep the crossfade setting visible");
  });
}

check("Spotify desktop mode follows User-Agent and unlocks playback only on mobile", () => {
  const plugin = read("loon/spotify/spotify-premium.plugin");
  assert.ok(plugin.includes("desktop = select,auto,ios,macos"));
  assert.ok(plugin.includes("unlock_playback = select,auto,true,false"));

  const attributes = serialize([b(1, serialize([s(1, "type"), b(2, serialize([s(4, "free")]))]))]);
  const body = serialize([b(1, serialize([b(3, attributes)]))]);
  const url = "https://spclient.wg.spotify.com/user-customization-service/v1/customize";
  const macUA = "Spotify/1.2.3 CFNetwork/1490.0.4 Darwin/23.2.0";
  const iosUA = "Spotify/8.9.1 iOS/17.2 (iPhone15,2)";

  const entriesFor = (ua, desktop, unlock, extra = {}) => {
    const out = run("loon/spotify/js/spotify.js", body, url,
      { spoof_premium: true, block_ads: true, unlock_playback: unlock, enable_lyrics: false, desktop },
      { $request: { url, headers: ua ? { "User-Agent": ua } : {} }, ...extra });
    const ucs = parse(first(parse(out.body), 1).p);
    return parse(first(ucs, 3).p).filter((f) => f.no === 1).map((f) => parse(f.p));
  };
  const attribute = (entries, name) => entries.find((fields) => text(first(fields, 1)) === name);

  const iosAuto = entriesFor(iosUA, "auto", "auto");
  assert.ok(attribute(iosAuto, "player-license"), "iOS auto must keep playback authorization");
  assert.equal(text(first(parse(first(attribute(iosAuto, "type"), 2).p), 4)), "premium");

  const macAuto = entriesFor(macUA, "auto", "auto");
  assert.ok(attribute(macAuto, "type"), "macOS auto must still spoof the display state");
  assert.ok(!attribute(macAuto, "player-license"), "macOS auto must not write playback authorization");

  const defaultAuto = entriesFor(macUA, undefined, "auto");
  assert.ok(!attribute(defaultAuto, "player-license"), "an explicit desktop argument is not required");

  assert.ok(attribute(entriesFor(macUA, "auto", true), "player-license"), "explicit unlock_playback must work on macOS");
  assert.ok(attribute(entriesFor(macUA, "ios", "auto"), "player-license"), "desktop=ios must override a Mac User-Agent");
  assert.ok(!attribute(entriesFor(iosUA, "macos", "auto"), "player-license"), "desktop=macos must override an iOS User-Agent");
  assert.ok(!attribute(entriesFor("", "auto", "auto", { $loon: "Mac 3.2.0(1000)" }), "player-license"), "Loon runtime string is the UA fallback");
});

check("Spotify lyrics auto-detection picks JSON for macOS and protobuf for iOS", () => {
  const file = "loon/spotify/js/spotify_lyrics.js";
  const base = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id";
  const http = {
    get: (request, callback) => callback(null, { status: 200 },
      JSON.stringify(request.url.includes("oembed")
        ? { title: "Song", author_name: "Artist" }
        : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Hello" })),
  };
  const runLyrics = (ua, extra = {}) => run(file, "", base,
    { desktop: "auto", enable_lyrics: true },
    {
      $request: { url: base, headers: ua ? { "User-Agent": ua } : {} },
      $response: { status: 404, body: "", headers: { "Content-Type": "application/problem+json" } },
      $httpClient: http,
      ...extra,
    });

  const mac = runLyrics("Spotify/1.2.3 CFNetwork/1490.0.4 Darwin/23.2.0");
  assert.equal(typeof mac.body, "string");
  assert.match(mac.headers["Content-Type"], /json/);

  const ios = runLyrics("Spotify/8.9.1 iOS/17.2 (iPhone15,2)");
  assert.equal(typeof ios.body, "object");
  assert.match(ios.headers["Content-Type"], /protobuf/);

  const loonMac = runLyrics("", { $loon: "Mac 3.2.0(1000)" });
  assert.equal(typeof loonMac.body, "string");
});

for (const platform of ["loon", "egern", "shadowrocket"]) {
  check(platform + " Spotify lyric fallback ignores error MIME and preserves successful body format", () => {
    const file = platform + "/spotify/js/spotify_lyrics.js";
    const base = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id";
    const http = { get: (request, callback) => callback(null, { status: 200 }, JSON.stringify(request.url.includes("oembed") ? { title: "Song", author_name: "Artist" } : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Hello" })) };
    for (const desktop of [false, true]) {
      for (const type of ["application/json", "application/problem+json", "application/x-protobuf", "text/plain", ""]) {
        for (const body of ["", '{"error":"not found"}']) {
          const out = run(file, body, base, { desktop }, {
            $request: { url: base, headers: { Accept: "*/*" } },
            $response: { status: 404, body, headers: { "Content-Type": type } },
            $httpClient: http,
          });
          assert.equal(out.status, 200);
          if (typeof out.body !== (desktop ? "string" : "object")) console.log("DBG", platform, desktop, type, JSON.stringify(body), out && out.headers, out && out.body && out.body.constructor && out.body.constructor.name);
          assert.equal(typeof out.body, desktop ? "string" : "object", "404 MIME must not choose the lyric format: " + type);
          assert.match(out.headers["Content-Type"], desktop ? /json/ : /protobuf/);
          if (desktop) assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "Hello");
          else assert.equal(text(first(parse(first(parse(first(parse(out.body), 1).p), 2).p), 2)), "Hello");
        }
      }
    }
    for (const json of [false, true]) {
      const body = json ? '{"lyrics":{"lines":[]}}' : serialize([b(1, new Uint8Array())]);
      const out = run(file, body, base + (json ? "?format=protobuf" : "?format=json"), {}, {
        $response: { status: 200, body }, $httpClient: http,
      });
      assert.equal(typeof out.body, json ? "string" : "object", "successful empty lyrics must retain their body format");
    }
  });

  check(platform + " Spotify missing lyrics follows the requested format rather than the 404 error body", () => {
    const file = platform + "/spotify/js/spotify_lyrics.js";
    const base = "https://spclient.wg.spotify.com/color-lyrics/v2/track/id";
    const http = { get: (request, callback) => callback(null, { status: 200 }, JSON.stringify(request.url.includes("oembed") ? { title: "Song", author_name: "Artist" } : { trackName: "Song", artistName: "Artist", syncedLyrics: "[00:01.00]Hello\n[00:02.00]World" })) };
    for (const sample of [
      { query: "", accept: "application/json", type: "text/plain", error: "" },
      { query: "?format=json", accept: "*/*", type: "text/plain", error: "Not found" },
      { query: "?format=protobuf", accept: "*/*", type: "application/json", error: '{"error":"not found"}' },
      { query: "", accept: "application/x-protobuf", type: "application/json", error: '{"error":"not found"}' },
    ]) {
      const out = run(file, sample.error, base + sample.query, {}, {
        $request: { url: base + sample.query, headers: { Accept: sample.accept } },
        $response: { status: 404, body: sample.error, headers: { "Content-Type": sample.type } },
        $httpClient: http,
      });
      const json = sample.query.includes("json") || sample.accept.includes("json");
      assert.equal(typeof out.body, json ? "string" : "object");
      if (json) assert.equal(JSON.parse(out.body).lyrics.lines[0].words, "Hello");
      else {
        const lyrics = parse(first(parse(out.body), 1).p);
        const lines = lyrics.filter((f) => f.no === 2).map((f) => parse(f.p));
        assert.equal(lines.length, 2);
        assert.equal(first(lines[0], 1).v, 1000n);
        assert.equal(text(first(lines[0], 2)), "Hello");
      }
    }
    assert.equal(Object.keys(run(file, "denied", base, {}, { $response: { status: 403, body: "denied" },
      $httpClient: { get: () => assert.fail("authorization failures must pass through") } })).length, 0);
  });
}

check("Spotify metadata requires a declared Track type before changing extension data", () => {
  const file = "loon/spotify/js/spotify.js";
  const url = "https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata";
  const payload = serialize([v(18, 0), v(90, 18446744073709551615n)]);
  const extension = (type) => serialize([b(1, serialize([v(2, 1), b(3, serialize([
    s(2, track), b(3, serialize([...(type ? [s(1, type)] : []), b(2, payload)])),
  ]))]))]);
  for (const type of [null, "type.googleapis.com/spotify.metadata.Album", "type.googleapis.com/spotify.metadata.TrackDescriptor"]) {
    assert.equal(Object.keys(run(file, extension(type), url)).length, 0);
  }
  const out = parse(run(file, extension("type.googleapis.com/spotify.metadata.Track"), url).body);
  const array = parse(first(out, 1).p);
  const entity = parse(first(array, 3).p);
  const any = parse(first(entity, 3).p);
  const patched = parse(first(any, 2).p);
  assert.equal(first(patched, 18).v, 1n);
  assert.equal(first(patched, 90).v, 18446744073709551615n);
});

check("Spotify extended-metadata skips large non-track blobs without losing has_lyrics", () => {
  const file = "loon/spotify/js/spotify.js";
  const url = "https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata";
  const payload = serialize([v(18, 0n), v(90, 123n)]);
  const extension = serialize([b(1, serialize([v(2, 1n), b(3, serialize([
    s(2, track), b(3, serialize([s(1, "type.googleapis.com/spotify.metadata.Track"), b(2, payload)])),
  ]))]))]);
  // 256KB 的非曲目扩展数据（图片 / Credits 等）没有 spotify:track: 标记，
  // 不应该被整块 parse；曲目数组仍要正常补 has_lyrics。
  const arrayField = first(parse(extension), 1);
  const body = serialize([b(1, arrayField.p), b(9, new Uint8Array(256 * 1024).fill(65))]);
  const out = parse(run(file, body, url).body);
  const array = parse(first(out, 1).p);
  const entity = parse(first(array, 3).p);
  const any = parse(first(entity, 3).p);
  const patched = parse(first(any, 2).p);
  assert.equal(first(patched, 18).v, 1n);
});

check("Spotify UCS rejects a configuration message at the expected wrapper path", () => {
  const assigned = serialize([b(1, serialize([s(1, "scope"), s(2, "switch")])), b(3, serialize([v(1, 1)]))]);
  const unexpected = serialize([b(1, serialize([b(3, assigned)]))]);
  assert.equal(Object.keys(run("loon/spotify/js/spotify.js", unexpected, "https://spclient.wg.spotify.com/ucs/v0/customize")).length, 0);
});

check("Spotify preserves noncanonical nested metadata, UCS wrappers and feed fields", () => {
  const noncanonical = new Uint8Array([0xd0, 5, 0x81, 0]);
  const url = "https://spclient.wg.spotify.com/ucs/v0/customize";
  const attributes = serialize([b(1, serialize([s(1, "ads"), b(2, serialize([v(2, 1)]))]))]);
  const ucs = serialize([b(3, attributes)]);
  const file = "loon/spotify/js/spotify.js";
  assert.ok(run(file, serialize([b(1, ucs)]), url).body, "valid UCS must still patch");
  assert.equal(Object.keys(run(file, concat(noncanonical, serialize([b(1, ucs)])), url)).length, 0);
  const inner = concat(noncanonical, serialize([b(30, new Uint8Array([1, 2, 3]))]));
  assert.equal(Object.keys(run("loon/spotify/js/spotify.feed.js", serialize([b(2, inner)]), scroll, { enable_lyrics: false })).length, 0);
});

check("Spotify deadline prevents late HTTP callbacks from launching more requests", () => {
  let timeout;
  let reply;
  let requests = 0;
  let calls = 0;
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
    $request: { url: "https://spclient.wg.spotify.com/color-lyrics/v2/track/id" }, $response: { status: 404 },
    setTimeout: (fn) => { timeout = fn; return 1; }, clearTimeout() {}, $done: () => calls++,
    $httpClient: { get: (request, callback) => { requests++; reply = callback; } } });
  vm.runInContext(read("loon/spotify/js/spotify_lyrics.js"), context);
  timeout();
  reply(null, { status: 200 }, JSON.stringify({ title: "Late song" }));
  assert.equal(requests, 1);
  assert.equal(calls, 1);
});

check("Spotify config: wildcard rule order, disabled features and parsed-node reuse", () => {
  const rules = [
    ["", "switch", 2, 1, "", "misc"],
    ["scope", "", 2, 0, "", "misc"],
    ["scope", "switch", 2, 1, "", "ad"],
    ["scope", "remove", 0, 0, "", "cap"],
  ];
  const entry = (name) => b(3, serialize([b(1, serialize([s(1, "scope"), s(2, name)])), b(3, serialize([v(1, 1)]))]));
  const body = serialize([entry("switch"), entry("remove"), v(99, 18446744073709551615n)]);
  for (const enabled of [true, false]) {
    const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, RULES: rules, adsOn: enabled, playOn: enabled });
    vm.runInContext(read("src/proto/wire.js") + read("src/spotify/core/protobuf.js") + read("src/spotify/premium/config.js") + "\nglobalThis.patch = patchConfigurationResponse;", context);
    const out = parse(context.patch(body));
    const entries = out.filter((f) => f.no === 3).map((f) => parse(f.p));
    assert.equal(entries.length, enabled ? 1 : 2);
    assert.equal(first(entries[0], 3).p.length, enabled ? 2 : 0);
    assert.equal(first(out, 99).v, 18446744073709551615n);
  }
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array });
  vm.runInContext(read("src/proto/wire.js") + read("src/spotify/core/options.js") + read("src/spotify/core/protobuf.js") + read("src/spotify/premium/rules.js") + read("src/spotify/premium/config.js") +
    "\nlet count = 0; const originalParse = parse; parse = (b) => { count++; return originalParse(b); }; globalThis.measure = (b) => { count = 0; patchConfigurationResponse(b); return count; };", context);
  const unmodified = serialize(Array.from({ length: 100 }, (_, i) => entry("unknown-" + i)));
  assert.equal(context.measure(unmodified), 201, "one outer parse + identifier/value parse per entry");
});

check("Tubi SRT keeps translation positions across empty cues", () => {
  const body = "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:03,000\n\n3\n00:00:03,000 --> 00:00:04,000\nWorld\n";
  const out = run("loon/tubi/js/tubi_caption.js", body, "https://cdn.adrise.tv/en.srt?tlang=zh-Hans", { caption_lang: "zh-Hans" }, {
    $httpClient: { post: (request, callback) => callback(null, { status: 200 }, JSON.stringify([{ translations: [{ text: "你好" }] }, { translations: [{ text: "世界" }] }])) },
  }).body;
  assert.ok(out.includes("Hello\n你好"));
  assert.ok(out.includes("World\n世界"));
  assert.ok(!out.includes("undefined"));
});

// AMap Clean：JSON 广告清理的三端回归。
for (const platform of ["loon", "egern", "shadowrocket"]) {
  const file = platform + "/amap/js/amap_clean.js";
  const base = "https://m5.amap.com";

  check(platform + " amap main-page: removes ad cards and keeps normal cards", () => {
    const body = JSON.stringify({
      data: {
        cardList: {
          a: { dataType: "LoginCard" },
          b: { dataType: "FrequentLocation" },
          c: { dataType: "AdCard" },
          d: { dataType: "WeatherCard" },
        },
        mapBizList: [{ id: 1 }],
        business_position: [{ id: 2 }],
        pull3: { msgs: [{ id: 3 }] },
      },
    });
    const out = run(file, body, base + "/ws/faas/amap-navigation/main-page?x=1");
    const data = JSON.parse(out.body).data;
    assert.deepEqual(data.cardList, { a: { dataType: "LoginCard" }, b: { dataType: "FrequentLocation" }, d: { dataType: "WeatherCard" } });
    assert.deepEqual(data.mapBizList, []);
    assert.deepEqual(data.business_position, []);
    assert.deepEqual(data.pull3.msgs, []);
  });

  check(platform + " amap profile: removes tips, friend feed, guess-you-like and ad cards", () => {
    const body = JSON.stringify({
      data: {
        tipData: { text: "ad" },
        cardList: [
          { dataType: "MyOrderCard" },
          { dataType: "GdRecommendCard" },
          { dataType: "CouponCard" },
          { dataType: "SettingCard" },
          { dataType: "AdBanner" },
          { dataType: "FriendFeedCard" },
          { dataType: "GuessYouLikeCard" },
          { dataType: "CommonCard", data: { title: "好友动态" } },
        ],
      },
    });
    const out = run(file, body, base + "/ws/shield/dsp/profile/index/nodefaas");
    const data = JSON.parse(out.body).data;
    assert.equal(data.tipData, undefined);
    assert.deepEqual(data.cardList.map((card) => card.dataType), ["MyOrderCard", "SettingCard"]);

    // 对象形状的 cardList 也要能过滤，并且保持对象形状回写。
    const objectShape = run(file, JSON.stringify({ data: { cardList: { a: { dataType: "MyOrderCard" }, b: { dataType: "GdRecommendCard" } } } }), base + "/ws/shield/dsp/profile/index/nodefaas");
    assert.deepEqual(JSON.parse(objectShape.body).data.cardList, { a: { dataType: "MyOrderCard" } });

    // 17.3 的真实路径，卡片按 UserCenter* 命名。
    const homeV2 = run(file, JSON.stringify({
      data: {
        tipData: { text: "ad" },
        cardList: [
          { dataType: "UserCenterNearbyCard" },
          { dataType: "UserCenterInteractCard" },
          { dataType: "UserCenterMemberVideoCard" },
          { dataType: "UserCenterGrowthTaskCard" },
          { dataType: "UserCenterRightCard" },
        ],
      },
    }), base + "/ws/faas/amap-navigation/usr-profile-fc/homeV2?x=1");
    assert.deepEqual(JSON.parse(homeV2.body).data.cardList.map((card) => card.dataType), ["UserCenterGrowthTaskCard", "UserCenterRightCard"]);

    // 卡片换了键名 / 藏在楼层里时，递归扫描也要能删掉。
    const nested = run(file, JSON.stringify({
      data: { sections: [{ cards: [{ dataType: "UserCenterRightCard" }, { dataType: "UserCenterInteractCard" }] }] },
    }), base + "/ws/faas/amap-navigation/usr-profile-fc/homeV2");
    assert.deepEqual(JSON.parse(nested.body).data.sections[0].cards.map((card) => card.dataType), ["UserCenterRightCard"]);

    // 整页都是广告卡时不要清空，否则客户端会弹「网络不畅」。
    const allAds = run(file, JSON.stringify({ data: { cardList: [{ dataType: "GdRecommendCard" }] } }), base + "/ws/faas/amap-navigation/usr-profile-fc/homeV2");
    assert.deepEqual(Object.keys(allAds), []);
  });

  check(platform + " amap ai_rec: strips explore feed modules from the SSE stream", () => {
    // 探索 tab 是 SSE，每个事件里的 modules / regions.content 要一起删，
    // 否则名字留在渲染表里、数据没了，客户端会渲染空白块。
    const ev = (modules, regions, extra) => "event: data\ndata: " + JSON.stringify(Object.assign({
      is_done: false,
      component: { data: { data: { modules, regions: { content: regions } } } },
    }, extra || {})) + "\n\n";
    const stream = ev(
      { MdCard_Explore_0: { data: {} }, AiMapPoints: { data: { list: [{ id: "B1" }] } }, AiCardContainer_0: { data: {} } },
      ["MdCard_Explore_0", "AiCardContainer_0", "AiMapPoints", "FeedTab"]
    ) + ev({}, [], { is_done: true });
    const out = run(file, stream, "https://ai.amap.com/v1/ai_rec/home_explore?csid=1");
    const first = JSON.parse(out.body.split("\n")[1].slice(6));
    const node = first.component.data.data;
    assert.deepEqual(Object.keys(node.modules), ["AiMapPoints"]);
    assert.deepEqual(node.regions.content, ["AiMapPoints", "FeedTab"]);
    // 结束事件没有要删的东西，原样保留（is_done 不能丢）。
    assert.ok(out.body.includes("\"is_done\":true"));
  });

  check(platform + " amap ai_rec: passes clean streams and non-SSE bodies through", () => {
    // 没有推荐模块的流不改。
    const clean = "event: data\ndata: {\"is_done\":true,\"component\":{\"data\":{\"data\":{\"modules\":{},\"regions\":{\"content\":[]}}}}}\n\n";
    assert.deepEqual(Object.keys(run(file, clean, "https://ai.amap.com/v1/ai_rec/home_explore")), []);
    // data: 后面没空格、JSON 坏掉的都要原样放行。
    assert.deepEqual(Object.keys(run(file, "data:{bad\n\n", "https://ai.amap.com/v1/ai_rec/home_explore")), []);
  });

  check(platform + " amap splash: expires creative window", () => {
    const body = JSON.stringify({ data: { ad: [{ setting: { display_time: 5 }, creative: [{ start_time: 1, end_time: 2 }] }] } });
    const out = run(file, body, base + "/ws/valueadded/alimama/splash_screen?x=1");
    const ad = JSON.parse(out.body).data.ad[0];
    assert.equal(ad.setting.display_time, 0);
    assert.equal(ad.creative[0].start_time, 2240141184);
    assert.equal(ad.creative[0].end_time, 2240141184);
  });

  check(platform + " amap msgbox: clears both message lists", () => {
    const body = JSON.stringify({ msgs: [{ id: 1 }], pull3: { msgs: [{ id: 2 }] } });
    const out = run(file, body, "https://sns.amap.com/ws/msgbox/pull?x=1");
    const data = JSON.parse(out.body);
    assert.deepEqual(data.msgs, []);
    assert.deepEqual(data.pull3.msgs, []);
  });

  check(platform + " amap search hotword / promotion resource / nearby", () => {
    const hot = run(file, JSON.stringify({ data: { header_hotword: [{ text: "x" }] } }), base + "/ws/shield/search/new_hotword");
    assert.deepEqual(JSON.parse(hot.body).data.header_hotword, []);

    // 清空时保持容器类型：对象位回 {}，不能回 []，否则客户端解码失败弹「网络不畅」。
    const promo = run(file, JSON.stringify({ data: { icon: [1], banner: { a: 1 }, tips: [3], popup: [4], bubble: [5], other: [6] } }), "https://dache.amap.com/ws/promotion-web/resource");
    const promoData = JSON.parse(promo.body).data;
    assert.deepEqual(promoData, { icon: [], banner: {}, tips: [], popup: [], bubble: [], other: [] });

    const nearby = run(file, JSON.stringify({
      data: { coupon: {}, scene: {}, activity: {}, commodity_rec: {}, operation_activity: {}, modules: ["coupon", "shop", "activity"] },
    }), base + "/ws/shield/search/nearbyrec_smart");
    const nearbyData = JSON.parse(nearby.body).data;
    assert.deepEqual(nearbyData, { modules: ["shop"] });
  });

  check(platform + " amap aocs: deletes ad keys and strips taxi / navi / basemap marketing", () => {
    const taxi = JSON.stringify({
      banner_picture_url: "https://x/banner.jpg",
      dache_toolbox_marketing: { name: "福利中心" },
      dache_toolbox_promo: { name: "promo" },
      carpool_city: { banner_url: "https://x/city.jpg" },
      isUseChauffeurNewMarketingSlot: 1,
      recommend_point_optimization: 1,
      taxi_ordering_redesign: 1,
      shop_url: "https://x/?shopId=1502690485048451072",
    });
    const navi = JSON.stringify({ ETCGuide: { on: 1 }, music_config: { x: 1 }, end_auto_foot_explore: 1, ExtremelyRecommendCount: 8, normal_navi: 1 });
    const sports = JSON.stringify({ sports_data: 1, explore: 1, banner_list: [{ imgUrl: "https://x/banner.jpg" }] });
    const basemap = JSON.stringify({
      splash: { interval: 60, maxShowTimePerDay: 4 },
      ai_splash: { duration: 1000 },
      mainBubble: { interval: 3600 },
      usercenter_performance_optimization: {
        home_api_url: "/ws/faas/amap-navigation/usr-profile-fc/homeV2",
        timeout: 604800000,
      },
      keep_me: 1,
    });
    const naviEnd = JSON.stringify({ navi_end_advertisement: 150, collect_oil: 1, operator_btns: [{ name: "collect_oil" }], arrivedViaConfirmTime: 12 });
    const body = JSON.stringify({
      data: {
        gd_notch_logo: { value: "x" },
        routeresult_banner: { value: "{\"resource_truck_2\":{}}" },
        taxi_activity: { value: "{\"x\":1}" },
        TrainOrderBanner: { value: "{\"x\":1}" },
        EndNaviC3AdCard: { value: "{\"x\":1}" },
        homepage_resource_config: { value: "{\"yunyingqipao\":1}" },
        splashscreen: { status: 1, version: "v", value: "{}" },
        taxi: { status: 1, version: "v", value: taxi },
        navi_cloud: { status: 1, version: "v", value: navi },
        sportsHomeConfig: { status: 1, version: "v", value: sports },
        amap_basemap_config: { status: 1, version: "v", value: basemap },
        navi_end: { status: 1, version: "v", value: naviEnd },
        normal_key: { value: "keep" },
      },
    });
    const out = run(file, body, base + "/ws/shield/frogserver/aocs/updatable");
    const data = JSON.parse(out.body).data;
    // 整个 key 删掉，客户端拿不到就当没配置。
    for (const key of ["taxi_activity", "TrainOrderBanner", "EndNaviC3AdCard", "homepage_resource_config", "splashscreen"]) {
      assert.equal(data[key], undefined, key + " should be deleted");
    }
    // 前缀型 key 只置空：整包少一个 key，客户端可能当成配置不完整。
    for (const key of ["gd_notch_logo", "routeresult_banner"]) {
      assert.deepEqual(data[key], { status: 1, version: "", value: "" });
    }
    const t = JSON.parse(data.taxi.value);
    for (const key of ["banner_picture_url", "dache_toolbox_marketing", "dache_toolbox_promo", "carpool_city", "isUseChauffeurNewMarketingSlot"]) {
      assert.equal(t[key], undefined, key);
    }
    assert.equal(t.recommend_point_optimization, 0);
    assert.equal(t.taxi_ordering_redesign, 1);
    assert.ok(t.shop_url.includes("1502690485048451072"));
    const n = JSON.parse(data.navi_cloud.value);
    assert.equal(n.ETCGuide, undefined);
    assert.equal(n.music_config, undefined);
    assert.equal(n.end_auto_foot_explore, 0);
    assert.equal(n.ExtremelyRecommendCount, 0);
    assert.equal(n.normal_navi, 1);
    const s = JSON.parse(data.sportsHomeConfig.value);
    assert.equal(s.banner_list, undefined);
    assert.equal(s.sports_data, 1);
    const bm = JSON.parse(data.amap_basemap_config.value);
    assert.equal(bm.splash, undefined);
    assert.equal(bm.ai_splash, undefined);
    assert.equal(bm.mainBubble, undefined);
    assert.equal(bm.keep_me, 1);
    // 「我的」页 7 天缓存归零，让 nodefaasv3 每次都重新请求。
    assert.equal(bm.usercenter_performance_optimization.timeout, 0);
    assert.equal(bm.usercenter_performance_optimization.home_api_url, "/ws/faas/amap-navigation/usr-profile-fc/homeV2");
    const ne = JSON.parse(data.navi_end.value);
    assert.equal(ne.navi_end_advertisement, 0);
    assert.equal(ne.collect_oil, 0);
    assert.equal(ne.operator_btns, undefined);
    assert.equal(ne.arrivedViaConfirmTime, 12);
    assert.deepEqual(data.normal_key, { value: "keep" });
  });

  check(platform + " amap profile v3: keeps footprint and narrows the entrance card", () => {
    const body = JSON.stringify({
      data: {
        tipData: { text: "ad" },
        wallet: { x: 1 },
        cardList: [
          { dataKey: "MineNewFootprintCard", content: {} },
          { dataKey: "MineNewBEntranceCardV4", content: {
            entranceList_1: [{ id: 7 }, { id: 99 }],
            entranceList_2: [{ id: 32 }, { id: 1 }],
          } },
          { dataKey: "MineNewNearbyCard" },
          { dataKey: "MineNewInteractCard" },
        ],
      },
    });
    const out = run(file, body, base + "/ws/shield/dsp/profile/index/nodefaasv3");
    const data = JSON.parse(out.body).data;
    assert.equal(data.tipData, undefined);
    assert.equal(data.wallet, undefined);
    assert.deepEqual(data.cardList.map((c) => c.dataKey), ["MineNewFootprintCard", "MineNewBEntranceCardV4"]);
    assert.deepEqual(data.cardList[1].content.entranceList_1, [{ id: 7 }]);
    assert.deepEqual(data.cardList[1].content.entranceList_2, [{ id: 32 }]);
  });

  check(platform + " amap unknown feed: drops guess-you-like cards by their text", () => {
    // 登录后「我的」页换了一套接口下发「猜你喜欢」，路径不固定。
    // 兜底逻辑按文案扫整棵树，删掉广告 / 推荐卡，正常卡片保留。
    const body = JSON.stringify({
      data: { modules: [
        { title: "猜你喜欢", dataType: "FeedCard" },
        { title: "我的订单", dataType: "OrderCard" },
        { title: "好友动态", dataType: "FeedCard" },
      ] },
    });
    const out = run(file, body, "https://m5.amap.com/ws/shield/dsp/app/startup/init?ent=2");
    assert.deepEqual(JSON.parse(out.body).data.modules, [{ title: "我的订单", dataType: "OrderCard" }]);
  });

  check(platform + " amap taxi content_info: drops skin / popup and trims the toolbox", () => {
    const body = JSON.stringify({
      data: {
        lubanData: {
          skin: { img: "x" },
          popup: { text: "ad" },
          kingToolBoxBubble: { text: "ad" },
          kingToolSort: { dataList: [
            { biz: { kingToolIdList: ["dache_toolbox_GDIntercity", "dache_toolbox_coupon"] } },
          ] },
          kingToolBox: { dataList: [
            { biz: { id: "dache_toolbox_hitch" } },
            { biz: { id: "dache_toolbox_coupon" } },
          ] },
        },
      },
    });
    const out = run(file, body, "https://m5-zb.amap.com/ws/boss/car/order/content_info?ent=2");
    const luban = JSON.parse(out.body).data.lubanData;
    assert.equal(luban.skin, undefined);
    assert.equal(luban.popup, undefined);
    assert.equal(luban.kingToolBoxBubble, undefined);
    assert.deepEqual(luban.kingToolSort.dataList[0].biz.kingToolIdList, ["dache_toolbox_GDIntercity"]);
    assert.deepEqual(luban.kingToolBox.dataList.map((x) => x.biz.id), ["dache_toolbox_hitch"]);
  });

  check(platform + " amap scene/recommend: keeps search skeleton and trims tool cards", () => {
    const body = JSON.stringify({
      data: {
        shadingWords: { data: {
          regions: { content: ["quickLink", "history", "searchFind", "hotRank", "adCard"] },
          modules: { quickLink: {}, history: {}, searchFind: {}, hotRank: {} },
        } },
        toolsRecommend: { data: { default: [{ id: 102 }, { id: 999 }] } },
      },
    });
    const out = run(file, body, base + "/ws/shield/scene/recommend?ent=2");
    const data = JSON.parse(out.body).data;
    assert.deepEqual(data.shadingWords.data.regions.content, ["quickLink", "history", "searchFind"]);
    assert.deepEqual(Object.keys(data.shadingWords.data.modules), ["searchFind"]);
    assert.deepEqual(data.toolsRecommend.data.default, [{ id: 102 }]);
  });

  check(platform + " amap misc: raise_list / near_recommend / opc tools / sug / af-search", () => {
    const raise = run(file, JSON.stringify({ data: { dataList: [{ categoryId: 1 }, { data: { id: "M_100007" } }, { data: { id: "X" } }] } }), "https://center.amap.com/ws/amc/server/conv/raise_list?ent=2");
    assert.equal(JSON.parse(raise.body).data.dataList.length, 2);

    const near = run(file, JSON.stringify({ data: { operation_activity: { x: 1 }, list: [1] } }), base + "/ws/smartui/near_recommend?ent=2");
    assert.equal(JSON.parse(near.body).data.operation_activity, undefined);
    assert.deepEqual(JSON.parse(near.body).data.list, [1]);

    const tools = run(file, JSON.stringify({ data: { category: [{ tools: [{ id: "547", tips: "ad" }, { id: "548", tips: "x" }] }] } }), "https://sns.amap.com/ws/opc/tools/list?ent=2");
    assert.deepEqual(JSON.parse(tools.body).data.category[0].tools, [{ id: "548" }]);

    const sug = run(file, JSON.stringify({ data: { tip_list: [{ tip: { task_tag: "sp" } }, { tip: { task_tag: "other" } }, { tip: { task_tag: "common_content_general" } }] } }), "https://info.amap.com/ws/shield/search_business/process/middleLayer/sug?ent=2");
    assert.equal(JSON.parse(sug.body).data.tip_list.length, 2);

    const af = run(file, JSON.stringify({ data: { modules: { quickLink: { data: { list: [{ badge: { text: "HOT" } }, { badge: {} }] } } } } }), "https://info.amap.com/ws/c3frontend/af-search/search?ent=2");
    assert.equal(JSON.parse(af.body).data.modules.quickLink.data.list[0].badge.text, "");
  });

  check(platform + " amap passes through unknown, malformed, long-number and non-JSON bodies", () => {
    assert.deepEqual(Object.keys(run(file, JSON.stringify({ data: {} }), base + "/ws/other")), []);
    assert.deepEqual(Object.keys(run(file, "{bad", base + "/ws/faas/amap-navigation/main-page")), []);
    assert.deepEqual(Object.keys(run(file, "{\"order_id\":123456789012345678}", base + "/ws/shield/dsp/profile/index/nodefaas")), []);
    assert.deepEqual(Object.keys(run(file, "<html></html>", base + "/ws/msgbox/pull")), []);
  });
}

for (const platform of ["loon", "egern", "shadowrocket"]) {
  const file = platform + "/xiaohongshu/js/xiaohongshu_clean.js";
  const base = "https://edith.xiaohongshu.com/api/sns/v10";

  check(platform + " xhs strips homefeed ads and keeps other cards", () => {
    const res = run(file, JSON.stringify({ success: true, data: [
      { id: "n1", model_type: "note", is_ads: false },
      { id: "ad1", model_type: "note", is_ads: true },
      { id: "q1", model_type: "rec_query" },
    ] }), base + "/homefeed?num=20");
    const list = JSON.parse(res.body).data;
    assert.deepEqual(list.map((x) => x.id), ["n1", "q1"]);
  });

  check(platform + " xhs strips search ads and comment ads", () => {
    const search = run(file, JSON.stringify({ data: { items: [
      { id: "s1", ads: false }, { id: "s2", ads: true },
    ], has_more: true } }), base + "/search/notes?keyword=x");
    const out = JSON.parse(search.body).data;
    assert.deepEqual(out.items.map((x) => x.id), ["s1"]);
    assert.equal(out.has_more, true);

    const comment = run(file, JSON.stringify({ data: { comments: [
      { id: "c1", content: "ok" },
      { id: "c2", content: "ad", show_tags: ["is_ads"] },
      { id: "c3", sub_comments: [{ id: "s1" }, { id: "s2", show_tags: ["is_ads"] }] },
    ], has_more: true } }), base + "/note/comment/list?note_id=1");
    const c = JSON.parse(comment.body).data;
    assert.deepEqual(c.comments.map((x) => x.id), ["c1", "c3"]);
    assert.deepEqual(c.comments[1].sub_comments.map((x) => x.id), ["s1"]);
  });

  check(platform + " xhs reschedules splash and trims startup config", () => {
    const splash = run(file, JSON.stringify({ data: { ads_groups: [
      { start_time: "1", end_time: "2", ads: [{ start_time: "1", end_time: "2" }] },
    ] } }), base + "/system_service/splash_config");
    const g = JSON.parse(splash.body).data.ads_groups[0];
    assert.equal(g.start_time, "2208963661");
    assert.equal(g.end_time, "2209050061");
    assert.equal(g.ads[0].start_time, "2208963661");

    const conf = run(file, JSON.stringify({ data: {
      splash: {}, loading_img: "x", app_theme: {}, cmt_words: [], highlight_tab: [], store: {}, keep: 1,
    } }), base + "/system_service/config?");
    const d = JSON.parse(conf.body).data;
    assert.equal(d.splash, undefined);
    assert.equal(d.loading_img, undefined);
    assert.deepEqual(d.store, {}, "store 由 clean_ui 控制，默认保留");
    assert.equal(d.keep, 1);
  });

  check(platform + " xhs keeps pages intact instead of emptying them", () => {
    assert.deepEqual(Object.keys(run(file, JSON.stringify({ data: [{ id: "a", is_ads: true }] }), base + "/homefeed?x=1")), []);
    assert.deepEqual(Object.keys(run(file, JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), base + "/homefeed?x=1")), []);
    assert.deepEqual(Object.keys(run(file, JSON.stringify({ data: { comments: [{ show_tags: ["is_ads"] }] } }), base + "/note/comment/list")), []);
    assert.deepEqual(Object.keys(run(file, "{bad", base + "/homefeed")), []);
    assert.deepEqual(Object.keys(run(file, JSON.stringify({ data: [{ is_ads: true }] }), base + "/user/me")), []);
  });
}

// B 站 gRPC：按字段号删广告，没改动的字段连同原始编码一起保留。
function testBilibiliGrpc() {
  const frame = (msg, flag = 0) => {
    const head = new Uint8Array(5);
    head[0] = flag;
    new DataView(head.buffer).setUint32(1, msg.length);
    return concat(head, msg);
  };
  const pending = [];
  for (const platform of ["loon", "egern", "shadowrocket"]) {
    const file = platform + "/bilibili/js/bilibili_grpc.js";
    const send = (method, msg, argument = { block_ads: true }) =>
      run(file, frame(msg), "https://grpc.biliapi.net" + method, argument).body;

    check(platform + " bilibili grpc strips view ads and keeps organic bytes", () => {
      const relateAd = serialize([s(7, "cm"), s(2, "ad title")]);
      const relateOk = serialize([s(7, "av"), s(2, "normal")]);
      const msg = serialize([b(10, relateAd), b(10, relateOk), s(30, "cms"), s(31, "cfg"),
        s(34, "tf"), s(41, "ipad"), s(48, "under"), v(99, 7n)]);
      assert.deepEqual(send("/bilibili.app.view.v1.View/View", msg), frame(serialize([b(10, relateOk), v(99, 7n)])));
    });

    check(platform + " bilibili grpc strips viewunite cm and promo modules", () => {
      assert.deepEqual(send("/bilibili.app.viewunite.v1.View/View", serialize([v(7, 1n), v(3, 42n)])), frame(serialize([v(3, 42n)])));

      const promo = serialize([v(1, 18n)]);
      const normal = serialize([v(1, 28n)]);
      const tab = serialize([b(1, serialize([b(2, serialize([b(2, promo), b(2, normal)]))]))]);
      assert.deepEqual(send("/bilibili.app.viewunite.v1.View/View", serialize([b(5, tab)])),
        frame(serialize([b(5, serialize([b(1, serialize([b(2, serialize([b(2, normal)]))]))]))])));
    });

    check(platform + " bilibili grpc strips dynamic ads and reply ads", () => {
      const ad = serialize([v(1, 15n), s(2, "ad")]);
      const ok = serialize([v(1, 1n), s(2, "normal")]);
      assert.deepEqual(send("/bilibili.app.dynamic.v2.Dynamic/DynAll", serialize([b(1, serialize([b(1, ad), b(1, ok)]))])),
        frame(serialize([b(1, serialize([b(1, ok)]))])));

      const msg = serialize([s(11, "x"), b(28, serialize([v(1, 3n)])), b(28, serialize([v(1, 1n)])),
        s(4, "看这个 b23.tv/cm/abc"), s(4, "普通评论")]);
      assert.deepEqual(send("/bilibili.main.community.reply.v1.Reply/MainList", msg),
        frame(serialize([b(28, serialize([v(1, 1n)])), s(4, "普通评论")])));
    });

    check(platform + " bilibili grpc passes through clean, unknown and broken frames", () => {
      const base = "https://grpc.biliapi.net";
      const view = base + "/bilibili.app.view.v1.View/View";
      assert.deepEqual(Object.keys(run(file, frame(serialize([v(99, 1n)])), view, { block_ads: true })), []);
      assert.deepEqual(Object.keys(run(file, frame(serialize([v(30, 1n)])), view, { block_ads: false })), []);
      assert.deepEqual(Object.keys(run(file, frame(serialize([v(30, 1n)])), base + "/bilibili.app.view.v1.View/Unknown", { block_ads: true })), []);
      assert.deepEqual(Object.keys(run(file, new Uint8Array([1, 2, 3]), view, { block_ads: true })), []);
    });

    // gzip 帧要 await 解压，$done 落在微任务里，得单独等一拍。
    pending.push((async () => {
      const body = frame(serialize([v(30, 1n)]), 1);
      const url = "https://grpc.biliapi.net/bilibili.app.view.v1.View/View";
      if (platform === "egern") {
        const out = await runEgernAsync(file, body, url, { block_ads: true });
        assert.deepEqual(Object.keys(out || {}), [], "an undecompressable frame must pass through");
      } else {
        const calls = [];
        const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console,
          $request: { url }, $response: { status: 200, body }, $argument: { block_ads: true }, $done: (value) => calls.push(value) });
        vm.runInContext(read(file), context, { timeout: 10000 });
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(calls.length, 1, file + " must finish once");
        assert.deepEqual(Object.keys(calls[0]), [], "an undecompressable frame must pass through");
      }
      checks++;
      console.log("ok   " + platform + " bilibili grpc passes through gzip frames it cannot open");
    })());
  }
  return Promise.all(pending);
}

async function testUmp() {
  const context = vm.createContext({ Uint8Array, Uint32Array, Uint16Array, TextEncoder, TextDecoder,
    EAGER_TYPES: { ump: {} }, bytesEqual: (a, c) => Buffer.from(a).equals(Buffer.from(c)),
    concatBytes: (parts) => concat(...parts), parseFields: () => [{ no: 1, wire: 0, data: new Uint8Array([25]) }],
    readVarintValue: () => 25, rewritePlayer: () => false, filterBrowseTree: () => false });
  vm.runInContext(read("src/youtube/response/ump.js") + "\nglobalThis.ump = { createUmpCrypto, decryptUmp, UmpWriter };", context);
  const { createUmpCrypto, decryptUmp, UmpWriter } = context.ump;
  const key = new Uint8Array(32).fill(7);
  const crypto = new (createUmpCrypto().CryptoContext)(key);
  crypto.iv = new Uint8Array(16).fill(3);
  const payload = new Uint8Array([10, 0]);
  const encrypted = crypto.encrypt(payload);
  const envelope = { ...encrypted, iv: crypto.iv, compressionAlgorithm: 0 };
  context.messageCodec = (name) => name === "EncryptedResponsePart" ? { fromBinary: () => envelope } : { fromBinary: () => ({ contents: [] }) };
  const writer = new UmpWriter();
  writer.writePart({ type: 10, data: new Uint8Array([8, 25]) });
  writer.writePart({ type: 11, data: new Uint8Array([1, 2, 3]) });
  const body = writer.finish();
  const result = await decryptUmp(body, { autoHd: false }, [key]);
  assert.strictEqual(result.body, body, "unchanged encrypted part must retain original container");
  context.rewritePlayer = () => true;
  context.messageCodec = (name) => name === "EncryptedResponsePart" ? { fromBinary: () => envelope } : { fromBinary: () => ({ contents: [{ player: {} }] }), toBinary: () => payload };
  assert.strictEqual((await decryptUmp(body, { autoHd: false }, [key])).body, body, "identical re-encoding must retain original container");
  checks++;
  console.log("ok   YouTube real UMP crypto: unchanged encrypted part retains original bytes");
}
testBilibiliGrpc()
  .then(() => testUmp())
  .then(() => console.log("\n" + checks + " regression checks passed"))
  .catch((e) => { console.error(e); process.exitCode = 1; });
