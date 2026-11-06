//=======================================================================================
// YouTube Enhance — 单文件脚本（Egern / Loon）
//
// 原始逻辑来自 Maasea 的代码（Apache-2.0），经 gholts/surge 分发，本仓库重写为
// 可读版本并合并为单文件。UMP 段内联的 @noble/ciphers 与 @noble/hashes 为 MIT
// 许可，版权与许可声明保留在该段开头。详见同目录 README 的「许可」一节。
//
// 这个文件同时承担原来四个脚本的职责，靠 URL 和方法分发：
//
//   /youtubei/v1/player/ad_break      请求：直接返回空 protobuf
//   /youtubei/v1/log_event            请求：剥掉热更新哈希头
//   googlevideo.com/initplayback      请求：校验 UMP 密钥 / 响应：解密后改写再加密
//   googlevideo.com/videoplayback     请求：按画质缓存改 itag
//   /youtubei/v1/{browse,next,...}    响应：按 schema 删广告和推广位
//   /youtubei/v1/{config,log_event}   响应：抓 UMP 的 client/encrypt 密钥
//
// 全篇分 13 段，见下面的 §编号。
//=======================================================================================

(() => {
  "use strict";

  //=====================================================================================
  // §1 常量
  //=====================================================================================

  const CONFIG_KEY = "YouTubeConfig"; // clientKey / encryptKey 缓存
  const QUALITY_KEY = "YouTubeQuality"; // 视频 id -> 可用 itag 缓存
  const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 超过 5 MiB 的响应直接放行，避免超时
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

  //=====================================================================================
  // §2 持久化
  //=====================================================================================

  // 读一个 JSON 对象；内容超长或解析失败都当成空对象。
  function readStore(key = CONFIG_KEY, maxLength = Infinity) {
    const raw = $persistentStore.read(key);
    if (typeof raw === "string" && raw.length > maxLength) return {};
    try {
      const value = JSON.parse(raw || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function writeStore(value, key = CONFIG_KEY) {
    return $persistentStore.write(JSON.stringify(value), key);
  }

  //=====================================================================================
  // §3 字节工具
  //=====================================================================================

  function concatBytes(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function bytesEqual(left, right) {
    return left === right || (left.length === right.length && left.every((byte, i) => byte === right[i]));
  }

  function encodeVarint(value) {
    const out = [];
    do {
      out.push((value % 128) | (value > 127 ? 128 : 0));
      value = Math.floor(value / 128);
    } while (value);
    return new Uint8Array(out);
  }

  // 解一个 varint 的数值（不带长度语义），溢出直接抛错。
  function readVarintValue(bytes) {
    let value = 0;
    let scale = 1;
    for (const byte of bytes) {
      value += (127 & byte) * scale;
      scale *= 128;
    }
    if (!Number.isSafeInteger(value)) throw new Error("Unsafe decoded integer");
    return value;
  }

  // YouTube 的 params 是 URL-safe base64，去掉填充后长度可能差一位。
  function base64ToBytes(text) {
    const normalized = text.replace(/[-_\s=]/g, (ch) => (ch === "-" ? "+" : ch === "_" ? "/" : ""));
    const needsPad = normalized.length % 4 === 1;
    const bytes = Uint8Array.fromBase64(needsPad ? normalized + "A" : normalized);
    return needsPad ? bytes.subarray(0, -1) : bytes;
  }

  // 在字节流里找一段子串。先顺序扫，命中太稀疏时切成两段再找，
  // 避免在超大响应上退化成 O(n*m)。
  function containsBytes(haystack, needle = PAGEAD_MARKER) {
    if (!needle.length) return true;
    const lastStart = haystack.length - needle.length;
    let probes = 0;
    let lastProbeAt = 0;
    for (let start = haystack.indexOf(needle[0]); start >= 0 && start <= lastStart; start = haystack.indexOf(needle[0], start + 1)) {
      let hit = true;
      for (let i = 1; i < needle.length; i++) {
        if (haystack[start + i] !== needle[i]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
      if (8 === ++probes) {
        // 连续 8 次没中且都挤在 256 字节内，说明这段是噪声，直接往后跳。
        if (start - lastProbeAt < 256) return containsBytesSlow(haystack, needle, start + 1);
        lastProbeAt = start;
        probes = 0;
      }
    }
    return false;
  }

  function containsBytesSlow(haystack, needle, from) {
    outer: for (let start = from; start <= haystack.length - needle.length; start++) {
      for (let i = 0; i < needle.length; i++) {
        if (haystack[start + i] !== needle[i]) continue outer;
      }
      return true;
    }
    return false;
  }

  //=====================================================================================
  // §4 protobuf 基础
  //
  // 这里不做完整的编解码，只做「把一段字节拆成字段列表」和「按字段号就地替换」，
  // 未建模的字段原样保留，所以改不动的接口最多是不生效，不会把响应写坏。
  //=====================================================================================

  // 返回 [{ no, wire, data, raw }]，data 是字段值，raw 是含 tag 的整段字节。
  function parseFields(bytes) {
    const fields = [];
    let offset = 0;

    function readTag() {
      let value = 0;
      let scale = 1;
      for (let i = 0; i < 5; i++) {
        if (offset >= bytes.length) throw new Error("Truncated protobuf varint");
        const byte = bytes[offset++];
        value += (127 & byte) * scale;
        if (!(128 & byte)) {
          if (value > 4294967295) throw new Error("Protobuf length/tag overflow");
          return value;
        }
        scale *= 128;
      }
      throw new Error("Invalid protobuf varint");
    }

    while (offset < bytes.length) {
      const rawStart = offset;
      const tag = readTag();
      const fieldNo = Math.floor(tag / 8);
      const wireType = tag % 8;
      if (!fieldNo) throw new Error("Invalid protobuf field");

      let dataStart = offset;
      if (2 === wireType) {
        const length = readTag();
        dataStart = offset;
        offset += length;
      } else if (1 === wireType) {
        offset += 8;
      } else if (5 === wireType) {
        offset += 4;
      } else {
        if (0 !== wireType) throw new Error("Unsupported protobuf wire type " + wireType);
        let byte;
        let count = 0;
        do {
          if (offset >= bytes.length || 10 === count++) throw new Error("Invalid protobuf integer");
          byte = bytes[offset++];
          if (10 === count && byte > 1) throw new Error("Protobuf integer overflow");
        } while (128 & byte);
      }
      if (offset > bytes.length) throw new Error("Truncated protobuf field");
      fields.push({
        no: fieldNo,
        wire: wireType,
        data: bytes.subarray(dataStart, offset),
        raw: bytes.subarray(rawStart, offset),
      });
    }
    return fields;
  }

  // 取第一个（或最后一个）指定字段的值。
  function fieldData(bytes, fieldNo, last = false) {
    let found;
    for (const field of parseFields(bytes)) {
      if (field.no === fieldNo && 2 === field.wire) {
        if (!last) return field.data;
        if (found) return;
        found = field.data;
      }
    }
    return found;
  }

  // 按字段号逐层往下钻，任意一层缺失就返回 undefined。
  function descendPath(bytes, path) {
    let current = bytes;
    for (const fieldNo of path) {
      current = fieldData(current, fieldNo, true);
      if (!current) return;
    }
    return current;
  }

  // 把值编码成单字段：number -> uint，string -> string，其余按 bytes。
  function encodeScalarField(fieldNo, value) {
    const kind = "number" == typeof value ? "uint" : "string" == typeof value ? "string" : "bytes";
    return encodeField([fieldNo, "", kind], value);
  }

  // 从里往外套：D([1,2,3], v) 等价于 field 1 { field 2 { field 3 = v } }。
  function encodePathValue(path, value) {
    for (let i = path.length - 1; i >= 0; i--) value = encodeScalarField(path[i], value);
    return value;
  }

  function encodeField(spec, value) {
    const [fieldNo, , kind] = spec;
    const wireType = "bool" === kind || "uint" === kind ? 0 : 2;
    const encoded =
      "bytes" === kind
        ? value
        : "string" === kind
          ? textEncoder.encode(value)
          : "bool" === kind
            ? encodeVarint(value ? 1 : 0)
            : "uint" === kind
              ? encodeVarint(value)
              : encodeMessage(kind, value);
    return concatBytes(
      2 === wireType ? [encodeVarint(8 * fieldNo + wireType), encodeVarint(encoded.length), encoded] : [encodeVarint(8 * fieldNo), encoded],
    );
  }

  // 判断某条嵌套路径上的最后一个值是否等于 marker（prefixOnly 时只比前缀）。
  function matchesPath(bytes, path, marker = PAGEAD_MARKER, prefixOnly = false) {
    return path.length
      ? parseFields(bytes).some((field) => field.no === path[0] && 2 === field.wire && matchesPath(field.data, path.slice(1), marker, prefixOnly))
      : bytesEqual(prefixOnly ? bytes.subarray(0, marker.length) : bytes, marker);
  }

  // 对某个字段的每个出现位置跑一次 rewriter，返回 undefined 表示整条删掉。
  function rewriteRepeatedField(bytes, fieldNo, rewriter) {
    let changed = false;
    const parts = parseFields(bytes).flatMap((field) => {
      if (field.no !== fieldNo || 2 !== field.wire) return [field.raw];
      const next = rewriter(field.data);
      return next && bytesEqual(next, field.data) ? [field.raw] : ((changed = true), next ? [encodeField([fieldNo, "", "bytes"], next)] : []);
    });
    return changed ? concatBytes(parts) : bytes;
  }

  // 按路径下钻，对命中位置的字节跑 rewriter。
  function rewritePath(bytes, path, rewriter) {
    if (!path.length) return rewriter(bytes);
    let changed = false;
    const parts = parseFields(bytes).map((field) => {
      if (field.no !== path[0] || 2 !== field.wire) return field.raw;
      const next = rewritePath(field.data, path.slice(1), rewriter);
      return bytesEqual(next, field.data) ? field.raw : ((changed = true), encodeField([field.no, "", "bytes"], next));
    });
    return changed ? concatBytes(parts) : bytes;
  }

  // 不管层级，把所有出现的 needle 替换成 replacement（用于改 on-the-go 模板）。
  function replaceBytesDeep(bytes, replacements, depth = 0) {
    for (const [from, to] of replacements) if (bytesEqual(bytes, from)) return to;
    if (96 === depth) return bytes;
    let fields;
    try {
      fields = parseFields(bytes);
    } catch {
      return bytes;
    }
    let changed = false;
    const parts = fields.map((field) => {
      if (2 !== field.wire) return field.raw;
      const next = replaceBytesDeep(field.data, replacements, depth + 1);
      return next === field.data ? field.raw : ((changed = true), encodeScalarField(field.no, next));
    });
    return changed ? concatBytes(parts) : bytes;
  }

  //=====================================================================================
  // §5 选项
  //
  // Loon 传 snake_case 对象，Egern 传 camelCase JSON 字符串，这里统一成 camelCase。
  //=====================================================================================

  const ARG_ALIASES = {
    block_upload: "blockUpload",
    block_shorts: "blockShorts",
    block_shorts_feed: "blockShortsFeed",
    block_members_only: "blockMembersOnly",
    auto_hd: "autoHd",
    block_games: "blockGames",
    block_vertical_live: "blockVerticalLive",
    jump_ahead: "jumpAhead",
    block_store: "blockStore",
    block_ai: "blockAi",
    on_the_go: "onTheGo",
    background_play: "backgroundPlay",
    pip: "pip",
    max_speed: "maxSpeed",
    hide_premium: "hidePremium",
    prefer_premium: "preferPremium",
    max_height: "maxHeight",
    block_player_ads: "blockPlayerAds",
    block_feed_ads: "blockFeedAds",
    block_shorts_ads: "blockShortsAds",
    remove_paid_promotion: "removePaidPromotion",
    block_ad_tracking: "blockAdTracking",
    block_guide_items: "blockGuideItems",
    on_the_go_audio: "onTheGoAudio",
    on_the_go_chapters: "onTheGoChapters",
    strip_hot_hash: "stripHotHash",
  };

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
      Object.keys(ARG_ALIASES).forEach((key, index) => {
        if (index < raw.length) out[key] = raw[index];
      });
      return out;
    }
    return raw && "object" == typeof raw ? raw : {};
  }

  function readOptions(defaults = {}) {
    const raw = readArgument();
    if (!raw || "object" != typeof raw) return defaults;

    const options = { ...raw };
    for (const snakeKey in ARG_ALIASES) {
      if (void 0 !== options[snakeKey] && void 0 === options[ARG_ALIASES[snakeKey]]) {
        options[ARG_ALIASES[snakeKey]] = options[snakeKey];
      }
    }

    const speed = String(options.maxSpeed ?? "4").toLowerCase();
    options.maxSpeed = speed === "off" || options.maxSpeed === false ? false : Math.max(2, Math.min(4, parseInt(speed) || 4));

    const height = parseInt(options.maxHeight);
    options.maxHeight = Number.isFinite(height) ? Math.max(144, Math.min(4320, height)) : 4320;

    return { ...defaults, ...options };
  }

  //=====================================================================================
  // §6 schema
  //
  // 每条是 [字段号, JS 属性名, 值类型, 是否数组]：
  //   值类型是 "string" / "bytes" / "bool" / "uint" 时是标量，
  //   否则是 §6 里另一个消息类型名，按嵌套消息处理。
  //=====================================================================================

  const SCHEMA = {
    Browse: [
      [9, "content", "BrowseContent"],
      [10, "onResponseReceivedAction", "BrowseContent"],
    ],
    BrowseContent: [
      [58173949, "singleColumnResultsRenderer", "SingleColumnResultsRenderer"],
      [52123031, "twoColumnBrowseResultsRenderer", "TwoColumnBrowseResultsRenderer"],
      [255072793, "richGridRenderer", "RichGridRenderer"],
      [153515154, "elementRenderer", "ElementRenderer"],
      [49399797, "sectionListRenderer", "SectionListRenderer"],
    ],
    TwoColumnBrowseResultsRenderer: [[3, "tabs", "BrowseTabSupportedRenderer", true]],
    RichGridRenderer: [[1, "richItemContents", "RichItemContent", true]],
    SingleColumnResultsRenderer: [[1, "tabs", "BrowseTabSupportedRenderer", true]],
    BrowseTabSupportedRenderer: [[58174010, "tabRenderer", "TabRenderer"]],
    TabRenderer: [
      [1, "endpoint", "TabEndpoint"],
      [4, "content", "BrowseContent"],
    ],
    TabEndpoint: [[48687626, "browse", "TabBrowseEndpoint"]],
    TabBrowseEndpoint: [[3, "params", "string"]],
    ElementRenderer: [[172660663, "videoRendererContent", "VideoRendererContent"]],
    VideoRendererContent: [
      [1, "richItemContents", "VideoInfo", true],
      [2, "renderInfo", "RenderInfo"],
    ],
    VideoInfo: [[168777401, "videoContext", "VideoContext"]],
    VideoContext: [
      [3, "layout", "ElementLayout"],
      [5, "videoContent", "VideoContent"],
    ],
    ElementLayout: [[172035250, "layoutRender", "LayoutRender"]],
    VideoContent: [
      [413471385, "element", "ElementModel"],
      [512694658, "smartSkipButton", "SmartSkipButton"],
      [232954548, "videoLockup", "VideoLockup"],
      [454362329, "sponsoredVideo", "bytes"],
      [491441836, "sponsoredDisplay", "bytes"],
    ],
    ElementModel: [[1, "data", "ElementData"]],
    ElementData: [[1829, "shoppingShelf", "bytes"]],
    SmartSkipButton: [
      [1, "actions", "SmartSkipActions"],
      [13, "controller", "SmartSkipController"],
      [17, "displayLimit", "uint"],
    ],
    SmartSkipActions: [[3, "items", "SmartSkipAction", true]],
    SmartSkipAction: [[9, "displayLimit", "uint"]],
    SmartSkipController: [[7, "promotionMode", "bool"]],
    VideoLockup: [
      [33, "attachments", "Attachment", true],
      [34, "attachmentStateKey", "bytes"],
    ],
    Attachment: [[9, "products", "bytes", true]],
    RenderInfo: [[183314536, "layoutRender", "LayoutRender"]],
    LayoutRender: [[1, "eml", "string"]],
    SectionListRenderer: [
      [1, "sectionListSupportedRenderers", "SectionListSupportedRenderer", true],
      [32, "promotedContents", "bytes", true],
    ],
    SectionListSupportedRenderer: [
      [50195462, "itemSectionRenderer", "ItemSectionRenderer"],
      [51845067, "shelfRenderer", "ShelfRenderer"],
    ],
    ItemSectionRenderer: [[1, "richItemContents", "RichItemContent", true]],
    RichItemContent: [[153515154, "videoWithContextRenderer", "ElementRenderer"]],
    ShelfRenderer: [[5, "richSectionContent", "RichSectionContent"]],
    RichSectionContent: [[51431404, "reelShelfRenderer", "ReelShelfRenderer"]],
    ReelShelfRenderer: [[1, "richItemContents", "RichItemContent", true]],
    Next: [
      [7, "content", "NextContent"],
      [8, "onResponseReceivedAction", "BrowseContent"],
      [14, "playerOverlays", "PlayerOverlays"],
      [25, "engagementPanels", "EngagementPanel", true],
      [777, "frameworkUpdates", "bytes"],
    ],
    EngagementPanel: [[138681066, "renderer", "EngagementPanelRenderer"]],
    EngagementPanelRenderer: [[3, "content", "BrowseContent"]],
    NextContent: [[51779735, "nextResult", "NextResult"]],
    NextResult: [[1, "content", "BrowseContent"]],
    PlayerOverlays: [[78882851, "renderer", "PlayerOverlayRenderer"]],
    PlayerOverlayRenderer: [
      [2, "overflowMenu", "bytes"],
      [3, "related", "RelatedOverlay"],
      [42, "overlayCollections", "OverlayCollection", true],
    ],
    OverlayCollection: [[401855120, "renderer", "OverlayCollectionRenderer"]],
    OverlayCollectionRenderer: [[2, "overlays", "OverlayItem", true]],
    OverlayItem: [[401855122, "content", "OverlayContent"]],
    OverlayContent: [[1, "item", "RichItemContent"]],
    RelatedOverlay: [[29209665, "contents", "RelatedOverlayContents"]],
    RelatedOverlayContents: [[2, "contents", "RichItemContent", true]],
    Player: [
      [15, "playerConfig", "PlayerConfig"],
      [60, "overlayCollections", "OverlayCollection", true],
      [61, "paidPromotion", "bytes"],
      [7, "adPlacements", "bytes", true],
      [2, "playabilityStatus", "PlayabilityStatus"],
      [9, "playbackTracking", "PlaybackTracking"],
      [68, "adSlots", "bytes", true],
    ],
    PlayerConfig: [[1, "granularVariableSpeedConfig", "PlaybackSpeedConfig"]],
    PlaybackSpeedConfig: [
      [1, "minimumPlaybackRate", "uint"],
      [2, "maximumPlaybackRate", "uint"],
    ],
    PlayabilityStatus: [
      [21, "pictureInPictureRender", "PictureInPictureSupportedRenderer"],
      [11, "backgroundPlayerRender", "BackgroundSupportedRenderer"],
    ],
    PictureInPictureSupportedRenderer: [[151635310, "pictureInPictureAbility", "PictureInPictureAbility"]],
    PictureInPictureAbility: [
      [1, "active", "bool"],
      [4, "f4", "uint"],
      [6, "f6", "uint"],
      [8, "f8", "uint"],
    ],
    BackgroundSupportedRenderer: [[64657230, "backgroundAbility", "BackgroundAbility"]],
    BackgroundAbility: [[1, "active", "bool"]],
    PlaybackTracking: [[18, "pageadViewthroughconversion", "bytes"]],
    Search: [
      [4, "content", "BrowseContent"],
      [7, "onResponseReceivedCommand", "OnResponseReceivedCommand"],
    ],
    OnResponseReceivedCommand: [
      [50195462, "itemSectionRenderer", "ItemSectionRenderer"],
      [49399797, "appendContinuationItemsAction", "SectionListRenderer"],
    ],
    Shorts: [[2, "entries", "Entry", true]],
    Entry: [[1, "command", "Command"]],
    Command: [[139608561, "reelWatchEndpoint", "ReelWatchEndpoint"]],
    ReelWatchEndpoint: [[16, "adClientParams", "AdClientParams"]],
    AdClientParams: [[1, "isAd", "bool"]],
    Guide: [
      [4, "labelItems", "GuideItem", true],
      [6, "iconItems", "GuideItem", true],
    ],
    GuideItem: [[117866661, "guideSectionRenderer", "GuideSectionRenderer"]],
    GuideSectionRenderer: [[1, "rendererItems", "RendererItem", true]],
    RendererItem: [
      [318370163, "iconRender", "guideEntryRenderer"],
      [117501096, "labelRender", "guideEntryRenderer"],
    ],
    guideEntryRenderer: [[1, "browseId", "string"]],
    Setting: [
      [6, "settingItems", "SettingItem", true],
      [7, "collectionItems", "SettingItem", true],
    ],
    SettingItem: [
      [88478200, "backgroundPlayBackSettingRenderer", "BackgroundPlayBackSettingRenderer"],
      [66930374, "settingCategoryCollectionRenderer", "SettingCategoryCollectionRenderer"],
    ],
    BackgroundPlayBackSettingRenderer: [
      [2, "backgroundPlayback", "bool"],
      [14, "icon", "Icon"],
    ],
    Icon: [[1, "iconType", "uint"]],
    SettingCategoryCollectionRenderer: [
      [3, "subSettings", "SubSetting", true],
      [4, "categoryId", "uint"],
    ],
    SubSetting: [[61331416, "settingBooleanRenderer", "SettingBooleanRenderer"]],
    SettingBooleanRenderer: [
      [5, "enableServiceEndpoint", "ServiceEndpoint"],
      [6, "disableServiceEndpoint", "ServiceEndpoint"],
      [15, "itemId", "uint"],
    ],
    ServiceEndpoint: [[81212182, "setClientSettingEndpoint", "SetClientSettingEndpoint"]],
    SetClientSettingEndpoint: [[1, "settingData", "SettingData"]],
    SettingData: [
      [1, "clientSettingEnum", "ClientSettingEnum"],
      [3, "boolValue", "bool"],
    ],
    ClientSettingEnum: [[1, "item", "uint"]],
    Watch: [[1, "contents", "WatchContent", true]],
    ResolveUrl: [[2, "endpoint", "NavigationEndpoint"]],
    NavigationEndpoint: [[48687757, "watch", "NavigationWatch"]],
    NavigationWatch: [[68146959, "embedded", "EmbeddedPlayer"]],
    EmbeddedPlayer: [[68202535, "response", "EmbeddedPlayerBody"]],
    EmbeddedPlayerBody: [[1, "player", "Player"]],
    WatchContent: [
      [2, "player", "Player"],
      [3, "next", "Next"],
    ],
    // 只有 UMP 会用到
    EncryptedResponsePart: [
      [1, "encryptedContent", "bytes"],
      [2, "hmac", "bytes"],
      [3, "iv", "bytes"],
      [4, "compressionAlgorithm", "uint"],
    ],
    OnesieInnertubeResponse: [[4, "contents", "WatchContent", true]],
  };

  // 惰性解码的例外表：列在这里的类型即使作为子消息出现也立刻展开。
  // 遍历器要看到这些节点内部的广告字段，不能等到真正读取时才展开。
  //
  // 上游把这两个入口写成了两份略有差异的表，这里原样保留，避免改变遍历深度：
  // youtubei 响应多出 Browse / EmbeddedPlayer / NavigationEndpoint 等入口类型，
  // UMP 响应多出 OnesieInnertubeResponse。
  const EAGER_TYPES = {
    youtubei: new Set([
      "Browse",
      "BrowseContent",
      "TwoColumnBrowseResultsRenderer",
      "RichGridRenderer",
      "BrowseTabSupportedRenderer",
      "ElementRenderer",
      "EmbeddedPlayer",
      "EmbeddedPlayerBody",
      "EngagementPanel",
      "EngagementPanelRenderer",
      "ItemSectionRenderer",
      "NavigationEndpoint",
      "NavigationWatch",
      "Next",
      "NextContent",
      "NextResult",
      "OnResponseReceivedCommand",
      "OverlayCollection",
      "OverlayCollectionRenderer",
      "OverlayContent",
      "OverlayItem",
      "Player",
      "PlayerOverlayRenderer",
      "PlayerOverlays",
      "ReelShelfRenderer",
      "RelatedOverlay",
      "RelatedOverlayContents",
      "ResolveUrl",
      "RichItemContent",
      "RichSectionContent",
      "Search",
      "SectionListRenderer",
      "SectionListSupportedRenderer",
      "ShelfRenderer",
      "SingleColumnResultsRenderer",
      "TabRenderer",
      "VideoContent",
      "VideoContext",
      "VideoInfo",
      "VideoLockup",
      "VideoRendererContent",
      "Watch",
      "WatchContent",
    ]),
    ump: new Set([
      "BrowseContent",
      "TwoColumnBrowseResultsRenderer",
      "RichGridRenderer",
      "BrowseTabSupportedRenderer",
      "ElementRenderer",
      "EngagementPanel",
      "EngagementPanelRenderer",
      "ItemSectionRenderer",
      "Next",
      "NextContent",
      "NextResult",
      "OnesieInnertubeResponse",
      "OverlayCollection",
      "OverlayCollectionRenderer",
      "OverlayContent",
      "OverlayItem",
      "Player",
      "PlayerOverlayRenderer",
      "PlayerOverlays",
      "ReelShelfRenderer",
      "RelatedOverlay",
      "RelatedOverlayContents",
      "RichItemContent",
      "RichSectionContent",
      "SectionListRenderer",
      "SectionListSupportedRenderer",
      "ShelfRenderer",
      "SingleColumnResultsRenderer",
      "TabRenderer",
      "VideoContent",
      "VideoContext",
      "VideoInfo",
      "VideoLockup",
      "VideoRendererContent",
      "WatchContent",
    ]),
  };

  //=====================================================================================
  // §7 惰性解码与重编码
  //
  // 解码时不复制整棵消息树：只把字段列表挂在对象上，子消息等真正被读到才展开。
  // 改写时在对象上记 changed，重编码只重写变过的字段，其余字节原样拼回去。
  //=====================================================================================

  const WIRE_STATE = Symbol("wireState");
  const NO_FIELDS = [];

  function markChanged(state, fieldName) {
    for (; state; ) {
      (state.changed ??= new Set()).add(fieldName);
      fieldName = state.parentName;
      state = state.parent;
    }
  }

  function setField(obj, key, value) {
    const previous = obj[key];
    const unchanged =
      Array.isArray(previous) && Array.isArray(value)
        ? previous.length === value.length && previous.every((item, i) => item === value[i])
        : previous === value;
    if (unchanged) return false;
    obj[key] = value;
    if (obj[WIRE_STATE]) markChanged(obj[WIRE_STATE], key);
    return true;
  }

  function deleteField(obj, key) {
    if (void 0 === obj[key]) return false;
    delete obj[key];
    if (obj[WIRE_STATE]) markChanged(obj[WIRE_STATE], key);
    return true;
  }

  // 按 schema 把字节解成对象。depth 超过 64 层视为异常响应。
  // eager 决定哪些子类型立即展开，其余挂 getter 等第一次读取。
  function decodeMessage(typeName, bytes, depth = 0, parentState, parentName, eager = EAGER_TYPES.youtubei) {
    if (depth > 64) throw new Error("Protobuf nesting limit");

    const obj = {};
    const fields = parseFields(bytes);
    const repeatedCount = fields.length > 1 ? new Map() : null;
    const state = { bytes, fields, parent: parentState, parentName, eager };
    const specsByNo = (SPEC_CACHE[typeName] ??= new Map(SCHEMA[typeName].map((spec) => [spec[0], spec])));

    Object.defineProperty(obj, WIRE_STATE, { value: state });
    for (const [, name, , repeated] of SCHEMA[typeName]) if (repeated) obj[name] = [];

    // 先给每个字段挂上 spec，并统计同名字段出现次数。
    if (repeatedCount) {
      for (const field of fields) {
        const spec = specsByNo.get(field.no);
        if (spec && field.wire === wireTypeOf(spec[2])) {
          field.spec = spec;
          if (!spec[3]) repeatedCount.set(spec[1], (repeatedCount.get(spec[1]) ?? 0) + 1);
        }
      }
    }

    let deferredNames;
    for (const field of fields) {
      const spec = repeatedCount ? field.spec : specsByNo.get(field.no);
      if (!spec || field.wire !== wireTypeOf(spec[2])) continue;
      field.spec = spec;

      const [, name, valueType, repeated] = spec;
      if (!repeated && (repeatedCount?.get(name) ?? 0) > 1) {
        delete field.spec;
        continue;
      }
      if (SCHEMA[valueType] && !eager.has(valueType)) {
        // 同一名字段只挂一个 getter，第一次读时才真正展开。
        if (deferredNames?.has(name)) continue;
        (deferredNames ??= new Set()).add(name);
        const group = fields.filter((item) => item.spec?.[1] === name);
        state.type = typeName;
        state.deferred = true;
        Object.defineProperty(obj, name, {
          enumerable: true,
          configurable: true,
          get() {
            const value = repeated ? group.map((item) => readFieldValue(item, depth, state, eager)) : readFieldValue(group[0], depth, state, eager);
            Object.defineProperty(obj, name, { value, enumerable: true, writable: true, configurable: true });
            return value;
          },
        });
      } else {
        const value = readFieldValue(field, depth, state, eager);
        if (repeated) obj[name].push(value);
        else obj[name] = value;
      }
    }
    return obj;
  }

  function wireTypeOf(valueType) {
    return "bool" === valueType || "uint" === valueType ? 0 : 2;
  }

  function readFieldValue(field, depth, state, eager) {
    const [, name, valueType] = field.spec;
    if ("bytes" === valueType) return field.data;
    if ("string" === valueType) return strictUtf8.decode(field.data);
    if ("bool" === valueType) return 0 !== readVarintValue(field.data);
    if ("uint" === valueType) return readVarintValue(field.data);
    return decodeMessage(valueType, field.data, depth + 1, state, name, eager);
  }

  // 按 schema 把对象写回字节。没有改动时直接返回原始字节。
  function encodeMessage(typeName, obj) {
    const state = obj[WIRE_STATE];
    if (state && !state.changed) return state.bytes;

    const parts = [];
    const repeatedPool = new Map();
    const written = new Set();
    const rawOf = (value, valueType) => (SCHEMA[valueType] ? (value[WIRE_STATE]?.bytes ?? value) : value);
    const valuesOf = (spec) => {
      const [, name, , repeated] = spec;
      return repeated ? (obj[name] ?? []) : void 0 === obj[name] ? [] : [obj[name]];
    };

    // 数组字段：先把改动过的元素按原始字节做一次索引，重写时按原顺序取。
    for (const spec of SCHEMA[typeName]) {
      const [, name, valueType, repeated] = spec;
      if (repeated && state?.changed?.has(name)) {
        repeatedPool.set(name, new Map(valuesOf(spec).map((value) => [rawOf(value, valueType), value])));
      }
    }

    for (const field of state?.fields ?? []) {
      if (!field.spec || !state.changed.has(field.spec[1])) {
        parts.push(field.raw);
        continue;
      }
      const [, name, valueType, repeated] = field.spec;
      written.add(name);

      if (repeated) {
        const pool = repeatedPool.get(name);
        if (!pool.has(field.data)) continue;
        const value = pool.get(field.data);
        pool.delete(field.data);
        parts.push(SCHEMA[valueType] && value[WIRE_STATE]?.changed ? encodeField(field.spec, value) : field.raw);
      } else {
        const value = obj[name];
        if (void 0 === value) continue;
        const needsWrite = rawOf(value, valueType) !== field.data || (SCHEMA[valueType] && value[WIRE_STATE]?.changed);
        parts.push(needsWrite ? encodeField(field.spec, value) : field.raw);
      }
    }

    // 新增的字段（原消息里没有、代码里刚塞进去的）统一补在后面。
    for (const spec of SCHEMA[typeName]) {
      const [, name, , repeated] = spec;
      if (state && !state.changed.has(name)) continue;
      if (repeated && repeatedPool.has(name)) {
        for (const value of repeatedPool.get(name).values()) parts.push(encodeField(spec, value));
      } else if (!written.has(name)) {
        for (const value of valuesOf(spec)) parts.push(encodeField(spec, value));
      }
    }

    const encoded = concatBytes(parts);
    return state && bytesEqual(encoded, state.bytes) ? state.bytes : encoded;
  }

  // 未被 schema 建模的字段（保持原始顺序，用于局部改写）。
  function unknownFields(obj) {
    const state = obj[WIRE_STATE];
    if (!state) return NO_FIELDS;
    if (state.unknown) return state.unknown;
    if (!state.fields.length || (1 === state.fields.length && state.fields[0].spec)) return NO_FIELDS;

    let unknown;
    for (const field of state.fields) if (!field.spec) (unknown ??= []).push(field);
    return (state.unknown = unknown ?? NO_FIELDS);
  }

  // 对未建模的字段跑 rewriter，返回 undefined 表示删掉。
  function rewriteUnknownField(obj, fieldNo, rewriter) {
    let updates;
    for (const field of unknownFields(obj)) {
      if (field.no !== fieldNo || 2 !== field.wire) continue;
      const next = rewriter(field.data);
      if (next && bytesEqual(next, field.data)) continue;
      (updates ??= []).push({ field, data: next });
    }
    if (!updates) return false;

    const state = obj[WIRE_STATE];
    for (const { field, data } of updates) {
      if (data) {
        field.data = data;
        field.raw = encodeField([fieldNo, "", "bytes"], data);
      } else {
        state.fields.splice(state.fields.indexOf(field), 1);
      }
    }
    state.unknown = void 0;
    markChanged(state, "");
    return true;
  }

  const SPEC_CACHE = Object.create(null);

  function messageCodec(typeName, eager = EAGER_TYPES.youtubei) {
    return { fromBinary: (bytes) => decodeMessage(typeName, bytes, 0, undefined, undefined, eager), toBinary: (obj) => encodeMessage(typeName, obj) };
  }

  // 深度优先遍历所有对象节点（不看数组内部之外的原始字节）。
  function walkObjects(root, visit) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || "object" != typeof node || ArrayBuffer.isView(node)) continue;
      visit(node);
      stack.push(...Object.values(node));
    }
  }

  //=====================================================================================
  // §8 广告与推广位过滤
  //=====================================================================================

  const ON_THE_GO_KEY = "on-the-go";
  const ON_THE_GO_MENU_PATH = "/youtube/app/player_overflow_menu/menu_item_on_the_go";
  const MENU_ITEM_PATH = [153515154, 172660663, 1, 168777401, 5, 407694004];
  const MENU_ITEM_ROOT = [153515154, 172660663, 1, 168777401];

  // on-the-go 面板的 protobuf 模板，取自一次真实响应的 frameworkUpdates。
  // 它是一棵完整的菜单结构（图标、文案、端点、控制 id），运行时按当前视频替换
  // 里面的文案哈希与 id 后整体注入，所以只能原样内嵌。解码后 33,987 字节。
  const ON_THE_GO_TEMPLATE = [
    "CteBAdqBiO8Fz4EBCj5lbmdhZ2VtZW50X3BhbmVsX2xhcmdlX3BsYXllcl9jb250cm9scy5lbWwtZmV8ZWFhNmUwNWM5MmU2ZWU3",
    "OBKJgQGyx86HBYGBARLzgAEKBAgGEAkKBAgHEAUKBAgKEAgKBAgYEA4KBAgZEAIKBAgfEA4KBAggEA4KBAgoEA4KBAgtEA4KBAgw",
    "EA4KBAgxEA4KBAgyEA4KBAg0EA4KBAg6EA4KBAg/EA4KBAhMEA4KBAhREA4KBAhUEA4KBAhVEA4KBAhZEA4SBAgBGAESiGIIAhgC",
    "IoFiGv5hChEIARINGgsKCQjEyOFMEgIaAAofCAISGxoZChcI65i9UBIQGg4KDAgHEggILTIECgIIAwrHYQgDEsJhWr9hCAESumEa",
    "t2EKEQgBEg0aCwoJCKeU3EsSAhoACoEBCAISfRp7CnkIhIu9UBJyGnAKDAgKEggIMDIECgIIAQoMCAsSCAgxMgQKAggFCgwIDBII",
    "CDIyBAoCCAQKEAgCEgwaCgoICAESBBICCBAKDAgTEggINDIECgIIAQokCAkSIBoeChwIBxIYGhYKFAgBEhASDggEEgIIBBICCAES",
    "AggECp1gCAMSmGBalWAIARK6FiK3Fgq0FgoKUggIARIEEgIIFRKlFhqiFgoRCAESDRoLCgkIp5TcSxICGgAKLQgCEikaJwolCISL",
    "vVASHhocCgwIChIICDAyBAoCCAMKDAgMEggIMjIECgIIBArdFQgDEtgVWtUVCAES0BUazRUKtREIARKwERqtEQqqEQi5lNxLEqIR",
    "Gp8RCpwRCAESlxEalBEKDAgCEggIOjIECgIIAgqzCQgBEq4JIqsJCjwKKFImCAESIkogCAESCAgHMgQKAggAGhJSEAgCEgwSCggG",
    "EgIIARICCDMSEBIOCAYSAggBEgIIMxICCAES6gha5wgIARLiCCLfCArmBwrMBlrJBggCEp0GWpoGCAISgQFafwgCEmBaXggCEiwS",
    "KggBEgIIAxICCAESDhoMCAcyCAoGCKPTn44CEgIIARIKGggIBzIECgIIBhIsEioIARICCAMSAggBEg0aCwgHMgcKBQie2L9GEgII",
    "ARILGgkIBzIFCgMI6gcSGRIXCAESAggHEgYIiJfhpwESAggBEgMIigISkQVajgUIAxLOBFrLBAgDEosEWogECAMSyANaxQMIAxKF",
    "A1qCAwgDEsICWr8CCAMS/wFa/AEIAxK8AVq5AQgDEnpaeAgDEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAESGRIXCAES",
    "AggHEgYIiJfhpwESAggBEgMIpgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIAhIZEhcIARICCAcSBgiIl+GnARICCAES",
    "AwipAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggDEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCKoCEjlaNwgCEhhKFggB",
    "EggIPzIECgIIAxoICD8yBAoCCAQSGRIXCAESAggHEgYIiJfhpwESAggBEgMIswISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIE",
    "CgIIBRIZEhcIARICCAcSBgiIl+GnARICCAESAwi9AhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggGEhkSFwgBEgIIBxIG",
    "CIiX4acBEgIIARIDCL8CEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAcSGRIXCAESAggHEgYIiJfhpwESAggBEgMIxAIS",
    "OVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIICBIZEhcIARICCAcSBgiIl+GnARICCAESAwjFAhI5WjcIAhIYShYIARIICD8y",
    "BAoCCAMaCAg/MgQKAggJEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMYCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAoS",
    "GRIXCAESAggHEgYIiJfhpwESAggBEgMI4QISJVIjCAESH0odCAESCAgHMgQKAggAGg9SDQgCEgkIKDIFCgMIgwMSlAEikQEKjgEK",
    "YFpeCAISLBIqCAESAggDEgIIARIOGgwIBzIICgYIo9OfjgISAggBEgoaCAgHMgQKAggGEiwSKggBEgIIAxICCAESDRoLCAcyBwoF",
    "CJ7Yv0YSAggBEgsaCQgHMgUKAwjqBxIqGigKJggGEiIaIAoeCOoHEhkaFwoVCAESERoPCg0IARIJCCgyBQoDCIMDEnQacgpwCAMS",
    "bBpqChAIAhIMEgoIBhICCAESAggCCiIIAxIeIhwKFAoMEgoIARICCAQSAggLEgQSAggIEgQSAggLCjIIARIuIiwKKgoeUhwIARIY",
    "ShYIARIICAYyBAoCCgAaCAgGMgQKAgoAEggIBjIECgIKAArNBwgDEsgHGsUHCsIHCPmj3EkSugcatwcKtAcIBhKvByKsBwqpBwr+",
    "Blr7BggDEihSJggBEiJKIAgBEggIBzIECgIIABoSUhAIAhIMEgoIBhICCAESAggzEswGWskGCAISnQZamgYIAhKBAVp/CAISYFpe",
    "CAISLBIqCAESAggDEgIIARIOGgwIBzIICgYIo9OfjgISAggBEgoaCAgHMgQKAggGEiwSKggBEgIIAxICCAESDRoLCAcyBwoFCJ7Y",
    "v0YSAggBEgsaCQgHMgUKAwjqBxIZEhcIARICCAcSBgiIl+GnARICCAESAwiKAhKRBVqOBQgDEs4EWssECAMSiwRaiAQIAxLIA1rF",
    "AwgDEoUDWoIDCAMSwgJavwIIAxL/AVr8AQgDErwBWrkBCAMSelp4CAMSOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIARIZ",
    "EhcIARICCAcSBgiIl+GnARICCAESAwimAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggCEhkSFwgBEgIIBxIGCIiX4acB",
    "EgIIARIDCKkCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAMSGRIXCAESAggHEgYIiJfhpwESAggBEgMIqgISOVo3CAIS",
    "GEoWCAESCAg/MgQKAggDGggIPzIECgIIBBIZEhcIARICCAcSBgiIl+GnARICCAESAwizAhI5WjcIAhIYShYIARIICD8yBAoCCAMa",
    "CAg/MgQKAggFEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCL0CEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAYSGRIXCAES",
    "AggHEgYIiJfhpwESAggBEgMIvwISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIBxIZEhcIARICCAcSBgiIl+GnARICCAES",
    "AwjEAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggIEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMUCEjlaNwgCEhhKFggB",
    "EggIPzIECgIIAxoICD8yBAoCCAkSGRIXCAESAggHEgYIiJfhpwESAggBEgMIxgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIE",
    "CgIIChIZEhcIARICCAcSBgiIl+GnARICCAESAwjhAhIlUiMIARIfSh0IARIICAcyBAoCCAAaD1INCAISCQgoMgUKAwiDAxImGiQK",
    "IggBEh4iHAoUCgwSCggBEgIIBBICCAsSBBICCAgSBBICCAsKkgQIAhKNBBqKBApcCISLvVASVRpTChgIAhIUGhIKEAgBEgxSCggF",
    "EgYIBxICCAMKGAgDEhQaEgoQCAESDFIKCAUSBggHEgIIAwoPCA4SCwgZMgcKBQ0AAAAACgwIEBIICDIyBAoCCAIKzQEIuZe9UBLF",
    "ARrCAQq/AQgBEroBIrcBCrQBCgwSCggBEgIIBBICCAsSowEaoAEKnQEI4KqfURKVARqSAQqPAQgBEooBWocBCAESdSJzCnEKLhIs",
    "CAESAggDEgIIARINGgsIBzIHCgUI/5zcexICCAESDRoLCAcyBwoFCJuNpXMSPxo9CjsIm42lcxI0GjIKDAgBEggITDIECgIIAQoQ",
    "CAMSDBIKCAYSAggBEgIIBgoQCAISDBIKCAYSAggBEgIICBIMEgoIBhICCAESAggECj4IlZe9UBI3GjUKMwgGEi8aLQorCNygiloS",
    "JBoiCggIAhIEEgIIAwoMCAMSCAgKMgQKAggACggIARIEEgIICgp9COuYvVASdhp0CkAIBRI8IjoKHgoMEgoIARICCAQSAggLEg5a",
    "DAgBEggIUTIECgIIAhIYWhYIARIICFEyBAoCCAISCAhRMgQKAggHChAIARIMEgoIBhICCAESAggFChAIBBIMEgoIBhICCAESAggR",
    "CgwIBhIICAoyBAoCCAEKGwiWkelQEhQaEgoQCAESDBIKCAYSAggBEgIICBLfFSLcFQrZFQoKUggIARIEEgIIFRLKFRrHFQoRCAES",
    "DRoLCgkIp5TcSxICGgAKLQgCEikaJwolCISLvVASHhocCgwIChIICDAyBAoCCAMKDAgMEggIMjIECgIIBAqCFQgDEv0UWvoUCAES",
    "9RQa8hQK6hAIARLlEBriEArfEAi5lNxLEtcQGtQQCtEQCAESzBAayRAKDAgCEggIOjIECgIIAgqHCQgBEoIJIv8ICjwKKFImCAES",
    "IkogCAESCAgHMgQKAggAGhJSEAgCEgwSCggGEgIIAhICCDMSEBIOCAYSAggCEgIIMxICCAESvghauwgIARK2CCKzCArcBwrHBlrE",
    "BggCEp0GWpoGCAISgQFafwgCEmBaXggCEiwSKggBEgIIAxICCAESDhoMCAcyCAoGCKPTn44CEgIIARIKGggIBzIECgIIBhIsEioI",
    "ARICCAMSAggBEg0aCwgHMgcKBQie2L9GEgIIARILGgkIBzIFCgMI6gcSGRIXCAESAggHEgYIiJfhpwESAggBEgMIigISkQVajgUI",
    "AxLOBFrLBAgDEosEWogECAMSyANaxQMIAxKFA1qCAwgDEsICWr8CCAMS/wFa/AEIAxK8AVq5AQgDEnpaeAgDEjlaNwgCEhhKFggB",
    "EggIPzIECgIIAxoICD8yBAoCCAESGRIXCAESAggHEgYIiJfhpwESAggBEgMIpgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIE",
    "CgIIAhIZEhcIARICCAcSBgiIl+GnARICCAESAwipAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggDEhkSFwgBEgIIBxIG",
    "CIiX4acBEgIIARIDCKoCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAQSGRIXCAESAggHEgYIiJfhpwESAggBEgMIswIS",
    "OVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIBRIZEhcIARICCAcSBgiIl+GnARICCAESAwi9AhI5WjcIAhIYShYIARIICD8y",
    "BAoCCAMaCAg/MgQKAggGEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCL8CEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAcS",
    "GRIXCAESAggHEgYIiJfhpwESAggBEgMIxAISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIICBIZEhcIARICCAcSBgiIl+Gn",
    "ARICCAESAwjFAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggJEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMYCEjlaNwgC",
    "EhhKFggBEggIPzIECgIIAxoICD8yBAoCCAoSGRIXCAESAggHEgYIiJfhpwESAggBEgMI4QISIFIeCAESGkoYCAESCAgHMgQKAggA",
    "GgpSCAgCEgQSAggZEo8BIowBCokBCmBaXggCEiwSKggBEgIIAxICCAESDhoMCAcyCAoGCKPTn44CEgIIARIKGggIBzIECgIIBhIs",
    "EioIARICCAMSAggBEg0aCwgHMgcKBQie2L9GEgIIARILGgkIBzIFCgMI6gcSJRojCiEIBhIdGhsKGQjqBxIUGhIKEAgBEgwaCgoI",
    "CAESBBICCBkSUhpQCk4IAxJKGkgKCAgCEgQSAggYCggIAxIEEgIICAoyCAESLiIsCioKHlIcCAESGEoWCAESCAgGMgQKAgoAGggI",
    "BjIECgIKABIICAYyBAoCCgAKrgcIAxKpBxqmBwqjBwj5o9xJEpsHGpgHCpUHCAYSkAcijQcKigcK+QZa9gYIAxIoUiYIARIiSiAI",
    "ARIICAcyBAoCCAAaElIQCAISDBIKCAYSAggCEgIIMxLHBlrEBggCEp0GWpoGCAISgQFafwgCEmBaXggCEiwSKggBEgIIAxICCAES",
    "DhoMCAcyCAoGCKPTn44CEgIIARIKGggIBzIECgIIBhIsEioIARICCAMSAggBEg0aCwgHMgcKBQie2L9GEgIIARILGgkIBzIFCgMI",
    "6gcSGRIXCAESAggHEgYIiJfhpwESAggBEgMIigISkQVajgUIAxLOBFrLBAgDEosEWogECAMSyANaxQMIAxKFA1qCAwgDEsICWr8C",
    "CAMS/wFa/AEIAxK8AVq5AQgDEnpaeAgDEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAESGRIXCAESAggHEgYIiJfhpwES",
    "AggBEgMIpgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIAhIZEhcIARICCAcSBgiIl+GnARICCAESAwipAhI5WjcIAhIY",
    "ShYIARIICD8yBAoCCAMaCAg/MgQKAggDEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCKoCEjlaNwgCEhhKFggBEggIPzIECgIIAxoI",
    "CD8yBAoCCAQSGRIXCAESAggHEgYIiJfhpwESAggBEgMIswISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIBRIZEhcIARIC",
    "CAcSBgiIl+GnARICCAESAwi9AhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggGEhkSFwgBEgIIBxIGCIiX4acBEgIIARID",
    "CL8CEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAcSGRIXCAESAggHEgYIiJfhpwESAggBEgMIxAISOVo3CAISGEoWCAES",
    "CAg/MgQKAggDGggIPzIECgIICBIZEhcIARICCAcSBgiIl+GnARICCAESAwjFAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQK",
    "AggJEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMYCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAoSGRIXCAESAggHEgYI",
    "iJfhpwESAggBEgMI4QISIFIeCAESGkoYCAESCAgHMgQKAggAGgpSCAgCEgQSAggZEgwaCgoICAESBBICCAgKggQIAhL9Axr6Awpc",
    "CISLvVASVRpTChgIAhIUGhIKEAgBEgxSCggFEgYIBxICCAMKGAgDEhQaEgoQCAESDFIKCAUSBggHEgIIAwoPCA4SCwgZMgcKBQ0A",
    "AAAACgwIEBIICDIyBAoCCAIKyQEIuZe9UBLBARq+AQq7AQgBErYBIrMBCrABCggICjIECgIIARKjARqgAQqdAQjgqp9REpUBGpIB",
    "Co8BCAESigFahwEIARJ1InMKcQouEiwIARICCAMSAggBEg0aCwgHMgcKBQj/nNx7EgIIARINGgsIBzIHCgUIm42lcxI/Gj0KOwib",
    "jaVzEjQaMgoMCAESCAhMMgQKAggBChAIAxIMEgoIBhICCAISAggGChAIAhIMEgoIBhICCAISAggIEgwSCggGEgIIAhICCAQKPgiV",
    "l71QEjcaNQozCAYSLxotCisI3KCKWhIkGiIKCAgCEgQSAggDCgwIAxIICAoyBAoCCAAKCAgBEgQSAggKCnEI65i9UBJqGmgKPAgF",
    "EjgiNgoaCggICjIECgIIARIOWgwIARIICFEyBAoCCAISGFoWCAESCAhRMgQKAggCEggIUTIECgIIBwoICAESBBICCBYKEAgEEgwS",
    "CggGEgIIAhICCBEKDAgGEggICjIECgIIAQobCJaR6VASFBoSChAIARIMEgoIBhICCAISAggIEtIHGs8HChEIARINGgsKCQinlNxL",
    "EgIaAApfCAISWxpZClcIhIu9UBJQGk4KDAgKEggIMDIECgIIAwoMCAwSCAgyMgQKAggECgwICxIICDEyBAoCCAMKEAgDEgwaCgoI",
    "CAESBBICCBIKEAgCEgwaCgoICAESBBICCBIK2AYIAxLTBlrQBggBEtcDItQDCtEDCgQSAggHEsgDGsUDChEIARINGgsKCQinlNxL",
    "EgIaAAqvAwgCEqoDGqcDCjsIhIu9UBI0GjIKDAgREggIVDIECgIIAgoQCAMSDBoKCggIARIEEgIIDgoQCAISDBoKCggIARIEEgII",
    "DgrnAgiVl71QEt8CGtwCCggIBRIEEgIIDwrPAggBEsoCIscCCrABChpKGAgBEgoIVRIGCAQSAggGGggIVTIECgIIAhKRASKOAQpE",
    "CihSJggBEiJKIAgBEggIBzIECgIIABoSUhAIAhIMEgoIBBICCAcSAghsEhgSFggEEgIIBxICCGwSChoICAcyBAoCCC8SRiJECjQK",
    "JFIiCAESHkocCAESCAgHMgQKAggAGg5SDAgCEggSBggEEgIIBxIMEgoIBBICCAcSAggvEgwSCggEEgIIARICCDcSkQEijgEKRAoo",
    "UiYIARIiSiAIARIICAcyBAoCCAAaElIQCAISDBIKCAQSAggHEgIIbBIYEhYIBBICCAcSAghsEgoaCAgHMgQKAggqEkYiRAo0CiRS",
    "IggBEh5KHAgBEggIBzIECgIIABoOUgwIAhIIEgYIBBICCAcSDBIKCAQSAggHEgIIKhIMEgoIBBICCAESAghJEvECGu4CCrABCAES",
    "qwEaqAEKpQEIoLrkpQESnAEamQEKEAgDEgwSCggBEgIIBBICCAcKKwgEEicaJQojCNaV6VASHBoaChgImtiVnAESEBoOCgwIARII",
    "CFkyBAoCCAEKKwgFEicaJQojCNaV6VASHBoaChgImtiVnAESEBoOCgwIARIICFkyBAoCCAIKKwgGEicaJQojCNaV6VASHBoaChgI",
    "mtiVnAESEBoOCgwIARIICFkyBAoCCAcKuAEIAhKzARqwAQotCISLvVASJhokChAIAxIMGgoKCAgBEgQSAggMChAIAhIMGgoKCAgB",
    "EgQSAggMCj4IlZe9UBI3GjUKMwgGEi8aLQorCNygiloSJBoiCgwIAxIICAoyBAoCCAAKCAgCEgQSAggNCggIARIEEgIICgo/COuY",
    "vVASOBo2ChIIBRIOWgwIARIICFEyBAoCCAIKDAgGEggICjIECgIIAQoICAESBBICCBMKCAgEEgQSAggUEt8VItwVCtkVCgpSCAgB",
    "EgQSAggVEsoVGscVChEIARINGgsKCQinlNxLEgIaAAotCAISKRonCiUIhIu9UBIeGhwKDAgKEggIMDIECgIIAwoMCAwSCAgyMgQK",
    "AggECoIVCAMS/RRa+hQIARL1FBryFArqEAgBEuUQGuIQCt8QCLmU3EsS1xAa1BAK0RAIARLMEBrJEAoMCAISCAg6MgQKAggCCocJ",
    "CAESggki/wgKPAooUiYIARIiSiAIARIICAcyBAoCCAAaElIQCAISDBIKCAYSAggDEgIIMxIQEg4IBhICCAMSAggzEgIIARK+CFq7",
    "CAgBErYIIrMICtwHCscGWsQGCAISnQZamgYIAhKBAVp/CAISYFpeCAISLBIqCAESAggDEgIIARIOGgwIBzIICgYIo9OfjgISAggB",
    "EgoaCAgHMgQKAggGEiwSKggBEgIIAxICCAESDRoLCAcyBwoFCJ7Yv0YSAggBEgsaCQgHMgUKAwjqBxIZEhcIARICCAcSBgiIl+Gn",
    "ARICCAESAwiKAhKRBVqOBQgDEs4EWssECAMSiwRaiAQIAxLIA1rFAwgDEoUDWoIDCAMSwgJavwIIAxL/AVr8AQgDErwBWrkBCAMS",
    "elp4CAMSOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIARIZEhcIARICCAcSBgiIl+GnARICCAESAwimAhI5WjcIAhIYShYI",
    "ARIICD8yBAoCCAMaCAg/MgQKAggCEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCKkCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8y",
    "BAoCCAMSGRIXCAESAggHEgYIiJfhpwESAggBEgMIqgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIBBIZEhcIARICCAcS",
    "BgiIl+GnARICCAESAwizAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggFEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCL0C",
    "EjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAYSGRIXCAESAggHEgYIiJfhpwESAggBEgMIvwISOVo3CAISGEoWCAESCAg/",
    "MgQKAggDGggIPzIECgIIBxIZEhcIARICCAcSBgiIl+GnARICCAESAwjEAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggI",
    "EhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMUCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAkSGRIXCAESAggHEgYIiJfh",
    "pwESAggBEgMIxgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIChIZEhcIARICCAcSBgiIl+GnARICCAESAwjhAhIgUh4I",
    "ARIaShgIARIICAcyBAoCCAAaClIICAISBBICCBsSjwEijAEKiQEKYFpeCAISLBIqCAESAggDEgIIARIOGgwIBzIICgYIo9OfjgIS",
    "AggBEgoaCAgHMgQKAggGEiwSKggBEgIIAxICCAESDRoLCAcyBwoFCJ7Yv0YSAggBEgsaCQgHMgUKAwjqBxIlGiMKIQgGEh0aGwoZ",
    "COoHEhQaEgoQCAESDBoKCggIARIEEgIIGxJSGlAKTggDEkoaSAoICAISBBICCBoKCAgDEgQSAggICjIIARIuIiwKKgoeUhwIARIY",
    "ShYIARIICAYyBAoCCgAaCAgGMgQKAgoAEggIBjIECgIKAAquBwgDEqkHGqYHCqMHCPmj3EkSmwcamAcKlQcIBhKQByKNBwqKBwr5",
    "Blr2BggDEihSJggBEiJKIAgBEggIBzIECgIIABoSUhAIAhIMEgoIBhICCAMSAggzEscGWsQGCAISnQZamgYIAhKBAVp/CAISYFpe",
    "CAISLBIqCAESAggDEgIIARIOGgwIBzIICgYIo9OfjgISAggBEgoaCAgHMgQKAggGEiwSKggBEgIIAxICCAESDRoLCAcyBwoFCJ7Y",
    "v0YSAggBEgsaCQgHMgUKAwjqBxIZEhcIARICCAcSBgiIl+GnARICCAESAwiKAhKRBVqOBQgDEs4EWssECAMSiwRaiAQIAxLIA1rF",
    "AwgDEoUDWoIDCAMSwgJavwIIAxL/AVr8AQgDErwBWrkBCAMSelp4CAMSOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIARIZ",
    "EhcIARICCAcSBgiIl+GnARICCAESAwimAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggCEhkSFwgBEgIIBxIGCIiX4acB",
    "EgIIARIDCKkCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAMSGRIXCAESAggHEgYIiJfhpwESAggBEgMIqgISOVo3CAIS",
    "GEoWCAESCAg/MgQKAggDGggIPzIECgIIBBIZEhcIARICCAcSBgiIl+GnARICCAESAwizAhI5WjcIAhIYShYIARIICD8yBAoCCAMa",
    "CAg/MgQKAggFEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCL0CEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAYSGRIXCAES",
    "AggHEgYIiJfhpwESAggBEgMIvwISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIBxIZEhcIARICCAcSBgiIl+GnARICCAES",
    "AwjEAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggIEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMUCEjlaNwgCEhhKFggB",
    "EggIPzIECgIIAxoICD8yBAoCCAkSGRIXCAESAggHEgYIiJfhpwESAggBEgMIxgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIE",
    "CgIIChIZEhcIARICCAcSBgiIl+GnARICCAESAwjhAhIgUh4IARIaShgIARIICAcyBAoCCAAaClIICAISBBICCBsSDBoKCggIARIE",
    "EgIICAqCBAgCEv0DGvoDClwIhIu9UBJVGlMKGAgCEhQaEgoQCAESDFIKCAUSBggHEgIIAwoYCAMSFBoSChAIARIMUgoIBRIGCAcS",
    "AggDCg8IDhILCBkyBwoFDQAAAAAKDAgQEggIMjIECgIIAgrJAQi5l71QEsEBGr4BCrsBCAEStgEiswEKsAEKCAgKMgQKAggBEqMB",
    "GqABCp0BCOCqn1ESlQEakgEKjwEIARKKAVqHAQgBEnUicwpxCi4SLAgBEgIIAxICCAESDRoLCAcyBwoFCP+c3HsSAggBEg0aCwgH",
    "MgcKBQibjaVzEj8aPQo7CJuNpXMSNBoyCgwIARIICEwyBAoCCAEKEAgDEgwSCggGEgIIAxICCAYKEAgCEgwSCggGEgIIAxICCAgS",
    "DBIKCAYSAggDEgIIBAo+CJWXvVASNxo1CjMIBhIvGi0KKwjcoIpaEiQaIgoICAISBBICCAMKDAgDEggICjIECgIIAAoICAESBBIC",
    "CAoKcQjrmL1QEmoaaAo8CAUSOCI2ChoKCAgKMgQKAggBEg5aDAgBEggIUTIECgIIAhIYWhYIARIICFEyBAoCCAISCAhRMgQKAggH",
    "CggIARIEEgIIFwoQCAQSDBIKCAYSAggDEgIIEQoMCAYSCAgKMgQKAggBChsIlpHpUBIUGhIKEAgBEgwSCggGEgIIAxICCAgSuhYi",
    "txYKtBYKClIICAESBBICCBUSpRYaohYKEQgBEg0aCwoJCKeU3EsSAhoACi0IAhIpGicKJQiEi71QEh4aHAoMCAoSCAgwMgQKAggD",
    "CgwIDBIICDIyBAoCCAQK3RUIAxLYFVrVFQgBEtAVGs0VCrURCAESsBEarREKqhEIuZTcSxKiERqfEQqcEQgBEpcRGpQRCgwIAhII",
    "CDoyBAoCCAIKswkIARKuCSKrCQo8CihSJggBEiJKIAgBEggIBzIECgIIABoSUhAIAhIMEgoIBhICCAQSAggzEhASDggGEgIIBBIC",
    "CDMSAggBEuoIWucICAES4ggi3wgK5gcKzAZayQYIAhKdBlqaBggCEoEBWn8IAhJgWl4IAhIsEioIARICCAMSAggBEg4aDAgHMggK",
    "Bgij05+OAhICCAESChoICAcyBAoCCAYSLBIqCAESAggDEgIIARINGgsIBzIHCgUInti/RhICCAESCxoJCAcyBQoDCOoHEhkSFwgB",
    "EgIIBxIGCIiX4acBEgIIARIDCIoCEpEFWo4FCAMSzgRaywQIAxKLBFqIBAgDEsgDWsUDCAMShQNaggMIAxLCAlq/AggDEv8BWvwB",
    "CAMSvAFauQEIAxJ6WngIAxI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggBEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCKYC",
    "EjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAISGRIXCAESAggHEgYIiJfhpwESAggBEgMIqQISOVo3CAISGEoWCAESCAg/",
    "MgQKAggDGggIPzIECgIIAxIZEhcIARICCAcSBgiIl+GnARICCAESAwiqAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggE",
    "EhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCLMCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAUSGRIXCAESAggHEgYIiJfh",
    "pwESAggBEgMIvQISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIBhIZEhcIARICCAcSBgiIl+GnARICCAESAwi/AhI5WjcI",
    "AhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggHEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMQCEjlaNwgCEhhKFggBEggIPzIECgII",
    "AxoICD8yBAoCCAgSGRIXCAESAggHEgYIiJfhpwESAggBEgMIxQISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIICRIZEhcI",
    "ARICCAcSBgiIl+GnARICCAESAwjGAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggKEhkSFwgBEgIIBxIGCIiX4acBEgII",
    "ARIDCOECEiVSIwgBEh9KHQgBEggIBzIECgIIABoPUg0IAhIJCCgyBQoDCPMCEpQBIpEBCo4BCmBaXggCEiwSKggBEgIIAxICCAES",
    "DhoMCAcyCAoGCKPTn44CEgIIARIKGggIBzIECgIIBhIsEioIARICCAMSAggBEg0aCwgHMgcKBQie2L9GEgIIARILGgkIBzIFCgMI",
    "6gcSKhooCiYIBhIiGiAKHgjqBxIZGhcKFQgBEhEaDwoNCAESCQgoMgUKAwjzAhJ0GnIKcAgDEmwaagoQCAISDBIKCAYSAggEEgII",
    "AgoiCAMSHiIcChQKDBIKCAESAggEEgIIChIEEgIICBIEEgIICwoyCAESLiIsCioKHlIcCAESGEoWCAESCAgGMgQKAgoAGggIBjIE",
    "CgIKABIICAYyBAoCCgAKzQcIAxLIBxrFBwrCBwj5o9xJEroHGrcHCrQHCAYSrwcirAcKqQcK/gZa+wYIAxIoUiYIARIiSiAIARII",
    "CAcyBAoCCAAaElIQCAISDBIKCAYSAggEEgIIMxLMBlrJBggCEp0GWpoGCAISgQFafwgCEmBaXggCEiwSKggBEgIIAxICCAESDhoM",
    "CAcyCAoGCKPTn44CEgIIARIKGggIBzIECgIIBhIsEioIARICCAMSAggBEg0aCwgHMgcKBQie2L9GEgIIARILGgkIBzIFCgMI6gcS",
    "GRIXCAESAggHEgYIiJfhpwESAggBEgMIigISkQVajgUIAxLOBFrLBAgDEosEWogECAMSyANaxQMIAxKFA1qCAwgDEsICWr8CCAMS",
    "/wFa/AEIAxK8AVq5AQgDEnpaeAgDEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAESGRIXCAESAggHEgYIiJfhpwESAggB",
    "EgMIpgISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIAhIZEhcIARICCAcSBgiIl+GnARICCAESAwipAhI5WjcIAhIYShYI",
    "ARIICD8yBAoCCAMaCAg/MgQKAggDEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCKoCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8y",
    "BAoCCAQSGRIXCAESAggHEgYIiJfhpwESAggBEgMIswISOVo3CAISGEoWCAESCAg/MgQKAggDGggIPzIECgIIBRIZEhcIARICCAcS",
    "BgiIl+GnARICCAESAwi9AhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggGEhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCL8C",
    "EjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAcSGRIXCAESAggHEgYIiJfhpwESAggBEgMIxAISOVo3CAISGEoWCAESCAg/",
    "MgQKAggDGggIPzIECgIICBIZEhcIARICCAcSBgiIl+GnARICCAESAwjFAhI5WjcIAhIYShYIARIICD8yBAoCCAMaCAg/MgQKAggJ",
    "EhkSFwgBEgIIBxIGCIiX4acBEgIIARIDCMYCEjlaNwgCEhhKFggBEggIPzIECgIIAxoICD8yBAoCCAoSGRIXCAESAggHEgYIiJfh",
    "pwESAggBEgMI4QISJVIjCAESH0odCAESCAgHMgQKAggAGg9SDQgCEgkIKDIFCgMI8wISJhokCiIIARIeIhwKFAoMEgoIARICCAQS",
    "AggKEgQSAggIEgQSAggLCpIECAISjQQaigQKXAiEi71QElUaUwoYCAISFBoSChAIARIMUgoIBRIGCAcSAggDChgIAxIUGhIKEAgB",
    "EgxSCggFEgYIBxICCAMKDwgOEgsIGTIHCgUNAAAAAAoMCBASCAgyMgQKAggCCs0BCLmXvVASxQEawgEKvwEIARK6ASK3AQq0AQoM",
    "EgoIARICCAQSAggKEqMBGqABCp0BCOCqn1ESlQEakgEKjwEIARKKAVqHAQgBEnUicwpxCi4SLAgBEgIIAxICCAESDRoLCAcyBwoF",
    "CP+c3HsSAggBEg0aCwgHMgcKBQibjaVzEj8aPQo7CJuNpXMSNBoyCgwIARIICEwyBAoCCAEKEAgDEgwSCggGEgIIBBICCAYKEAgC",
    "EgwSCggGEgIIBBICCAgSDBIKCAYSAggEEgIIBAo+CJWXvVASNxo1CjMIBhIvGi0KKwjcoIpaEiQaIgoICAISBBICCAMKDAgDEggI",
    "CjIECgIIAAoICAESBBICCAoKfQjrmL1QEnYadApACAUSPCI6Ch4KDBIKCAESAggEEgIIChIOWgwIARIICFEyBAoCCAISGFoWCAES",
    "CAhRMgQKAggCEggIUTIECgIIBwoQCAESDBIKCAYSAggEEgIIBQoQCAQSDBIKCAYSAggEEgIIEQoMCAYSCAgKMgQKAggBChsIlpHp",
    "UBIUGhIKEAgBEgwSCggGEgIIBBICCAgSEAgDEAcYBCIICAcyBAoCCCQSVAgEGAQiTiJMCkAKLFIqCAESJkokCAESCAgHMgQKAggA",
    "GhZSFAgCEhASDggBEgIIBxIGCMul76cBEhASDggBEgIIBxIGCMul76cBEggSBggBEgIIAhIsCAUQChgEIiRSIggBEh5KHAgBEggI",
    "BzIECgIIABoOUgwIAhIIEgYIBBICCAkSnAIIBhgEIpUCIpICCoUCCiRSIggBEh5KHAgBEggIBzIECgIIABoOUgwIAhIIEgYIARIC",
    "CAUS3AEa2QEKIwgBEh9SHQgEEhkSFwgBEgIIBRIDCJkSEgIIARIGCP/C7NsBCiMIAhIfUh0IBBIZEhcIARICCAUSAwiZEhICCAIS",
    "Bgj/wuzbAQojCAMSH1IdCAQSGRIXCAESAggFEgMImRISAggDEgYI/8Ls2wEKIwgEEh9SHQgEEhkSFwgBEgIIBRIDCJkSEgIIBBIG",
    "CP/C7NsBChUIBRIREg8IARICCAUSAwiZEhICCAUKFQgGEhESDwgBEgIIBRIDCJkSEgIIBgoVCAcSERIPCAESAggFEgMImRISAggH",
    "EggSBggBEgIIARIsCAcQChgEIiRSIggBEh5KHAgBEggIBzIECgIIABoOUgwIAhIIEgYIARICCAUSmAEICBgEIpEBIo4BCkQKKFIm",
    "CAESIkogCAESCAgHMgQKAggAGhJSEAgCEgwSCggEEgIIBxICCGwSGBIWCAQSAggHEgIIbBIKGggIBzIECgIIRhJGIkQKNAokUiII",
    "ARIeShwIARIICAcyBAoCCAAaDlIMCAISCBIGCAQSAggHEgwSCggEEgIIBxICCEYSDBIKCAQSAggBEgIITxIrCAkQChgEIiNKIQgB",
    "EhMIGBIPCAESAggHEgMI7wcSAggBGggIGDIECgIIHRKnAQgKGAQioAEinQEKmgEKBBICCAkSkQEijgEKRAooUiYIARIiSiAIARII",
    "CAcyBAoCCAAaElIQCAISDBIKCAQSAggHEgIIbBIYEhYIBBICCAcSAghsEgoaCAgHMgQKAggBEkYiRAo0CiRSIggBEh5KHAgBEggI",
    "BzIECgIIABoOUgwIAhIIEgYIBBICCAcSDBIKCAQSAggHEgIIARIMEgoIBBICCAESAghWEhIICxgEIgwSCggEEgIIARICCA4SkgEI",
    "DBAZGAQiiQEihgEKEwoEEgIIBxILCBkyBwoFDQAAMEISbyJtCl4KBBICCAUSViJUCkQKKFImCAESIkogCAESCAgHMgQKAggAGhJS",
    "EAgCEgwSCggEEgIICRICCCYSGBIWCAQSAggJEgIIJhIKGggIBzIECgIIAhIMEgoIBBICCAkSAggCEgsIGTIHCgUNAABgQhImCA0Q",
    "BxgEIh4iHAoQCgQSAggHEggIBzIECgIIJBIICAcyBAoCCCwSEwgOEBkYBCILCBkyBwoFDQAAkEISEwgPEBkYBCILCBkyBwoFDQAA",
    "EEISEwgQEBkYBCILCBkyBwoFDQAAtEISHwgREAoYBCIXEhUIARICCAcSAwj+BxICCB8SBAjp0x0SJAgSEBkYBCIcIhoKGAoQWg4I",
    "AhIEEgIIERIEEgIIBxIEEgIIDhLHAQgTEAYYBCK+ASK7AQoqCh5KHAgBEg4IHxIKCAESAggEEgIIBxoICB8yBAoCCAISCBIGCAYS",
    "AggGCioKHkocCAESDggfEgoIARICCAQSAggHGggIHzIECgIIAxIIEgYIBhICCAUKKgoeShwIARIOCB8SCggBEgIIBBICCAcaCAgf",
    "MgQKAggHEggSBggGEgIIBQoqCh5KHAgBEg4IHxIKCAESAggEEgIIBxoICB8yBAoCCAYSCBIGCAYSAggHEgkIBjIFCgMKASASMggU",
    "EAYYBCIqCAYyJgokCiJpZC5wbGF5ZXJfY29udHJvbHMucGxheWJhY2suYnV0dG9uEhQIFRAKGAQiDBIKCAESAggEEgIIHhJSCBYQ",
    "BhgEIkoiSAo4CihSJggBEiJKIAgBEggIBzIECgIIABoSUhAIAhIMEgoIARICCAQSAggREgwSCggBEgIIBBICCBESDBIKCAYSAggC",
    "EgIIBRJSCBcQBhgEIkoiSAo4CihSJggBEiJKIAgBEggIBzIECgIIABoSUhAIAhIMEgoIARICCAQSAggSEgwSCggBEgIIBBICCBIS",
    "DBIKCAYSAggDEgIIBRL0AggYEAYYBCLrAiLoAgrWAgooUiYIARIiSiAIARIICAcyBAoCCAAaElIQCAISDBIKCAESAggEEgIIDxKp",
    "AiKmAgovCh5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoCCAESDRILCAQSAggDEgMI2AMKLwoeShwIARIOCCASCggBEgIIBBIC",
    "CA8aCAggMgQKAggCEg0SCwgEEgIIAxIDCJcBCi8KHkocCAESDgggEgoIARICCAQSAggPGggIIDIECgIIAxINEgsIBBICCAMSAwjZ",
    "AwovCh5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoCCAQSDRILCAQSAggDEgMI2gMKLwoeShwIARIOCCASCggBEgIIBBICCA8a",
    "CAggMgQKAggFEg0SCwgEEgIIAxIDCNsDCi8KHkocCAESDgggEgoIARICCAQSAggPGggIIDIECgIIBhINEgsIBBICCAMSAwjcAxIN",
    "EgsIBBICCAMSAwiXARLHBQgZECgYBCK+BSK7BQr8BAooUiYIARIiSiAIARIICAcyBAoCCAAaElIQCAISDBIKCAESAggEEgIIDxLP",
    "BCLMBApgCh5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoCCAESPiI8CjoKLRIrCAESAggDEgIIARIOGgwIBzIICgYIi5fg4wIS",
    "AggBEgsaCQgHMgUKAwipAxIJCCgyBQoDCKkDCmAKHkocCAESDgggEgoIARICCAQSAggPGggIIDIECgIIAhI+IjwKOgotEisIARIC",
    "CAMSAggBEg4aDAgHMggKBgiLl+DjAhICCAESCxoJCAcyBQoDCKEDEgkIKDIFCgMIoQMKYAoeShwIARIOCCASCggBEgIIBBICCA8a",
    "CAggMgQKAggDEj4iPAo6Ci0SKwgBEgIIAxICCAESDhoMCAcyCAoGCIuX4OMCEgIIARILGgkIBzIFCgMIowMSCQgoMgUKAwijAwpg",
    "Ch5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoCCAQSPiI8CjoKLRIrCAESAggDEgIIARIOGgwIBzIICgYIi5fg4wISAggBEgsa",
    "CQgHMgUKAwilAxIJCCgyBQoDCKUDCmAKHkocCAESDgggEgoIARICCAQSAggPGggIIDIECgIIBRI+IjwKOgotEisIARICCAMSAggB",
    "Eg4aDAgHMggKBgiLl+DjAhICCAESCxoJCAcyBQoDCKcDEgkIKDIFCgMIpwMKYAoeShwIARIOCCASCggBEgIIBBICCA8aCAggMgQK",
    "AggGEj4iPAo6Ci0SKwgBEgIIAxICCAESDhoMCAcyCAoGCIuX4OMCEgIIARILGgkIBzIFCgMIqwMSCQgoMgUKAwirAwo6Ci0SKwgB",
    "EgIIAxICCAESDhoMCAcyCAoGCIuX4OMCEgIIARILGgkIBzIFCgMIoQMSCQgoMgUKAwihAxL0AggaEAYYBCLrAiLoAgrWAgooUiYI",
    "ARIiSiAIARIICAcyBAoCCAAaElIQCAISDBIKCAESAggEEgIIDxKpAiKmAgovCh5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoC",
    "CAESDRILCAQSAggDEgMI3QMKLwoeShwIARIOCCASCggBEgIIBBICCA8aCAggMgQKAggCEg0SCwgEEgIIAxIDCJgBCi8KHkocCAES",
    "DgggEgoIARICCAQSAggPGggIIDIECgIIAxINEgsIBBICCAMSAwjeAwovCh5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoCCAQS",
    "DRILCAQSAggDEgMI3wMKLwoeShwIARIOCCASCggBEgIIBBICCA8aCAggMgQKAggFEg0SCwgEEgIIAxIDCOADCi8KHkocCAESDggg",
    "EgoIARICCAQSAggPGggIIDIECgIIBhINEgsIBBICCAMSAwjhAxINEgsIBBICCAMSAwiYARLHBQgbECgYBCK+BSK7BQr8BAooUiYI",
    "ARIiSiAIARIICAcyBAoCCAAaElIQCAISDBIKCAESAggEEgIIDxLPBCLMBApgCh5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoC",
    "CAESPiI8CjoKLRIrCAESAggDEgIIARIOGgwIBzIICgYIi5fg4wISAggBEgsaCQgHMgUKAwiqAxIJCCgyBQoDCKoDCmAKHkocCAES",
    "DgggEgoIARICCAQSAggPGggIIDIECgIIAhI+IjwKOgotEisIARICCAMSAggBEg4aDAgHMggKBgiLl+DjAhICCAESCxoJCAcyBQoD",
    "CKIDEgkIKDIFCgMIogMKYAoeShwIARIOCCASCggBEgIIBBICCA8aCAggMgQKAggDEj4iPAo6Ci0SKwgBEgIIAxICCAESDhoMCAcy",
    "CAoGCIuX4OMCEgIIARILGgkIBzIFCgMIpAMSCQgoMgUKAwikAwpgCh5KHAgBEg4IIBIKCAESAggEEgIIDxoICCAyBAoCCAQSPiI8",
    "CjoKLRIrCAESAggDEgIIARIOGgwIBzIICgYIi5fg4wISAggBEgsaCQgHMgUKAwimAxIJCCgyBQoDCKYDCmAKHkocCAESDgggEgoI",
    "ARICCAQSAggPGggIIDIECgIIBRI+IjwKOgotEisIARICCAMSAggBEg4aDAgHMggKBgiLl+DjAhICCAESCxoJCAcyBQoDCKgDEgkI",
    "KDIFCgMIqAMKYAoeShwIARIOCCASCggBEgIIBBICCA8aCAggMgQKAggGEj4iPAo6Ci0SKwgBEgIIAxICCAESDhoMCAcyCAoGCIuX",
    "4OMCEgIIARILGgkIBzIFCgMIrAMSCQgoMgUKAwisAwo6Ci0SKwgBEgIIAxICCAESDhoMCAcyCAoGCIuX4OMCEgIIARILGgkIBzIF",
    "CgMIogMSCQgoMgUKAwiiAxifia7Q8M+r8T4wAQrkhwHagYjvBdyHAQoqb25fdGhlX2dvX2NvbnRyb2xzLmVtbC1mZXxmODdjOGVj",
    "ZGIxNTRkYWRkErWFAbLHzocFrYUBEp6FAQoECAYQCQoECAsQCwoECBAQDgoECBEQCAoECBIQDgoECBQQDgoECBgQBQoECB0QDgoE",
    "CB8QAgoECCUQDQoECCoQDgoECCsQDgoECDAQCwoECDEQDgoFCDIQ6gcKBAhGEA4KBAhHEA4KBAhJEA4KBAhKEA4KBAhOEA4KBAhV",
    "EA4KBAhpEA4KBQiBARAOCgUIggEQDgoFCIkBEA4KBQiMARAOCgUIkQEQDhIECAEYARKUZggCGAIijWYaimYKEQgBEg0aCwoJCMTI",
    "4UwSAhoACjQIAhIwGi4KEwi5l71QEgwaCgoICAMSBBICCEMKFwjrmL1QEhAaDgoMCAYSCAgRMgQKAggACr5lCAMSuWVatmUIARKx",
    "ZRquZQoRCAESDRoLCgkIp5TcSxICGgAKigEIAhKFARqCAQpnCISLvVASYBpeCgwIChIICEYyBAoCCAMKDAgLEggIRzIECgIIBApA",
    "CAISPBo6CjgIARI0IjIKKgoiWiAIAhIWWhQIAhIEEgIIBxIKUggIARIEEgIICRIEEgIIDxIEEgIIGRIEEgIIFwoXCOuYvVASEBoO",
    "CgwIBhIICBEyBAoCCAAKi2QIAxKGZFqDZAgBEpoeGpceChEIARINGgsKCQinlNxLEgIaAAplCAISYRpfCl0IhIu9UBJWGlQKDAgK",
    "EggIRjIECgIIAwoPCA0SCwgfMgcKBQ0AAABACgwIDBIICEkyBAoCCAQKJQgDEiEaHwoPCAESCwgfMgcKBQ0AAIA/CgwIAhIICEoy",
    "BAoCCAIKmh0IAxKVHVqSHQgBEo0dGoodChEIARINGgsKCQinlNxLEgIaAAqcAQgCEpcBGpQBCpEBCISLvVASiQEahgEKDAgKEggI",
    "RjIECgIIAwoMCAwSCAhJMgQKAggECkEICRI9GjsKOQgBEjUaMwoxCAESLSIrChwKBBICCAoSFBISCAESAggEEgIIBBICCAESAggD",
    "EgsIHzIHCgUNAAAAAAolCAMSIRofCg8IARILCB8yBwoFDQAAYD8KDAgCEggISjIECgIIAgrVGwgDEtAbWs0bCAESlQIikgIKjwIK",
    "MFouCAISJFIiCAESHkocCAESCAgYMgQKAggAGg5SDAgCEggSBggDEgIIBRIEEgIILxLaARrXAQpdCAESWRpXClUIuZTcSxJOGkwK",
    "SggBEkYaRAoQCAESDBIKCAMSAggFEgIIAQoMCAISCAhOMgQKAggDCiIIAxIeGhwKGgj5o9xJEhMaEQoPCAMSCwgfMgcKBQ0AACBB",
    "CnYIAhJyGnAKbgiEi71QEmcaZQoeCAMSGhoYCggIARIEEgIILAoMCAISCAhKMgQKAggCCggIEhIEEgIIIQooCAgSJBoiCiAIARIc",
    "GhoKGAgBEhQSEggBEgIIBBICCAQSAggBEgIIBAoPCA4SCwgfMgcKBQ0AAAAAEp4IGpsICs0HCAESyAcaxQcKwgcI3JTcSxK6Bxq3",
    "BwqQBwgBEosHYogHEvsGGvgGCgwIAxIIEgYIARICCAYKEQgCEg0SCwgBEgIIAxIDCO8HChEIARINEgsIARICCAMSAwjyBwoICAcS",
    "BBICCDAKDAgIEggIVTIECgIIQQoMCAkSCBIGCAESAggECoUGCAQSgAYa/QUKEAgBEgwSCggDEgIIARICCAEKEAgFEgwSCggDEgII",
    "ARICCAUK1gUIBhLRBSLOBQrLBQorEikIARICCAYSAggBEg0aCwgYMgcKBQjP77R7EgIIARIKGggIGDIECgIIChKbBVqYBQgBErQC",
    "YrECEqMCGqACChEIARINEgsIARICCAMSAwjyBwoRCAISDRILCAESAggDEgMI7wcKDAgDEggSBggBEgIIBgoICAQSBBICCDAKDAgG",
    "EggIVTIECgIIQQoMCAcSCBIGCAESAggECsMBCAUSvgEauwEKqgEIBRKlASKiAQpMCixSKggBEiZKJAgBEggIGDIECgIIABoWUhQI",
    "AhIQEg4IARICCAQSAggHEgIIbBIcEhoIARICCAQSAggHEgIIbBIKGggIGDIECgIIRhJSIlAKPAooUiYIARIiSiAIARIICBgyBAoC",
    "CAAaElIQCAISDBIKCAESAggEEgIIBxIQEg4IARICCAQSAggHEgIIRhIQEg4IARICCAQSAggBEgIITwoMCAESCAglMgQKAggAKJaa",
    "kduv9ezy3AES3AIq2QIISBIMEgoIAxICCAESAggFGsICYr8CErECGq4CChEIARINEgsIARICCAMSAwjyBwoRCAISDRILCAESAggD",
    "EgMI7wcKDAgDEggSBggBEgIIBgoICAQSBBICCDAKDAgGEggIVTIECgIIQQoMCAcSCBIGCAESAggECtEBCAUSzAEayQEKDAgBEggS",
    "BghIEgIIAQoMCAISCBIGCEgSAggCCqoBCAUSpQEiogEKTAosUioIARImSiQIARIICBgyBAoCCAAaFlIUCAISEBIOCAESAggEEgII",
    "BxICCGwSHBIaCAESAggEEgIIBxICCGwSChoICBgyBAoCCAYSUiJQCjwKKFImCAESIkogCAESCAgYMgQKAggAGhJSEAgCEgwSCggB",
    "EgIIBBICCAcSEBIOCAESAggEEgIIBxICCAYSEBIOCAESAggEEgIIARICCDgolpqR26/17PLcASBJKEoKFAgFEhAaDgoMCAMSCAhp",
    "MgQKAggFKMqn+8eRyseEOQoiCAISHiIcChAKBBICCAoSCAglMgQKAggDEggIJTIECgIIAQpJCAISRRpDCkEIhIu9UBI6GjgKKAgI",
    "EiQaIgogCAESHBoaChgIARIUEhIIARICCAQSAggEEgIIARICCAMKDAgQEggISTIECgIIAhK8Axq5AwrrAggBEuYCGuMCCuACCNyU",
    "3EsS2AIa1QIKxAIIARK/AmK8AhKuAhqrAgoRCAESDRILCAESAggDEgMI8gcKEQgCEg0SCwgBEgIIAxIDCO8HCgwIAxIIEgYIARIC",
    "CAYKDAgEEggSBggDEgIIAgqqAQgFEqUBIqIBCkwKLFIqCAESJkokCAESCAgYMgQKAggAGhZSFAgCEhASDggBEgIIBBICCAcSAghs",
    "EhwSGggBEgIIBBICCAcSAghsEgoaCAgYMgQKAghIElIiUAo8CihSJggBEiJKIAgBEggIGDIECgIIABoSUhAIAhIMEgoIARICCAQS",
    "AggHEhASDggBEgIIBBICCAcSAghIEhASDggBEgIIBBICCAESAghOCggIBxIEEgIIMQoMCAgSCAhVMgQKAggZCgwICRIIEgYIARIC",
    "CAQKFAgGEhAaDgoMCAMSCAhpMgQKAggFKNiMkrnOnfLviQEKDAgCEggIJTIECgIIAQpJCAISRRpDCkEIhIu9UBI6GjgKKAgIEiQa",
    "IgogCAESHBoaChgIARIUEhIIARICCAQSAggEEgIIARICCAEKDAgQEggISTIECgIIAhLQDSLNDQrKDQoQWg4IAxIEEgIIGxIEEgII",
    "HBK1DRqyDQoRCAESDRoLCgkIp5TcSxICGgAKcAgCEmwaagpoCISLvVASYRpfCgwIChIICEYyBAoCCAEKDAgQEggISTIECgIIBApB",
    "CAgSPRo7CjkIARI1GjMKMQgBEi0iKwoTCgQSAggaEgsIHzIHCgUNAAAAABIUEhIIARICCAQSAggEEgIIARICCAMKqgwIAxKlDFqi",
    "DAgBEo0GIooGCocGCgQSAggbEv4FGvsFCssFCAESxgUawwUKwAUIua29UBK4BRq1BQo8CAMSOBo2CjQIspmEUhItGisKKQgBEiUI",
    "BjIhCh8KHWJhZGdlLmVtbC1mZXw1MjkxY2ZlYWJjZTM4YjJmCi0IBRIpGicKJQjH9N1cEh4aHAoMCAcSCBIGCAMSAggPCgwIBBII",
    "EgYIARICCAMKxQQIBhLABBq9BAqrAgj3wvBZEqMCGqACCg8IAhILCBgyBwoFCMf03VwKjAIIARKHAjqEAgqIASKFAQqCAQooSiYI",
    "BhIYCBhSFAgDEhASDggBEgIIAxIGCMe0vuABGggIGDIECgIIABJWGlQKFAgBEhASDggBEgIIAxIGCMe0vuABCh4IAxIaOhgKCAgY",
    "MgQKAggECgwIGDIICgYIy6XvpwEKDQgEEgkIgQEyBAoCCAEKDQgGEgkIggEyBAoCCAEKdyJ1CnMKKEomCAYSGAgYUhQIAxIQEg4I",
    "ARICCAMSBgjC4q72ARoICBgyBAoCCAASRxpFChQIARIQEg4IARICCAMSBgjC4q72AQoMCAISCAgYMgQKAggFChAIAxIMOgoKCAgY",
    "MgQKAggFCg0IBhIJCIIBMgQKAggCCo8BCJX+m7gBEoYBGoMBCg8IAhILCBgyBwoFCMf03VwKcAgBEmw6agpoImYKZAooSiYIBhIY",
    "CBhSFAgDEhASDggBEgIIAxIGCMe0vuABGggIGDIECgIIABI4GjYKFAgBEhASDggBEgIIAxIGCMe0vuABCh4IAhIaOhgKCAgYMgQK",
    "AggECgwIGDIICgYIy6XvpwEKewiW/pu4ARJzGnEKDwgCEgsIGDIHCgUIx/TdXApeCAESWiJYClYKKEomCAYSGAgYUhQIAxIQEg4I",
    "ARICCAMSBgjC4q72ARoICBgyBAoCCAASKhooChQIARIQEg4IARICCAMSBgjC4q72AQoQCAISDDoKCggIGDIECgIIBQorCAISJxol",
    "CiMIhIu9UBIcGhoKGAgJEhQaEgoQCAcSDBoKCggIARIEEgIIHRKNBiKKBgqHBgoEEgIIHBL+BRr7BQrLBQgBEsYFGsMFCsAFCLmt",
    "vVASuAUatQUKPAgDEjgaNgo0CLKZhFISLRorCikIARIlCAYyIQofCh1iYWRnZS5lbWwtZmV8NTI5MWNmZWFiY2UzOGIyZgotCAUS",
    "KRonCiUIx/TdXBIeGhwKDAgHEggSBggDEgIIEAoMCAQSCBIGCAESAggDCsUECAYSwAQavQQKqwII98LwWRKjAhqgAgoPCAISCwgY",
    "MgcKBQjH9N1cCowCCAEShwI6hAIKiAEihQEKggEKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjHtL7gARoICBgyBAoCCAASVhpU",
    "ChQIARIQEg4IARICCAMSBgjHtL7gAQoeCAMSGjoYCggIGDIECgIIBAoMCBgyCAoGCMul76cBCg0IBBIJCIEBMgQKAggBCg0IBhIJ",
    "CIIBMgQKAggBCncidQpzCihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIwuKu9gEaCAgYMgQKAggAEkcaRQoUCAESEBIOCAESAggD",
    "EgYIwuKu9gEKDAgCEggIGDIECgIIBQoQCAMSDDoKCggIGDIECgIIBQoNCAYSCQiCATIECgIIAgqPAQiV/pu4ARKGARqDAQoPCAIS",
    "CwgYMgcKBQjH9N1cCnAIARJsOmoKaCJmCmQKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjHtL7gARoICBgyBAoCCAASOBo2ChQI",
    "ARIQEg4IARICCAMSBgjHtL7gAQoeCAISGjoYCggIGDIECgIIBAoMCBgyCAoGCMul76cBCnsIlv6buAEScxpxCg8IAhILCBgyBwoF",
    "CMf03VwKXggBEloiWApWCihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIwuKu9gEaCAgYMgQKAggAEioaKAoUCAESEBIOCAESAggD",
    "EgYIwuKu9gEKEAgCEgw6CgoICBgyBAoCCAUKKwgCEicaJQojCISLvVASHBoaChgICRIUGhIKEAgHEgwaCgoICAESBBICCB0Sjg4i",
    "iw4KiA4KBBICCBAS/w0a/A0KEQgBEg0aCwoJCKeU3EsSAhoACiIIAhIeGhwKGgiEi71QEhMaEQoPCA0SCwgfMgcKBQ0AAIA/CsIN",
    "CAMSvQ1aug0IARKZAxqWAwoRCAESDRoLCgkIp5TcSxICGgAKygEIAhLFARrCAQqmAQiEi71QEp4BGpsBCgwIChIICEYyBAoCCAMK",
    "DAgMEggISTIECgIIBAolCAMSIRofCg8IARILCB8yBwoFDQAAgD8KDAgCEggISjIECgIIAgoQCAISDBoKCggIARIEEgIIEwpECAkS",
    "QBo+CjwIARI4GjYKNAgBEjAiLgosCiRSIggBEh5KHAgBEggIGDIECgIIABoOUgwIAhIIEgYIAxICCAgSBBICCBIKFwjrmL1QEhAa",
    "DgoMCAYSCAgRMgQKAggACrMBCAMSrgFaqwEIARKmARqjAQpVCAESURpPCk0InKzQ+AESRRpDCkEIARI9IjsKOQosEioIARICCAYS",
    "AggBEg4aDAgYMggKBgjijtGxAhICCAESChoICBgyBAoCCAESCQiJATIECgIIAQpKCAISRhpECkIIhIu9UBI7GjkKEAgCEgwaCgoI",
    "CAESBBICCBEKJQgDEiEaHwoPCAESCwgfMgcKBQ0AAIA/CgwIAhIICEoyBAoCCAISmQoilgoKkwoKJFIiCAESHkocCAESCAgYMgQK",
    "AggAGg5SDAgCEggSBggDEgIICBLqCRrnCQrVBwgBEtAHGs0HCsoHCLmtvVASwgcavwcKSQgDEkUaQwpBCLKZhFISOho4CjYIARIy",
    "CAYyLgosCip2aWRlb19hY3Rpb25fYnV0dG9uLmVtbC1mZXxhOTZlY2NiNjc4NmVhMzMKeggFEnYadApyCLr3oK0BEmoaaAoUCAUS",
    "EBoOCgwIEBIIEgYIAxICCAgKDAgBEggSBggBEgIIBAo0CAcSMAgGMiwKKgoob25fdGhlX2dvX2NvbnRyb2xzX2VuYWJsZW1lbnRf",
    "ZW50aXR5X2tleQoMCAsSCBIGCAESAggDCvUFCAYS8AUa7QUK2QMI98LwWRLRAxrOAwoQCAISDAgYMggKBgi696CtAQq5AwgBErQD",
    "OrEDCqoBIqcBCqQBCkhKRggGEjgIGFI0CAMSMAgGMiwKKgoob25fdGhlX2dvX2NvbnRyb2xzX2VuYWJsZW1lbnRfZW50aXR5X2tl",
    "eRoICBgyBAoCCAASWBpWCjQIARIwCAYyLAoqCihvbl90aGVfZ29fY29udHJvbHNfZW5hYmxlbWVudF9lbnRpdHlfa2V5CgwIAhII",
    "CBgyBAoCCAYKEAgDEgw6CgoICBgyBAoCCAYKdyJ1CnMKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjC4q72ARoICBgyBAoCCAAS",
    "RxpFChQIARIQEg4IARICCAMSBgjC4q72AQoMCAISCAgYMgQKAggIChAIAxIMOgoKCAgYMgQKAggICg0IBhIJCIIBMgQKAggCCogB",
    "IoUBCoIBCihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIx7S+4AEaCAgYMgQKAggAElYaVAoUCAESEBIOCAESAggDEgYIx7S+4AEK",
    "HggDEho6GAoICBgyBAoCCAsKDAgYMggKBgjLpe+nAQoNCAQSCQiBATIECgIIAQoNCAYSCQiCATIECgIIAQqQAQiV/pu4ARKHARqE",
    "AQoQCAISDAgYMggKBgi696CtAQpwCAESbDpqCmgiZgpkCihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIx7S+4AEaCAgYMgQKAggA",
    "EjgaNgoUCAESEBIOCAESAggDEgYIx7S+4AEKHggCEho6GAoICBgyBAoCCAsKDAgYMggKBgjLpe+nAQp8CJb+m7gBEnQacgoQCAIS",
    "DAgYMggKBgi696CtAQpeCAESWiJYClYKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjC4q72ARoICBgyBAoCCAASKhooChQIARIQ",
    "Eg4IARICCAMSBgjC4q72AQoQCAISDDoKCggIGDIECgIICAorCAQSJwgGMiMKIQofY2hhcHRlcl92aWRlb19hY3Rpb25fYnV0dG9u",
    "X2tleQrfAQgCEtoBGtcBCnYIhIu9UBJvGm0KEAgDEgwaCgoICAESBBICCB4KEAgCEgwaCgoICAESBBICCB4KDQgREgkIjAEyBAoC",
    "CAIKOAgBEjQaMgoXCAESExoRCg8IARILCB8yBwoFDQAAAAAKFwgEEhMaEQoPCAESCwgfMgcKBQ0AAAAACl0IlZe9UBJWGlQKUggG",
    "Ek4aTApKCJCs3JIBEkIaQAo0CAESMFIuCAESKkooCAESCAgYMgQKAggAGhpSGAgCEhQSEggDEgIICBIGCP/C7NsBEgIIBAoICAMS",
    "BBICCCASqAgapQgK5QcIARLgBxrdBwraBwi5rb1QEtIHGs8HCl0IAxJZGlcKVQiymYRSEk4aTApKCAESRggGMkIKQAo+ZW5nYWdl",
    "bWVudF9wYW5lbF9sYXJnZV9wbGF5ZXJfY29udHJvbHMuZW1sLWZlfGVhYTZlMDVjOTJlNmVlNzgKjwEIBRKKARqHAQqEAQjIj6n1",
    "ARJ8GnoKDAgFEggSBggDEgIIAwoMCAISCBIGCAESAggECjwIAxI4IjYKNAooSiYIARIYCBhSFAgDEhASDggBEgIIAxIGCMLirvYB",
    "GggIGDIECgIIABIIEgYIARICCAYKEAgEEgwSCggBEgYI/93C4AEKDAgHEggSBggBEgIIAwrbBQgGEtYFGtMFCr8DCPfC8FkStwMa",
    "tAMKEAgCEgwIGDIICgYIyI+p9QEKnwMIARKaAzqXAwp3InUKcwooSiYIBhIYCBhSFAgDEhASDggBEgIIAxIGCMLirvYBGggIGDIE",
    "CgIIABJHGkUKFAgBEhASDggBEgIIAxIGCMLirvYBCgwIAhIICBgyBAoCCAMKEAgDEgw6CgoICBgyBAoCCAMKDQgGEgkIggEyBAoC",
    "CAIKkAEijQEKigEKO0o5CAYSKwgYUicIAxIjCAYyHwodChsveW91dHViZS9hcHAvcGxheWVyX292ZXJsYXkaCAgYMgQKAggAEksa",
    "SQonCAESIwgGMh8KHQobL3lvdXR1YmUvYXBwL3BsYXllcl9vdmVybGF5CgwIAhIICBgyBAoCCAQKEAgDEgw6CgoICBgyBAoCCAQK",
    "iAEihQEKggEKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjHtL7gARoICBgyBAoCCAASVhpUChQIARIQEg4IARICCAMSBgjHtL7g",
    "AQoeCAMSGjoYCggIGDIECgIIBwoMCBgyCAoGCMul76cBCg0IBBIJCIEBMgQKAggBCg0IBhIJCIIBMgQKAggBCpABCJX+m7gBEocB",
    "GoQBChAIAhIMCBgyCAoGCMiPqfUBCnAIARJsOmoKaCJmCmQKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjHtL7gARoICBgyBAoC",
    "CAASOBo2ChQIARIQEg4IARICCAMSBgjHtL7gAQoeCAISGjoYCggIGDIECgIIBwoMCBgyCAoGCMul76cBCnwIlv6buAESdBpyChAI",
    "AhIMCBgyCAoGCMiPqfUBCl4IARJaIlgKVgooSiYIBhIYCBhSFAgDEhASDggBEgIIAxIGCMLirvYBGggIGDIECgIIABIqGigKFAgB",
    "EhASDggBEgIIAxIGCMLirvYBChAIAhIMOgoKCAgYMgQKAggDCjsIAhI3GjUKGgiEi71QEhMaEQoPCA0SCwgfMgcKBQ0AAIA/ChcI",
    "lZe9UBIQGg4KDAgHEggIETIECgIIABKlLxqiLwoRCAESDRoLCgkIp5TcSxICGgAKlwEIAhKSARqPAQp0CISLvVASbRprCgwIChII",
    "CEYyBAoCCAEKDAgLEggIRzIECgIIBQoMCAwSCAhJMgQKAggCCg0IExIJCJEBMgQKAggBCg8IDRILCB8yBwoFDQAAgD4KHwgJEhsa",
    "GQoXCAcSExoRCg8IARILCB8yBwoFDQAAwEEKFwjrmL1QEhAaDgoMCAYSCAgRMgQKAggACvItCAMS7S1a6i0IARKZByKWBwqTBwok",
    "UiIIARIeShwIARIICBgyBAoCCAAaDlIMCAISCBIGCAMSAggNEuoGGucGChEIARINGgsKCQinlNxLEgIaAApVCAISURpPCk0IhIu9",
    "UBJGGkQKEAgEEgwaCgoICAESBBICCEYKEAgDEgwaCgoICAESBBICCB8KEAgCEgwaCgoICAESBBICCB8KDAgMEggISTIECgIIBAr6",
    "BQgDEvUFWvIFCAES7QUa6gUK5wUIARLiBRrfBQrcBQi5rb1QEtQFGtEFCkYIAxJCGkAKPgiymYRSEjcaNQozCAESLwgGMisKKQon",
    "ZG93bmxvYWRfYnV0dG9uLmVtbC1mZXwxMzUyNjFhZDcwMjU4NDM5CjwIBRI4GjYKNAjEosiCARIsGioKDAgKEggSBggDEgIIDQoM",
    "CAMSCBIGCAESAggECgwIBhIIEgYIARICCAMKyAQIBhLDBBrABAqsAgj3wvBZEqQCGqECChAIAhIMCBgyCAoGCMSiyIIBCowCCAES",
    "hwI6hAIKiAEihQEKggEKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjHtL7gARoICBgyBAoCCAASVhpUChQIARIQEg4IARICCAMS",
    "BgjHtL7gAQoeCAMSGjoYCggIGDIECgIIBgoMCBgyCAoGCMul76cBCg0IBBIJCIEBMgQKAggBCg0IBhIJCIIBMgQKAggBCncidQpz",
    "CihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIwuKu9gEaCAgYMgQKAggAEkcaRQoUCAESEBIOCAESAggDEgYIwuKu9gEKDAgCEggI",
    "GDIECgIICQoQCAMSDDoKCggIGDIECgIICQoNCAYSCQiCATIECgIIAgqQAQiV/pu4ARKHARqEAQoQCAISDAgYMggKBgjEosiCAQpw",
    "CAESbDpqCmgiZgpkCihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIx7S+4AEaCAgYMgQKAggAEjgaNgoUCAESEBIOCAESAggDEgYI",
    "x7S+4AEKHggCEho6GAoICBgyBAoCCAYKDAgYMggKBgjLpe+nAQp8CJb+m7gBEnQacgoQCAISDAgYMggKBgjEosiCAQpeCAESWiJY",
    "ClYKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjC4q72ARoICBgyBAoCCAASKhooChQIARIQEg4IARICCAMSBgjC4q72AQoQCAIS",
    "DDoKCggIGDIECgIICRKvCRqsCQrRBwgBEswHGskHCsYHCLmtvVASvgcauwcKSQgDEkUaQwpBCLKZhFISOho4CjYIARIyCAYyLgos",
    "Cip2aWRlb19hY3Rpb25fYnV0dG9uLmVtbC1mZXxhOTZlY2NiNjc4NmVhMzMKdggFEnIacApuCLr3oK0BEmYaZAoQCAUSDBoKCggI",
    "EBIEEgIIQgo0CAcSMAgGMiwKKgoob25fdGhlX2dvX2NvbnRyb2xzX2VuYWJsZW1lbnRfZW50aXR5X2tleQoMCAESCBIGCAESAggE",
    "CgwICxIIEgYIARICCAMK9QUIBhLwBRrtBQrZAwj3wvBZEtEDGs4DChAIAhIMCBgyCAoGCLr3oK0BCrkDCAEStAM6sQMKqgEipwEK",
    "pAEKSEpGCAYSOAgYUjQIAxIwCAYyLAoqCihvbl90aGVfZ29fY29udHJvbHNfZW5hYmxlbWVudF9lbnRpdHlfa2V5GggIGDIECgII",
    "ABJYGlYKNAgBEjAIBjIsCioKKG9uX3RoZV9nb19jb250cm9sc19lbmFibGVtZW50X2VudGl0eV9rZXkKDAgCEggIGDIECgIIBgoQ",
    "CAMSDDoKCggIGDIECgIIBgp3InUKcwooSiYIBhIYCBhSFAgDEhASDggBEgIIAxIGCMLirvYBGggIGDIECgIIABJHGkUKFAgBEhAS",
    "DggBEgIIAxIGCMLirvYBCgwIAhIICBgyBAoCCAgKEAgDEgw6CgoICBgyBAoCCAgKDQgGEgkIggEyBAoCCAIKiAEihQEKggEKKEom",
    "CAYSGAgYUhQIAxIQEg4IARICCAMSBgjHtL7gARoICBgyBAoCCAASVhpUChQIARIQEg4IARICCAMSBgjHtL7gAQoeCAMSGjoYCggI",
    "GDIECgIICwoMCBgyCAoGCMul76cBCg0IBBIJCIEBMgQKAggBCg0IBhIJCIIBMgQKAggBCpABCJX+m7gBEocBGoQBChAIAhIMCBgy",
    "CAoGCLr3oK0BCnAIARJsOmoKaCJmCmQKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjHtL7gARoICBgyBAoCCAASOBo2ChQIARIQ",
    "Eg4IARICCAMSBgjHtL7gAQoeCAISGjoYCggIGDIECgIICwoMCBgyCAoGCMul76cBCnwIlv6buAESdBpyChAIAhIMCBgyCAoGCLr3",
    "oK0BCl4IARJaIlgKVgooSiYIBhIYCBhSFAgDEhASDggBEgIIAxIGCMLirvYBGggIGDIECgIIABIqGigKFAgBEhASDggBEgIIAxIG",
    "CMLirvYBChAIAhIMOgoKCAgYMgQKAggICjUIBBIxCAYyLQorCilhdWRpb190b2dnbGVfb25seV92aWRlb19hY3Rpb25fYnV0dG9u",
    "X2tleQqeAQgCEpkBGpYBCkkIhIu9UBJCGkAKCAgOEgQSAghFChAIBBIMGgoKCAgBEgQSAghGChAIAxIMGgoKCAgBEgQSAghHChAI",
    "AhIMGgoKCAgBEgQSAggeCkkIlZe9UBJCGkAKPggGEjoaOAo2CJCs3JIBEi4aLAogCAESHFoaCAISClIICAESBBICCDYSClIICAES",
    "BBICCDcKCAgDEgQSAgggEugJIuUJCuIJCiRSIggBEh5KHAgBEggIGDIECgIIABoOUgwIAhIIEgYIAxICCBMSuQkatgkK1QcIARLQ",
    "BxrNBwrKBwi5rb1QEsIHGr8HCkkIAxJFGkMKQQiymYRSEjoaOAo2CAESMggGMi4KLAoqdmlkZW9fYWN0aW9uX2J1dHRvbi5lbWwt",
    "ZmV8YTk2ZWNjYjY3ODZlYTMzCnoIBRJ2GnQKcgi696CtARJqGmgKFAgFEhAaDgoMCBASCBIGCAMSAggTCgwIARIIEgYIARICCAQK",
    "NAgHEjAIBjIsCioKKG9uX3RoZV9nb19jb250cm9sc19lbmFibGVtZW50X2VudGl0eV9rZXkKDAgLEggSBggBEgIIAwr1BQgGEvAF",
    "Gu0FCtkDCPfC8FkS0QMazgMKEAgCEgwIGDIICgYIuvegrQEKuQMIARK0AzqxAwqqASKnAQqkAQpISkYIBhI4CBhSNAgDEjAIBjIs",
    "CioKKG9uX3RoZV9nb19jb250cm9sc19lbmFibGVtZW50X2VudGl0eV9rZXkaCAgYMgQKAggAElgaVgo0CAESMAgGMiwKKgoob25f",
    "dGhlX2dvX2NvbnRyb2xzX2VuYWJsZW1lbnRfZW50aXR5X2tleQoMCAISCAgYMgQKAggGChAIAxIMOgoKCAgYMgQKAggGCncidQpz",
    "CihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIwuKu9gEaCAgYMgQKAggAEkcaRQoUCAESEBIOCAESAggDEgYIwuKu9gEKDAgCEggI",
    "GDIECgIICAoQCAMSDDoKCggIGDIECgIICAoNCAYSCQiCATIECgIIAgqIASKFAQqCAQooSiYIBhIYCBhSFAgDEhASDggBEgIIAxIG",
    "CMe0vuABGggIGDIECgIIABJWGlQKFAgBEhASDggBEgIIAxIGCMe0vuABCh4IAxIaOhgKCAgYMgQKAggLCgwIGDIICgYIy6XvpwEK",
    "DQgEEgkIgQEyBAoCCAEKDQgGEgkIggEyBAoCCAEKkAEIlf6buAEShwEahAEKEAgCEgwIGDIICgYIuvegrQEKcAgBEmw6agpoImYK",
    "ZAooSiYIBhIYCBhSFAgDEhASDggBEgIIAxIGCMe0vuABGggIGDIECgIIABI4GjYKFAgBEhASDggBEgIIAxIGCMe0vuABCh4IAhIa",
    "OhgKCAgYMgQKAggLCgwIGDIICgYIy6XvpwEKfAiW/pu4ARJ0GnIKEAgCEgwIGDIICgYIuvegrQEKXggBEloiWApWCihKJggGEhgI",
    "GFIUCAMSEBIOCAESAggDEgYIwuKu9gEaCAgYMgQKAggAEioaKAoUCAESEBIOCAESAggDEgYIwuKu9gEKEAgCEgw6CgoICBgyBAoC",
    "CAgKJwgEEiMIBjIfCh0KG2Fza192aWRlb19hY3Rpb25fYnV0dG9uX2tleQqyAQgCEq0BGqoBCkkIhIu9UBJCGkAKCAgOEgQSAghF",
    "ChAIBBIMGgoKCAgBEgQSAghGChAIAxIMGgoKCAgBEgQSAghHChAIAhIMGgoKCAgBEgQSAggeCl0IlZe9UBJWGlQKUggGEk4aTApK",
    "CJCs3JIBEkIaQAo0CAESMFIuCAESKkooCAESCAgYMgQKAggAGhpSGAgCEhQSEggDEgIIExIGCP/C7NsBEgIIBAoICAMSBBICCCAS",
    "7gki6wkK6AkKJFIiCAESHkocCAESCAgYMgQKAggAGg5SDAgCEggSBggDEgIICRK/CRq8CQrVBwgBEtAHGs0HCsoHCLmtvVASwgca",
    "vwcKSQgDEkUaQwpBCLKZhFISOho4CjYIARIyCAYyLgosCip2aWRlb19hY3Rpb25fYnV0dG9uLmVtbC1mZXxhOTZlY2NiNjc4NmVh",
    "MzMKeggFEnYadApyCLr3oK0BEmoaaAoUCAUSEBoOCgwIEBIIEgYIAxICCAkKDAgBEggSBggBEgIIBAo0CAcSMAgGMiwKKgoob25f",
    "dGhlX2dvX2NvbnRyb2xzX2VuYWJsZW1lbnRfZW50aXR5X2tleQoMCAsSCBIGCAESAggDCvUFCAYS8AUa7QUK2QMI98LwWRLRAxrO",
    "AwoQCAISDAgYMggKBgi696CtAQq5AwgBErQDOrEDCqoBIqcBCqQBCkhKRggGEjgIGFI0CAMSMAgGMiwKKgoob25fdGhlX2dvX2Nv",
    "bnRyb2xzX2VuYWJsZW1lbnRfZW50aXR5X2tleRoICBgyBAoCCAASWBpWCjQIARIwCAYyLAoqCihvbl90aGVfZ29fY29udHJvbHNf",
    "ZW5hYmxlbWVudF9lbnRpdHlfa2V5CgwIAhIICBgyBAoCCAYKEAgDEgw6CgoICBgyBAoCCAYKdyJ1CnMKKEomCAYSGAgYUhQIAxIQ",
    "Eg4IARICCAMSBgjC4q72ARoICBgyBAoCCAASRxpFChQIARIQEg4IARICCAMSBgjC4q72AQoMCAISCAgYMgQKAggIChAIAxIMOgoK",
    "CAgYMgQKAggICg0IBhIJCIIBMgQKAggCCogBIoUBCoIBCihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIx7S+4AEaCAgYMgQKAggA",
    "ElYaVAoUCAESEBIOCAESAggDEgYIx7S+4AEKHggDEho6GAoICBgyBAoCCAsKDAgYMggKBgjLpe+nAQoNCAQSCQiBATIECgIIAQoN",
    "CAYSCQiCATIECgIIAQqQAQiV/pu4ARKHARqEAQoQCAISDAgYMggKBgi696CtAQpwCAESbDpqCmgiZgpkCihKJggGEhgIGFIUCAMS",
    "EBIOCAESAggDEgYIx7S+4AEaCAgYMgQKAggAEjgaNgoUCAESEBIOCAESAggDEgYIx7S+4AEKHggCEho6GAoICBgyBAoCCAsKDAgY",
    "MggKBgjLpe+nAQp8CJb+m7gBEnQacgoQCAISDAgYMggKBgi696CtAQpeCAESWiJYClYKKEomCAYSGAgYUhQIAxIQEg4IARICCAMS",
    "BgjC4q72ARoICBgyBAoCCAASKhooChQIARIQEg4IARICCAMSBgjC4q72AQoQCAISDDoKCggIGDIECgIICAotCAQSKQgGMiUKIwoh",
    "dmFyaXNwZWVkX3ZpZGVvX2FjdGlvbl9idXR0b25fa2V5CrIBCAISrQEaqgEKSQiEi71QEkIaQAoICA4SBBICCEUKEAgEEgwaCgoI",
    "CAESBBICCEYKEAgDEgwaCgoICAESBBICCEcKEAgCEgwaCgoICAESBBICCB4KXQiVl71QElYaVApSCAYSThpMCkoIkKzckgESQhpA",
    "CjQIARIwUi4IARIqSigIARIICBgyBAoCCAAaGlIYCAISFBISCAMSAggJEgYI/8Ls2wESAggECggIAxIEEgIIIBK7CRq4CQrVBwgB",
    "EtAHGs0HCsoHCLmtvVASwgcavwcKSQgDEkUaQwpBCLKZhFISOho4CjYIARIyCAYyLgosCip2aWRlb19hY3Rpb25fYnV0dG9uLmVt",
    "bC1mZXxhOTZlY2NiNjc4NmVhMzMKeggFEnYadApyCLr3oK0BEmoaaAoUCAUSEBoOCgwIEBIIEgYIAxICCAcKDAgBEggSBggBEgII",
    "BAo0CAcSMAgGMiwKKgoob25fdGhlX2dvX2NvbnRyb2xzX2VuYWJsZW1lbnRfZW50aXR5X2tleQoMCAsSCBIGCAESAggDCvUFCAYS",
    "8AUa7QUK2QMI98LwWRLRAxrOAwoQCAISDAgYMggKBgi696CtAQq5AwgBErQDOrEDCqoBIqcBCqQBCkhKRggGEjgIGFI0CAMSMAgG",
    "MiwKKgoob25fdGhlX2dvX2NvbnRyb2xzX2VuYWJsZW1lbnRfZW50aXR5X2tleRoICBgyBAoCCAASWBpWCjQIARIwCAYyLAoqCihv",
    "bl90aGVfZ29fY29udHJvbHNfZW5hYmxlbWVudF9lbnRpdHlfa2V5CgwIAhIICBgyBAoCCAYKEAgDEgw6CgoICBgyBAoCCAYKdyJ1",
    "CnMKKEomCAYSGAgYUhQIAxIQEg4IARICCAMSBgjC4q72ARoICBgyBAoCCAASRxpFChQIARIQEg4IARICCAMSBgjC4q72AQoMCAIS",
    "CAgYMgQKAggIChAIAxIMOgoKCAgYMgQKAggICg0IBhIJCIIBMgQKAggCCogBIoUBCoIBCihKJggGEhgIGFIUCAMSEBIOCAESAggD",
    "EgYIx7S+4AEaCAgYMgQKAggAElYaVAoUCAESEBIOCAESAggDEgYIx7S+4AEKHggDEho6GAoICBgyBAoCCAsKDAgYMggKBgjLpe+n",
    "AQoNCAQSCQiBATIECgIIAQoNCAYSCQiCATIECgIIAQqQAQiV/pu4ARKHARqEAQoQCAISDAgYMggKBgi696CtAQpwCAESbDpqCmgi",
    "ZgpkCihKJggGEhgIGFIUCAMSEBIOCAESAggDEgYIx7S+4AEaCAgYMgQKAggAEjgaNgoUCAESEBIOCAESAggDEgYIx7S+4AEKHggC",
    "Eho6GAoICBgyBAoCCAsKDAgYMggKBgjLpe+nAQp8CJb+m7gBEnQacgoQCAISDAgYMggKBgi696CtAQpeCAESWiJYClYKKEomCAYS",
    "GAgYUhQIAxIQEg4IARICCAMSBgjC4q72ARoICBgyBAoCCAASKhooChQIARIQEg4IARICCAMSBgjC4q72AQoQCAISDDoKCggIGDIE",
    "CgIICAopCAQSJQgGMiEKHwodcXVldWVfdmlkZW9fYWN0aW9uX2J1dHRvbl9rZXkKsgEIAhKtARqqAQpJCISLvVASQhpACggIDhIE",
    "EgIIRQoQCAQSDBoKCggIARIEEgIIRgoQCAMSDBoKCggIARIEEgIIRwoQCAISDBoKCggIARIEEgIIHgpdCJWXvVASVhpUClIIBhJO",
    "GkwKSgiQrNySARJCGkAKNAgBEjBSLggBEipKKAgBEggIGDIECgIIABoaUhgIAhIUEhIIAxICCAcSBgj/wuzbARICCAQKCAgDEgQS",
    "AgggEhMIAxgEIg0SCwgBEgIIARIDCJUSEjkIBBAGGAQiMQgGMi0KKwopL3lvdXR1YmUvYXBwL29uX3RoZV9nb19tZW51X3RyaWdn",
    "ZXJfc3RhdGUSNwgFEAYYBCIvCAYyKwopCicveW91dHViZS9hcHAvb25fdGhlX2dvX2F1ZGlvX29ubHlfc3RhdGUSQAgGEAsYBCI4",
    "GjYKNAjWlelQEi0aKwopCLXhn48BEiEaHwodCAISGRoXChUIAxIRCAYyDQoLCglvbi10aGUtZ28SJggHEBEYBCIeShwIARIOCBAS",
    "CggBEgIIBRICCAUaCAgQMgQKAggAEiYICBARGAQiHkocCAESDggQEgoIARICCAUSAggFGggIEDIECgIIARImCAkQERgEIh5KHAgB",
    "Eg4IEhIKCAESAggFEgIIBhoICBIyBAoCCAESVAgKEBEYBCJMWkoIAxIiSiAIARISCBQSDggBEgIIBRICCAMSAggBGggIFDIECgII",
    "AxIiSiAIARISCBQSDggBEgIIBRICCAMSAggBGggIFDIECgIIBBJUCAsQERgEIkxaSggDEiJKIAgBEhIIFBIOCAESAggFEgIIAxIC",
    "CAEaCAgUMgQKAggBEiJKIAgBEhIIFBIOCAESAggFEgIIAxICCAEaCAgUMgQKAggCEhgIDBARGAQiEFoOCAISBBICCAsSBBICCAgS",
    "ZwgNEBEYBCJfIl0KUQorEikIARICCAYSAggBEg0aCwgYMgcKBQjd5bR7EgIIARIKGggIGDIECgIIChIiSiAIARISCB0SDggBEgII",
    "BRICCAoSAggDGggIHTIECgIIAxIICBEyBAoCCAASGAgOEB8YBCIQEg4IARICCAUSAggEEgIIAhIyCA8QERgEIipKKAgEEhIIHxIO",
    "CAESBgj+3cLgARICCAEaEBIOCAESBgj+3cLgARICCAMSNwgQEBEYBCIvEi0IARICCAYSAggBEg0aCwgYMgcKBQjdrbJ1EgIIARIO",
    "GgwIGDIICgYInKzQ+AESEwgREB8YBCILCB8yBwoFDQAANEISEwgSEB8YBCILCB8yBwoFDQAAcEESWwgTEB8YBCJTIlEKSQokUiII",
    "ARIeShwIARIICBgyBAoCCAAaDlIMCAISCBIGCAMSAggIEiEIH1odCAQSDQgGMgkKBwoFYSBiICsSBBICCBESBBICCBISBBICCBES",
    "LAgUEB8YBCIkIiIKEwoEEgIICRILCB8yBwoFDQAASEMSCwgfMgcKBQ0AAIJDEhMIFRAfGAQiCwgfMgcKBQ0AAFBAEkgIFhAfGAQi",
    "QAgfWjwIBBIPCAYyCwoJCgdhIGIgbWF4EiEIH1odCAQSDQgGMgkKBwoFYSBiIC8SBBICCA4SBBICCBUSBBICCBQSNwgXEB8YBCIv",
    "CB9aKwgEEg8IBjILCgkKB2EgYiBtYXgSEBIOCAESBgj+3cLgARICCAESBBICCBYSEwgYEB8YBCILCB8yBwoFDQAAcEISygEIGRAf",
    "GAQiwQEIH1q8AQgEEg8IBjILCgkKB2EgYiBtYXgSoAEIH1qbAQgEEg0IBjIJCgcKBWEgYiAtEoEBCB9afQgEEg0IBjIJCgcKBWEg",
    "YiAtEhASDggBEgIIBRICCAQSAggCElgIH1pUCAQSDQgGMgkKBwoFYSBiICoSLwgfWisIBBINCAYyCQoHCgVhIGIgLxILCB8yBwoF",
    "DQAAEEESCwgfMgcKBQ0AAIBBEhASDggBEgIIBRICCAQSAggBEgQSAggYEgQSAggUEiYIGhARGAQiHkocCAQSEggfEg4IARIGCP7d",
    "wuABEgIIARoEEgIIFBJECBsQERgEIjxaOggCEhASDggBEgYI/93C4AESAggWEiRSIggBEh5KHAgBEggIGDIECgIIABoOUgwIAhII",
    "EgYIAxICCA8SRAgcEBEYBCI8WjoIAhIQEg4IARIGCP/dwuABEgIIGBIkUiIIARIeShwIARIICBgyBAoCCAAaDlIMCAISCBIGCAMS",
    "AggQEhwIHRAfGAQiFBISCAESAggEEgIIBBICCAESAggBEhMIHhAfGAQiCwgfMgcKBQ0AAChCEhMIHxAfGAQiCwgfMgcKBQ0AAIhC",
    "EhAIIBAlGAQiCAglMgQKAggVEhMIIRAfGAQiCwgfMgcKBQ2BleM/Eh8IIhARGAQiFxIVCAESAggDEgMI/gcSAggfEgQIk4seEhMI",
    "IxAfGAQiCwgfMgcKBQ1mZqY/EjwIJBAfGAQiNAgfWjAIBBINCAYyCQoHCgVhIGIgKhIQEg4IARIGCP7dwuABEgIIAxILCB8yBwoF",
    "DQAAYD8SPAglEB8YBCI0CB9aMAgEEg0IBjIJCgcKBWEgYiAqEhASDggBEgYI/t3C4AESAggDEgsIHzIHCgUNAAAAPxITCCYQHxgE",
    "IgsIHzIHCgUNAADSQxI1CCcQHxgEIi0IH1opCAQSDQgGMgkKBwoFYSBiIC0SEBIOCAESAggFEgIIBBICCAISBBICCBgSNwgoEB8Y",
    "BCIvCB9aKwgEEg8IBjILCgkKB2EgYiBtaW4SEBIOCAESBgj+3cLgARICCAESBBICCCcSTwgpEB8YBCJHCB9aQwgEEg8IBjILCgkK",
    "B2EgYiBtYXgSIQgfWh0IBBINCAYyCQoHCgVhIGIgLRIEEgIIKBIEEgIIJhILCB8yBwoFDQAAAAASKQgqEB8YBCIhCB9aHQgEEg0I",
    "BjIJCgcKBWEgYiAqEgQSAggpEgQSAgghEisIKxAfGAQiIwgfWh8IBBIPCAYyCwoJCgdhIGIgbWluEgQSAggkEgQSAggqEn0ILBAf",
    "GAQidSJzCmQKP1o9CAISJVojCAISBBICCCISGUoXCAYSBggfEgIIJBoLCB8yBwoFDQAAAAASEkoQCAQSBggfEgIIKxoEEgIIJBIh",
    "CB9aHQgEEg0IBjIJCgcKBWEgYiAvEgQSAggrEgQSAggkEgsIHzIHCgUNAACAPxKcAQgtEBEYBCKTASKQAQpHCgQSAggiEj9aPQgC",
    "EiVKIwgGEhIIHxIOCAESBgj+3cLgARICCAMaCwgfMgcKBQ0AAAAAEhJKEAgHEgYIHxICCCsaBBICCCUSRUpDCAQSLQgfWikIBBIN",
    "CAYyCQoHCgVhIGIgKhIQEg4IARIGCP7dwuABEgIIAxIEEgIIIxoQEg4IARIGCP7dwuABEgIIARJSCC4QERgEIkoiSApACiwSKggB",
    "EgIIBhICCAESDhoMCBgyCAoGCN2ki6kBEgIIARIKGggIGDIECgIICBIQEg4IARIGCP7dwuABEgIICBIEEgIILRIkCC8QERgEIhxa",
    "GggCEhBaDggCEgQSAggtEgQSAgguEgQSAggKEiQIMBgEIh4aHAoMCAESCAgqMgQKAggCCgwIAhIICCsyBAoCCAISJAgxGAQiHhoc",
    "CgwIARIICCoyBAoCCAMKDAgCEggIKzIECgIIAxJFCDIQCxgEIj0aOwo5CICrn1ESMhowCggIARIEEgIIBAokCAISIFIeCAQSGhoY",
    "CggIARIEEgIIBAoMCAISCAgRMgQKAggAEkUIMxALGAQiPRo7CjkIgKufURIyGjAKCAgBEgQSAggFCiQIAhIgUh4IBBIaGhgKCAgB",
    "EgQSAggFCgwIAhIICBEyBAoCCAASdAg0EAsYBCJsGmoKaAjgqp9REmEaXwpdCAESWVpXCAESFBISCAMSAggGEgYI/8Ls2wESAggE",
    "Ej0aOwo5CICrn1ESMhowCggIARIEEgIIBQokCAISIFIeCAQSGhoYCggIARIEEgIIBQoMCAISCAgRMgQKAggBEjsINRALGAQiMxox",
    "Ci8I4KqfURIoGiYKJAgBEiBaHggBEhQSEggDEgIIDBIGCP/C7NsBEgIIBBIEEgIIMxJsCDYQERgEImRaYggDEiZKJAgBEhYIMRIS",
    "CAMSAggGEgYI/8Ls2wESAggOGggIMTIECgIIAxI2UjQIARIwUi4IARIqSigIARIICBgyBAoCCAAaGlIYCAISFBISCAMSAggGEgYI",
    "/8Ls2wESAggEEmwINxARGAQiZFpiCAMSJkokCAESFggxEhIIAxICCAwSBgj/wuzbARICCA4aCAgxMgQKAggDEjZSNAgBEjBSLggB",
    "EipKKAgBEggIGDIECgIIABoaUhgIAhIUEhIIAxICCAwSBgj/wuzbARICCAQSBAg4GAMSBgg5EDIYAxIGCDoQMBgDEgYIOxAyGAMS",
    "agg8GAQiZCJiClYKClIICAESBBICCDYSSEJGCDgSCBIGCAMSAggGGjYaNAoyCP/C7NsBEioIMEImCDoSEBIOCAMSAggGEgYI/8Ls",
    "2wEaDhoMCgoIBBIGCAsSAgg0IDsgORIIEgYIAxICCAYSBAg9GAMSBgg+EDIYAxIGCD8QMBgDEgYIQBAyGAMSaghBGAQiZCJiClYK",
    "ClIICAESBBICCDcSSEJGCD0SCBIGCAMSAggMGjYaNAoyCP/C7NsBEioIMEImCD8SEBIOCAMSAggMEgYI/8Ls2wEaDhoMCgoIBBIG",
    "CAsSAgg1IEAgPhIIEgYIAxICCAwSkAEIQhgEIokBIoYBCmQKBBICCAwSXCJaClIKSlpICAISLVIrCAESJ0olCAESCAgYMgQKAggA",
    "GhdSFQgCEhESDwgBEgIIARIDCJUSEgIIEhIVEhMIARICCAESAwiVEhICCBISAggCEgQSAghBEgQSAgg8Eh4iHAoQCgQSAgguEggS",
    "BggDEgIIDBIIEgYIAxICCAYScghDEAsYBCJqImgKZgoVEhMIARICCAESAwiVEhICCA4SAggCEk0aSwpJCOCqn1ESQhpACj4IARI6",
    "WjgIARIcIhoKGAoQWg4IAxIEEgIICxIEEgIIDRIEEgIIBhIQIg4KDAoEEgIIDBIEEgIIMxIEEgIIMhIfCEQQERgEIhcSFQgBEgII",
    "AxIDCP4HEgIIHxIECOnTHRIfCEUQHxgEIhciFQoTCgQSAghEEgsIHzIHCgUNAACAPxIYCEYQHxgEIhAiDgoMCgQSAghEEgQSAgge",
    "Eh4IRxAfGAQiFiIUCgwKBBICCEQSBBICCB8SBBICCB4SBAhIGAMSBghJEBgYAxIGCEoQGBgDGIz3tbWrvsOEkgEg3bXTitvZo774",
    "ASonZG93bmxvYWRfYnV0dG9uLmVtbC1mZXwxMzUyNjFhZDcwMjU4NDM5Kj5lbmdhZ2VtZW50X3BhbmVsX2xhcmdlX3BsYXllcl9j",
    "b250cm9scy5lbWwtZmV8ZWFhNmUwNWM5MmU2ZWU3OCoqdmlkZW9fYWN0aW9uX2J1dHRvbi5lbWwtZmV8YTk2ZWNjYjY3ODZlYTMz",
    "Kh1iYWRnZS5lbWwtZmV8NTI5MWNmZWFiY2UzOGIyZioQMzkwOTFlNTExOGZlZDNjYSoQODlkZmM4ZWNlNzI0ODY1OCoQZGNlNWIz",
    "YWFmYjY0NGQxNjAB",
  ].join("");

  // 取一个 engagement panel 的标题（菜单项里的那串 /youtube/app/... 路径）。
  function panelTitle(panel) {
    if (!panel.renderer) return;
    const fields = unknownFields(panel.renderer);
    const commandField = fields.find((field) => 18 === field.no && 2 === field.wire);
    const titleBytes = (commandField && descendPath(commandField.data, [3])) ?? fields.find((field) => 1 === field.no && 2 === field.wire)?.data;
    return titleBytes && strictUtf8.decode(titleBytes);
  }

  // on-the-go 菜单项的初始状态。
  function buildTriggerState() {
    const statePath = "/youtube/app/on_the_go_menu_trigger_state";
    return encodeScalarField(
      170382688,
      concatBytes([
        encodePathValue([1, 241780379, 1], 1),
        encodePathValue([1, 169495254, 423731020], new Uint8Array()),
        encodePathValue(
          [1, 169495254, 204158123, 170382688],
          concatBytes([
            encodePathValue([1, 170382720], concatBytes([encodeScalarField(1, statePath), encodeScalarField(2, concatBytes([encodeScalarField(1, statePath), encodeScalarField(2, 1)]))])),
            encodePathValue([1, 169495254, 138681778, 10], concatBytes([encodeScalarField(1, 1), encodeScalarField(3, ON_THE_GO_KEY)])),
          ]),
        ),
      ]),
    );
  }

  // 造一个播放器控件按钮。
  function buildMenuItem(icon, label, endpoint, controlId) {
    return encodeScalarField(
      461054335,
      concatBytes([
        encodeScalarField(2, icon),
        encodeScalarField(4, label),
        encodeScalarField(5, endpoint),
        ...(controlId ? [encodeScalarField(17, "id.player_controls." + controlId + ".button")] : [encodeScalarField(28, 1), encodeScalarField(29, 1)]),
      ]),
    );
  }

  // 读菜单项里的模板标识（形如 "xxx.eml-fe|<hash>"）。
  function readMenuLabel(bytes) {
    const node = descendPath(bytes, [196886555]) ?? descendPath(bytes, [426171394]);
    const label = node && fieldData(node, 1, true);
    return label && strictUtf8.decode(label);
  }

  // 把 frameworkUpdates 里已有的模板合并成一份，返回 { template, framework }。
  function mergeOnTheGoFramework(node) {
    if (unknownFields(node).some((field) => 777 === field.no)) return;

    const frameworkUpdates = node.frameworkUpdates;
    const updateBytes = frameworkUpdates && descendPath(frameworkUpdates, [2]);
    if (!updateBytes) return;

    const seen = new Set();
    const merged = new Set();
    for (const field of parseFields(updateBytes)) {
      if (1 !== field.no || 2 !== field.wire) continue;
      const label = readMenuLabel(field.data);
      if (label) {
        seen.add(label);
        merged.add(label);
      }
      const nested = descendPath(field.data, [328964737]);
      if (nested) {
        for (const item of parseFields(nested)) {
          if (1 !== item.no || 2 !== item.wire) continue;
          const name = descendPath(item.data, [1]);
          const flag = parseFields(item.data).find((entry) => 2 === entry.no && 0 === entry.wire);
          if (name && flag && [1, 2].includes(readVarintValue(flag.data))) seen.add(strictUtf8.decode(name));
        }
      }
    }

    const templateBytes = parseFields(base64ToBytes(ON_THE_GO_TEMPLATE));
    const known = new Set(templateBytes.map((field) => readMenuLabel(field.data)));
    const collected = [];
    let templateLabel = "on_the_go_controls.eml-fe|f87c8ecdb154dadd";

    for (const field of templateBytes) {
      let menu = descendPath(field.data, [196886555]);
      let label = readMenuLabel(field.data);
      const patches = [];
      for (const item of parseFields(menu).filter((entry) => 5 === entry.no && 2 === entry.wire)) {
        const name = strictUtf8.decode(item.data);
        if (known.has(name) || seen.has(name)) continue;
        const prefix = name.slice(0, name.indexOf("|") + 1);
        const candidates = prefix ? [...seen].filter((entry) => entry.startsWith(prefix)) : [];
        if (1 !== candidates.length) return;
        patches.push([item.data, textEncoder.encode(candidates[0])]);
      }
      if (patches.length) {
        menu = replaceBytesDeep(menu, patches);
        if (patches.some(([from]) => containsBytes(menu, from))) return;

        const hashInput = descendPath(menu, [2]);
        let hash = 2166136261;
        for (const byte of hashInput) hash = Math.imul(hash ^ byte, 16777619);
        label = label.split("|")[0] + "|" + (hash >>> 0).toString(16);
        menu = concatBytes(
          parseFields(menu).flatMap((entry) => (4 === entry.no ? [] : 1 === entry.no && 2 === entry.wire ? [encodeScalarField(1, label)] : [entry.raw])),
        );
        if (readMenuLabel(field.data) === templateLabel) templateLabel = label;
      }
      if (!merged.has(label)) collected.push(encodePathValue([1, 196886555], menu));
    }

    return {
      template: templateLabel,
      framework: collected.length ? rewritePath(frameworkUpdates, [2], () => concatBytes([updateBytes, ...collected])) : frameworkUpdates,
    };
  }

  // 造 on-the-go 面板本身。
  function buildOnTheGoPanel(node, options, templateLabel, speedEndpoint) {
    const nextResult = node.content?.nextResult;
    if (!nextResult) return;

    const nextFields = unknownFields(nextResult).find((field) => 4 === field.no && 2 === field.wire);
    const panelData = nextFields && descendPath(nextFields.data, [61479009]);
    const overlayFields = unknownFields(node).find((field) => 9 === field.no && 2 === field.wire);
    const videoId = overlayFields && descendPath(overlayFields.data, [48687757, 1]);
    const panelVideoId = panelData && descendPath(panelData, [17]);
    const titleData = panelData && descendPath(panelData, [1, 1, 1]);
    const subtitleData = panelData && descendPath(panelData, [10, 1, 1]);
    const contents = panelData && fieldData(panelData, 2, true);
    if (!(videoId && panelVideoId && bytesEqual(videoId, panelVideoId) && /^[\w-]{11}$/.test(strictUtf8.decode(videoId)) && titleData && contents)) return;

    const menuRoot = descendPath(node, MENU_ITEM_ROOT);
    const playItem = menuRoot && descendPath(menuRoot, [6, 386334485, 1, 1, 1]);
    const pauseItem = menuRoot && descendPath(menuRoot, [6, 386334486, 1, 1]);
    if (!playItem || !pauseItem) return;

    const audioToggle = concatBytes([encodeScalarField(1, 1), encodeScalarField(3, ON_THE_GO_KEY)]);

    // 把 contents 里的 2/3 号字段平移成 4/5，构造面板的内容体。
    const contentsBody = concatBytes(
      parseFields(contents).map((field) =>
        1 !== field.no || 2 !== field.wire
          ? field.raw
          : encodeScalarField(
              1,
              concatBytes(
                parseFields(field.data).map((entry) => (0 !== entry.wire || (2 !== entry.no && 3 !== entry.no) ? entry.raw : encodeScalarField(entry.no + 2, readVarintValue(entry.data)))),
              ),
            ),
      ),
    );

    const buttons = [
      encodePathValue([1, 1], titleData),
      ...(subtitleData ? [encodeScalarField(2, subtitleData)] : []),
      encodePathValue(
        [3, 2329],
        concatBytes([
          ...[
            [1, 6, 176991, "youtube_fill_experimental/skip_previous_24pt", "Previous video", "previous"],
            [2, 4, 176993, "youtube_outline_experimental/skip10_back_24pt", "Rewind", "seek.backward"],
            [3, 3, 176994, "youtube_outline_experimental/skip10_forward_24pt", "Fast forward", "seek.forward"],
            [4, 5, 176988, "youtube_fill_experimental/skip_next_24pt", "Next video", "next"],
          ].map(([id, kind, iconId, icon, label, controlId]) =>
            encodeScalarField(id, buildMenuItem(icon, label, encodePathValue([169495254, 327511066], concatBytes([encodeScalarField(1, kind), encodeScalarField(2, iconId)])), controlId)),
          ),
          encodeScalarField(5, "Play"),
          encodeScalarField(6, "Pause"),
          encodeScalarField(7, "Replay"),
        ]),
      ),
      encodeScalarField(5, contentsBody),
      ...(false === options.onTheGoAudio
        ? []
        : [
            encodeScalarField(6, buildMenuItem("youtube_outline_experimental/headset_24pt", "Switch to audio mode", encodePathValue([169495254, 300135747, 2], audioToggle))),
            encodeScalarField(12, buildMenuItem("youtube_outline_experimental/video_24pt", "Switch to video mode", encodePathValue([169495254, 300413109, 2], audioToggle))),
          ]),
    ];

    if (speedEndpoint) buttons.push(encodeScalarField(9, buildMenuItem("youtube_outline_experimental/speedometer_24pt", "Playback speed", speedEndpoint)));

    const chaptersPanel = node.engagementPanels
      .map(panelTitle)
      .find((title) => "engagement-panel-macro-markers-auto-chapters" === title || "engagement-panel-macro-markers-description-chapters" === title);
    if (false !== options.onTheGoChapters && chaptersPanel) {
      buttons.push(
        encodeScalarField(
          8,
          buildMenuItem(
            "youtube_outline_experimental/view_list_24pt",
            "Chapters",
            encodePathValue([169495254, 138681778], concatBytes([encodeScalarField(3, ON_THE_GO_KEY), encodeScalarField(10, concatBytes([encodeScalarField(1, 1), encodeScalarField(3, chaptersPanel)]))])),
          ),
        ),
      );
    }

    const extraItems = [
      encodeScalarField(1, concatBytes([encodeScalarField(1, "/youtube/app/engagement_panel"), encodeScalarField(2, 470855422), encodeScalarField(3, 470855422)])),
      encodeScalarField(1, concatBytes([encodeScalarField(1, "/youtube/app/player_overlay"), encodeScalarField(2, 470855423), encodeScalarField(3, 470855423)])),
      ...[
        ["menu_trigger", 14],
        ["audio_only", 18],
      ].map(([name, state]) =>
        encodeScalarField(
          1,
          concatBytes([encodeScalarField(1, "/youtube/app/on_the_go_" + name + "_state"), encodeScalarField(3, 1), encodeScalarField(3, 2325), encodeScalarField(3, Number(state))]),
        ),
      ),
      encodeScalarField(2, 413471385),
    ];
    const panelExtras = concatBytes([
      encodeScalarField(188490103, concatBytes(extraItems)),
      encodeScalarField(212323971, concatBytes([encodeScalarField(1, 413471385), encodeScalarField(2, 5)])),
      encodeScalarField(386334485, concatBytes([encodeScalarField(1, concatBytes([encodePathValue([1, 1], playItem), encodeScalarField(2, 4)])), encodeScalarField(2, 413471385)])),
      encodeScalarField(386334486, concatBytes([encodeScalarField(1, concatBytes([encodeScalarField(1, pauseItem), encodeScalarField(2, 6)])), encodeScalarField(2, 413471385)])),
    ]);

    return messageCodec("EngagementPanel").fromBinary(
      encodeScalarField(
        138681066,
        concatBytes([
          encodePathValue([2, 138681548, 1, 1, 1], "On-the-go"),
          encodePathValue(
            [3, 49399797, 1, 50195462, 1, 153515154, 172660663],
            concatBytes([
              encodePathValue([1, 168777401], concatBytes([encodePathValue([3, 172035250, 1], contents), encodePathValue([5, 413471385, 1, 2325], concatBytes(buttons)), encodeScalarField(6, panelExtras)])),
              encodePathValue([2, 183314536, 1], contents),
            ]),
          ),
          encodeScalarField(5, 282218),
          encodeScalarField(6, 1),
          encodeScalarField(15, 1),
          encodeScalarField(17, 3),
          encodeScalarField(18, audioToggle),
          encodeScalarField(20, 1),
          encodeScalarField(21, 2),
          encodeScalarField(21, 1),
          encodeScalarField(36, 2),
        ]),
      ),
    );
  }

  // 播放倍速菜单：把上限抬到 maxSpeed，并按需删掉 Premium 推广。
  function rewriteSpeedMenu(node, maxSpeed, hidePremium) {
    const renderer = node.playerOverlays?.renderer;
    if (!renderer?.overflowMenu) return false;
    try {
      const updated = rewritePath(
        renderer.overflowMenu,
        [66439850, 1, 153515154, 172660663, 1, 168777401, 5, 407694004, 4, 4, 170382688, 1, 169495254, 443434441, 1, 1, 441573002, 4, 153515154, 172660663, 1, 168777401, 5, 413471385, 1, 1602],
        (bytes) => {
          const fields = parseFields(bytes);
          const rateField = fields.find((field) => 5 === field.no && 5 === field.wire);
          if (!rateField) return bytes;

          const currentRate = new DataView(rateField.data.buffer, rateField.data.byteOffset, 4).getFloat32(0, true);
          if (!(currentRate > 0)) return bytes;

          let next = bytes;
          const maxRate = false === maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(maxSpeed) || 4));
          if (maxRate > 0 && currentRate < maxRate) {
            const encodedRate = new Uint8Array(4);
            new DataView(encodedRate.buffer).setFloat32(0, maxRate, true);
            next = concatBytes(fields.map((field) => (field === rateField ? concatBytes([encodeVarint(45), encodedRate]) : field.raw)));
          }

          if (false === hidePremium) return next;
          return rewritePath(next, [10, 1674], (chunk) => {
            const inner = parseFields(chunk);
            const kept = inner.filter((field) => 3 !== field.no || 2 !== field.wire || !containsBytes(field.data, PREMIUM_UPSELL_MARKER));
            return kept.length === inner.length ? chunk : concatBytes(kept.map((field) => field.raw));
          });
        },
      );
      const changed = !bytesEqual(updated, renderer.overflowMenu);
      if (changed) setField(renderer, "overflowMenu", updated);
      return changed;
    } catch (e) {
      return false;
    }
  }

  // 在播放器溢出菜单里插入 on-the-go 入口，并挂上配套的面板。
  function buildOnTheGo(node, options) {
    const renderer = node.playerOverlays?.renderer;
    if (!renderer?.overflowMenu || !Array.isArray(node.engagementPanels)) return false;
    if (node.engagementPanels.some((panel) => panelTitle(panel) === ON_THE_GO_KEY)) return false;

    const menuBytes = descendPath(renderer.overflowMenu, [66439850]);
    if (!menuBytes) return false;

    const menuFields = parseFields(menuBytes);
    let firstItem;
    let speedEndpoint;
    let insertAt = menuFields.length;

    for (const [index, field] of menuFields.entries()) {
      if (1 !== field.no || 2 !== field.wire) continue;
      const item = descendPath(field.data, MENU_ITEM_PATH);
      const labelBytes = item && fieldData(item, 10, true);
      if (!item || !labelBytes) continue;

      const label = strictUtf8.decode(labelBytes);
      if (label === ON_THE_GO_MENU_PATH) return false;
      if (label.endsWith("/menu_item_additional_settings")) insertAt = index;
      firstItem ??= field.data;

      if (label.endsWith("/menu_item_playback_speed")) {
        const speedNode = descendPath(item, [4, 4, 170382688]);
        if (speedNode) {
          for (const entry of parseFields(speedNode)) {
            if (1 === entry.no && descendPath(entry.data, [169495254, 443434441])) speedEndpoint = entry.data;
          }
        }
      }
    }
    if (!firstItem) return false;

    const framework = mergeOnTheGoFramework(node);
    if (!framework) return false;

    const panel = buildOnTheGoPanel(node, options, framework.template, speedEndpoint);
    if (!panel) return false;

    let menuEntry = rewritePath(firstItem, MENU_ITEM_PATH, (bytes) =>
      concatBytes([
        ...parseFields(bytes)
          .filter((field) => [1, 2, 13, 17].includes(field.no))
          .map((field) => field.raw),
        encodeScalarField(4, concatBytes([encodeScalarField(2, "youtube_outline_experimental/headset_24pt"), encodeScalarField(3, "On-the-go"), encodeScalarField(4, buildTriggerState())])),
        encodeScalarField(10, ON_THE_GO_MENU_PATH),
        encodeScalarField(12, 1),
      ]),
    );
    menuEntry = rewritePath(menuEntry, [...MENU_ITEM_ROOT, 6, 188490103, 1, 1], () => textEncoder.encode(ON_THE_GO_MENU_PATH));
    menuEntry = rewritePath(menuEntry, [153515154, 3, 396644439, 1], () => textEncoder.encode("menu_item_on_the_go"));

    const items = menuFields.map((field) => field.raw);
    items.splice(insertAt, 0, encodeScalarField(1, menuEntry));
    const updatedMenu = rewritePath(renderer.overflowMenu, [66439850], () => concatBytes(items));

    setField(node, "frameworkUpdates", framework.framework);
    setField(node, "engagementPanels", [...node.engagementPanels, panel]);
    setField(renderer, "overflowMenu", updatedMenu);
    return true;
  }

  // 会员专属徽章：按文案在原始字节里逐层找。
  function hasMembersOnlyBadge(node) {
    try {
      const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
      if (!bytes || !bytes.length) return false;
      const decoder = new TextDecoder("utf-8", { fatal: true });

      function scan(buffer, depth) {
        if (depth > 14) return false;
        let offset = 0;
        while (offset < buffer.length) {
          let tag = 0;
          let shift = 0;
          let byte;
          do {
            if (offset >= buffer.length) return false;
            byte = buffer[offset++];
            tag += (byte & 127) * 2 ** shift;
            shift += 7;
            if (shift > 35) return false;
          } while (byte & 128);

          const fieldNo = Math.floor(tag / 8);
          const wireType = tag % 8;
          if (wireType === 0) {
            do {
              if (offset >= buffer.length) return false;
              byte = buffer[offset++];
            } while (byte & 128);
          } else if (wireType === 1) {
            offset += 8;
          } else if (wireType === 5) {
            offset += 4;
          } else if (wireType === 2) {
            let length = 0;
            shift = 0;
            do {
              if (offset >= buffer.length) return false;
              byte = buffer[offset++];
              length += (byte & 127) * 2 ** shift;
              shift += 7;
              if (shift > 35) return false;
            } while (byte & 128);
            if (offset + length > buffer.length) return false;
            const chunk = buffer.subarray(offset, offset + length);
            try {
              if (MEMBERS_ONLY_LABELS.includes(decoder.decode(chunk))) return true;
            } catch {}
            if (scan(chunk, depth + 1)) return true;
            offset += length;
          } else {
            return false;
          }
        }
        return false;
      }

      return scan(bytes, 0);
    } catch {
      return false;
    }
  }

  // 一个卡片/货架里的视频是否全都是会员专属（混排货架不能整块删）。
  function isAllMembersOnly(node) {
    try {
      const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
      if (!bytes || !bytes.length) return false;
      const text = new TextDecoder("utf-8").decode(bytes);
      const videoIds = text.match(/\/vi\/[A-Za-z0-9_-]{11}\//g);
      if (!videoIds) return false;

      const unique = new Set();
      for (const match of videoIds) unique.add(match.slice(4, 15));
      let badges = 0;
      let index;
      for (const label of MEMBERS_ONLY_LABELS) for (index = -1; (index = text.indexOf(label, index + 1)) >= 0; ) badges++;
      return badges >= unique.size;
    } catch {
      return false;
    }
  }

  // 侧栏里指向商店的 tab。
  function isStoreTab(tab) {
    const params = tab.tabRenderer?.endpoint?.browse?.params;
    if (!params) return false;
    try {
      const field = parseFields(base64ToBytes(decodeURIComponent(params))).find((entry) => 2 === entry.no && 2 === entry.wire);
      return !!field && bytesEqual(field.data, STORE_TAB_MARKER);
    } catch {
      return false;
    }
  }

  const CONTAINER_KEYS = new Set(["richItemContents", "overlays"]);
  const LIST_KEYS = new Set(["richItemContents", "contents", "sectionListSupportedRenderers", "overlayCollections"]);
  const RENDERER_KEYS = new Set([
    "videoWithContextRenderer",
    "videoRendererContent",
    "itemSectionRenderer",
    "shelfRenderer",
    "richSectionContent",
    "reelShelfRenderer",
    "renderer",
    "content",
    "item",
  ]);

  // ---- 小工具：删掉播放器里成对的推广按钮 ----

  function dropShortVideoButtons(bytes) {
    return rewriteRepeatedField(bytes, 1, (chunk) =>
      matchesPath(chunk, [10, 461054335, 4, 169495254, 138681778, 1])
        ? void 0
        : rewritePath(chunk, [10, 37098], (inner) =>
            rewriteRepeatedField(inner, 3, (item) => (matchesPath(item, [489973921, 997, 3, 3, 169495254, 138681778, 1]) ? void 0 : item)),
          ),
    );
  }

  function dropPlayerAdButtons(bytes) {
    return rewriteRepeatedField(bytes, 10, (chunk) =>
      matchesPath(chunk, [15, 461054335, 4, 169495254, 138681778, 1])
        ? void 0
        : rewritePath(chunk, [6], (inner) =>
            rewriteRepeatedField(inner, 3, (item) => (matchesPath(item, [4, 16, 461054335, 4, 169495254, 138681778, 1]) ? void 0 : item)),
          ),
    );
  }

  function dropSpeedMenuPair(bytes) {
    return rewritePath(bytes, [1], (chunk) => {
      const fields = parseFields(chunk);
      const first = fields.filter((field) => 1 === field.no && 2 === field.wire);
      const second = fields.filter((field) => 2 === field.no && 2 === field.wire);
      if (first.length !== second.length) return chunk;

      const drop = new Set();
      second.forEach((field, index) => {
        if (matchesPath(field.data, [8, 2, 169495254, 138681778, 1])) {
          drop.add(field);
          drop.add(first[index]);
        }
      });
      return drop.size ? concatBytes(fields.filter((field) => !drop.has(field)).map((field) => field.raw)) : chunk;
    });
  }

  function dropVideoAds(bytes) {
    let next = rewriteRepeatedField(bytes, 386137609, dropPlayerAdButtons);
    next = rewritePath(next, [413471385, 1], (inner) => rewriteRepeatedField(inner, 2185, dropShortVideoButtons));
    return rewriteRepeatedField(next, 408379376, dropSpeedMenuPair);
  }

  function dropAiSummary(bytes) {
    return rewritePath(
      rewriteRepeatedField(bytes, 45, (chunk) => (matchesPath(chunk, [], AI_SUMMARY_MARKER, true) ? void 0 : chunk)),
      [1, 19, 1, 1, 4, 424915055, 1],
      (chunk) => rewriteRepeatedField(chunk, 31, (inner) => (matchesPath(inner, [1, 204158123, 194114827, 1], AI_SUMMARY_MARKER, true) ? void 0 : inner)),
    );
  }

  // ---- 广告节点判定 ----

  function isVerticalLiveLockup(lockup) {
    let bytes = unknownFields(lockup).find((field) => 18 === field.no && 2 === field.wire)?.data;
    try {
      for (const fieldNo of [4, 169495254, 462702848, 1, 139608561, 50, 7, 3]) {
        if (!bytes) return false;
        bytes = parseFields(bytes).find((field) => field.no === fieldNo && 2 === field.wire)?.data;
      }
      return !!bytes && bytesEqual(bytes, IMMERSIVE_LIVE_MARKER);
    } catch {
      return false;
    }
  }

  // 325515470 下面这条链的末尾是不是 SPunlimited（Premium tab）。
  function isPremiumTab(bytes) {
    const path = [2, 11, 1, 4, 170382656, 1, 169495254, 48687626, 2];
    try {
      return (function walk(current, depth) {
        if (depth === path.length) return bytesEqual(current, PREMIUM_TAB_MARKER);
        const next = parseFields(current).filter((field) => field.no === path[depth] && 2 === field.wire);
        return (5 === depth || 1 === next.length) && next.some((field) => walk(field.data, depth + 1));
      })(bytes, 0);
    } catch {
      return false;
    }
  }

  // AI 摘要块：408379376 下面 1/2 号字段成对出现且都指向 ai_summary。
  function isAiBlock(node) {
    try {
      return unknownFields(node).some((field) => {
        if (408379376 !== field.no || 2 !== field.wire) return false;
        const entries = parseFields(field.data).filter((entry) => 1 === entry.no && 2 === entry.wire);
        if (1 !== entries.length) return false;

        const inner = parseFields(entries[0].data);
        const first = inner.filter((entry) => 1 === entry.no && 2 === entry.wire);
        const second = inner.filter((entry) => 2 === entry.no && 2 === entry.wire);
        return second.length > 0 && second.length === first.length && second.every((entry) => matchesPath(entry.data, [8, 2, 169495254, 138681778, 1]));
      });
    } catch {
      return false;
    }
  }

  // 一条信息流节点是不是广告。
  function isFeedAdNode(node, options) {
    const layout = node.layoutRender?.eml?.split("|")[0];
    const adByLayout = layout && ((false !== options.blockFeedAds && FEED_AD_LAYOUT.test(layout)) || (options.blockStore && SHOPPING_LAYOUT.test(layout)));

    if (adByLayout) return true;
    if (options.blockStore && node.shoppingShelf) return true;
    if (false !== options.blockFeedAds && node.sponsoredVideo) return true;
    if (false !== options.blockFeedAds && node.sponsoredDisplay) return true;
    if (options.blockVerticalLive && node.videoLockup && isVerticalLiveLockup(node.videoLockup)) return true;
    if (false !== options.blockMembersOnly && node.videoLockup && hasMembersOnlyBadge(node.videoLockup)) return true;

    for (const field of unknownFields(node)) {
      if (2 !== field.wire) continue;

      if (false !== options.blockFeedAds && containsBytes(field.data)) return true;
      if (false !== options.blockFeedAds && 325515470 === field.no && isPremiumTab(field.data)) return true;
      if (options.blockStore && 400157044 === field.no) return true;
      if (false !== options.blockFeedAds && 455507059 === field.no) return true;
      if (options.blockVerticalLive && 519005951 === field.no && containsBytes(field.data, VERTICAL_LIVE_ICON)) return true;
      if (312131490 === field.no) {
        if (options.blockGames && containsBytes(field.data, MINI_GAME_MARKER)) return true;
        if (options.blockStore && containsBytes(field.data, SHOPPING_LIST_MARKER)) return true;
      }
    }
    return false;
  }

  // 删掉 Ask / AI 摘要相关的控件。
  function stripAiControls(node) {
    let changed = false;
    try {
      if (node.engagementPanels?.length) {
        const panels = node.engagementPanels.filter((panel) => {
          const renderer = panel.renderer;
          return !renderer || !unknownFields(renderer).some((field) => 1 === field.no && 2 === field.wire && bytesEqual(field.data, PREMIUM_UPSELL_MARKER));
        });
        changed = setField(node, "engagementPanels", panels) || changed;
        for (const panel of panels) {
          if (!panel.renderer) continue;
          changed =
            rewriteUnknownField(panel.renderer, 10, (bytes) =>
              matchesPath(bytes, [260791572, 1, 153515154, 172660663, 1, 168777401, 5, 413471385, 1, 2553, 997, 3, 3, 170382688, 1, 169495254, 138681778, 1]) ? void 0 : bytes,
            ) || changed;
        }
      }

      if (node.playerOverlays?.renderer) changed = rewriteUnknownField(node.playerOverlays.renderer, 37, dropVideoAds) || changed;
      changed = rewriteUnknownField(node, 216561405, (bytes) => rewritePath(bytes, [1], dropVideoAds)) || changed;
      changed = rewriteUnknownField(node, 386137609, dropPlayerAdButtons) || changed;
      changed = rewriteUnknownField(node, 408379376, dropSpeedMenuPair) || changed;

      if (node.element?.data) changed = rewriteUnknownField(node.element.data, 2185, dropShortVideoButtons) || changed;
      if (node.videoLockup) changed = rewriteUnknownField(node.videoLockup, 18, dropAiSummary) || changed;
      if (node.videoContent?.videoLockup) {
        changed =
          rewriteUnknownField(node, 6, (bytes) =>
            rewritePath(bytes, [188490103], (inner) => rewriteRepeatedField(inner, 1, (item) => (matchesPath(item, [1], AI_SUMMARY_MARKER, true) ? void 0 : item))),
          ) || changed;
      }
    } catch (e) {
      // 结构对不上就当没改，放原响应过去。
    }
    return changed;
  }

  // 关掉 Jump Ahead 的推广模式，并把展示次数上限放开。
  function disableSmartSkip(button) {
    let changed = false;
    const controller = button.controller;
    if (true === controller?.promotionMode) {
      setField(controller, "promotionMode", false);
      changed = true;
    }
    if (button.actions?.items?.length) {
      for (const item of [button, ...button.actions.items]) {
        if (2147483647 !== item.displayLimit) {
          setField(item, "displayLimit", 2147483647);
          changed = true;
        }
      }
    }
    return changed;
  }

  // ---- 浏览树遍历：边遍历边删广告、Shorts 货架、会员视频、AI 控件 ----

  function filterBrowseTree(root, options) {
    const opts = {
      blockGames: true,
      blockVerticalLive: false,
      jumpAhead: true,
      blockStore: true,
      blockAi: true,
      onTheGo: true,
      maxSpeed: 4,
      hidePremium: true,
      blockFeedAds: true,
      blockShortsFeed: false,
      blockMembersOnly: false,
      onTheGoAudio: true,
      onTheGoChapters: true,
      ...(options || {}),
    };

    let changed = rewriteSpeedMenu(root, opts.maxSpeed, opts.hidePremium);
    if (opts.onTheGo) {
      try {
        changed = buildOnTheGo(root, opts) || changed;
      } catch (e) {
        // 章节数据缺失时跳过，不影响其它改写。
      }
    }

    function visit(node, inList = false) {
      if (!node || "object" != typeof node || ArrayBuffer.isView(node)) return 0;
      if (inList && false !== opts.blockMembersOnly && hasMembersOnlyBadge(node) && isAllMembersOnly(node)) return 1;
      if (false !== opts.blockShortsFeed && node.reelShelfRenderer) return 2;

      if (Array.isArray(node)) {
        let result = 0;
        for (const item of node) result |= 1 & visit(item, inList);
        return result;
      }

      let isAd = inList && (isFeedAdNode(node, opts) || (opts.blockAi && isAiBlock(node)));

      const layout = node.renderInfo?.layoutRender?.eml?.split("|")[0];
      let isShortsShelf = !!layout && ((false !== opts.blockFeedAds && FEED_AD_LAYOUT.test(layout)) || (opts.blockStore && SHOPPING_LAYOUT.test(layout)));
      if (inList && (isAd || isShortsShelf)) return 1;

      if (opts.blockAi) changed = stripAiControls(node) || changed;

      const state = node[WIRE_STATE];
      for (const key of Object.keys(node)) {
        // 延迟解析的节点只在需要时才展开，跳过不可能命中广告的字段。
        if (!inList && state?.deferred) {
          const spec = SCHEMA[state.type].find(([, name]) => name === key);
          if (
            spec &&
            !state.eager.has(spec[2]) &&
            !CONTAINER_KEYS.has(key) &&
            !LIST_KEYS.has(key) &&
            "promotedContents" !== key &&
            (!opts.blockStore || ("tabs" !== key && "attachments" !== key))
          ) {
            continue;
          }
        }

        const value = node[key];
        if (!value || "object" != typeof value || ArrayBuffer.isView(value)) continue;

        if (!Array.isArray(value)) {
          const result = visit(value, inList);
          if (inList && 1 & result) return 1;
          isAd = !!(1 & result) || isAd;
          if (2 & result && RENDERER_KEYS.has(key)) isShortsShelf = true;
          continue;
        }

        let kept;
        const isContainer = CONTAINER_KEYS.has(key);
        const isList = LIST_KEYS.has(key);
        const isTabs = opts.blockStore && "tabs" === key;
        const isAttachments = opts.blockStore && "attachments" === key;
        const isPromoted = "promotedContents" === key;

        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const drop =
            (isTabs && isStoreTab(item)) ||
            (isAttachments && item.products?.length) ||
            (isPromoted && false !== opts.blockFeedAds && containsBytes(item));
          const result = drop && !inList ? 0 : visit(item, inList || isContainer);

          if (inList && 1 & result) return 1;
          isAd = !!(1 & result) || isAd;
          if (drop || (isContainer && 1 & result) || (isList && 2 & result)) kept ??= value.slice(0, i);
          else if (kept) kept.push(item);
        }

        if (kept) {
          setField(node, key, kept);
          changed = true;
          if (!kept.length && (isContainer || isList)) isShortsShelf = true;
        }
        if (opts.blockStore && "attachments" === key && !(kept ?? value).length && void 0 !== node.attachmentStateKey) {
          changed = deleteField(node, "attachmentStateKey") || changed;
        }
      }

      if (opts.jumpAhead && node.smartSkipButton) changed = disableSmartSkip(node.smartSkipButton) || changed;

      return (isAd ? 1 : 0) | (isShortsShelf ? 2 : 0);
    }

    visit(root);
    return changed;
  }

  // ---- 播放器响应 ----

  function rewritePlayer(player, options) {
    let changed = filterBrowseTree(player, options);

    if (false !== options.removePaidPromotion) changed = deleteField(player, "paidPromotion") || changed;

    if (false !== options.blockPlayerAds) {
      for (const key of ["adPlacements", "adSlots"]) {
        if (player[key]?.length) {
          setField(player, key, []);
          changed = true;
        }
      }
    }

    const speedConfig = player.playerConfig?.granularVariableSpeedConfig;
    const maxRate = false === options.maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(options.maxSpeed) || 4)) * 100;
    if (maxRate > 0 && void 0 !== speedConfig?.maximumPlaybackRate && speedConfig.maximumPlaybackRate > 0 && speedConfig.maximumPlaybackRate < maxRate) {
      setField(speedConfig, "maximumPlaybackRate", maxRate);
      changed = true;
    }

    if (false !== options.blockAdTracking && player.playbackTracking) {
      changed = deleteField(player.playbackTracking, "pageadViewthroughconversion") || changed;
    }

    const playability = player.playabilityStatus;
    if (playability) {
      if (false !== options.pip) {
        const render = playability.pictureInPictureRender ?? {};
        setField(playability, "pictureInPictureRender", render);
        const ability = render.pictureInPictureAbility ?? {};
        setField(render, "pictureInPictureAbility", ability);
        changed = setField(ability, "active", true) || changed;
        changed = setField(ability, "f4", 0) || changed;
        changed = setField(ability, "f6", 0) || changed;
        changed = setField(ability, "f8", 1) || changed;
      }
      if (false !== options.backgroundPlay) {
        const render = playability.backgroundPlayerRender ?? {};
        setField(playability, "backgroundPlayerRender", render);
        const ability = render.backgroundAbility ?? {};
        setField(render, "backgroundAbility", ability);
        changed = setField(ability, "active", true) || changed;
      }
    }

    return changed;
  }

  //=====================================================================================
  // §9 画质缓存
  //
  // 从 player 响应里挑出每个视频可用的 itag 存起来，videoplayback 请求时按 id 取用。
  //=====================================================================================

  function isQualityEntry(entry) {
    return !!(
      entry &&
      "object" == typeof entry &&
      !Array.isArray(entry) &&
      Number.isInteger(entry.height) &&
      entry.height > 0 &&
      entry.height <= 2147483647 &&
      Array.isArray(entry.itags) &&
      entry.itags.length > 0 &&
      entry.itags.length <= 256 &&
      entry.itags.every((itag) => Number.isInteger(itag) && itag > 0 && itag <= 4294967295) &&
      new Set(entry.itags).size === entry.itags.length &&
      (void 0 === entry.premiumItags ||
        (Array.isArray(entry.premiumItags) &&
          entry.premiumItags.length <= entry.itags.length &&
          new Set(entry.premiumItags).size === entry.premiumItags.length &&
          entry.premiumItags.every((itag) => entry.itags.includes(itag))))
    );
  }

  function sameQuality(left, right) {
    return (
      void 0 !== left &&
      left.height === right.height &&
      left.itags.length === right.itags.length &&
      right.itags.every((itag) => left.itags.includes(itag)) &&
      (left.premiumItags?.length ?? 0) === (right.premiumItags?.length ?? 0) &&
      (right.premiumItags ?? []).every((itag) => left.premiumItags?.includes(itag))
    );
  }

  function updateQualityCache(players, options) {
    if (!players.length) return;

    const maxHeight = Math.max(144, Math.min(4320, parseInt(options.maxHeight) || 4320));
    const metadata = players.map((player) => unknownFields(player).find((field) => 4 === field.no && 2 === field.wire)?.data).filter(Boolean);
    if (!metadata.length) return;

    let cache;
    try {
      cache = readStore(QUALITY_KEY, MAX_QUALITY_JSON);
    } catch (e) {
      return;
    }

    const next = Object.create(null);
    let dirty = false;
    const keys = Object.keys(cache);
    if (keys.length > MAX_QUALITY_ENTRIES) dirty = true;

    for (const videoId of keys.slice(-MAX_QUALITY_ENTRIES)) {
      const entry = cache[videoId];
      if (videoId.length > 256 || !isQualityEntry(entry) || entry.height > maxHeight) {
        dirty = true;
      } else {
        next[videoId] = { height: entry.height, itags: entry.itags };
        if (entry.premiumItags?.length) next[videoId].premiumItags = entry.premiumItags;
        if (Object.keys(entry).length !== Object.keys(next[videoId]).length) dirty = true;
      }
    }

    for (const bytes of metadata) {
      try {
        const fields = parseFields(bytes);
        const urlField = fields.find((field) => 15 === field.no && 2 === field.wire);
        const match = urlField && /[?&]id=([^&]+)/.exec(strictUtf8.decode(urlField.data));
        if (!match) continue;

        const videoId = decodeURIComponent(match[1]);
        const entry = { height: 0, itags: [] };
        if (videoId.length > 256) continue;

        const seen = new Set();
        let truncated = false;
        for (const field of fields) {
          if (3 !== field.no || 2 !== field.wire) continue;

          const format = parseFields(field.data);
          const mime = format.find((item) => 5 === item.no && 2 === item.wire);
          if (!mime || !strictUtf8.decode(mime.data).startsWith("video/")) continue;

          const numberField = (fieldNo) => {
            const item = format.find((entry) => entry.no === fieldNo && 0 === entry.wire);
            return item ? readVarintValue(item.data) : 0;
          };
          const height = Math.min(numberField(7), numberField(8));
          const itag = numberField(1);
          if (!itag || !height || height > 2147483647 || height > maxHeight || height < entry.height) continue;

          if (height > entry.height) {
            entry.height = height;
            entry.itags = [];
            delete entry.premiumItags;
            seen.clear();
            truncated = false;
          }
          if (truncated || seen.has(itag)) continue;
          if (256 === seen.size) {
            truncated = true;
            continue;
          }

          seen.add(itag);
          entry.itags.push(itag);
          const premium = format.find((item) => 26 === item.no && 2 === item.wire);
          if (premium && /\bPremium\b/i.test(strictUtf8.decode(premium.data))) (entry.premiumItags ??= []).push(itag);
        }

        if (truncated || !isQualityEntry(entry) || sameQuality(next[videoId], entry)) continue;
        delete next[videoId];
        next[videoId] = entry;
        dirty = true;
      } catch (e) {
        // 单条画质记录异常不影响其它记录。
      }
    }

    if (!dirty) return;

    const trimmed = Object.keys(next);
    for (const videoId of trimmed.slice(0, Math.max(0, trimmed.length - MAX_QUALITY_ENTRIES))) delete next[videoId];

    try {
      let json = JSON.stringify(next);
      while (textEncoder.encode(json).length > MAX_QUALITY_JSON) {
        delete next[Object.keys(next)[0]];
        json = JSON.stringify(next);
      }
      writeStore(next, QUALITY_KEY);
    } catch (e) {
      // 存不进去就算了，不影响本次播放。
    }
  }

  //=====================================================================================
  // §10 UMP
  //
  // initplayback 的响应是分片容器：type 10 是明文头，type 11 是加密体。
  // 加密体用 AES-256-CBC + HMAC-SHA256，密钥来自 config/log_event 里的 clientKey。
  // 这里解密 -> 按 schema 改写 -> 重新加密，只动被改过的分片。
  //=====================================================================================

  // 读 UMP 分片头（可变长前缀编码，不是标准 varint）。
  class UmpReader {
    constructor(buffer) {
      this.buffer = buffer;
      this.offset = 0;
    }

    readByte() {
      if (this.offset >= this.buffer.length) throw new Error("Truncated UMP header");
      return this.buffer[this.offset++];
    }

    readVarint() {
      const first = this.readByte();
      let width = 5;
      for (let i = 1; i < 5; i++) {
        if (!(first & (128 >> (i - 1)))) {
          width = i;
          break;
        }
      }
      let shift = 5 === width ? 0 : 8 - width;
      let value = 5 === width ? 0 : first & ((1 << shift) - 1);
      for (let i = 1; i < width; i++, shift += 8) value += this.readByte() * 2 ** shift;
      return value;
    }

    readPart() {
      const start = this.offset;
      const type = this.readVarint();
      const length = this.readVarint();
      if (length > this.buffer.length - this.offset) {
        throw new Error(`Truncated UMP payload: type=${type}, offset=${this.offset}, expected=${length}, available=${this.buffer.length - this.offset}`);
      }
      const data = this.buffer.subarray(this.offset, this.offset + length);
      this.offset += length;
      return { type, data, originalData: data, raw: this.buffer.subarray(start, this.offset) };
    }

    get hasNext() {
      return this.offset < this.buffer.length;
    }
  }

  class UmpWriter {
    constructor(size = 1024) {
      this.buffer = new Uint8Array(size);
      this.length = 0;
    }

    ensureCapacity(extra) {
      if (this.length + extra <= this.buffer.length) return;
      const grown = new Uint8Array(Math.max(2 * this.buffer.length, this.length + extra));
      grown.set(this.buffer);
      this.buffer = grown;
    }

    writeByte(byte) {
      this.ensureCapacity(1);
      this.buffer[this.length++] = 255 & byte;
    }

    writeVarint(value) {
      if (!Number.isInteger(value) || value < 0 || value > 4294967295) throw new Error("Invalid UMP integer");
      const width = value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : value < 268435456 ? 4 : 5;
      if (1 === width) return this.writeByte(value);
      5 === width ? this.writeByte(240) : this.writeByte((256 - (256 >> (width - 1))) | (value & ((1 << (8 - width)) - 1)));
      for (let i = 1, shift = 5 === width ? 0 : 8 - width; i < width; i++, shift += 8) this.writeByte(Math.floor(value / 2 ** shift));
    }

    writePart({ type, data }) {
      this.writeVarint(type);
      this.writeVarint(data.length);
      this.ensureCapacity(data.length);
      this.buffer.set(data, this.length);
      this.length += data.length;
    }

    finish() {
      return this.buffer.subarray(0, this.length);
    }
  }

  async function gzipStream(bytes, decompress) {
    const stream = decompress ? new DecompressionStream("gzip") : new CompressionStream("gzip");
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();

    const collected = (async () => {
      const chunks = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (decompress && total > 16777216) throw new Error("UMP decompression exceeds 16 MiB");
        chunks.push(value);
      }
      return concatBytes(chunks);
    })();
    const written = (async () => {
      await writer.write(bytes);
      await writer.close();
    })();

    try {
      return (await Promise.all([collected, written]))[0];
    } catch (e) {
      await Promise.allSettled([reader.cancel(e), writer.abort(e)]);
      throw e;
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  }

  // ---- 内联的 @noble/ciphers + @noble/hashes（MIT，版权与许可见下方注释）----
  const { CryptoContext } =   /*
    Third-party components bundled below use the MIT License.

    @noble/ciphers
    Copyright (c) 2022 Paul Miller (https://paulmillr.com)
    Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>

    @noble/hashes
    Copyright (c) 2022 Paul Miller (https://paulmillr.com)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
  (function () {
    function g(g, ...I) {
      if (!(
        g instanceof Uint8Array ||
        (ArrayBuffer.isView(g) && "Uint8Array" === g.constructor.name)
      ))
        throw new Error("Uint8Array expected");
      if (I.length && !I.includes(g.length)) throw new Error("Invalid byte length: " + g.length);
    }
    function I(g) {
      return new Uint32Array(g.buffer, g.byteOffset, Math.floor(g.byteLength / 4));
    }
    function A(...g) {
      for (const I of g) I.fill(0);
    }
    function C(g) {
      return g.byteOffset % 4 == 0;
    }
    function E(g) {
      return Uint8Array.from(g);
    }
    if (68 !== new Uint8Array(new Uint32Array([287454020]).buffer)[0])
      throw new Error("Non little-endian hardware is not yet supported");
    function o(g) {
      return (g << 1) ^ (283 & -(g >> 7));
    }
    function e(g, I) {
      let A = 0;
      for (; I > 0; I >>= 1) ((A ^= g & -(1 & I)), (g = o(g)));
      return A;
    }
    var B = (g) => (g << 24) | (g >>> 8),
      t = (g) => (g << 8) | (g >>> 24);
    function n(g, I) {
      if (256 !== g.length) throw new Error("Wrong sbox length");
      let A = new Uint32Array(256).map((A, C) => I(g[C])),
        C = A.map(t),
        E = C.map(t),
        o = E.map(t),
        e = new Uint32Array(65536),
        B = new Uint32Array(65536),
        n = new Uint16Array(65536);
      for (let I = 0; I < 256; I++)
        for (let t = 0; t < 256; t++) {
          let S = 256 * I + t;
          ((e[S] = A[I] ^ C[t]), (B[S] = E[I] ^ o[t]), (n[S] = (g[I] << 8) | g[t]));
        }
      return { sbox2: n, T01: e, T23: B };
    }
    var S = n(
        (() => {
          let g = new Uint8Array(256);
          for (let I = 0, A = 1; I < 256; I++, A ^= o(A)) g[I] = A;
          let I = new Uint8Array(256);
          I[0] = 99;
          for (let A = 0; A < 255; A++) {
            let C = g[255 - A];
            ((C |= C << 8), (I[g[A]] = 255 & (C ^ (C >> 4) ^ (C >> 5) ^ (C >> 6) ^ (C >> 7) ^ 99)));
          }
          return (A(g), I);
        })(),
        (g) => (e(g, 3) << 24) | (g << 16) | (g << 8) | e(g, 2),
      ),
      i = (() => {
        let g = new Uint8Array(16);
        for (let I = 0, A = 1; I < 16; I++, A = o(A)) g[I] = A;
        return g;
      })();
    function r(g, I, A, C, E, o) {
      return g[((A << 8) & 65280) | ((C >>> 8) & 255)] ^ I[((E >>> 8) & 65280) | ((o >>> 24) & 255)];
    }
    function h(g, I, A, C, E) {
      return g[(255 & I) | (65280 & A)] | (g[((C >>> 16) & 255) | ((E >>> 16) & 65280)] << 16);
    }
    function a(g, I, A, C, E) {
      let { sbox2: o, T01: e, T23: B } = S,
        t = 0;
      ((I ^= g[t++]), (A ^= g[t++]), (C ^= g[t++]), (E ^= g[t++]));
      let n = g.length / 4 - 2;
      for (let o = 0; o < n; o++) {
        let o = g[t++] ^ r(e, B, I, A, C, E),
          n = g[t++] ^ r(e, B, A, C, E, I),
          S = g[t++] ^ r(e, B, C, E, I, A),
          i = g[t++] ^ r(e, B, E, I, A, C);
        ((I = o), (A = n), (C = S), (E = i));
      }
      return {
        s0: g[t++] ^ h(o, I, A, C, E),
        s1: g[t++] ^ h(o, A, C, E, I),
        s2: g[t++] ^ h(o, C, E, I, A),
        s3: g[t++] ^ h(o, E, I, A, C),
      };
    }
    function K(o, e, B) {
      const t = E(e),
        n = C(B) ? B : E(B);
      try {
        return (function (C, E, o) {
          (g(E, 16), g(o));
          let e = o.length;
          const B = new Uint8Array(e);
          let t = E,
            n = I(t),
            { s0: S, s1: i, s2: r, s3: h } = a(C, n[0], n[1], n[2], n[3]),
            K = I(o),
            s = I(B);
          for (let g = 0; g + 4 <= K.length; g += 4) {
            ((s[g + 0] = K[g + 0] ^ S),
              (s[g + 1] = K[g + 1] ^ i),
              (s[g + 2] = K[g + 2] ^ r),
              (s[g + 3] = K[g + 3] ^ h));
            let I = 1;
            for (let g = t.length - 1; g >= 0; g--)
              ((I = (I + (255 & t[g])) | 0), (t[g] = 255 & I), (I >>>= 8));
            ({ s0: S, s1: i, s2: r, s3: h } = a(C, n[0], n[1], n[2], n[3]));
          }
          let c = 16 * Math.floor(K.length / 4);
          if (c < e) {
            let g = new Uint32Array([S, i, r, h]),
              I = new Uint8Array(g.buffer);
            for (let g = c, A = 0; g < e; g++, A++) B[g] = o[g] ^ I[A];
            A(g);
          }
          return B;
        })(o, t, n);
      } finally {
        (A(t), n !== B && A(n));
      }
    }
    function s(g) {
      return new DataView(g.buffer, g.byteOffset, g.byteLength);
    }
    function c(g, I) {
      return (g << (32 - I)) | (g >>> I);
    }
    function Q(g, I, A) {
      return (g & I) ^ (~g & A);
    }
    function w(g, I, A) {
      return (g & I) ^ (g & A) ^ (I & A);
    }
    const l = Uint32Array.from([
      1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225,
    ]);
    var R = Uint32Array.from([
        1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
        3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
        3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
        2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
        666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
        2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
        430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
        1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479,
        3329325298,
      ]),
      M = new Uint32Array(64),
      G = class {
        constructor() {
          ((this.length = 0),
            (this.pos = 0),
            (this.buffer = new Uint8Array(64)),
            (this.view = s(this.buffer)),
            this.set(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7]));
        }
        update(g) {
          const { view: I, buffer: C } = this,
            E = g.length;
          for (let A = 0; A < E;) {
            const o = Math.min(64 - this.pos, E - A);
            if (64 === o) {
              const I = s(g);
              for (; 64 <= E - A; A += 64) this.process(I, A);
              continue;
            }
            (C.set(g.subarray(A, A + o), this.pos),
              (this.pos += o),
              (A += o),
              64 === this.pos && (this.process(I, 0), (this.pos = 0)));
          }
          return ((this.length += g.length), A(M), this);
        }
        digest() {
          const { buffer: g, view: I, pos: C } = this;
          ((g[C] = 128),
            g.fill(0, C + 1),
            C >= 56 && (this.process(I, 0), g.fill(0)),
            I.setBigUint64(56, BigInt(8 * this.length), !1),
            this.process(I, 0));
          const E = new Uint8Array(32),
            o = s(E),
            { A: e, B, C: t, D: n, E: S, F: i, G: r, H: h } = this,
            a = [e, B, t, n, S, i, r, h];
          for (let g = 0; g < 8; g++) o.setUint32(4 * g, a[g], !1);
          return (this.set(0, 0, 0, 0, 0, 0, 0, 0), A(g), E);
        }
        set(g, I, A, C, E, o, e, B) {
          ((this.A = 0 | g),
            (this.B = 0 | I),
            (this.C = 0 | A),
            (this.D = 0 | C),
            (this.E = 0 | E),
            (this.F = 0 | o),
            (this.G = 0 | e),
            (this.H = 0 | B));
        }
        process(g, I) {
          for (let A = 0; A < 16; A++, I += 4) M[A] = g.getUint32(I, !1);
          for (let g = 16; g < 64; g++) {
            let I = M[g - 15],
              A = M[g - 2],
              C = c(I, 7) ^ c(I, 18) ^ (I >>> 3),
              E = c(A, 17) ^ c(A, 19) ^ (A >>> 10);
            M[g] = (E + M[g - 7] + C + M[g - 16]) | 0;
          }
          let { A, B: C, C: E, D: o, E: e, F: B, G: t, H: n } = this;
          for (let g = 0; g < 64; g++) {
            let I = (n + (c(e, 6) ^ c(e, 11) ^ c(e, 25)) + Q(e, B, t) + R[g] + M[g]) | 0,
              S = ((c(A, 2) ^ c(A, 13) ^ c(A, 22)) + w(A, C, E)) | 0;
            ((n = t),
              (t = B),
              (B = e),
              (e = (o + I) | 0),
              (o = E),
              (E = C),
              (C = A),
              (A = (I + S) | 0));
          }
          ((A = (A + this.A) | 0),
            (C = (C + this.B) | 0),
            (E = (E + this.C) | 0),
            (o = (o + this.D) | 0),
            (e = (e + this.E) | 0),
            (B = (B + this.F) | 0),
            (t = (t + this.G) | 0),
            (n = (n + this.H) | 0),
            this.set(A, C, E, o, e, B, t, n));
        }
      };
    return {
      CryptoContext: class {
        constructor(o) {
          ((this.expandedKey = (function (o) {
            g(o);
            let e = o.length;
            if (![16, 24, 32].includes(e))
              throw new Error("aes: invalid key size, should be 16, 24 or 32, got " + e);
            let { sbox2: t } = S,
              n = [];
            C(o) || n.push((o = E(o)));
            let r = I(o),
              a = r.length,
              K = (g) => h(t, g, g, g, g),
              s = new Uint32Array(e + 28);
            s.set(r);
            for (let g = a; g < s.length; g++) {
              let I = s[g - 1];
              (g % a === 0 ? (I = K(B(I)) ^ i[g / a - 1]) : a > 6 && g % a === 4 && (I = K(I)),
                (s[g] = s[g - a] ^ I));
            }
            return (A(...n), s);
          })(o.slice(0, 16))),
            (this.hmacKey = o.slice(16)));
        }
        signature(g) {
          const I = new Uint8Array(64);
          I.set(this.hmacKey.length > 64 ? new G().update(this.hmacKey).digest() : this.hmacKey);
          for (let g = 0; g < I.length; g++) I[g] ^= 54;
          const C = new G().update(I).update(g).update(this.iv).digest();
          for (let g = 0; g < I.length; g++) I[g] ^= 106;
          const E = new G().update(I).update(C).digest();
          return (A(I, C), E);
        }
        decrypt(g) {
          if (
            ((this.iv = g.iv),
            !(function (g, I) {
              if (g.length !== I.length) return !1;
              let A = 0;
              for (let C = 0; C < g.length; C++) A |= g[C] ^ I[C];
              return 0 === A;
            })(this.signature(g.encryptedContent), g.hmac))
          )
            throw new Error("HMAC verification failed");
          return K(this.expandedKey, this.iv, g.encryptedContent);
        }
        encrypt(g) {
          const I = K(this.expandedKey, this.iv, g);
          return { encryptedContent: I, hmac: this.signature(I) };
        }
      },
    };
  })();

  async function decryptUmp(body, options, keys) {
    let contexts;
    const EncryptedPart = messageCodec("EncryptedResponsePart", EAGER_TYPES.ump);
    const Onesie = messageCodec("OnesieInnertubeResponse", EAGER_TYPES.ump);
    const reader = new UmpReader(body);
    const out = [];
    const players = [];
    let changed = false;
    let expectingEncrypted = false;

    async function processPart(partBytes) {
      const envelope = EncryptedPart.fromBinary(partBytes);
      if (!(envelope.encryptedContent instanceof Uint8Array) || 16 !== envelope.iv?.length || 32 !== envelope.hmac?.length) {
        throw new Error("Malformed encrypted UMP envelope");
      }
      if ((envelope.compressionAlgorithm ?? 0) > 1) throw new Error("Unsupported UMP compression");

      if (!contexts) {
        contexts = keys.map((key) => new CryptoContext(key));
      }

      let plaintext;
      let context;
      for (const candidate of contexts) {
        try {
          plaintext = candidate.decrypt(envelope);
          context = candidate;
          break;
        } catch (e) {
          if ("HMAC verification failed" !== e.message) throw e;
        }
      }
      if (!plaintext || !context) throw new Error("HMAC verification failed");

      const isGzip = 31 === plaintext[0] && 139 === plaintext[1];
      if (1 === envelope.compressionAlgorithm && !isGzip) throw new Error("Invalid UMP gzip payload");

      const decoded = isGzip ? await gzipStream(plaintext, true) : plaintext;
      const response = Onesie.fromBinary(decoded);

      if (false !== options.autoHd) {
        for (const item of response.contents) if (item.player) players.push(item.player);
      }

      const modified = (function (node, opts) {
        let result = false;
        for (const item of node.contents) {
          if (item.player) result = rewritePlayer(item.player, opts) || result;
          if (item.next) result = filterBrowseTree(item.next, opts) || result;
        }
        return result;
      })(response, options);
      if (!modified) return body;

      const reencoded = Onesie.toBinary(response);
      if (bytesEqual(reencoded, decoded)) return body;

      const recompressed = isGzip ? await gzipStream(reencoded, false) : reencoded;
      const encrypted = context.encrypt(recompressed);
      setField(envelope, "encryptedContent", encrypted.encryptedContent);
      setField(envelope, "hmac", encrypted.hmac);
      return EncryptedPart.toBinary(envelope);
    }

    for (; reader.hasNext; ) {
      const part = reader.readPart();
      if (10 === part.type) {
        const marker = parseFields(part.data).find((field) => 1 === field.no && 0 === field.wire);
        expectingEncrypted = !!marker && 25 === readVarintValue(marker.data);
      } else if (11 === part.type && expectingEncrypted) {
        part.data = await processPart(part.data);
        expectingEncrypted = false;
      }

      if (part.data === part.originalData) {
        out.push(part.raw);
      } else {
        changed = true;
        const writer = new UmpWriter(part.data.length + 10);
        writer.writePart(part);
        out.push(writer.finish());
      }
    }

    return { body: changed ? concatBytes(out) : body, players };
  }

  //=====================================================================================
  // §11 请求改写
  //=====================================================================================

  function toBytes(value) {
    if (!value) return undefined;
    if (value instanceof Uint8Array) return value;
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === "string") {
      const out = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code > 255) return undefined;
        out[i] = code;
      }
      return out;
    }
    return undefined;
  }

  function emptyProtobufResponse() {
    return { response: { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: new Uint8Array() } };
  }

  function clientKeyFor(request) {
    return Object.entries(request.headers ?? {}).some(([key, value]) => "user-agent" === key.toLowerCase() && /music/i.test(value)) ? "youtubeMusic" : "youtube";
  }

  function readRequestBody(request) {
    const body = request.body;
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (body?.length) throw new Error("YouTube requires binary-body-mode for request bodies");
    const contentLength = Object.entries(request.headers ?? {}).find(([key]) => "content-length" === key.toLowerCase())?.[1];
    if (Number(contentLength) > 0) throw new Error("YouTube request body unavailable; requires-body must be enabled");
  }

  // 把请求里的 itag 相关字段改成缓存里的目标值；quality 为空表示只要最高分辨率。
  function applyQuality(bytes, quality) {
    const targets = new Map(
      quality
        ? [
            [13, 0],
            [14, 2],
            [16, quality.height],
            [21, quality.height],
            [26, 3],
            [30, 0],
          ]
        : [
            [16, Math.max(144, Math.min(4320, parseInt(readOptions().maxHeight) || 4320))],
            [26, 1],
            [30, 0],
          ],
    );

    const touched = new Set();
    const parts = [];
    let changed = false;

    for (const field of parseFields(bytes)) {
      const target = 0 === field.wire ? targets.get(field.no) : void 0;
      if (void 0 !== target) {
        if (readVarintValue(field.data) === target) {
          parts.push(field.raw);
        } else {
          parts.push(encodeVarint(8 * field.no), encodeVarint(target));
          changed = true;
        }
        touched.add(field.no);
      } else {
        parts.push(field.raw);
      }
    }

    for (const [fieldNo, value] of targets) {
      if (!touched.has(fieldNo)) {
        parts.push(encodeVarint(8 * fieldNo), encodeVarint(value));
        changed = true;
      }
    }
    return changed ? concatBytes(parts) : bytes;
  }

  function removeStoredKey(key, stored) {
    if (void 0 === key || void 0 === stored) return;
    const config = readStore();
    if (!Object.hasOwn(config, key)) return;
    if (JSON.stringify(config[key]) === JSON.stringify(stored)) {
      delete config[key];
      writeStore(config);
    }
  }

  // initplayback 请求：校验请求里带的密钥是不是我们存的；不匹配就回空，让客户端重协商。
  function handleInitPlaybackRequest(request, options) {
    const body = readRequestBody(request);
    if (void 0 === body || 0 === body.length) return undefined;

    const key = clientKeyFor(request);
    const stored = readStore()[key];
    const outer = fieldData(body, 3);
    const inner = outer && fieldData(outer, 5);
    if (!inner?.length) return emptyProtobufResponse();

    const candidates = stored
      ? [stored, ...(Array.isArray(stored.previous) ? stored.previous.slice(0, 3) : [])].filter(
          (entry) =>
            entry &&
            "string" == typeof entry.clientKey &&
            "string" == typeof entry.encryptKey &&
            entry.clientKey.length > 0 &&
            entry.clientKey.length <= 5500 &&
            entry.encryptKey.length > 0 &&
            entry.encryptKey.length <= 5500,
        )
      : [];
    for (const entry of candidates) {
      try {
        if (bytesEqual(inner, base64ToBytes(entry.encryptKey))) return undefined;
      } catch {}
    }

    removeStoredKey(key, stored);
    return emptyProtobufResponse();
  }

  // 只有一条 chunk 的 initplayback 请求：把画质字段改成最高档。
  function rewriteInitPlaybackBody(body) {
    const fields = parseFields(body);
    const chunks = fields.filter((field) => 2 === field.no && 2 === field.wire);
    if (1 !== chunks.length) return body;

    const chunk = chunks[0];
    const next = applyQuality(chunk.data, void 0);
    if (next === chunk.data) return body;
    return concatBytes(fields.map((field) => (field === chunk ? concatBytes([encodeVarint(18), encodeVarint(next.length), next]) : field.raw)));
  }

  // videoplayback 请求：按缓存挑一组 itag，替换请求里的 17 号字段。
  function rewriteVideoPlaybackBody(body, url) {
    const fields = parseFields(body);

    const quality = (function () {
      try {
        const match = /[?&]id=([^&]+)/.exec(url);
        if (!match) return;

        const chunk = fields.find((field) => 5 === field.no && 2 === field.wire);
        const inner = chunk && fieldData(chunk.data, 1);
        if (!inner?.length) return;

        const cached = readStore(QUALITY_KEY, MAX_QUALITY_JSON)?.[decodeURIComponent(match[1])];
        if (!isQualityEntry(cached)) return;

        const formats = [];
        const premiumFormats = [];
        for (const format of parseFields(inner)) {
          if (6 !== format.no || 2 !== format.wire) continue;
          const itagField = parseFields(format.data).find((field) => 1 === field.no && 0 === field.wire);
          if (!itagField) continue;
          const itag = readVarintValue(itagField.data);
          if (!cached.itags.includes(itag)) continue;
          formats.push(format.data);
          if (cached.premiumItags?.includes(itag)) premiumFormats.push(format.data);
        }
        return formats.length ? { height: cached.height, formats: premiumFormats.length && false !== readOptions().preferPremium ? premiumFormats : formats } : void 0;
      } catch {
        return;
      }
    })();

    const existing = fields.filter((field) => 17 === field.no && 2 === field.wire);
    const replaceFormats = quality && (existing.length !== quality.formats.length || existing.some((field, i) => !bytesEqual(field.data, quality.formats[i])));

    const parts = [];
    let sawChunk = false;
    let changed = !!replaceFormats;

    for (const field of fields) {
      if (1 === field.no && 2 === field.wire) {
        const next = applyQuality(field.data, quality);
        if (next === field.data) {
          parts.push(field.raw);
        } else {
          parts.push(encodeVarint(10), encodeVarint(next.length), next);
          changed = true;
        }
        sawChunk = true;
      } else {
        if (replaceFormats && 17 === field.no && 2 === field.wire) continue;
        parts.push(field.raw);
      }
    }

    if (!sawChunk) {
      const empty = applyQuality(new Uint8Array(), quality);
      parts.push(encodeVarint(10), encodeVarint(empty.length), empty);
      changed = true;
    }
    if (replaceFormats) {
      for (const format of quality.formats) parts.push(encodeVarint(138), encodeVarint(format.length), format);
    }
    return changed ? concatBytes(parts) : body;
  }

  // log_event 请求：删掉热更新哈希头，避免服务端用新配置覆盖模块。
  function stripHotHashHeader(request, options) {
    if (false === options.stripHotHash) return undefined;

    const headers = Object.keys(request.headers ?? {}).filter((key) => "x-youtube-hot-hash-data" === key.toLowerCase());
    if (!headers.length || readStore()[clientKeyFor(request)]?.clientKey) return undefined;

    const next = { ...request.headers };
    for (const key of headers) delete next[key];
    return { headers: next };
  }

  function handleRequest(request) {
    const path = request.url.split("?")[0];
    const options = readOptions();

    try {
      if (path.endsWith("/player/ad_break")) {
        $done(false !== options.blockPlayerAds ? emptyProtobufResponse() : undefined);
        return;
      }
      if (path.endsWith("/log_event")) {
        $done(stripHotHashHeader(request, options));
        return;
      }
      if (path.endsWith("/initplayback")) {
        let result = handleInitPlaybackRequest(request, options);
        const body = readRequestBody(request);
        if (!result && body?.length && false !== options.autoHd) {
          const rewritten = rewriteInitPlaybackBody(body);
          if (rewritten !== body) result = { body: rewritten };
        }
        $done(result);
        return;
      }
      if (path.endsWith("/videoplayback")) {
        const body = false === options.autoHd ? undefined : readRequestBody(request);
        if (body?.length) {
          const rewritten = rewriteVideoPlaybackBody(body, request.url);
          $done(rewritten !== body ? { body: rewritten } : undefined);
          return;
        }
      }
      $done(undefined);
    } catch (e) {
      $done(path.endsWith("/initplayback") ? emptyProtobufResponse() : {});
    }
  }

  //=====================================================================================
  // §12 从 config / log_event 响应里抓 UMP 密钥
  //=====================================================================================

  function extractUmpKeys() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const body = toBytes($response.body);
      if (("config" !== route && "log_event" !== route) || !body?.length || body.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }

      let current = body;
      for (const fieldNo of [1, 16, 7, 138536474, 146311580]) {
        current = fieldData(current, fieldNo, true);
        if (!current) {
          $done({});
          return;
        }
      }

      const clientKey = fieldData(current, 1, true);
      const encryptKey = fieldData(current, 2, true);
      if (clientKey?.length && encryptKey?.length && clientKey.length <= 4096 && encryptKey.length <= 4096) {
        const key = clientKeyFor($request);
        const config = readStore();
        const entry = { clientKey: clientKey.toBase64(), encryptKey: encryptKey.toBase64() };

        if (config[key]?.clientKey !== entry.clientKey || config[key]?.encryptKey !== entry.encryptKey) {
          const previous = (
            config[key]
              ? [config[key], ...(Array.isArray(config[key].previous) ? config[key].previous.slice(0, 3) : [])].filter(
                  (item) =>
                    item &&
                    "string" == typeof item.clientKey &&
                    "string" == typeof item.encryptKey &&
                    item.clientKey.length > 0 &&
                    item.clientKey.length <= 5500 &&
                    item.encryptKey.length > 0 &&
                    item.encryptKey.length <= 5500,
                )
              : []
          )
            .filter((item) => item.clientKey !== entry.clientKey || item.encryptKey !== entry.encryptKey)
            .slice(0, 3)
            .map(({ clientKey, encryptKey }) => ({ clientKey, encryptKey }));

          if (previous.length) entry.previous = previous;
          config[key] = entry;
          writeStore(config);
        }
      }
      $done({});
    } catch (e) {
      $done({});
    }
  }

  //=====================================================================================
  // §13 响应分发
  //=====================================================================================

  const RESPONSE_ROUTES = {
    "navigation/resolve_url": [
      "ResolveUrl",
      function (node, options) {
        const player = node.endpoint?.watch?.embedded?.response?.player;
        return !!player && rewritePlayer(player, options);
      },
    ],
    browse: ["Browse", filterBrowseTree],
    next: ["Next", filterBrowseTree],
    player: ["Player", rewritePlayer],
    search: ["Search", filterBrowseTree],
    "reel/reel_watch_sequence": [
      "Shorts",
      function (node, options) {
        if (false === options.blockShortsAds) return false;
        const kept = node.entries.filter((entry) => !entry.command?.reelWatchEndpoint?.adClientParams?.isAd);
        const changed = kept.length !== node.entries.length;
        if (changed) setField(node, "entries", kept);
        return changed;
      },
    ],
    guide: [
      "Guide",
      function (node, options) {
        const hidden = new Set(false === options.hidePremium ? [] : ["SPunlimited"]);
        String(options.blockGuideItems ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item) => hidden.add(item));
        if (options.blockUpload) hidden.add("FEuploads");
        if (options.blockShorts) hidden.add("FEshorts");

        let changed = false;
        walkObjects(node, (item) => {
          const items = item.rendererItems;
          if (!Array.isArray(items)) return;
          const kept = items.filter((entry) => !hidden.has(entry.iconRender?.browseId ?? entry.labelRender?.browseId));
          changed = kept.length !== items.length || changed;
          if (kept.length !== items.length) setField(item, "rendererItems", kept);
        });
        return changed;
      },
    ],
    "account/get_setting": [
      "Setting",
      function (node, options) {
        if (false === options.backgroundPlay) return false;
        let changed = false;

        walkObjects(node, (item) => {
          if (10135 !== item.categoryId) return;
          const endpoint = (value) => ({
            setClientSettingEndpoint: { settingData: { clientSettingEnum: { item: 151 }, boolValue: value } },
          });
          const exists = item.subSettings.some(
            (entry) => 151 === entry.settingBooleanRenderer?.enableServiceEndpoint?.setClientSettingEndpoint?.settingData?.clientSettingEnum?.item,
          );
          if (exists) return;
          changed = true;
          setField(item, "subSettings", [
            ...item.subSettings,
            { settingBooleanRenderer: { itemId: 0, enableServiceEndpoint: endpoint(true), disableServiceEndpoint: endpoint(false) } },
          ]);
        });

        const renderer = node.settingItems.find((item) => item.backgroundPlayBackSettingRenderer)?.backgroundPlayBackSettingRenderer;
        if (renderer) {
          changed = setField(renderer, "backgroundPlayback", true) || changed;
        } else {
          changed = true;
          setField(node, "settingItems", [
            ...node.settingItems,
            { backgroundPlayBackSettingRenderer: { backgroundPlayback: true, icon: { iconType: 1093 } } },
          ]);
        }
        return changed;
      },
    ],
    get_watch: [
      "Watch",
      function (node, options) {
        let changed = false;
        for (const item of node.contents) {
          if (item.player) changed = rewritePlayer(item.player, options) || changed;
          if (item.next) changed = filterBrowseTree(item.next, options) || changed;
        }
        return changed;
      },
    ],
  };

  function handleYouTubeiResponse() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const handler = Object.hasOwn(RESPONSE_ROUTES, route) && RESPONSE_ROUTES[route];
      const body = toBytes($response.body);
      if (!handler || Number($response.status) >= 300 || !body?.length || body.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }

      const [typeName, rewrite] = handler;
      const codec = messageCodec(typeName);
      const node = codec.fromBinary(body);
      const options = readOptions({ blockUpload: true, blockShorts: false });

      if (false !== options.autoHd) {
        const players = (function () {
          if ("Player" === typeName) return [node];
          if ("Watch" === typeName) return node.contents.map((item) => item.player).filter(Boolean);
          if ("ResolveUrl" === typeName) {
            const player = node.endpoint?.watch?.embedded?.response?.player;
            return player ? [player] : [];
          }
          return [];
        })();
        updateQualityCache(players, options);
      }

      $done(rewrite(node, options) ? { body: codec.toBinary(node) } : {});
    } catch (e) {
      $done({});
    }
  }

  async function handleUmpResponse() {
    try {
      const body = toBytes($response.body);
      if (Number($response.status) >= 300 || !body?.length || body.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }

      const contentType = Object.entries($response.headers ?? {}).find(([key]) => "content-type" === key.toLowerCase())?.[1];
      if (contentType && !/^application\/vnd\.yt-ump(?:\s*;|\s*$)/i.test(contentType)) {
        $done({});
        return;
      }

      const options = readOptions({ blockGames: true });
      const stored = readStore()[clientKeyFor($request)];
      // clientKey 本身就是 32 字节：前 16 字节做 AES-256 密钥，后 16 字节做 HMAC 密钥。
      // encryptKey 只用来校验 initplayback 请求体，不参与解密。
      const keys = (stored ? [stored, ...(Array.isArray(stored.previous) ? stored.previous.slice(0, 3) : [])] : [])
        .filter(
          (entry) =>
            entry &&
            "string" == typeof entry.clientKey &&
            "string" == typeof entry.encryptKey &&
            entry.clientKey.length > 0 &&
            entry.clientKey.length <= 5500 &&
            entry.encryptKey.length > 0 &&
            entry.encryptKey.length <= 5500,
        )
        .map((entry) => base64ToBytes(entry.clientKey))
        .filter((key) => key.length >= 16);
      if (!keys.length) throw new Error("YouTubeConfig requires a valid stored clientKey");

      const result = await decryptUmp(body, options, keys);
      if (false !== options.autoHd) updateQualityCache(result.players, options);
      $done(result.body === body ? {} : { body: result.body });
    } catch (e) {
      $done({ status: 200, headers: { "Content-Type": "text/plain" }, body: new Uint8Array() });
    }
  }

  //=====================================================================================
  // 入口：按阶段和 URL 分发
  //=====================================================================================

  (function main() {
    const request = (typeof $request !== "undefined" && $request) || {};
    const response = typeof $response !== "undefined" && $response ? $response : undefined;
    const url = (response && response.url) || request.url || "";

    if (!url) {
      $done({});
      return;
    }

    if (!response) {
      handleRequest(request);
      return;
    }

    if (/\/youtubei\/v1\/(?:config|log_event)(?:\?|$)/.test(url)) {
      extractUmpKeys();
      return;
    }
    if (/\/initplayback(?:\?|$)/.test(url)) {
      handleUmpResponse();
      return;
    }
    handleYouTubeiResponse();
  })();
})();
