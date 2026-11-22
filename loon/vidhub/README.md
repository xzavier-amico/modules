# VidHub Unlock — Loon 插件

- Loon：`loon/vidhub/vidhub-unlock.plugin` + `js/vidhub_unlock.js`
- 源文件：`src/vidhub/vidhub_unlock.js`

把 VidHub 的 `GET /api/v1/licenses` 响应替换成伪造 license，用来验证客户端是不是只信服务端 JSON。**不改 App 二进制，也不伪造请求签名。**

## 安装

1. Loon 导入插件 `vidhub-unlock.plugin`；
2. 打开 MITM 并信任证书，同时打开「MitM over HTTP/2」和「QUIC 回退保护」；
3. 杀掉 VidHub 重开。不生效就退出账号再登录，或删掉重装清掉本地缓存的 `data:null`。

## 判断是否命中

Loon 日志搜 `[VidHub Unlock]`：

- 有日志：响应已改写，看 App 是否解锁；
- 没日志：请求没进脚本，检查 MITM / HTTP/2 / QUIC，以及 URL（HAR 里是 `121.43.145.95` + Host `vh.api.okaapps.com`，插件两个都匹配）。

## 先试哪些组合

默认：

```json
{"code":200,"msg":"ok","data":[{"vip":1,"expire":"2099-12-31 23:59:59"}]}
```

按顺序改插件参数：

1. `mode=array`（默认）
2. `mode=object` —— `data` 变成单个对象
3. `mode=string` —— `data` 是 JSON 字符串
4. `expire` 换成 `2099-12-31T23:59:59Z`、`2099-12-31T23:59:59+08:00`
5. `vip` 试 `1`、`99`、`9999`

每次改完保存插件，杀掉 App 重开。

## 如果 `data` 是加密的

`responseSecrectKey` base64 解码是 48 字节，符合 AES-256 key(32) + IV(16)：

```text
key = ca54c7dae72f315dcab128431ae29d9111bb476dde159d9d65aceb34b57b91bc
iv  = efaedace4821914e5c289fa397916ec4
```

按 AES-CBC/PKCS7 生成：

```bash
printf '%s' '{"vip":1,"expire":"2099-12-31 23:59:59"}' \
  | openssl enc -aes-256-cbc \
      -K ca54c7dae72f315dcab128431ae29d9111bb476dde159d9d65aceb34b57b91bc \
      -iv efaedace4821914e5c289fa397916ec4 \
      -base64 -A
```

把输出粘到 `raw` 参数，`mode` 选 `raw` 再试。

## 注意

- `/api/v1/licenses/apple` 现在统一回 `{"code":200,"msg":"ok","data":null}`，让客户端继续走 `GET /licenses`。如果确认它必须在这里拿到 license，改 `src/vidhub/vidhub_unlock.js` 的 `isApple` 分支。
- 如果 App 还会用本地 StoreKit / 收据二次校验，MITM 不会生效，需要改走静态 patch。
- 本模块目前只生成 Loon 成品，先验证；确认可用后再补 Egern / Shadowrocket。
