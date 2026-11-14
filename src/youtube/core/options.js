  //=====================================================================================
  // §5 选项
  //
  // Loon 传 snake_case 对象，Egern 传 camelCase JSON 字符串，这里统一成 camelCase。
  //=====================================================================================

  const ARG_ALIASES = {
    block_ads: "blockAds",
    block_ai: "blockAi",
    max_height: "maxHeight",
    caption_lang: "captionLang",
    home_menu: "homeMenu",
    block_shorts_feed: "blockShortsFeed",
    youtube_music: "youtubeMusic",
    block_members_only: "blockMembersOnly",
    home_cleanup: "homeCleanup",
    jump_ahead: "jumpAhead",
    max_speed: "maxSpeed",
    web: "web",
  };

  // 旧版插件的 26 个参数顺序。Loon 旧版按位置传数组时用它还原；
  // 新版按参数名传对象，不受影响。
  // onTheGo / onTheGoAudio / onTheGoChapters 已移除，保留占位是为了旧位置数组不串位。
  const LEGACY_ARG_ORDER = [
    "blockUpload",
    "blockShorts",
    "blockShortsFeed",
    "blockMembersOnly",
    "autoHd",
    "blockGames",
    "blockVerticalLive",
    "jumpAhead",
    "blockStore",
    "blockAi",
    "onTheGo",
    "backgroundPlay",
    "pip",
    "maxSpeed",
    "hidePremium",
    "preferPremium",
    "maxHeight",
    "blockPlayerAds",
    "blockFeedAds",
    "blockShortsAds",
    "removePaidPromotion",
    "blockAdTracking",
    "blockGuideItems",
    "onTheGoAudio",
    "onTheGoChapters",
    "stripHotHash",
  ];

  // 当前 Loon 位置数组（12 项，最后一项是 web）。web 是布尔值；
  // 上一版 12 项数组的最后一项是 max_speed 字符串，用这个区分新旧 tuple。
  const CURRENT_ARG_ORDER = [
    "block_ads",
    "block_ai",
    "max_height",
    "caption_lang",
    "home_menu",
    "block_shorts_feed",
    "youtube_music",
    "block_members_only",
    "home_cleanup",
    "jump_ahead",
    "max_speed",
    "web",
  ];

  // 上一版 Loon 位置数组（12 项，含 on_the_go）。升级插件前客户端可能还缓存着
  // 旧 tuple；按长度和最后一项类型区分，避免把旧数组当成新数组。
  const PREV_ARG_ORDER = [
    "block_ads",
    "block_ai",
    "max_height",
    "caption_lang",
    "home_menu",
    "block_shorts_feed",
    "on_the_go",
    "youtube_music",
    "block_members_only",
    "home_cleanup",
    "jump_ahead",
    "max_speed",
  ];

  // Loon 传 snake_case 对象或位置数组，Egern 传 JSON 字符串，这里统一成普通对象。
  function readArgument() {
    let raw = typeof $argument !== "undefined" ? $argument : undefined;
    if ("string" == typeof raw) {
      if (raw.includes("{{{")) return {};
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        return {};
      }
    }
    if (Array.isArray(raw)) {
      const out = {};
      const order =
        raw.length === LEGACY_ARG_ORDER.length
          ? LEGACY_ARG_ORDER
          : raw.length === PREV_ARG_ORDER.length && "string" == typeof raw[raw.length - 1]
            ? PREV_ARG_ORDER
            : raw.length === CURRENT_ARG_ORDER.length
              ? CURRENT_ARG_ORDER
              : Object.keys(ARG_ALIASES);
      order.forEach((key, index) => {
        if (index < raw.length) out[key] = raw[index];
      });
      return out;
    }
    return raw && "object" == typeof raw ? raw : {};
  }

  // 参数可能来自 Loon（boolean）或 Egern（字符串 "true"/"false"），统一成布尔值。
  function asBool(value, fallback = true) {
    if (void 0 === value || null === value || "" === value) return fallback;
    if (false === value || 0 === value) return false;
    if (true === value) return true;
    const text = String(value).trim().toLowerCase();
    if ("false" === text || "0" === text || "off" === text || "no" === text) return false;
    if ("true" === text || "1" === text || "on" === text || "yes" === text) return true;
    return fallback;
  }

  // 把 home_menu 里的一个 token 归一成 { hide, id }；认不出就返回 undefined。
  function menuToken(token) {
    const text = String(token ?? "").trim();
    if (!text) return undefined;

    const hide = text.startsWith("-") || text.startsWith("!");
    const name = (hide ? text.slice(1) : text).trim().toLowerCase();
    if (!name) return undefined;

    const item = MENU_ITEMS.find((entry) => entry.id.toLowerCase() === name || entry.keys.some((key) => key.toLowerCase() === name));
    if (item) return { hide, id: item.id };
    // 也允许直接写 browseId；只接受像 ID 的字符串，避免把说明文字当成入口。
    if (/^[a-z0-9_]+$/i.test(name)) return { hide, id: name };
    return undefined;
  }

  // home_menu 语义：
  //   空              -> 旧默认：只隐藏上传
  //   all             -> 全部保留
  //   none            -> 全部隐藏
  //   upload,shorts   -> 只保留这两项
  //   -shorts         -> 保留全部，只隐藏 Shorts
  //   all,-shorts     -> 保留全部，但隐藏 Shorts
  // 以 - 或 ! 开头的 token 表示隐藏；其余表示保留。
  function resolveHiddenMenu(value, blockAds) {
    const hidden = new Set();
    const tokens = String(value ?? "")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    if (!tokens.length) {
      hidden.add("FEuploads");
    } else {
      const keep = new Set();
      const extraHide = new Set();
      let keepAll = false;
      let hideAll = false;

      for (const token of tokens) {
        const lower = token.toLowerCase();
        if ("all" === lower) {
          keepAll = true;
          continue;
        }
        if ("none" === lower) {
          hideAll = true;
          continue;
        }
        const parsed = menuToken(token);
        if (!parsed) continue;
        (parsed.hide ? extraHide : keep).add(parsed.id);
      }

      if (hideAll) {
        for (const item of MENU_ITEMS) hidden.add(item.id);
      } else if (!keepAll && keep.size) {
        for (const item of MENU_ITEMS) if (!keep.has(item.id)) hidden.add(item.id);
      }
      for (const id of extraHide) hidden.add(id);
    }

    if (blockAds) hidden.add("SPunlimited");
    return [...hidden];
  }

  // 同一次脚本执行里 options 可能被 applyQuality / 广告过滤 / 画质缓存反复读取：
  // 参数解析（读 env、展开默认值、计算隐藏菜单）只做一次。
  let OPTIONS_CACHE = null;

  function readOptions(defaults = {}) {
    const noDefaults = !defaults || !Object.keys(defaults).length;
    if (noDefaults && OPTIONS_CACHE) return OPTIONS_CACHE;
    const raw = readArgument();
    const options = raw && "object" == typeof raw ? { ...raw } : {};
    for (const snakeKey in ARG_ALIASES) {
      if (void 0 !== options[snakeKey] && void 0 === options[ARG_ALIASES[snakeKey]]) {
        options[ARG_ALIASES[snakeKey]] = options[snakeKey];
      }
    }

    // 广告总开关：播放器 / 信息流 / Shorts / 付费推广 / 广告追踪 / Premium 推广 / 创作者商店。
    const blockAds = asBool(options.blockAds, true);
    options.blockAds = blockAds;
    options.blockPlayerAds = blockAds;
    options.blockFeedAds = blockAds;
    options.blockShortsAds = blockAds;
    options.removePaidPromotion = blockAds;
    options.blockAdTracking = blockAds;
    options.hidePremium = blockAds;

    // 默认分辨率：max / 4320 / 2160 / ... / off。off 表示完全不改画质。
    if (void 0 === options.maxHeight && void 0 !== options.autoHd && !asBool(options.autoHd, true)) {
      options.maxHeight = "off";
    }
    const height = String(options.maxHeight ?? "max").toLowerCase();
    if ("off" === height || "false" === height) {
      options.autoHd = false;
      options.maxHeight = 4320;
    } else {
      const parsed = parseInt(height, 10);
      options.autoHd = true;
      options.maxHeight = "max" === height || !Number.isFinite(parsed) ? 4320 : Math.max(144, Math.min(4320, parsed));
    }
    options.preferPremium = true;

    // 这些是系统设置里能开的，脚本直接常开，不再单独给开关。
    options.backgroundPlay = true;
    options.pip = true;
    options.stripHotHash = true;

    // 首页清理：off 全关，standard 只清 Playables，all 再加竖屏直播。
    // 创作者商店/商品卡属于付费推广，跟随 blockAds。
    let cleanup = String(options.homeCleanup ?? "").toLowerCase();
    if (!cleanup) {
      const games = void 0 === options.blockGames ? true : asBool(options.blockGames, true);
      const vertical = void 0 !== options.blockVerticalLive && asBool(options.blockVerticalLive, false);
      cleanup = vertical ? "all" : games ? "standard" : "off";
    }
    options.blockStore = blockAds;
    options.blockGames = "off" !== cleanup;
    options.blockVerticalLive = "all" === cleanup;

    // 旧版参数没有 home_menu，用 block_upload / block_shorts / block_guide_items 还原。
    if (void 0 === options.homeMenu) {
      const tokens = [];
      if (void 0 === options.blockUpload || asBool(options.blockUpload, true)) tokens.push("-FEuploads");
      if (void 0 !== options.blockShorts && asBool(options.blockShorts, false)) tokens.push("-FEshorts");
      options.homeMenu = tokens.length ? tokens.join(",") : "all";
    }
    if (options.blockGuideItems) {
      const extra = String(options.blockGuideItems)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (extra.length) options.homeMenu = [options.homeMenu, ...extra.map((item) => `-${item}`)].filter(Boolean).join(",");
    }

    options.hiddenGuideItems = resolveHiddenMenu(options.homeMenu, blockAds);

    const speed = String(options.maxSpeed ?? "4").toLowerCase();
    options.maxSpeed = "off" === speed || false === options.maxSpeed ? false : Math.max(2, Math.min(4, parseInt(speed) || 4));

    const caption = String(options.captionLang ?? "zh-Hans").trim();
    options.captionLang = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/i.test(caption) ? caption : "off";

    options.blockAi = asBool(options.blockAi, true);
    // 这两项插件默认关闭，参数缺失时不能按「非 false 即 true」处理。
    options.blockShortsFeed = asBool(options.blockShortsFeed, false);
    options.blockMembersOnly = asBool(options.blockMembersOnly, false);
    options.jumpAhead = asBool(options.jumpAhead, true);
    options.youtubeMusic = asBool(options.youtubeMusic, true);
    // 网页版 YouTube / YouTube Music 的 JSON 响应处理，默认开启。
    options.web = asBool(options.web, true);

    const result = { ...defaults, ...options };
    if (noDefaults) OPTIONS_CACHE = result;
    return result;
  }
