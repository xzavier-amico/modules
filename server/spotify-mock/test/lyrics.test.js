import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { handle } from "../src/index.js";
import { protoLineCount, resetLyricsCache } from "../src/lyrics.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetLyricsCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function concat(parts) {
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

function varint(value) {
  const out = [];
  let v = value;
  do {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Uint8Array.from(out);
}

function field(no, wire, payload) {
  const key = varint(no * 8 + wire);
  if (wire === 0) return concat([key, varint(payload)]);
  return concat([key, varint(payload.length), payload]);
}

const vi = (no, value) => field(no, 0, value);
const bytes = (no, payload) => field(no, 2, payload);
const str = (no, value) => bytes(no, encoder.encode(value));

// Minimal protobuf reader for assertions.
function readVarint(b, state) {
  let value = 0;
  let shift = 0;
  while (state.i < b.length) {
    const byte = b[state.i++];
    value += (byte & 0x7f) * Math.pow(2, shift);
    if (!(byte & 0x80)) return value;
    shift += 7;
  }
  throw new Error("varint");
}

function parse(b) {
  const out = [];
  const state = { i: 0 };
  while (state.i < b.length) {
    const key = readVarint(b, state);
    const no = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      out.push({ no, wire, value: readVarint(b, state) });
    } else if (wire === 2) {
      const len = readVarint(b, state);
      out.push({ no, wire, bytes: b.subarray(state.i, state.i + len) });
      state.i += len;
    } else {
      throw new Error("unsupported wire " + wire);
    }
  }
  return out;
}

function officialProto(restriction) {
  const line = concat([vi(1, 1000), str(2, "hello")]);
  const data = concat([vi(1, 1), bytes(2, line), str(5, "Spotify"), vi(14, restriction)]);
  const colors = concat([vi(1, 0xff121212), vi(2, 0xb3ffffff), vi(3, 0xffffffff)]);
  return concat([bytes(1, data), bytes(2, colors)]);
}

// Routes the mock network by URL fragment. `upstream` answers spclient,
// the rest answer the oembed / provider lookups.
function stubNetwork(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [fragment, make] of routes) {
      if (target.indexOf(fragment) >= 0) return make(target);
    }
    return new Response("not found", { status: 404 });
  };
  return calls;
}

function lyricsRequest(options = {}) {
  const headers = { "content-type": "application/x-protobuf" };
  if (options.userAgent) headers["user-agent"] = options.userAgent;
  if (options.accept) headers.accept = options.accept;
  return new Request(
    "http://localhost/music/color-lyrics/v2/track/abc123" + (options.query || ""),
    { headers },
  );
}

function upstreamResponse(body, status = 200, contentType = "application/x-protobuf") {
  const headers = {};
  if (contentType) headers["content-type"] = contentType;
  return new Response(body, { status, headers });
}

test("official JSON lyrics keep the body but lose the monthly-limit restriction", async () => {
  const input = JSON.stringify({
    lyrics: { lines: [{ words: "hello" }], restriction: 3, syncType: "LINE_SYNCED" },
  });
  stubNetwork([["spclient.wg.spotify.com", () => upstreamResponse(encoder.encode(input), 200, "application/json")]]);

  const response = await handle(lyricsRequest(), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = JSON.parse(await response.text());
  assert.equal("restriction" in body.lyrics, false);
  assert.equal(body.lyrics.lines[0].words, "hello");
});

test("official JSON lyrics without a restriction are passed through byte for byte", async () => {
  const input = encoder.encode(JSON.stringify({ lyrics: { lines: [{ words: "hello" }] } }));
  stubNetwork([["spclient.wg.spotify.com", () => upstreamResponse(input, 200, "application/json")]]);

  const response = await handle(lyricsRequest(), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "passthrough");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), input);
});

test("official JSON lyrics are recognized even without a content-type", async () => {
  const input = encoder.encode(
    JSON.stringify({ lyrics: { lines: [{ words: "hello" }], restriction: 3 } }),
  );
  stubNetwork([["spclient.wg.spotify.com", () => upstreamResponse(input, 200, "")]]);

  const response = await handle(lyricsRequest(), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  assert.match(response.headers.get("content-type"), /application\/json/);
});

test("official protobuf lyrics get restriction=showLyrics", async () => {
  const input = officialProto(3);
  stubNetwork([["spclient.wg.spotify.com", () => upstreamResponse(input)]]);

  const response = await handle(lyricsRequest(), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "patched");

  const body = new Uint8Array(await response.arrayBuffer());
  const data = parse(body).find((item) => item.no === 1).bytes;
  const restriction = parse(data).find((item) => item.no === 14);
  assert.equal(restriction.value, 1);
  assert.ok(protoLineCount(body) > 0);
});

test("a 404 is replaced with synthesized protobuf lyrics on mobile", async () => {
  const calls = stubNetwork([
    ["spclient.wg.spotify.com", () => upstreamResponse(new Uint8Array(0), 404, "application/x-protobuf")],
    ["open.spotify.com/oembed", () => upstreamResponse(JSON.stringify({ title: "Hello", author_name: "Adele" }), 200, "application/json")],
    ["lrclib.net/api/get", () => upstreamResponse(JSON.stringify({ duration: 200, syncedLyrics: "[00:01.00]Hello\n[00:05.50]World" }), 200, "application/json")],
  ]);

  const response = await handle(lyricsRequest(), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  assert.equal(response.headers.get("content-type"), "application/x-protobuf");

  const body = new Uint8Array(await response.arrayBuffer());
  assert.equal(protoLineCount(body), 2);
  assert.ok(decoder.decode(body).includes("Hello"));
  assert.ok(calls.some((url) => url.startsWith("https://lrclib.net/api/get?")));
});

test("?format=json gets a JSON payload even on mobile", async () => {
  stubNetwork([
    ["spclient.wg.spotify.com", () => upstreamResponse(new Uint8Array(0), 404, "application/json")],
    ["open.spotify.com/oembed", () => upstreamResponse(JSON.stringify({ title: "Hello", author_name: "Adele" }), 200, "application/json")],
    ["lrclib.net/api/get", () => upstreamResponse(JSON.stringify({ syncedLyrics: "[00:01.00]Hello" }), 200, "application/json")],
  ]);

  const response = await handle(lyricsRequest({ query: "?format=json" }), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.lyrics.syncType, "LINE_SYNCED");
  assert.equal(body.lyrics.lines[0].words, "Hello");
  assert.equal(body.lyrics.provider, "LRCLIB");
});

test("synthesized lyrics follow the shape of the official error body", async () => {
  stubNetwork([
    [
      "spclient.wg.spotify.com",
      () => upstreamResponse(encoder.encode('{"error":"not found"}'), 404, "application/json"),
    ],
    ["open.spotify.com/oembed", () => upstreamResponse(JSON.stringify({ title: "Hello", author_name: "Adele" }), 200, "application/json")],
    ["lrclib.net/api/get", () => upstreamResponse(JSON.stringify({ syncedLyrics: "[00:01.00]Hello" }), 200, "application/json")],
  ]);

  const response = await handle(lyricsRequest(), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  assert.equal(body.lyrics.lines[0].words, "Hello");
});

test("desktop clients default to JSON when Spotify has no lyrics", async () => {
  stubNetwork([
    ["spclient.wg.spotify.com", () => upstreamResponse(new Uint8Array(0), 404, "")],
    ["open.spotify.com/oembed", () => upstreamResponse(JSON.stringify({ title: "Hello", author_name: "Adele" }), 200, "application/json")],
    ["lrclib.net/api/get", () => upstreamResponse(JSON.stringify({ syncedLyrics: "[00:01.00]Hello" }), 200, "application/json")],
  ]);

  const response = await handle(
    lyricsRequest({ userAgent: "Spotify/1.2.3 CFNetwork/1490.0.4 Darwin/23.2.0" }),
    {},
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const body = await response.json();
  // Desktop keeps colours at the top level and uses highlightText.
  assert.equal(body.colors.highlightText, -1);
  assert.equal(body.lyrics.colors, undefined);
});

test("LYRICS_ENABLED=false passes the official 404 through", async () => {
  const calls = stubNetwork([
    ["spclient.wg.spotify.com", () => upstreamResponse(new Uint8Array(0), 404, "application/x-protobuf")],
    ["open.spotify.com/oembed", () => upstreamResponse(JSON.stringify({ title: "Hello" }), 200, "application/json")],
  ]);

  const response = await handle(lyricsRequest(), { LYRICS_ENABLED: "false" });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-spotify-mock"), "passthrough");
  assert.equal(calls.some((url) => url.indexOf("lrclib") >= 0), false);
});

test("no third-party match keeps the official 404", async () => {
  stubNetwork([
    ["spclient.wg.spotify.com", () => upstreamResponse(new Uint8Array(0), 404, "application/x-protobuf")],
    ["open.spotify.com/oembed", () => upstreamResponse(JSON.stringify({ title: "Hello", author_name: "Adele" }), 200, "application/json")],
  ]);

  const response = await handle(lyricsRequest(), {});
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-spotify-mock"), "passthrough");
});

test("health reports the lyrics options", async () => {
  const response = await handle(new Request("http://localhost/health"), {
    LYRICS_SOURCE: "auto",
  });
  const body = await response.json();
  assert.equal(body.options.lyrics.enabled, true);
  assert.equal(body.options.lyrics.source, "auto");
  assert.equal(body.options.lyrics.timeoutMs, 8000);
});

test("legacy /color-lyricsv2 paths are normalized before routing", async () => {
  const calls = stubNetwork([
    ["spclient.wg.spotify.com", () => upstreamResponse(new Uint8Array(0), 404, "")],
  ]);

  const response = await handle(
    new Request("http://localhost/music/color-lyricsv2/track/abc123"),
    { LYRICS_ENABLED: "false" },
  );

  assert.equal(response.status, 404);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://spclient.wg.spotify.com/color-lyrics/v2/track/abc123");
});

test("color-lyrics keeps the query string and strips cache validators upstream", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) });
    return upstreamResponse(new Uint8Array(0), 404, "");
  };

  const response = await handle(
    new Request("http://localhost/music/color-lyrics/v2/track/abc123?format=json", {
      headers: { "if-none-match": '"x"', "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT" },
    }),
    { LYRICS_ENABLED: "false" },
  );

  assert.equal(response.status, 404);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://spclient.wg.spotify.com/color-lyrics/v2/track/abc123?format=json",
  );
  assert.equal(calls[0].headers.get("if-none-match"), null);
  assert.equal(calls[0].headers.get("if-modified-since"), null);
});
