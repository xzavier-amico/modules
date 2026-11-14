  //=====================================================================================
  // §2 持久化
  //=====================================================================================

  // 读一个 JSON 对象；内容超长或解析失败都当成空对象。
  function readStore(key = CONFIG_KEY, maxLength = Infinity) {
    const raw = $persistentStore.read(key);
    if (typeof raw === "string" && raw.length > maxLength) return {};
    try {
      const value = JSON.parse(raw || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function writeStore(value, key = CONFIG_KEY) {
    return $persistentStore.write(JSON.stringify(value), key);
  }
