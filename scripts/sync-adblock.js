#!/usr/bin/env node
"use strict";

// 同步 AdBlock 的自动规则块（MetaCubeX category-ads-all + 秋风 AWAvenue）。
//
//   node scripts/sync-adblock.js          拉取、DNS 过滤、写回三端
//   node scripts/sync-adblock.js --check  只比对，不一致时退出 1
//   node scripts/sync-adblock.js --no-dns 跳过 DNS 过滤（离线调试）
//
// 自动块用 sync-adblock:start / end 标记包住，手工维护的规则放在标记外，
// 不会被覆盖。DNS 过滤走阿里 DoH：A 与 AAAA 都是 NXDOMAIN 才判定失效。

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHECK = process.argv.includes("--check");
const NO_DNS = process.argv.includes("--no-dns");

const SOURCES = {
  metacubex: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ads-all.yaml",
  awa: "https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/Filters/AWAvenue-Ads-Rule-Surge.list",
};
const DOH = "https://223.5.5.5/resolve";
const START = "# >>> sync-adblock:start（自动生成，勿手改）";
const END = "# <<< sync-adblock:end";

// 上游列表里混有推送 / 深链 / 应用配置类域名，拦了会掉通知或影响启动，直接排除。
const EXCLUDE = new Set([
  "onesignal.com",
  "getui.cn",
  "getui.com",
  "igexin.com",
  "jpush.cn",
  "jiguang.cn",
  "branch.io",
  "app.link",
  "firebaseinstallations.googleapis.com",
  "statsigapi.net",
]);

const FILES = {
  loon: path.join(ROOT, "loon/adblock/adblock.plugin"),
  egern: path.join(ROOT, "egern/adblock/adblock.yaml"),
  shadowrocket: path.join(ROOT, "shadowrocket/adblock/adblock.sgmodule"),
};

async function fetchText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } catch (e) {
      if (attempt === 2) throw new Error("拉取失败 " + url + ": " + e.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function parseMetacubex(text) {
  const out = [];
  let inPayload = false;
  for (const line of text.split("\n")) {
    if (/^payload:/.test(line)) { inPayload = true; continue; }
    if (!inPayload) continue;
    const m = line.match(/^\s*-\s+(\S+)/);
    if (!m) continue;
    let value = m[1].trim().toLowerCase();
    if (!value || value.startsWith("#") || value.startsWith("keyword:")) continue;
    if (value.startsWith("+.")) out.push({ type: "suffix", value: value.slice(2) });
    else out.push({ type: "domain", value });
  }
  return out;
}

function parseAwa(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    if (raw.startsWith(".")) out.push({ type: "suffix", value: raw.slice(1).toLowerCase() });
  }
  return out;
}

async function doh(name, type) {
  const url = `${DOH}?name=${encodeURIComponent(name)}&type=${type}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const json = await res.json();
      return json.Status;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return -1;
}

async function filterLive(entries) {
  const queue = [...entries];
  const live = [];
  const workers = Array.from({ length: 12 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const a = await doh(item.value, "A");
      // -1 是查询失败，保守保留，避免网络抖动误删规则。
      let ok = a !== 3;
      if (!ok) {
        // NXDOMAIN 再确认一次，降低 DoH 抖动导致的误删。
        await new Promise((r) => setTimeout(r, 300));
        ok = (await doh(item.value, "A")) !== 3 || (await doh(item.value, "AAAA")) !== 3;
      }
      if (ok) live.push(item);
    }
  });
  await Promise.all(workers);
  return live;
}

// 手工规则（自动块之外）已经覆盖的域名，不再重复写入自动块。
function manualCoverage(text) {
  const body = text.replace(new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`, "g"), "");
  const suffix = new Set();
  const exact = new Set();
  for (const line of body.split("\n")) {
    let m = line.match(/^\s*DOMAIN-SUFFIX,\s*([^,]+),/i);
    if (m) { suffix.add(m[1].trim().toLowerCase()); continue; }
    m = line.match(/^\s*DOMAIN,\s*([^,]+),/i);
    if (m) { exact.add(m[1].trim().toLowerCase()); continue; }
  }
  for (const m of body.matchAll(/-\s*domain_suffix:\s*\n\s*match:\s*(\S+)/g)) suffix.add(m[1].toLowerCase());
  for (const m of body.matchAll(/-\s*domain:\s*\n\s*match:\s*(\S+)/g)) exact.add(m[1].toLowerCase());
  return { suffix, exact };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function coveredBy(value, suffix, exact) {
  if (suffix.has(value) || exact.has(value)) return true;
  const parts = value.split(".");
  for (let i = 1; i < parts.length; i++) if (suffix.has(parts.slice(i).join("."))) return true;
  return false;
}

function normalize(entries, suffix, exact) {
  const seen = new Set();
  const out = [];
  for (const item of entries) {
    if (EXCLUDE.has(item.value)) continue;
    if (coveredBy(item.value, suffix, exact)) continue;
    const key = item.type + "|" + item.value;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  // 去掉被列表内其它 suffix 覆盖的条目
  const suffixes = new Set(out.filter((x) => x.type === "suffix").map((x) => x.value));
  return out
    .filter((item) => {
      if (item.type !== "domain") return true;
      const parts = item.value.split(".");
      for (let i = 1; i < parts.length; i++) if (suffixes.has(parts.slice(i).join("."))) return false;
      return true;
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

function render(platform, entries) {
  if (platform === "egern") {
    return entries.flatMap((x) => [
      x.type === "suffix" ? "- domain_suffix:" : "- domain:",
      `    match: ${x.value}`,
      "    policy: REJECT",
    ]);
  }
  const sep = platform === "loon" ? ", " : ",";
  return entries.map((x) => `${x.type === "suffix" ? "DOMAIN-SUFFIX" : "DOMAIN"}${sep}${x.value}${sep}REJECT`);
}

function applyBlock(text, lines, anchor) {
  const block = [START, ...lines, END].join("\n");
  const re = new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`);
  if (re.test(text)) return text.replace(re, block);
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("找不到插入点 " + anchor);
  return text.slice(0, idx) + block + "\n\n" + text.slice(idx);
}

function loonCounts(text) {
  const lines = text.split("\n");
  const ruleStart = lines.findIndex((l) => l.trim() === "[Rule]");
  const rewriteStart = lines.findIndex((l, i) => i > ruleStart && /^\[Rewrite\]/.test(l));
  const mitmStart = lines.findIndex((l, i) => i > rewriteStart && /^\[MITM\]/.test(l));
  const rules = lines.slice(ruleStart + 1, rewriteStart).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const rejectRules = rules.filter((l) => /REJECT/.test(l)).length;
  const rejectRewrites = lines.slice(rewriteStart + 1, mitmStart).filter((l) => l.trim() && !l.trim().startsWith("#") && /reject/.test(l)).length;
  const mitm = lines.slice(mitmStart + 1).join("\n").replace(/^hostname = /, "").split(",").filter(Boolean).length;
  return { rules: rules.length, rewrites: rejectRewrites, reject: rejectRules + rejectRewrites, mitm, total: rejectRules + rejectRewrites + mitm };
}

function updateCounts(text, counts) {
  return text
    .replace(/^#!reject=.*$/m, `#!reject= ${counts.reject}`)
    .replace(/^#!mitm=.*$/m, `#!mitm= ${counts.mitm}`)
    .replace(/^#!total=.*$/m, `#!total= ${counts.total}`);
}

function updateReadme(file, counts) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const next = text
    .replace(/\[Rule\] \d+ 条/g, `[Rule] ${counts.rules} 条`)
    .replace(/\d+ rules \+/g, `${counts.rules} rules +`)
    .replace(/\[Rewrite\] \d+ 条/g, `[Rewrite] ${counts.rewrites} 条`);
  if (next !== text) fs.writeFileSync(file, next);
}

(async () => {
  const [metaText, awaText] = await Promise.all([fetchText(SOURCES.metacubex), fetchText(SOURCES.awa)]);
  let entries = [...parseMetacubex(metaText), ...parseAwa(awaText)];
  console.log(`拉取 ${entries.length} 条（MetaCubeX + 秋风）`);

  const loonText = fs.readFileSync(FILES.loon, "utf8");
  const coverage = manualCoverage(loonText);
  entries = normalize(entries, coverage.suffix, coverage.exact);
  console.log(`去重后 ${entries.length} 条`);

  if (!NO_DNS) {
    entries = await filterLive(entries);
    console.log(`DNS 存活 ${entries.length} 条`);
  }

  const outputs = {};
  outputs.loon = applyBlock(loonText, render("loon", entries), "[Rewrite]");
  outputs.shadowrocket = applyBlock(fs.readFileSync(FILES.shadowrocket, "utf8"), render("shadowrocket", entries), "[URL Rewrite]");
  outputs.egern = applyBlock(fs.readFileSync(FILES.egern, "utf8"), render("egern", entries), "map_locals:");

  const counts = loonCounts(outputs.loon);
  outputs.loon = updateCounts(outputs.loon, counts);

  let changed = false;
  for (const [platform, file] of Object.entries(FILES)) {
    const current = fs.readFileSync(file, "utf8");
    if (current !== outputs[platform]) {
      changed = true;
      if (CHECK) console.error("需要更新: " + path.relative(ROOT, file));
      else fs.writeFileSync(file, outputs[platform]);
    }
  }

  if (CHECK) {
    if (changed) process.exit(1);
    console.log("AdBlock 自动规则已是最新");
    return;
  }

  updateReadme(path.join(ROOT, "loon/adblock/README.md"), counts);
  updateReadme(path.join(ROOT, "egern/adblock/README.md"), counts);
  console.log(`写入完成：[Rule] ${counts.rules} 条，reject ${counts.reject}，mitm ${counts.mitm}`);
})();
