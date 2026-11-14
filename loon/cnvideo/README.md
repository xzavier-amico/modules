# CN Video Ad-Free — Loon 插件

- Loon：`loon/cnvideo/cnvideo-adfree.plugin`
- Egern：`egern/cnvideo/cnvideo-adfree.yaml`

优酷 / 爱奇艺 / 腾讯视频：拒绝广告 SDK 与遥测域名；优酷只保留埋点，避免起播卡住。
纯规则模块，不需要 MITM。

## 拦了什么

| App | 域名 | 用途 |
| --- | --- | --- |
| 优酷 | `atm.youku.com`（含 adp / count / m / val） | 广告计数 |
| 优酷 | `ems.youku.com` | 埋点 |
| 爱奇艺 | `cupid.iqiyi.com`（含 `t7z.cupid`） | 广告决策 |
| 爱奇艺 | `ads.iqiyi.com` | 广告素材 |
| 爱奇艺 | `act.vip.iqiyi.com` | 会员活动弹窗 |
| 爱奇艺 | `msg.71.am`、`data.video.iqiyi.com` | 埋点 |
| 爱奇艺 | `t7z.cupid.ptqy.gitv.tv` | TV 端广告 |
| 腾讯视频 | `ads.video.qq.com` | 广告接口 |
| 腾讯视频 | `adsmind.*`、`pgdt.*`、`qzs.gdtimg.com`、`mi.gdt.qq.com` | 广点通广告 SDK |
| 腾讯视频 | `sdk.e.qq.com`、`tangram.e.qq.com` | 广告 SDK |
| 腾讯视频 | `btrace` / `info4` / `info6` / `trace.video.qq.com` | 播放埋点与广告信息 |
| 腾讯视频 | `vd.l.qq.com`、`pingfore.qq.com`、`news.ssp.qq.com` | 广告与遥测 |

## 优酷为什么只留了埋点

`ad.api.3g.youku.com`、`ad.m.youku.com`、`iyes.youku.com` 一开始也做了 REJECT，
但实测会让优酷视频直接播不了：播放器起播前会同步等广告接口，连接被拒后整次播放
卡住，而不是跳过广告。

所以这三个撤掉了，优酷只保留纯埋点域名。代价是优酷的开屏 / 贴片广告可能还会出现。
要彻底去掉，需要抓一份广告接口的响应，改成「没有广告」的合法 JSON（类似 Tubi 的做法），
有抓包可以再补。

## 没有拦什么

`vv.video.qq.com`（播放地址）、`acs.youku.com`（优酷 API 网关）、
`api.iqiyi.com`、`iface.iqiyi.com`（爱奇艺 API 网关）都不在列表里。
这些域名同时承载播放和登录，拦了会直接坏掉。

## 能解决什么、不能解决什么

- **爱奇艺 / 腾讯视频的开屏、暂停、贴片、Feed 广告**：素材和决策请求都在上面的域名里，
  请求失败后客户端通常直接跳过广告。
- **优酷**：只拦了埋点和广告计数，广告本身可能还在；原因见上一节。
- **「我的」「设置」页的推广入口**：入口本身是 App 本地 UI 或接口下发的位置，域名拒绝
  只能让它加载不出内容，删不掉入口。要删入口需要改响应结构，目前没有可靠抓包，
  不做猜测性改写。
- **会员专属内容**：不在本模块范围，也不做。

## 注意

- 纯规则模块，不需要安装证书、不需要开 MITM。
- 如果某个 App 更新后广告又出来了，先在 Loon / Egern 的请求日志里看广告请求打到哪个
  域名，把它加到对应分组即可。
- 域名表由各 App 的历史抓包与广告规则整理，已剔除会误伤播放的网关域名。
