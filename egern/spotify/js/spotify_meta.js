// Spotify Lyrics Gate — 把播放上下文里的 has_lyrics 改成 true。
//
// 客户端在 SPTPlayerTrack.metadata() 里读 has_lyrics：值是 "false" 就直接显示
// 「暂无歌词」，连 color-lyrics 都不请求，代理层拦不到任何东西。这个字典在
// Spotify 的 player protobuf 里就是 ContextTrack.metadata：
//
//   spotify.player.esperanto.proto.ContextTrack {
//     string uri = 1; string uid = 2; map<string, string> metadata = 3;
//   }
//
// 由 context-resolve / connect-state 的响应下发。EeveeSpotify 也是改同一个位置
// （meta["has_lyrics"] = "true"），只是它在进程内 hook，我们只能改响应字节。
//
// 做法：递归走 protobuf，只改 map entry { 1: "has_lyrics", 2: "false" } 的值；
// 上下文里有 metadata 但缺这个 entry 时补一条。其余字段、字段顺序、未知字段
// 全部原样写回 —— 和 spotify_premium.js 一样，不做整包重编码。

(() => {
  "use strict";

  const MARK = "has_lyrics";

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

    // 服务端对没有歌词的歌可能直接省略这个键，所以不能靠字符串查找跳过，
    // 只能整棵消息树走一遍；这条规则只匹配 context-resolve / connect-state。
    const out = patch(body, 0, { n: 0 });
    if (!out) {
      $done({});
      return;
    }

    // 临时探针：确认这条响应里到底有没有 has_lyrics、改了几条。
    // 只对 context-resolve 提示，避免 connect-state 轮询刷屏；验证通过后删掉。
    try {
      if (
        String(url).indexOf("context-resolve") >= 0 &&
        typeof $notification !== "undefined" && $notification && "function" == typeof $notification.post
      ) {
        const path = String(url).replace(/^https?:\/\/[^/]+/, "");
        $notification.post("Spotify 歌词", "已放开 " + out.count + " 首", path.slice(0, 80));
      }
    } catch (e) {
      // 通知失败不影响改写
    }

    $done({ body: out.bytes });
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

  // 解析失败返回 null；调用方据此保持原始字节。
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

  // map entry 已经解析过，这里只认 { 1: key, 2: value } 的形状。
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

  // ContextTrack 的判定：字段 1 是 spotify: URI，且 metadata 里至少有一个已知键。
  // 只认带 metadata 的上下文，避免往别的消息里塞字段。
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

      // 每条 length-delimited 字段只解析一次：既能当 map entry 判断，
      // 也能继续往下走，避免对大响应重复扫描。
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

      if (depth < 16 && patchFields(sub, depth + 1, stat)) {
        f.p = serialize(sub);
        changed = true;
      }
    }

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

  function patch(bytes, depth, stat) {
    const fields = parse(bytes);
    if (!fields) return null;
    if (!patchFields(fields, depth, stat)) return null;
    return { bytes: serialize(fields), count: stat.n };
  }

  run();
})();
