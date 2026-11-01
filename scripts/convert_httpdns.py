#!/usr/bin/env python3
import pathlib, re

src = pathlib.Path("/opt/modules/.cache/httpdns/httpdns.plugin").read_text(encoding="utf-8")

# parse sections
sections = {}
cur = None
for line in src.splitlines():
    m = re.match(r"^\[(.+)\]\s*$", line.strip())
    if m:
        cur = m.group(1); sections[cur] = []; continue
    if cur is not None:
        sections[cur].append(line)

# parse rules
rules = []
for line in sections.get("Rule", []):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 3:
        continue
    typ = parts[0]
    match = parts[1]
    policy = parts[2]
    no_resolve = "no-resolve" in parts[3:]
    egern_type = {"DOMAIN": "domain", "DOMAIN-SUFFIX": "domain_suffix",
                  "IP-CIDR": "ip_cidr", "IP-CIDR6": "ip_cidr6"}.get(typ)
    if not egern_type:
        continue
    entry = {egern_type: {"match": match, "policy": policy}}
    if no_resolve and egern_type.startswith("ip_"):
        entry[egern_type]["no_resolve"] = True
    rules.append(entry)

# parse url rewrites
url_rewrites = []
for line in sections.get("URL Rewrite", []):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    # format: pattern - reject  OR  pattern location
    m = re.match(r"^(\S+)\s+-\s+(\S+)\s*$", line)
    if m:
        pat = m.group(1); action = m.group(2)
        loc = "http://reject/" if action == "reject" else ("http://reject-dict/" if action == "reject-dict" else "http://reject/")
        url_rewrites.append({"match": pat, "location": loc})
        continue
    # other forms skip
    pass

# parse map locals
map_locals = []
for line in sections.get("Map Local", []):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    # format: pattern key=val ... (space separated after pattern? Actually pattern then space then params)
    # pattern is first token (no spaces), then space-separated key=value
    parts = line.split()
    if not parts:
        continue
    pat = parts[0]
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip()] = v.strip()
    # build egern map_local
    ml = {"match": pat}
    if "status-code" in params:
        ml["status_code"] = int(params["status-code"])
    # header
    if "header" in params:
        # header="Content-Type:text/json" or header="Content-Type:text/json"
        hv = params["header"].strip('"')
        if ":" in hv:
            hk, hvv = hv.split(":", 1)
            ml["headers"] = {hk.strip(): hvv.strip()}
    # body
    if "data" in params:
        d = params["data"].strip("'").strip('"')
        ml["body"] = d
    if "data-type" in params:
        if params["data-type"] == "text":
            ml["binary"] = False
    map_locals.append(ml)

# mitm
mitm_hosts = []
for line in sections.get("MITM", []):
    line = line.strip()
    if line.startswith("hostname"):
        val = line.split("=", 1)[1].strip()
        for h in val.split(","):
            h = h.strip()
            if h and h not in mitm_hosts:
                mitm_hosts.append(h)

# build yaml manually
out = []
out.append("#=======================================================================================")
out.append("# HTTPDNS Block — Egern 模块")
out.append("# 阻止常见的 HTTPDNS 服务器")
out.append("# 来源: VirgilClyne/GetSomeFries")
out.append("#=======================================================================================")
out.append("")
out.append('name: "HTTPDNS Block"')
out.append('description: "阻止常见的 HTTPDNS 服务器。"')
out.append('author: "VirgilClyne"')
out.append('homepage: "https://github.com/VirgilClyne/GetSomeFries"')
out.append('icon: "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Reject.png"')
out.append("")

out.append("rules:")
for r in rules:
    for k, v in r.items():
        out.append(f"  - {k}:")
        out.append(f'      match: "{v["match"].replace(chr(92), chr(92)+chr(92))}"')
        out.append(f'      policy: {v["policy"]}')
        if v.get("no_resolve"):
            out.append("      no_resolve: true")
out.append("")

if url_rewrites:
    out.append("url_rewrites:")
    for ur in url_rewrites:
        out.append(f'  - match: "{ur["match"].replace(chr(92), chr(92)+chr(92))}"')
        out.append(f'    location: "{ur["location"]}"')
    out.append("")

if map_locals:
    out.append("map_locals:")
    for ml in map_locals:
        out.append(f'  - match: "{ml["match"].replace(chr(92), chr(92)+chr(92))}"')
        if "status_code" in ml:
            out.append(f'    status_code: {ml["status_code"]}')
        if "headers" in ml:
            out.append("    headers:")
            for hk, hv in ml["headers"].items():
                out.append(f'      {hk}: "{hv}"')
        if "body" in ml:
            out.append(f'    body: \'{ml["body"]}\'')
        if "binary" in ml:
            out.append(f'    binary: {str(ml["binary"]).lower()}')
    out.append("")

out.append("mitm:")
out.append("  hostnames:")
out.append("    includes:")
for h in mitm_hosts:
    out.append(f'      - "{h}"')
out.append("")

pathlib.Path("/opt/modules/egern/httpdns").mkdir(parents=True, exist_ok=True)
pathlib.Path("/opt/modules/egern/httpdns/httpdns-block.yaml").write_text("\n".join(out), encoding="utf-8")
print("rules:", len(rules), "url_rewrites:", len(url_rewrites), "map_locals:", len(map_locals), "mitm:", len(mitm_hosts))
