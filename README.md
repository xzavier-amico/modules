# modules

个人自用的 **Egern / Loon** 模块仓库。模块直接托管在 GitHub raw，按平台分目录维护：

- `egern/` — Egern 模块（YAML）
- `loon/` — Loon 插件（plugin）
- `scripts/` — 上游同步、补丁与校验脚本

## 模块索引

| 模块 | Egern | Loon | 说明 |
| --- | :---: | :---: | --- |
| YouTube Enhance | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/youtube/youtube-enhance.plugin) | 去广告、后台播放、PiP、最高 4x 倍速、On-the-go；可屏蔽首页 Shorts 货架、过滤会员专属视频 |
| Spotify Premium | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/spotify/spotify-premium.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-premium.plugin) | 改写 bootstrap 的 protobuf：去广告、伪装 Premium、解锁顺序/随机播放；未知字段原样保留 |
| Tubi Ad-Free | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/tubi/tubi-adfree.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/tubi/tubi-adfree.plugin) | 去广告：广告接口返回空列表 / 空 VAST，视频流不动，不触发反广告拦截 |
| Pluto TV Ad-Free | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/pluto/pluto-adfree.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/pluto/pluto-adfree.plugin) | 去广告：把 boot 的 serverSideAds 改成 false，stitcher 不再把广告缝进 HLS |
| Emby Unlock | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/emby/emby-unlock.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/emby/emby-unlock.plugin) | 解锁 Emby iOS 客户端的完整播放：mock mb3admin.com 授权校验；不含服务器端 Premiere |
| BiliBili Clean | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/bilibili/bilibili-clean.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/bilibili/bilibili-clean.plugin) | 去广告、去会员推广、去遥测；playurl 自动要最高画质 |
| ADBlock | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/adblock/adblock.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/adblock/adblock.plugin) | 常见国内外广告 URL 重写拦截 |
| HTTPDNS Block | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/httpdns/httpdns-block.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/httpdns/httpdns-block.plugin) | 阻止常见的 HTTPDNS 服务器 |

表格里的「安装」就是模块的 raw URL，可直接粘贴到对应 App 的导入框。

> `loon/local_reflect/local_reflect.plugin` 是本机开发用的服务回环插件，不属于通用模块，未列入上表。

## 安装

### Egern

在 Egern → 模块 → 添加模块，粘贴 YAML 的 raw URL；也可以写进主配置：

```yaml
modules:
  - name: "YouTube Enhance"
    url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml"
    enabled: true
```

### Loon

在 Loon → 插件 → 右上角 `+` → 从 URL 导入，粘贴 plugin 的 raw URL。

## 通用要求

- 需要改写 HTTPS 响应的模块（YouTube、Spotify、Tubi、Pluto、Emby、Bilibili、ADBlock 的 HTTPS 规则）必须在客户端安装并信任 CA 证书，并开启 MITM；具体域名见各模块的 `mitm` / `[MitM]` 段。
- HTTPDNS Block 是纯规则模块，不需要 MITM。
- YouTube 的 response / ump 脚本需要处理大响应，Egern 版已把 timeout 调到 60s；设备较慢时可继续调大。

## 目录结构

```text
egern/<module>/<module>.yaml     # Egern 模块
egern/<module>/js/               # Egern 脚本
loon/<module>/<module>.plugin    # Loon 插件
loon/<module>/js/                # Loon 脚本
scripts/update.sh                # 拉取上游、重新生成、提交推送
scripts/patch_youtube.py         # YouTube 脚本补丁（Surge -> Egern/Loon）
scripts/validate.py              # 参数、占位符、JSON、JS 语法校验
```

## 维护

```bash
python3 scripts/validate.py      # 提交前校验
bash scripts/update.sh           # 手动同步上游（不再定时执行）
```

`validate.py` 会检查：

- Egern 的 `compat_arguments`、`compat_arguments_schema`、`compat_arguments_desc` 与 `{{{占位符}}}` 是否一致
- Egern env 里的 JSON 参数模板是否合法、是否有重复键
- Loon `[Argument]` 与 `script(...)` 参数对象是否一致
- Egern / Loon 同名模块的参数集合是否一致
- 本地 raw URL（脚本、图标）是否指向仓库中存在的文件
- 所有 JavaScript 文件是否通过 `node --check`

`update.sh` 在 YouTube 补丁失败时会保留旧脚本并在日志中记录，不会用未打补丁的脚本覆盖仓库。

## 来源与许可

- YouTube Enhance：原始代码来自 [Maasea](https://github.com/Maasea)（Apache-2.0），经 [gholts/surge](https://github.com/gholts/surge) 转换，本仓库由 xzavier-amico 维护并扩展。
- BiliBili Clean：接口路径参考社区抓包（Biliverse / app2smile），脚本与规则为本仓库重写。
- Spotify Premium：字段号与属性/规则表来自 [whoeevee/EeveeSpotifyReborn](https://github.com/whoeevee/EeveeSpotifyReborn) 与 [skopevoj/spoti.pw](https://github.com/skopevoj/spoti.pw)（v0.21.1，GPL-3.0），本仓库重写为 Loon / Egern 脚本，按 GPL-3.0 分发。
- Tubi Ad-Free：广告链路参考 Tubi 自家开源的 [Tubitv/TubiPlayer](https://github.com/Tubitv/TubiPlayer)（MIT）与 Tubi Web 播放器脚本，本仓库自行实现为 Loon / Egern 脚本。
- Pluto TV Ad-Free：做法来自对 `boot.pluto.tv` 查询参数与 stitcher 会话 JWT 的实测，本仓库自行实现。
- Emby Unlock：接口路径与响应字段参考 [eggleader-zhang/Unlock-Emby-Surge](https://github.com/eggleader-zhang/Unlock-Emby-Surge)，本仓库重写为 Loon / Egern 脚本。
- ADBlock：[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)。
- HTTPDNS Block：[VirgilClyne/GetSomeFries](https://github.com/VirgilClyne/GetSomeFries)。

各模块的具体来源、许可与参数说明见对应目录的 `README.md`。
