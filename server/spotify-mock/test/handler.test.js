import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { handle } from "../src/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const realFetch = globalThis.fetch;

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

function attribute(key, value) {
  const inner = typeof value === "string" ? str(4, value) : vi(2, value ? 1 : 0);
  return bytes(1, concat([str(1, key), bytes(2, inner)]));
}

const ucs = (...entries) => bytes(3, concat(entries));
const customize = (message) => bytes(1, message);
const bootstrap = (message) => bytes(2, bytes(1, bytes(1, bytes(1, message))));

function stubFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response();
  };
  return calls;
}

test("health endpoint does not touch the network", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not fetch");
  };

  const response = await handle(new Request("http://localhost/health"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "spotify-mock");
  assert.equal(body.options.unlockPlayback, "auto");
  assert.equal(body.options.lyrics.enabled, true);
  assert.equal(body.options.lyrics.source, "lrclib");
  assert.equal(called, false);
});

test("unknown /music paths are proxied unchanged", async () => {
  const body = encoder.encode("album payload");
  const calls = stubFetch(
    () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );

  const response = await handle(
    new Request("http://localhost/music/album-entity-view/v2/album/123?market=CN"),
    {},
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://spclient.wg.spotify.com/album-entity-view/v2/album/123?market=CN",
  );
  assert.equal(response.headers.get("x-spotify-mock"), "passthrough");
  assert.equal(response.headers.get("x-spotify-mock-ads"), null);
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array(body),
  );
});

test("non-/music paths are still rejected", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("should not fetch");
  };

  const response = await handle(new Request("http://localhost/album/123"), {});
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test("bootstrap is forwarded with safe headers and patched", async () => {
  const input = bootstrap(ucs(attribute("name", "Free"), attribute("ads", true)));
  const calls = stubFetch(
    () =>
      new Response(input, {
        status: 200,
        headers: {
          "content-type": "application/x-protobuf",
          "content-encoding": "gzip",
          etag: '"abc"',
          "content-length": "999",
        },
      }),
  );

  const response = await handle(
    new Request("http://localhost/music/bootstrap?timezone=UTC", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "if-none-match": '"abc"',
        "accept-encoding": "gzip, br",
        "content-type": "application/x-protobuf",
      },
      body: Uint8Array.from([1, 2, 3]),
    }),
    {},
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://spclient.wg.spotify.com/bootstrap?timezone=UTC");

  const forwarded = new Headers(calls[0].init.headers);
  assert.equal(forwarded.get("authorization"), "Bearer test-token");
  assert.equal(forwarded.get("if-none-match"), null);
  assert.equal(forwarded.get("accept-encoding"), "identity");
  assert.equal(forwarded.get("host"), null);
  assert.equal(forwarded.get("content-length"), null);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = new Uint8Array(await response.arrayBuffer());
  assert.ok(body.length > input.length);
  assert.ok(decoder.decode(body).includes("Spotify Premium"));
});

test("versioned bootstrap paths are forwarded and patched", async () => {
  const input = bootstrap(ucs(attribute("name", "Free"), attribute("ads", true)));
  const calls = stubFetch(
    () =>
      new Response(input, {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );

  const response = await handle(
    new Request("http://localhost/music/bootstrap/v3/bootstrap?x=1", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: Uint8Array.from([1, 2, 3]),
    }),
    {},
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://spclient.wg.spotify.com/bootstrap/v3/bootstrap?x=1");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  const body = new Uint8Array(await response.arrayBuffer());
  assert.ok(decoder.decode(body).includes("Spotify Premium"));
});

test("paths that only resemble bootstrap are proxied without patching", async () => {
  const calls = stubFetch(
    () =>
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );

  const response = await handle(
    new Request("http://localhost/music/bootstrap-other", { method: "POST" }),
    {},
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://spclient.wg.spotify.com/bootstrap-other",
  );
  assert.equal(response.headers.get("x-spotify-mock"), "passthrough");
});

test("a JSON error from upstream is passed through untouched", async () => {
  const errorBody = encoder.encode('{"error":"rate limited"}');
  stubFetch(
    () =>
      new Response(errorBody, {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
  );

  const response = await handle(new Request("http://localhost/music/bootstrap", { method: "POST" }), {});
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-spotify-mock"), "passthrough");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), errorBody);
});

test("extended-metadata request etags are stripped before forwarding", async () => {
  const query = concat([vi(1, 4), str(2, "etag-value")]);
  const entityRequest = concat([str(1, "spotify:track:abc"), bytes(2, query)]);
  const requestBody = concat([bytes(1, vi(1, 1)), bytes(2, entityRequest)]);

  const calls = stubFetch(
    () =>
      new Response(new Uint8Array(0), {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );

  const response = await handle(
    new Request("http://localhost/music/extended-metadata/v0/extended-metadata", {
      method: "POST",
      headers: { "content-type": "application/x-protobuf", "if-none-match": '"etag"' },
      body: requestBody,
    }),
    {},
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const forwarded = new Uint8Array(calls[0].init.body);
  assert.ok(forwarded.length < requestBody.length);
  assert.equal(decoder.decode(forwarded).includes("etag-value"), false);
});

test("MOCK_PREFIX hides the service behind an extra path segment", async () => {
  const calls = stubFetch(
    () =>
      new Response(bootstrap(ucs(attribute("name", "Free"))), {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );

  const hidden = await handle(
    new Request("http://localhost/secret/music/bootstrap", { method: "POST" }),
    { MOCK_PREFIX: "/secret" },
  );
  assert.equal(hidden.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://spclient.wg.spotify.com/bootstrap");

  const exposed = await handle(new Request("http://localhost/music/bootstrap", { method: "POST" }), {
    MOCK_PREFIX: "/secret",
  });
  assert.equal(exposed.status, 404);
  assert.equal(calls.length, 1);
});

test("prefixed health endpoint works", async () => {
  const response = await handle(new Request("http://localhost/secret/health"), {
    MOCK_PREFIX: "/secret/",
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.prefix, "/secret");
});

test("health reports desktop=auto when DESKTOP is not forced", async () => {
  const response = await handle(new Request("http://localhost/health"), {});
  const body = await response.json();
  assert.equal(body.options.desktop, "auto");
});

function bootstrapWithUa(ua, env = {}, path = "/music/bootstrap") {
  const input = bootstrap(ucs(attribute("name", "Free"), attribute("ads", true)));
  stubFetch(
    () =>
      new Response(input, {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );
  return handle(
    new Request("http://localhost" + path, {
      method: "POST",
      headers: { "user-agent": ua },
    }),
    env,
  );
}

test("a Mac user-agent uses the desktop attribute set without playback unlock", async () => {
  const response = await bootstrapWithUa(
    "Spotify/1.2.3 CFNetwork/1490.0.4 Darwin/23.2.0",
  );
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  const body = decoder.decode(new Uint8Array(await response.arrayBuffer()));
  assert.ok(body.includes("Spotify Premium"));
  assert.equal(body.includes("player-license"), false);
  assert.equal(body.includes("streaming-rules"), false);
});

test("an iPhone user-agent keeps the mobile playback unlock by default", async () => {
  const response = await bootstrapWithUa(
    "Spotify/8.9.1 iOS/17.2 (iPhone15,2)",
  );
  const body = decoder.decode(new Uint8Array(await response.arrayBuffer()));
  assert.ok(body.includes("Spotify Premium"));
  assert.ok(body.includes("player-license"));
});

test("UNLOCK_PLAYBACK=true explicitly enables playback fields on desktop", async () => {
  const response = await bootstrapWithUa(
    "Spotify/1.2.3 CFNetwork/1490.0.4 Darwin/23.2.0",
    { UNLOCK_PLAYBACK: "true" },
  );
  const body = decoder.decode(new Uint8Array(await response.arrayBuffer()));
  assert.ok(body.includes("player-license"));
});

test("DESKTOP=true forces desktop mode even for an iPhone user-agent", async () => {
  const response = await bootstrapWithUa(
    "Spotify/8.9.1 iOS/17.2 (iPhone15,2)",
    { DESKTOP: "true" },
  );
  const body = decoder.decode(new Uint8Array(await response.arrayBuffer()));
  assert.equal(body.includes("player-license"), false);
});

test("casita home ads are stripped through the public route", async () => {
  const ad = concat([str(1, "spotify:section:1|brand-ad"), bytes(2, Uint8Array.from([1]))]);
  const normal = concat([
    str(1, "spotify:section:2|recently-played"),
    bytes(2, Uint8Array.from([2])),
  ]);
  const input = bytes(1, concat([bytes(1, ad), bytes(1, normal)]));
  const calls = stubFetch(
    () =>
      new Response(input, {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );

  const response = await handle(
    new Request("http://localhost/music/casita/v1/home?locale=zh", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: Uint8Array.from([1, 2, 3]),
    }),
    {},
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://spclient.wg.spotify.com/casita/v1/home?locale=zh");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  assert.equal(response.headers.get("x-spotify-mock-ads"), "home");
  const text = decoder.decode(new Uint8Array(await response.arrayBuffer()));
  assert.equal(text.includes("brand-ad"), false);
  assert.ok(text.includes("recently-played"));
});

test("remote configuration responses are patched through the public route", async () => {
  const value = concat([
    bytes(1, concat([str(1, "core"), str(2, "ads")])),
    bytes(3, vi(1, 1)),
  ]);
  const input = bytes(3, value);
  const calls = stubFetch(
    () =>
      new Response(input, {
        status: 200,
        headers: { "content-type": "application/x-protobuf" },
      }),
  );

  const response = await handle(
    new Request("http://localhost/music/remote-config-resolver/v3/configuration?x=1", {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: Uint8Array.from([1]),
    }),
    {},
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://spclient.wg.spotify.com/remote-config-resolver/v3/configuration?x=1",
  );
  assert.equal(response.headers.get("x-spotify-mock"), "patched");
  assert.equal(response.headers.get("x-spotify-mock-ads"), "configuration");
});

test("browse and scroll ad routes accept versioned paths", async () => {
  const cases = [
    ["http://localhost/music/browsita/v2/browse?market=US", "https://spclient.wg.spotify.com/browsita/v2/browse?market=US", "browse"],
    ["http://localhost/music/scrollsita/v1/scroll/spotify?x=1", "https://spclient.wg.spotify.com/scrollsita/v1/scroll/spotify?x=1", "scroll"],
    ["http://localhost/music/scrollsita/v1/scroll/spotify:track:abc:456?x=1", "https://spclient.wg.spotify.com/scrollsita/v1/scroll/spotify:track:abc:456?x=1", "scroll"],
    ["http://localhost/music/remote-config-resolver/v3/unauth/configuration?x=1", "https://spclient.wg.spotify.com/remote-config-resolver/v3/unauth/configuration?x=1", "configuration"],
    ["http://localhost/music/nebula/v1/configuration/attributes?x=1", "https://spclient.wg.spotify.com/nebula/v1/configuration/attributes?x=1", "attributes"],
  ];

  for (const [url, target, kind] of cases) {
    const calls = stubFetch(
      () =>
        new Response(concat([str(1, "plain"), bytes(2, Uint8Array.from([1]))]), {
          status: 200,
          headers: { "content-type": "application/x-protobuf" },
        }),
    );
    const response = await handle(
      new Request(url, {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
        body: Uint8Array.from([1]),
      }),
      {},
    );
    assert.equal(response.status, 200, url);
    assert.equal(calls.length, 1, url);
    assert.equal(calls[0].url, target, url);
    assert.equal(response.headers.get("x-spotify-mock-ads"), "none", url);
  }
});
