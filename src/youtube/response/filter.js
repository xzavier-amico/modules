  // §8 广告与推广位过滤
  //=====================================================================================


  // 复用解码器；会员徽章文案最长二十多个字节，超过阈值的字段不可能是徽章本身。
  const looseUtf8 = new TextDecoder("utf-8");
  const MAX_MEMBERS_LABEL_BYTES = 64;


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

  // 会员专属徽章：按文案在原始字节里逐层找。
  function hasMembersOnlyBadge(node) {
    try {
      const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
      if (!bytes || !bytes.length) return false;

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
            if (length <= MAX_MEMBERS_LABEL_BYTES) {
              try {
                if (MEMBERS_ONLY_LABELS.includes(strictUtf8.decode(chunk))) return true;
              } catch {}
            }
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
      const text = looseUtf8.decode(bytes);
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

      if (false !== options.blockFeedAds && field.data.length >= PAGEAD_MARKER.length && containsBytes(field.data)) return true;
      if (false !== options.blockFeedAds && 325515470 === field.no && isPremiumTab(field.data)) return true;
      if (options.blockStore && 400157044 === field.no) return true;
      if (false !== options.blockFeedAds && 455507059 === field.no) return true;
      if (options.blockVerticalLive && 519005951 === field.no && field.data.length >= VERTICAL_LIVE_ICON.length && containsBytes(field.data, VERTICAL_LIVE_ICON)) return true;
      if (312131490 === field.no) {
        if (options.blockGames && field.data.length >= MINI_GAME_MARKER.length && containsBytes(field.data, MINI_GAME_MARKER)) return true;
        if (options.blockStore && field.data.length >= SHOPPING_LIST_MARKER.length && containsBytes(field.data, SHOPPING_LIST_MARKER)) return true;
      }
    }
    return false;
  }

  // 遍历树时每个节点都会走 stripAiControls；先用一次字段扫描判断有没有目标字段，
  // 没有就跳过对应的 rewriteUnknownField，避免对每个节点白跑十几遍。
  function hasUnknownField(obj, fieldNo) {
    const fields = unknownFields(obj);
    for (let i = 0; i < fields.length; i += 1) {
      if (fields[i].no === fieldNo && fields[i].wire === 2) return true;
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

      if (node.playerOverlays?.renderer && hasUnknownField(node.playerOverlays.renderer, 37)) {
        changed = rewriteUnknownField(node.playerOverlays.renderer, 37, dropVideoAds) || changed;
      }
      if (hasUnknownField(node, 216561405)) changed = rewriteUnknownField(node, 216561405, (bytes) => rewritePath(bytes, [1], dropVideoAds)) || changed;
      if (hasUnknownField(node, 386137609)) changed = rewriteUnknownField(node, 386137609, dropPlayerAdButtons) || changed;
      if (hasUnknownField(node, 408379376)) changed = rewriteUnknownField(node, 408379376, dropSpeedMenuPair) || changed;

      if (node.element?.data && hasUnknownField(node.element.data, 2185)) {
        changed = rewriteUnknownField(node.element.data, 2185, dropShortVideoButtons) || changed;
      }
      if (node.videoLockup && hasUnknownField(node.videoLockup, 18)) {
        changed = rewriteUnknownField(node.videoLockup, 18, dropAiSummary) || changed;
      }
      if (node.videoContent?.videoLockup && hasUnknownField(node, 6)) {
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
      maxSpeed: 4,
      hidePremium: true,
      blockFeedAds: true,
      blockShortsFeed: false,
      blockMembersOnly: false,
      ...(options || {}),
    };

    let changed = rewriteSpeedMenu(root, opts.maxSpeed, opts.hidePremium);

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
      for (const key in node) {
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

  // 字幕翻译：在原字幕轨道后面补一条带 tlang 的翻译轨道，并把它设为默认。
  // 目标语言本身就在轨道列表里时直接选中它，不再重复添加。
  function applyCaptionTranslation(player, lang) {
    const renderer = player.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    let changed = false;
    let bestIndex = 0;
    let bestScore = 0;
    const target = String(lang).toLowerCase();
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const code = String(track.languageCode ?? "").toLowerCase();
      const score = code === target ? 2 : /^en(?:-|$)/.test(code) ? 1 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      if (track.isTranslatable !== true) changed = setField(track, "isTranslatable", true) || changed;
    }

    let selected = bestIndex;
    if (bestScore !== 2) {
      const base = tracks[bestIndex];
      const baseUrl = String(base.baseUrl ?? "");
      if (!baseUrl) return changed;
      const translated = {
        baseUrl: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}tlang=${encodeURIComponent(lang)}`,
        name: { runs: [{ text: `@Enhance (${lang})` }] },
        vssId: `.${lang}`,
        languageCode: lang,
        isTranslatable: true,
      };
      selected = tracks.length;
      changed = setField(renderer, "captionTracks", [...tracks, translated]) || changed;
    }

    changed = setField(renderer, "defaultCaptionTrackIndex", selected) || changed;
    if (Array.isArray(renderer.audioTracks)) {
      for (const audio of renderer.audioTracks) {
        const indices = Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
        if (!indices.includes(selected)) changed = setField(audio, "captionTrackIndices", [...indices, selected]) || changed;
        changed = setField(audio, "defaultCaptionTrackIndex", selected) || changed;
        changed = setField(audio, "captionsInitialState", 3) || changed;
      }
    }
    return changed;
  }

  function rewritePlayer(player, options) {
    let changed = filterBrowseTree(player, options);

    if (options.captionLang && "off" !== String(options.captionLang).toLowerCase()) {
      // 字幕轨道结构异常时只跳过字幕，不能连累广告清理。
      try {
        changed = applyCaptionTranslation(player, options.captionLang) || changed;
      } catch (e) {
        // ignore
      }
    }

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
