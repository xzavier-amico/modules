  // 入口：只处理 config / log_event 响应，提取 UMP 密钥。
  (function main() {
    const response = typeof $response !== "undefined" && $response ? $response : undefined;
    if (!response) {
      $done({});
      return;
    }
    extractUmpKeys();
  })();
