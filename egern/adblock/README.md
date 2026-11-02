# ADBlock — 通用广告拦截 (Rewrite + Rules)

基于 blackmatrix7/ios_rule_script (Advertising) + Kelee BlockAdvertisers + HTTPDNS Block 合并。

## Loon
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/adblock/adblock.plugin`

## Egern
`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/adblock/adblock.yaml`

## 内容
- Loon: [General] force-http-engine-hosts + [Rule] 64 条 + [Rewrite] 797 条 + [MITM] 707 hostnames
- Egern: 64 rules + 795 url_rewrites + 2 map_locals + 707 mitm hostnames

## 说明
- 图标：Reject.png
- 不需要每日更新
- HTTPDNS Block 的 rules/map_locals 已合并进来，可单独停用 httpdns-block 插件
