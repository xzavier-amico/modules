  // ------------------------------------------------------------------ 歌词

  // Track 的 has_lyrics = 18（metadata.proto）。缺省时补一条。
  function patchTrack(fields) {
    const f = first(fields, 18);
    if (f) {
      if (f.w !== 0 || f.v === 1n) return false;
      f.v = 1n;
      return true;
    }
    fields.push({ no: 18, w: 0, v: 1n });
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
  // 不按 extension_kind 过滤：只要数组里有 spotify:track: 的实体就当成 Track 数组，
  // 这样客户端换用别的 extension kind 取 Track 时也能命中。
  function isTrackArray(fields) {
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const ed = parse(f.p);
      if (!ed) continue;
      const uri = text(first(ed, 2));
      if (uri && uri.indexOf("spotify:track:") === 0) return true;
    }
    return false;
  }

  function patchTrackArray(fields) {
    let changed = false;
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const ed = parse(f.p);
      if (!ed || !allCanonical(ed)) continue;
      const uri = text(first(ed, 2));
      if (!uri || uri.indexOf("spotify:track:") !== 0) continue;

      // EntityExtensionData.extension_data = 3 (Any)，Any.value = 2
      const anyField = first(ed, 3);
      if (!anyField || anyField.w !== 2) continue;
      const any = parse(anyField.p);
      if (!any || !allCanonical(any)) continue;
      const value = first(any, 2);
      if (!value || value.w !== 2) continue;

      // 只认 type_url 以 .Track 结尾的 Any，别把 Album / Artist / TrackDescriptor
      // 当成 Track 改（字段 18 在别的消息里可能是别的东西）。
      const typeUrl = text(first(any, 1));
      if (!typeUrl || !/\.Track$/.test(typeUrl)) continue;

      const track = parse(value.p);
      if (!track) continue;
      // 仅在可逐字节重建时改写，避免客户端解析出不同的值。
      if (!allCanonical(track)) continue;
      if (!patchTrack(track)) continue;
      value.p = serialize(track);
      anyField.p = serialize(any);
      f.p = serialize(ed);
      changed = true;
    }
    return changed;
  }

  const KNOWN = [
    "artist_name", "artist_uri", "album_title", "album_uri",
    "track_title", "track_uri", "duration", "image_url", "is_explicit", "track_player"
  ];

  const TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/;
  const MARK = "has_lyrics";
  // 大响应里只对可能包含曲目 URI 的子消息做解析；图片 / Credits / Canvas 等
  // 扩展数据没有这个标记，直接跳过，避免 12MB 级响应整树 parse。
  const TRACK_URI_MARKER = TE.encode("spotify:track:");
  function containsTrackUri(bytes) {
    const last = bytes.length - TRACK_URI_MARKER.length;
    for (let start = bytes.indexOf(TRACK_URI_MARKER[0]); start >= 0 && start <= last; start = bytes.indexOf(TRACK_URI_MARKER[0], start + 1)) {
      let hit = true;
      for (let i = 1; i < TRACK_URI_MARKER.length; i += 1) {
        if (bytes[start + i] !== TRACK_URI_MARKER[i]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
    return false;
  }

  // 合并 has_lyrics 改写、曲目元数据收集与播放队列扫描到单趟遍历：
  // 此前 connect-state / context-resolve 要整树递归 3-4 遍，每条 metadata entry
  // 也要重复 parse 3 遍；单趟遍历 + 非曲目大块剪枝可大幅降低耗时和堆内存峰值。
  function walkMeta(fields, depth, canEdit, ctx) {
    let changed = false;

    // 队列扫描（仅 connect-state）：在已解析的字段上顺手识别 PlayerState
    // （track = 7，prev_tracks = 19，next_tracks = 20），不再单独整树递归。
    if (ctx.wantQueue && depth <= 8 && !ctx.queue.current) {
      const current = first(fields, 7);
      if (current && current.w === 2) {
        let hasOrder = false;
        for (const f of fields) {
          if ((f.no === 20 || f.no === 19) && f.w === 2) { hasOrder = true; break; }
        }
        if (hasOrder) {
          const head = parse(current.p);
          const id = head ? queueTrackId(head) : "";
          if (id) {
            ctx.queue.current = id;
            const ids = [];
            for (const f of fields) {
              if (f.no !== 20 || f.w !== 2) continue;
              const sub = parse(f.p);
              const nextId = sub ? queueTrackId(sub) : "";
              if (nextId && ids.indexOf(nextId) < 0) ids.push(nextId);
              if (ids.length >= QUEUE_MAX) break;
            }
            ctx.queue.next = ids;
          }
        }
      }
    }

    // 识别 ContextTrack（field 1 = spotify:track:...），对 field 3/4 的 metadata entry
    // 只 parse 一次，同时完成 metadataField 判定、元数据收集与 has_lyrics 改写。
    const f1 = first(fields, 1);
    let uri = "";
    if (f1 && f1.w === 2 && f1.p.length === 36) {
      const value = text(f1);
      if (value && TRACK_URI_RE.test(value)) uri = value;
    }

    let metadataField = 0;
    if (uri) {
      let meta3Count = 0;
      let meta3Valid = true;
      let meta3Known = false;
      let meta4Count = 0;
      let meta4Valid = true;
      let meta4Known = false;
      const entries3 = [];
      const entries4 = [];
      for (const f of fields) {
        if (f.no === 3) {
          meta3Count += 1;
          if (f.w !== 2) { meta3Valid = false; continue; }
          const sub = parse(f.p);
          const entry = asEntry(sub);
          if (!entry) { meta3Valid = false; continue; }
          if (entry.key === MARK || KNOWN.indexOf(entry.key) >= 0) meta3Known = true;
          entries3.push({ f: f, sub: sub, entry: entry });
        } else if (f.no === 4) {
          meta4Count += 1;
          if (f.w !== 2) { meta4Valid = false; continue; }
          const sub = parse(f.p);
          const entry = asEntry(sub);
          if (!entry) { meta4Valid = false; continue; }
          if (entry.key === MARK || KNOWN.indexOf(entry.key) >= 0) meta4Known = true;
          entries4.push({ f: f, sub: sub, entry: entry });
        }
      }
      if (meta4Count && meta4Valid && meta4Known) metadataField = 4;
      else if (meta3Count && meta3Valid && meta3Known) metadataField = 3;

      if (metadataField) {
        const entries = metadataField === 4 ? entries4 : entries3;
        const collectHere = ctx.wantMeta && depth <= 8;
        const meta = collectHere ? Object.create(null) : null;
        let present = false;
        for (const item of entries) {
          if (collectHere && !(item.entry.key in meta) && item.entry.value && item.entry.value.length <= 128) {
            meta[item.entry.key] = item.entry.value;
          }
          if (canEdit && item.entry.key === MARK) {
            present = true;
            if (item.entry.value !== "true") {
              // 保留 map entry 上的未知字段。
              const value = first(item.sub, 2);
              value.p = TE.encode("true");
              item.f.p = serialize(item.sub);
              changed = true;
            }
          }
        }
        if (collectHere) {
          const title = pickMeta(meta, TITLE_KEYS);
          if (title) ctx.found[uri.slice(14)] = [title, pickMeta(meta, ARTIST_KEYS), Number(meta.duration) || 0];
        }
        if (canEdit && !present) {
          fields.push({ no: metadataField, w: 2, p: encodeEntry(MARK, "true") });
          changed = true;
        }
      }
    }

    const collectLoose = ctx.wantMeta && !metadataField && depth <= 8;
    let looseUri = uri;
    const looseMeta = collectLoose ? Object.create(null) : null;

    for (const f of fields) {
      if (f.w !== 2) continue;
      // ContextTrack 的 URI / GID / metadata entry 已在上面处理完且均为叶子节点。
      if (metadataField && (f.no === 1 || f.no === 3 || f.no === metadataField)) continue;

      if (collectLoose && !looseUri && f.p.length === 36) {
        const value = text(f);
        if (value && TRACK_URI_RE.test(value)) looseUri = value;
      }

      // 非曲目扩展数据（图片 / Credits / Canvas / 设备信息等）不含 spotify:track:，
      // 长度 > 256 也不可能是曲目 metadata entry（key<=64, value<=128），直接跳过。
      if (f.p.length > 256 && !containsTrackUri(f.p)) continue;

      const sub = parse(f.p);
      if (!sub) continue;

      if (collectLoose) {
        const entry = asEntry(sub);
        if (entry) {
          if (!(entry.key in looseMeta) && entry.value && entry.value.length <= 128) looseMeta[entry.key] = entry.value;
          continue;
        }
      }

      if (canEdit && isTrackArray(sub)) {
        if (allCanonical(sub) && patchTrackArray(sub)) {
          f.p = serialize(sub);
          changed = true;
        }
        continue;
      }

      const maxDepth = canEdit ? 16 : 8;
      if (depth < maxDepth) {
        const subCanEdit = canEdit && allCanonical(sub);
        if (subCanEdit || (ctx.wantMeta && depth < 8)) {
          if (walkMeta(sub, depth + 1, subCanEdit, ctx)) {
            f.p = serialize(sub);
            changed = true;
          }
        }
      }
    }

    if (collectLoose && looseUri) {
      const title = pickMeta(looseMeta, TITLE_KEYS);
      if (title) ctx.found[looseUri.slice(14)] = [title, pickMeta(looseMeta, ARTIST_KEYS), Number(looseMeta.duration) || 0];
    }

    // 服务端 bundle 会额外注入 isContextTrack，处理只带 uri + uid 的当前曲目。
    if (canEdit && !metadataField && typeof isContextTrack === "function" && isContextTrack(fields)) {
      let has = false;
      for (const f of fields) {
        if (f.no !== 3 || f.w !== 2) continue;
        const entry = asEntry(parse(f.p));
        if (entry && entry.key === MARK) {
          has = true;
          break;
        }
      }
      if (!has) {
        fields.push({ no: 3, w: 2, p: encodeEntry(MARK, "true") });
        changed = true;
      }
    }

    return changed;
  }

  // 删除 extended-metadata 请求体里的 etag（ExtensionQuery.etag，字段 2），
  // 避免服务端返回「未变化」的空数组。
  //
  //   BatchedEntityRequest { header = 1; repeated EntityRequest = 2 }
  //   EntityRequest       { string entity_uri = 1; repeated ExtensionQuery = 2 }
  //   ExtensionQuery      { ExtensionKind extension_kind = 1; string etag = 2 }
  //
  // 客户端与服务端共用这段逻辑：客户端拿到 body 后交给 $done，服务端直接返回字节。
  function stripRequestEtagsBytes(payload) {
    if (!payload || !payload.length) return null;
    const top = parse(payload);
    if (!top || !allCanonical(top)) return null;

    let dropped = 0;
    for (const f of top) {
      if (f.no !== 2 || f.w !== 2) continue;
      const entity = parse(f.p);
      if (!entity || !allCanonical(entity)) continue;
      let touched = false;
      for (const q of entity) {
        if (q.no !== 2 || q.w !== 2) continue;
        const query = parse(q.p);
        if (!query || !allCanonical(query)) continue;
        const kept = [];
        let hit = false;
        for (const k of query) {
          if (k.no === 2 && k.w === 2) {
            hit = true;
            dropped++;
            continue;
          }
          kept.push(k);
        }
        if (hit) {
          q.p = serialize(kept);
          touched = true;
        }
      }
      if (touched) f.p = serialize(entity);
    }

    return dropped ? serialize(top) : null;
  }

  function stripRequestEtags(request, url) {
    if (url.indexOf("/extended-metadata/") < 0) {
      $done({});
      return;
    }
    let payload = request.body;
    if (payload instanceof ArrayBuffer) payload = new Uint8Array(payload);
    if (!payload || !ArrayBuffer.isView(payload) || !payload.length) {
      $done({});
      return;
    }
    const out = stripRequestEtagsBytes(payload);
    $done(out ? { body: out } : {});
  }

  // ---- 曲目元数据缓存 ---------------------------------------------------
  //
  // 客户端播放时本来就会拉 connect-state / context-resolve / metadata/4/track，
  // 里面带当前曲目的曲名、歌手与时长。这里顺手抄一份存进 $persistentStore，
  // spotify_lyrics.js 直接读，省掉再向 open.spotify.com 要一次元数据
  // （该域名在部分出口会直接回 400，白等一轮超时）。
  //
  // 存储值：{ "<track id>": [title, artist, durationMs, savedAt] }，最多 24 首。
  const TRACK_CACHE_KEY = "spotify.track.meta.v2";
  const TRACK_CACHE_MAX = 64;
  const TITLE_KEYS = ["track_title", "title", "track_name"];
  const ARTIST_KEYS = ["artist_name", "artist"];

  // 服务端 patcher 里没有 $persistentStore，读不到就直接跳过。
  const cacheStore = () =>
    typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;

  // 账号地区：bootstrap / UCS 的账号属性里通常带 country / current-country。
  // 记下来供 headers 脚本按地区选时区；只在变化时写一次。
  const REGION_KEY = "spotify.account.region";
  const REGION_ATTR_KEYS = ["country", "current-country", "preferred-country", "account-country", "billing-country"];
  function rememberRegionEntry(key, entry) {
    if (!key || REGION_ATTR_KEYS.indexOf(key.toLowerCase()) < 0) return false;
    const store = cacheStore();
    if (!store) return true;
    const value = first(entry, 2);
    const valueFields = value && value.w === 2 ? parse(value.p) : null;
    const region = valueFields ? text(first(valueFields, 4)) : null;
    if (!region || !/^[A-Za-z]{2}$/.test(region)) return false;
    const next = region.toUpperCase();
    try {
      if (store.read(REGION_KEY) === next) return true;
      store.write(next, REGION_KEY);
    } catch (e) {
      // 存储写失败不影响响应改写。
    }
    return true;
  }

  function rememberRegion(fields) {
    if (!cacheStore()) return;
    for (const f of fields) {
      if (f.no !== 1 || f.w !== 2) continue;
      const entry = parse(f.p);
      if (!entry) continue;
      const key = text(first(entry, 1));
      if (rememberRegionEntry(key, entry)) return;
    }
  }

  // Spotify /metadata/4/track/{gid} 的路径是 32 位十六进制 GID（16 字节 128-bit 整数），
  // 而 color-lyrics/v2/track/{id} 用的是同一数值的 22 位 Base62 编码。
  // 直接截取前 22 位 hex 当缓存 key 永远对不上 color-lyrics 的曲目 ID。
  const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function bigIntToBase62(value) {
    let n = value;
    let out = "";
    for (let i = 0; i < 22; i += 1) {
      out = BASE62.charAt(Number(n % 62n)) + out;
      n /= 62n;
    }
    return out;
  }
  function gidHexToBase62(hex) {
    if (typeof hex !== "string" || !/^[0-9a-fA-F]{32}$/.test(hex)) return "";
    return bigIntToBase62(BigInt("0x" + hex));
  }
  function gidBytesToBase62(bytes) {
    if (!bytes || bytes.length !== 16) return "";
    let value = 0n;
    for (let i = 0; i < 16; i += 1) value = (value << 8n) | BigInt(bytes[i]);
    return bigIntToBase62(value);
  }
  function trackIdFromUrl(target) {
    const match = /\/metadata\/4\/track\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(target);
    if (!match) return "";
    const raw = match[1];
    if (raw.length === 22) return raw;
    if (raw.length === 32) return gidHexToBase62(raw);
    return "";
  }

  function pickMeta(meta, keys) {
    for (const key of keys) if (meta[key]) return meta[key];
    return "";
  }

  // /metadata/4/track/<id> 的顶层就是 metadata.proto 的 Track：
  // gid = 1（16 字节），name = 2，artist = 4 { name = 2 }，duration = 7（毫秒）。
  function collectTrackEntity(fields, id, out) {
    const gid = first(fields, 1);
    const resolvedId = id || (gid && gid.w === 2 ? gidBytesToBase62(gid.p) : "");
    if (!resolvedId) return;
    const name = text(first(fields, 2));
    if (!name || name.length > 200 || /[\u0000-\u001f]/.test(name)) return;
    const artists = [];
    for (const f of fields) {
      if (f.no !== 4 || f.w !== 2) continue;
      const artist = parse(f.p);
      const artistName = artist && text(first(artist, 2));
      if (artistName && artistName.length <= 120) artists.push(artistName);
    }
    const duration = first(fields, 7);
    out[resolvedId] = [name, artists.join(", "), duration && duration.w === 0 ? Number(duration.v) : 0];
  }

  function rememberTracks(found) {
    const store = cacheStore();
    const ids = found ? Object.keys(found) : [];
    if (!store || !ids.length) return;
    let map = null;
    try {
      const raw = store.read(TRACK_CACHE_KEY);
      map = raw ? JSON.parse(raw) : {};
    } catch (e) {
      map = {};
    }
    if (!map || "object" != typeof map) map = {};
    let changed = false;
    const now = Date.now();
    for (const id of ids) {
      const next = found[id];
      const old = map[id];
      if (old && old[0] === next[0] && old[1] === next[1] && Number(old[2]) === next[2]) continue;
      map[id] = [next[0], next[1], next[2], now];
      changed = true;
    }
    if (!changed) return;
    const ordered = Object.keys(map).sort((a, b) => Number(map[b][3] || 0) - Number(map[a][3] || 0));
    for (const id of ordered.slice(TRACK_CACHE_MAX)) delete map[id];
    try {
      store.write(JSON.stringify(map), TRACK_CACHE_KEY);
    } catch (e) {
      // 存储写失败不影响响应改写。
    }
  }

  // ---- 播放队列（预取下一首歌词用）---------------------------------------
  //
  // connect-state 的 PlayerState 字段号：track = 7，prev_tracks = 19，
  // next_tracks = 20。不能按「当前曲目后面第一首」的遍历顺序取 —— prev_tracks
  // 也排在后面，会把手上一首当成下一首。
  //
  // 这里只记「当前曲目 + 接下来几首」，写进 spotify.queue；真正的歌词查询在
  // 歌词脚本里做（喂给它的曲目 id 来自这份队列）。connect-state 是热路径，
  // 客户端每次状态变化、以及前台轮询都会打，所以这里只做一次去重写入，
  // 不发任何请求。
  const QUEUE_KEY = "spotify.queue";
  const QUEUE_MAX = 8;
  const QUEUE_TTL_MS = 30 * 60 * 1000;

  function queueTrackId(entry) {
    for (const f of entry) {
      if (f.no !== 1 || f.w !== 2 || f.p.length !== 36) continue;
      const value = text(f);
      if (value && TRACK_URI_RE.test(value)) return value.slice(14);
    }
    return "";
  }

  function persistQueue(queue) {
    const store = cacheStore();
    if (!store || !queue || !queue.current) return;
    const next = queue.next.slice(0, QUEUE_MAX);
    try {
      const raw = store.read(QUEUE_KEY);
      const old = raw ? JSON.parse(raw) : null;
      const same = old && old.current === queue.current &&
        Array.isArray(old.next) && old.next.length === next.length &&
        old.next.every((id, i) => id === next[i]);
      // 队列没变就不重复写：connect-state 轮询很频繁，写存储本身也有成本。
      if (same && Number(old.at) && Date.now() - Number(old.at) < QUEUE_TTL_MS) return;
      store.write(JSON.stringify({ current: queue.current, next: next, at: Date.now() }), QUEUE_KEY);
    } catch (e) {
      // 存储写失败不影响响应改写。
    }
  }

  // 桌面端（CEF）拉 track 元数据时要的是 JSON：accept: application/json，
  // 响应是 { gid, name, has_lyrics, ... }。只按 protobuf 改的话 has_lyrics 永远是
  // 服务端给的原值（false），客户端就认为这首歌没有歌词、连 color-lyrics 都不请求。
  function patchMetaJson(text, target) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!data || "object" !== typeof data || Array.isArray(data)) return null;
    if (typeof data.gid !== "string" && typeof data.uri !== "string") return null;
    let changed = false;
    if (data.has_lyrics !== true) {
      data.has_lyrics = true;
      changed = true;
    }
    // 顺手把曲名 / 歌手 / 时长写进缓存，歌词脚本查源时零请求。
    const store = cacheStore();
    const id = trackIdFromUrl(target) || gidHexToBase62(data.gid);
    if (store && id && typeof data.name === "string" && data.name) {
      const artist = Array.isArray(data.artist)
        ? data.artist.map((item) => item && item.name).filter(Boolean).join(", ")
        : "";
      const found = Object.create(null);
      found[id] = [data.name, artist, Number(data.duration) || 0];
      rememberTracks(found);
    }
    return changed ? JSON.stringify(data) : null;
  }

  function patchMeta(buffer, target) {
    const json = asJsonText(buffer);
    if (json) {
      const patched = patchMetaJson(json, target);
      return patched ? WIRE_TEXT.encode(patched) : null;
    }
    const fields = parse(buffer);
    if (!fields) return null;
    const canonical = allCanonical(fields);
    if (/\/metadata\/4\/track\//.test(target)) {
      if (cacheStore()) {
        const found = Object.create(null);
        collectTrackEntity(fields, trackIdFromUrl(target), found);
        rememberTracks(found);
      }
      if (!canonical) return null;
      return patchTrack(fields) ? serialize(fields) : null;
    }
    const wantMeta = !!cacheStore() && target.indexOf("/extended-metadata/") < 0;
    if (!canonical && !wantMeta) return null;
    const wantQueue = wantMeta && target.indexOf("/connect-state/") >= 0;
    const ctx = {
      wantMeta: wantMeta,
      found: wantMeta ? Object.create(null) : null,
      wantQueue: wantQueue,
      queue: wantQueue ? { current: "", next: [] } : null,
    };
    const changed = walkMeta(fields, 0, canonical, ctx);
    if (wantMeta) rememberTracks(ctx.found);
    if (wantQueue && ctx.queue.current) persistQueue(ctx.queue);
    return changed ? serialize(fields) : null;
  }
