  // §8 广告与推广位过滤
  //=====================================================================================

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
          const maxRate = false === maxSpeed ? 0 : Math.max(2, Math.min(4, parseInt(maxSpeed, 10) || 4));
          if (maxRate > 0 && currentRate < maxRate) {
            const encodedRate = new Uint8Array(4);
            new DataView(encodedRate.buffer).setFloat32(0, maxRate, true);
            next = concatBytes(fields.map((field) => (field === rateField ? concatBytes([encodeVarint(45), encodedRate]) : field.raw)));
          }

          if (false === hidePremium) return next;
          return rewritePath(next, [10, 1674], (chunk) => {
            const inner = parseFields(chunk);
            const kept = inner.filter((field) => 3 !== field.no || 2 !== field.wire || !containsBytes(field.data, PREMIUM_TAB_MARKER));
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

  function hasAnyMarkerBytes(bytes, markers) {
    if (!bytes || !bytes.length) return false;
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (bytes.length >= marker.length && containsBytes(bytes, marker)) return true;
    }
    return false;
  }

  function isMembersLabelBytes(chunk) {
    const len = chunk.length;
    if (len > MAX_MEMBERS_LABEL_BYTES) return false;
    for (let i = 0; i < MEMBERS_ONLY_LABEL_BYTES.length; i++) {
      const target = MEMBERS_ONLY_LABEL_BYTES[i];
      if (len === target.length && bytesEqual(chunk, target)) return true;
    }
    return false;
  }

  // 在原始 protobuf 字节里统计精确匹配会员徽章文案的字段数（达到 limit 即早停）。
  // 先用原生 indexOf 做快筛，内部直接按字节比较，完全消除 TextDecoder 与异常抛出开销。
  function countMembersOnlyBadges(bytes, limit = 1) {
    if (!hasAnyMarkerBytes(bytes, MEMBERS_ONLY_LABEL_BYTES)) return 0;
    let count = 0;
    function scan(buffer, depth) {
      if (depth > 14 || count >= limit) return;
      let offset = 0;
      while (offset < buffer.length && count < limit) {
        let tag = 0;
        let shift = 0;
        let byte;
        do {
          if (offset >= buffer.length) return;
          byte = buffer[offset++];
          tag += (byte & 127) * 2 ** shift;
          shift += 7;
          if (shift > 35) return;
        } while (byte & 128);

        const wireType = tag % 8;
        if (wireType === 0) {
          do {
            if (offset >= buffer.length) return;
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
            if (offset >= buffer.length) return;
            byte = buffer[offset++];
            length += (byte & 127) * 2 ** shift;
            shift += 7;
            if (shift > 35) return;
          } while (byte & 128);
          if (offset + length > buffer.length) return;
          const chunk = buffer.subarray(offset, offset + length);
          if (isMembersLabelBytes(chunk)) {
            count++;
            if (count >= limit) return;
          } else if (length >= 2) {
            scan(chunk, depth + 1);
          }
          offset += length;
        } else {
          return;
        }
      }
    }
    try {
      scan(bytes, 0);
    } catch {
      return count;
    }
    return count;
  }

  // 会员专属徽章：按精确字节文案在原始 protobuf 树里找。
  function hasMembersOnlyBadge(node) {
    const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
    return !!bytes && bytes.length > 0 && countMembersOnlyBadges(bytes, 1) > 0;
  }

  // 一个卡片/货架里的视频是否全都是会员专属（混排货架不能整块删）。
  // 同时识别 /vi/ 和 /vi_webp/ 缩略图，并用精确 protobuf 字段匹配计数避免被无障碍文案/标题重复计数。
  function isAllMembersOnly(node) {
    try {
      const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
      if (!bytes || !bytes.length) return false;
      const text = looseUtf8.decode(bytes);
      const re = /\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//g;
      const unique = new Set();
      let match;
      while ((match = re.exec(text))) unique.add(match[1]);
      if (!unique.size) return countMembersOnlyBadges(bytes, 1) > 0;
      if (1 === unique.size) return true;
      return countMembersOnlyBadges(bytes, unique.size) >= unique.size;
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

  // 在节点原始字节里找标记。只对列表项和货架调用，避免在大响应顶层做整块扫描。
  function hasMarker(node, markers) {
    const bytes = node && node[WIRE_STATE] && node[WIRE_STATE].bytes;
    if (!bytes || !bytes.length) return false;
    for (const marker of markers) {
      if (bytes.length >= marker.length && containsBytes(bytes, marker)) return true;
    }
    return false;
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

  // 一条信息流节点是不是广告。mayHavePageAd 由列表项外层预检传入，避免每个子节点重复扫 /pagead/。
  function isFeedAdNode(node, options, mayHavePageAd = true) {
    if (false !== options.blockFeedAds || options.blockStore) {
      const layout = node.layoutRender?.eml?.split("|")[0];
      if (layout && ((false !== options.blockFeedAds && FEED_AD_LAYOUT.test(layout)) || (options.blockStore && SHOPPING_LAYOUT.test(layout)))) return true;
    }
    if (options.blockStore && node.shoppingShelf) return true;
    if (false !== options.blockFeedAds && node.sponsoredVideo) return true;
    if (false !== options.blockFeedAds && node.sponsoredDisplay) return true;
    if (options.blockVerticalLive && node.videoLockup && isVerticalLiveLockup(node.videoLockup)) return true;
    if (false !== options.blockMembersOnly && node.videoLockup && hasMembersOnlyBadge(node.videoLockup)) return true;

    const fields = unknownFields(node);
    const checkPageAd = mayHavePageAd && false !== options.blockFeedAds;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (2 !== field.wire) continue;
      const no = field.no;

      if (false !== options.blockFeedAds && 455507059 === no) return true;
      if (options.blockStore && 400157044 === no) return true;
      if (false !== options.blockFeedAds && 325515470 === no && isPremiumTab(field.data)) return true;
      if (options.blockVerticalLive && 519005951 === no && field.data.length >= VERTICAL_LIVE_ICON.length && containsBytes(field.data, VERTICAL_LIVE_ICON)) return true;
      if (312131490 === no) {
        if (options.blockGames && field.data.length >= MINI_GAME_MARKER.length && containsBytes(field.data, MINI_GAME_MARKER)) return true;
        if (options.blockStore && field.data.length >= SHOPPING_LIST_MARKER.length && containsBytes(field.data, SHOPPING_LIST_MARKER)) return true;
      }
      if (checkPageAd && field.data.length >= PAGEAD_MARKER.length && containsBytes(field.data)) return true;
    }
    return false;
  }

  function hasUnknownField(obj, fieldNo) {
    const fields = unknownFields(obj);
    for (let i = 0; i < fields.length; i += 1) {
      if (fields[i].no === fieldNo && fields[i].wire === 2) return true;
    }
    return false;
  }

  // 删掉 Ask / AI 摘要相关的控件。单趟扫描节点未知字段号，避免重复遍历 unknownFields。
  function stripAiControls(node) {
    let changed = false;
    try {
      if (node.engagementPanels?.length) {
        const panels = node.engagementPanels.filter((panel) => {
          const renderer = panel.renderer;
          return !renderer || !unknownFields(renderer).some((field) => 1 === field.no && 2 === field.wire && bytesEqual(field.data, ASK_AI_MARKER));
        });
        changed = setField(node, "engagementPanels", panels) || changed;
        for (const panel of panels) {
          if (!panel.renderer || !hasUnknownField(panel.renderer, 10)) continue;
          changed =
            rewriteUnknownField(panel.renderer, 10, (bytes) =>
              matchesPath(bytes, [260791572, 1, 153515154, 172660663, 1, 168777401, 5, 413471385, 1, 2553, 997, 3, 3, 170382688, 1, 169495254, 138681778, 1]) ? void 0 : bytes,
            ) || changed;
        }
      }

      if (node.playerOverlays?.renderer && hasUnknownField(node.playerOverlays.renderer, 37)) {
        changed = rewriteUnknownField(node.playerOverlays.renderer, 37, dropVideoAds) || changed;
      }

      const fields = unknownFields(node);
      if (fields.length) {
        let mask = 0;
        for (let i = 0; i < fields.length; i++) {
          const field = fields[i];
          if (2 !== field.wire) continue;
          if (216561405 === field.no) mask |= 1;
          else if (386137609 === field.no) mask |= 2;
          else if (408379376 === field.no) mask |= 4;
          else if (6 === field.no) mask |= 8;
        }
        if (mask & 1) changed = rewriteUnknownField(node, 216561405, (bytes) => rewritePath(bytes, [1], dropVideoAds)) || changed;
        if (mask & 2) changed = rewriteUnknownField(node, 386137609, dropPlayerAdButtons) || changed;
        if (mask & 4) changed = rewriteUnknownField(node, 408379376, dropSpeedMenuPair) || changed;
        if (mask & 8 && node.videoContent?.videoLockup) {
          changed =
            rewriteUnknownField(node, 6, (bytes) =>
              rewritePath(bytes, [188490103], (inner) => rewriteRepeatedField(inner, 1, (item) => (matchesPath(item, [1], AI_SUMMARY_MARKER, true) ? void 0 : item))),
            ) || changed;
        }
      }

      if (node.element?.data && hasUnknownField(node.element.data, 2185)) {
        changed = rewriteUnknownField(node.element.data, 2185, dropShortVideoButtons) || changed;
      }
      if (node.videoLockup && hasUnknownField(node.videoLockup, 18)) {
        changed = rewriteUnknownField(node.videoLockup, 18, dropAiSummary) || changed;
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
    const checkLayout = false !== opts.blockFeedAds || !!opts.blockStore;

    function visit(node, inList = false, atListItem = false, mayHavePageAd = true) {
      if (!node || "object" != typeof node || ArrayBuffer.isView(node)) return 0;

      // 整块字节扫描只在进入列表直接子项时做一次，避免沿子节点递归重复扫描同一份字节 6~8 遍。
      if (atListItem) {
        if (false !== opts.blockMembersOnly && hasMembersOnlyBadge(node) && isAllMembersOnly(node)) return 1;
        if (false !== opts.blockShortsFeed && (node.reelShelfRenderer || hasMarker(node, SHORTS_MARKERS))) return 1;
        if (false !== opts.blockFeedAds) {
          const itemBytes = node[WIRE_STATE]?.bytes;
          mayHavePageAd = !!itemBytes && itemBytes.length >= PAGEAD_MARKER.length && containsBytes(itemBytes, PAGEAD_MARKER);
        } else {
          mayHavePageAd = false;
        }
      } else if (inList && false !== opts.blockShortsFeed && node.reelShelfRenderer) {
        return 1;
      }

      // Shorts 货架命中内部标识时整块删掉。
      // 货架标题是本地化文案，这里不参与判断；标题下的卡片被删空后，
      // 容器空了会顺着上面的空列表逻辑一起删掉。
      if (!inList && node.shelfRenderer) {
        if (false !== opts.blockShortsFeed && hasMarker(node, SHORTS_MARKERS)) return 2;
      }
      if (false !== opts.blockShortsFeed && node.reelShelfRenderer) return 2;

      // 自动播放下一首：NextResult 3 号字段。
      if (opts.blockAutoplay && void 0 !== node.autoplay && deleteField(node, "autoplay")) changed = true;

      if (Array.isArray(node)) {
        let result = 0;
        for (const item of node) result |= 1 & visit(item, inList, false, mayHavePageAd);
        return result;
      }

      let isAd = inList && (isFeedAdNode(node, opts, mayHavePageAd) || (opts.blockAi && isAiBlock(node)));

      let isShortsShelf = false;
      if (checkLayout) {
        const layout = node.renderInfo?.layoutRender?.eml?.split("|")[0];
        isShortsShelf = !!layout && ((false !== opts.blockFeedAds && FEED_AD_LAYOUT.test(layout)) || (opts.blockStore && SHOPPING_LAYOUT.test(layout)));
      }
      if (inList && (isAd || isShortsShelf)) return 1;

      if (opts.blockAi) changed = stripAiControls(node) || changed;

      const state = node[WIRE_STATE];
      const nameSpecs = state?.deferred ? SPEC_NAME_CACHE[state.type] : null;
      for (const key in node) {
        // 保持惰性解码：只在当前开关确实需要读该字段时才触发 getter。
        if (nameSpecs) {
          const spec = nameSpecs.get(key);
          if (spec && !state.eager.has(spec[2])) {
            if ("smartSkipButton" === key) continue;
            if ("renderInfo" === key) continue;
            if (!inList) {
              if (
                !CONTAINER_KEYS.has(key) &&
                !LIST_KEYS.has(key) &&
                "promotedContents" !== key &&
                (!opts.blockStore || ("tabs" !== key && "attachments" !== key))
              ) {
                continue;
              }
            } else {
              if ("attachments" === key && !opts.blockStore) continue;
              if ("layout" === key && !checkLayout) continue;
              if ("element" === key && !opts.blockStore && !opts.blockAi) continue;
            }
          }
        }

        const value = node[key];
        if (!value || "object" != typeof value || ArrayBuffer.isView(value)) continue;

        if (!Array.isArray(value)) {
          const result = visit(value, inList, false, mayHavePageAd);
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
          const result = drop && !inList ? 0 : visit(item, inList || isContainer, isContainer, mayHavePageAd);

          // 嵌套容器（如轮播内的 richItemContents）只剔除命中的单项，避免把整条轮播误删；
          // 若整条容器被删空，下面的 !kept.length 逻辑再向上删掉空壳。
          if (inList && !isContainer && 1 & result) return 1;
          if (!isContainer) isAd = !!(1 & result) || isAd;
          if (drop || (isContainer && 1 & result) || (isList && 2 & result)) kept ??= value.slice(0, i);
          else if (kept) kept.push(item);
        }

        if (kept) {
          setField(node, key, kept);
          changed = true;
          if (!kept.length && (isContainer || isList)) {
            isShortsShelf = true;
            if (inList) isAd = true;
          }
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

  // 自动生成（ASR）字幕轨：kind=asr 或 vssId 以 "a." 开头，都是英文标识，与界面语言无关。
  function isAutoCaptionTrack(track) {
    return "asr" === String(track?.kind ?? "").toLowerCase() || String(track?.vssId ?? "").startsWith("a.");
  }

  // 去掉自动生成字幕轨；同步重映射 renderer 与各 audioTrack 中的字幕轨道下标，避免越界或错位。
  function stripAutoCaptionTracks(player) {
    const renderer = player.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    const kept = [];
    const indexMap = new Array(tracks.length);
    for (let i = 0; i < tracks.length; i++) {
      if (isAutoCaptionTrack(tracks[i])) {
        indexMap[i] = -1;
      } else {
        indexMap[i] = kept.length;
        kept.push(tracks[i]);
      }
    }
    if (kept.length === tracks.length) return false;

    let changed = setField(renderer, "captionTracks", kept);
    const remapIndex = (idx) => {
      if (!Number.isFinite(idx) || idx < 0 || idx >= tracks.length) return -1;
      return indexMap[idx];
    };

    const selected = renderer.defaultCaptionTrackIndex;
    if (void 0 !== selected) {
      if (!kept.length) {
        changed = deleteField(renderer, "defaultCaptionTrackIndex") || changed;
      } else {
        const mapped = remapIndex(selected);
        const nextIdx = mapped >= 0 ? mapped : Math.min(Math.max(0, selected), kept.length - 1);
        changed = setField(renderer, "defaultCaptionTrackIndex", nextIdx) || changed;
      }
    }

    for (const audio of renderer.audioTracks ?? []) {
      if (Array.isArray(audio.captionTrackIndices) && audio.captionTrackIndices.length) {
        const nextIndices = [];
        for (const oldIdx of audio.captionTrackIndices) {
          const mapped = remapIndex(oldIdx);
          if (mapped >= 0) nextIndices.push(mapped);
        }
        changed = setField(audio, "captionTrackIndices", nextIndices) || changed;
      }
      if (void 0 !== audio.defaultCaptionTrackIndex) {
        const mapped = remapIndex(audio.defaultCaptionTrackIndex);
        if (!kept.length) {
          changed = deleteField(audio, "defaultCaptionTrackIndex") || changed;
          if (true === audio.hasDefaultTrack) changed = setField(audio, "hasDefaultTrack", false) || changed;
        } else {
          const nextIdx = mapped >= 0 ? mapped : Math.min(Math.max(0, audio.defaultCaptionTrackIndex), kept.length - 1);
          changed = setField(audio, "defaultCaptionTrackIndex", nextIdx) || changed;
        }
      }
      if (void 0 !== audio.forcedCaptionTrackIndex) {
        const mapped = remapIndex(audio.forcedCaptionTrackIndex);
        if (mapped < 0) {
          changed = deleteField(audio, "forcedCaptionTrackIndex") || changed;
          if (true === audio.hasForcedTrack) changed = setField(audio, "hasForcedTrack", false) || changed;
        } else {
          changed = setField(audio, "forcedCaptionTrackIndex", mapped) || changed;
        }
      }
      if (!kept.length && void 0 !== audio.captionsInitialState && 0 !== audio.captionsInitialState) {
        changed = setField(audio, "captionsInitialState", 0) || changed;
      }
    }

    return changed;
  }

  // 强制开启字幕：选中一条已有轨道，并让所有音轨的初始状态变成「开」。
  function forceCaptionTrack(player) {
    const renderer = player.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    let selected = renderer.defaultCaptionTrackIndex;
    if (!Number.isFinite(selected) || selected < 0 || selected >= tracks.length) selected = 0;

    let changed = setField(renderer, "defaultCaptionTrackIndex", selected);
    for (const audio of renderer.audioTracks ?? []) {
      const indices = Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
      if (!indices.includes(selected)) changed = setField(audio, "captionTrackIndices", [...indices, selected]) || changed;
      changed = setField(audio, "defaultCaptionTrackIndex", selected) || changed;
      changed = setField(audio, "captionsInitialState", 3) || changed;
    }
    return changed;
  }

  // 字幕翻译：在原字幕轨道后面补一条带 tlang 的翻译轨道，并把它设为默认。
  // 目标语言（或等价区域码，如 zh-CN 之于 zh-Hans）已在轨道列表里时直接选中它；
  // 同语言与英文底本均优先选择人工字幕而非自动生成（ASR）字幕，以免翻译底本质量退化。
  function applyCaptionTranslation(player, lang, stripAuto) {
    const renderer = player.captions?.playerCaptionsTrackListRenderer;
    const tracks = renderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return false;

    let changed = false;
    let bestIndex = 0;
    let bestScore = -1;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const code = String(track.languageCode ?? "");
      const manual = isAutoCaptionTrack(track) ? 0 : 1;
      const langScore = sameCaptionLanguage(code, lang) ? 4 : /^en(?:-|$)/i.test(code) ? 2 : 0;
      const score = langScore + manual;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
      if (track.isTranslatable !== true) changed = setField(track, "isTranslatable", true) || changed;
    }

    const hasTarget = bestScore >= 4;
    let selected = bestIndex;
    if (!hasTarget) {
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

    const shouldEnable = !hasTarget && !stripAuto;
    changed = setField(renderer, "defaultCaptionTrackIndex", selected) || changed;
    if (Array.isArray(renderer.audioTracks)) {
      for (const audio of renderer.audioTracks) {
        const indices = Array.isArray(audio.captionTrackIndices) ? audio.captionTrackIndices : [];
        if (!indices.includes(selected)) changed = setField(audio, "captionTrackIndices", [...indices, selected]) || changed;
        changed = setField(audio, "defaultCaptionTrackIndex", selected) || changed;
        if (shouldEnable) changed = setField(audio, "captionsInitialState", 3) || changed;
      }
    }
    return changed;
  }

  // 播放页面板：评论区整块、播放器相关浮层。
  // 评论区只认 engagementPanels 里的内部标识；相关浮层是已建模字段。
  function dropNextExtras(next, options) {
    let changed = false;

    if (false !== options.blockComments && Array.isArray(next.engagementPanels)) {
      const kept = next.engagementPanels.filter((panel) => !hasMarker(panel, COMMENT_PANEL_MARKERS));
      if (kept.length !== next.engagementPanels.length) {
        setField(next, "engagementPanels", kept);
        changed = true;
      }
    }

    if (false !== options.blockRelatedVideos && next.playerOverlays?.renderer?.related) {
      changed = deleteField(next.playerOverlays.renderer, "related") || changed;
    }

    return changed;
  }

  function rewritePlayer(player, options) {
    let changed = filterBrowseTree(player, options);

    if (options.captionLang && "off" !== String(options.captionLang).toLowerCase()) {
      // 字幕轨道结构异常时只跳过字幕，不能连累广告清理。
      try {
        changed = applyCaptionTranslation(player, options.captionLang, !!options.stripAutoCaptions) || changed;
      } catch (e) {
        // ignore
      }
    }

    // 字幕开关：off 去掉自动生成字幕轨（不再自动开字幕），force 强制开启。
    try {
      if (options.stripAutoCaptions) changed = stripAutoCaptionTracks(player) || changed;
      else if (options.forceCaptions) changed = forceCaptionTrack(player) || changed;
    } catch (e) {
      // ignore
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
