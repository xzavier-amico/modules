  // -------------------------------------------------------------- attributes

  const yearOn = new Date(Date.now() + 365 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const ATTR_CORE = {
    // 不写 enable-crossfade-product-state / enable-gapless-product-state：
    // 这两项由服务端与 App 播放设置决定。强制打开会让上一首结尾和下一首重叠，
    // 表现为倒计时结束后仍响 1–2 秒。
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
  //
  // 展示侧要和 iOS 对齐，否则「设置 → 账号」「你的方案」这些页面还是免费版的
  // 样子，看不出模块有没有生效：账单产品串、首次付费活动、以及到期 / 订阅结束
  // 日期都属于纯展示字段（不参与播放授权判定），这里一起写。
  const MAC_ATTR = {
    "ads": false,
    "name": "Spotify Premium",
    "is-eligible-premium-unboxing": true,
    "nft-disabled": "1",
    "type": "premium",
    "product": "premium",
    "catalogue": "premium",
    "financial-product": "pr:premium,tc:0",
    "payments-initial-campaign": "default",
    "product-expiry": yearOn,
    "subscription-enddate": yearOn,
    // 让桌面客户端优先采用 UCS 下发的 product state，这样才会相信改写的
    // product / catalogue，而不是回头再查账号状态。只影响展示与远程配置。
    "com.spotify.madprops.delivered.by.ucs": true,
    "com.spotify.madprops.use.ucs.product.state": true
  };

  // 真正的播放授权字段，只在 unlock_playback 打开时写。
  const MAC_PLAY_ATTR = {
    "player-license": "premium",
    "player-license-v2": "premium",
    "streaming-rules": "",
    "on-demand": true,
    "unrestricted": true,
    "high-bitrate": true
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
    if (!fields || !allCanonical(fields)) return null;
    // 先记下账号地区，headers 脚本据此选择时区。
    rememberRegion(fields);
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

  // ------------------------------------------------------- JSON 账号属性
  //
  // 桌面端（1.3.9 起）`nebula/v1/configuration/attributes` 返回 JSON：
  //
  //   { "attributes": { "type": { "stringValue": "free" },
  //                     "ads": { "boolValue": false },
  //                     "estimated-age": { "longValue": 33 }, … } }
  //
  // protobuf 那套改写看不见它，桌面端的 type / catalogue / name /
  // financial-product 会一直停在 free，试听相关属性也删不掉。这里按同一份
  // forced / STRIPPED 表处理，值类型跟着原属性走（bool → boolValue、
  // string → stringValue、数字 → longValue）。

  const JSON_ATTR_KINDS = ["boolValue", "stringValue", "longValue", "intValue", "doubleValue"];

  function jsonAttributeValue(value) {
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return { longValue: value };
    return { boolValue: !!value };
  }

  function jsonAttributeKind(entry) {
    if (!entry || "object" !== typeof entry || Array.isArray(entry)) return null;
    for (const kind of JSON_ATTR_KINDS) {
      if (Object.prototype.hasOwnProperty.call(entry, kind)) return kind;
    }
    return null;
  }

  // headers 脚本要用账号地区挑时区；JSON 里叫 country_code。
  function rememberRegionJson(attributes) {
    const store = cacheStore();
    if (!store) return;
    for (const key of Object.keys(attributes)) {
      const lower = key.toLowerCase();
      if (REGION_ATTR_KEYS.indexOf(lower) < 0 && lower !== "country_code") continue;
      const entry = attributes[key];
      const value = entry && typeof entry.stringValue === "string" ? entry.stringValue : "";
      if (!/^[A-Za-z]{2}$/.test(value)) continue;
      const next = value.toUpperCase();
      try {
        if (store.read(REGION_KEY) === next) return;
        store.write(next, REGION_KEY);
      } catch (e) {
        // 存储写失败不影响响应改写。
      }
      return;
    }
  }

  // 只改写认得出的属性集合；结构不对就整份放行，避免把别的 JSON 接口写坏。
  function patchAttributesJson(attributes) {
    if (!attributes || "object" !== typeof attributes || Array.isArray(attributes)) return null;
    const keys = Object.keys(attributes);
    for (const key of keys) {
      if (!jsonAttributeKind(attributes[key])) return null;
    }
    rememberRegionJson(attributes);
    let changed = false;
    const seen = Object.create(null);
    for (const key of keys) {
      if (has(key)) {
        attributes[key] = jsonAttributeValue(forced[key]);
        seen[key] = true;
        changed = true;
        continue;
      }
      if (stripped(key)) {
        delete attributes[key];
        changed = true;
      }
    }
    for (const key in forced) {
      if (seen[key]) continue;
      attributes[key] = jsonAttributeValue(forced[key]);
      changed = true;
    }
    return changed ? attributes : null;
  }
