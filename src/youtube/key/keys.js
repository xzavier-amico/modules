  //=====================================================================================
  // §12 从 config / log_event 响应里抓 UMP 密钥
  //=====================================================================================

  function extractUmpKeys() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const body = toBytes($response.body);
      if (("config" !== route && "log_event" !== route) || !body?.length || body.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }

      let current = body;
      for (const fieldNo of [1, 16, 7, 138536474, 146311580]) {
        current = fieldData(current, fieldNo, true);
        if (!current) {
          $done({});
          return;
        }
      }

      const clientKey = fieldData(current, 1, true);
      const encryptKey = fieldData(current, 2, true);
      if (clientKey?.length && encryptKey?.length && clientKey.length <= 4096 && encryptKey.length <= 4096) {
        const key = clientKeyFor($request);
        const config = readStore();
        const entry = { clientKey: clientKey.toBase64(), encryptKey: encryptKey.toBase64() };

        if (config[key]?.clientKey !== entry.clientKey || config[key]?.encryptKey !== entry.encryptKey) {
          const previous = (
            config[key]
              ? [config[key], ...(Array.isArray(config[key].previous) ? config[key].previous.slice(0, 3) : [])].filter(
                  (item) =>
                    item &&
                    "string" == typeof item.clientKey &&
                    "string" == typeof item.encryptKey &&
                    item.clientKey.length > 0 &&
                    item.clientKey.length <= 5500 &&
                    item.encryptKey.length > 0 &&
                    item.encryptKey.length <= 5500,
                )
              : []
          )
            .filter((item) => item.clientKey !== entry.clientKey || item.encryptKey !== entry.encryptKey)
            .slice(0, 3)
            .map(({ clientKey, encryptKey }) => ({ clientKey, encryptKey }));

          if (previous.length) entry.previous = previous;
          config[key] = entry;
          writeStore(config);
        }
      }
      $done({});
    } catch (e) {
      $done({});
    }
  }
