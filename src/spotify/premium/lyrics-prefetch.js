  // spotify.js 也复用歌词查询 / 缓存：connect-state 换歌时先把当前曲目的歌词查好，
  // 打开歌词页或滚动页补卡时就能直接命中缓存。这里只加载 prefetch 入口。
  const SPOTIFY_LYRICS_PREFETCH = true;
  const SPOTIFY_PREFETCH_OPTIONS = (() => {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source, prefetch
      return { enable_lyrics: raw[3], lyrics_source: raw[5], prefetch: raw[6] };
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "{}") || {};
        return { enable_lyrics: parsed.enable_lyrics, lyrics_source: parsed.lyrics_source, prefetch: parsed.prefetch };
      } catch (e) {
        return {};
      }
    }
    if (raw && "object" == typeof raw) {
      return { enable_lyrics: raw.enable_lyrics, lyrics_source: raw.lyrics_source, prefetch: raw.prefetch };
    }
    return {};
  })();
