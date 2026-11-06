# modules

个人自用的 **Egern / Loon** 模块仓库。模块直接托管在 GitHub raw，按平台分目录维护：

- `egern/` — Egern 模块（YAML）
- `loon/` — Loon 插件（plugin）
- `scripts/` — 上游同步、补丁与校验脚本

## 模块索引

| 模块 | Egern | Loon | 说明 |
| --- | :---: | :---: | --- |
| YouTube Enhance | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/youtube/youtube-enhance.plugin) | 去广告、后台播放、PiP、最高 4x 倍速、On-the-go；可屏蔽首页 Shorts 货架、过滤会员专属视频 |
| Spotify AD | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/spotify/spotify.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify.plugin) | 去广告，恢复歌手 / 专辑列表 |
| Spotify AD (Rewrite) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/spotify/spotify-rewrite.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-rewrite.plugin) | 纯 rewrite 版，无脚本，通过 mock 服务器返回修改后的响应 |
| Spotify AD (Reukix) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/spotify-reukix/spotify-reukix.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify-reukix/spotify-reukix.plugin) | Reukix 多脚本版；Loon 需 3.5.3+ |
| BiliBili Biliverse | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/bilibili/bilibili-enhance.yaml) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/bilibili/bilibili-enhance.plugin) | 增强 + 全球 + 重定向 + 去广告 合并模块 |
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

- 需要改写 HTTPS 响应的模块（YouTube、Spotify、Bilibili、ADBlock 的 HTTPS 规则）必须在客户端安装并信任 CA 证书，并开启 MITM；具体域名见各模块的 `mitm` / `[MitM]` 段。
- HTTPDNS Block 是纯规则模块，不需要 MITM。
- Spotify (Reukix) 的 Loon 版要求 Loon 3.5.3+。
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
bash scripts/update.sh           # 同步上游（由本机定时任务调用）
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

- YouTube Enhance：基于 [gholts/surge](https://github.com/gholts/surge)，原始代码来自 Maasea（Apache-2.0）。
- BiliBili Biliverse：[VirgilClyne](https://github.com/VirgilClyne) / [Biliverse](https://github.com/Biliverse)。
- Spotify：app2smile、[001ProMax](https://github.com/001ProMax)、[Reukix](https://github.com/Reukix)。
- ADBlock：[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)。
- HTTPDNS Block：[VirgilClyne/GetSomeFries](https://github.com/VirgilClyne/GetSomeFries)。

各模块的具体来源、许可与参数说明见对应目录的 `README.md`。
