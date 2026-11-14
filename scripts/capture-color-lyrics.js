// 临时抓包脚本：把 color-lyrics 响应的「请求头 + 响应头 + body hex」打到日志。
// 只读，不改响应。用于拿一份官方正常响应，和补全出来的响应逐字段对比。
//
// Loon 规则（临时，测完删除）：
//   response if ${url} ~= /color-lyrics\/v\d\/track\//i then script("<本文件地址>", {}) with requires_body=true, binary_body_mode=true, tag="spotify.capture.lyrics", timeout=10
(() => {
  "use strict";

  const res = typeof $response !== "undefined" ? $response : null;
  const req = typeof $request !== "undefined" && $request ? $request : {};
  const url = (res && res.url) || req.url || "";

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }

  function hex(bytes, limit) {
    let out = "";
    const n = limit && bytes.length > limit ? limit : bytes.length;
    for (let i = 0; i < n; i += 1) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }

  function headers(obj) {
    if (!obj || "object" != typeof obj) return "";
    const parts = [];
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      parts.push(key + "=" + String(obj[key]));
    }
    return parts.join("; ");
  }

  try {
    if (url.indexOf("/color-lyrics/") < 0) { $done({}); return; }
    const body = toBytes(res && res.body);
    const status = Number((res && (res.status || res.statusCode)) || 0);
    console.log("LYRICS_CAPTURE url=" + url);
    console.log("LYRICS_CAPTURE status=" + status + " bytes=" + body.length);
    console.log("LYRICS_CAPTURE req=" + headers(req.headers));
    console.log("LYRICS_CAPTURE res=" + headers(res && res.headers));
    console.log("LYRICS_CAPTURE body_hex=" + hex(body));
    $done({});
  } catch (e) {
    console.log("LYRICS_CAPTURE error " + (e && e.message));
    $done({});
  }
})();
