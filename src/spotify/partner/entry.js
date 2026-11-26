//======
// Spotify Pathfinder — GraphQL 响应里的名称字形
//
// 首页 / 搜索 / 歌单 / 专辑 / 歌手页在较新的客户端里走
// api-partner.spotify.com/pathfinder（JSON，GraphQL persisted query），
// 不经过 spclient 的 metadata map，所以需要单独在这一层转名称。
//
// 只改名称类字段（name / title / xxxName / xxxTitle），含日文假名的名称、
// URI / URL / id 等保持原样；meta_script=source（默认）时立即放行。
//======

(() => {
  "use strict";

  // 这个脚本只接收一个参数：meta_script。Loon 传位置数组，Egern 传 env 对象，
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

  let body = res.body;
  if (typeof body !== "string") {
    try {
      if (body instanceof ArrayBuffer) body = new TextDecoder("utf-8").decode(new Uint8Array(body));
      else if (body && body.buffer instanceof ArrayBuffer) body = new TextDecoder("utf-8").decode(new Uint8Array(body.buffer));
      else {
        $done({});
        return;
      }
    } catch (e) {
      $done({});
      return;
    }
  }
  // pathfinder 响应通常几十 KB；超过 8MB 直接放行，避免异常响应占满内存。
  if (!body || body.length > 8 * 1024 * 1024) {
    $done({});
    return;
  }

  let root;
  try {
    root = JSON.parse(body);
  } catch (e) {
    $done({});
    return;
  }
  if (!root || "object" != typeof root) {
    $done({});
    return;
  }

  const KANA = /[\u3040-\u30ff]/;
  // name / title 是 pathfinder 里最常见的名称字段，trackName / albumName 等
  // 变体一并覆盖；URI、URL、id 之类不动。
  const NAME_KEY = /^(?:name|title)$|(?:Name|Title)$/;
  const SKIP_KEY = { uri: 1, url: 1, id: 1, shareUrl: 1, image: 1, src: 1, href: 1 };

  function convert(text) {
    if (!text || KANA.test(text)) return text;
    return SPOTIFY_HAN_VARIANTS.fold(text);
  }

  function walk(node) {
    if (!node || "object" != typeof node) return false;
    let changed = false;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        if (walk(node[i])) changed = true;
      }
      return changed;
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (typeof val === "string") {
        if (SKIP_KEY[key] || !NAME_KEY.test(key)) continue;
        const next = convert(val);
        if (next !== val) {
          node[key] = next;
          changed = true;
        }
      } else if (val && "object" == typeof val) {
        if (walk(val)) changed = true;
      }
    }
    return changed;
  }

  if (!walk(root)) {
    $done({});
    return;
  }
  $done({ body: JSON.stringify(root) });
})();
