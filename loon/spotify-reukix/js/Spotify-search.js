/**
 * Spotify search 广告清理（Loon 3.5.3+）
 *
 * 由 Reukix/ukix 的 Surge 版 Spotify-search.js 转换而来。
 * Loon 使用 binary_body_mode=true 时，$response.body 为 Uint8Array。
 */

const MAX_SCAN = 666;
const MIN_AD_FIELD_LENGTH = 12000;

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function readVarint(buffer, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;

  while (pos < buffer.length) {
    const byte = buffer[pos++];
    result |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, length: pos - offset };
    }

    shift += 7;
    if (shift > 35) break;
  }

  return null;
}

function removeSearchAd(buffer) {
  const limit = Math.min(MAX_SCAN, buffer.length);

  for (let i = 0; i < limit; i++) {
    if (buffer[i] !== 0x32) continue;

    const varint = readVarint(buffer, i + 1);
    if (!varint) continue;

    console.log("找到 field 6:");
    console.log(`位置: ${i}`);
    console.log(`长度: ${varint.value}`);
    console.log(`varint字节数: ${varint.length}`);

    if (varint.value > MIN_AD_FIELD_LENGTH) {
      buffer[i] = 0x7a;
      console.log("更改tag值去除广告");
      return true;
    }
  }

  return false;
}

const body = toUint8Array($response.body);

if (!body) {
  console.log("Spotify-search: 响应体不是二进制数据，跳过");
  $done({});
} else {
  removeSearchAd(body);
  $done({ body });
}
