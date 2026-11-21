  // feed 脚本在 lyrics.js 之前执行：开启辅助模式（只暴露缓存查询、补卡判断与
  // 下一首预取），并把 feed 的参数位置翻译成歌词脚本认识的选项。
  const SPOTIFY_LYRICS_HELPER = true;
  const SPOTIFY_HELPER_OPTIONS = (() => {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    const pick = (value) => ({
      enable_lyrics: value.enable_lyrics,
      lyrics_source: value.lyrics_source,
      prefetch_lyrics: value.prefetch_lyrics,
      sync_plain_lyrics: value.sync_plain_lyrics,
      lyrics_isrc: value.lyrics_isrc,
      word_lyrics: value.word_lyrics,
    });
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source,
      // prefetch_lyrics, sync_plain_lyrics, lyrics_isrc, word_lyrics。
      return {
        enable_lyrics: raw[3],
        lyrics_source: raw[5],
        prefetch_lyrics: raw[6],
        sync_plain_lyrics: raw[7],
        lyrics_isrc: raw[8],
        word_lyrics: raw[9],
      };
    }
    if (typeof raw === "string") {
      try {
        return pick(JSON.parse(raw || "{}") || {});
      } catch (e) {
        return {};
      }
    }
    if (raw && "object" == typeof raw) return pick(raw);
    return {};
  })();
