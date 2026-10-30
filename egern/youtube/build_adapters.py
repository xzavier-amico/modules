#!/usr/bin/env python3
"""
build_adapters.py — 将 gholts/surge (YouTube Enhance) 的 Surge 脚本包装成 Egern 脚本。

用法（在本脚本所在目录执行）：
    python3 build_adapters.py

约定：
  - js/{request,response,key,ump}.js          保留原样：Surge 原版脚本（口令一致的 shell, 便于对比 / 升级）
  - js/{request,response,key,ump}.egern.js    生成物：Egern JS ("export default async function(ctx)")
                                              内部实现 Surge 兼容层（$request/$response/$done/
                                              $persistentStore/$argument）并注入原版脚本代码。
                                              顶部的兼容层由本脚本统一生成，不要手工改。

重新生成请再次运行本脚本。
"""

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
JS_DIR = HERE / "js"


HEADER = """\
/// <reference path="." />
/**
 * YouTube Enhance — Egern 适配脚本 (@@NAME@@)
 *
 * 由 build_adapters.py 自动生成，请勿手工编辑本文件（改动会被覆盖）。
 * 原始 Surge 脚本: scripts/youtube/@@NAME@@.js
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
"""

SHIM = """\
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
            out += "\\uFFFD";
            i += 1;
            continue;
          }
          if (i + need > bytes.length) {
            out += "\\uFFFD";
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
            out += "\\uFFFD";
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
"""

REQUEST_BODY = """\
export default async function (ctx) {
  surge$installPolyfills();
@@ARGUMENT@@
  const $persistentStore = surge$persistentStoreObject();
  const { future, $done } = surge$doneFuture();

  const $request = {
    url: ctx.request.url,
    method: ctx.request.method,
    headers: surge$headersToObject(ctx.request.headers),
    body: ctx.request.body == null ? undefined : await surge$readBinary(ctx.request.body),
  };
  const $response = undefined;

@@ORIGINAL@@

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
"""

RESPONSE_BODY = """\
export default async function (ctx) {
  surge$installPolyfills();
@@ARGUMENT@@
  const $persistentStore = surge$persistentStoreObject();
  const { future, $done } = surge$doneFuture();

  const $request = {
    url: ctx.request.url,
    method: undefined,
    headers: surge$headersToObject(ctx.request.headers),
    body: undefined,
  };
  const $response = {
    status: ctx.response.status,
    headers: surge$headersToObject(ctx.response.headers),
    body: ctx.response.body == null ? undefined : await surge$readBinary(ctx.response.body),
  };

@@ORIGINAL@@

  const result = await future;
  if (result == null) return undefined;
  const changed = {};
  if (result.status != null) changed.status = result.status;
  if (result.headers != null) changed.headers = result.headers;
  if (result.body != null) changed.body = result.body;
  return Object.keys(changed).length > 0 ? changed : undefined;
}
"""

# 每个 egern 脚本的 $argument 参数（键序沿用 Surge 模块 argument JSON）
ARGUMENTS = {
    "request": '''
  // 仅供 init / auto-hd 两个入口使用（request.js 内部只读取 autoHd）；
  // ad-break / log-event 入口 yaml 中不注入 env => 回落 "{}"（脚本使用内部默认）。
  const $argument = surge$buildArgument({ AUTO_HD: "autoHd" });
''',
    "response": '''
  // 对应 Surge 模块 youtube.enhance.response 的 argument JSON（九个开关一个不少）。
  const $argument = surge$buildArgument({
    BLOCK_UPLOAD: "blockUpload",
    BLOCK_SHORTS: "blockShorts",
    BLOCK_GAMES: "blockGames",
    BLOCK_VERTICAL_LIVE: "blockVerticalLive",
    JUMP_AHEAD: "jumpAhead",
    AUTO_HD: "autoHd",
    BLOCK_STORE: "blockStore",
    BLOCK_AI: "blockAi",
    ON_THE_GO: "onTheGo",
  });
''',
    "ump": '''
  // 对应 Surge 模块 youtube.enhance.ump 的 argument JSON。
  const $argument = surge$buildArgument({
    BLOCK_GAMES: "blockGames",
    BLOCK_VERTICAL_LIVE: "blockVerticalLive",
    JUMP_AHEAD: "jumpAhead",
    AUTO_HD: "autoHd",
    BLOCK_STORE: "blockStore",
    BLOCK_AI: "blockAi",
    ON_THE_GO: "onTheGo",
  });
''',
    "key": '''
  // key.js 不接收参数。
  const $argument = "{}";
''',
}

BODIES = {"request": REQUEST_BODY, "response": RESPONSE_BODY}
BINARY = ("key", "response", "ump")


def strip_header_fence(source: str) -> str:
    """原版脚本整体就是一段顶层 IIFE，直接原样嵌入。"""
    return source.rstrip()


def build(name: str) -> pathlib.Path:
    original_path = JS_DIR / f"{name}.js"
    source = original_path.read_text(encoding="utf-8")
    body = BODIES["response" if name in BINARY and name != "request" else name]

    # request.js 有 body（binary-body-mode）；ump/response/key 也是 binary —— 由 yaml 中
    # body_required + binary_body=true 决定，适配层只负责把已捕获的 body 原样交给脚本。
    adapter = (
        HEADER.replace("@@NAME@@", name)
        + SHIM.replace("@@NAME@@", name)
        + body.replace("@@ARGUMENT@@", ARGUMENTS[name]).replace("@@ORIGINAL@@", strip_header_fence(source))
    )
    out = JS_DIR / f"{name}.egern.js"
    out.write_text(adapter, encoding="utf-8")
    return out


def main() -> int:
    written = [build(n) for n in ("request", "response", "key", "ump")]
    for path in written:
        size = path.stat().st_size
        print(f"generated {path.relative_to(HERE)} ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
