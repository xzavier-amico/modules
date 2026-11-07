// Spotify Lyrics Gate — 把曲目元数据里的 has_lyrics 改成 true。
//
// 客户端在 SPTPlayerTrack.metadata() 里读 has_lyrics：值是 false 就直接显示
// 「暂无歌词」，连 color-lyrics 都不请求，代理层拦不到任何东西。
//
// iOS 上这个值有两个来源，都要处理：
//
//   1. extended-metadata/v0/extended-metadata（主路径）
//      BatchedExtensionResponse
//        └ extended_metadata[] (EntityExtensionDataArray, extension_kind = TRACK_V4 = 10)
//            └ extension_data[] (EntityExtensionData)
//                └ extension_data (google.protobuf.Any)
//                    └ value = metadata.proto Track，has_lyrics = 18
//      SPTPlayerTrack.metadata() 里同时有 extracted_color 和 has_lyrics，
//      说明客户端就是拿这个接口的数据拼出来的。
//
//   2. context-resolve / connect-state 的 ContextTrack.metadata（map<string,string>）
//      作为兜底：map entry { 1: "has_lyrics", 2: "false" } 直接改值。
//
// 另外顺手兼容 /metadata/4/track/ 的顶层 Track（老接口）。
//
// 做法和 spotify_premium.js 一样：递归走 protobuf，只改目标字段，其余字节
// 原样写回，不重编码整包。

(() => {
  "use strict";

  const MARK = "has_lyrics";
  const TRACK_V4 = 10;

  function run() {
    const res = (typeof $response !== "undefined" && $response) || {};
    const url = res.url || ($request && $request.url) || "";

    let body = res.body;
    if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    if (!body || !ArrayBuffer.isView(body) || !body.length) {
      $done({});
      return;
    }
    if (body.length > 8 * 1024 * 1024) {
      $done({});
      return;
    }

    const stat = { n: 0 };
    let out = null;
    let source = "";

    if (/\/metadata\/4\/track\//.test(url)) {
      // 顶层就是 Track
      const fields = parse(body);
      if (fields && patchTrack(fields, stat)) out = serialize(fields);
      source = "track";
    } else {
      const fields = parse(body);
      if (fields && patchFields(fields, 0, stat)) out = serialize(fields);
      source = url.indexOf("context-resolve") >= 0 ? "ctx" : "track";
    }

    if (!out) {
      $done({});
      return;
    }

    // 临时探针：确认到底哪条响应被改了。验证通过后删掉。
    // 每个来源只提示一次，避免滚动/轮询刷屏。
    try {
      const key = "spotify_lyrics_seen_" + source;
      let seen = false;
      try {
        seen = typeof $persistentStore !== "undefined" && $persistentStore && !!$persistentStore.read(key);
      } catch (e) {
        seen = false;
      }
      if (
        !seen &&
        url.indexOf("connect-state") < 0 &&
        typeof $notification !== "undefined" && $notification && "function" == typeof $notification.post
      ) {
        try {
          $persistentStore.write("1", key);
        } catch (e) {
          // 存储失败就退回每次都提示
        }
        const path = String(url).replace(/^https?:\/\/[^/]+/, "");
        $notification.post("Spotify 歌词", "已放开 " + stat.n + " 首", source + " " + path.slice(0, 72));
      }
    } catch (e) {
      // 通知失败不影响改写
    }

    $done({ body: out });
  }

  // ---------------------------------------------------------------- protobuf

  const TE = new TextEncoder();
  const TD = new TextDecoder("utf-8", { fatal: true });

  function readVarint(b, s) {
    let value = 0;
    let shift = 0;
    while (s.i < b.length) {
      const byte = b[s.i++];
      value += (byte & 0x7f) * Math.pow(2, shift);
      if (!(byte & 0x80)) return value;
      shift += 7;
      if (shift > 63) throw new Error("varint");
    }
    throw new Error("varint");
  }

  function parse(b) {
    const out = [];
    const s = { i: 0 };
    while (s.i < b.length) {
      let key;
      try {
        key = readVarint(b, s);
      } catch (e) {
        return null;
      }
      const no = Math.floor(key / 8);
      const wire = key % 8;
      if (!no) return null;
      if (wire === 0) {
        let v;
        try {
          v = readVarint(b, s);
        } catch (e) {
          return null;
        }
        out.push({ no: no, w: 0, v: v });
      } else if (wire === 2) {
        let len;
        try {
          len = readVarint(b, s);
        } catch (e) {
          return null;
        }
        if (len > b.length - s.i) return null;
        out.push({ no: no, w: 2, p: b.subarray(s.i, s.i + len) });
        s.i += len;
      } else if (wire === 1 || wire === 5) {
        const size = wire === 1 ? 8 : 4;
        if (s.i + size > b.length) return null;
        out.push({ no: no, w: wire, p: b.subarray(s.i, s.i + size) });
        s.i += size;
      } else {
        return null;
      }
    }
    return out;
  }

  function varintLength(value) {
    let n = 1;
    while (value >= 0x80) {
      n++;
      value = Math.floor(value / 0x80);
    }
    return n;
  }

  function serialize(fields) {
    let size = 0;
    for (const f of fields) {
      size += varintLength(f.no * 8 + f.w);
      if (f.w === 0) size += varintLength(f.v);
      else {
        if (f.w === 2) size += varintLength(f.p.length);
        size += f.p.length;
      }
    }
    const out = new Uint8Array(size);
    let at = 0;
    const put = (value) => {
      while (value >= 0x80) {
        out[at++] = (value % 0x80) | 0x80;
        value = Math.floor(value / 0x80);
      }
      out[at++] = value;
    };
    for (const f of fields) {
      put(f.no * 8 + f.w);
      if (f.w === 0) {
        put(f.v);
        continue;
      }
      if (f.w === 2) put(f.p.length);
      out.set(f.p, at);
      at += f.p.length;
    }
    return out;
  }

  const first = (fields, no) => {
    for (const f of fields) if (f.no === no) return f;
    return null;
  };
  const fieldString = (no, text) => ({ no: no, w: 2, p: TE.encode(text) });

  function text(f) {
    if (!f || f.w !== 2) return null;
    try {
      return TD.decode(f.p);
    } catch (e) {
      return null;
    }
  }

  // Track 的 has_lyrics = 18（metadata.proto）。缺省时补一条。
  function patchTrack(fields, stat) {
    const f = first(fields, 18);
    if (f) {
      if (f.w !== 0 || f.v === 1) return false;
      f.v = 1;
      stat.n++;
      return true;
    }
    fields.push({ no: 18, w: 0, v: 1 });
    stat.n++;
    return true;
  }

  // map entry 就是一条 { 1: key, 2: value } 的小消息。
  function asEntry(fields) {
    if (!fields || fields.length < 2 || fields.length > 4) return null;
    const k = first(fields, 1);
    const v = first(fields, 2);
    if (!k || k.w !== 2 || !v || v.w !== 2) return null;
    const key = text(k);
    const value = text(v);
    if (key === null || value === null || key.length > 64) return null;
    return { key: key, value: value };
  }

  const encodeEntry = (key, value) => serialize([fieldString(1, key), fieldString(2, value)]);

  // EntityExtensionDataArray：field 2 = extension_kind，field 3 = EntityExtensionData[]
  function isTrackArray(fields) {
    const kind = first(fields, 2);
    if (!kind || kind.w !== 0 || kind.v !== TRACK_V4) return false;
    const data = first(fields, 3);
    if (!data || data.w !== 2) return false;
    const ed = parse(data.p);
    const uri = ed && text(first(ed, 2));
    return !!uri && uri.indexOf("spotify:track:") === 0;
  }

  function patchTrackArray(fields, stat) {
    let changed = false;
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const ed = parse(f.p);
      if (!ed) continue;
      const uri = text(first(ed, 2));
      if (!uri || uri.indexOf("spotify:track:") !== 0) continue;

      // EntityExtensionData.extension_data = 3 (Any)，Any.value = 2
      const anyField = first(ed, 3);
      if (!anyField || anyField.w !== 2) continue;
      const any = parse(anyField.p);
      if (!any) continue;
      const value = first(any, 2);
      if (!value || value.w !== 2) continue;

      const track = parse(value.p);
      if (!track) continue;
      if (patchTrack(track, stat)) {
        value.p = serialize(track);
        anyField.p = serialize(any);
        f.p = serialize(ed);
        changed = true;
      }
    }
    return changed;
  }

  const KNOWN = [
    "artist_name", "artist_uri", "album_title", "album_uri",
    "track_title", "track_uri", "duration", "image_url", "is_explicit", "track_player"
  ];

  function isContextTrack(fields) {
    const uri = text(first(fields, 1));
    if (!uri || !/^spotify:(track|episode|local):/.test(uri)) return false;
    let known = 0;
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const e = asEntry(parse(f.p));
      if (e && KNOWN.indexOf(e.key) >= 0) known++;
    }
    return known > 0;
  }

  function patchFields(fields, depth, stat) {
    let changed = false;

    for (const f of fields) {
      if (f.w !== 2) continue;

      const sub = parse(f.p);
      if (!sub) continue;

      const entry = asEntry(sub);
      if (entry && entry.key === MARK) {
        if (entry.value !== "true") {
          f.p = encodeEntry(MARK, "true");
          changed = true;
          stat.n++;
        }
        continue;
      }

      if (isTrackArray(sub)) {
        if (patchTrackArray(sub, stat)) {
          f.p = serialize(sub);
          changed = true;
        }
        continue;
      }

      if (depth < 16 && patchFields(sub, depth + 1, stat)) {
        f.p = serialize(sub);
        changed = true;
      }
    }

    // 上下文里缺这个 entry 时补一条。
    if (isContextTrack(fields)) {
      let present = false;
      for (const f of fields) {
        if (f.no !== 3 || f.w !== 2) continue;
        const e = asEntry(parse(f.p));
        if (e && e.key === MARK) {
          present = true;
          break;
        }
      }
      if (!present) {
        fields.push({ no: 3, w: 2, p: encodeEntry(MARK, "true") });
        changed = true;
        stat.n++;
      }
    }

    return changed;
  }

  run();
})();
