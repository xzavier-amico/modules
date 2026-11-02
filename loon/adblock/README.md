# ADBlock — 通用广告拦截 (Rewrite + Rules)

基于 blackmatrix7/ios_rule_script (Advertising) + Kelee BlockAdvertisers + HTTPDNS Block 合并。

## 安装
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/adblock/adblock.plugin`

需要开启 MitM。

## 内容
- [General] force-http-engine-hosts
- [Rule] 394 条 (HTTPDNS + Kelee)
- [Rewrite] 797 条 (blackmatrix7 + Kelee)
- [MITM] 707 hostnames

## 说明
- 图标：Reject.png
- 不需要每日更新
- HTTPDNS Block 的 rules 已合并，可单独停用 httpdns-block 插件
