  // 入口：只处理请求阶段。插件已按 URL 分流，这里不再判断响应。
  (function main() {
    const request = (typeof $request !== "undefined" && $request) || {};
    if (!request.url) {
      $done({});
      return;
    }
    handleRequest(request);
  })();
