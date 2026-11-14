#!/usr/bin/env node
"use strict";

// 把 src/spotify 的客户端片段组合成服务端 patcher。
//
//   node scripts/build-server.js          写入 server/spotify-mock/src/patcher.js
//   node scripts/build-server.js --check  只比对，不一致时退出 1
//
// 客户端片段在 Loon / Egern / Shadowrocket 里按请求执行，服务端则包进
// buildPatcher 的函数作用域，每次调用生成独立闭包，避免并发请求共享状态。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const CHECK = process.argv.includes("--check");
const OUT = path.join(ROOT, "server/spotify-mock/src/patcher.js");

const PARTS = [
  ["proto", "wire.js"],
  ["spotify", "core/options.js"],
  ["spotify", "core/protobuf.js"],
  ["spotify", "premium/rules.js"],
  ["spotify", "premium/attributes.js"],
  ["spotify", "premium/config.js"],
  ["spotify", "premium/response.js"],
  ["spotify", "premium/lyrics.js"],
  ["spotify", "server/extra.js"],
  ["spotify", "feed/ads.js"],
  ["spotify", "feed/lyrics.js"],
];

function read(module, rel) {
  return fs.readFileSync(path.join(SRC, module, rel), "utf8").replace(/\s+$/, "") + "\n";
}

const code = [
  read("spotify", "server/head.js"),
  ...PARTS.map(([module, rel]) => read(module, rel)),
  read("spotify", "server/tail.js"),
]
  .join("\n")
  .replace(/\s+$/, "") + "\n";

// ESM 的 export 去掉后按普通脚本编译，提前拦住重复声明和语法错误。
try {
  new vm.Script(code.replace(/^export /gm, ""), { filename: "patcher.js" });
} catch (e) {
  console.error("syntax error: server/spotify-mock/src/patcher.js: " + e.message);
  process.exit(1);
}

if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== code) {
    console.error("out of date: server/spotify-mock/src/patcher.js");
    process.exit(1);
  }
  console.log("server patcher is up to date");
} else {
  fs.writeFileSync(OUT, code);
  console.log("wrote server/spotify-mock/src/patcher.js (" + code.length + " bytes)");
}
