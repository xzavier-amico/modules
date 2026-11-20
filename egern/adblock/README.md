# ADBlock — 通用广告与遥测拦截（Rewrite + 规则集）

常见国内外广告 URL 重写拦截，合并广告平台、遥测统计 SDK 与 HTTPDNS 拦截规则。

规则单独放在 `adblock.rules.yaml`，模块里只保留一条 `rule_set` 引用；重写、Map Local 与 MITM 留在模块内。

## Egern

模块：
`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/adblock/adblock.yaml`

规则集：
`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/adblock/adblock.rules.yaml`

模块内已用 `rule_set` 引用规则集，导入模块即可，不需要再手动添加。

## 内容
- Egern: 1791 rules + 795 url_rewrites + 2 map_locals + 639 mitm hostnames（rules 来自远程 rule_set）

## 说明
- 图标：Reject.png
- 原 HTTPDNS Block 插件的 rules / map_locals 已并入本模块，独立插件已移除
- 遥测部分只拦统计、归因与崩溃 SDK；推送（jpush / getui / umeng push）与深链（branch.io）不拦，避免影响通知和唤起
- 上游把 CapCut 的 tnc* CDN 也列进了广告域名，同步时已排除，避免拦掉后播放卡住
- 已清理双栈 NXDOMAIN 的失效域名，以及被 DOMAIN-SUFFIX 覆盖的冗余 DOMAIN 规则
- MITM 只保留可能命中重写规则的域名，已删掉 IP、带端口、非法通配，以及已被 REJECT 覆盖的域名
