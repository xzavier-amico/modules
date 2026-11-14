# ADBlock — 通用广告与遥测拦截 (Rewrite + Rules)

常见国内外广告 URL 重写拦截，合并广告平台、遥测统计 SDK 与 HTTPDNS 拦截规则。

## 安装
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/adblock/adblock.plugin`

需要开启 MitM。

## 内容
- [Rule] 1788 条（HTTPDNS、广告平台、遥测 SDK 与 MetaCubeX category-ads-all 存活域名）
- [Rewrite] 795 条
- [MITM] 639 hostnames

## 说明
- 图标：Reject.png
- 不需要每日更新
- 原 HTTPDNS Block 插件的规则已并入本模块，独立插件已移除
- 遥测部分只拦统计、归因与崩溃 SDK；推送（jpush / getui / umeng push）与深链（branch.io）不拦，避免影响通知和唤起
- 已清理双栈 NXDOMAIN 的失效域名，以及被 DOMAIN-SUFFIX 覆盖的冗余 DOMAIN 规则
- MITM 只保留可能命中重写规则的域名，已删掉 IP、带端口、非法通配，以及已被 REJECT 覆盖的域名
