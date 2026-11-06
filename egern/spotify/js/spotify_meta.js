// Spotify 歌词开关 —— 把曲目元数据里的 has_lyrics 改成 true。
//
// 现象：没有官方歌词的歌，客户端压根不去请求 color-lyrics 接口，代理层拦不到任何东西。
// 原因：Spotify 的 Track 消息（librespot protocol/proto/metadata.proto）里有
//   message Track { ... optional bool has_lyrics = 18; ... }
// 客户端拿到 false 就直接显示「无歌词」，不再发请求。
//
// 做法：只处理 /metadata/4/track/ 的响应（顶层就是 Track 消息），把字段 18 写成 1，
// 让客户端以为这首有歌词，从而去请求 color-lyrics，再由 spotify_lyrics.js 注入。
// 其余字节原样写回，不认识的字段、字段顺序都不动。

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || {};

  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { verbose_log: raw[0] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const verbose = !(opt.verbose_log === false || opt.verbose_log === "false" || opt.verbose_log === 0 || opt.verbose_log === "0");
  const log = (msg) => {
    if (verbose) console.log("spotify-meta: " + msg);
  };
  const notify = (msg) => {
    if (!verbose) return;
    if (typeof $notification === "undefined" || !$notification || "function" != typeof $notification.post) return;
    try {
      $notification.post("Spotify 元数据", "has_lyrics", msg);
    } catch (e) {
      // 通知失败不影响主流程
    }
  };

  const bytes = toBytes(res.body);
  if (!bytes.length) {
    $done({});
    return;
  }

  const patched = patchHasLyrics(bytes);
  if (!patched) {
    log("解析失败，原样放行");
    $done({});
    return;
  }

  if (patched.changed) {
    log("has_lyrics -> true（" + patched.mode + "）");
    notify("改成 true（" + patched.mode + "）");
  }

  $done({ body: patched.bytes });

  // ---- 工具 -------------------------------------------------------------

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }

  function readVarint(source, pos) {
    let value = 0;
    let shift = 0;
    while (pos < source.length) {
      const byte = source[pos];
      value += (byte & 0x7f) * Math.pow(2, shift);
      pos += 1;
      if ((byte & 0x80) === 0) return { value: value, next: pos };
      shift += 7;
      if (shift > 56) break;
    }
    return { value: 0, next: -1 };
  }

  // 顶层字段逐个抄写，遇到 field 18 / wire 0 就把值换成 1；没有就补一个。
  function patchHasLyrics(source) {
    const out = [];
    let pos = 0;
    let found = false;
    let changed = false;
    let mode = "";

    const copy = (from, to) => {
      for (let i = from; i < to; i += 1) out.push(source[i]);
    };

    while (pos < source.length) {
      const start = pos;
      const key = readVarint(source, pos);
      if (key.next < 0) return null;
      pos = key.next;

      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      let end;

      if (wire === 0) {
        const value = readVarint(source, pos);
        if (value.next < 0) return null;
        pos = value.next;
        end = pos;
        if (field === 18) {
          copy(start, key.next);
          out.push(1);
          found = true;
          if (value.value !== 1) {
            changed = true;
            mode = "was " + value.value;
          }
          continue;
        }
      } else if (wire === 2) {
        const len = readVarint(source, pos);
        if (len.next < 0) return null;
        pos = len.next + len.value;
        end = pos;
      } else if (wire === 5) {
        pos += 4;
        end = pos;
      } else if (wire === 1) {
        pos += 8;
        end = pos;
      } else {
        return null;
      }

      if (end > source.length) return null;
      copy(start, end);
    }

    if (!found) {
      // field 18, wire 0 -> tag = 18 * 8 = 144 = 0x90 0x01
      out.push(0x90, 0x01, 0x01);
      changed = true;
      mode = "was missing";
    }

    return { bytes: new Uint8Array(out), changed: changed, mode: mode };
  }
})();
