// Spotify Premium — ad-free + shuffle unlock for Loon / Egern.
//
// Spotify answers /bootstrap and /user-customization-service with protobuf that
// carries the account's product state and the remote config flags. This script
// walks the wire format, rewrites the fields that decide "free or premium", and
// writes everything else back untouched. Unknown fields and field order survive,
// and any message we do not rewrite keeps its exact bytes — re-encoding the whole
// body is what made the older script skip tracks after a few seconds.
//
// Layout (field numbers from EeveeSpotify and the spoti.pw AdBlock module):
//   BootstrapMessage 2 { 1 { 1 CustomizeMessage { 1 UcsResponse } } }
//   CustomizeMessage 1 UcsResponse
//   UcsResponse 1 ResolveResponse { 1 ResolveConfiguration { 3 AssignedValue } }
//               3 AccountAttributesResponse { 1 map entry { 1 key, 2 value } }
//   AccountAttribute 2 bool, 3 long, 4 string
//   AssignedValue 1 { 1 scope, 2 name }, 3 BoolValue { 1 }, 5 EnumValue { 1 }

(() => {
  "use strict";

  const url = ($request && $request.url) || "";
  const status = Number(($response && $response.status) || 0);
  if (status >= 300) {
    $done({});
    return;
  }

  let body = $response && $response.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  if (body.length > 4 * 1024 * 1024) {
    console.log("spotify: body too large " + body.length);
    $done({});
    return;
  }

  let opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

  const spoof = flag(opt.spoof_premium, true);
  if (!spoof) {
    $done({});
    return;
  }
  const adsOn = flag(opt.block_ads, true);
  const playOn = flag(opt.unlock_playback, true);
  const verbose = flag(opt.verbose_log, false);

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

  // Returns null when the bytes are not a well-formed message.
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
  const fieldBytes = (no, payload) => ({ no: no, w: 2, p: payload });
  const fieldVarint = (no, value) => ({ no: no, w: 0, v: value });

  function text(f) {
    if (!f || f.w !== 2) return null;
    try {
      return TD.decode(f.p);
    } catch (e) {
      return null;
    }
  }

  // Replaces the message at `path` with what `fn` returns; null when the path
  // is missing or anything along it fails to parse.
  function edit(message, path, fn) {
    if (!path.length) return fn(message);
    const fields = parse(message);
    if (!fields) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  const RULES = [
    ["ios-feature-settings","crossfade_enabled",2,1,"","misc"],
    ["ios-feature-settings","automix_enabled",2,1,"","misc"],
    ["core-playback-setup","crossfade_enabled",2,1,"","misc"],
    ["core-automix","automix_enabled",2,1,"","misc"],
    ["ios-feature-settings","use_playback_settings_crossfade",2,0,"","misc"],
    ["ios-feature-settings","use_playback_settings_gapless",2,0,"","misc"],
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
    ["ios-sociallistening-configuration-impl","premium_gated_start_jam_buttons_enabled",2,0,"","misc"]
  ];

  // -------------------------------------------------------------- attributes

  const yearOn = new Date(Date.now() + 365 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const ATTR_CORE = {
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
    "enable-crossfade-product-state": "1",
    "enable-gapless-product-state": "1",
    "high-bitrate": true,
    "loudness-levels": "1:-5.0,0.0,3.0:-2.0",
    "mixing-tools": "EDIT",
    "your-library-tags": true,
    "libspotify": true,
    "mobile": true,
    "pick-and-shuffle": false
  };

  const ATTR_ADS = {
    "ads": false,
    "ab-ad-player-targeting": "0",
    "allow-advertising-id-transmission": false,
    "restrict-advertising-id-transmission": true
  };

  // Attributes that make the client re-check the state with the server, or
  // offer a trial. Dropping them is what stops the "you are on free" fallback.
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

  const forced = Object.assign({}, ATTR_CORE, adsOn ? ATTR_ADS : {});
  const has = (key) => Object.prototype.hasOwnProperty.call(forced, key);
  const stripped = (key) => {
    if (key.indexOf("is-premium-eligible") === 0) return true;
    if (!adsOn && key.indexOf("ad") === 0) return false;
    return STRIPPED.indexOf(key) >= 0;
  };

  const attributeEntry = (key, value) => {
    const inner = typeof value === "string" ? fieldString(4, value) : fieldVarint(2, value ? 1 : 0);
    return fieldBytes(1, serialize([fieldString(1, key), fieldBytes(2, serialize([inner]))]));
  };

  function patchAttributes(buffer) {
    const fields = parse(buffer);
    if (!fields) return null;
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

  function patchConfiguration(buffer) {
    const fields = parse(buffer);
    if (!fields) return null;
    const out = [];
    const present = Object.create(null);
    for (const f of fields) {
      let value = null;
      if (f.no === 3 && f.w === 2) value = parse(f.p);
      if (!value) {
        out.push(f);
        continue;
      }
      const identifier = first(value, 1);
      const parts = identifier ? parse(identifier.p) : null;
      if (!parts) {
        out.push(f);
        continue;
      }
      const scope = text(first(parts, 1)) || "";
      const name = text(first(parts, 2)) || "";
      let removed = false;
      for (const rule of RULES) {
        if (rule[5] === "ad" && !adsOn) continue;
        if (rule[5] === "cap" && !playOn) continue;
        if (rule[0] && rule[0] !== scope) continue;
        if (rule[1] && rule[1] !== name) continue;
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
      f.p = serialize(value);
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

  // ---------------------------------------------------------------- response

  function patchUcs(buffer) {
    const fields = parse(buffer);
    if (!fields) return null;
    const resolve = first(fields, 1);
    let attributes = first(fields, 3);
    // Neither a resolve nor an attributes field means this is not a UCS
    // response at all; leave it alone rather than inventing a field.
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

  // ------------------------------------------------------------------- entry

  let out = null;
  if (url.indexOf("bootstrap") >= 0) out = patchBootstrap(body) || patchCustomize(body);
  else out = patchCustomize(body) || patchBootstrap(body);

  if (!out || same(out, body)) {
    if (verbose) console.log("spotify: nothing to patch");
    $done({});
    return;
  }

  if (verbose) console.log("spotify: " + body.length + " -> " + out.length + " bytes");
  $done({ body: out });
})();
