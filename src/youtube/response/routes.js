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
        const hidden = new Set(options.hiddenGuideItems ?? []);
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
