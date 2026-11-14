//=======================================================================================
// Spotify Enhance — bootstrap / UCS / 元数据 / 远程配置 / 账号属性
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


(() => {
  "use strict";

  //=====================================================================================
  // protobuf wire —— 三端脚本共用的底层编解码
  //
  // 只做「把一段字节拆成字段列表」「按字段号编码」「varint 读写」，
  // 不建模具体消息。未建模的字段按 raw 原样保留，改不动时最多不生效，
  // 不会把响应写坏。
  //=====================================================================================

  const WIRE_TEXT = new TextEncoder();
  const WIRE_UTF8 = new TextDecoder("utf-8", { fatal: true });

  // varint 用 BigInt 读，避免 64 位字段（时间戳、ID）超过 2^53 后丢低位。
  function wireReadVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    let value = 0n;
    let shift = 0n;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
      shift += 7n;
      if (shift > 63n) throw new Error("Invalid protobuf varint");
    }
    throw new Error("Truncated protobuf varint");
  }

  // 字段号 / 长度这类小整数走 Number，避免每个字段都分配 BigInt；
  // 真的超过 4 字节时退回 BigInt 保证正确（实际只有超长字段才可能）。
  function wireReadCount(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    const start = state.i;
    let value = 0;
    let shift = 0;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      if (shift < 28) {
        value |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) return value >>> 0;
        shift += 7;
        continue;
      }
      // 超过 4 字节：退回去用 BigInt 重读整个 varint。
      state.i = start;
      return Number(wireReadVarint(bytes, state, limit));
    }
    throw new Error("Truncated protobuf varint");
  }

  // 只跳过 wire 0 的 varint，不构造 BigInt。字段切分 / 扫描时不需要这个值，
  // 大响应里能省掉每个数值字段一次 BigInt 分配。
  function wireSkipVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    while (state.i < limit) {
      if (!(bytes[state.i++] & 0x80)) return;
    }
    throw new Error("Truncated protobuf varint");
  }

  function wireVarintLength(value) {
    let length = 1;
    while (value >= 0x80n) {
      length++;
      value >>= 7n;
    }
    return length;
  }

  function wireEncodeVarint(value) {
    let rest = BigInt(value);
    const out = new Uint8Array(wireVarintLength(rest));
    let at = 0;
    while (rest >= 0x80n) {
      out[at++] = Number(rest & 0x7fn) | 0x80;
      rest >>= 7n;
    }
    out[at] = Number(rest);
    return out;
  }

  function wireConcat(parts) {
    let size = 0;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function wireEqual(left, right) {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  // 返回 [{ no, wire, data, raw }]；data 是字段值，raw 是含 tag 的整段字节。
  function wireParseFields(bytes) {
    const fields = [];
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const rawStart = state.i;
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");

      let dataStart = state.i;
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        dataStart = state.i;
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");

      fields.push({
        no: no,
        wire: wire,
        data: bytes.subarray(dataStart, state.i),
        raw: bytes.subarray(rawStart, state.i),
      });
    }
    return fields;
  }

  // 只扫字段号、不建对象、不切子数组；onField(no) 返回 true 时提前结束。
  // 用于大响应里判断「有没有某个字段」，比完整 parse 快很多。
  function wireScanFields(bytes, onField) {
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no)) return true;
    }
    return false;
  }

  // 按 no / wire 编码一个字段；payload 对 wire 0 是 varint 字节，其余是字段值。
  function wireEncodeField(no, wire, payload) {
    const tag = wireEncodeVarint(BigInt(no) * 8n + BigInt(wire));
    return wire === 2 ? wireConcat([tag, wireEncodeVarint(payload.length), payload]) : wireConcat([tag, payload]);
  }

  function wireDecodeText(bytes) {
    try {
      return WIRE_UTF8.decode(bytes);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- options

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      const modeInFifth = ["full", "no_card", "metadata_only", "response_only", "card_only"].indexOf(raw[4]) >= 0;
      opt = { spoof_premium: raw[0], block_ads: raw[1], unlock_playback: raw[2], enable_lyrics: raw[3], desktop: modeInFifth ? false : raw[4], lyrics_mode: modeInFifth ? raw[4] : raw[5], prefetch: raw[6] };
    } else if (typeof raw === "string") {
      opt = JSON.parse(raw || "{}") || {};
    } else if (raw && "object" == typeof raw) {
      opt = raw;
    }
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

  // 客户端模式：auto 按 User-Agent 识别；拿不到 UA 时再看 Loon 运行环境。
  // 识别结果只影响桌面端专属的改写路径，失败时按移动端处理。
  const requestUserAgent = () => {
    const req = typeof $request !== "undefined" && $request ? $request : null;
    const headers = req && req.headers;
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== "user-agent") continue;
      const value = headers[key];
      return String(Array.isArray(value) ? value[0] || "" : value == null ? "" : value);
    }
    return "";
  };
  const detectDesktop = () => {
    const ua = requestUserAgent();
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
    if (/Macintosh|Mac OS X|Darwin|Windows NT/i.test(ua)) return true;
    const loon = typeof $loon !== "undefined" ? String($loon) : "";
    return /^Mac\b/i.test(loon);
  };
  const desktopMode = (v) => {
    if (v === undefined || v === null || v === "") return detectDesktop();
    const mode = String(v).trim().toLowerCase();
    if (mode === "auto") return detectDesktop();
    if (mode === "macos" || mode === "mac" || mode === "desktop") return true;
    if (mode === "ios" || mode === "iphone" || mode === "ipad" || mode === "mobile") return false;
    return flag(v, false);
  };
  const autoPlay = (v) => v === undefined || v === null || /^auto$/i.test(String(v));

  const spoof = flag(opt.spoof_premium, true);
  const adsOn = flag(opt.block_ads, true);
  // macOS 桌面版：bootstrap 外层结构可能和 iOS 不同，且播放授权由服务端判定。
  const desktop = desktopMode(opt.desktop);
  // unlock_playback=auto 时移动端开启、桌面端关闭；桌面端强行写播放授权容易跳歌。
  const playOn = autoPlay(opt.unlock_playback) ? !desktop : flag(opt.unlock_playback, !desktop);
  const lyricsOn = flag(opt.enable_lyrics, true);
  // full / no_card / metadata_only 处理元数据和歌词响应；card_only 只补歌词 section。
  // 保留旧值解析，兼容已保存的参数。
  const lyricsMode = ["full", "no_card", "metadata_only", "response_only", "card_only"].indexOf(opt.lyrics_mode) >= 0 ? opt.lyrics_mode : "full";
  const lyricsMetaOn = lyricsOn && (lyricsMode === "full" || lyricsMode === "no_card" || lyricsMode === "metadata_only");
  // 歌词卡片：full / card_only 时向 scrollsita 列表补一个真实的歌词 section。
  const lyricsCardOn = lyricsOn && (lyricsMode === "full" || lyricsMode === "card_only");
  // 预取下一首：滚动页补卡时顺手把队列里下一首的歌词也查好写进缓存。
  const prefetchOn = flag(opt.prefetch, true);

  // 响应体上限：超过上限直接放行，避免异常响应占满内存。
  const MAX_META_BYTES = 12 * 1024 * 1024; // extended-metadata / context-resolve / connect-state / metadata
  const MAX_FEED_BYTES = 12 * 1024 * 1024; // home / browse / scroll / remote-config / nebula
  const MAX_BOOTSTRAP_BYTES = 40 * 1024 * 1024; // bootstrap / user-customization

  // ---------------------------------------------------------------- protobuf
  //
  // 底层 varint / 字段切分 / 字段编码在 src/proto/wire.js，三端共用。
  // 这里只保留 Spotify 需要的消息级封装：parse 失败返回 null，
  // edit 在重编码前后做一次字节比对，防止把不认识的响应写坏。

  const TE = WIRE_TEXT;
  const TD = WIRE_UTF8;
  const readVarint = wireReadVarint;

  // 字节不是合法消息时返回 null。
  function parse(b) {
    let fields;
    try {
      fields = wireParseFields(b);
    } catch (e) {
      return null;
    }
    return fields.map((f) =>
      f.wire === 0
        ? { no: f.no, w: 0, v: wireReadVarint(f.data, { i: 0 }), raw: f.raw }
        : { no: f.no, w: f.wire, p: f.data, raw: f.raw },
    );
  }

  function serialize(fields) {
    return wireConcat(fields.map((f) => wireEncodeField(f.no, f.w, f.w === 0 ? wireEncodeVarint(f.v) : f.p)));
  }

  // 判断整条消息是否本来就是规范编码。等价于 same(serialize(parse(buffer)), buffer)，
  // 但只比较每个字段的 tag / 长度，不复制大 payload，避免 12MB 响应白拷贝一遍。
  function samePrefix(bytes, prefix) {
    if (bytes.length !== prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  function allCanonical(fields) {
    for (const f of fields) {
      if (!f.raw) return false;
      const tag = wireEncodeVarint(BigInt(f.no) * 8n + BigInt(f.w));
      if (f.raw.length < tag.length || !samePrefix(f.raw.subarray(0, tag.length), tag)) return false;
      if (f.w === 0) {
        const value = wireEncodeVarint(f.v);
        if (!samePrefix(f.raw.subarray(tag.length), value)) return false;
      } else if (f.w === 2) {
        const length = wireEncodeVarint(f.p.length);
        if (f.raw.length !== tag.length + length.length + f.p.length) return false;
        if (!samePrefix(f.raw.subarray(tag.length, tag.length + length.length), length)) return false;
      } else if (f.raw.length !== tag.length + (f.w === 1 ? 8 : 4)) {
        return false;
      }
    }
    return true;
  }

  const first = (fields, no) => {
    for (const f of fields) if (f.no === no) return f;
    return null;
  };
  const fieldString = (no, text) => ({ no: no, w: 2, p: TE.encode(text) });
  const fieldBytes = (no, payload) => ({ no: no, w: 2, p: payload });
  const fieldVarint = (no, value) => ({ no: no, w: 0, v: BigInt(value) });

  function text(f) {
    if (!f || f.w !== 2) return null;
    return wireDecodeText(f.p);
  }

  // 用 fn 的返回值替换 path 指向的消息；路径缺失或解析失败时返回 null。
  function edit(message, path, fn) {
    if (!path.length) return fn(message);
    const fields = parse(message);
    if (!fields || !same(serialize(fields), message)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = wireEqual;

  // ------------------------------------------------------------ remote config

  // 播放衔接：不再改写交叉淡入淡出 / Gapless 相关开关。免费号被强制打开
  // crossfade 后，App 会直接按本地滑杆（常见默认 4 秒）把下一首提前混进来，
  // 表现为倒计时结束又响了 1–2 秒。只强制关闭 AutoMix，它才是按节拍提前
  // 混入下一首的元凶；Crossfade 仍由 App 自己的设置决定。
  const RULES = [
    ["ios-feature-settings","automix_enabled",2,0,"","misc"],
    ["core-automix","automix_enabled",2,0,"","misc"],
    ["","enable_common_capping",0,0,"","cap"],
    ["","enable_pns_common_capping",0,0,"","cap"],
    ["","enable_pick_and_shuffle_common_capping",0,0,"","cap"],
    ["","enable_pick_and_shuffle_dynamic_cap",0,0,"","cap"],
    ["","pick_and_shuffle_timecap",0,0,"","cap"],
    ["ios-feature-queue","",0,0,"","cap"],
    ["","enable_free_on_demand_experiment",0,0,"","misc"],
    ["","enable_free_on_demand_context_menu_experiment",0,0,"","misc"],
    ["","enable_mft_plus_queue",0,0,"","cap"],
    ["","enable_mft_plus_extended_queue",0,0,"","cap"],
    ["","enable_playback_timeout_service",1,0,"","cap"],
    ["","enable_playback_timeout_error_ui",1,0,"","cap"],
    ["","playback_timeout_action",3,0,"Nothing","cap"],
    ["","is_remove_from_queue_enabled_for_mft_plus",0,0,"","cap"],
    ["","is_reordering_for_mft_plus_allowed",0,0,"","cap"],
    ["","ads",1,0,"","ad"],
    ["","ad_metadata",0,0,"","ad"],
    ["","ad_slots",0,0,"","ad"],
    ["","enable_ads",1,0,"","ad"],
    ["","enable_audio_ads",1,0,"","ad"],
    ["","enable_display_ads",1,0,"","ad"],
    ["","enable_video_ads",1,0,"","ad"],
    ["","enable_premium_upsell",1,0,"","ad"],
    ["","enable_upsell",1,0,"","ad"],
    ["","show_upsell",1,0,"","ad"],
    ["","show_premium_upsell",1,0,"","ad"],
    ["","enable_campaigns",1,0,"","misc"],
    ["","enable_promotions",1,0,"","ad"],
    ["","enable_search_ad",1,0,"","ad"],
    ["","enable_search_ads",1,0,"","ad"],
    ["","enable_search_banner_ad",1,0,"","ad"],
    ["","enable_search_banner_ads",1,0,"","ad"],
    ["","enable_search_sponsored_ad",1,0,"","ad"],
    ["","enable_search_sponsored_ads",1,0,"","ad"],
    ["","enable_search_upsell",1,0,"","ad"],
    ["","enable_home_ad",1,0,"","ad"],
    ["","enable_home_ads",1,0,"","ad"],
    ["","enable_home_banner_ad",1,0,"","ad"],
    ["","enable_home_banner_ads",1,0,"","ad"],
    ["","enable_home_sponsored_ad",1,0,"","ad"],
    ["","enable_home_sponsored_ads",1,0,"","ad"],
    ["","enable_home_upsell",1,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","is_enabled_pt2",2,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","linear_upsell_new_style_experiment_enabled",2,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","play_modes_upsell_new_style_experiment_enabled",2,0,"","ad"],
    ["ios-jam-freeusershuffleupsellsheetpage-impl","free_user_shuffle_upsell_sheet_enabled",2,0,"","ad"],
    ["ios-jam-freeuserskipupsellpage-impl","free_user_skip_upsell_sheet_enabled",2,0,"","ad"],
    ["ios-jam-freehostedjamsupsell-impl","free_hosted_jams_upsell_enabled",2,0,"","ad"],
    ["ios-reinventfree-contextualupsellpremiumpromo-impl","is_promo_cta_enabled",2,0,"","ad"],
    ["ios-reinventfree-contextualupsellpremiumpromo-impl","show_time_cap_upsell_with_premium_badge",2,0,"","ad"],
    ["ios-reinventfree-controllerui-impl","enable_video_time_cap_upsell",2,0,"","ad"],
    ["ios-reinventfree-controllerui-impl","enable_video_time_cap_upsell_on_search",2,0,"","ad"],
    ["ios-reinventfree-timecappivot-impl","music_video_upsell_enabled",2,0,"","ad"],
    ["ios-settings-mediaqualitypageplugin-impl","is_gbb_upsell_enabled",2,0,"","ad"],
    ["ios-settings-mediaqualitypageplugin-impl","should_show_pigeon_upsell",2,0,"","ad"],
    ["ios-system-listeningparties","preview_ended_upsell_enabled",2,0,"","ad"],
    ["","enable_now_playing_ad",1,0,"","ad"],
    ["","enable_now_playing_ads",1,0,"","ad"],
    ["","enable_now_playing_banner_ad",1,0,"","ad"],
    ["","enable_now_playing_banner_ads",1,0,"","ad"],
    ["","enable_now_playing_sponsored_ad",1,0,"","ad"],
    ["","enable_now_playing_sponsored_ads",1,0,"","ad"],
    ["","enable_now_playing_upsell",1,0,"","ad"],
    ["","enable_artist_ad",1,0,"","ad"],
    ["","enable_artist_ads",1,0,"","ad"],
    ["","enable_artist_banner_ad",1,0,"","ad"],
    ["","enable_artist_banner_ads",1,0,"","ad"],
    ["","enable_artist_sponsored_ad",1,0,"","ad"],
    ["","enable_artist_sponsored_ads",1,0,"","ad"],
    ["","enable_artist_upsell",1,0,"","ad"],
    ["","enable_playlist_ad",1,0,"","ad"],
    ["","enable_playlist_ads",1,0,"","ad"],
    ["","enable_playlist_banner_ad",1,0,"","ad"],
    ["","enable_playlist_banner_ads",1,0,"","ad"],
    ["","enable_playlist_sponsored_ad",1,0,"","ad"],
    ["","enable_playlist_sponsored_ads",1,0,"","ad"],
    ["","enable_playlist_upsell",1,0,"","ad"],
    ["","enable_album_ad",1,0,"","ad"],
    ["","enable_album_ads",1,0,"","ad"],
    ["","enable_album_banner_ad",1,0,"","ad"],
    ["","enable_album_banner_ads",1,0,"","ad"],
    ["","enable_album_sponsored_ad",1,0,"","ad"],
    ["","enable_album_sponsored_ads",1,0,"","ad"],
    ["","enable_album_upsell",1,0,"","ad"],
    ["","enable_library_ad",1,0,"","ad"],
    ["","enable_library_ads",1,0,"","ad"],
    ["","enable_library_banner_ad",1,0,"","ad"],
    ["","enable_library_banner_ads",1,0,"","ad"],
    ["","enable_library_sponsored_ad",1,0,"","ad"],
    ["","enable_library_sponsored_ads",1,0,"","ad"],
    ["","enable_library_upsell",1,0,"","ad"],
    ["","enable_audiobook_ad",1,0,"","ad"],
    ["","enable_audiobook_ads",1,0,"","ad"],
    ["","enable_audiobook_banner_ad",1,0,"","ad"],
    ["","enable_audiobook_banner_ads",1,0,"","ad"],
    ["","enable_audiobook_sponsored_ad",1,0,"","ad"],
    ["","enable_audiobook_sponsored_ads",1,0,"","ad"],
    ["","enable_audiobook_upsell",1,0,"","ad"],
    ["","enable_podcast_ad",1,0,"","ad"],
    ["","enable_podcast_ads",1,0,"","ad"],
    ["","enable_podcast_banner_ad",1,0,"","ad"],
    ["","enable_podcast_banner_ads",1,0,"","ad"],
    ["","enable_podcast_sponsored_ad",1,0,"","ad"],
    ["","enable_podcast_sponsored_ads",1,0,"","ad"],
    ["","enable_podcast_upsell",1,0,"","ad"],
    ["","enable_sponsored_content",1,0,"","ad"],
    ["","enable_sponsored_playlists",1,0,"","ad"],
    ["","enable_sponsored_sessions",1,0,"","ad"],
    ["","enable_sponsored_stories",1,0,"","ad"],
    ["","enable_sponsored_videos",1,0,"","ad"],
    ["","enable_sponsored_artist",1,0,"","ad"],
    ["","enable_sponsored_artists",1,0,"","ad"],
    ["","enable_sponsored_album",1,0,"","ad"],
    ["","enable_sponsored_albums",1,0,"","ad"],
    ["","enable_sponsored_track",1,0,"","ad"],
    ["","enable_sponsored_tracks",1,0,"","ad"],
    ["","enable_sponsored_show",1,0,"","ad"],
    ["","enable_sponsored_shows",1,0,"","ad"],
    ["","enable_sponsored_episode",1,0,"","ad"],
    ["","enable_sponsored_episodes",1,0,"","ad"],
    ["","enable_sponsored_audiobook",1,0,"","ad"],
    ["","enable_sponsored_audiobooks",1,0,"","ad"],
    ["","enable_sponsored_podcast",1,0,"","ad"],
    ["","enable_sponsored_podcasts",1,0,"","ad"],
    ["","enable_sponsored_search",1,0,"","ad"],
    ["","enable_sponsored_search_results",1,0,"","ad"],
    ["","enable_sponsored_search_banner",1,0,"","ad"],
    ["","enable_sponsored_search_banners",1,0,"","ad"],
    ["","enable_sponsored_home",1,0,"","ad"],
    ["","enable_sponsored_home_banner",1,0,"","ad"],
    ["","enable_sponsored_home_banners",1,0,"","ad"],
    ["","enable_sponsored_now_playing",1,0,"","ad"],
    ["","enable_sponsored_now_playing_banner",1,0,"","ad"],
    ["","enable_sponsored_now_playing_banners",1,0,"","ad"],
    ["","enable_sponsored_artist_banner",1,0,"","ad"],
    ["","enable_sponsored_artist_banners",1,0,"","ad"],
    ["","enable_sponsored_playlist_banner",1,0,"","ad"],
    ["","enable_sponsored_playlist_banners",1,0,"","ad"],
    ["","enable_sponsored_album_banner",1,0,"","ad"],
    ["","enable_sponsored_album_banners",1,0,"","ad"],
    ["","enable_sponsored_library_banner",1,0,"","ad"],
    ["","enable_sponsored_library_banners",1,0,"","ad"],
    ["","enable_sponsored_audiobook_banner",1,0,"","ad"],
    ["","enable_sponsored_audiobook_banners",1,0,"","ad"],
    ["","enable_sponsored_podcast_banner",1,0,"","ad"],
    ["","enable_sponsored_podcast_banners",1,0,"","ad"],
    ["","enable_sponsored_search_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_search_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_home_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_home_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_now_playing_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_now_playing_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_artist_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_artist_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_playlist_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_playlist_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_album_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_album_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_library_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_library_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_audiobook_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_audiobook_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_podcast_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_podcast_sponsored_ads",1,0,"","ad"],
    ["ios-ad-on-app-open","",0,0,"","ad"],
    ["ios-feature-adonappopen","",0,0,"","misc"],
    ["ios-feature-adonappopen","enabled",1,0,"","misc"],
    ["ios-feature-adonappopen","background_refresh_frequency_seconds",1,0,"","misc"],
    ["","is_ad_on_app_open_enabled",1,0,"","ad"],
    ["","ad_on_app_open_enabled",1,0,"","ad"],
    ["","adonappopen_enabled",1,0,"","misc"],
    ["marquee","",0,0,"","ad"],
    ["ios-feature-marquee","",0,0,"","ad"],
    ["leavebehindadsbase","",0,0,"","misc"],
    ["ios-feature-leavebehindadsbase","",0,0,"","misc"],
    ["ios-nowplaying-scroll-impl","unified_leavebehind_npv_scroll_music_enabled",2,0,"","misc"],
    ["ios-nowplaying-scroll-impl","unified_leavebehind_npv_scroll_podcast_enabled",2,0,"","misc"],
    ["ios-feature-embeddedplaylist","use_unified_leavebehind_fetch",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","foreground_enabled",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","music_track_change_enabled",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","enable_ads_on_podcast",2,0,"","ad"],
    ["ios-feature-instreamads","",0,0,"","misc"],
    ["ios-adsembedded-embeddedctaelements-impl","",0,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","",0,0,"","misc"],
    ["ios-adsplatform-elementimpl","",0,0,"","misc"],
    ["ios-system-adssponsoredcontext","",0,0,"","ad"],
    ["ios-feature-adsbase","enable_ads_connect_state_observer",1,0,"","ad"],
    ["ios-feature-adsbase","enable_minimal_preroll_management",1,0,"","misc"],
    ["ios-feature-adsbase","enable_swift_ads_base_movement_logger",1,0,"","ad"],
    ["ios-feature-adsswift","",0,0,"","misc"],
    ["ios-feature-adsnowplayingui","embedded_npv_video_show_with_canvas",2,0,"","misc"],
    ["ios-feature-adssponsoredcontext","sponsored_context_mismatch_aderror_enabled",1,0,"","ad"],
    ["ios-feature-adssponsoredcontext","sponsored_playlist_v2_enabled",1,0,"","ad"],
    ["ios-feature-adssponsoredcontextnpbattachment","sponsored_npb_slot_fetch_enabled",1,0,"","ad"],
    ["ios-feature-adsidentitytracking","",0,0,"","misc"],
    ["","enable_popups",1,0,"","ad"],
    ["","enable_leave_behind_ads_card_element",1,0,"","ad"],
    ["","music_npv_leavebehinds_enabled",1,0,"","misc"],
    ["","enable_ads_on_podcast",1,0,"","ad"],
    ["","enable_display_element",1,0,"","misc"],
    ["","enable_video_element",1,0,"","misc"],
    ["","is_promo_cta_enabled",1,0,"","ad"],
    ["","show_time_cap_upsell_with_premium_badge",1,0,"","ad"],
    ["","enable_video_time_cap_upsell",1,0,"","ad"],
    ["","enable_video_time_cap_upsell_on_search",1,0,"","ad"],
    ["","music_video_upsell_enabled",1,0,"","ad"],
    ["","is_gbb_upsell_enabled",1,0,"","ad"],
    ["","should_show_pigeon_upsell",1,0,"","ad"],
    ["","disable_suggested_tracks_upsell",1,1,"","ad"],
    ["","is_enabled_pt2",1,0,"","misc"],
    ["","show_skip_button_during_skippable_ads",1,1,"","ad"],
    ["","sponsored_playlist_v2_header_dismissible",1,1,"","ad"],
    ["","use_mock_sponsorship_endpoint",1,0,"","ad"],
    ["","enable_popup",1,0,"","ad"],
    ["","show_popups",1,0,"","ad"],
    ["","show_popup",1,0,"","ad"],
    ["","enable_interstitials",1,0,"","misc"],
    ["","enable_interstitial",1,0,"","ad"],
    ["","enable_overlays",1,0,"","misc"],
    ["","enable_overlay",1,0,"","misc"],
    ["","enable_promotions_on_home",1,0,"","ad"],
    ["","enable_promotions_on_search",1,0,"","ad"],
    ["","enable_search_page_ads",1,0,"","ad"],
    ["","enable_home_page_ads",1,0,"","ad"],
    ["","enable_billboard",1,0,"","ad"],
    ["","enable_billboards",1,0,"","misc"],
    ["","enable_audio_ads_player",1,0,"","ad"],
    ["","enable_display_ads_player",1,0,"","ad"],
    ["","enable_video_ads_player",1,0,"","ad"],
    ["","enable_audio_ads_player_v2",1,0,"","ad"],
    ["","enable_display_ads_player_v2",1,0,"","ad"],
    ["","enable_video_ads_player_v2",1,0,"","ad"],
    ["","enable_sponsored_search_results_v2",1,0,"","ad"],
    ["","enable_sponsored_home_results_v2",1,0,"","ad"],
    ["ios-feature-search","prompted_playlist_merchandizing_enabled",1,0,"","misc"],
    ["","should_nova_scroll_use_scrollsita",0,0,"","misc"],
    ["ios-sociallistening-configuration-impl","premium_gated_start_jam_buttons_enabled",2,0,"","misc"],
    // 歌词相关开关保持开启：客户端只有在这些开关打开时才会请求 color-lyrics。
    ["ios-feature-lyrics","is_lyrics_card_element_enabled",2,1,"","misc"],
    ["ios-feature-lyrics","is_get_lyrics_v2_enabled",2,1,"","misc"],
    ["ios-feature-lyrics","enable_lyrics",2,1,"","misc"]
  ];

  // -------------------------------------------------------------- attributes

  const yearOn = new Date(Date.now() + 365 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const ATTR_CORE = {
    // 不写 enable-crossfade-product-state：免费号被强行解锁交叉淡入淡出后，
    // App 会按本地滑杆把下一首提前混进来。保留服务端下发的值，只解锁 Gapless。
    "enable-gapless-product-state": "1",
    "catalogue": "premium",
    "financial-product": "pr:premium,tc:0",
    "is-eligible-premium-unboxing": true,
    "name": "Spotify Premium",
    "nft-disabled": "1",
    "on-demand": true,
    "payments-initial-campaign": "default",
    "player-license": "premium",
    "player-license-v2": "premium",
    "product-expiry": yearOn,
    "shuffle-eligible": true,
    "streaming-rules": "",
    "subscription-enddate": yearOn,
    "type": "premium",
    "unrestricted": true,
    "can_use_superbird": true,
    "high-bitrate": true,
    "loudness-levels": "1:-5.0,0.0,3.0:-2.0",
    "mixing-tools": "EDIT",
    "your-library-tags": true,
    "libspotify": true,
    "lyrics-offline": true,
    "mobile": true,
    "pick-and-shuffle": false
  };

  const ATTR_ADS = {
    "ads": false,
    "ab-ad-player-targeting": "0",
    "allow-advertising-id-transmission": false,
    "restrict-advertising-id-transmission": true
  };

  // macOS 桌面端只写展示 / 广告属性。播放授权（player-license、streaming-rules、
  // on-demand、high-bitrate …）由服务端判定；强行写会让客户端以为有 Premium
  // 播放权，几秒后拿不到音频密钥就跳歌。需要时由 unlock_playback 单独打开。
  const MAC_ATTR = {
    "ads": false,
    "name": "Spotify Premium",
    "is-eligible-premium-unboxing": true,
    "nft-disabled": "1",
    "type": "premium",
    "product": "premium",
    "catalogue": "premium",
    // 让桌面客户端优先采用 UCS 下发的 product state，这样才会相信改写的
    // product / catalogue，而不是回头再查账号状态。只影响展示与远程配置。
    "com.spotify.madprops.delivered.by.ucs": true,
    "com.spotify.madprops.use.ucs.product.state": true
  };

  const MAC_PLAY_ATTR = {
    "player-license": "premium",
    "player-license-v2": "premium",
    "streaming-rules": "",
    "on-demand": true,
    "unrestricted": true,
    "high-bitrate": true,
    "financial-product": "pr:premium,tc:0",
    "product-expiry": yearOn,
    "subscription-enddate": yearOn
  };

  // 会让客户端重新向服务端确认状态或弹出试用提示的属性，删除后避免回退到免费版。
  const STRIPPED = [
    "payment-state",
    "last-premium-activation-date",
    "on-demand-trial",
    "on-demand-trial-in-progress",
    "smart-shuffle",
    "at-signal",
    "feature-set-id-masked",
    "strider-key",
    "is-eligible-for-trial",
    "is-eligible-for-upsell",
    "upsell-state",
    "ad-session-persistence",
    "ad-formats-preroll-video"
  ];

  const forced = desktop
    ? Object.assign(
        {},
        spoof ? MAC_ATTR : {},
        adsOn ? ATTR_ADS : {},
        spoof && playOn ? MAC_PLAY_ATTR : {}
      )
    : Object.assign({}, spoof ? ATTR_CORE : {}, adsOn ? ATTR_ADS : {});
  const has = (key) => Object.prototype.hasOwnProperty.call(forced, key);
  const stripped = (key) => {
    if (!spoof) return false;
    if (key.indexOf("is-premium-eligible") === 0) return true;
    if (!adsOn && key.indexOf("ad") === 0) return false;
    return STRIPPED.indexOf(key) >= 0;
  };

  const attributeEntry = (key, value) => {
    const inner = typeof value === "string" ? fieldString(4, value) : fieldVarint(2, value ? 1 : 0);
    return fieldBytes(1, serialize([fieldString(1, key), fieldBytes(2, serialize([inner]))]));
  };

  function patchAttributes(buffer, fields = parse(buffer)) {
    if (!fields || !same(serialize(fields), buffer)) return null;
    const out = [];
    const seen = Object.create(null);
    for (const f of fields) {
      let key = null;
      if (f.no === 1 && f.w === 2) {
        const inner = parse(f.p);
        if (inner) key = text(first(inner, 1));
      }
      if (!key || (!has(key) && !stripped(key))) {
        out.push(f);
        continue;
      }
      if (!has(key)) continue;
      seen[key] = true;
      out.push(attributeEntry(key, forced[key]));
    }
    for (const key in forced) if (!seen[key]) out.push(attributeEntry(key, forced[key]));
    return serialize(out);
  }

  // ------------------------------------------------------------ remote config

  const boolValue = (on) => (on ? serialize([fieldVarint(1, 1)]) : new Uint8Array(0));

  function setValue(value, replacement) {
    const kept = value.filter((f) => f.no < 3 || f.no > 5);
    kept.push(replacement);
    return kept;
  }

  function patchConfiguration(buffer, fields = parse(buffer), assigned = null) {
    if (!fields || !same(serialize(fields), buffer)) return null;
    const out = [];
    const present = Object.create(null);
    // 本次响应的规则索引，只分配引用；保留原始规则顺序（包括通配规则）。
    const byName = new Map();
    const wildcard = [];
    for (let i = 0; i < RULES.length; i++) {
      const rule = RULES[i];
      if ((rule[5] === "ad" && !adsOn) || (rule[5] === "cap" && !playOn)) continue;
      if (!rule[1]) wildcard.push(i);
      else {
        if (!byName.has(rule[1])) byName.set(rule[1], []);
        byName.get(rule[1]).push(i);
      }
    }
    for (const f of fields) {
      let value = null;
      const described = assigned && assigned.get(f);
      if (f.no === 3 && f.w === 2) value = described ? described.value : parse(f.p);
      if (!value || !same(serialize(value), f.p)) {
        out.push(f);
        continue;
      }
      const identifier = first(value, 1);
      const parts = described ? described.parts : identifier && identifier.w === 2 ? parse(identifier.p) : null;
      if (!parts) {
        out.push(f);
        continue;
      }
      const scope = text(first(parts, 1)) || "";
      const name = text(first(parts, 2)) || "";
      let removed = false;
      let touched = false;
      const named = byName.get(name) || [];
      let ni = 0;
      let wi = 0;
      while (ni < named.length || wi < wildcard.length) {
        const index = wi >= wildcard.length || (ni < named.length && named[ni] < wildcard[wi]) ? named[ni++] : wildcard[wi++];
        const rule = RULES[index];
        if (rule[0] && rule[0] !== scope) continue;
        if (rule[1] && rule[1] !== name) continue;
        touched = true;
        if (rule[2] === 0) {
          removed = true;
          break;
        }
        if (rule[2] === 1) {
          if (first(value, 3)) value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else if (rule[2] === 2) {
          value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else {
          value = setValue(value, fieldBytes(5, serialize([fieldString(1, rule[4])])));
        }
      }
      if (removed) continue;
      present[scope + "\u0000" + name] = true;
      if (touched) f.p = serialize(value);
      out.push(f);
    }
    for (const rule of RULES) {
      if (rule[2] !== 2 || !rule[0] || !rule[1]) continue;
      if (rule[5] === "ad" && !adsOn) continue;
      if (present[rule[0] + "\u0000" + rule[1]]) continue;
      const identifier = serialize([fieldString(1, rule[0]), fieldString(2, rule[1])]);
      out.push(fieldBytes(3, serialize([fieldBytes(1, identifier), fieldBytes(3, boolValue(rule[3]))])));
    }
    return serialize(out);
  }

  // 新版 App 会在 bootstrap 之后重新拉取远程配置与账号属性；
  // 这里套用同一套规则 / 属性表，避免覆盖已写入的开关。

  function describeConfiguration(fields) {
    if (!fields || !fields.length) return null;
    const assigned = new Map();
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const value = parse(f.p);
      if (!value) return null;
      const identifier = first(value, 1);
      const parts = identifier && identifier.w === 2 ? parse(identifier.p) : null;
      if (!parts) return null;
      const scope = text(first(parts, 1));
      const name = text(first(parts, 2));
      if (!scope || !name) return null;
      assigned.set(f, { value, parts });
    }
    // 保留未知字段，只要求 AssignedValue 列表结构正确。
    return assigned.size ? assigned : null;
  }

  function patchConfigurationResponse(buffer) {
    const fields = parse(buffer);
    if (!fields || !same(serialize(fields), buffer)) return null;
    let target = buffer;
    let wrapper = null;
    let targetFields = fields;
    let assigned = null;
    if (fields.length === 1 && fields[0].no === 1 && fields[0].w === 2) {
      const inner = parse(fields[0].p);
      const description = inner && describeConfiguration(inner);
      if (description && same(serialize(inner), fields[0].p)) {
        wrapper = fields;
        target = fields[0].p;
        targetFields = inner;
        assigned = description;
      }
    }
    assigned = assigned || describeConfiguration(targetFields);
    if (!assigned) return null;
    const patched = patchConfiguration(target, targetFields, assigned);
    if (!patched || same(patched, target)) return null;
    if (wrapper) {
      wrapper[0].p = patched;
      return serialize(wrapper);
    }
    return patched;
  }

  function looksLikeAttributes(buffer, fields = parse(buffer)) {
    if (!fields || !fields.length) return false;
    let entries = 0;
    for (const f of fields) {
      if (f.no !== 1 || f.w !== 2) continue;
      const inner = parse(f.p);
      if (!inner) return false;
      const key = text(first(inner, 1));
      const value = first(inner, 2);
      if (!key || key.length > 64 || !value || value.w !== 2) return false;
      const parts = parse(value.p);
      if (!parts) return false;
      for (const vf of parts) {
        if (vf.no === 2 && vf.w === 0) continue;
        if (vf.no === 3 && vf.w === 0) continue;
        if (vf.no === 4 && vf.w === 2) continue;
        return false;
      }
      entries++;
    }
    // 顶层其它字段原样保留；至少有一条合法属性才按属性表处理。
    return entries > 0;
  }

  function patchAttributesResponse(buffer) {
    const fields = parse(buffer);
    if (!fields || !same(serialize(fields), buffer)) return null;
    if (!looksLikeAttributes(buffer, fields)) return null;
    const patched = patchAttributes(buffer, fields);
    if (!patched || same(patched, buffer)) return null;
    return patched;
  }

  // ---------------------------------------------------------------- response

  function patchUcs(buffer, fields = parse(buffer)) {
    if (!fields || !same(serialize(fields), buffer)) return null;
    const resolve = first(fields, 1);
    let attributes = first(fields, 3);
    // 字段 3 也可能是 ResolveConfiguration 的 AssignedValue，需先确认结构。
    if (attributes && (attributes.w !== 2 ||
        (attributes.p.length && !looksLikeAttributes(attributes.p)))) return null;
    // 没有 resolve 也没有 attributes 时，不按 UCS 处理。
    if (!attributes) {
      const inner = resolve && resolve.w === 2 ? parse(resolve.p) : null;
      const configuration = inner ? first(inner, 1) : null;
      if (!configuration || configuration.w !== 2) return null;
      attributes = fieldBytes(3, new Uint8Array(0));
      fields.push(attributes);
    }
    if (resolve && resolve.w === 2) {
      const edited = edit(resolve.p, [1], patchConfiguration);
      if (edited) resolve.p = edited;
    }
    if (attributes.w === 2) {
      const edited = patchAttributes(attributes.p);
      if (edited) attributes.p = edited;
    }
    return serialize(fields);
  }

  const patchCustomize = (b) => edit(b, [1], patchUcs);
  const patchBootstrap = (b) => edit(b, [2, 1, 1, 1], patchUcs);

  // 桌面端的 BootstrapMessage / UcsResponseWrapper 外层可能和 iOS 不一样。
  // 这里先确认目标确实像 UcsResponse（有 AccountAttributesResponse 的 map entry），
  // 再调用 patchUcs，避免把 ResolveResponse 之类结构误当成 UCS 写坏。
  function looksLikeUcs(buffer, fields = parse(buffer)) {
    if (!fields) return false;
    const attributes = first(fields, 3);
    if (!attributes || attributes.w !== 2) return false;
    const entries = parse(attributes.p);
    if (!entries) return false;
    for (const f of entries) {
      if (f.no !== 1 || f.w !== 2) continue;
      const entry = parse(f.p);
      if (!entry) continue;
      const key = text(first(entry, 1));
      const value = first(entry, 2);
      if (!key || key.length > 64 || !value || value.w !== 2) continue;
      // AccountAttribute 的 value 是 { 2: bool | 3: long | 4: string }。
      // ResolveConfiguration 的 AssignedValue 也是「1: identifier, 2: ...」结构，
      // 但 identifier 的字段 2 是 name 字符串，不是 value message，必须排除。
      const valueFields = parse(value.p);
      if (!valueFields) continue;
      // 空 message 也是合法的 AccountAttribute（bool = false 时就是空）。
      let valid = true;
      for (const vf of valueFields) {
        if (vf.no === 2 && vf.w === 0) continue;
        if (vf.no === 3 && vf.w === 0) continue;
        if (vf.no === 4 && vf.w === 2) continue;
        valid = false;
        break;
      }
      if (valid) return true;
    }
    return false;
  }

  function editUcs(message, path) {
    if (!path.length) return looksLikeUcs(message) ? patchUcs(message) : null;
    const fields = parse(message);
    if (!fields || !same(serialize(fields), message)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = editUcs(f.p, path.slice(1));
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  function patchUcsIfChanged(buffer, fields = parse(buffer)) {
    const out = patchUcs(buffer, fields);
    return out && !same(out, buffer) ? out : null;
  }

  function patchNested(buffer) {
    const fields = parse(buffer);
    if (!fields || !same(serialize(fields), buffer)) return null;
    const walk = (fields, depth) => {
      let changed = false;
      for (const f of fields) {
        if (f.w !== 2) continue;
        const sub = parse(f.p);
        if (!sub || !same(serialize(sub), f.p)) continue;
        if (looksLikeUcs(f.p, sub)) {
          const patched = patchUcsIfChanged(f.p, sub);
          if (patched) {
            f.p = patched;
            changed = true;
            continue;
          }
        }
        if (depth < 8 && walk(sub, depth + 1)) {
          f.p = serialize(sub);
          changed = true;
        }
      }
      return changed;
    };
    return walk(fields, 0) ? serialize(fields) : null;
  }

  function patchCustomizeDesktop(buffer) {
    if (looksLikeUcs(buffer)) {
      const direct = patchUcsIfChanged(buffer);
      if (direct) return direct;
    }
    const known = editUcs(buffer, [1]);
    if (known && !same(known, buffer)) return known;
    return patchNested(buffer);
  }

  function patchBootstrapDesktop(buffer) {
    if (looksLikeUcs(buffer)) {
      const direct = patchUcsIfChanged(buffer);
      if (direct) return direct;
    }
    const known = editUcs(buffer, [2, 1, 1, 1]);
    if (known && !same(known, buffer)) return known;
    return patchNested(buffer);
  }

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
  const QUEUE_KEY = "spotify.queue";
  const QUEUE_MAX = 8;
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

  // connect-state 的 PlayerState 字段号：track = 7，prev_tracks = 19，next_tracks = 20。
  // 不能简单取“当前曲目后面第一首”：连接状态里 prev_tracks 也排在后面，按遍历顺序
  // 取会把上一首当成下一首。这里按字段号把 current / next 分开。
  function trackUriOf(fields) {
    for (const f of fields) {
      if (f.no !== 1 || f.w !== 2 || f.p.length !== 36) continue;
      const value = text(f);
      if (value && /^spotify:track:[A-Za-z0-9]{22}$/.test(value)) return value.slice(14);
    }
    return "";
  }

  function scanPlayerState(fields, out, depth) {
    if (depth > 8 || out.current) return;
    const currentField = first(fields, 7);
    const nextFields = fields.filter((f) => f.no === 20 && f.w === 2);
    const prevFields = fields.filter((f) => f.no === 19 && f.w === 2);
    if (currentField && currentField.w === 2 && (nextFields.length || prevFields.length)) {
      const current = parse(currentField.p);
      const id = current ? trackUriOf(current) : "";
      if (id) {
        out.current = id;
        out.next = nextFields
          .map((f) => {
            const sub = parse(f.p);
            return sub ? trackUriOf(sub) : "";
          })
          .filter(Boolean)
          .slice(0, QUEUE_MAX);
        return;
      }
    }
    for (const f of fields) {
      if (f.w !== 2) continue;
      const sub = parse(f.p);
      if (sub) scanPlayerState(sub, out, depth + 1);
    }
  }

  // feed 脚本补歌词卡时用这里存下的 next 预取下一首；换歌后再打开歌词页直接命中缓存。
  function rememberQueue(queue) {
    const store = cacheStore();
    if (!store || !queue || !queue.current) return;
    const next = (queue.next || []).slice(0, QUEUE_MAX);
    try {
      const raw = store.read(QUEUE_KEY);
      const old = raw ? JSON.parse(raw) : null;
      const same = old && old.current === queue.current &&
        Array.isArray(old.next) && old.next.length === next.length &&
        old.next.every((id, i) => id === next[i]);
      // 队列没变时不重复写，避免 connect-state 轮询一直写存储。
      if (same && Number(old.at) && Date.now() - Number(old.at) < 5 * 60 * 1000) return;
      store.write(JSON.stringify({ current: queue.current, next: next, at: Date.now() }), QUEUE_KEY);
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
    if (target.indexOf("/connect-state/") >= 0) {
      const queue = { current: "", next: [] };
      scanPlayerState(fields, queue, 0);
      rememberQueue(queue);
    }
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

  // spotify.js 也复用歌词查询 / 缓存：connect-state 换歌时先把当前曲目的歌词查好，
  // 打开歌词页或滚动页补卡时就能直接命中缓存。这里只加载 prefetch 入口。
  const SPOTIFY_LYRICS_PREFETCH = true;
  const SPOTIFY_PREFETCH_OPTIONS = (() => {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source, prefetch
      return { enable_lyrics: raw[3], lyrics_source: raw[5], prefetch: raw[6] };
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "{}") || {};
        return { enable_lyrics: parsed.enable_lyrics, lyrics_source: parsed.lyrics_source, prefetch: parsed.prefetch };
      } catch (e) {
        return {};
      }
    }
    if (raw && "object" == typeof raw) {
      return { enable_lyrics: raw.enable_lyrics, lyrics_source: raw.lyrics_source, prefetch: raw.prefetch };
    }
    return {};
  })();

// Spotify Lyrics — 官方没有歌词时，用第三方歌词补上。
//
// 只处理 color-lyrics/v{N}/track/{id} 的响应：
//   200 且歌词非空  -> 清掉额度限制后原样放行（官方歌词质量更好）
//   404 / 空歌词    -> 取曲目元数据，按配置的歌词源查找，合成同结构响应
//
// spotify.js 补曲目 has_lyrics；feed 脚本在 scrollsita 缺少歌词 section 时补一格。
//
// 元数据：优先读 spotify.js 存下的客户端元数据（connect-state / context-resolve /
// metadata/4/track），命中时零外部请求；没命中才退回 open.spotify.com 的 oEmbed
// 与 embed 页面（公开接口，不需要 token）。
// 歌词源：LRCLIB / Musixmatch / 网易云 / QQ 音乐
//
// 客户端模式：Loon 传第 3 个参数 desktop=auto / ios / macos；auto 按 User-Agent
// 识别。没有 body 的 404 会优先按客户端请求的格式（JSON / protobuf）合成，
// 桌面端默认 JSON，iOS 无格式提示时默认 protobuf。
//
// 任何一步失败都原样放行，App 仍然显示它自己的「暂无歌词」，不会卡住播放。

(() => {
  "use strict";

  // feed 脚本会在同一份源码上以 prefetch 模式加载：只暴露歌词查询 / 缓存，
  // 不处理 color-lyrics 响应。独立歌词脚本仍按原来的入口执行。
  const PREFETCH = typeof SPOTIFY_LYRICS_PREFETCH !== "undefined" && SPOTIFY_LYRICS_PREFETCH;

  const req = typeof $request !== "undefined" && $request ? $request : null;
  const res = typeof $response !== "undefined" && $response ? $response : null;
  const url = (res && res.url) || (req && req.url) || "";

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  if (PREFETCH) {
    // feed 的位置参数和歌词脚本不同，由 feed/lyrics-prefetch.js 解析后传入。
    opt = typeof SPOTIFY_PREFETCH_OPTIONS !== "undefined" && SPOTIFY_PREFETCH_OPTIONS ? SPOTIFY_PREFETCH_OPTIONS : {};
  } else {
    try {
      const raw = typeof $argument !== "undefined" ? $argument : undefined;
      if (Array.isArray(raw)) {
        const modes = ["full", "no_card", "metadata_only", "response_only", "card_only"];
        const modeInThird = modes.indexOf(raw[2]) >= 0;
        opt = { lyrics_source: raw[0], enable_lyrics: raw[1], desktop: modeInThird ? false : raw[2],
          lyrics_mode: modeInThird ? raw[2] : modes.includes(raw[3]) ? raw[3] : undefined };
      }
      else if (typeof raw === "string") {
        try {
          opt = JSON.parse(raw || "{}") || {};
        } catch (e) {
          // Loon 单参数时可能直接传字符串
          opt = { lyrics_source: raw };
        }
      } else if (raw && "object" == typeof raw) opt = raw;
    } catch (e) {
      opt = {};
    }
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));
  // 客户端模式：auto 按 User-Agent 识别，拿不到 UA 时再看 Loon 运行环境。
  const requestUserAgent = () => {
    if (!req || !req.headers || "object" != typeof req.headers) return "";
    for (const key in req.headers) {
      if (String(key).toLowerCase() !== "user-agent") continue;
      const value = req.headers[key];
      return String(Array.isArray(value) ? value[0] || "" : value == null ? "" : value);
    }
    return "";
  };
  const detectDesktop = () => {
    const ua = requestUserAgent();
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
    if (/Macintosh|Mac OS X|Darwin|Windows NT/i.test(ua)) return true;
    const loon = typeof $loon !== "undefined" ? String($loon) : "";
    return /^Mac\b/i.test(loon);
  };
  const desktopMode = (v) => {
    if (v === undefined || v === null || v === "") return detectDesktop();
    const mode = String(v).trim().toLowerCase();
    if (mode === "auto") return detectDesktop();
    if (mode === "macos" || mode === "mac" || mode === "desktop") return true;
    if (mode === "ios" || mode === "iphone" || mode === "ipad" || mode === "mobile") return false;
    return flag(v, false);
  };
  const desktop = desktopMode(opt.desktop);

  // 参数关闭时直接放行；请求阶段的缓存命中在下面处理，未命中同样立即放行。
  // Loon 靠 enable= 决定是否加载脚本，Egern 不支持条件加载，只能在这里早退。
  if (!PREFETCH && (!flag(opt.enable_lyrics, true) || opt.lyrics_mode === "metadata_only" || opt.lyrics_mode === "card_only")) {
    $done({});
    return;
  }

  const match = /\/color-lyrics\/v\d\/track\/([A-Za-z0-9]+)/.exec(url);
  let trackId = PREFETCH ? "" : match ? match[1] : "";
  if (!PREFETCH && !match) {
    $done({});
    return;
  }

  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const utf8 = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  // spotify.js 在改写曲目元数据时，顺手把曲名 / 歌手 / 时长存进了本地存储。
  // 命中时连 oEmbed 都不用请求，只留 embed 页面取封面配色。
  const TRACK_CACHE_KEY = "spotify.track.meta";
  const TRACK_CACHE_MAX = 24;

  // 歌词结果缓存：同一首歌的播放器、歌词页与歌词卡会重复请求 color-lyrics，
  // 命中后直接回缓存，不再打第三方源。命中的歌词基本不会变，存久一点；
  // 查不到 / 超时都不写缓存，避免一次网络抖动把这首歌判成「无歌词」。
  const LYRICS_CACHE_KEY = "spotify.lyrics.cache";
  const LYRICS_CACHE_MAX = 24;
  const LYRICS_CACHE_HIT_TTL = 24 * 60 * 60 * 1000;
  const LYRICS_CACHE_MAX_LINES = 400;
  const LYRICS_CACHE_MAX_BYTES = 400 * 1024;
  const LYRICS_DEADLINE_MS = 5000;
  const PLAIN_FALLBACK_MS = 4000;
  // feed 脚本在返回 scrollsita 之前等歌词；和歌词页共用 5 秒预算，避免 Now Playing
  // 卡片列表等太久。超时就不补卡，歌词页之后仍可正常重试。
  const PREFETCH_DEADLINE_MS = 4000;

  // 请求阶段脚本调用 $done 后运行时会释放资源（Loon Script API 明确要求 $done
  // 之前结束所有异步任务），所以第三方查询不能挂在这个脚本里后台跑。这里改为
  // 「接力并行」：请求阶段登记待预取曲目，官方 color-lyrics 请求飞行的同时，随后
  // 到达的 connect-state / scrollsita 脚本并行查第三方歌词并写缓存；官方 404
  // 响应到达时直接命中缓存，不必再等一次完整查询。总耗时接近两者中较慢的那个。
  const PENDING_KEY = "spotify.lyrics.pending";
  const INFLIGHT_KEY = "spotify.lyrics.inflight";
  const MISS_KEY = "spotify.lyrics.miss";
  const PENDING_TTL_MS = 10000;
  const INFLIGHT_TTL_MS = 8000;
  // 刚确认过「官方和第三方都没有歌词」的曲目，短时间内不再补空卡。
  const MISS_TTL_MS = 5 * 60 * 1000;

  const storeBackend = () =>
    typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;

  function readJsonMap(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const map = raw ? JSON.parse(raw) : null;
      return map && "object" == typeof map && !Array.isArray(map) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function writeJsonMap(key, map) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(JSON.stringify(map), key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 预取接力标记：不同脚本实例（歌词 / connect-state / feed）之间只靠持久化
  // 存储通信，标记一律带时间戳，脚本被超时杀掉时也不会长期阻塞后续调度。
  function readMark(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && "object" == typeof value ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writeMark(key, value) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(value ? JSON.stringify(value) : "", key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  function activeMark(key, id, ttl) {
    const mark = readMark(key);
    return mark && (!id || mark.id === id) && Number(mark.at) && Date.now() - Number(mark.at) < ttl ? mark : null;
  }

  function cachedTrackMeta(id) {
    const map = readJsonMap(TRACK_CACHE_KEY);
    const value = map && map[id];
    if (!value || !value[0]) return null;
    const ms = Number(value[2]);
    const color = value[4];
    return {
      title: String(value[0]),
      artist: String(value[1] || "").trim(),
      duration: Number.isFinite(ms) && ms > 10000 ? ms / 1000 : undefined,
      color: color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))
        ? { r: Number(color.r), g: Number(color.g), b: Number(color.b) }
        : null,
    };
  }

  // 从 oEmbed / embed 拿到的元数据也写回同一份缓存：下次播放直接命中，
  // 连 open.spotify.com 都不用请求。顺便缓存封面色，歌词页背景保持一致。
  function rememberTrackMeta(id, title, artist, durationMs, color) {
    if (!id || !title) return;
    const map = readJsonMap(TRACK_CACHE_KEY) || {};
    const next = [String(title), String(artist || ""), Number(durationMs) || 0, Date.now()];
    if (color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))) {
      next[4] = { r: Number(color.r), g: Number(color.g), b: Number(color.b) };
    }
    const old = map[id];
    if (
      old &&
      old[0] === next[0] &&
      old[1] === next[1] &&
      Number(old[2]) === next[2] &&
      (!next[4] || (old[4] && old[4].r === next[4].r && old[4].g === next[4].g && old[4].b === next[4].b))
    ) return;
    map[id] = next;
    const ids = Object.keys(map).sort((a, b) => Number(map[b][3] || 0) - Number(map[a][3] || 0));
    for (const key of ids.slice(TRACK_CACHE_MAX)) delete map[key];
    writeJsonMap(TRACK_CACHE_KEY, map);
  }

  function lyricsSourceKey() {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    return wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq" ? wanted : "auto";
  }

  const lyricsCacheKey = (id) => lyricsSourceKey() + "|" + id;

  function readLyricsCache(key, id) {
    const map = readJsonMap(LYRICS_CACHE_KEY);
    const valid = (value) => !!value && "object" == typeof value && !value.m &&
      Date.now() - Number(value.t || 0) < LYRICS_CACHE_HIT_TTL;
    let entry = map && map[key];
    // 配置换过歌词源（auto ↔ lrclib）时旧缓存 key 会不同；按曲目 id 再找一次，
    // 避免同一首歌已经缓存过却因为前缀不同重新查源。
    if (!valid(entry) && id) {
      const suffix = "|" + id;
      for (const name of Object.keys(map || {})) {
        if (name.slice(-suffix.length) !== suffix) continue;
        const candidate = map[name];
        if (valid(candidate)) {
          entry = candidate;
          break;
        }
      }
    }
    if (!valid(entry)) return null;
    const lines = Array.isArray(entry.a) ? entry.a : [];
    if (!lines.length) return null;
    const signed = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
    const provider = String(entry.p || "LRCLIB");
    return {
      payload: {
        lyrics: {
          syncType: entry.s === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
          lines: lines.map((pair) => ({
            startTimeMs: String(Number(pair && pair[0]) || 0),
            words: String((pair && pair[1]) || ""),
            syllables: [],
            endTimeMs: "0",
          })),
          provider: provider,
          providerLyricsId: entry.i === undefined || entry.i === null ? "" : String(entry.i),
          providerDisplayName: provider,
          syncLyricsUri: "",
          isDenseTypeface: false,
          alternatives: [],
          language: String(entry.l || "en"),
          isRtlLanguage: false,
          fullscreenAction: "FULLSCREEN_LYRICS",
        },
        colors: {
          background: signed(Number(entry.c && entry.c[0]) || 0xff808080),
          text: signed(Number(entry.c && entry.c[1]) || 0xff000000),
          highlightText: signed(Number(entry.c && entry.c[2]) || 0xffffffff),
        },
        hasVocalRemoval: false,
      },
    };
  }

  function writeLyricsCache(key, payload) {
    // 只缓存真正拿到的歌词；查不到 / 超时都不写，下一次打开可以立刻重试。
    if (!payload) return;
    const map = readJsonMap(LYRICS_CACHE_KEY) || {};
    const now = Date.now();
    const lyrics = payload.lyrics || {};
    const colors = payload.colors || {};
    const lines = [];
    const raw = Array.isArray(lyrics.lines) ? lyrics.lines : [];
    for (let i = 0; i < raw.length && i < LYRICS_CACHE_MAX_LINES; i += 1) {
      const line = raw[i];
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      lines.push([Number(line.startTimeMs) || 0, line.words.slice(0, 200)]);
    }
    if (!lines.length) return;
    map[key] = {
      t: now,
      m: 0,
      s: lyrics.syncType === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
      p: String(lyrics.provider || "LRCLIB"),
      i: lyrics.providerLyricsId === undefined || lyrics.providerLyricsId === null ? "" : String(lyrics.providerLyricsId),
      l: String(lyrics.language || "en"),
      c: [Number(colors.background) || 0xff808080, Number(colors.text) || 0xff000000, Number(colors.highlightText) || 0xffffffff],
      a: lines,
    };
    for (const id of Object.keys(map)) {
      const entry = map[id];
      // 清掉旧版本留下的 miss 记录和过期条目。
      if (!entry || entry.m || !(now - Number(entry.t || 0) < LYRICS_CACHE_HIT_TTL)) delete map[id];
    }
    const byAge = () => Object.keys(map).sort((a, b) => Number(map[b].t || 0) - Number(map[a].t || 0));
    for (const id of byAge().slice(LYRICS_CACHE_MAX)) delete map[id];

    // 存储空间和解析成本都要控住：整包超过上限时继续按时间淘汰最旧的。
    const store = storeBackend();
    if (!store) return;
    try {
      let json = JSON.stringify(map);
      for (const id of byAge()) {
        if (json.length <= LYRICS_CACHE_MAX_BYTES || Object.keys(map).length <= 1) break;
        delete map[id];
        json = JSON.stringify(map);
      }
      store.write(json, LYRICS_CACHE_KEY);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 歌词页配色在 albumColors() 里按官方规则计算：封面主色做背景，未激活行黑色，
  // 当前 / 已唱行白色。三项都是 alpha=0xFF 的不透明色，不能依赖 alpha 区分。
  // 官方 previewLines 给 5 行；超过歌词总行数时按实际行数截断。
  const PREVIEW_LINES = 5;

  // 这些正则会在逐行解析里反复用到，提到外层只创建一次。
  const LRC_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const LRC_OFFSET = /^\[offset:\s*(-?\d+)\s*\]$/i;
  const LRC_BRACKET = /\[[^\]]*\]/g;
  const NORMALIZE_DROP = /[^\p{L}\p{M}\p{N}]+/gu;
  const LIVE_MARK = /(?:\blive\b|live版|现场|現場|[一二三四五六七八九十\d]+公)/i;
  const STAGE_MARK = /([一二三四五六七八九十\d]+公)/;
  const INSTRUMENTAL_MARK = /伴奏|instrumental|karaoke/i;
  const SONG_TITLE_LIVE = /\s*[-–—]\s*[^-–—]*(?:\blive\b|live版|现场|現場).*$/i;
  const SONG_TITLE_LIVE_BRACKET = /[（(][^()（）]*(?:live|现场|現場)[^()（）]*[)）]/gi;
  const SONG_TITLE_BRACKET_GROUP = /[（(]([^()（）]*)[)）]/g;
  // 括号里带这些词时说明是不同版本（Live / Remix / 伴奏…），不能当装饰信息删掉。
  const SONG_TITLE_VERSION_BRACKET = /\b(?:live|acoustic|unplugged|remix|mix|version|edit|remaster(?:ed)?|instrumental|karaoke|demo|cover|session|mono|stereo|deluxe|bonus|explicit|clean)\b|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|混音|重制|重製|翻唱|翻自|试听|試聽|片段|版/i;
  const SONG_TITLE_BRACKET_NOISE = /[（(\[][^()（）\[\]]*\b(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|feat\.?|ft\.?|featuring|with|prod\.?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\b[^()（）\[\]]*[)）\]]/gi;
  const SONG_TITLE_DASH_FEAT = /\s*[-–—]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)\b.*$/i;
  const SONG_TITLE_DASH_EDITION = /\s*[-–—]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\s*$/i;
  const ARTIST_SPLIT = /[,，、/;&]|\b(?:feat\.?|ft\.?|featuring|with)\b/i;
  const CJK_MARK = /[\u3400-\u9fff]/;
  const KANA_MARK = /[\u3040-\u30ff]/;
  const HANGUL_MARK = /[\uac00-\ud7af]/;
  const HAN_MARK = /[\u4e00-\u9fff]/;

  // 响应体上限：官方歌词正常 < 300 KiB，第三方 JSON 也远小于 2 MiB。
  // 超过上限直接放行 / 当作没查到，避免异常响应把脚本内存打爆。
  const MAX_LYRICS_BYTES = 2 * 1024 * 1024;
  const MAX_HTTP_JSON_BYTES = 2 * 1024 * 1024;

  let settled = false;
  let deadline;
  let plainTimer;
  let plainFallback = null;
  let cacheKey = "";
  let prefetchTimer;
  let prefetchCallback = null;
  let prefetchSettle = null;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (deadline !== undefined && typeof clearTimeout === "function") clearTimeout(deadline);
    if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
    // 请求阶段没有 $response：Loon / Egern / Shadowrocket 用 { response } 直接
    // 返回合成结果，跳过官方 color-lyrics 请求。
    if (!res) {
      $done(value && (value.status || value.body) ? { response: value } : {});
      return;
    }
    $done(value);
  };

  if (PREFETCH) {
    // 只暴露一个「先查歌词、写完缓存再回调」的入口。feed 脚本在补歌词卡之前
    // 调用它：歌词已经准备好才组装卡片，客户端随后请求 color-lyrics 时直接命中
    // 缓存，不会出现「卡片先出来、歌词过一会儿才到」的空卡。
    // timedOut 区分「查过了，确实没有歌词」和「窗口内没查完」：前者不补空卡，
    // 后者仍然乐观补卡，歌词内容交给随后到达的 color-lyrics 请求。
    prefetchSettle = (payload, timedOut) => {
      if (settled) return;
      settled = true;
      if (prefetchTimer !== undefined && typeof clearTimeout === "function") clearTimeout(prefetchTimer);
      if (activeMark(INFLIGHT_KEY, trackId, INFLIGHT_TTL_MS)) writeMark(INFLIGHT_KEY, null);
      const callback = prefetchCallback;
      prefetchCallback = null;
      if (callback) callback(payload, !!timedOut);
    };
    globalThis.__spotifyLyricsPrefetch = (id, callback, budgetMs) => {
      if (!id || typeof callback !== "function") return;
      if (!flag(opt.enable_lyrics, true)) {
        callback(null);
        return;
      }
      // 同一脚本实例会连续预取当前曲目和下一首：每轮重置状态与定时器。
      if (prefetchTimer !== undefined && typeof clearTimeout === "function") clearTimeout(prefetchTimer);
      if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
      settled = false;
      plainFallback = null;
      prefetchTimer = undefined;
      plainTimer = undefined;
      trackId = id;
      cacheKey = lyricsCacheKey(id);
      const waitMs = Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0
        ? Number(budgetMs) : PREFETCH_DEADLINE_MS;
      const cached = readLyricsCache(cacheKey, id);
      if (cached) {
        if (activeMark(INFLIGHT_KEY, id, INFLIGHT_TTL_MS)) writeMark(INFLIGHT_KEY, null);
        prefetchCallback = null;
        callback(cached.payload, false);
        return;
      }
      prefetchCallback = callback;
      // 标记「正在查这首歌」：connect-state 轮询看到后不会为同一首歌重复起查询。
      writeMark(INFLIGHT_KEY, { id: id, at: Date.now() });
      if (typeof setTimeout === "function") {
        prefetchTimer = setTimeout(() => {
          if (settled) return;
          // 窗口内没查完：不写缓存（结果还没回来），由调用方决定要不要乐观补卡。
          prefetchSettle(null, true);
        }, waitMs);
      }
      resolvePublicLyrics((payload) => {
        if (settled) return;
        writeLyricsCache(cacheKey, payload);
        // 明确查不到时也不写缓存，下次打开还能重试。
        prefetchSettle(payload);
      });
    };

    // scrollsita 补卡等待：不自己再查一次第三方源，而是轮询「歌词结果」标志位。
    // 标志位就是 spotify.lyrics.cache —— color-lyrics 响应阶段、connect-state
    // 预取拿到歌词都会写；spotify.lyrics.miss 表示已经确认没有歌词。
    // 读到歌词 -> 补卡且内容已就绪；读到 miss -> 不补空卡；超时 -> 乐观补卡，
    // 内容随后由 color-lyrics 请求填充（也避免「客户端等 scrollsita 才发
    // color-lyrics」时互相等待）。超时按轮询次数算，不依赖 Date.now 精度。
    globalThis.__spotifyLyricsWait = (id, callback, maxMs, pollMs) => {
      if (!id || typeof callback !== "function") {
        if (typeof callback === "function") callback(false, true);
        return;
      }
      const key = lyricsCacheKey(id);
      const step = Number(pollMs) > 0 ? Number(pollMs) : 200;
      const limit = Math.max(1, Math.ceil((Number(maxMs) > 0 ? Number(maxMs) : 4500) / step));
      const hasTimer = typeof setTimeout === "function";
      let ticks = 0;
      const poll = () => {
        // 歌词缓存里出现该曲目就是「就绪」标志；缓存大时第一次读就返回，
        // 空缓存时每 200ms 解析的只是一个小 JSON，不需要额外的轻量标志位。
        if (readLyricsCache(key, id)) {
          callback(true, false);
          return;
        }
        if (activeMark(MISS_KEY, id, MISS_TTL_MS)) {
          callback(false, false);
          return;
        }
        if (!hasTimer || ticks >= limit) {
          callback(false, true);
          return;
        }
        ticks += 1;
        setTimeout(poll, step);
      };
      poll();
    };

    // scrollsita 补卡入口：只有最近明确确认过「官方和第三方都没有歌词」的曲目
    // 才跳过，避免空卡常驻；其余登记待预取，让官方请求飞行期间的伴随请求并行查。
    globalThis.__spotifyLyricsCard = (id) => {
      if (!id || !flag(opt.enable_lyrics, true)) return false;
      if (activeMark(MISS_KEY, id, MISS_TTL_MS)) return false;
      // 歌词还没就绪时登记待预取，让官方请求飞行期间的伴随请求并行查第三方源。
      if (!readLyricsCache(lyricsCacheKey(id), id) && !activeMark(INFLIGHT_KEY, id, INFLIGHT_TTL_MS)) {
        writeMark(PENDING_KEY, { id: id, at: Date.now() });
      }
      return true;
    };
    return;
  }

  // 请求阶段：缓存里已经有这首歌的第三方歌词时，直接返回，完全跳过官方请求。
  // 官方歌词接口本身可能很慢；既然之前已经确认官方没有歌词，就不必再等它。
  // 未命中时登记一次待预取，让官方请求飞行期间的伴随请求并行查第三方源。
  if (!res) {
    if (!PREFETCH && trackId && flag(opt.enable_lyrics, true)) {
      cacheKey = lyricsCacheKey(trackId);
      const cached = readLyricsCache(cacheKey, trackId);
      if (cached) {
        writeMark(PENDING_KEY, null);
        writeMark(MISS_KEY, null);
        if (requestedProtoMode()) {
          finish({
            status: 200,
            headers: { "Content-Type": "application/vnd.google.protobuf" },
            body: encodeProto(cached.payload.lyrics.lines, cached.payload.lyrics.syncType,
              cached.payload.lyrics.provider, cached.payload.lyrics.providerLyricsId,
              cached.payload.lyrics.language, cached.payload.colors),
          });
        } else {
          finish({
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(cached.payload),
          });
        }
        return;
      }
      // 官方 color-lyrics 请求马上就要发出。运行时不允许 $done 之后继续跑异步
      // 任务，所以这里只留下曲目 id：紧随其后的 connect-state 轮询会立刻并行
      // 查第三方歌词，404 响应回来时缓存可能已经写好。
      if (!activeMark(INFLIGHT_KEY, trackId, INFLIGHT_TTL_MS)) {
        writeMark(PENDING_KEY, { id: trackId, at: Date.now() });
      }
    }
    finish({});
    return;
  }

  const rawBody = res.body;
  const rawBytes = toBytes(rawBody);
  const rawLength = "string" == typeof rawBody ? rawBody.length : rawBytes.length;
  if (rawLength > MAX_LYRICS_BYTES) {
    // 超大的官方响应不解析，原样放行；超大 404 也当作没有歌词。
    finish({});
    return;
  }

  // protobuf 不先转 UTF-8：只检查第一个非空白字节来区分 JSON。
  let start = 0;
  while (start < rawBytes.length && (rawBytes[start] === 32 || rawBytes[start] === 9 || rawBytes[start] === 10 || rawBytes[start] === 13)) start++;
  const trimmed = typeof rawBody === "string" ? rawBody.trim() : rawBytes[start] === 123 ? toText(rawBytes).trim() : "";
  const hasBody = typeof rawBody === "string" ? trimmed.length > 0 : rawBytes.length > 0;
  const status = Number(res.status || res.statusCode);

  function headerValue(headers, name) {
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== name) continue;
      const value = headers[key];
      if (Array.isArray(value)) return String(value[0] || "");
      return String(value === undefined || value === null ? "" : value);
    }
    return "";
  }

  // 404 的 body 和 Content-Type 都描述错误，不能用来推断歌词响应格式。
  // 补全时遵循请求的 format / Accept；没有提示则用客户端默认格式。
  function requestedProtoMode() {
    const accept = headerValue(req && req.headers, "accept").toLowerCase();
    const format = /[?&]format=(json|protobuf)(?:&|$)/i.exec(url);
    const requested = format ? format[1].toLowerCase() === "protobuf"
      : accept.indexOf("protobuf") >= 0 ? true
      : accept.indexOf("json") >= 0 ? false
      : null;
    return requested !== null ? requested : !desktop;
  }
  const protoMode = status === 200 && hasBody
    ? trimmed.charAt(0) !== "{"
    : requestedProtoMode();

  // 不把登录、限流或服务端错误伪装成有歌词。
  if (status !== 200 && status !== 404) {
    finish({});
    return;
  }

  // 官方「没有歌词」不一定回 404：protobuf 请求经常是 200 + 空体。
  // 空体有两种情况，必须区分开：
  //   * 上游确实没内容（content-length 缺失或 0）-> 当作没有歌词，去第三方补；
  //   * body 没交到脚本手里（content-length > 0）-> 原样放行，不能把官方歌词顶掉。
  if (status === 200 && !hasBody) {
    const declared = Number(headerValue(res && res.headers, "content-length"));
    if (Number.isFinite(declared) && declared > 0) {
      finish({});
      return;
    }
  } else if (status === 200) {
    if (protoMode) {
      // 解析不了（拿不到原始字节）时返回 -1，宁可放行也不要顶掉官方歌词。
      const inspected = rawBytes.length ? inspectProto(rawBytes) : null;
      const count = inspected ? inspected.count : -1;
      if (count !== 0) {
        // 免费号的歌词有每月额度，用完服务端会在 restriction（字段 14）里回
        // monthlyLimitReached，客户端就只显示「额度已用完」。归一成 showLyrics 再放行。
        const cleaned = count > 0 ? normalizeRestrictionProto(inspected) : null;
        if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: cleaned });
        else finish({});
        return;
      }
    } else if (hasLyrics(trimmed)) {
      const cleaned = stripRestrictionJson(trimmed);
      if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: cleaned });
      else finish({});
      return;
    }
  }

  // 歌词结果缓存：同一首歌在播放器 / 歌词页 / 歌词卡之间的重复请求不再重复查源。
  // 只缓存「官方没有歌词」的分支，官方歌词不会走到这里。
  cacheKey = lyricsCacheKey(trackId);
  const cachedLyrics = readLyricsCache(cacheKey, trackId);
  if (cachedLyrics) {
    writeMark(MISS_KEY, null);
    emit(cachedLyrics.payload);
    return;
  }

  // 总时限；超时后用纯文本兜底，没有就按「没有歌词」放行。
  if (typeof setTimeout === "function") deadline = setTimeout(() => {
    if (settled) return;
    if (plainFallback) {
      writeLyricsCache(cacheKey, plainFallback);
      writeMark(MISS_KEY, null);
      emit(plainFallback);
    } else {
      // 这张卡已经乐观补上了：确认没歌词后短期内不再补，避免空卡一直出现。
      writeMark(MISS_KEY, { id: trackId, at: Date.now() });
      finish({});
    }
  }, LYRICS_DEADLINE_MS);
  resolveLyrics((payload) => {
    if (settled) return;
    // 只有真正拿到歌词才写缓存；查不到 / 超时 / 网络失败都留给下次重试。
    writeLyricsCache(cacheKey, payload);
    if (!payload) {
      writeMark(MISS_KEY, { id: trackId, at: Date.now() });
      finish({});
      return;
    }
    writeMark(MISS_KEY, null);
    emit(payload);
  });

  // 取曲目元数据 -> 按配置的歌词源找 -> 回调 payload
  function resolveLyrics(cb) {
    resolvePublicLyrics(cb);
  }

  function resolvePublicLyrics(cb) {
    // 客户端拉过的元数据优先：命中时直接查歌词，open.spotify.com 一次都不请求，
    // 歌词页背景用默认底色（不再为封面配色抓 embed 页面）。
    const cached = cachedTrackMeta(trackId);
    if (cached) {
      runSource(sourceOrder(cached.title, cached.artist), cached.title, cached.artist, cb, cached.duration, () => cached.color || null);
      return;
    }
    const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + trackId);
    const embedUrl = "https://open.spotify.com/embed/track/" + trackId;
    let meta = null;
    let embed = null;
    let metaDone = false;
    let embedStarted = false;
    let embedDone = false;
    let started = false;
    const merged = () => {
      const oembed = {
        title: String((meta && meta.title) || ""),
        artist: String((meta && meta.author_name) || "").trim(),
      };
      const page = embed || {};
      // 缺歌手或 Live 曲目时以 embed 的写法 / 时长为准，其余优先 oEmbed。
      const preferEmbed = !oembed.title || !oembed.artist || isLive(oembed.title);
      return {
        title: String((preferEmbed ? page.title : oembed.title) || oembed.title || page.title || ""),
        artist: String((preferEmbed ? page.artist : oembed.artist) || oembed.artist || page.artist || "").trim(),
        duration: page.duration,
      };
    };
    const colorOf = () => (embed && embed.color) || null;
    const start = () => {
      if (started) return;
      const info = merged();
      if (!info.title) {
        started = true;
        cb(null);
        return;
      }
      started = true;
      rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, colorOf());
      runSource(sourceOrder(info.title, info.artist), info.title, info.artist,
        (payload) => cb(payload), info.duration, colorOf);
    };
    // embed 提供封面主色与兜底元数据；请求与歌词查询并行，不阻塞歌词响应。
    const beginEmbed = () => {
      if (embedStarted) return;
      embedStarted = true;
      httpGetText(embedUrl, (html) => {
        embed = parseEmbedTrack(html);
        embedDone = true;
        // 歌词可能已经先返回了；embed 晚到时只补一份封面配色与更准确的元数据。
        if (started && embed && embed.color) {
          const info = merged();
          rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, embed.color);
        }
        maybeStart();
      });
    };
    const maybeStart = () => {
      if (started) return;
      const info = merged();
      if (!metaDone) return;
      if (!info.title) {
        // oEmbed 没给曲名时靠 embed 补；embed 也失败才放弃。
        if (!embedDone) {
          beginEmbed();
          return;
        }
        start();
        return;
      }
      // 缺歌手、或 Live 曲目要靠 embed 的歌手 / 时长做校验，才等 embed。
      if ((!info.artist || isLive(info.title)) && !embedDone) {
        beginEmbed();
        return;
      }
      // 正常曲目立即开始查歌词，同时发出配色请求，但不等待它。
      beginEmbed();
      start();
    };
    httpGetJson(oembedUrl, (data) => {
      meta = data;
      metaDone = true;
      maybeStart();
    });
  }

  // ---- 歌词源 -----------------------------------------------------------

  function sourceOrder(title, artist) {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    // Musixmatch 是 Spotify 的官方歌词上游，auto 不使用，仅在显式选择时查询。
    const auto = CJK_MARK.test(title + artist)
      ? ["netease", "qq", "lrclib"] : ["lrclib", "netease", "qq"];
    if (wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq") return [wanted];
    return auto;
  }

  // 并发查询所有来源：首个通过校验的同步歌词胜出；只有纯文本时等全部结束。
  function runSource(order, title, artist, done, duration, colorOf) {
    if (settled) return;
    if (!order.length) {
      done(null);
      return;
    }
    let remaining = order.length;
    let finished = false;
    for (const name of order) {
      if (settled || finished) return;
      lookup(name, title, artist, duration, (record) => {
        if (settled || finished) return;
        if (record && colorOf) record.albumColor = colorOf();
        const payload = buildPayload(record);
        if (payload && (payload.lyrics.syncType === "LINE_SYNCED" || order.length === 1)) {
          finished = true;
          done(payload);
          return;
        }
        if (payload && !plainFallback) {
          plainFallback = payload;
          // 有纯文本但同步歌词还在路上时，别让用户干等到总超时：
          // 5 秒内还没有同步版本就先把纯文本发出去，后续结果不再覆盖。
          if (typeof setTimeout === "function") plainTimer = setTimeout(() => {
            if (settled || !plainFallback) return;
            writeLyricsCache(cacheKey, plainFallback);
            emit(plainFallback);
          }, PLAIN_FALLBACK_MS);
        }
        remaining -= 1;
        if (!remaining) {
          finished = true;
          done(plainFallback);
        }
      });
    }
  }

  function lookup(name, title, artist, duration, cb) {
    if (name === "lrclib") return lookupLrclib(title, artist, duration, cb);
    if (name === "netease") return lookupNetease(title, artist, duration, cb);
    if (name === "qq") return lookupQq(title, artist, duration, cb);
    if (name === "musixmatch") return lookupMusixmatch(title, artist, duration, cb);
    cb(null);
  }

  // LRCLIB：/api/get 与 /api/search 都会带回歌词。完整曲名和去掉装饰括号后的
  // 曲名各发 get + search，四路并行；首个通过校验的同步歌词立即返回，只有全都
  // 没命中时才用歌名再搜一次（歌手写法不一致的兜底）。
  function lookupLrclib(title, artist, duration, cb) {
    const cleanTitle = queryTitle(title);
    const names = cleanTitle && cleanTitle !== title ? [title, cleanTitle] : [title];
    const lists = [];
    const records = [];
    let pending = names.length * 2;
    let done = false;

    const all = () => lists.concat(records);
    const syncedPick = () => {
      const synced = [];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) if (isSynced(item)) synced.push(item);
      }
      for (const record of records) if (isSynced(record)) synced.push(record);
      return pickRecord(synced, title, duration, artist);
    };

    const finish = () => {
      if (done || pending) return;
      done = true;
      const picked = pickRecord(all(), title, duration, artist);
      if (picked) {
        cb(withProvider(picked, "LRCLIB"));
        return;
      }
      // 歌手写法不一致（feat. / 多歌手 / 翻译名）时，用歌名再搜一次；
      // pickRecord 仍会按 artist 过滤，不会把别人的同名歌当成结果。
      if (!artist) {
        cb(null);
        return;
      }
      httpGetJson("https://lrclib.net/api/search?track_name=" + encodeURIComponent(names[names.length - 1]), (list) => {
        const fallback = pickRecord(list, title, duration, artist);
        cb(fallback ? withProvider(fallback, "LRCLIB") : null);
      });
    };

    const settle = () => {
      pending -= 1;
      if (done) return;
      const hit = syncedPick();
      if (hit) {
        done = true;
        cb(withProvider(hit, "LRCLIB"));
        return;
      }
      finish();
    };

    for (const name of names) {
      const query = "track_name=" + encodeURIComponent(name) + (artist ? "&artist_name=" + encodeURIComponent(artist) : "");
      httpGetJson("https://lrclib.net/api/get?" + query, (record) => {
        if (record && "object" === typeof record) records.push(record);
        settle();
      });
      httpGetJson("https://lrclib.net/api/search?" + query, (list) => {
        if (Array.isArray(list)) lists.push(list);
        settle();
      });
    }
  }

  // 网易云：搜索接口不需要 token，中文曲库覆盖最好。
  function lookupNetease(title, artist, duration, cb) {
    const query = encodeURIComponent(queryTitle(title) + (artist ? " " + artist : ""));
    const headers = { Referer: "https://music.163.com/" };
    httpGetJson("https://music.163.com/api/search/get?s=" + query + "&type=1&limit=10&offset=0", (data) => {
      const songs = data && data.result && data.result.songs;
      const select = () => {
        const candidates = rankSongs(songs, title, artist, duration, (item) => item.name,
          (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.duration) / 1000);
        tryCandidates(candidates, (picked, next) => {
          httpGetJson("https://music.163.com/api/song/lyric?id=" + picked.id + "&lv=-1&kv=-1&tv=-1", (lyric) => {
            const text = lyric && lyric.lrc && lyric.lrc.lyric;
            next(text ? { provider: "NetEase", providerId: String(picked.id), syncedLyrics: text } : null);
          }, headers);
        }, cb);
      };
      // 搜索结果可能缺少歌手别名：只对匹配的曲目按歌手 ID 补全，最多 3 次请求。
      const pending = [];
      if (rankSongs(songs, title, artist, duration, (item) => item.name,
          (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.duration) / 1000).length) {
        select();
        return;
      }
      if (artist && Array.isArray(songs)) {
        for (const song of songs) {
          if (!song || !matchesSong(title, "", duration, song.name, "", Number(song.duration) / 1000)) continue;
          const people = Array.isArray(song.artists) ? song.artists : [];
          if (matchesArtist(artist, people.reduce((names, a) => names.concat(artistNames(a)), []))) continue;
          for (const person of people) {
            if (!person || !/^\d+$/.test(String(person.id)) || pending.some((p) => p.id === person.id)) continue;
            if (pending.length < 3) pending.push(person);
          }
        }
      }
      const resolve = () => {
        if (!pending.length) { select(); return; }
        // 歌手详情请求并行发出，全部回来后再统一补 alias；旧实现一个个等，
        // 最多 3 个歌手会串成 3 个 RTT。
        let left = pending.length;
        for (const person of pending) {
          httpGetJson("https://music.163.com/api/artist/" + person.id, (details) => {
            const verified = details && details.artist;
            if (verified && String(verified.id) === String(person.id) && Array.isArray(songs)) {
              for (const song of songs) {
                for (const candidate of (song && Array.isArray(song.artists) ? song.artists : [])) {
                  if (candidate && candidate.id === person.id) candidate.alias = artistNames(candidate).concat(artistNames(verified));
                }
              }
            }
            left -= 1;
            if (!left) select();
          }, headers);
        }
      };
      resolve();
    }, headers);
  }

  // QQ 音乐：搜索拿 songmid，再用 nobase64=1 取明文 LRC。
  function lookupQq(title, artist, duration, cb) {
    const query = encodeURIComponent(queryTitle(title) + (artist ? " " + artist : ""));
    const headers = { Referer: "https://y.qq.com/" };
    // QQ 旧版 client_search_cp 在部分网络下会直接 500 且要等 5 秒；
    // search_for_qq_cp 是同一个搜索服务的移动端入口，返回结构一致。
    httpGetJson("https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=" + query + "&format=json&n=10&p=1", (data) => {
      const list = data && data.data && data.data.song && data.data.song.list;
      const candidates = rankSongs(list, title, artist, duration, (item) => item.songname,
        (item) => (item.singer || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.interval));
      tryCandidates(candidates, (picked, next) => {
        httpGetJson(
          "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" + picked.songmid + "&format=json&nobase64=1&g_tk=5381",
          (lyric) => {
            const text = lyric && lyric.lyric;
            next(text ? { provider: "QQ Music", providerId: String(picked.songmid), syncedLyrics: text } : null);
          },
          headers,
        );
      }, cb);
    }, headers);
  }

  // Musixmatch：沿用 EeveeSpotify 的做法，先用固定 app_id 换匿名 token，
  // 再调 macro.subtitles.get 拿逐行字幕。
  function lookupMusixmatch(title, artist, duration, cb) {
    // 该接口不提供足够的场次信息，Live 曲目直接跳过。
    if (isLive(title)) { cb(null); return; }
    const APP_ID = "mac-ios-v2.0";
    httpGetJson("https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + APP_ID, (token) => {
      const userToken = token && token.message && token.message.body && token.message.body.user_token;
      if (!userToken) {
        cb(null);
        return;
      }
      const target =
        "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" + APP_ID +
        "&usertoken=" + encodeURIComponent(userToken) +
        "&track_spotify_id=" + encodeURIComponent(trackId) +
        "&subtitle_format=lrc" +
        "&q_track=" + encodeURIComponent(title) +
        (artist ? "&q_artist=" + encodeURIComponent(artist) : "") +
        "&user_language=zh";
      httpGetJson(target, (data) => {
        const status = data && data.message && data.message.header && data.message.header.status_code;
        const calls = data && data.message && data.message.body && data.message.body.macro_calls;
        const matched = calls && calls["matcher.track.get"] && calls["matcher.track.get"].message;
        const track = matched && matched.body && matched.body.track;
        // 字幕接口可能返回无关的默认结果，需同时校验曲目匹配与字幕状态。
        if (Number(status) !== 200 || !matched || !matched.header || Number(matched.header.status_code) !== 200 || !track || Number(track.instrumental) === 1 ||
            !matchesSong(title, artist, duration, track.track_name, track.artist_name, Number(track.track_length))) {
          cb(null);
          return;
        }
        const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
        const list = sub && sub.body && sub.body.subtitle_list;
        const first = Array.isArray(list) ? list[0] : null;
        const body = first && first.subtitle && first.subtitle.subtitle_body;
        if (!sub || !sub.header || Number(sub.header.status_code) !== 200 || !body || Number(first.subtitle.restricted) === 1) {
          cb(null);
          return;
        }
        cb({ provider: "Musixmatch", providerId: String(first.subtitle.subtitle_id || ""), syncedLyrics: body });
      });
    });
  }

  function withProvider(record, name) {
    const out = {};
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    out.provider = name;
    return out;
  }

  function isSynced(record) {
    return Boolean(record && "string" == typeof record.syncedLyrics && record.syncedLyrics.trim());
  }

  function rankSongs(list, title, artist, duration, nameOf, artistOf, durationOf) {
    if (!Array.isArray(list)) return [];
    const wanted = normalize(queryTitle(title));
    const singer = normalize(artist);
    const score = (item) => {
      const name = normalize(nameOf(item));
      const seconds = durationOf(item);
      return (name === wanted ? 4 : name.indexOf(wanted) === 0 ? 2 : 0)
        + (singer && matchesArtist(artist, artistOf(item)) ? 8 : 0)
        + (Number.isFinite(duration) && duration > 0 && Math.abs(seconds - duration) <= 4 ? 6 : 0);
    };
    return list.filter((item) => item && matchesSong(title, artist, duration, nameOf(item), artistOf(item), durationOf(item)))
      .sort((a, b) => score(b) - score(a)).slice(0, 3);
  }

  function isLive(title) {
    return LIVE_MARK.test(String(title));
  }

  function songTitle(title) {
    let text = String(title).replace(SONG_TITLE_LIVE, "").replace(SONG_TITLE_LIVE_BRACKET, "");
    // 歌手名、版本说明不参与歌名比较：Spotify 常见 "Song (feat. X)"、
    // "Song - 2011 Remaster" 而曲库只写 "Song"。
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    return normalize(text);
  }

  // 查询第三方曲库时也先去掉 feat / remaster 等后缀；Live / Acoustic / Remix
  // 这类真正决定版本的信息保留，避免把现场版查成录音室版。
  // 括号里的影视 / 节目 / 歌手等装饰信息也一并去掉；只有包含版本词时才保留。
  function queryTitle(title) {
    let text = String(title);
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    text = text.replace(SONG_TITLE_BRACKET_GROUP, (whole, inner) =>
      SONG_TITLE_VERSION_BRACKET.test(inner) ? whole : " ");
    return text.replace(/\s+/g, " ").trim() || String(title);
  }

  // 曲名可能是 "Song (电影《…》主题曲)"，曲库只写 "Song"；两边都按完整曲名
  // 和去掉装饰括号后的曲名各比一次。版本词、Live、歌手等校验仍在 matchesSong
  // 里单独进行。
  function matchTitles(title, candidateTitle) {
    const wanted = [];
    for (const value of [songTitle(title), normalize(queryTitle(title))]) {
      if (value && wanted.indexOf(value) < 0) wanted.push(value);
    }
    for (const value of [songTitle(candidateTitle), normalize(queryTitle(candidateTitle))]) {
      if (value && wanted.indexOf(value) >= 0) return true;
    }
    return false;
  }

  function artistNames(person) {
    if (!person || "object" != typeof person) return [];
    return [person.name, person.trans].concat(Array.isArray(person.alias) ? person.alias : [],
      Array.isArray(person.transNames) ? person.transNames : []).filter((name) => typeof name === "string" && name.trim());
  }

  function matchesArtist(artist, candidates) {
    const names = [];
    const add = (value) => {
      if (typeof value !== "string") return;
      const text = value.trim();
      if (!text) return;
      names.push(text);
      for (const part of text.split(ARTIST_SPLIT)) {
        const name = part.trim();
        if (name) names.push(name);
      }
    };
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) add(candidate);
    } else {
      add(candidates);
    }
    // 兼容曲库的“姓, 名”写法。
    const key = (name) => normalize(String(name || "").replace(/^([^,，]+)[,，]\s*([^,，]+)$/, "$2 $1"));
    const wanted = new Set([key(artist)]);
    for (const part of String(artist || "").split(ARTIST_SPLIT)) {
      if (part.trim()) wanted.add(key(part));
    }
    wanted.delete("");
    return names.some((name) => wanted.has(key(name)));
  }

  // LRCLIB 用秒，网易云搜索用毫秒，QQ 用秒；时长可能来自任一方。
  // 大于 10000 的值按毫秒归一，避免同一首歌因为单位不同被判成两首。
  function durationSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 10000 ? number / 1000 : number;
  }

  function matchesSong(title, artist, duration, candidateTitle, candidateArtist, candidateDuration) {
    if (!candidateTitle || !matchTitles(title, candidateTitle)) return false;
    if (isLive(title) !== isLive(candidateTitle)) return false;
    if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
    const singer = normalize(artist);
    if (singer && !matchesArtist(artist, candidateArtist)) return false;
    const stage = STAGE_MARK.exec(title);
    const otherStage = STAGE_MARK.exec(candidateTitle);
    if (stage && otherStage && stage[1] !== otherStage[1]) return false;
    // 时长是最便宜的「同名翻唱 / 伴奏 / 剪辑版」过滤器：两边都有时长时，
    // 相差超过 10 秒基本不是同一版。缺时长（Spotify 元数据没拿到）时不拦。
    const wantedDuration = durationSeconds(duration);
    const candidateSeconds = durationSeconds(candidateDuration);
    const timed = Number.isFinite(wantedDuration) && wantedDuration > 0 &&
      Number.isFinite(candidateSeconds) && candidateSeconds > 0;
    const delta = timed ? Math.abs(candidateSeconds - wantedDuration) : 0;
    // 仅凭 “Live” 无法确定具体场次，需再核对时长和场次信息。
    if (isLive(title)) {
      if (timed && delta > 8) return false;
      if (stage && !otherStage && (!timed || !singer)) return false;
    } else if (timed && delta > 10) {
      return false;
    }
    return true;
  }

  // 候选歌词请求并行发出（最多 3 个），首个拿到可解析歌词的胜出；全部没歌词
  // 时返回 null。旧实现按排名一个个试，候选越多越慢。
  function tryCandidates(candidates, fetch, cb, limit = 3) {
    if (settled) return;
    const picked = Array.isArray(candidates) ? candidates.slice(0, limit) : [];
    if (!picked.length) { cb(null); return; }
    let pending = picked.length;
    let done = false;
    for (const candidate of picked) {
      fetch(candidate, (record) => {
        if (settled || done) return;
        if (buildPayload(record)) {
          done = true;
          cb(record);
          return;
        }
        pending -= 1;
        if (!pending) {
          done = true;
          cb(null);
        }
      });
    }
  }

  // ---- 工具函数 ---------------------------------------------------------

  function toText(value) {
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) return utf8.decode(new Uint8Array(value));
    if (value && ArrayBuffer.isView(value)) return utf8.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return "";
  }

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }

  function hasLyrics(text) {
    try {
      const data = JSON.parse(text);
      const lines = data && data.lyrics && data.lyrics.lines;
      return Array.isArray(lines) && lines.some((line) => line && String(line.words || "").trim());
    } catch (e) {
      return false;
    }
  }

  function httpGetJson(target, callback, extraHeaders) {
    httpGetText(target, (data) => {
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch (e) {}
      callback(parsed);
    }, extraHeaders);
  }

  function httpGetText(target, callback, extraHeaders, timeoutMs) {
    if (settled) return;
    let done = false;
    const reply = (value) => {
      if (done || settled) return;
      done = true;
      callback(value);
    };
    try {
      const headers = { "User-Agent": USER_AGENT, Accept: target.indexOf("/embed/track/") >= 0 ? "text/html" : "application/json" };
      if (extraHeaders) {
        for (const key in extraHeaders) {
          if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) headers[key] = extraHeaders[key];
        }
      }
      const options = { url: target, headers: headers, timeout: timeoutMs || 4000 };
      const onReply = (error, response, data) => {
        if (done || settled) return;
        const statusCode = Number(response && response.status);
        if (error || !response) {
          reply(null);
          return;
        }
        if (statusCode >= 400 || !data) {
          reply(null);
          return;
        }
        // 第三方接口不可控：超长响应不解析，避免 JSON.parse 占满内存。
        if ("string" != typeof data || data.length > MAX_HTTP_JSON_BYTES) {
          reply(null);
          return;
        }
        reply(data);
      };

      // 优先用客户端的 $httpClient；没有注入时回退到 QX 的 $task.fetch 和
      // 运行时自带的 fetch。某个客户端只实现了其中一种时也不会静默失败。
      if (typeof $httpClient !== "undefined" && $httpClient && typeof $httpClient.get === "function") {
        $httpClient.get(options, onReply);
        return;
      }
      if (typeof $task !== "undefined" && $task && typeof $task.fetch === "function") {
        $task.fetch({ url: target, headers: headers, timeout: timeoutMs || 4000 }).then(
          (res) => onReply(null, { status: res.statusCode || res.status }, res.body),
          (err) => onReply(err, null, null),
        );
        return;
      }
      if (typeof fetch === "function") {
        fetch(target, { headers: headers }).then(
          (res) => res.text().then((text) => onReply(null, { status: res.status }, text)),
          (err) => onReply(err, null, null),
        );
        return;
      }
      onReply(new Error("no http client"), null, null);
    } catch (e) {
      reply(null);
    }
  }

  function emit(payload) {
    if (PREFETCH) {
      if (prefetchSettle) prefetchSettle(payload);
      return;
    }
    if (protoMode) {
      const bytes = encodeProto(payload.lyrics.lines, payload.lyrics.syncType, payload.lyrics.provider,
        payload.lyrics.providerLyricsId, payload.lyrics.language, payload.colors);
      // 与官方响应头保持一致。
      finish({ status: 200, headers: { "Content-Type": "application/vnd.google.protobuf" }, body: bytes });
      return;
    }

    finish({
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
  }

  // ---- protobuf ---------------------------------------------------------
  //
  // 字段与官方 color-lyrics 响应一致（Content-Type: application/vnd.google.protobuf）：
  //   message Response   { LyricsData data = 1; LyricsColors colors = 2; }
  //   message LyricsData {
  //     bool timeSynchronized = 1;         // 1 = 逐行同步
  //     repeated LyricsLine lines = 2;     // 完整歌词
  //     string provider = 3;               // "MusixMatch"
  //     string providerLyricsId = 4;       // "9539392"
  //     string providerDisplayName = 5;    // "Musixmatch"
  //     bool isDenseTypeface = 8;          // 中日韩用更紧的字形
  //     string language = 10;              // "zh-Hant"
  //     LyricsRestriction restriction = 14;// 1 = showLyrics
  //     repeated LyricsLine previewLines = 17;  // 歌词卡用的前几行
  //   }
  //   message LyricsLine { int32 offsetMs = 1; string content = 2; }
  //   message LyricsColors { uint32 backgroundColor = 1; uint32 lineColor = 2; uint32 activeLineColor = 3; }
  //
  // previewLines 供 Now Playing 歌词卡使用，必须和完整歌词一起返回。

  function encodeLine(line) {
    const content = encoder.encode(String(line.words || ""));
    return pbConcat([pbUint(1, Number(line.startTimeMs) || 0), pbBytes(2, content)]);
  }

  function encodeProto(lines, syncType, provider, providerId, language, colors) {
    const parts = [pbUint(1, syncType === "LINE_SYNCED" ? 1 : 0)];
    for (let i = 0; i < lines.length; i += 1) parts.push(pbBytes(2, encodeLine(lines[i])));
    parts.push(pbBytes(3, encoder.encode(provider || "LRCLIB")));
    parts.push(pbBytes(4, encoder.encode(String(providerId === undefined || providerId === null ? "" : providerId))));
    parts.push(pbBytes(5, encoder.encode(provider || "LRCLIB")));

    const lang = String(language || "");
    const dense = /^(?:zh|ja|ko)(?:-|$)/i.test(lang);
    if (dense) parts.push(pbUint(8, 1));
    if (lang) parts.push(pbBytes(10, encoder.encode(lang)));
    parts.push(pbUint(14, 1));
    for (let i = 0; i < lines.length && i < PREVIEW_LINES; i += 1) parts.push(pbBytes(17, encodeLine(lines[i])));

    const lyrics = pbConcat(parts);
    // colors 必须给：客户端拿它刷歌词页的背景和文字，字段缺失时是 0，alpha 也是 0，
    // 整页歌词就成了透明的。JSON 用有符号整数，protobuf 这里必须还原成 uint32。
    const argb = (value) => Number(value) >>> 0;
    const palette = colors || {};
    const colorsBytes = pbConcat([
      pbUint(1, argb(palette.background === undefined ? 0xff808080 : palette.background)),
      pbUint(2, argb(palette.text === undefined ? 0xff000000 : palette.text)),
      pbUint(3, argb(palette.highlightText === undefined ? 0xffffffff : palette.highlightText)),
    ]);
    return pbConcat([pbBytes(1, lyrics), pbBytes(2, colorsBytes)]);
  }

  function inspectProto(bytes) {
    try {
      const top = pbFields(bytes);
      for (let i = 0; i < top.length; i += 1) {
        const field = top[i];
        if (field.field !== 1 || field.wire !== 2) continue;
        const inner = pbFields(field.bytes);
        let count = 0;
        for (let j = 0; j < inner.length; j += 1) {
          if (inner[j].field === 2 && inner[j].wire === 2 && inner[j].bytes && inner[j].bytes.length) count += 1;
        }
        return { count, top, lyrics: field, inner };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // 把 LyricsData.restriction（字段 14）统一成 1 = showLyrics。
  // 免费号额度用完时服务端回 3，客户端只显示额度提示；这里改回 1 后正常放行。
  function normalizeRestrictionProto(inspected) {
    const top = inspected.top;
    let changed = false;
    const outTop = [];
    for (let i = 0; i < top.length; i += 1) {
      const f = top[i];
      if (f !== inspected.lyrics) {
        outTop.push(pbEncodeField(f));
        continue;
      }
      const inner = inspected.inner;
      const outInner = [];
      for (let j = 0; j < inner.length; j += 1) {
        const g = inner[j];
        if (g.field === 14 && g.wire === 0) {
          if (g.value !== 1) {
            changed = true;
          }
          outInner.push(pbUint(14, 1));
          continue;
        }
        outInner.push(pbEncodeField(g));
      }
      outTop.push(pbBytes(1, pbConcat(outInner)));
    }
    return changed ? pbConcat(outTop) : null;
  }

  function stripRestrictionJson(text) {
    try {
      const data = JSON.parse(text);
      const lyrics = data && data.lyrics;
      if (!lyrics || !Object.prototype.hasOwnProperty.call(lyrics, "restriction")) return null;
      delete lyrics.restriction;
      return JSON.stringify(data);
    } catch (e) {
      return null;
    }
  }

  function pbEncodeField(f) {
    return f.raw;
  }

  // 直接拼 Uint8Array，避免逐字节 push 到普通数组：长歌词时既慢，
  // 也可能撞上 Function.prototype.apply 的参数上限。
  function pbConcat(list) {
    let size = 0;
    for (let i = 0; i < list.length; i += 1) size += list[i].length;
    const out = new Uint8Array(size);
    let at = 0;
    for (let i = 0; i < list.length; i += 1) {
      out.set(list[i], at);
      at += list[i].length;
    }
    return out;
  }

  function pbFields(bytes) {
    const out = [];
    let pos = 0;
    while (pos < bytes.length) {
      const start = pos;
      const key = pbReadVarint(bytes, pos);
      if (key.next < 0 || !Number.isSafeInteger(key.value) || key.value < 8) throw new Error("protobuf key");
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (wire === 0) {
        const value = pbReadVarint(bytes, key.next);
        if (value.next < 0) throw new Error("protobuf varint");
        out.push({ field: field, wire: 0, value: value.value });
        pos = value.next;
      } else if (wire === 2) {
        const len = pbReadVarint(bytes, key.next);
        if (len.next < 0 || !Number.isSafeInteger(len.value) || len.value > bytes.length - len.next) throw new Error("protobuf length");
        out.push({ field: field, wire: 2, bytes: bytes.subarray(len.next, len.next + len.value) });
        pos = len.next + len.value;
      } else if (wire === 5) {
        pos = key.next + 4;
        out.push({ field, wire });
      } else if (wire === 1) {
        pos = key.next + 8;
        out.push({ field, wire });
      } else {
        throw new Error("protobuf wire");
      }
      if (pos > bytes.length) throw new Error("protobuf truncated");
      out[out.length - 1].raw = bytes.subarray(start, pos);
    }
    return out;
  }

  function pbReadVarint(bytes, pos) {
    let value = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos];
      // 绝大多数是 1-4 字节的小整数，走位运算快路径；超出后再退回乘法。
      if (shift < 28) value |= (byte & 0x7f) << shift;
      else value += (byte & 0x7f) * Math.pow(2, shift);
      pos += 1;
      if (shift === 63 && byte > 1) break;
      if ((byte & 0x80) === 0) return { value: value, next: pos };
      shift += 7;
      if (shift > 63) break;
    }
    return { value: 0, next: -1 };
  }

  function pbWriteVarint(value) {
    const out = [];
    let rest = Math.max(0, Math.floor(value));
    // 字段号 / 长度 / 毫秒时间戳都小于 2^31，位运算比 % 和 Math.floor 快。
    if (rest <= 0x7fffffff) {
      while (rest >= 128) {
        out.push((rest & 0x7f) | 0x80);
        rest >>>= 7;
      }
      out.push(rest);
      return out;
    }
    while (rest >= 128) {
      out.push((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    out.push(rest);
    return out;
  }

  function pbUint(field, value) {
    return pbConcat([pbWriteVarint(field * 8), pbWriteVarint(value)]);
  }

  function pbBytes(field, bytes) {
    return pbConcat([pbWriteVarint(field * 8 + 2), pbWriteVarint(bytes.length), bytes]);
  }

  function buildPayload(record) {
    if (!record || "object" != typeof record || record.instrumental) return null;

    if (typeof record.syncedLyrics === "string") {
      const lines = parseLrc(record.syncedLyrics);
      if (lines.length) return makePayload("LINE_SYNCED", lines, record);
    }

    if (typeof record.plainLyrics === "string") {
      const lines = record.plainLyrics
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((words) => ({ startTimeMs: "0", words: words, syllables: [], endTimeMs: "0" }));
      if (lines.length) return makePayload("UNSYNCED", lines, record);
    }

    return null;
  }

  // 客户端按 startTimeMs 递增定位当前行，并据此滚动列表。外部来源的行统一在这里
  // 规范化：类型转字符串、丢掉无效和空行、按时间升序，避免乱序或空文本影响定位。
  function normalizeLines(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const line of raw) {
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      const ms = Number(line.startTimeMs);
      if (!Number.isSafeInteger(ms) || ms < 0) continue;
      out.push({ startTimeMs: String(ms), words: line.words, syllables: [], endTimeMs: "0" });
    }
    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  // 客户端按严格结构读取这个对象，字段形状需要与官方 color-lyrics/v2 一致：
  //
  //   { lyrics: { syncType, lines[], provider, providerLyricsId, providerDisplayName,
  //               syncLyricsUri, isDenseTypeface, alternatives, language,
  //               isRtlLanguage, fullscreenAction },
  //     colors: { background, text, highlightText },
  //     hasVocalRemoval }
  //
  // iOS 与桌面共用同一套 JSON 形状。
  function makePayload(syncType, rawLines, record) {
    const lines = normalizeLines(rawLines);
    if (!lines.length) return null;
    const provider = record.provider || "LRCLIB";
    const id = record.providerId !== undefined ? record.providerId : record.id;
    const language = detectLanguage(lines);
    // 值是 32 位有符号整数。
    const signed = (v) => (v > 0x7fffffff ? v - 0x100000000 : v);
    const palette = albumColors(record);
    return {
      lyrics: {
        syncType: syncType,
        lines: lines,
        provider: provider,
        providerLyricsId: id === undefined || id === null ? "" : String(id),
        providerDisplayName: provider,
        syncLyricsUri: "",
        isDenseTypeface: false,
        alternatives: [],
        language: language,
        isRtlLanguage: false,
        fullscreenAction: "FULLSCREEN_LYRICS",
      },
      colors: {
        background: signed(palette.background),
        text: signed(palette.line),
        highlightText: signed(palette.active),
      },
      hasVocalRemoval: false,
    };
  }

  // ---- 歌词页配色 -------------------------------------------------------
  //
  // 官方歌词页把封面主色当背景，未激活的行用黑字，当前 / 已唱行用白字
  // （参考 EeveeSpotify 的 LyricsColors：backgroundColor=封面提取色，
  // lineColor=黑，activeLineColor=白）。默认值 0 会让整页透明，所以必须显式给。
  // 封面色统一压到中等亮度，黑字才不会在深色封面上消失；拿不到封面色时用
  // 灰色底，与参考实现的 Color.gray 兜底一致。
  function albumColors(record) {
    const line = 0xff000000;
    const active = 0xffffffff;
    const fallback = 0xff808080;
    const source = record && record.albumColor;
    const channel = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    if (!source || !Number.isFinite(Number(source.r)) || !Number.isFinite(Number(source.g)) || !Number.isFinite(Number(source.b))) {
      return { background: fallback, line: line, active: active };
    }
    const r = channel(source.r);
    const g = channel(source.g);
    const b = channel(source.b);
    const brightness = (r * 299 + g * 587 + b * 114) / 255000;
    const amount = Math.abs(0.5 - brightness);
    const mix = (value) => (brightness < 0.5
      ? Math.round(value * (1 - amount) + 255 * amount)
      : Math.round(value * (1 - amount)));
    const background = (0xff000000 | (mix(r) << 16) | (mix(g) << 8) | mix(b)) >>> 0;
    return { background: background, line: line, active: active };
  }

  // 公开 embed 页面（__NEXT_DATA__）同时带曲目元数据与封面主色。
  function parseEmbedTrack(html) {
    try {
      const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ""));
      const data = match && JSON.parse(match[1]);
      const entity = data && data.props && data.props.pageProps && data.props.pageProps.state && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
      if (!entity || entity.type !== "track" || entity.id !== trackId || !(entity.title || entity.name)) return null;
      const artists = Array.isArray(entity.artists)
        ? entity.artists.filter(Boolean).map((item) => item && item.name).filter((name) => typeof name === "string" && name.trim())
        : [];
      const base = entity.visualIdentity && entity.visualIdentity.backgroundBase;
      const color = base && Number.isFinite(Number(base.red)) && Number.isFinite(Number(base.green)) && Number.isFinite(Number(base.blue))
        ? { r: Number(base.red), g: Number(base.green), b: Number(base.blue) }
        : null;
      return {
        title: String(entity.title || entity.name),
        artist: artists.join(", "),
        duration: Number(entity.duration) / 1000,
        color: color,
      };
    } catch (e) {
      return null;
    }
  }

  // LRC -> Spotify 的 lines。支持一行多个时间戳、[offset:±ms]、两位或三位毫秒。
  function parseLrc(text) {
    const out = [];
    let offset = 0;

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      const off = LRC_OFFSET.exec(line);
      if (off) {
        offset = parseInt(off[1], 10) || 0;
        continue;
      }

      const stamps = [];
      let m;
      LRC_STAMP.lastIndex = 0;
      while ((m = LRC_STAMP.exec(line))) stamps.push(m);
      if (!stamps.length) continue;

      const words = line.replace(LRC_BRACKET, "").trim();
      if (!words) continue;

      for (const s of stamps) {
        const minutes = parseInt(s[1], 10);
        const seconds = parseInt(s[2], 10);
        const fracRaw = s[3] || "0";
        const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
        let ms = Math.round((minutes * 60 + seconds + frac) * 1000) - offset;
        if (ms < 0) ms = 0;
        out.push({ startTimeMs: String(ms), words: words, syllables: [], endTimeMs: "0" });
      }
    }

    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  // 同名曲目往往有好几版（原版、Video Edit、Extended Mix）。打分选版本：
  // 时长贴近的优先（时间轴才对得上），其次要有同步时间轴，其次曲名精确匹配。
  function pickRecord(list, title, duration, artist) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = normalize(title);
    const usable = list.filter((item) => {
      if (!item || "object" != typeof item || item.instrumental) return false;
      if (!matchesSong(title, artist, duration, item.trackName, item.artistName, Number(item.duration))) return false;
      return Boolean(
        (typeof item.syncedLyrics === "string" && item.syncedLyrics.trim()) ||
          (typeof item.plainLyrics === "string" && item.plainLyrics.trim()),
      );
    });
    if (!usable.length) return null;

    const synced = (item) => Boolean(item.syncedLyrics && item.syncedLyrics.trim());
    const named = (item) => normalize(item.trackName) === wanted;
    const near = (item) =>
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(Number(item.duration)) &&
      Math.abs(Number(item.duration) - duration) <= 3;
    const singer = normalize(artist);
    const score = (item) => (synced(item) ? 2 : 0) + (named(item) ? 1 : 0) + (near(item) ? 4 : 0)
      + (singer && matchesArtist(artist, item.artistName) ? 8 : 0);

    let best = usable[0];
    let bestScore = score(best);
    for (let i = 1; i < usable.length; i += 1) {
      const current = score(usable[i]);
      if (current > bestScore) {
        best = usable[i];
        bestScore = current;
      }
    }
    return best;
  }

  function normalize(text) {
    // NFKC 处理全角 / 组合字符；翻译与简繁转换需要来源提供对应文本。
    return String(text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(NORMALIZE_DROP, "");
  }

  function detectLanguage(lines) {
    const sample = lines
      .slice(0, 20)
      .map((line) => line.words)
      .join("");
    if (KANA_MARK.test(sample)) return "ja";
    if (HANGUL_MARK.test(sample)) return "ko";
    if (HAN_MARK.test(sample)) return "zh";
    return "en";
  }
})();

  // 入口：bootstrap / UCS / 元数据 / 远程配置 / 账号属性。
  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || null;
  const url = (res && res.url) || req.url || "";

  // 预取目标。优先级：color-lyrics 请求阶段登记的曲目（官方请求正在飞行，这次
  // 轮询与它并行查第三方歌词）> 换歌后的当前曲目 > 下一首。connect-state 每次
  // 轮询只挑一个目标，避免在响应里连续等两次。快速切歌时 id 变了就会重新选
  // 目标，旧结果只会写进旧曲目的缓存，不会污染当前曲目。
  function prefetchTarget() {
    const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
    if (!store) return null;
    const marker = (key, ttl) => {
      const raw = store.read(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && Number(value.at) && Date.now() - Number(value.at) < ttl ? value : null;
    };
    try {
      const now = Date.now();
      const lyrics = JSON.parse(store.read("spotify.lyrics.cache") || "{}");
      const cached = (id) => {
        const suffix = "|" + id;
        for (const key of Object.keys(lyrics || {})) {
          if (key.slice(-suffix.length) !== suffix) continue;
          const entry = lyrics[key];
          // 与歌词脚本一致：命中缓存保留 24 小时；过期条目不能阻止重新预取。
          if (entry && !entry.m && now - Number(entry.t || 0) < 24 * 60 * 60 * 1000) return true;
        }
        return false;
      };

      // color-lyrics 请求阶段登记的「待预取」优先：官方歌词请求还在飞行时，这次
      // connect-state 轮询就并行查第三方歌词，404 响应回来时缓存可能已经写好。
      // 这里不等待查询结果，响应阶段读不到缓存时仍会照常自己查，不会拖慢歌词页。
      const pendingRaw = store.read("spotify.lyrics.pending");
      const pending = pendingRaw ? JSON.parse(pendingRaw) : null;
      const active = marker("spotify.lyrics.inflight", 8000);
      if (pending && pending.id && now - Number(pending.at) < 10000 &&
          !cached(pending.id) && (!active || active.id !== pending.id)) {
        store.write("", "spotify.lyrics.pending");
        store.write(JSON.stringify({ id: pending.id, at: Date.now() }), "spotify.prefetch.last");
        return { id: pending.id, wait: 1000 };
      }

      const queue = JSON.parse(store.read("spotify.queue") || "null");
      if (!queue || !queue.current) return null;
      const current = queue.current;
      const next = Array.isArray(queue.next) ? queue.next[0] || "" : "";
      const lastRaw = store.read("spotify.prefetch.last");
      const last = lastRaw ? JSON.parse(lastRaw) : null;
      const recent = last && Number(last.at) && now - Number(last.at) < 1500;
      if (!cached(current)) {
        const currentMark = marker("spotify.prefetch.current", 15 * 1000);
        if (!currentMark || currentMark.id !== current) {
          // 连续快速切歌时先让播放状态返回，别每一首都在 connect-state 里等 1.5 秒。
          if (currentMark && recent) return null;
          store.write(JSON.stringify({ id: current, at: Date.now() }), "spotify.prefetch.current");
          store.write(JSON.stringify({ id: current, at: Date.now() }), "spotify.prefetch.last");
          return { id: current, wait: 1500 };
        }
      }
      if (next && next !== current && !cached(next)) {
        const nextMark = marker("spotify.prefetch.next", 45 * 1000);
        if (!nextMark || nextMark.id !== next) {
          store.write(JSON.stringify({ id: next, at: Date.now() }), "spotify.prefetch.next");
          return { id: next, wait: 1000 };
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // 请求阶段只做一件事：抹掉 extended-metadata 请求体里的 etag。
  if (!res) {
    if (lyricsMetaOn) stripRequestEtags(req, url);
    else $done({});
    return;
  }

  if (Number(res.status) >= 300) {
    $done({});
    return;
  }

  const META_URL = /\/extended-metadata\/|\/context-resolve\/|\/connect-state\/|\/metadata\/4\/track\//;
  const CONFIG_URL = /\/remote-config-resolver\//;
  const ATTR_URL = /\/nebula\//;

  const isMeta = META_URL.test(url);
  const isConfig = CONFIG_URL.test(url);
  const isAttr = ATTR_URL.test(url);

  // 桌面版允许「只去广告、不伪装 Premium」：spoof 关掉时仍然处理广告属性。
  // iOS / Egern / Shadowrocket 保持原行为：spoof 关掉就整个放行。
  // 远程配置 / 账号属性在 spoof 或 block_ads 任一打开时都要改写，否则 App
  // 重新拉一次配置就会把 bootstrap 里关掉的开关重新打开。
  let enabled;
  if (isMeta) enabled = lyricsMetaOn;
  else if (isConfig || isAttr) enabled = spoof || adsOn;
  else enabled = desktop ? spoof || adsOn : spoof;
  if (!enabled) {
    $done({});
    return;
  }

  let body = res.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  const maxBytes = isMeta ? MAX_META_BYTES : isConfig || isAttr ? MAX_FEED_BYTES : MAX_BOOTSTRAP_BYTES;
  if (body.length > maxBytes) {
    $done({});
    return;
  }

  let out = null;
  if (isMeta) {
    out = patchMeta(body, url);
  } else if (isConfig) {
    out = patchConfigurationResponse(body);
  } else if (isAttr) {
    out = patchAttributesResponse(body);
  } else if (desktop) {
    out =
      url.indexOf("bootstrap") >= 0
        ? patchBootstrapDesktop(body) || patchCustomizeDesktop(body)
        : patchCustomizeDesktop(body) || patchBootstrapDesktop(body);
  } else {
    out =
      url.indexOf("bootstrap") >= 0
        ? patchBootstrap(body) || patchCustomize(body)
        : patchCustomize(body) || patchBootstrap(body);
  }

  const finish = () => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    $done({ body: out });
  };

  // connect-state 换歌时预取当前曲目的歌词；当前曲目已经预取过时，在下一次轮询
  // 预取 next_tracks。歌词页和滚动页补卡随后直接命中缓存，不会等第三方源。
  const prefetch = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsPrefetch : null;
  if (isMeta && /\/connect-state\//.test(url) && prefetchOn && typeof prefetch === "function") {
    const target = prefetchTarget();
    if (target) {
      let settled = false;
      let timer = null;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
        finish();
      };
      if (typeof setTimeout === "function") timer = setTimeout(done, target.wait);
      prefetch(target.id, done);
      return;
    }
  }

  finish();

})();
