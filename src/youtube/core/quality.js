  // 编码偏好：any 不过滤，no_av1 去掉 AV1，avc 只留 H.264。
  // 认的是 mimeType 里的 codecs 串（avc1 / av01 / vp9…），与界面语言无关。
  function codecAllowed(mime, codec) {
    const text = String(mime ?? "").toLowerCase();
    if ("avc" === codec) return text.includes("avc1");
    if ("no_av1" === codec) return !text.includes("av01");
    return true;
  }

  function isQualityEntry(entry) {
    return !!(
      entry &&
      "object" == typeof entry &&
      !Array.isArray(entry) &&
      Number.isInteger(entry.height) &&
      entry.height > 0 &&
      entry.height <= 2147483647 &&
      Array.isArray(entry.itags) &&
      entry.itags.length > 0 &&
      entry.itags.length <= 256 &&
      entry.itags.every((itag) => Number.isInteger(itag) && itag > 0 && itag <= 4294967295) &&
      new Set(entry.itags).size === entry.itags.length &&
      (void 0 === entry.codec || "any" === entry.codec || "no_av1" === entry.codec || "avc" === entry.codec) &&
      (void 0 === entry.premiumItags ||
        (Array.isArray(entry.premiumItags) &&
          entry.premiumItags.length <= entry.itags.length &&
          new Set(entry.premiumItags).size === entry.premiumItags.length &&
          entry.premiumItags.every((itag) => entry.itags.includes(itag))))
    );
  }

  function sameQuality(left, right) {
    return (
      void 0 !== left &&
      left.height === right.height &&
      (left.codec ?? "any") === (right.codec ?? "any") &&
      left.itags.length === right.itags.length &&
      right.itags.every((itag) => left.itags.includes(itag)) &&
      (left.premiumItags?.length ?? 0) === (right.premiumItags?.length ?? 0) &&
      (right.premiumItags ?? []).every((itag) => left.premiumItags?.includes(itag))
    );
  }
