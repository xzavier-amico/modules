//=======================================================================================
// pluto — pluto_hls.js
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


const ENV_BODY_BINARY = false;

//=====================================================================================
// Egern 原生模式适配层
//
// Egern 的脚本入口是 export default async function (ctx)，参数从 ctx.env 读；
// 而 Loon / Shadowrocket 用的仍是 Surge 兼容全局（$request / $response / $done /
// $persistentStore / $argument）。为了三端共用同一份脚本主体，这里把 ctx 适配成
// 那几个全局变量，脚本主体一行都不用改。
//
// 参数：env_schema 生成的设置项会以字符串写进 ctx.env，直接作为 $argument 交给脚本；
// 各脚本的 flag() / asBool() 已经能处理 "true" / "false" 字符串。
//=====================================================================================

export default async function (ctx) {
  const plainHeaders = (headers) => {
    const out = {};
    if (!headers) return out;
    if ("function" == typeof headers.forEach) {
      headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    for (const key of Object.keys(headers)) out[key] = headers[key];
    return out;
  };

  // ctx 的 body 是只能读一次的流，先整体读出来交给兼容代码按字符串 / 字节处理。
  // 文本脚本按字符串给 body，protobuf / 二进制脚本给字节。
  // 构建时按目标注入 ENV_BODY_BINARY。
  const binaryBody = "undefined" != typeof ENV_BODY_BINARY && ENV_BODY_BINARY;
  const readBody = async (message) => {
    if (!message || !message.body) return undefined;
    try {
      const bytes = new Uint8Array(await message.arrayBuffer());
      return binaryBody ? bytes : new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      return undefined;
    }
  };

  const requestBody = await readBody(ctx.request);
  const responseBody = await readBody(ctx.response);

  const request = ctx.request
    ? { url: ctx.request.url, method: ctx.request.method, headers: plainHeaders(ctx.request.headers), body: requestBody }
    : undefined;
  const response = ctx.response
    ? {
        url: ctx.request && ctx.request.url,
        status: ctx.response.status,
        statusCode: ctx.response.status,
        headers: plainHeaders(ctx.response.headers),
        body: responseBody,
      }
    : undefined;

  // $httpClient 的 callback 形式（error, response, data）。
  const httpOptions = (options) => ("string" == typeof options ? { url: options } : options || {});
  const httpCall = (method, options, callback) => {
    const opt = httpOptions(options);
    Promise.resolve()
      .then(() =>
        ctx.http[method](opt.url, {
          headers: opt.headers,
          body: opt.body,
          timeout: opt.timeout,
        }),
      )
      .then(async (res) => {
        const headers = plainHeaders(res.headers);
        callback(null, { status: res.status, statusCode: res.status, headers }, await res.text());
      })
      .catch((error) => callback(error || new Error("request failed"), null, null));
  };

  // 数组是 Loon 旧版的位置参数，原样透传，脚本自己按位置还原。
  const $argument = Array.isArray(ctx.env) ? ctx.env : Object.assign({}, ctx.env || {});
  const $request = request;
  const $response = response;
  const $persistentStore = {
    read: (key) => (ctx.storage ? ctx.storage.get(key) : null),
    write: (value, key) => {
      if (ctx.storage) ctx.storage.set(key, value);
      return true;
    },
  };
  const $httpClient = {
    get: (options, callback) => httpCall("get", options, callback),
    post: (options, callback) => httpCall("post", options, callback),
  };

  return await new Promise((resolve) => {
    let settled = false;

    // 把 $done 的返回值翻译成 ctx 的返回值。
    const finish = (value) => {
      if (settled) return;
      settled = true;

      // 请求阶段直接返回本地响应。
      if (value && value.response) {
        resolve(ctx.respond ? ctx.respond(value.response) : value.response);
        return;
      }

      const body = ctx.response ? responseBody : requestBody;

      // 原样放行：body 已经被读走，必须显式还回去，否则请求 / 响应体会变成空。
      if (!value || !Object.keys(value).length) {
        resolve(body === undefined ? undefined : { body });
        return;
      }

      const next = Object.assign({}, value);
      if (next.body === undefined && body !== undefined) next.body = body;
      resolve(next);
    };

    function $done(value) {
      finish(value);
    }

    try {

// Pluto TV Clean — HLS 点播清单过滤。
//
// 实测一份带广告的清单（美国直播流，广告时段）长这样：
//
//   #EXT-X-DISCONTINUITY
//   #EXT-X-PROGRAM-DATE-TIME:2026-11-07T03:23:47.667Z
//   #EXT-X-KEY:...URI=".../494_Pluto_TV_OandO/clip/58e5..._plutotv_error_30_.../hls_300_keyfile_0.key"
//   #EXTINF:5,
//   https://siloh-ns1.plutotv.net/494_Pluto_TV_OandO/clip/58e5..._plutotv_error_30_.../hls_300-00000.ts
//
// 也就是说：广告没有 _ad/creative 这类标记，也没有 EXT-X-CUE-OUT，它只是
// **另一个 clip 的分片**，路径前缀和正片完全不同（正片是 .../c6009f_pluto/clip/604b...）。
//
// 所以按 clip 分组判断：同一部片子的所有分片都在同一个 clip 目录下，广告来自别的
// clip。按 clip 累计时长，占绝对大头的是正片，占比很小的 clip 整组删掉。
//
// 注意分组键必须取 clip ID，而不是分片所在的目录：点播清单会把同一部片子切成
// 多个 range 目录（.../clip/<content>/720p/.../hls/0-1155588、1155589-2447457 …），
// 按目录分组会把它们当成不同 clip，短的那个 range 会被误删。clip ID 是
// /clip/<id>/ 或 /creative/<id>/ 里的 <id>，同一部片子的所有 range 共用一个 ID。
//
// 分片地址可能是相对路径，先按清单 URL 解析成绝对路径再取 clip ID；写回清单时
// 仍然保留原始地址，交给播放器自己解析。
//
// 只处理点播清单。直播清单原样放行——直播删段会让客户端在缓冲里跳段、反复重缓冲。
// 点播除了 #EXT-X-ENDLIST / PLAYLIST-TYPE:VOD，还认 URL 里的 /vod/、/movie/、
// /episode/：stitcher 的点播会话有时也是滚动窗口（只有几个分片、media sequence
// 不为 0），只看清单内容会把它当成直播漏掉。
//
// 明确广告标记独立过滤；无标记的短 clip 只在完整点播清单有主要内容时推断。
// 删段时恢复有效 KEY / MAP，显式补 AES-128 IV，保留原有不连续边界。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  // Loon 传位置数组，Egern 传 JSON 字符串，两种都兼容。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { block_ads: raw[0], web: raw[1] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  if (!flag(opt.block_ads, true)) {
    $done({});
    return;
  }
  // 网页版 stitcher 请求带 appName=web / deviceType=web；关闭网页版后只处理 App。
  if (!flag(opt.web, true) && /[?&](?:appName|deviceType)=web(?:[&#]|$)/i.test(url)) {
    $done({});
    return;
  }

  const host = ((url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").split(":")[0].toLowerCase();
  if (!/(^|\.)pluto\.tv$/.test(host) && !/(^|\.)plutotv\.net$/.test(host)) {
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
  if (!body || body.indexOf("#EXTM3U") < 0) {
    $done({});
    return;
  }
  if (body.length > 4 * 1024 * 1024) {
    $done({});
    return;
  }

  // master 清单里没有分片，直接放行。
  if (body.indexOf("#EXT-X-STREAM-INF") >= 0) {
    $done({});
    return;
  }

  const lines = body.split(/\r?\n/);

  // 第一段 #EXTINF 之前都是全局头（EXTM3U / VERSION / TARGETDURATION / KEY…）。
  let first = 0;
  while (first < lines.length && !/^#EXTINF:/i.test(lines[first].trim())) first++;
  if (first >= lines.length) {
    $done({});
    return;
  }
  const head = [];
  const initialTags = [];
  for (let i = 0; i < first; i++) {
    const t = lines[i].trim();
    if (/^#EXT-X-(?:KEY:|MAP:|DISCONTINUITY$|PROGRAM-DATE-TIME:|CUE-)/i.test(t)) initialTags.push(t);
    else if (t) head.push(t);
  }

  // 切块：每块 = 若干标签 + 一行分片地址。
  // 实测点播清单在 range 边界会出现只有 #EXTINF、没有分片地址的空块；这种块不能
  // 直接写回去，但它的 KEY / DISCONTINUITY / ENDLIST 标签要留给下一块或清单尾。
  const blocks = [];
  let cur = null;
  let next = initialTags;
  for (let i = first; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.charAt(0) === "#") {
      if (/^#EXTINF:/i.test(t)) {
        if (cur && !cur.uri) {
          for (let j = 0; j < cur.tags.length; j++) {
            if (!/^#EXTINF:/i.test(cur.tags[j])) next.push(cur.tags[j]);
          }
          blocks.pop();
        }
        const m = /^#EXTINF:\s*([0-9.]+)/i.exec(t);
        cur = { tags: next.concat([t]), uri: "", dur: m ? parseFloat(m[1]) : 0 };
        next = [];
        blocks.push(cur);
      } else if (cur && !cur.uri) {
        cur.tags.push(t);
      } else {
        next.push(t);
      }
      continue;
    }
    if (cur && !cur.uri) {
      cur.uri = t;
      cur = null;
    }
  }
  if (cur && !cur.uri) {
    for (let j = 0; j < cur.tags.length; j++) {
      if (!/^#EXTINF:/i.test(cur.tags[j])) next.push(cur.tags[j]);
    }
    blocks.pop();
  }
  const tail = next;

  // 点播判定：有 ENDLIST、声明 VOD/EVENT、URL 带 /vod/ /movie/ /episode/，或长清单
  // 且 media sequence 为 0。stitcher 的点播会话有时是滚动窗口（只有几个分片、
  // media sequence 不为 0），只看清单内容会当成直播漏掉。
  let mediaSeq = 0;
  const mseq = /#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/i.exec(body);
  if (mseq) mediaSeq = BigInt(mseq[1]);
  const pathOnly = url.split("#")[0].split("?")[0];
  const explicitLive = /\/channel\//i.test(pathOnly);
  const complete = /#EXT-X-ENDLIST|#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(body);
  const isVod =
    !explicitLive && (
    /\/(?:vod|movie|episode|series|show)\//i.test(pathOnly) ||
    /[?&](?:episodeId|movieId|vodId)=/i.test(url) ||
    /[?&]contentType=(?:vod|movie|episode)/i.test(url) ||
    body.indexOf("#EXT-X-ENDLIST") >= 0 ||
    /#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(body) ||
    (blocks.length >= 60 && BigInt(mediaSeq) === 0n));
  if (!isVod) {
    $done({});
    return;
  }

  // 分片地址可能是相对路径，先按清单 URL 解析成绝对路径，只用于取 clip ID。
  const origin = (pathOnly.match(/^https?:\/\/[^/]+/i) || [""])[0];
  const baseDir = pathOnly.replace(/\/[^/]*$/, "/");
  const absUri = (u) => {
    if (/^https?:\/\//i.test(u)) return u;
    if (u.indexOf("//") === 0) return (/^https:/i.test(pathOnly) ? "https:" : "http:") + u;
    if (u.charAt(0) === "/") return origin + u;
    return baseDir + u;
  };

  // clip ID：/clip/<id>/ 或 /creative/<id>/ 里的 <id>。同一部片子的所有 range
  // 目录（.../hls/0-1155588、.../hls/1155589-2447457）共用一个 clip ID。
  const clipKey = (u) => {
    const noq = u.split("?")[0];
    const m = /\/(?:clip|creative)\/([^/]+)/i.exec(noq);
    return m ? m[1] : "";
  };

  // 分片地址可能是相对路径（只有文件名），这时用当前生效的 EXT-X-KEY URI 取 clip ID；
  // key URI 也是绝对地址，和分片在同一个 clip 目录下。第一段的 key 可能在清单头里，
  // 后面的 key 会按段轮换，所以按顺序维护一个“当前 key”。
  const keyUriOf = (t) => {
    const m = /^#EXT-X-KEY:.*URI="([^"]+)"/i.exec(t);
    return m ? m[1] : "";
  };
  let curKey = "";
  let keyTag = "";
  let mapTag = "";
  let mapKeyTag = "";
  let cue = false;
  let rangeEnd = 0;
  let rangeUri = "";
  const blockKeys = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const tags = b.tags;
    for (let j = 0; j < tags.length; j++) {
      const t = tags[j];
      if (/^#EXT-X-KEY:/i.test(t)) {
        // 多 KEYFORMAT 和隐式 MAP byte range 不能由单个状态安全复原。
        if (/KEYFORMAT="(?!identity")/i.test(t)) { $done({}); return; }
        keyTag = t;
        curKey = keyUriOf(t);
      } else if (/^#EXT-X-MAP:/i.test(t)) {
        if (/BYTERANGE="\d+"/i.test(t)) { $done({}); return; }
        mapTag = t;
        mapKeyTag = keyTag;
        if (/METHOD=AES-128(?:,|$)/i.test(mapKeyTag) && !/[, :]IV=/i.test(mapKeyTag)) { $done({}); return; }
      } else if (/^#EXT-X-CUE-IN(?:$|:)/i.test(t)) cue = false;
      else if (/^#EXT-X-CUE-OUT(?:$|:|-CONT:)/i.test(t)) cue = true;
      const range = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?/i.exec(t);
      if (range) {
        if (range[2] === undefined && rangeUri !== b.uri) { $done({}); return; }
        const offset = range[2] === undefined ? rangeEnd : Number(range[2]);
        tags[j] = "#EXT-X-BYTERANGE:" + range[1] + "@" + offset;
        rangeEnd = offset + Number(range[1]);
        rangeUri = b.uri;
      }
    }
    b.keyTag = keyTag;
    b.mapTag = mapTag;
    b.mapKeyTag = mapKeyTag;
    b.inCue = cue;
    b.index = i;
    blockKeys.push(curKey);
  }

  const keyOfBlock = (b, keyUri) => {
    const direct = b.uri ? clipKey(absUri(b.uri)) : "";
    if (direct) return direct;
    const fromKey = keyUri ? clipKey(absUri(keyUri)) : "";
    if (fromKey) return fromKey;
    const u = b.uri ? absUri(b.uri) : "";
    const i = u.lastIndexOf("/");
    return i > 0 ? u.slice(0, i) : u;
  };

  const groupDur = Object.create(null);
  const maxRun = Object.create(null);
  let runKey = "";
  let runDur = 0;
  let total = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b.uri) continue;
    total += b.dur;
    const k = keyOfBlock(b, blockKeys[i]);
    b.clip = k;
    groupDur[k] = (groupDur[k] || 0) + b.dur;
    runDur = k === runKey ? runDur + b.dur : b.dur;
    runKey = k;
    maxRun[k] = Math.max(maxRun[k] || 0, runDur);
  }
  let biggest = 0;
  for (const k in groupDur) if (groupDur[k] > biggest) biggest = groupDur[k];

  const isAdBlock = (b, k, keyUri) => {
    const hay = b.uri + " " + keyUri + " " + b.tags.join(" ");
    return (
      /_ad(?:%2F|%252F|\/)(?:creative|bumper)/i.test(hay) ||
      /_ad[_-]?bumper/i.test(hay) ||
      /\/creative\//i.test(hay) ||
      /(?:^|[_-])ad$/i.test(k) ||
      /_plutotv_error_\d+/i.test(hay)
    );
  };
  const cueTag = /^#EXT-X-CUE-(?:IN|OUT)(?:$|:|-CONT:)/i;
  const discTag = /^#EXT-X-DISCONTINUITY$/i;
  const stateTag = /^#EXT-X-(?:KEY|MAP):/i;

  const kept = [];
  let keptDur = 0;
  let dropped = 0;
  const inferred = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // 清单里偶尔有只有 #EXTINF、没有分片地址的空块（实测点播 range 边界会出现），
    // 这种块写回去也是非法行，直接丢掉；没有广告时 dropped 仍为 0，整份清单放行。
    if (!b.uri) continue;

    const k = b.clip;
    // 广告判定：带广告标记 / 落在 CUE 区间 / 所在 clip 占比明显偏小。
    // 分组键是 clip ID，正片的多个 range 目录会合并成一个组，不会被误判。
    // 用每次连续出现的时长，不把同一个广告在全片的重复次数累计到 60 秒门槛里。
    const smallGroup = complete && k && biggest >= 120 && biggest >= total * 0.5 && groupDur[k] < biggest * 0.5 && maxRun[k] <= 60.5;
    if (isAdBlock(b, k, blockKeys[i]) || b.inCue) {
      dropped++;
      continue;
    }
    if (smallGroup) { inferred.push(b); continue; }
    kept.push({ b: b, k: k });
    keptDur += b.dur;
  }

  // 60% 保护只约束时长推断；明确广告不能被这条保护重新放回来。
  if (keptDur >= total * 0.6) dropped += inferred.length;
  else {
    for (const b of inferred) kept.push({ b: b, k: b.clip });
    kept.sort((a, b) => a.b.index - b.b.index);
  }
  if (dropped === 0 || !kept.length) {
    $done({});
    return;
  }
  const out = head.slice();
  let prevKey = null;
  let previousIndex = -1;
  let emittedKey = "";
  let emittedMap = "";
  const leading = kept[0].b.index;
  for (let i = 0; i < out.length; i++) {
    if (/^#EXT-X-MEDIA-SEQUENCE:/i.test(out[i]) && mediaSeq >= 0) out[i] = "#EXT-X-MEDIA-SEQUENCE:" + (BigInt(mediaSeq) + BigInt(leading));
  }
  if (!mseq && leading) out.push("#EXT-X-MEDIA-SEQUENCE:" + leading);
  for (let i = 0; i < kept.length; i++) {
    const b = kept[i].b;
    const k = kept[i].k;
    const tags = [];
    let hasDisc = false;
    for (let j = 0; j < b.tags.length; j++) {
      const t = b.tags[j];
      if (cueTag.test(t) || stateTag.test(t)) continue;
      if (discTag.test(t)) hasDisc = true;
      tags.push(t);
    }
    // 删除了中间片段时也保留一个边界，不能假定同 clip 的时间戳一定连续。
    if (prevKey !== null && (k !== prevKey || b.index !== previousIndex + 1) && !hasDisc) tags.unshift("#EXT-X-DISCONTINUITY");
    let effectiveKey = b.keyTag;
    if (/METHOD=AES-128(?:,|$)/i.test(effectiveKey) && !/[, :]IV=/i.test(effectiveKey)) {
      if (mediaSeq < 0) { $done({}); return; }
      effectiveKey += ",IV=0x" + (BigInt(mediaSeq) + BigInt(b.index)).toString(16).padStart(32, "0");
    }
    if (b.mapTag && b.mapTag !== emittedMap) {
      const mapKey = b.mapKeyTag || (emittedKey ? "#EXT-X-KEY:METHOD=NONE" : "");
      if (mapKey && mapKey !== emittedKey) { out.push(mapKey); emittedKey = mapKey; }
      out.push(b.mapTag);
      emittedMap = b.mapTag;
    }
    effectiveKey = effectiveKey || (emittedKey ? "#EXT-X-KEY:METHOD=NONE" : "");
    if (effectiveKey && effectiveKey !== emittedKey) { out.push(effectiveKey); emittedKey = effectiveKey; }
    for (let j = 0; j < tags.length; j++) out.push(tags[j]);
    out.push(b.uri);
    prevKey = k;
    previousIndex = b.index;
  }
  for (let i = 0; i < tail.length; i++) {
    if (cueTag.test(tail[i]) || stateTag.test(tail[i]) || discTag.test(tail[i])) continue;
    out.push(tail[i]);
  }

  $done({ body: out.join("\n") + "\n" });
})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
