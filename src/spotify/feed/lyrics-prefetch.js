  // feed 脚本在 lyrics.js 之前执行：开启辅助模式（只暴露缓存查询与补卡判断），
  // 并把 feed 的参数位置翻译成歌词脚本认识的选项。
  const SPOTIFY_LYRICS_PREFETCH = true;
  const SPOTIFY_PREFETCH_OPTIONS = (() => {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source, debug_log。
      return { enable_lyrics: raw[3], lyrics_source: raw[5], debug_log: raw[6] };
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "{}") || {};
        return { enable_lyrics: parsed.enable_lyrics, lyrics_source: parsed.lyrics_source, debug_log: parsed.debug_log };
      } catch (e) {
        return {};
      }
    }
    if (raw && "object" == typeof raw) {
      return { enable_lyrics: raw.enable_lyrics, lyrics_source: raw.lyrics_source, debug_log: raw.debug_log };
    }
    return {};
  })();
