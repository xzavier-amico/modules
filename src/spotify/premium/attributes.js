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
