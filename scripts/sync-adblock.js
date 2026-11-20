#!/usr/bin/env node
"use strict";

// 同步 AdBlock 的自动规则块（MetaCubeX category-ads-all + 秋风 AWAvenue）。
//
// 规则与重写分开维护，避免插件 / 模块过大：
//   loon/adblock/adblock.plugin       只放 Rewrite + MITM
//   loon/adblock/adblock.list         只放域名 REJECT 规则（Loon 远程规则）
//   egern/adblock/adblock.yaml        只放 url_rewrites / map_locals / mitm + rule_set 引用
//   egern/adblock/adblock.rules.yaml  由 adblock.list 生成的 Egern 规则集
//   shadowrocket/adblock/adblock.sgmodule 只放 URL Rewrite + MITM + RULE-SET 引用
//   shadowrocket/adblock/adblock.list     与 adblock.list 内容一致
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

// 上游把 CapCut 的 tnc* CDN 也列进了广告域名，拦了会卡播放。
// 原插件用一条 AND ... DIRECT 例外放行；拆成纯 REJECT 列表后改为同步时排除。
const TNC_SUFFIXES = [
  "capcutapi.com",
  "zijieapi.com",
  "isnssdk.com",
  "toutiaoapi.com",
  "bytedance.com",
  "snssdk.com",
  "sgsnssdk.com",
];

// HTTPDNS / 私有 DNS 端点不拦：会让 App 正常解析直接失败，
// 而广告域名已经有 DOMAIN / DOMAIN-SUFFIX 兜底，收益很低。
const NON_AD_DNS = new Set([
  "aedns.weixin.qq.com",
  "dns.jd.com",
  "dns.weibo.cn",
  "dns.weixin.qq.com",
  "dns.weixin.qq.com.cn",
  "doh.iqiyi.com",
  "httpsdns.baidu.com",
]);

function isNonAdDns(value) {
  const v = value.toLowerCase();
  return v.includes("httpdns") || NON_AD_DNS.has(v);
}

const FILES = {
  loonPlugin: path.join(ROOT, "loon/adblock/adblock.plugin"),
  loonList: path.join(ROOT, "loon/adblock/adblock.list"),
  egernRules: path.join(ROOT, "egern/adblock/adblock.rules.yaml"),
  shadowrocketList: path.join(ROOT, "shadowrocket/adblock/adblock.list"),
};

const REPO_RAW = "https://raw.githubusercontent.com/xzavier-amico/modules/master";

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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isTncCdn(value) {
  const v = value.toLowerCase();
  return v.includes("tnc") && TNC_SUFFIXES.some((s) => v === s || v.endsWith("." + s));
}

// 手工规则（自动块之外）已经覆盖的域名，不再重复写入自动块。
function manualCoverage(text) {
  const body = text.replace(new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`, "g"), "");
  const suffix = new Set();
  const exact = new Set();
  for (const line of body.split("\n")) {
    let m = line.match(/^\s*DOMAIN-SUFFIX,\s*([^,]+)/i);
    if (m) { suffix.add(m[1].trim().toLowerCase()); continue; }
    m = line.match(/^\s*DOMAIN,\s*([^,]+)/i);
    if (m) { exact.add(m[1].trim().toLowerCase()); continue; }
  }
  return { suffix, exact };
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
    if (isTncCdn(item.value)) continue;
    if (isNonAdDns(item.value)) continue;
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
    .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

function renderLoonRules(entries) {
  return entries.map((x) => `${x.type === "suffix" ? "DOMAIN-SUFFIX" : "DOMAIN"},${x.value}`);
}

function applyBlock(text, lines) {
  const block = [START, ...lines, END].join("\n");
  const re = new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`);
  if (re.test(text)) return text.replace(re, block);
  return text.replace(/\s*$/, "") + "\n\n" + block + "\n";
}

function parseRuleLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function logicRegex(line) {
  if (line.includes("DOMAIN-KEYWORD, -ad-") && line.includes("DOMAIN-SUFFIX, byteimg.com")) {
    return "(?i)^.*-ad-.*\\.byteimg\\.com$";
  }
  if (line.includes("DOMAIN-KEYWORD, ads") && line.includes("DOMAIN-KEYWORD, -normal.zijieapi.com")) {
    return "(?i)^(?=.*ads)(?=.*-normal\\.zijieapi\\.com).*$";
  }
  if (line.includes("DOMAIN-KEYWORD, adash") && line.includes("DOMAIN-SUFFIX, ut.taobao.com")) {
    return "(?i)^(?=.*adash)(?=.*ut\\.taobao\\.com).*$";
  }
  return null;
}

function yamlQuote(value) {
  return "'" + value.replace(/'/g, "''") + "'";
}

function renderEgernRules(ruleLines) {
  const sets = {
    domain_set: [],
    domain_suffix_set: [],
    domain_keyword_set: [],
    ip_cidr_set: [],
    ip_cidr6_set: [],
    domain_regex_set: [],
  };
  for (const line of ruleLines) {
    const parts = line.split(",").map((x) => x.trim());
    switch (parts[0]) {
      case "DOMAIN": sets.domain_set.push(parts[1]); break;
      case "DOMAIN-SUFFIX": sets.domain_suffix_set.push(parts[1]); break;
      case "DOMAIN-KEYWORD": sets.domain_keyword_set.push(parts[1]); break;
      case "IP-CIDR": sets.ip_cidr_set.push(parts[1]); break;
      case "IP-CIDR6": sets.ip_cidr6_set.push(parts[1]); break;
      case "AND": {
        const re = logicRegex(line);
        if (!re) throw new Error("无法转换为 Egern 规则集: " + line);
        sets.domain_regex_set.push(re);
        break;
      }
      default:
        throw new Error("未知规则类型: " + line);
    }
  }
  const out = [
    "# NAME: ADBlock",
    "# AUTHOR: xzavier-amico",
    "# REPO: https://github.com/xzavier-amico/modules",
    "# DESC: 常见国内外广告、遥测与统计 SDK 的域名拦截（REJECT）",
    "#",
    "# 自动生成，请勿直接编辑。源规则在 loon/adblock/adblock.list，构建：node scripts/sync-adblock.js",
    "",
    "no_resolve: true",
  ];
  for (const [key, values] of Object.entries(sets)) {
    const unique = [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (!unique.length) continue;
    out.push(key + ":");
    for (const value of unique) out.push("  - " + yamlQuote(value));
  }
  return out.join("\n") + "\n";
}

function renderShadowrocketList(ruleLines) {
  return [
    "# NAME: ADBlock",
    "# AUTHOR: xzavier-amico",
    "# REPO: https://github.com/xzavier-amico/modules",
    "# DESC: 常见国内外广告、遥测与统计 SDK 的域名拦截（REJECT）",
    "# USAGE: Shadowrocket → 配置 → 规则 → 添加规则 → 类型 RULE-SET，策略 REJECT",
    `# URL: ${REPO_RAW}/shadowrocket/adblock/adblock.list`,
    "#",
    "# 自动生成，请勿直接编辑。源规则在 loon/adblock/adblock.list，构建：node scripts/sync-adblock.js",
    "",
    ...ruleLines,
  ].join("\n") + "\n";
}

function pluginCounts(text) {
  const lines = text.split("\n");
  const rewriteStart = lines.findIndex((l) => /^\[Rewrite\]/.test(l));
  const mitmStart = lines.findIndex((l, i) => i > rewriteStart && /^\[MITM\]/.test(l));
  if (rewriteStart < 0 || mitmStart < 0) throw new Error("adblock.plugin 缺少 [Rewrite] 或 [MITM]");
  const rewrites = lines.slice(rewriteStart + 1, mitmStart).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const rejectRewrites = rewrites.filter((l) => /reject/.test(l)).length;
  const mitm = lines
    .slice(mitmStart + 1)
    .join("\n")
    .replace(/^hostname = /, "")
    .split(",")
    .filter((x) => x.trim()).length;
  return { rewrites: rewrites.length, rejectRewrites, mitm, total: rewrites.length + mitm };
}

function updatePluginHeader(text, counts) {
  return text
    .replace(/^#!reject=.*$/m, `#!reject= ${counts.rejectRewrites}`)
    .replace(/^#!mitm=.*$/m, `#!mitm= ${counts.mitm}`)
    .replace(/^#!total=.*$/m, `#!total= ${counts.total}`);
}

function updateReadme(file, counts) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const next = text
    .replace(/\[Rewrite\] \d+ 条/g, `[Rewrite] ${counts.rewrites} 条`)
    .replace(/\[MITM\] \d+ hostnames/g, `[MITM] ${counts.mitm} hostnames`)
    .replace(/规则列表：\d+ 条/g, `规则列表：${counts.rules} 条`)
    .replace(/\d+ rules \+/g, `${counts.rules} rules +`);
  if (next !== text) fs.writeFileSync(file, next);
}

(async () => {
  const [metaText, awaText] = await Promise.all([fetchText(SOURCES.metacubex), fetchText(SOURCES.awa)]);
  let entries = [...parseMetacubex(metaText), ...parseAwa(awaText)];
  console.log(`拉取 ${entries.length} 条（MetaCubeX + 秋风）`);

  const loonText = fs.readFileSync(FILES.loonList, "utf8");
  const coverage = manualCoverage(loonText);
  entries = normalize(entries, coverage.suffix, coverage.exact);
  console.log(`去重后 ${entries.length} 条`);

  if (!NO_DNS) {
    entries = await filterLive(entries);
    console.log(`DNS 存活 ${entries.length} 条`);
  }

  const loonList = applyBlock(loonText, renderLoonRules(entries));
  const ruleLines = parseRuleLines(loonList);
  const outputs = {
    loonList,
    shadowrocketList: renderShadowrocketList(ruleLines),
    egernRules: renderEgernRules(ruleLines),
  };

  const pluginText = fs.readFileSync(FILES.loonPlugin, "utf8");
  const counts = pluginCounts(pluginText);
  outputs.loonPlugin = updatePluginHeader(pluginText, counts);

  const targets = {
    loonList: FILES.loonList,
    shadowrocketList: FILES.shadowrocketList,
    egernRules: FILES.egernRules,
    loonPlugin: FILES.loonPlugin,
  };

  let changed = false;
  for (const [key, file] of Object.entries(targets)) {
    const current = fs.readFileSync(file, "utf8");
    if (current !== outputs[key]) {
      changed = true;
      if (CHECK) console.error("需要更新: " + path.relative(ROOT, file));
      else fs.writeFileSync(file, outputs[key]);
    }
  }

  if (CHECK) {
    if (changed) process.exit(1);
    console.log("AdBlock 自动规则已是最新");
    return;
  }

  const readmeCounts = { ...counts, rules: ruleLines.length };
  updateReadme(path.join(ROOT, "loon/adblock/README.md"), readmeCounts);
  updateReadme(path.join(ROOT, "egern/adblock/README.md"), readmeCounts);
  console.log(`写入完成：规则 ${readmeCounts.rules} 条，Rewrite ${counts.rewrites} 条，MITM ${counts.mitm} hostnames`);
})();
