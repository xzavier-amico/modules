  //=====================================================================================
  // §1 常量
  //=====================================================================================

  const CONFIG_KEY = "YouTubeConfig"; // clientKey / encryptKey 缓存
  const QUALITY_KEY = "YouTubeQuality"; // 视频 id -> 可用 itag 缓存
  // 超过上限的响应直接放行：解码 / 重编码会占用数倍于原始大小的内存，宁可漏改也不能把 Loon 打崩。
  // 实测 player / browse 响应大多在 1 MiB 以内，8 MiB 已经留了很大余量。
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  // UMP 还要解密、解压、重编码、再加密，内存峰值更高，保持 5 MiB。
  const MAX_UMP_RESPONSE_BYTES = 5 * 1024 * 1024;
  const MAX_QUALITY_JSON = 65536; // 画质缓存序列化后的上限
  const MAX_QUALITY_ENTRIES = 16; // 画质缓存保留的视频数

  const textEncoder = new TextEncoder();
  const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

  // 用来在字节流里认东西的标记。
  const PREMIUM_UPSELL_MARKER = textEncoder.encode("PAyouchat");
  const AI_SUMMARY_MARKER = textEncoder.encode("ai_summary_");
  const PAGEAD_MARKER = textEncoder.encode("/pagead/");
  const MINI_GAME_MARKER = textEncoder.encode("mini_game_card.eml");
  const SHOPPING_LIST_MARKER = textEncoder.encode("shopping_item_card_list.eml");
  const STORE_TAB_MARKER = textEncoder.encode("store");
  const VERTICAL_LIVE_ICON = textEncoder.encode("youtube_outline_experimental/live_24pt");
  const IMMERSIVE_LIVE_MARKER = textEncoder.encode("immersive_live");
  const PREMIUM_TAB_MARKER = textEncoder.encode("SPunlimited");

  // 信息流里这些版式都是广告位。
  const FEED_AD_LAYOUT =
    /^(?:inline_injection_entrypoint_layout|video_display_button_group_layout|full_width_portrait_image_layout|full_width_square_image_layout|video_display_full_buttoned_layout)\.eml(?:-js)?(?:-fe)?$/;
  // 带货/商品版式。
  const SHOPPING_LAYOUT = /^(?:shopping_|products?_in_video_)[a-z0-9_]+\.eml(?:-js)?(?:-fe)?$/;

  // 会员专属徽章的文案，用来在列表里认出会员视频。
  const MEMBERS_ONLY_LABELS = [
    "Members only",
    "会员专享",
    "會員專享",
    "メンバー限定",
    "멤버 전용",
    "BADGE_MEMBERS_ONLY",
  ];

  // 侧栏/首页菜单项：值是可读别名，id 是 guide 响应里的 browseId。
  // home_menu 用别名或 browseId 都可以，多个用英文逗号分隔。
  const MENU_ITEMS = [
    { id: "FEwhat_to_watch", keys: ["home", "首页"] },
    { id: "FEshorts", keys: ["shorts"] },
    { id: "FEsubscriptions", keys: ["subscriptions", "subs", "订阅"] },
    { id: "FEexplore", keys: ["explore", "探索"] },
    { id: "FEtrending", keys: ["trending", "时下流行"] },
    { id: "FEuploads", keys: ["upload", "uploads", "上传"] },
    { id: "FEhistory", keys: ["history", "历史"] },
    { id: "FEplaylist_aggregation", keys: ["playlists", "playlist", "播放列表"] },
    { id: "FElibrary", keys: ["library", "媒体库"] },
    { id: "FEwatch_later", keys: ["watch_later", "later", "稍后观看"] },
    { id: "FEliked_videos", keys: ["liked", "likes", "喜欢的视频"] },
    { id: "FEmusic", keys: ["music", "音乐"] },
    { id: "FEdownloads", keys: ["downloads", "download", "下载"] },
  ];
