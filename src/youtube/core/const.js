  //=====================================================================================
  // §1 常量
  //=====================================================================================

  const CONFIG_KEY = "YouTubeConfig"; // clientKey / encryptKey 缓存
  const QUALITY_KEY = "YouTubeQuality"; // 视频 id -> 可用 itag 缓存
  // 超过上限的响应直接放行：解码 / 重编码会占用数倍于原始大小的内存，宁可漏改也不能把 Loon 打崩。
  // player / browse 响应大多在 1 MiB 以内，8 MiB 留有很大余量。
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

  // App 里 Shorts 卡片/货架的 element 标识（uYou / YTLite 用的也是这几个）。
  // 最后一个是 reelWatchEndpoint 的字段标签：混在推荐流里的单个 Shorts 卡片。
  const SHORTS_MARKERS = [
    textEncoder.encode("shorts_video_cell"),
    textEncoder.encode("shorts_shelf"),
    new Uint8Array([0x8a, 0x9f, 0xc8, 0x94, 0x04]),
  ];

  // 播放页的评论区面板：engagementPanels 里靠这两个内部标识认出来，
  // 和网页版 JSON 的 sectionIdentifier 是同一套名字，不随界面语言变化。
  const COMMENT_PANEL_MARKERS = [textEncoder.encode("comment-item-section"), textEncoder.encode("comments-section")];

  // 会员专属徽章的文案，用来在列表里认出会员视频。
  // App 的 protobuf 里只有本地化文案（枚举是 varint，脚本里没为它建模），
  // 所以原生端按这几种语言的徽章文字精确匹配；网页版 JSON 有 style 枚举，
  // 优先按 BADGE_STYLE_TYPE_MEMBERS_ONLY 判定，文案只作兜底。
  const MEMBERS_ONLY_LABELS = [
    "Members only",
    "会员专享",
    "會員專享",
    "メンバー限定",
    "멤버 전용",
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
