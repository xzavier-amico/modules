# ADBlock — 通用广告与遥测拦截（Rewrite + 规则列表）

常见国内外广告 URL 重写拦截，合并广告平台、遥测统计 SDK 与 HTTPDNS 拦截规则。

插件只放 URL 重写与 MITM；域名 REJECT 规则拆到 `adblock.list`。规则太多时整包塞进插件会让 Loon 在导入 / 更新时重启，拆开后插件只保留重写部分。

## 安装

1. 安装插件：
   `https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/adblock/adblock.plugin`
2. 添加远程规则：Loon → 配置 → 远程规则，添加
   `https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/adblock/adblock.list, policy=REJECT, tag=ADBlock, enabled=true`
   也可以在远程规则界面粘贴 URL，策略选 `REJECT`。
3. 需要 HTTPS 重写时开启 MITM 并信任证书。

## 内容
- 插件：[Rewrite] 797 条（其中 795 条 reject）+ [MITM] 639 hostnames
- 规则列表：1791 条 REJECT

## 说明
- 图标：Reject.png
- 规则列表不需要每日更新，插件更新也不会影响远程规则
- 原 HTTPDNS Block 插件的规则已并入本模块，独立插件已移除
- 遥测部分只拦统计、归因与崩溃 SDK；推送（jpush / getui / umeng push）与深链（branch.io）不拦，避免影响通知和唤起
- 上游把 CapCut 的 tnc* CDN 也列进了广告域名，同步时已排除，避免拦掉后播放卡住
- 已清理双栈 NXDOMAIN 的失效域名，以及被 DOMAIN-SUFFIX 覆盖的冗余 DOMAIN 规则
- MITM 只保留可能命中重写规则的域名，已删掉 IP、带端口、非法通配，以及已被 REJECT 覆盖的域名
