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

  function jsonIsMembersOnly(node) {
    if (!node || "object" != typeof node) return false;
    for (const key of ["badges", "ownerBadges"]) {
      const list = node[key];
      if (!Array.isArray(list)) continue;
      for (const badge of list) {
        const label = jsonBadgeLabel(badge);
        if (label && MEMBERS_ONLY_LABELS.some((text) => label.indexOf(text) >= 0)) return true;
      }
    }
    return false;
  }

  function jsonIsAdNode(node, options) {
    if (!node || "object" != typeof node || Array.isArray(node)) return false;
    if (false !== options.blockFeedAds && jsonHasAnyKey(node, JSON_AD_RENDERERS)) return true;
    if (false !== options.blockAi && jsonHasAnyKey(node, JSON_AI_RENDERERS)) return true;
    if (options.blockStore && jsonHasAnyKey(node, JSON_STORE_RENDERERS)) return true;
    if (false !== options.blockShortsFeed && ("reelShelfRenderer" in node || "shortsLockupViewModel" in node)) return true;
    if (false !== options.blockMembersOnly) {
      if (jsonIsMembersOnly(node)) return true;
      // 列表项通常是 { videoRenderer: { badges } }，徽章在下一层。
      for (const key of Object.keys(node)) {
        if (jsonIsMembersOnly(node[key])) return true;
      }
    }
    return false !== options.blockFeedAds && true === node.adClientParams?.isAd;
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
  function jsonPruneTree(root, options) {
    let changed = false;

    function visit(node) {
      if (!node || "object" != typeof node) return;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          if (jsonIsAdNode(node[i], options)) {
            node.splice(i, 1);
            changed = true;
            continue;
          }
          visit(node[i]);
        }
        return;
      }

      for (const key of Object.keys(node)) {
        const value = node[key];
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
        if (false !== options.jumpAhead && "smartSkipButton" === key) changed = jsonSmartSkip(value) || changed;
        // 会员视频节点通常直接挂在 content / item 上，在父对象这一层删掉。
        if (false !== options.blockMembersOnly && jsonIsMembersOnly(value)) {
          delete node[key];
          changed = true;
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
        for (let i = node.length - 1; i >= 0; i--) {
          const entry = node[i];
          const id = entry?.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
          if (id && hidden.has(id)) {
            node.splice(i, 1);
            changed = true;
            continue;
          }
          visit(entry);
        }
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

  function jsonRewritePlayer(player, options) {
    let changed = jsonPruneTree(player, options);

    if (options.captionLang && "off" !== String(options.captionLang).toLowerCase()) {
      try {
        changed = jsonApplyCaptionTranslation(player, options.captionLang) || changed;
      } catch (e) {
        // 字幕结构异常时只跳过字幕，不影响广告清理。
      }
    }

    if (false !== options.autoHd && player.streamingData) {
      changed = jsonApplyQuality(player.streamingData, options.maxHeight) || changed;
    }

    const speedConfig = player.playerConfig?.granularVariableSpeedConfig;
    const maxRate = false === options.maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(options.maxSpeed) || 4)) * 100;
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

  function rewriteJsonRoute(route, data, options) {
    if ("player" === route) return jsonRewritePlayer(data, options);
    if ("guide" === route) return jsonFilterGuide(data, options);

    if ("navigation/resolve_url" === route) {
      let changed = jsonPruneTree(data, options);
      const player = data?.endpoint?.watch?.embedded?.response?.player;
      if (player) changed = jsonRewritePlayer(player, options) || changed;
      return changed;
    }

    if ("get_watch" === route) {
      let changed = jsonPruneTree(data, options);
      for (const item of data?.contents ?? []) {
        if (item?.player) changed = jsonRewritePlayer(item.player, options) || changed;
        if (item?.next) changed = jsonPruneTree(item.next, options) || changed;
      }
      return changed;
    }

    // browse / next / search / reel/reel_watch_sequence 共用同一套 renderer 过滤；
    // 侧栏偶尔也塞在 browse 响应里，所以 guide 过滤一起跑。
    let changed = jsonPruneTree(data, options);
    changed = jsonFilterGuide(data, options) || changed;
    return changed;
  }
