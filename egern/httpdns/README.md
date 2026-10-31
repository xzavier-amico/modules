# HTTPDNS Block — Egern 模块

阻止常见的 HTTPDNS 服务器。来源：VirgilClyne/GetSomeFries。

## 使用

```yaml
modules:
  - name: "HTTPDNS Block"
    url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/httpdns/httpdns-block.yaml"
    enabled: true
```

需要开启 MitM（hostnames 已在模块中列出）。

## 说明

- 64 条 rules（DOMAIN / DOMAIN-SUFFIX / IP-CIDR / IP-CIDR6 → REJECT）
- 51 条 url_rewrites（reject）
- 2 条 map_locals（Alipay amdc mock）
- 6 个 mitm hostnames
- 无脚本、无参数

## 许可

基于 VirgilClyne 的 GetSomeFries 项目，仅做格式转换。
