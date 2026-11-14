  // feed 脚本复用 lyrics.js 的查询 / 缓存逻辑，但只加载 prefetch 入口。
  // 这里在 lyrics.js 之前执行：告诉它不要处理 color-lyrics 响应，并把 feed
  // 自己的参数位置翻译成歌词脚本认识的选项。
  const SPOTIFY_LYRICS_PREFETCH = true;
  const SPOTIFY_PREFETCH_OPTIONS = (() => {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source。
      return { enable_lyrics: raw[3], lyrics_source: raw[5] };
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "{}") || {};
        return { enable_lyrics: parsed.enable_lyrics, lyrics_source: parsed.lyrics_source };
      } catch (e) {
        return {};
      }
    }
    if (raw && "object" == typeof raw) {
      return { enable_lyrics: raw.enable_lyrics, lyrics_source: raw.lyrics_source };
    }
    return {};
  })();
