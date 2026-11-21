#!/usr/bin/env node
"use strict";

// Standalone YouTube regression checks, independent from unrelated module tests.
// Pass --bench to measure synthetic JSON response rewriting on the current runtime.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");

const ROOT = path.resolve(__dirname, "..");
const PLATFORMS = ["loon", "egern", "shadowrocket"];
let checks = 0;

async function run(platform, route, body, options = {}) {
  const file = path.join(ROOT, platform, "youtube/js/youtube.response.js");
  const url = `https://www.youtube.com/youtubei/v1/${route}`;
  const bytes = new TextEncoder().encode(body);
  const context = vm.createContext({
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Object,
    CompressionStream,
    DecompressionStream,
    console,
  });
  if (platform === "egern") {
    const promise = vm.runInContext("Promise", context);
    context.ctx = {
      env: { block_ads: "true", web: "true", ...Object.fromEntries(Object.entries(options).map(([key, value]) => [key.replace(/[A-Z]/g, (char) => "_" + char.toLowerCase()), String(value)])) },
      request: { url, method: "POST", headers: {} },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: {},
        arrayBuffer: () => promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      },
      storage: { get: () => null, set: () => {} },
      http: { get: () => promise.reject(new Error("offline")), post: () => promise.reject(new Error("offline")) },
      respond: (value) => value,
    };
    const code = fs.readFileSync(file, "utf8").replace(/^export default async function \(ctx\) \{/m, "globalThis.__entry = async function (ctx) {");
    vm.runInContext(code + "\nglobalThis.__promise = __entry(ctx);", context, { timeout: 10000 });
    const out = (await context.__promise) ?? {};
    if (out.body !== undefined) {
      const returned = typeof out.body === "string" ? new TextEncoder().encode(out.body) : new Uint8Array(out.body);
      if (returned.length === bytes.length && returned.every((byte, index) => byte === bytes[index])) return {};
    }
    return out;
  }

  const calls = [];
  const sandbox = {
    $request: { url, headers: {} },
    $response: { url, status: 200, headers: { "content-type": "application/json" }, body },
    $argument: JSON.stringify({ blockAds: true, web: true, ...options }),
    $done: (value) => calls.push(value),
    $persistentStore: { read: () => null, write: () => true },
    Uint8Array,
    ArrayBuffer,
    Object,
    TextEncoder,
    TextDecoder,
    CompressionStream,
    DecompressionStream,
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { timeout: 10000 });
  assert.equal(calls.length, 1, `${platform} must call $done exactly once`);
  return calls[0] ?? {};
}

async function check(name, fn) {
  await fn();
  checks++;
  console.log(`ok   ${name}`);
}

async function main() {
for (const platform of PLATFORMS) {
  await check(`${platform}: strips known web ad renderer`, async () => {
    const body = JSON.stringify({ contents: [{ videoRenderer: { videoId: "keep" } }, { adSlotRenderer: {} }] });
    const out = await run(platform, "browse", body);
    assert.deepEqual(JSON.parse(out.body).contents, [{ videoRenderer: { videoId: "keep" } }]);
  });

  await check(`${platform}: passes malformed JSON unchanged`, async () => {
    assert.equal(Object.keys(await run(platform, "browse", "{invalid")).length, 0);
  });

  await check(`${platform}: web toggle leaves response unchanged`, async () => {
    const body = JSON.stringify({ contents: [{ adSlotRenderer: {} }] });
    assert.equal(Object.keys(await run(platform, "browse", body, { web: false })).length, 0);
  });

  await check(`${platform}: respects disabled ad filtering`, async () => {
    const body = JSON.stringify({ contents: [{ adSlotRenderer: {} }] });
    assert.equal(Object.keys(await run(platform, "browse", body, { blockAds: false })).length, 0);
  });
}

if (process.argv.includes("--bench")) {
  const items = Array.from({ length: 1200 }, (_, index) =>
    index % 10 === 0 ? { adSlotRenderer: { id: index } } : { videoRenderer: { videoId: `video-${index}`, title: `Video ${index}` } },
  );
  const body = JSON.stringify({ contents: items });
  const iterations = 10;
  console.log(`\nSynthetic JSON benchmark (${(Buffer.byteLength(body) / 1024).toFixed(1)} KiB, ${iterations} runs)`);
  for (const platform of PLATFORMS) {
    await run(platform, "browse", body);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) await run(platform, "browse", body);
    console.log(`${platform}: ${((performance.now() - start) / iterations).toFixed(2)} ms/run`);
  }
}

console.log(`\n${checks} YouTube checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
