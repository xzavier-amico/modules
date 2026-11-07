# modules

个人自用的 **Egern / Loon / Shadowrocket** 模块仓库。模块直接托管在 GitHub raw，按平台分目录维护：

- `egern/` — Egern 模块（YAML）
- `loon/` — Loon 插件（plugin）
- `shadowrocket/` — Shadowrocket 模块（sgmodule）

## 模块索引

| 模块 | Egern | Loon | Shadowrocket | 说明 |
| --- | :---: | :---: | :---: | --- |
| YouTube Enhance | [安装](egern:/modules/new?name=YouTube%20Enhance&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fyoutube%2Fyoutube-enhance.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fyoutube%2Fyoutube-enhance.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/youtube/youtube-enhance.sgmodule) | 去广告、字幕翻译、YouTube Music 去广告/后台播放、默认分辨率、首页菜单与 Shorts 过滤、On-the-go；后台播放/PiP 常开 |
| Spotify Premium | [安装](egern:/modules/new?name=Spotify%20Premium&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fspotify%2Fspotify-premium.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fspotify%2Fspotify-premium.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/spotify/spotify-premium.sgmodule) | 改写 bootstrap 的 protobuf：去广告、伪装 Premium、解锁顺序/随机播放；官方没有歌词时注入第三方歌词 |
| Tubi Ad-Free | [安装](egern:/modules/new?name=Tubi%20Ad-Free&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Ftubi%2Ftubi-adfree.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Ftubi%2Ftubi-adfree.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/tubi/tubi-adfree.sgmodule) | 去广告：清空内容元数据里的 cue_points，广告接口返回空列表 / 空 VAST，视频流不动，不触发反广告拦截 |
| Pluto TV Ad-Free | [安装](egern:/modules/new?name=Pluto%20TV%20Ad-Free&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fpluto%2Fpluto-adfree.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fpluto%2Fpluto-adfree.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/pluto/pluto-adfree.sgmodule) | 去广告：boot 的 serverSideAds 改成 false，再删掉 HLS 点播清单里的广告段 |
| Emby Unlock | [安装](egern:/modules/new?name=Emby%20Unlock&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Femby%2Femby-unlock.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Femby%2Femby-unlock.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/emby/emby-unlock.sgmodule) | 解锁 Emby iOS 客户端的完整播放：mock mb3admin.com 授权校验；不含服务器端 Premiere |
| BiliBili Clean | [安装](egern:/modules/new?name=BiliBili%20Clean&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fbilibili%2Fbilibili-clean.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fbilibili%2Fbilibili-clean.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/bilibili/bilibili-clean.sgmodule) | 去广告、去会员推广、去遥测；详情页与评论区走 gRPC 也一并改写；playurl 自动要最高画质 |
| Delivery Ad-Free | [安装](egern:/modules/new?name=Delivery%20Ad-Free&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fdelivery%2Fdelivery-adfree.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fdelivery%2Fdelivery-adfree.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/delivery/delivery-adfree.sgmodule) | 京东 / 美团 / 饿了么：拒绝广告域名，MITM 改写美团开屏、点餐广告板与京东促销楼层，保守过滤信息流广告 |
| CN Video Ad-Free | [安装](egern:/modules/new?name=CN%20Video%20Ad-Free&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fcnvideo%2Fcnvideo-adfree.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fcnvideo%2Fcnvideo-adfree.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/cnvideo/cnvideo-adfree.sgmodule) | 优酷 / 爱奇艺 / 腾讯视频：拒绝广告、广告 SDK 与遥测域名；纯规则 |
| ADBlock | [安装](egern:/modules/new?name=ADBlock&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fadblock%2Fadblock.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fadblock%2Fadblock.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/adblock/adblock.sgmodule) | 常见国内外广告 URL 重写拦截 |
| HTTPDNS Block | [安装](egern:/modules/new?name=HTTPDNS%20Block&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fhttpdns%2Fhttpdns-block.yaml) | [安装](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fhttpdns%2Fhttpdns-block.plugin) | [安装](shadowrocket://install?module=https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/httpdns/httpdns-block.sgmodule) | 阻止常见的 HTTPDNS 服务器 |

表格里的「安装」使用 App 的 URL scheme（`egern:/modules/new`、`loon://import`、`shadowrocket://install`），点击会直接唤起对应 App 并带上模块地址，不再跳转到 raw 文件页面。若在桌面浏览器里打开，需要手动允许跳转。

> `loon/local-reflect/local-reflect.plugin` 是本机开发用的服务回环插件（把发往 `10.7.0.1` 的连接反射回本机），依赖 Loon 的 `[IP Rewrite]` 与 `include-tun`，Shadowrocket 没有对应能力，未列入上表。

## 安装

### Egern

直接点表格里的「安装」会通过 `egern:/modules/new?name=…&url=…` 唤起 Egern 并导入；也可以手动在 Egern → 模块 → 添加模块里粘贴 YAML 的 raw URL，或写进主配置：

```yaml
modules:
  - name: "YouTube Enhance"
    url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml"
    enabled: true
```

### Loon

直接点表格里的「安装」会通过 `loon://import?plugin=…` 唤起 Loon 并导入；也可以手动在 Loon → 插件 → 右上角 `+` → 从 URL 导入，粘贴 plugin 的 raw URL。

### Shadowrocket

直接点表格里的「安装」会通过 `shadowrocket://install?module=…` 唤起 Shadowrocket 并导入；也可以手动在 Shadowrocket → 配置 → 模块 → 右上角 `+`，粘贴 sgmodule 的 raw URL。模块顶部用 `#!arguments` 声明参数，导入后在「模块 → 编辑参数」里改，保存后重新进入模块即可生效。

Shadowrocket 的模块语法与 Loon 不同，转换时做了这些映射：

- `[Argument]` → `#!arguments` + `{{{参数}}}` 占位符；
- `script(...) with ...` → `type=http-request/http-response` 加 `requires-body` / `binary-body-mode` / `max-size` / `timeout`；
- `request if ${url} ~= /…/ then reject(404)` → `[URL Rewrite]` 的 `reject` / `reject-200` / `reject-dict` / `reject-img`；
- `request.header.del("if-none-match")` → `[Header Rewrite]` 的 `header-del`；
- `[MitM]` → `[MITM] hostname = %APPEND% …`；
- Loon 的 `enable=${param}` 条件加载在 Shadowrocket 里没有对应项，改由脚本内部提前返回（脚本本身已经支持）。

## 通用要求

- 需要改写 HTTPS 响应的模块（YouTube、Spotify、Tubi、Pluto、Emby、Bilibili、Delivery、ADBlock 的 HTTPS 规则）必须在客户端安装并信任 CA 证书，并开启 MITM；具体域名见各模块的 `mitm` / `[MitM]` / `[MITM]` 段。
- HTTPDNS Block 与 CN Video Ad-Free 是纯规则模块，不需要 MITM。
- YouTube 的 response / ump 脚本需要处理大响应，三端都已把 timeout 调到 60s；设备较慢时可继续调大。
- Shadowrocket 的脚本运行在内存受限的 Network Extension 里，sgmodule 里的 `max-size` 是保险丝：超过上限的响应直接放行，不会把脚本拖死。正常响应远低于上限。

## 目录结构

```text
egern/<module>/<module>.yaml        # Egern 模块
egern/<module>/js/                  # Egern 脚本
loon/<module>/<module>.plugin       # Loon 插件
loon/<module>/js/                   # Loon 脚本
shadowrocket/<module>/<module>.sgmodule  # Shadowrocket 模块
shadowrocket/<module>/js/           # Shadowrocket 脚本
```

## 维护

模块全部由本仓库自行维护，不跟随上游自动同步。三端共用同一份脚本：`egern/`、`loon/`、`shadowrocket/` 下的 `js/` 内容完全一致，改完一处要同步到另外两处，并跑一遍 `node --check`。

```bash
for m in youtube spotify bilibili delivery pluto tubi emby; do
  rm -rf egern/$m/js shadowrocket/$m/js
  cp -a loon/$m/js egern/$m/js
  cp -a loon/$m/js shadowrocket/$m/js
done
```

脚本里有一段 `TextEncoder` / `TextDecoder` 的兼容实现：Loon 与 Egern 运行时自带这两个对象，Shadowrocket 不保证提供。代码用 `typeof` 判断，已有原生对象时整段跳过，所以三端可以共用，不要删。

## 来源与许可

- YouTube Enhance：原始逻辑来自 [Maasea](https://github.com/Maasea)（Apache-2.0），经 [gholts/surge](https://github.com/gholts/surge) 分发；本仓库把 4 个脚本重写并合并为单文件 `js/youtube.js`，按 Apache-2.0 保留原版权声明并注明修改。
- BiliBili Clean：接口路径参考社区抓包（Biliverse / app2smile），脚本与规则为本仓库重写。
- CN Video Ad-Free：域名表参考 [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) 与各 App 历史抓包，本仓库整理。
- Spotify Premium：字段号与属性/规则表来自 [whoeevee/EeveeSpotifyReborn](https://github.com/whoeevee/EeveeSpotifyReborn) 与 [skopevoj/spoti.pw](https://github.com/skopevoj/spoti.pw)（v0.21.1，GPL-3.0），本仓库重写为 Loon / Egern / Shadowrocket 脚本，按 GPL-3.0 分发。
- Tubi Ad-Free：广告链路参考 Tubi 自家开源的 [Tubitv/TubiPlayer](https://github.com/Tubitv/TubiPlayer)（MIT）与 Tubi Web 播放器脚本，本仓库自行实现为 Loon / Egern / Shadowrocket 脚本。
- Pluto TV Ad-Free：做法来自对 `boot.pluto.tv` 查询参数与 stitcher 会话 JWT 的实测，本仓库自行实现。
- Emby Unlock：接口路径与响应字段参考 [eggleader-zhang/Unlock-Emby-Surge](https://github.com/eggleader-zhang/Unlock-Emby-Surge)，本仓库重写为 Loon / Egern / Shadowrocket 脚本。
- ADBlock：[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)。
- HTTPDNS Block：[VirgilClyne/GetSomeFries](https://github.com/VirgilClyne/GetSomeFries)。

各模块的具体来源、许可与参数说明见 `loon/` 或 `egern/` 对应目录的 `README.md`；三端的参数名与默认值一致。
