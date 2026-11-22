# ADBlock — 通用广告与遥测拦截（Rewrite + 规则集）

常见国内外广告 URL 重写拦截，合并广告平台与遥测统计 SDK 规则；不再拦截 HTTPDNS。

规则单独放在 `adblock.rules.yaml`，模块里只保留一条 `rule_set` 引用；重写与 MITM 留在模块内。

## Egern

模块：
`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/adblock/adblock.yaml`

规则集：
`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/adblock/adblock.rules.yaml`

模块内已用 `rule_set` 引用规则集，导入模块即可，不需要再手动添加。

## 内容
- Egern: 1713 rules + 743 url_rewrites + 636 mitm hostnames（rules 来自远程 rule_set）

## 说明
- 图标：Reject.png
- HTTPDNS 拦截已移除：拦掉解析端点会让 App 正常请求变成 N/A，且对广告拦截收益有限
- 遥测部分只拦统计、归因与崩溃 SDK；推送（jpush / getui / umeng push）与深链（branch.io）不拦，避免影响通知和唤起
- 上游把 CapCut 的 tnc* CDN 也列进了广告域名，同步时已排除，避免拦掉后播放卡住
- 已清理双栈 NXDOMAIN 的失效域名，以及被 DOMAIN-SUFFIX 覆盖的冗余 DOMAIN 规则
- MITM 只保留可能命中重写规则的域名，已删掉 IP、带端口、非法通配，以及已被 REJECT 覆盖的域名
