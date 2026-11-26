//======
// Spotify Names — 界面名称字形（Pathfinder JSON + spclient 列表 protobuf）
//
// 新版客户端里，歌单 / 专辑 / 歌手 / 搜索 / 资料库并不只走 metadata map：
//   - api-partner.spotify.com/pathfinder 是 GraphQL JSON
//   - spclient 的 playlist/v2、collection/v2、searchview、album/v2、
//     artist/v2、metadata/4/album|artist 等是 protobuf
// 这里统一把它们里面的名称转成简体。
//
// 只改「看起来是文本」的字段：能按 UTF-8 严格解码、且没有控制字符。
// 这样 URI / ID / 图片 / 二进制块不会被误改；含日文假名的文本整段跳过。
// fold() 繁→简保持 UTF-8 字节长度，所以 protobuf 可以原地重写，不用重排长度。
//======

(() => {
  "use strict";

  // 只接收一个参数：meta_script。Loon 传位置数组，Egern 传 env 对象，
  // 手写 JSON 参数时是字符串，三种都兼容。
  const raw = typeof $argument !== "undefined" ? $argument : undefined;
  let value = "";
  if (Array.isArray(raw)) {
    value = raw[0];
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "{}");
      value = parsed && parsed.meta_script;
    } catch (e) {
      value = "";
    }
  } else if (raw && "object" == typeof raw) {
    value = raw.meta_script;
  }
  const mode = value === undefined || value === null ? "" : String(value).trim().toLowerCase();
  const metaHans =
    mode === "hans" || mode === "simplified" || mode === "zh-hans" || mode === "true" || mode === "1";
  if (!metaHans || typeof SPOTIFY_HAN_VARIANTS === "undefined") {
    $done({});
    return;
  }

  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  // 统一拿字节：JSON 与 protobuf 都从字节判断。
  let bytes;
  const body = res.body;
  if (typeof body === "string") {
    bytes = WIRE_TEXT.encode(body);
  } else if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
  } else if (body && body.buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(body.buffer, body.byteOffset || 0, body.byteLength);
  } else {
    $done({});
    return;
  }
  if (!bytes || !bytes.length || bytes.length > 12 * 1024 * 1024) {
    $done({});
    return;
  }

  const KANA = /[\u3040-\u30ff]/;
  const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

  function foldText(text) {
    if (!text || KANA.test(text)) return text;
    return SPOTIFY_HAN_VARIANTS.fold(text);
  }

  // ---------------- JSON（Pathfinder / playlist attributes） ----------------
  // 只改名称类字段，避免碰描述、简介、HTML 等其它文本。
  const NAME_KEY = /^(?:name|title)$|(?:Name|Title)$/;
  const SKIP_KEY = { uri: 1, url: 1, id: 1, shareUrl: 1, image: 1, src: 1, href: 1 };

  function walkJson(node) {
    if (!node || "object" != typeof node) return false;
    let changed = false;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        if (walkJson(node[i])) changed = true;
      }
      return changed;
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (typeof val === "string") {
        if (SKIP_KEY[key] || !NAME_KEY.test(key)) continue;
        const next = foldText(val);
        if (next !== val) {
          node[key] = next;
          changed = true;
        }
      } else if (val && "object" == typeof val) {
        if (walkJson(val)) changed = true;
      }
    }
    return changed;
  }

  const asJson = () => {
    const text = new TextDecoder("utf-8").decode(bytes);
    const trimmed = text.replace(/^[\s\uFEFF]+/, "");
    if (!trimmed || (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  };

  const isJsonUrl = /\/pathfinder\//.test(res.url || (typeof $request !== "undefined" && $request && $request.url) || "");
  const json = asJson();
  if (json) {
    if (walkJson(json)) $done({ body: JSON.stringify(json) });
    else $done({});
    return;
  }
  if (isJsonUrl) {
    // pathfinder 只处理 JSON；解析失败（gzip / zstd 未解压）原样放行。
    $done({});
    return;
  }

  // ---------------- protobuf（spclient 列表 / 实体） ----------------
  const fields = parse(bytes);
  if (!fields || !allCanonical(fields)) {
    $done({});
    return;
  }

  // 严格 UTF-8 且无控制字符才当作文本；URI / ID / 图片 / 二进制都不会命中。
  function asText(payload) {
    let text;
    try {
      text = WIRE_UTF8.decode(payload);
    } catch (e) {
      return null;
    }
    if (!text || CONTROL.test(text)) return null;
    return text;
  }

  function foldFields(list) {
    let changed = false;
    for (const f of list) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      const text = asText(f.p);
      if (text !== null) {
        const next = foldText(text);
        if (next === text) continue;
        const encoded = WIRE_TEXT.encode(next);
        // 理论上等长；万一不等就跳过，绝不改写长度字段。
        if (encoded.length !== f.p.length) continue;
        f.p = encoded;
        changed = true;
        continue;
      }
      const sub = parse(f.p);
      if (sub && foldFields(sub)) {
        f.p = serialize(sub);
        changed = true;
      }
    }
    return changed;
  }

  if (!foldFields(fields)) {
    $done({});
    return;
  }
  $done({ body: serialize(fields) });
})();