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
    // 新增参数放在末尾：12 项旧位置数组走 Object.keys 兜底时，前 12 位顺序不能变。
    block_feed_cards: "blockFeedCards",
    player_cleanup: "playerCleanup",
    captions_mode: "captionsMode",
    feed_cleanup: "feedCleanup",
    watch_cleanup: "watchCleanup",
    video_codec: "videoCodec",
    web_cleanup: "webCleanup",
    music_cleanup: "musicCleanup",
    probe: "probe",
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

  // 当前 Loon 位置数组（21 项）。末尾追加的新参数按这个顺序还原；
  // 旧长度的位置数组走下面按长度分的兼容表。
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
    "block_feed_cards",
    "player_cleanup",
    "captions_mode",
    "feed_cleanup",
    "watch_cleanup",
    "video_codec",
    "web_cleanup",
    "music_cleanup",
    "probe",
  ];

  // 只加过 block_feed_cards 的那一版（13 项）：客户端缓存旧插件时仍按它的顺序还原。
  const FEED_CARDS_ARG_ORDER = CURRENT_ARG_ORDER.slice(0, 13);

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
            : raw.length === FEED_CARDS_ARG_ORDER.length
              ? FEED_CARDS_ARG_ORDER
              : raw.length === CURRENT_ARG_ORDER.length
                ? CURRENT_ARG_ORDER
                : // 其他长度（未来少传/多传）按别名表顺序兜底，前缀位置仍然对得上。
                  Object.keys(ARG_ALIASES);
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

  // 多级开关：off 关；基础档（standard / comments）；all 再多做一项。
  // 旧式布尔值也能吃：true = 基础档，false = off。
  function asLevel(value, base) {
    if (true === value) return base;
    if (false === value || 0 === value) return "off";
    const text = String(value ?? "").trim().toLowerCase();
    if (!text || "false" === text || "0" === text || "off" === text || "none" === text || "no" === text) return "off";
    if ("all" === text) return "all";
    if (base === text || "standard" === text || "true" === text || "1" === text || "on" === text || "yes" === text) return base;
    return "off";
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
    options.blockFeedCards = asBool(options.blockFeedCards, false);
    options.blockMembersOnly = asBool(options.blockMembersOnly, false);
    options.jumpAhead = asBool(options.jumpAhead, true);
    options.youtubeMusic = asBool(options.youtubeMusic, true);
    // 网页版 YouTube / YouTube Music 的 JSON 响应处理，默认开启。
    options.web = asBool(options.web, true);

    // 播放器清理：去播放结束推荐墙 / 信息卡 / 播放器相关浮层；all 再关掉自动播放下一首。
    const playerCleanup = asLevel(options.playerCleanup, "standard");
    options.playerCleanup = playerCleanup;
    options.blockEndscreen = "off" !== playerCleanup;
    options.blockInfoCards = "off" !== playerCleanup;
    options.blockAutoplay = "all" === playerCleanup;

    // 信息流清理：去「继续观看」卡片与顶部筛选条；all 再去掉直播 / 首映卡片。
    const feedCleanup = asLevel(options.feedCleanup, "standard");
    options.feedCleanup = feedCleanup;
    options.blockContinueWatching = "off" !== feedCleanup;
    options.blockChipCloud = "off" !== feedCleanup;
    options.blockLiveCards = "all" === feedCleanup;

    // 播放页清理：去掉评论区；all 再去掉相关视频列表。
    const watchCleanup = asLevel(options.watchCleanup, "comments");
    options.watchCleanup = watchCleanup;
    options.blockComments = "off" !== watchCleanup;
    options.blockRelatedVideos = "all" === watchCleanup;

    // 字幕：keep 保持现状，off 去掉自动生成（ASR）字幕轨且不自动开启，force 强制开启。
    const captionsMode = String(options.captionsMode ?? "keep").trim().toLowerCase();
    options.captionsMode = ["keep", "off", "force"].includes(captionsMode) ? captionsMode : "keep";
    options.stripAutoCaptions = "off" === options.captionsMode;
    options.forceCaptions = "force" === options.captionsMode;
    if (options.stripAutoCaptions) options.captionLang = "off";

    // 编码偏好：any 不动，no_av1 去掉 AV1，avc 只留 H.264。
    const codec = String(options.videoCodec ?? "any").trim().toLowerCase();
    options.videoCodec = ["any", "no_av1", "avc"].includes(codec) ? codec : "any";

    // 网页版 topbar 按钮与 YouTube Music 首页推荐。
    options.webCleanup = asBool(options.webCleanup, false);
    options.musicCleanup = asBool(options.musicCleanup, false);
    // 排障日志：打印推荐流卡片的真实结构，默认关闭。
    options.probe = asBool(options.probe, false);

    const result = { ...defaults, ...options };
    if (noDefaults) OPTIONS_CACHE = result;
    return result;
  }
