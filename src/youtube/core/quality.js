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
      left.itags.length === right.itags.length &&
      right.itags.every((itag) => left.itags.includes(itag)) &&
      (left.premiumItags?.length ?? 0) === (right.premiumItags?.length ?? 0) &&
      (right.premiumItags ?? []).every((itag) => left.premiumItags?.includes(itag))
    );
  }
