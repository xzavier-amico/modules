//=======================================================================================
// pluto — pluto_manifest.js
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// Pluto TV 字幕轨改名 — Loon / Egern / Shadowrocket.
//
// 主清单里的字幕轨声明长这样：
//
//   #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",
//     DEFAULT=NO,FORCED=NO,URI="subtitle/subs/en/playlist.m3u8?...",LANGUAGE="en"
//
// 字幕内容由 pluto_subtitle.js 翻译成中文（默认双语）。这里不改原轨道，而是复制
// 一条 NAME="Chinese"、LANGUAGE="zh" 的字幕轨指向同一个 URI：播放器支持中文标签
// 就能在菜单里看到「Chinese」，不支持也不会影响原来那条英文轨。
// URI / GROUP-ID 保持原样，避免播放器找不到字幕播放列表。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  // Loon 传位置数组，Egern / Shadowrocket 传 JSON 字符串，两种都兼容。
  // 位置：block_ads, caption_lang, bilingual, translate_key, translate_provider
  // 后三个这里用不到，保留位置只是为了和插件里的参数顺序对齐。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      opt = {
        block_ads: raw[0],
        caption_lang: raw[1],
        bilingual: raw[2],
        translate_key: raw[3],
        translate_provider: raw[4],
        web: raw[5],
      };
    } else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }

  const normalizeLang = (v) => {
    if (v === undefined || v === null) return "";
    const s = String(v).trim();
    if (!s || /^off$/i.test(s)) return "";
    if (/^zh(?:[-_]?hans)?$/i.test(s)) return "zh-Hans";
    if (/^zh[-_]?hant$/i.test(s)) return "zh-Hant";
    return "";
  };
  if (!normalizeLang(opt.caption_lang ?? opt.captionLang ?? "zh-Hans")) {
    $done({});
    return;
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  // 网页版 stitcher 请求带 appName=web / deviceType=web；关闭网页版后只处理 App。
  if (!flag(opt.web, true) && /[?&](?:appName|deviceType)=web(?:[&#]|$)/i.test(url)) {
    $done({});
    return;
  }

  // 只改主清单，媒体清单和字幕播放列表原样放行。
  if (!/\/master\.m3u8(?:[?#]|$)/i.test(url)) {
    $done({});
    return;
  }

  const status = Number(res.status || res.statusCode || 0);
  if (status >= 400) {
    $done({});
    return;
  }

  let body = res.body;
  if (body === null || body === undefined) {
    $done({});
    return;
  }
  if (typeof body !== "string") {
    if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    if (!ArrayBuffer.isView(body)) {
      $done({});
      return;
    }
    try {
      body = new TextDecoder("utf-8").decode(body);
    } catch (e) {
      $done({});
      return;
    }
  }
  if (!body || body.length > 1024 * 1024 || body.indexOf("#EXTM3U") < 0 || !/TYPE=SUBTITLES/i.test(body)) {
    $done({});
    return;
  }

  const newline = /\r\n/.test(body) ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  // 已经有中文字幕轨就不重复加。
  let hasZh = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=SUBTITLES/i.test(line)) continue;
    if (
      /(?:^|,)\s*LANGUAGE="zh(?:[-_][A-Za-z0-9]+)?"/i.test(line) ||
      /(?:^|,)\s*NAME="(?:Chinese|中文)/i.test(line)
    ) {
      hasZh = true;
      break;
    }
  }

  const out = [];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    if (hasZh) continue;
    if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=SUBTITLES/i.test(line)) continue;
    // 只复制英文字幕轨；多语言点播里别的语种保持原样。
    if (!/(?:^|,)\s*LANGUAGE="en(?:[-_][A-Za-z0-9]+)?"/i.test(line) && !/(?:^|,)\s*NAME="English/i.test(line)) {
      continue;
    }
    let zh = line.replace(/((?:^|,)\s*NAME=")[^"]*(")/i, "$1Chinese$2");
    zh = zh.replace(/((?:^|,)\s*LANGUAGE=")[^"]*(")/i, "$1zh$2");
    zh = zh.replace(/((?:^|,)\s*DEFAULT=)[A-Z]+/i, "$1NO");
    zh = zh.replace(/((?:^|,)\s*AUTOSELECT=)[A-Z]+/i, "$1NO");
    zh = zh.replace(/((?:^|,)\s*FORCED=)[A-Z]+/i, "$1NO");
    if (zh !== line) {
      out.push(zh);
      changed = true;
    }
  }

  if (!changed) {
    $done({});
    return;
  }
  $done({ body: out.join(newline) });
})();
