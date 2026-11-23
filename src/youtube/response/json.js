  //=====================================================================================
  // §9 网页版 JSON 响应
  //
  // www.youtube.com / m.youtube.com / music.youtube.com 的 youtubei 响应是 JSON，
  // 字段名和 protobuf 的 lowerCamelCase 属性一致。这里只做保守的结构删除：
  // 认识的广告 renderer、播放器广告字段、Shorts 货架、会员徽章、AI 控件。
  // 结构对不上就原样放行，最差是某个开关不生效，不会把页面改坏。
  //=====================================================================================

  const JSON_AD_RENDERERS = new Set([
    "adSlotRenderer",
    "displayAdRenderer",
    "promotedSparklesTextRenderer",
    "promotedSparklesWebRenderer",
    "promotedVideoRenderer",
    "compactPromotedVideoRenderer",
    "compactPromotedItemRenderer",
    "brandVideoShelfRenderer",
    "videoMastheadAdV3Renderer",
    "inFeedAdLayoutRenderer",
    "searchPyvRenderer",
    "pyvRenderer",
    "bannerPromoRenderer",
    "statementBannerRenderer",
    "adsCoordinationRenderer",
    "adInfoRenderer",
    "feedNudgeRenderer",
    "adBadgeRenderer",
    "adCtaRenderer",
  ]);

  const JSON_AI_RENDERERS = new Set([
    "clarificationRenderer",
    "macroMarkersListRenderer",
    "aiSummaryRenderer",
    "aiSummaryViewModel",
  ]);

  const JSON_STORE_RENDERERS = new Set([
    "shoppingShelfRenderer",
    "productSummaryRenderer",
    "paidContentOverlayRenderer",
    "paidContentOverlayViewModel",
  ]);

  const JSON_PLAYER_AD_FIELDS = new Set(["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams"]);

  // 列表项基本都被单键装了一层：{ richItemRenderer: { content: { … } } }。
  // 删卡片时连包装一起删，否则网页会留下一个空白卡片位。
  const JSON_ITEM_WRAPPERS = new Set(["richItemRenderer", "richSectionRenderer", "content", "item", "videoRenderer", "compactVideoRenderer"]);

  // 会员徽章的 style 枚举名；本地化文案不作为网页版判定依据。
  const JSON_MEMBERS_ONLY_STYLES = ["BADGE_STYLE_TYPE_MEMBERS_ONLY"];

  // 播放器清理：播放结束推荐墙、信息卡、自动播放下一首。
  const JSON_ENDSCREEN_FIELDS = new Set(["endscreen", "endScreen"]);
  const JSON_INFO_CARD_FIELDS = new Set(["cards"]);
  const JSON_AUTOPLAY_FIELDS = new Set(["autoplay", "compactAutoplayRenderer"]);

  // 信息流清理：顶部筛选条。
  const JSON_CHIP_FIELDS = new Set(["chipCloudRenderer"]);

  // 播放页清理：评论区。
  const JSON_COMMENT_FIELDS = new Set([
    "commentsEntryPointHeaderRenderer",
    "commentsEntryPointTeaserRenderer",
    "commentsHeaderRenderer",
    "commentThreadRenderer",
    "commentSectionRenderer",
  ]);

  // 播放页清理：相关视频列表（all 档）。
  const JSON_RELATED_FIELDS = new Set(["secondaryResults", "watchNextSecondaryResultsRenderer"]);

  // 直播 / 首映徽章：同样认枚举名，不认文案。
  const JSON_LIVE_STYLES = new Set(["BADGE_STYLE_TYPE_LIVE_NOW", "BADGE_STYLE_TYPE_PREMIERE", "BADGE_STYLE_TYPE_LIVE"]);

  // 顶部按钮里要隐藏的图标。
  const JSON_TOPBAR_BLOCK_ICONS = /(CREATE|NOTIFICATIONS|UPLOAD)/;

  function jsonHasAnyKey(node, keys) {
    if (!node || "object" != typeof node || Array.isArray(node)) return false;
    for (const key of keys) if (key in node) return true;
    return false;
  }

  function jsonBadgeLabel(badge) {
    if (!badge || "object" != typeof badge) return "";
    const label = badge.metadataBadgeRenderer?.label ?? badge.label ?? badge.accessibilityData?.label;
    return "string" == typeof label ? label : "";
  }

  // 徽章样式枚举名：和 uBlock 的 .badge-style-type-members-only、第三方脚本认的
  // "BADGE_STYLE_TYPE_MEMBERS_ONLY" 是同一个东西，不随界面语言变化。
  function jsonBadgeStyle(badge) {
    if (!badge || "object" != typeof badge) return "";
    const style = badge.metadataBadgeRenderer?.style ?? badge.style;
    return "string" == typeof style ? style : "";
  }

  function jsonIsMembersOnly(node) {
    if (!node || "object" != typeof node) return false;
    for (const key of ["badges", "ownerBadges"]) {
      const list = node[key];
      if (!Array.isArray(list)) continue;
      for (const badge of list) {
        const style = jsonBadgeStyle(badge);
        // 有 style 就以它为准：文案是本地化的，不能用来判断。
        if (style) {
          if (JSON_MEMBERS_ONLY_STYLES.includes(style)) return true;
          continue;
        }
        const label = jsonBadgeLabel(badge);
        if (label && MEMBERS_ONLY_LABELS.some((text) => label.indexOf(text) >= 0)) return true;
      }
    }
    return false;
  }

  // 「继续观看」卡片：缩略图右上角带播放进度条。
  function jsonHasResumeOverlay(node) {
    const overlays = node.thumbnailOverlays;
    if (!Array.isArray(overlays)) return false;
    return overlays.some((overlay) => !!overlay && "object" == typeof overlay && "thumbnailOverlayResumePlaybackRenderer" in overlay);
  }

  // 直播 / 首映卡片：时间戳样式或徽章样式命中枚举名。
  function jsonIsLiveCard(node) {
    const overlays = Array.isArray(node.thumbnailOverlays) ? node.thumbnailOverlays : [];
    for (const overlay of overlays) {
      const style = overlay?.thumbnailOverlayTimeStatusRenderer?.style;
      if ("LIVE" === style || "UPCOMING" === style) return true;
    }
    for (const key of ["badges", "ownerBadges"]) {
      const list = node[key];
      if (!Array.isArray(list)) continue;
      for (const badge of list) if (JSON_LIVE_STYLES.has(jsonBadgeStyle(badge))) return true;
    }
    return false;
  }

  function jsonIsAdNode(node, options) {
    if (!node || "object" != typeof node || Array.isArray(node)) return false;
    if (false !== options.blockFeedAds && jsonHasAnyKey(node, JSON_AD_RENDERERS)) return true;
    if (false !== options.blockAi && jsonHasAnyKey(node, JSON_AI_RENDERERS)) return true;
    if (options.blockStore && jsonHasAnyKey(node, JSON_STORE_RENDERERS)) return true;
    if (
      false !== options.blockShortsFeed &&
      ("reelShelfRenderer" in node || "shortsLockupViewModel" in node || node.navigationEndpoint?.reelWatchEndpoint || node.onTap?.innertubeCommand?.reelWatchEndpoint)
    ) {
      return true;
    }
    if (false !== options.blockContinueWatching && jsonHasResumeOverlay(node)) return true;
    if (false !== options.blockLiveCards && jsonIsLiveCard(node)) return true;
    if (false !== options.blockMembersOnly) {
      if (jsonIsMembersOnly(node)) return true;
      // 列表项通常是 { videoRenderer: { badges } }，徽章在下一层。
      for (const key in node) {
        if (Object.hasOwn(node, key) && jsonIsMembersOnly(node[key])) return true;
      }
    }
    return false !== options.blockFeedAds && true === node.adClientParams?.isAd;
  }

  // 从上往下剥卡片包装（兼容真实网页 richItemRenderer / richSectionRenderer 附带 trackingParams 等元数据键），
  // 命中广告 / Shorts / 继续观看 / 直播 / 会员视频就整项删掉，避免留下空白占位。
  function jsonIsCardItem(node, options) {
    let current = node;
    for (let depth = 0; current && "object" == typeof current && !Array.isArray(current) && depth < 6; depth++) {
      if (jsonIsAdNode(current, options)) return true;
      const keys = Object.keys(current);
      if (1 === keys.length && JSON_ITEM_WRAPPERS.has(keys[0])) {
        current = current[keys[0]];
        continue;
      }
      // richItemRenderer / richSectionRenderer 内部通常是 { content: {...}, trackingParams: "..." }。
      if (!current.videoId) {
        if (current.content && "object" == typeof current.content && !Array.isArray(current.content)) {
          current = current.content;
          continue;
        }
        if (current.item && "object" == typeof current.item && !Array.isArray(current.item)) {
          current = current.item;
          continue;
        }
      }
      return false;
    }
    return false;
  }

  function jsonIsBlockedTopbarButton(entry) {
    if (!entry || "object" != typeof entry) return false;
    if (entry.notificationTopbarButtonRenderer) return true;
    const btn = entry.topbarButtonRenderer ?? entry.topbarMenuButtonRenderer ?? entry.buttonRenderer;
    if (!btn || "object" != typeof btn) return false;
    const icon = btn.icon?.ytIcon?.iconType?.iconType ?? btn.icon?.iconType ?? btn.menuRequest?.signalServiceEndpoint?.signal ?? "";
    return JSON_TOPBAR_BLOCK_ICONS.test(String(icon));
  }

  function jsonSmartSkip(button) {
    if (!button || "object" != typeof button) return false;
    let changed = false;
    if (button.controller && true === button.controller.promotionMode) {
      button.controller.promotionMode = false;
      changed = true;
    }
    const items = [button].concat(Array.isArray(button.actions?.items) ? button.actions.items : []);
    for (const item of items) {
      if (!item || "object" != typeof item) continue;
      if (void 0 !== item.displayLimit && 2147483647 !== item.displayLimit) {
        item.displayLimit = 2147483647;
        changed = true;
      }
    }
    return changed;
  }

  // 递归删除广告 / Shorts / 会员视频 / AI 控件；返回是否真的改过。
  function jsonPruneTree(root, options, routeFilters = {}) {
    let changed = false;
    const hiddenGuideItems = routeFilters.guide ? new Set(options.hiddenGuideItems ?? []) : null;

    function visit(node) {
      if (!node || "object" != typeof node) return;
      if (Array.isArray(node)) {
        // 原地双指针压缩，避免多次 splice 的 O(n^2) 搬移开销。
        let write = 0;
        for (let i = 0; i < node.length; i++) {
          const entry = node[i];
          const guideId = hiddenGuideItems && entry?.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
          if (jsonIsCardItem(entry, options) || (guideId && hiddenGuideItems.has(guideId))) {
            changed = true;
            continue;
          }
          visit(entry);
          if (write !== i) node[write] = entry;
          write++;
        }
        if (write !== node.length) node.length = write;
        return;
      }

      for (const key of Object.keys(node)) {
        const value = node[key];
        if (routeFilters.related && JSON_RELATED_FIELDS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (routeFilters.related && "playerOverlayRenderer" === key && value && "object" == typeof value && value.related) {
          delete value.related;
          changed = true;
        }
        if (false !== options.blockFeedAds && (JSON_PLAYER_AD_FIELDS.has(key) || JSON_AD_RENDERERS.has(key))) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.blockAi && JSON_AI_RENDERERS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (options.blockStore && JSON_STORE_RENDERERS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.blockShortsFeed && ("reelShelfRenderer" === key || "shortsLockupViewModel" === key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.blockEndscreen && JSON_ENDSCREEN_FIELDS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (
          false !== options.blockInfoCards &&
          JSON_INFO_CARD_FIELDS.has(key) &&
          (routeFilters.player || (value && "object" == typeof value && "cardCollectionRenderer" in value))
        ) {
          delete node[key];
          changed = true;
          continue;
        }
        if (options.blockAutoplay && JSON_AUTOPLAY_FIELDS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.blockChipCloud && JSON_CHIP_FIELDS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.blockComments && JSON_COMMENT_FIELDS.has(key)) {
          delete node[key];
          changed = true;
          continue;
        }
        // 评论区偶尔是一个带 sectionIdentifier 的 itemSectionRenderer。
        if (false !== options.blockComments && "comment-item-section" === value?.sectionIdentifier) {
          delete node[key];
          changed = true;
          continue;
        }
        if (false !== options.jumpAhead && "smartSkipButton" === key) changed = jsonSmartSkip(value) || changed;
        // 会员视频节点通常直接挂在 content / item 上，在父对象这一层删掉；避开播放页标题栏和频道头部。
        if (
          false !== options.blockMembersOnly &&
          "videoPrimaryInfoRenderer" !== key &&
          !key.endsWith("HeaderRenderer") &&
          jsonIsMembersOnly(value)
        ) {
          delete node[key];
          changed = true;
          continue;
        }
        if (routeFilters.topbar && "topbarButtons" === key && Array.isArray(value)) {
          const kept = value.filter((entry) => !jsonIsBlockedTopbarButton(entry));
          if (kept.length !== value.length) {
            node[key] = kept;
            changed = true;
          }
          continue;
        }
        visit(value);
      }
    }

    visit(root);
    return changed;
  }

  // 网页版侧栏：guideEntryRenderer 的 browseId 在 hiddenGuideItems 里就删。
  function jsonFilterGuide(root, options) {
    const hidden = new Set(options.hiddenGuideItems ?? []);
    if (!hidden.size) return false;
    let changed = false;

    function visit(node) {
      if (!node || "object" != typeof node) return;
      if (Array.isArray(node)) {
        let write = 0;
        for (let i = 0; i < node.length; i++) {
          const entry = node[i];
          const id = entry?.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
          if (id && hidden.has(id)) {
            changed = true;
            continue;
          }
          visit(entry);
          if (write !== i) node[write] = entry;
          write++;
        }
        if (write !== node.length) node.length = write;
        return;
      }
      for (const key of Object.keys(node)) visit(node[key]);
    }

    visit(root);
    return changed;
  }

  // 字幕翻译：与 App 版逻辑一致，但直接操作 JSON 属性。
  function jsonApplyCaptionTranslation(player, lang) {
    const renderer = player?.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    let changed = false;
    let bestIndex = 0;
    let bestScore = 0;
    const target = String(lang).toLowerCase();
    for (let i = 0; i < tracks.length; i++) {
      const code = String(tracks[i]?.languageCode ?? "").toLowerCase();
      const score = code === target ? 2 : /^en(?:-|$)/.test(code) ? 1 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      if (true !== tracks[i]?.isTranslatable) {
        tracks[i].isTranslatable = true;
        changed = true;
      }
    }

    let selected = bestIndex;
    if (bestScore !== 2) {
      const baseUrl = String(tracks[bestIndex]?.baseUrl ?? "");
      if (!baseUrl) return changed;
      const translated = {
        baseUrl: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}tlang=${encodeURIComponent(lang)}`,
        name: { runs: [{ text: `@Enhance (${lang})` }] },
        vssId: `.${lang}`,
        languageCode: lang,
        isTranslatable: true,
      };
      selected = tracks.length;
      tracks.push(translated);
      changed = true;
    }

    if (renderer.defaultCaptionTrackIndex !== selected) {
      renderer.defaultCaptionTrackIndex = selected;
      changed = true;
    }
    if (Array.isArray(renderer.audioTracks)) {
      for (const audio of renderer.audioTracks) {
        if (!audio || "object" != typeof audio) continue;
        const indices = Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
        if (!indices.includes(selected)) {
          audio.captionTrackIndices = [...indices, selected];
          changed = true;
        }
        if (audio.defaultCaptionTrackIndex !== selected) {
          audio.defaultCaptionTrackIndex = selected;
          changed = true;
        }
        if (audio.captionsInitialState !== 3) {
          audio.captionsInitialState = 3;
          changed = true;
        }
      }
    }
    return changed;
  }

  // 自动生成（ASR）字幕轨：kind=asr 或 vssId 以 "a." 开头，和界面语言无关。
  function jsonIsAutoCaptionTrack(track) {
    return "asr" === String(track?.kind ?? "").toLowerCase() || String(track?.vssId ?? "").startsWith("a.");
  }

  function jsonStripAutoCaptionTracks(player) {
    const renderer = player?.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    const kept = [];
    const indexMap = new Array(tracks.length);
    for (let i = 0; i < tracks.length; i++) {
      if (jsonIsAutoCaptionTrack(tracks[i])) {
        indexMap[i] = -1;
      } else {
        indexMap[i] = kept.length;
        kept.push(tracks[i]);
      }
    }
    if (kept.length === tracks.length) return false;

    renderer.captionTracks = kept;
    const remapIndex = (idx) => (Number.isInteger(idx) && idx >= 0 && idx < tracks.length ? indexMap[idx] : -1);

    const selected = renderer.defaultCaptionTrackIndex;
    if (void 0 !== selected) {
      if (!kept.length) {
        delete renderer.defaultCaptionTrackIndex;
      } else {
        const mapped = remapIndex(selected);
        renderer.defaultCaptionTrackIndex = mapped >= 0 ? mapped : Math.min(Math.max(0, selected), kept.length - 1);
      }
    }

    for (const audio of Array.isArray(renderer.audioTracks) ? renderer.audioTracks : []) {
      if (!audio || "object" != typeof audio) continue;
      if (Array.isArray(audio.captionTrackIndices)) {
        audio.captionTrackIndices = audio.captionTrackIndices.map(remapIndex).filter((idx) => idx >= 0);
      }
      if (void 0 !== audio.defaultCaptionTrackIndex) {
        if (!kept.length) {
          delete audio.defaultCaptionTrackIndex;
          if (true === audio.hasDefaultTrack) audio.hasDefaultTrack = false;
        } else {
          const mapped = remapIndex(audio.defaultCaptionTrackIndex);
          audio.defaultCaptionTrackIndex = mapped >= 0 ? mapped : Math.min(Math.max(0, audio.defaultCaptionTrackIndex), kept.length - 1);
        }
      }
      if (void 0 !== audio.forcedCaptionTrackIndex) {
        const mapped = remapIndex(audio.forcedCaptionTrackIndex);
        if (mapped < 0) {
          delete audio.forcedCaptionTrackIndex;
          if (true === audio.hasForcedTrack) audio.hasForcedTrack = false;
        } else {
          audio.forcedCaptionTrackIndex = mapped;
        }
      }
      if (!kept.length && void 0 !== audio.captionsInitialState) audio.captionsInitialState = 0;
    }

    return true;
  }

  function jsonForceCaptionTrack(player) {
    const renderer = player?.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    let selected = renderer.defaultCaptionTrackIndex;
    if (!Number.isInteger(selected) || selected < 0 || selected >= tracks.length) selected = 0;

    let changed = false;
    if (renderer.defaultCaptionTrackIndex !== selected) {
      renderer.defaultCaptionTrackIndex = selected;
      changed = true;
    }
    for (const audio of Array.isArray(renderer.audioTracks) ? renderer.audioTracks : []) {
      if (!audio || "object" != typeof audio) continue;
      const indices = Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
      if (!indices.includes(selected)) {
        audio.captionTrackIndices = [...indices, selected];
        changed = true;
      }
      if (audio.defaultCaptionTrackIndex !== selected) {
        audio.defaultCaptionTrackIndex = selected;
        changed = true;
      }
      if (audio.captionsInitialState !== 3) {
        audio.captionsInitialState = 3;
        changed = true;
      }
    }
    return changed;
  }

  // 编码偏好：过滤 adaptiveFormats 里的视频格式，音频不动。
  // 目标编码一个都不剩时宁可不改，避免把视频轨删光。
  function jsonApplyCodec(streamingData, codec) {
    const formats = streamingData?.adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length || !codec || "any" === codec) return false;

    const isVideo = (format) => String(format?.mimeType ?? "").startsWith("video/");
    const kept = formats.filter((format) => !isVideo(format) || codecAllowed(format.mimeType, codec));
    if (kept.length === formats.length || !kept.some(isVideo)) return false;
    streamingData.adaptiveFormats = kept;
    return true;
  }

  // YouTube Music：只保留码率最高的音频格式。
  function jsonLockAudioQuality(streamingData) {
    const formats = streamingData?.adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length) return false;

    const isAudio = (format) => String(format?.mimeType ?? "").startsWith("audio/");
    let best = 0;
    for (const format of formats) {
      const bitrate = parseInt(format?.bitrate, 10);
      if (isAudio(format) && Number.isFinite(bitrate) && bitrate > best) best = bitrate;
    }
    if (!best) return false;

    const kept = formats.filter((format) => !isAudio(format) || parseInt(format.bitrate, 10) === best);
    if (kept.length === formats.length) return false;
    streamingData.adaptiveFormats = kept;
    return true;
  }

  // 网页播放器按 adaptiveFormats 里实际给的档位选画质。只保留目标高度
  // （max_height 与最高可用值取较小者），音频格式不动。
  function jsonApplyQuality(streamingData, maxHeight) {
    const formats = streamingData?.adaptiveFormats;
    if (!Array.isArray(formats) || !formats.length) return false;

    const cap = Math.max(144, Math.min(4320, parseInt(maxHeight, 10) || 4320));
    // 选「不超过 max_height 的最高档」；如果所有视频档都高于上限，
    // 退到最低的视频档，避免把视频轨全删光只剩音频。
    let target = 0;
    let lowest = 0;
    for (const format of formats) {
      const height = parseInt(format?.height, 10);
      if (!Number.isFinite(height) || height <= 0) continue;
      if (!lowest || height < lowest) lowest = height;
      if (height <= cap && height > target) target = height;
    }
    if (!target) target = lowest;
    if (!target) return false;
    const kept = formats.filter((format) => {
      const height = parseInt(format?.height, 10);
      return !Number.isFinite(height) || height === target;
    });
    if (kept.length === formats.length) return false;
    streamingData.adaptiveFormats = kept;
    return true;
  }

  function jsonRewritePlayerFields(player, options, isMusic) {
    let changed = false;

    if (options.captionLang && "off" !== String(options.captionLang).toLowerCase()) {
      try {
        changed = jsonApplyCaptionTranslation(player, options.captionLang) || changed;
      } catch (e) {
        // 字幕结构异常时只跳过字幕，不影响广告清理。
      }
    }

    // 字幕开关：off 去掉自动生成字幕轨（不再自动开字幕），force 强制开启。
    try {
      if (options.stripAutoCaptions) changed = jsonStripAutoCaptionTracks(player) || changed;
      else if (options.forceCaptions) changed = jsonForceCaptionTrack(player) || changed;
    } catch (e) {
      // ignore
    }

    // 先按编码偏好过滤视频轨，再按 maxHeight 选最高档（避免 4K VP9/AV1 先把 1080p AVC 删光导致编码偏好失效）。
    if (player.streamingData) {
      try {
        if ("any" !== options.videoCodec) changed = jsonApplyCodec(player.streamingData, options.videoCodec) || changed;
        if (false !== options.autoHd) changed = jsonApplyQuality(player.streamingData, options.maxHeight) || changed;
        if (options.musicCleanup && isMusic) changed = jsonLockAudioQuality(player.streamingData) || changed;
      } catch (e) {
        // ignore
      }
    }

    const speedConfig = player.playerConfig?.granularVariableSpeedConfig;
    const maxRate = false === options.maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(options.maxSpeed, 10) || 4)) * 100;
    if (
      maxRate > 0 &&
      speedConfig &&
      "number" == typeof speedConfig.maximumPlaybackRate &&
      speedConfig.maximumPlaybackRate > 0 &&
      speedConfig.maximumPlaybackRate < maxRate
    ) {
      speedConfig.maximumPlaybackRate = maxRate;
      changed = true;
    }

    // 网页版不一定带这两个结构；带了才改，不凭空插入。
    const playability = player.playabilityStatus;
    if (playability && "object" == typeof playability) {
      if (false !== options.pip && playability.pictureInPictureRender && "object" == typeof playability.pictureInPictureRender) {
        const render = playability.pictureInPictureRender;
        const ability = render.pictureInPictureAbility ?? (render.pictureInPictureAbility = {});
        if (true !== ability.active) {
          ability.active = true;
          changed = true;
        }
        if (0 !== ability.f4) {
          ability.f4 = 0;
          changed = true;
        }
        if (0 !== ability.f6) {
          ability.f6 = 0;
          changed = true;
        }
        if (1 !== ability.f8) {
          ability.f8 = 1;
          changed = true;
        }
      }
      if (false !== options.backgroundPlay && playability.backgroundPlayerRender && "object" == typeof playability.backgroundPlayerRender) {
        const render = playability.backgroundPlayerRender;
        const ability = render.backgroundAbility ?? (render.backgroundAbility = {});
        if (true !== ability.active) {
          ability.active = true;
          changed = true;
        }
      }
    }

    return changed;
  }

  function rewriteJsonRoute(route, data, options, isMusic = false) {
    if ("player" === route) {
      const pruned = jsonPruneTree(data, options, { player: true });
      return jsonRewritePlayerFields(data, options, isMusic) || pruned;
    }
    if ("guide" === route) return jsonFilterGuide(data, options);

    if ("navigation/resolve_url" === route) {
      let changed = jsonPruneTree(data, options, { player: true });
      const player = data?.endpoint?.watch?.embedded?.response?.player;
      if (player) changed = jsonRewritePlayerFields(player, options, isMusic) || changed;
      return changed;
    }

    if ("get_watch" === route) {
      // 整棵树只遍历一趟，带齐 guide / related / topbar / player 过滤；随后仅补跑 player 专属字段改写。
      let changed = jsonPruneTree(data, options, {
        guide: true,
        related: options.blockRelatedVideos,
        topbar: options.webCleanup,
        player: true,
      });
      for (const item of data?.contents ?? []) {
        if (item?.player) changed = jsonRewritePlayerFields(item.player, options, isMusic) || changed;
      }
      return changed;
    }

    // browse / next / search / reel/reel_watch_sequence 共用一趟树遍历；
    // 侧栏、相关视频和顶栏过滤在同一趟里执行。
    return jsonPruneTree(data, options, {
      guide: true,
      related: options.blockRelatedVideos,
      topbar: options.webCleanup,
    });
  }
