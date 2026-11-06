# Emby — Egern 模块

- Egern：`egern/emby/emby-unlock.yaml` + `js/emby_unlock.js`
- Loon：`loon/emby/emby-unlock.plugin`

解锁 Emby 官方 iOS 客户端的完整播放。

## 限制来自哪一层

Emby 官方的功能矩阵写得很清楚：iOS 客户端免费档是 **Limited Playback (one-minute only)**，
「Full Playback」需要 App Unlock（App 内购）或服务器带 Premiere。也就是说客户端这一档是
**客户端自己在管**，它会拿购买凭据去 Emby 的授权服务器 `mb3admin.com` 校验。

这条链路是普通 HTTPS，所以能接管。

## 改写了什么

| 接口 | 原响应 | 改成 |
| --- | --- | --- |
| `/admin/service/appstore/register` | 无效凭据返回 402 | `{"featId":"","registered":true,"expDate":"2099-01-01","key":""}` |
| `/admin/service/registration/validate` | `registered:false` | `registered:true`，`featId` 按请求里的 feature 回填 |
| `/admin/service/registration/validateDevice` | 400 | `{"cacheExpirationDays":365,"message":"Device Valid","resultCode":"GOOD"}` |
| `/admin/service/registration/getStatus` | 400 | `{"deviceStatus":"0","planType":"Lifetime","subscriptions":{}}` |

状态码统一改成 200 —— 真实接口对无效凭据返回 400/402，客户端只有看到 200 才会当成校验通过。

## 不能做什么

**服务器端的 Premiere 能力改不了。** 硬件转码、HDR 映射、离线下载、Live TV、并发会话数，
都是服务器拿自己的 key 去校验的，走的是服务器自己的网络，不是手机这条代理。

所以「最高画质」要看卡在哪：

- 卡在**客户端不让播** → 本模块解决。
- 卡在**服务器只能软解**（没 Premiere 就没硬件转码，4K 转不动，服务器降码率）→ 要在服务器上解决。
- 卡在**用户策略里的码率上限**（`RemoteClientBitrateLimit`）→ 服务器管理员设置，代理改不了。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `unlock_playback` | true | 关闭后脚本不做任何修改 |

## 注意

- 需开启 MitM：`mb3admin.com`、`www.mb3admin.com`。
- 接口路径和字段名来自社区脚本（对应 Emby iOS 1.9.9）。2026-11 实测这几个接口仍然在线，
  `validate` 返回的仍是 `{"featId":"…","registered":false,"expDate":"1900-01-01","key":""}` 这个结构，
  `appstore/register` 对无效凭据仍返回 402。但当前 App（2.2.59）是否还走这套校验，
  只能装上试一分钟——还限制就说明客户端换了验证方式。
- 图标：Emby.png
