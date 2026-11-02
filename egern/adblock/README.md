# ADBlock — 通用广告拦截 (Rewrite 规则)

基于 blackmatrix7/ios_rule_script (Advertising) + Kelee BlockAdvertisers，744 条 rewrite 规则 + 698 个 MitM hostname，覆盖国内外常见广告。

## Loon
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/adblock/adblock.plugin`

## Egern
`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/adblock/adblock.yaml`

## 说明
- 仅 rewrite 规则（reject/reject-dict/reject-img/reject-200），不含 rules 类 reject（已有 httpdns-block 覆盖）。
- 图标：Reject.png。
- 不需要每日更新（blackmatrix7 更新频率低，手动更新即可）。
