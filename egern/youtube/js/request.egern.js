/// <reference path="." />
/**
 * YouTube Enhance — Egern 适配脚本 (request)
 *
 * 由 build_adapters.py 自动生成，请勿手工编辑本文件（改动会被覆盖）。
 * 原始 Surge 脚本: scripts/youtube/request.js
 *   - 仓库: https://github.com/gholts/surge (module: youtube-enhance.sgmodule)
 *   - 许可: 基于 Maasea 的代码 (Apache-2.0)
 *
 * Egern 兼容层说明（文档: https://egernapp.com/docs/javascript-api）：
 *   - $request / $response : 由 ctx.request / ctx.response 构造（headers 为小写键的普通对象）
 *   - $done(result)        : 等待 Surge 脚本回传，然后按 Egern 语义返回
 *   - $persistentStore     : 映射到 ctx.storage（同一模块内各脚本共用持久化存储）
 *   - $argument            : 由模块 yaml 中按脚本注入的 env 重建出的 JSON 字符串
 *   - 二进制 body          : binary_body=true 时读取为 Uint8Array（等价 Surge binary-body-mode=1）
 *   - 缺失的 Web API       : 按需 polyfill（Uint8Array#toBase64 / TextEncoder / TextDecoder
 *                             / CompressionStream / DecompressionStream -> ctx.compress）
 */
/* =========================== Surge 兼容层（生成） =========================== */
const ctx$ = ctx;

function surge$hasAPI(name) {
  try {
    return typeof globalThis[name] === "function";
  } catch {
    return false;
  }
}

/** 把 Egern Headers（大小写不敏感）转成脚本可用的普通对象（键一律小写）。 */
function surge$headersToObject(src) {
  const out = Object.create(null);
  if (src == null) return out;
  let ok = false;
  try {
    if (typeof src[Symbol.iterator] === "function") {
      for (const pair of src) {
        if (Array.isArray(pair)) {
          out[String(pair[0]).toLowerCase()] = pair[1] == null ? "" : String(pair[1]);
        }
      }
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      for (const [key, value] of Object.entries(src)) {
        out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
      }
      ok = true;
    } catch {
      ok = false;
    }
  }
  return out;
}

/** polyfill 种子：只补充运行时缺失的 API（幂等）。 */
function surge$installPolyfills() {
  const g = globalThis;

  // Uint8Array.prototype.toBase64（key.js 使用；iOS 17.4+ JSC 自带，其他引擎按需补）
  if (typeof btoa === "function" && typeof Uint8Array.prototype.toBase64 !== "function") {
    Object.defineProperty(Uint8Array.prototype, "toBase64", {
      configurable: true,
      writable: true,
      value: function () {
        let text = "";
        const CH = 0x8000;
        for (let i = 0; i < this.length; i += CH) {
          text += String.fromCharCode.apply(null, this.subarray(i, i + CH));
        }
        return btoa(text);
      },
    });
  }

  // TextEncoder
  if (!surge$hasAPI("TextEncoder")) {
    g.TextEncoder = class {
      encode(input) {
        const text = input == null ? "" : String(input);
        const bytes = [];
        for (const ch of text) {
          const cp = ch.codePointAt(0);
          if (cp < 0x80) bytes.push(cp);
          else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
          else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        }
        return new Uint8Array(bytes);
      }
    };
  }

  // TextDecoder（UTF-8）
  if (!surge$hasAPI("TextDecoder")) {
    g.TextDecoder = class {
      decode(bytes) {
        if (bytes == null) return "";
        if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
        let out = "";
        for (let i = 0; i < bytes.length; ) {
          const b0 = bytes[i];
          let need = 0;
          let cp = 0;
          if (b0 < 0x80) {
            need = 1;
            cp = b0;
          } else if ((b0 & 0xe0) === 0xc0) {
            need = 2;
            cp = b0 & 0x1f;
          } else if ((b0 & 0xf0) === 0xe0) {
            need = 3;
            cp = b0 & 0x0f;
          } else if ((b0 & 0xf8) === 0xf0) {
            need = 4;
            cp = b0 & 0x07;
          } else {
            out += "\uFFFD";
            i += 1;
            continue;
          }
          if (i + need > bytes.length) {
            out += "\uFFFD";
            i += 1;
            continue;
          }
          let bad = false;
          for (let k = 1; k < need; k++) {
            const cb = bytes[i + k];
            if ((cb & 0xc0) !== 0x80) {
              bad = true;
              break;
            }
            cp = (cp << 6) | (cb & 0x3f);
          }
          const min = need === 1 ? 0 : need === 2 ? 0x80 : need === 3 ? 0x800 : 0x10000;
          const invalid =
            bad || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
          if (invalid) {
            out += "\uFFFD";
            i += bad ? 1 : need;
            continue;
          }
          out += String.fromCodePoint(cp);
          i += need;
        }
        return out;
      }
    };
  }

  // CompressionStream / DecompressionStream：ump.js 用 gzip 流，缺失时以 ctx.compress 实现。
  if (!surge$hasAPI("CompressionStream") || !surge$hasAPI("DecompressionStream")) {
    if (surge$hasAPI("ReadableStream") && surge$hasAPI("WritableStream")) {
      const makeShim = (direction, transform) =>
        class {
          constructor(format) {
            if (String(format).toLowerCase() !== "gzip") {
              throw new Error(direction + "Stream: unsupported format: " + format);
            }
            const chunks = [];
            let closed = false;
            let processed = false;
            let failure = null;
            let waiter = null;
            let outChunk = null;
            const wake = () => {
              const w = waiter;
              waiter = null;
              if (w) w();
            };
            const concat = () => {
              let total = 0;
              for (const part of chunks) total += part.length;
              const data = new Uint8Array(total);
              let off = 0;
              for (const part of chunks) {
                data.set(part, off);
                off += part.length;
              }
              return data;
            };
            this.writable = new WritableStream({
              write(part) {
                if (failure) return;
                try {
                  chunks.push(part instanceof Uint8Array ? part : new Uint8Array(part));
                } catch (e) {
                  failure = e;
                }
              },
              close() {
                if (!closed) {
                  closed = true;
                  wake();
                }
              },
              abort(reason) {
                if (!failure) {
                  failure = reason instanceof Error ? reason : new Error(String(reason));
                }
                closed = true;
                wake();
              },
            });
            this.readable = new ReadableStream({
              async pull(controller) {
                if (!processed && outChunk == null) {
                  if (!closed && failure == null) {
                    await new Promise((resolve) => {
                      waiter = resolve;
                    });
                  }
                  if (failure) throw failure;
                  const data = concat();
                  processed = true;
                  if (data.length > 0) {
                    try {
                      outChunk = await transform(data);
                      if (outChunk == null) outChunk = new Uint8Array(0);
                    } catch (e) {
                      failure = e;
                      throw e;
                    }
                  } else {
                    outChunk = new Uint8Array(0);
                  }
                }
                if (failure) throw failure;
                if (outChunk != null && outChunk.length > 0) {
                  const chunk = outChunk;
                  outChunk = null;
                  controller.enqueue(chunk);
                }
              },
              cancel() {
                if (!failure) failure = new Error(direction + "Stream: cancelled");
              },
            });
          }
        };
      if (typeof g.CompressionStream !== "function") {
        g.CompressionStream = makeShim("Compression", (d) => ctx$.compress.gzip(d));
      }
      if (typeof g.DecompressionStream !== "function") {
        g.DecompressionStream = makeShim("Decompression", (d) => ctx$.compress.gunzip(d));
      }
    }
  }
}

/** $argument：由 env 重建出的 JSON（脚本自带 `{{{` 防呆，未提供 env 时用其内部默认值）。 */
function surge$buildArgument(mapping) {
  const args = {};
  for (const [envKey, jsonKey] of Object.entries(mapping)) {
    const raw = ctx$.env ? ctx$.env[envKey] : undefined;
    if (raw === undefined || raw === "") continue;
    args[jsonKey] = String(raw).trim().toLowerCase() === "true" || raw === true;
  }
  return Object.keys(args).length > 0 ? JSON.stringify(args) : "{}";
}

/** $persistentStore -> ctx.storage（Surge: write(value[, key]) => boolean）。 */
function surge$persistentStoreObject() {
  return {
    read(key) {
      try {
        const value = ctx$.storage.get(String(key));
        return value == null ? undefined : String(value);
      } catch {
        return undefined;
      }
    },
    write(value, key) {
      try {
        ctx$.storage.set(String(key == null ? "default" : key), String(value == null ? "" : value));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** $done：首次调用生效，之后忽略（脚本可能多次调用）；返回最终结果。 */
function surge$doneFuture() {
  let settled = false;
  let resolveFn;
  const future = new Promise((resolve) => (resolveFn = resolve));
  return {
    future,
    $done(result) {
      if (!settled) {
        settled = true;
        resolveFn(result == null ? undefined : result);
      }
    },
  };
}

/** 读二进制体；读过一次即止（Egern body 只可消费一次）。 */
async function surge$readBinary(stream) {
  if (stream == null) return undefined;
  try {
    const buffer = await stream.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    try {
      console.log("[YouTube Enhance] body read failed: " + error);
    } catch {}
    return undefined;
  }
}
/* ========================= Surge 兼容层（生成）结束 ========================= */
export default async function (ctx) {
  surge$installPolyfills();

  // 仅供 init / auto-hd 两个入口使用（request.js 内部只读取 autoHd）；
  // ad-break / log-event 入口 yaml 中不注入 env => 回落 "{}"（脚本使用内部默认）。
  const $argument = surge$buildArgument({ AUTO_HD: "autoHd" });

  const $persistentStore = surge$persistentStoreObject();
  const { future, $done } = surge$doneFuture();

  const $request = {
    url: ctx.request.url,
    method: ctx.request.method,
    headers: surge$headersToObject(ctx.request.headers),
    body: ctx.request.body == null ? undefined : await surge$readBinary(ctx.request.body),
  };
  const $response = undefined;

(()=>{const e="YouTubeConfig";function t(t=e,r=1/0){const n=$persistentStore.read(t);if("string"==typeof n&&n.length>r)return{};try{const e=JSON.parse(n||"{}");return e&&"object"==typeof e&&!Array.isArray(e)?e:{}}catch{return{}}}function r(e){const t=new Uint8Array(e.reduce((e,t)=>e+t.length,0));let r=0;for(const n of e)t.set(n,r),r+=n.length;return t}function n(e,t){return e===t||e.length===t.length&&e.every((e,r)=>e===t[r])}function o(e){const t=[];do{t.push(e%128|(e>127?128:0)),e=Math.floor(e/128)}while(e);return new Uint8Array(t)}function i(e){const t=[];let r=0;function n(){let t=0,n=1;for(let o=0;o<5;o++){if(r>=e.length)throw new Error("Truncated protobuf varint");const o=e[r++];if(t+=(127&o)*n,!(128&o)){if(t>4294967295)throw new Error("Protobuf length/tag overflow");return t}n*=128}throw new Error("Invalid protobuf varint")}for(;r<e.length;){const o=r,i=n(),s=Math.floor(i/8),u=i%8;if(!s)throw new Error("Invalid protobuf field");let a=r;if(2===u){const e=n();a=r,r+=e}else if(1===u)r+=8;else if(5===u)r+=4;else{if(0!==u)throw new Error("Unsupported protobuf wire type "+u);{let t,n=0;do{if(r>=e.length||10===n++)throw new Error("Invalid protobuf integer");if(t=e[r++],10===n&&t>1)throw new Error("Protobuf integer overflow")}while(128&t)}}if(r>e.length)throw new Error("Truncated protobuf field");t.push({no:s,wire:u,data:e.subarray(a,r),raw:e.subarray(o,r)})}return t}function s(e){let t=0,r=1;for(const n of e)t+=(127&n)*r,r*=128;return t}function u(e={}){return"string"!=typeof $argument||$argument.includes("{{{")?e:{...e,...JSON.parse($argument)}}function a(e){return Object.entries(e.headers??{}).some(([e,t])=>"user-agent"===e.toLowerCase()&&/music/i.test(t))?"youtubeMusic":"youtube"}function f(e,t,r=!1){let n;for(const o of i(e))if(o.no===t&&2===o.wire){if(!r)return o.data;if(n)return;n=o.data}return n}function c(e){const t=e.replace(/[-_\s=]/g,e=>"-"===e?"+":"_"===e?"/":""),r=t.length%4==1,n=Uint8Array.fromBase64(r?t+"A":t);return r?n.subarray(0,-1):n}function h(e,t){const n=new Map(t?[[13,0],[14,2],[16,t.height],[21,t.height],[26,3],[30,0]]:[[16,4320],[26,1],[30,0]]),u=new Set,a=[];let f=!1;for(const t of i(e)){const e=0===t.wire?n.get(t.no):void 0;void 0!==e?(s(t.data)===e?a.push(t.raw):(a.push(o(8*t.no),o(e)),f=!0),u.add(t.no)):a.push(t.raw)}for(const[e,t]of n)u.has(e)||(a.push(o(8*e),o(t)),f=!0);return f?r(a):e}function l(e){const t=e.body;if(ArrayBuffer.isView(t))return new Uint8Array(t.buffer,t.byteOffset,t.byteLength);if(t?.length)throw new Error("YouTube requires binary-body-mode for request bodies");const r=Object.entries(e.headers??{}).find(([e])=>"content-length"===e.toLowerCase())?.[1];if(Number(r)>0)throw new Error("YouTube request body unavailable; requires-body must be enabled")}function g(){return{response:{status:200,headers:{"Content-Type":"application/x-protobuf"},body:new Uint8Array}}}!function(){let d;try{let y;if(d=$request.url.split("?")[0],d.endsWith("/player/ad_break"))y=g();else if(d.endsWith("/log_event"))y=function(e){const r=Object.keys(e.headers??{}).filter(e=>"x-youtube-hot-hash-data"===e.toLowerCase());if(!r.length||t()[a(e)]?.clientKey)return;const n={...e.headers};for(const e of r)delete n[e];return{headers:n}}($request);else if(d.endsWith("/initplayback")){if("GET"!==$request.method&&"HEAD"!==$request.method){const s=l($request);if(y=function(r,o){if(void 0===r||0===r.length)return;const i=t()[o],s=f(r,3),u=s&&f(s,5);if(!u?.length)return g();for(const e of(a=i)?[a,...Array.isArray(a.previous)?a.previous.slice(0,3):[]].filter(e=>e&&"string"==typeof e.clientKey&&"string"==typeof e.encryptKey&&e.clientKey.length>0&&e.clientKey.length<=5500&&e.encryptKey.length>0&&e.encryptKey.length<=5500):[])try{if(n(u,c(e.encryptKey)))return}catch{}var a;return function(r,n){if(void 0===r||void 0===n)return;const o=t();if(!Object.hasOwn(o,r))return;const i=o[r],s=n;JSON.stringify(i)===JSON.stringify(s)&&(delete o[r],function(t,r=e){$persistentStore.write(JSON.stringify(t),r)}(o))}(o,i),g()}(s,a($request)),!y&&s?.length&&!1!==u().autoHd){const e=function(e){const t=i(e),n=t.filter(e=>2===e.no&&2===e.wire);if(1!==n.length)return e;const s=n[0],u=h(s.data,void 0);return u===s.data?e:r(t.map(e=>e===s?r([o(18),o(u.length),u]):e.raw))}(s);e!==s&&(y={body:e})}}}else if(d.endsWith("/videoplayback")){const e=!1===u().autoHd?void 0:l($request);if(e?.length){const u=function(e,u){const a=i(e),c=function(e,r){try{const n=/[?&]id=([^&]+)/.exec(r);if(!n)return;const o=e.find(e=>5===e.no&&2===e.wire),u=o&&f(o.data,1);if(!u?.length)return;const a=t("YouTubeQuality",65536)?.[decodeURIComponent(n[1])];if(!function(e){const t=e;return!!(t&&"object"==typeof t&&!Array.isArray(t)&&Number.isInteger(t.height)&&t.height>0&&t.height<=2147483647&&Array.isArray(t.itags)&&t.itags.length>0&&t.itags.length<=256&&t.itags.every(e=>Number.isInteger(e)&&e>0&&e<=4294967295)&&new Set(t.itags).size===t.itags.length&&(void 0===t.premiumItags||Array.isArray(t.premiumItags)&&t.premiumItags.length<=t.itags.length&&new Set(t.premiumItags).size===t.premiumItags.length&&t.premiumItags.every(e=>t.itags.includes(e))))}(a))return;const c=[],h=[];for(const e of i(u)){if(6!==e.no||2!==e.wire)continue;const t=i(e.data).find(e=>1===e.no&&0===e.wire);if(!t)continue;const r=s(t.data);a.itags.includes(r)&&(c.push(e.data),a.premiumItags?.includes(r)&&h.push(e.data))}return c.length?{height:a.height,formats:h.length?h:c}:void 0}catch{return}}(a,u),l=a.filter(e=>17===e.no&&2===e.wire),g=c&&(l.length!==c.formats.length||l.some((e,t)=>!n(e.data,c.formats[t]))),d=[];let y=!1,p=!!g;for(const e of a)if(1===e.no&&2===e.wire){const t=h(e.data,c);t===e.data?d.push(e.raw):(d.push(o(10),o(t.length),t),p=!0),y=!0}else{if(g&&17===e.no&&2===e.wire)continue;d.push(e.raw)}if(!y){const e=h(new Uint8Array,c);d.push(o(10),o(e.length),e),p=!0}if(g)for(const e of c.formats)d.push(o(138),o(e.length),e);return p?r(d):e}(e,$request.url);u!==e&&(y={body:u})}}$done(y)}catch(e){console.log("YouTube request: "+e),d?.endsWith("/initplayback")?$done(g()):$done()}}()})();

  const result = await future;
  if (result == null) return undefined;
  // Surge 约定：$done({ response: {...} }) 表示直接回复，不转发上游请求。
  if (result.response != null) {
    const reply = { status: result.response.status, body: result.response.body };
    if (result.response.headers != null) reply.headers = result.response.headers;
    return ctx.respond(reply);
  }
  const changed = {};
  if (result.url != null) changed.url = result.url;
  if (result.headers != null) changed.headers = result.headers;
  if (result.body != null) changed.body = result.body;
  return Object.keys(changed).length > 0 ? changed : undefined;
}
