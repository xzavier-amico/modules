  // 入口：youtubei 常规响应 + initplayback 的 UMP 响应。
  (function main() {
    const request = (typeof $request !== "undefined" && $request) || {};
    const response = typeof $response !== "undefined" && $response ? $response : undefined;
    const url = (response && response.url) || request.url || "";
    if (!url || !response) {
      $done({});
      return;
    }
    if (/\/initplayback(?:\?|$)/.test(url)) {
      handleUmpResponse();
      return;
    }
    handleYouTubeiResponse();
  })();
