/**
 * Spotify 设备能力补丁（Loon 3.5.3+）
 *
 * 只修改 /device-capabilities/v1/capabilities 的客户端能力声明，
 * 不再把“账号级播放授权”硬写进 bootstrap/customize。
 * 这样 UI 仍可按 Premium 显示，但播放时使用服务端真实下发的码流，
 * 避免 Spotify 因为授权不一致在几秒后自动跳歌。
 */

(function main() {
  const status = Number($response.status);
  if (status !== 200) {
    console.log(`Spotify-capabilities: 状态码不是 200 (${status})，跳过`);
    return $done({});
  }

  try {
    const body = JSON.parse($response.body);

    body.effective_license = "premium";

    if (!body.supports_hifi || typeof body.supports_hifi !== "object") {
      body.supports_hifi = {};
    }
    body.supports_hifi.fully_supported = true;
    body.supports_hifi.user_eligible = true;

    return $done({ body: JSON.stringify(body) });
  } catch (error) {
    console.log(
      "Spotify-capabilities: 处理失败，保持原响应: " +
        (error && error.message ? error.message : String(error)),
    );
    return $done({});
  }
})();
