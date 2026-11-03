/**
 * Spotify gabo 空响应（Loon 3.5.3+）
 *
 * 由 Reukix/ukix 的 Surge 版 Spotify-gabo.js 转换而来。
 * Loon 的 request 脚本可以通过 $done({ response }) 直接返回响应。
 */

console.log("生成gabo响应");

$done({
  response: {
    status: 200,
    headers: {
      "cache-control": "no-cache",
      "content-length": "0",
      "server-timing": "edge;dur=666",
      "strict-transport-security": "max-age=31536000",
      "x-content-type-options": "nosniff",
      "alt-svc": 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000',
      "date": new Date().toUTCString(),
      "server": "envoy",
      "via": "HTTP/2 edgeproxy, 1.1 google",
    },
    body: "",
  },
});
