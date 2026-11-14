#!/usr/bin/env node
"use strict";

// 把 src/ 下的片段组合成三端成品。
//
//   node scripts/build.js          生成并写入 loon/ egern/ shadowrocket/
//   node scripts/build.js --check  只在内存构建并与磁盘比较，不一致时退出 1
//
// 成品需要提交到仓库；本脚本只依赖 Node 内置模块。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const CHECK = process.argv.includes("--check");
const PLATFORMS = ["loon", "egern", "shadowrocket"];

const COMPAT = fs.readFileSync(path.join(SRC, "compat", "shadowrocket.js"), "utf8").replace(/\s+$/, "") + "\n";

function read(module, rel) {
  return fs.readFileSync(path.join(SRC, module, rel), "utf8").replace(/\s+$/, "") + "\n";
}

function header(title) {
  return [
    "//=======================================================================================",
    "// " + title,
    "// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js",
    "//=======================================================================================",
    "",
    "",
  ].join("\n");
}

const WIRE = ["proto", "wire.js"];

const YT_CORE = [
  WIRE,
  "core/const.js",
  "core/store.js",
  "core/bytes.js",
  "core/protobuf.js",
  "core/request-info.js",
  "core/quality.js",
  "core/options.js",
];

const YT_KEY_CORE = [WIRE, "core/const.js", "core/store.js", "core/bytes.js", "core/protobuf.js", "core/request-info.js"];

const SP_CORE = [WIRE, "core/options.js", "core/protobuf.js"];

const TARGETS = [
  {
    module: "youtube",
    file: "youtube.request.js",
    binary: true,
    title: "YouTube Enhance — 请求阶段（ad_break / log_event / initplayback / videoplayback）",
    parts: [...YT_CORE, "request/rewrite.js", "entry/request.js"],
  },
  {
    module: "youtube",
    file: "youtube.key.js",
    binary: true,
    title: "YouTube Enhance — UMP 密钥提取（config / log_event 响应）",
    parts: [...YT_KEY_CORE, "key/keys.js", "entry/key.js"],
  },
  {
    module: "youtube",
    file: "youtube.response.js",
    binary: true,
    title: "YouTube Enhance — youtubei 响应 + initplayback UMP",
    parts: [
      ...YT_CORE,
      "response/schema.js",
      "response/codec.js",
      "response/filter.js",
      "response/json.js",
      "response/quality.js",
      "response/ump.js",
      "response/routes.js",
      "response/handlers.js",
      "entry/response.js",
    ],
  },
  {
    module: "spotify",
    file: "spotify.js",
    binary: true,
    title: "Spotify Premium — bootstrap / UCS / 元数据 / 远程配置 / 账号属性",
    parts: [
      ...SP_CORE,
      "premium/rules.js",
      "premium/attributes.js",
      "premium/config.js",
      "premium/response.js",
      "premium/lyrics.js",
      "premium/lyrics-prefetch.js",
      "lyrics.js",
      "premium/entry.js",
    ],
  },
  {
    module: "spotify",
    file: "spotify.feed.js",
    binary: true,
    title: "Spotify Premium — 信息流广告过滤",
    parts: [...SP_CORE, "feed/ads.js", "feed/lyrics-prefetch.js", "lyrics.js", "feed/lyrics.js", "feed/entry.js"],
  },
  {
    module: "spotify",
    file: "spotify_lyrics.js",
    binary: true,
    title: "Spotify Lyrics — 官方无歌词时补第三方歌词",
    standalone: "lyrics.js",
  },
  {
    module: "amap",
    file: "amap_clean.js",
    title: "AMap Clean — 高德地图 JSON 广告清理",
    standalone: "amap_clean.js",
  },
  {
    module: "xiaohongshu",
    file: "xiaohongshu_clean.js",
    title: "Xiaohongshu Clean — 首页 / 搜索 / 评论广告清理",
    standalone: "clean.js",
  },
  {
    module: "bilibili",
    file: "bilibili_clean.js",
    title: "BiliBili Clean — JSON 响应（首页 / 搜索 / 详情 / 我的）",
    standalone: "bilibili_clean.js",
  },
  {
    module: "bilibili",
    file: "bilibili_quality.js",
    binary: true,
    title: "BiliBili Clean — 播放请求画质（REST + gRPC）",
    standalone: "bilibili_quality.js",
  },
  {
    module: "bilibili",
    file: "bilibili_grpc.js",
    binary: true,
    title: "BiliBili Clean — gRPC 响应（详情 / 评论 / 动态）",
    head: "grpc/head.js",
    tail: "grpc/tail.js",
    parts: [["proto", "wire.js"], ["proto", "grpc.js"], "grpc/rules.js", "grpc/entry.js"],
  },
  {
    module: "delivery",
    file: "delivery_clean.js",
    title: "Delivery Ad-Free — 美团 / 京东 / 饿了么 JSON 清理",
    standalone: "delivery_clean.js",
  },
  {
    module: "emby",
    file: "emby_unlock.js",
    title: "Emby Unlock — mb3admin 授权校验 mock",
    standalone: "emby_unlock.js",
  },
];

const OBSOLETE = ["loon/youtube/js/youtube.js", "egern/youtube/js/youtube.js", "shadowrocket/youtube/js/youtube.js"];

// 独立脚本也从 src 构建；兼容层只进入 Shadowrocket 成品。
for (const module of ["pluto", "tubi"]) {
  for (const file of fs.readdirSync(path.join(SRC, module)).sort()) {
    if (file.endsWith(".js")) TARGETS.push({ module, file, title: module + " — " + file, standalone: file });
  }
}

function compose(target, platform) {
  // Egern 走原生 ctx 入口：外层套 src/env 的适配层，内部仍是同一份脚本主体。
  const native = platform === "egern";
  const chunks = [header(target.title)];
  if (platform === "shadowrocket") chunks.push(COMPAT);
  if (native) {
    chunks.push("const ENV_BODY_BINARY = " + (target.binary ? "true" : "false") + ";\n");
    chunks.push(read("env", "head.js"));
  }
  if (target.standalone) {
    chunks.push(read(target.module, target.standalone));
  } else {
    chunks.push(read(target.module, target.head || "head.js"));
    for (const part of target.parts) {
      chunks.push(Array.isArray(part) ? read(part[0], part[1]) : read(target.module, part));
    }
    chunks.push(read(target.module, target.tail || "tail.js"));
  }
  if (native) chunks.push(read("env", "tail.js"));
  return chunks.join("\n").replace(/\s+$/, "") + "\n";
}

let failed = false;

for (const target of TARGETS) {
  for (const platform of target.platforms || PLATFORMS) {
    const code = compose(target, platform);
    // Egern 成品是 ES module（export default），用 async 函数表达式包一层做语法校验。
    const source =
      platform === "egern" ? code.replace(/^export default async function \(ctx\) \{/m, "(async function (ctx) {") + "\n)" : code;
    try {
      new vm.Script(source, { filename: target.file });
    } catch (e) {
      console.error("syntax error: " + platform + "/" + target.module + "/" + target.file + ": " + e.message);
      failed = true;
      continue;
    }

    const outPath = path.join(ROOT, platform, target.module, "js", target.file);
    if (CHECK) {
      const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
      if (current !== code) {
        console.error("out of date: " + path.relative(ROOT, outPath));
        failed = true;
      }
      continue;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, code);
    console.log("wrote " + path.relative(ROOT, outPath) + " (" + code.length + " bytes)");
  }
}

if (CHECK) {
  for (const rel of OBSOLETE) {
    if (fs.existsSync(path.join(ROOT, rel))) {
      console.error("obsolete file still present: " + rel);
      failed = true;
    }
  }
  if (!failed) console.log("all generated files are up to date");
} else if (!failed) {
  for (const rel of OBSOLETE) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
      console.log("removed " + rel);
    }
  }
}

process.exit(failed ? 1 : 0);
