  return {
    patchBootstrap,
    patchCustomize,
    patchBootstrapDesktop,
    patchCustomizeDesktop,
    stripRequestEtags: stripRequestEtagsBytes,
    patchMeta,
    stripHomeAds,
    hideBrowseAds,
    hideScrollAds,
    patchConfigurationResponse,
    patchAttributesResponse,
    looksLikeUcs,
    looksLikeAttributes,
    parse,
    serialize,
  };
}

// 服务端入参是 camelCase，转成客户端 $argument 的 snake_case。
export function createPatcher(options = {}) {
  return buildPatcher({
    spoof_premium: options.spoofPremium,
    block_ads: options.blockAds,
    unlock_playback: options.unlockPlayback,
    enable_lyrics: options.enableLyrics,
    desktop: options.desktop,
    lyrics_mode: options.lyricsMode,
  });
}
