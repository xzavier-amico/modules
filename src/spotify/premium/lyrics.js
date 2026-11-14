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

  function trackMetadataField(fields) {
    const uri = text(first(fields, 1));
    if (!uri || !/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) return 0;
    // ContextTrack 的字段 3 可能是 GID 或 metadata；要求已有 metadata map，
    // 避免把 GID 当成 map 解析，也不在无法识别的消息上新建字段。
    const third = fields.filter((f) => f.no === 3);
    for (const no of [4, 3]) {
      if (no === 3 && third.some((f) => f.w !== 2 || !asEntry(parse(f.p)))) continue;
      const entries = fields.filter((f) => f.no === no);
      if (!entries.length) continue;
      let known = false;
      let valid = true;
      for (const f of entries) {
        const entry = f.w === 2 ? asEntry(parse(f.p)) : null;
        if (!entry) { valid = false; break; }
        if (entry.key === MARK || KNOWN.indexOf(entry.key) >= 0) known = true;
      }
      if (valid && known) return no;
    }
    return 0;
  }

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

  function patchFields(fields, depth, source) {
    // 仅在可逐字节重建时重写；否则原样放行，避免客户端读到不同的值。
    if (source && !allCanonical(fields)) return false;
    let changed = false;
    const metadataField = trackMetadataField(fields);
    let present = false;

    for (const f of fields) {
      if (f.w !== 2) continue;

      // metadata map entry 本身不含曲目 URI，但需要改 has_lyrics 的值；
      // 其它大块扩展数据如果没有 spotify:track:，就不可能含 Track / ContextTrack。
      const metadataEntry = !!(metadataField && (f.no === 3 || f.no === metadataField));
      if (!metadataEntry && f.p.length > 512 && !containsTrackUri(f.p)) continue;

      const sub = parse(f.p);
      if (!sub) continue;

      const entry = asEntry(sub);
      if (metadataField && f.no === metadataField && entry && entry.key === MARK) {
        present = true;
        if (entry.value !== "true") {
          // 保留 map entry 上的未知字段。
          const value = first(sub, 2);
          value.p = TE.encode("true");
          f.p = serialize(sub);
          changed = true;
        }
        continue;
      }

      if (isTrackArray(sub)) {
        if (allCanonical(sub) && patchTrackArray(sub)) {
          f.p = serialize(sub);
          changed = true;
        }
        continue;
      }

      // ID 与 metadata 值是叶子节点，不再向下递归。
      if (metadataField && (f.no === 3 || f.no === metadataField)) continue;
      if (depth < 16 && patchFields(sub, depth + 1, f.p)) {
        f.p = serialize(sub);
        changed = true;
      }
    }

    // 上下文里缺这个 entry 时补一条。metadataField 命中时按它的字段号补；
    // 服务端 bundle 会额外注入 isContextTrack，处理只带 uri + uid 的当前曲目。
    if (metadataField) {
      if (!present) {
        fields.push({ no: metadataField, w: 2, p: encodeEntry(MARK, "true") });
        changed = true;
      }
    } else if (typeof isContextTrack === "function" && isContextTrack(fields)) {
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
    if (!top || !same(serialize(top), payload)) return null;

    let dropped = 0;
    for (const f of top) {
      if (f.no !== 2 || f.w !== 2) continue;
      const entity = parse(f.p);
      if (!entity || !same(serialize(entity), f.p)) continue;
      let touched = false;
      for (const q of entity) {
        if (q.no !== 2 || q.w !== 2) continue;
        const query = parse(q.p);
        if (!query || !same(serialize(query), q.p)) continue;
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
  const TRACK_CACHE_KEY = "spotify.track.meta";
  const TRACK_CACHE_MAX = 24;
  const TITLE_KEYS = ["track_title", "title", "track_name"];
  const ARTIST_KEYS = ["artist_name", "artist"];

  // 服务端 patcher 里没有 $persistentStore，读不到就直接跳过。
  const cacheStore = () =>
    typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;

  function pickMeta(meta, keys) {
    for (const key of keys) if (meta[key]) return meta[key];
    return "";
  }

  // connect-state 的 TrackRef 与 context-resolve 的 ContextTrack 都是
  // 「同一条消息里既有 spotify:track:<id> 又有 metadata map」，按这个形状收集。
  // 只认这两种结构，不猜 Track 的二进制字段号。
  function collectTracks(fields, out, depth) {
    if (depth > 8) return;
    let uri = "";
    const meta = Object.create(null);
    const nested = [];
    for (const f of fields) {
      if (f.w !== 2) continue;
      // spotify:track: 加 22 位 id 固定 36 字节，先按长度过滤再解码。
      if (!uri && f.p.length === 36) {
        const value = text(f);
        if (value && /^spotify:track:[A-Za-z0-9]{22}$/.test(value)) uri = value;
      }
      const sub = parse(f.p);
      if (!sub) continue;
      const entry = asEntry(sub);
      if (entry) {
        if (!(entry.key in meta) && entry.value && entry.value.length <= 128) meta[entry.key] = entry.value;
        continue;
      }
      nested.push(sub);
    }
    const title = uri && pickMeta(meta, TITLE_KEYS);
    if (title) out[uri.slice(14)] = [title, pickMeta(meta, ARTIST_KEYS), Number(meta.duration) || 0];
    for (const sub of nested) collectTracks(sub, out, depth + 1);
  }

  // /metadata/4/track/<id> 的顶层就是 metadata.proto 的 Track：
  // name = 2，artist = 4 { name = 2 }，duration = 7（毫秒）。
  function collectTrackEntity(fields, id, out) {
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
    out[id] = [name, artists.join(", "), duration && duration.w === 0 ? Number(duration.v) : 0];
  }

  function rememberTracks(found) {
    const store = cacheStore();
    const ids = Object.keys(found);
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
    // 只留最近 24 首，避免存储随播放列表无限增长。
    const ordered = Object.keys(map).sort((a, b) => Number(map[b][3] || 0) - Number(map[a][3] || 0));
    for (const id of ordered.slice(TRACK_CACHE_MAX)) delete map[id];
    try {
      store.write(JSON.stringify(map), TRACK_CACHE_KEY);
    } catch (e) {
      // 存储写失败不影响响应改写。
    }
  }

  function cacheTrackMeta(target, fields) {
    if (!cacheStore()) return;
    const trackUrl = /\/metadata\/4\/track\/([A-Za-z0-9]{22})/.exec(target);
    if (trackUrl) {
      const found = Object.create(null);
      collectTrackEntity(fields, trackUrl[1], found);
      rememberTracks(found);
      return;
    }
    // extended-metadata 体积大且不含 track_title；当前曲目在
    // connect-state / context-resolve 里都有，跳过可以省掉一次全量遍历。
    if (target.indexOf("/extended-metadata/") >= 0) return;
    const found = Object.create(null);
    collectTracks(fields, found, 0);
    rememberTracks(found);
  }

  function patchMeta(buffer, target) {
    const fields = parse(buffer);
    if (!fields) return null;
    // 元数据缓存只读字段，不要求整包可逐字节重建：先把曲名 / 歌手 / 时长
    // 抄下来，非规范响应也能让歌词脚本拿到准确元数据。改写 has_lyrics 仍然
    // 只在可逐字节重建时进行，避免把不认识的响应写坏。
    cacheTrackMeta(target, fields);
    if (/\/metadata\/4\/track\//.test(target)) {
      if (!allCanonical(fields)) return null;
      return patchTrack(fields) ? serialize(fields) : null;
    }
    return patchFields(fields, 0, buffer) ? serialize(fields) : null;
  }
