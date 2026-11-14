#!/usr/bin/env node
"use strict";

// 成品冒烟测试：在 vm 沙箱里用 stub 的 $request / $response / $done 跑每个入口。
// 只验证「能加载、能分发、$done 恰好一次、返回形状基本正确」，不替代真机验证。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
let failures = 0;

function ok(name, condition, detail) {
  if (condition) {
    console.log("ok   " + name);
    return;
  }
  failures++;
  console.error("FAIL " + name + (detail ? ": " + detail : ""));
}

function run(rel, options) {
  const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const calls = [];
  const store = new Map();
  const sandbox = {
    $request: options.request,
    $response: options.response,
    $argument: options.argument,
    $done: (value) => calls.push(value),
    $persistentStore: {
      read: (key) => (store.has(key) ? store.get(key) : null),
      write: (value, key) => {
        store.set(key, value);
        return true;
      },
    },
    $httpClient: { get: (request, callback) => callback(new Error("offline"), null, null) },
    console: { log() {}, error() {} },
    setTimeout,
    clearTimeout,
    Uint8Array,
    ArrayBuffer,
    Object,
  };
  if (!options.shadowrocket) {
    sandbox.TextEncoder = TextEncoder;
    sandbox.TextDecoder = TextDecoder;
  }
  if (options.compression !== false) {
    sandbox.CompressionStream = CompressionStream;
    sandbox.DecompressionStream = DecompressionStream;
  }

  const context = vm.createContext(sandbox);
  if (options.shadowrocket) {
    // 模拟小火箭缺少较新的 API，让兼容层生效。
    vm.runInContext("delete Uint8Array.fromBase64; delete Uint8Array.prototype.toBase64; delete Object.hasOwn;", context);
  }

  try {
    vm.runInContext(code, context, { timeout: 10000 });
  } catch (e) {
    return { error: e.stack, calls, store, context };
  }
  return { calls, store, context };
}

function doneOnce(name, result, check) {
  ok(name + " 调用 $done 一次", result.calls.length === 1, result.error || JSON.stringify(result.calls));
  if (result.calls.length !== 1) return;
  ok(name, check(result.calls[0]), JSON.stringify(result.calls[0]));
}

function varint(value) {
  const out = [];
  while (value >= 128) {
    out.push((value % 128) | 128);
    value = Math.floor(value / 128);
  }
  out.push(value);
  return out;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pbField(no, bytes) {
  return new Uint8Array([...varint(no * 8 + 2), ...varint(bytes.length), ...bytes]);
}

function pbNest(path, leaf) {
  let value = leaf;
  for (let i = path.length - 1; i >= 0; i--) value = pbField(path[i], value);
  return value;
}

const ytArgLoon = [true, true, "max", "zh-Hans", "", false, true, false, "standard", true, "4", true];
const ytArgJson = JSON.stringify({
  blockAds: true,
  blockAi: true,
  maxHeight: "max",
  captionLang: "zh-Hans",
  homeMenu: "",
  blockShortsFeed: false,
  youtubeMusic: true,
  blockMembersOnly: false,
  homeCleanup: "standard",
  jumpAhead: true,
  maxSpeed: "4",
  web: true,
});
const spArgLoon = [true, true, true, true];
const spArgJson = JSON.stringify({ spoof_premium: true, block_ads: true, unlock_playback: true, enable_lyrics: true });

function ytArgs(platform) {
  return platform === "loon" ? ytArgLoon : ytArgJson;
}

function ytArgsNoWeb(platform) {
  if (platform === "loon") return [...ytArgLoon.slice(0, 11), false];
  return JSON.stringify({ ...JSON.parse(ytArgJson), web: false });
}

function biliArgs(platform, web = true) {
  return platform === "loon"
    ? [true, true, true, web]
    : JSON.stringify({ block_ads: true, hide_vip: true, clean_ui: true, web });
}

function spArgs(platform) {
  return platform === "loon" ? spArgLoon : spArgJson;
}

for (const platform of ["loon", "shadowrocket"]) {
  const shadowrocket = platform === "shadowrocket";
  const prefix = platform + "/youtube/js/";

  doneOnce(
    platform + " request ad_break 返回空 protobuf",
    run(prefix + "youtube.request.js", {
      shadowrocket,
      request: { url: "https://youtubei.googleapis.com/youtubei/v1/player/ad_break", headers: {} },
      argument: ytArgs(platform),
    }),
    (value) => value && value.response && value.response.status === 200,
  );

  doneOnce(
    platform + " request log_event 剥热更新哈希头",
    run(prefix + "youtube.request.js", {
      shadowrocket,
      request: {
        url: "https://youtubei.googleapis.com/youtubei/v1/log_event",
        headers: { "x-youtube-hot-hash-data": "abc" },
      },
      argument: ytArgs(platform),
    }),
    (value) => value && value.headers && !Object.keys(value.headers).some((key) => key.toLowerCase() === "x-youtube-hot-hash-data"),
  );

  doneOnce(
    platform + " request videoplayback 无缓存放行",
    run(prefix + "youtube.request.js", {
      shadowrocket,
      request: { url: "https://rr1---sn.googlevideo.com/videoplayback?id=abc", headers: {} },
      argument: ytArgs(platform),
    }),
    (value) => value === undefined,
  );

  doneOnce(
    platform + " key config 空体放行",
    run(prefix + "youtube.key.js", {
      shadowrocket,
      request: { url: "https://youtubei.googleapis.com/youtubei/v1/config", headers: {} },
      response: { url: "https://youtubei.googleapis.com/youtubei/v1/config", status: 200, headers: {}, body: new Uint8Array() },
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  doneOnce(
    platform + " response browse 空体放行",
    run(prefix + "youtube.response.js", {
      shadowrocket,
      request: { url: "https://youtubei.googleapis.com/youtubei/v1/browse", headers: {} },
      response: { url: "https://youtubei.googleapis.com/youtubei/v1/browse", status: 200, headers: {}, body: new Uint8Array() },
      argument: ytArgs(platform),
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  const webJson = JSON.stringify({
    contents: [
      { videoRenderer: { videoId: "ok" } },
      { adSlotRenderer: { adSlotMetadata: { slotId: "ad" } } },
    ],
  });
  doneOnce(
    platform + " response 网页版 JSON 删除广告位",
    run(prefix + "youtube.response.js", {
      shadowrocket,
      request: { url: "https://www.youtube.com/youtubei/v1/browse", headers: {} },
      response: {
        url: "https://www.youtube.com/youtubei/v1/browse",
        status: 200,
        headers: { "content-type": "application/json" },
        body: webJson,
      },
      argument: ytArgs(platform),
    }),
    (value) => {
      if (!value || typeof value.body !== "string") return false;
      const data = JSON.parse(value.body);
      return data.contents.length === 1 && data.contents[0].videoRenderer.videoId === "ok";
    },
  );

  doneOnce(
    platform + " response 关闭网页版后 JSON 原样放行",
    run(prefix + "youtube.response.js", {
      shadowrocket,
      request: { url: "https://www.youtube.com/youtubei/v1/browse", headers: {} },
      response: {
        url: "https://www.youtube.com/youtubei/v1/browse",
        status: 200,
        headers: { "content-type": "application/json" },
        body: webJson,
      },
      argument: ytArgsNoWeb(platform),
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  const biliPrefix = platform + "/bilibili/js/";
  const biliRelated = JSON.stringify({ code: 0, data: [{ aid: 1 }, { aid: 2, is_ad: true }] });
  doneOnce(
    platform + " bilibili 网页相关推荐过滤广告",
    run(biliPrefix + "bilibili_clean.js", {
      shadowrocket,
      request: { url: "https://api.bilibili.com/x/web-interface/archive/related?bvid=BV1", headers: {} },
      response: {
        url: "https://api.bilibili.com/x/web-interface/archive/related?bvid=BV1",
        status: 200,
        headers: {},
        body: biliRelated,
      },
      argument: biliArgs(platform),
    }),
    (value) => {
      if (!value || typeof value.body !== "string") return false;
      const data = JSON.parse(value.body);
      return data.data.length === 1 && data.data[0].aid === 1;
    },
  );

  doneOnce(
    platform + " bilibili 关闭网页版后相关推荐原样放行",
    run(biliPrefix + "bilibili_clean.js", {
      shadowrocket,
      request: { url: "https://api.bilibili.com/x/web-interface/archive/related?bvid=BV1", headers: {} },
      response: {
        url: "https://api.bilibili.com/x/web-interface/archive/related?bvid=BV1",
        status: 200,
        headers: {},
        body: biliRelated,
      },
      argument: biliArgs(platform, false),
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  doneOnce(
    platform + " response initplayback 空体放行",
    run(prefix + "youtube.response.js", {
      shadowrocket,
      request: { url: "https://rr1---sn.googlevideo.com/initplayback", headers: {} },
      response: { url: "https://rr1---sn.googlevideo.com/initplayback", status: 200, headers: {}, body: new Uint8Array() },
      argument: ytArgs(platform),
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  const spPrefix = platform + "/spotify/js/";

  doneOnce(
    platform + " spotify premium 请求阶段空体放行",
    run(spPrefix + "spotify.js", {
      shadowrocket,
      request: { url: "https://spclient.wg.spotify.com/extended-metadata/v1/x", headers: { "if-none-match": "abc" }, body: new Uint8Array() },
      argument: spArgs(platform),
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  doneOnce(
    platform + " spotify premium bootstrap 空体放行",
    run(spPrefix + "spotify.js", {
      shadowrocket,
      request: { url: "https://spclient.wg.spotify.com/bootstrap/v1/x", headers: {} },
      response: { url: "https://spclient.wg.spotify.com/bootstrap/v1/x", status: 200, headers: {}, body: new Uint8Array() },
      argument: spArgs(platform),
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  doneOnce(
    platform + " spotify feed casita 空体放行",
    run(spPrefix + "spotify.feed.js", {
      shadowrocket,
      request: { url: "https://spclient.wg.spotify.com/casita/v1/home", headers: {} },
      response: { url: "https://spclient.wg.spotify.com/casita/v1/home", status: 200, headers: {}, body: new Uint8Array() },
      argument: spArgs(platform),
    }),
    (value) => value && Object.keys(value).length === 0,
  );

  // casita home：field 1 -> [section]，section 自身是 field 1 包裹的 URI 字符串。
  const feedEnc = new TextEncoder();
  const feedSection = (name) => pbField(1, feedEnc.encode("home|" + name));
  const feedBody = pbField(1, concat([pbField(1, feedSection("brand-ad")), pbField(1, feedSection("normal-section"))]));
  doneOnce(
    platform + " spotify feed 删除广告 section",
    run(spPrefix + "spotify.feed.js", {
      shadowrocket,
      request: { url: "https://spclient.wg.spotify.com/casita/v1/home", headers: {} },
      response: { url: "https://spclient.wg.spotify.com/casita/v1/home", status: 200, headers: {}, body: feedBody },
      argument: spArgs(platform),
    }),
    (value) => {
      if (!value || !value.body) return false;
      const text = new TextDecoder().decode(value.body);
      return text.indexOf("brand-ad") < 0 && text.indexOf("normal-section") >= 0;
    },
  );

  doneOnce(
    platform + " spotify lyrics 404 空体放行",
    run(spPrefix + "spotify_lyrics.js", {
      shadowrocket,
      request: { url: "https://spclient.wg.spotify.com/color-lyrics/v2/track/abc", headers: {} },
      response: { url: "https://spclient.wg.spotify.com/color-lyrics/v2/track/abc", status: 404, headers: {}, body: new Uint8Array() },
      argument: platform === "loon" ? ["lrclib", true] : JSON.stringify({ lyrics_source: "lrclib", enable_lyrics: true }),
    }),
    (value) => value && Object.keys(value).length === 0,
  );
}

// 密钥提取 + Shadowrocket base64 兼容层：构造一棵 config protobuf，确认能写入 store。
{
  const clientKey = new Uint8Array(32).fill(7);
  const encryptKey = new Uint8Array(16).fill(9);
  const body = pbNest(
    [1, 16, 7, 138536474, 146311580],
    concat([pbField(1, clientKey), pbField(2, encryptKey)]),
  );
  const result = run("shadowrocket/youtube/js/youtube.key.js", {
    shadowrocket: true,
    request: { url: "https://youtubei.googleapis.com/youtubei/v1/config", headers: {} },
    response: { url: "https://youtubei.googleapis.com/youtubei/v1/config", status: 200, headers: {}, body },
  });
  doneOnce("shadowrocket key 写入 UMP 密钥", result, (value) => value && Object.keys(value).length === 0);
  const stored = result.store.get("YouTubeConfig");
  ok("shadowrocket key store 有 YouTubeConfig", typeof stored === "string", String(stored));
  if (typeof stored === "string") {
    const parsed = JSON.parse(stored);
    ok("shadowrocket key clientKey 是 base64", parsed.youtube && parsed.youtube.clientKey === Buffer.from(clientKey).toString("base64"), stored);
    ok("shadowrocket key encryptKey 是 base64", parsed.youtube && parsed.youtube.encryptKey === Buffer.from(encryptKey).toString("base64"), stored);
  }
  const roundTrip = vm.runInContext("shadowrocketBase64To(shadowrocketBase64From('aGVsbG8='))", result.context);
  ok("shadowrocket base64 往返", roundTrip === "aGVsbG8=", roundTrip);
  const encoded = vm.runInContext("shadowrocketBase64To(new Uint8Array([104,101,108,108,111]))", result.context);
  ok("shadowrocket base64 编码", encoded === "aGVsbG8=", encoded);
}

// Shadowrocket 缺少 CompressionStream 时，UMP 失败必须放行而不是回空 200。
{
  const result = run("shadowrocket/youtube/js/youtube.response.js", {
    shadowrocket: true,
    compression: false,
    request: { url: "https://rr1---sn.googlevideo.com/initplayback", headers: {} },
    response: {
      url: "https://rr1---sn.googlevideo.com/initplayback",
      status: 200,
      headers: { "content-type": "application/vnd.yt-ump" },
      body: new Uint8Array([1, 2, 3]),
    },
    argument: ytArgJson,
  });
  doneOnce("shadowrocket UMP 缺 CompressionStream 时放行", result, (value) => value && value.response === undefined);
}

if (failures) {
  console.error("\n" + failures + " check(s) failed");
  process.exit(1);
}
console.log("\nall smoke checks passed");
