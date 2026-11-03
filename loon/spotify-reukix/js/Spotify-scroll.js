/**
 * Spotify scroll 广告清理（Loon 3.5.3+）
 *
 * 由 Reukix/ukix 的 Surge 版 Spotify-scroll.js 转换而来。
 * Loon 使用 binary_body_mode=true 时，$response.body 为 Uint8Array。
 */

const MAX_SCAN = 666;

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

const body = toUint8Array($response.body);

if (!body) {
  console.log("Spotify-scroll: 响应体不是二进制数据，跳过");
  $done({});
} else {
  let changed = false;
  const limit = Math.min(MAX_SCAN, body.length - 1);

  for (let i = 0; i < limit; i++) {
    if (body[i] === 0xf2 && body[i + 1] === 0x01) {
      body[i] = 0xf7;
      body[i + 1] = 0x07;
      console.log(`成功在偏移量 ${i} 处更改tag值`);
      changed = true;
      break;
    }
  }

  if (!changed) {
    console.log("未检测到广告");
    $done({});
  } else {
    $done({ body });
  }
}
