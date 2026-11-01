#!/usr/bin/env python3
import pathlib, re

PLUGINS = [
    "/opt/modules/.cache/bili/Enhanced.plugin",
    "/opt/modules/.cache/bili/Global.plugin",
    "/opt/modules/.cache/bili/Redirect.plugin",
    "/opt/modules/.cache/bili/ADBlock.plugin",
]

def parse_plugin(path):
    text = pathlib.Path(path).read_text(encoding="utf-8")
    # metadata
    meta = {}
    for line in text.splitlines():
        m = re.match(r"^#!(\w+)\s*=\s*(.*)$", line.strip())
        if m:
            meta[m.group(1)] = m.group(2)
    # sections
    sections = {}
    cur = None
    for line in text.splitlines():
        m = re.match(r"^\[(.+)\]\s*$", line.strip())
        if m:
            cur = m.group(1); sections[cur] = []; continue
        if cur is not None:
            sections[cur].append(line)
    return meta, sections

def parse_argument_line(line):
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if "=" not in line:
        return None
    key, rest = line.split("=", 1)
    key = key.strip(); rest = rest.strip()
    # type is first token
    # format: type,default,...,tag=...,desc=...
    ti = rest.find("tag="); di = rest.find("desc=")
    cut = len(rest)
    if ti != -1: cut = min(cut, ti)
    if di != -1: cut = min(cut, di)
    head = rest[:cut].rstrip(",").strip()
    tag = ""; desc = ""
    if ti != -1:
        te = di if (di != -1 and di > ti) else len(rest)
        tag = rest[ti:te].strip().rstrip(",").strip()
        tag = tag[len("tag="):].strip().strip('"')
    if di != -1:
        desc = rest[di + len("desc="):].strip().strip('"')
    parts = [p.strip() for p in split_csv(head)]
    typ = parts[0] if parts else "input"
    opts = parts[1:]
    default = ""
    if typ == "switch":
        default = opts[0] if opts else "true"
    elif typ == "select":
        cleaned = [o.strip().strip('"') for o in opts]
        default = cleaned[0] if cleaned else ""
        opts = cleaned
    else:
        if opts:
            default = opts[0].strip().strip('"')
    return key, typ, default, opts, tag, desc

def split_csv(s):
    res = []; cur = ""; inq = False
    for ch in s:
        if ch == '"':
            inq = not inq; cur += ch
        elif ch == ',' and not inq:
            res.append(cur); cur = ""
        else:
            cur += ch
    if cur.strip():
        res.append(cur)
    return res

def to_loon_arg(key, typ, default, opts, tag, desc):
    # Loon: key = controltype,default,type=valuetype,tag=...,desc=...
    if typ == "switch":
        vt = "boolean"
        return f'{key} = switch,{default},type={vt},tag={tag},desc={desc}'
    elif typ == "select":
        vt = "string"
        # if all options numeric, could be number; keep string for safety
    else:
        # input: detect number
        try:
            float(default)
            # only if default is a pure number and no comma
            if default and "," not in default and default.replace(".", "", 1).isdigit():
                vt = "number"
            else:
                vt = "string"
        except ValueError:
            vt = "string"
    # build default token
    if typ == "switch":
        default_tok = default
    elif typ == "select":
        default_tok = '"' + default + '"'
        opts_tok = ",".join('"' + o + '"' for o in opts)
        # opts already include default as first; for select, Loon format: select,"a","b",...
        # reconstruct: controltype, default, ...options? Actually Loon: region = select,"CN","US","JP",type=string
        # first quoted is default? In example: region = select,"CN","US","JP",type=string,tag=地区
        # So default is first option. Good.
        base = f'{key} = {typ},"{default}"' + ("," + ",".join('"' + o + '"' for o in opts[1:]) if len(opts) > 1 else "") + f",type={vt},tag={tag},desc={desc}"
        return base
    elif typ == "input":
        # input,default,type=...
        if vt == "number":
            base = f'{key} = input,{default},type={vt},tag={tag},desc={desc}'
        else:
            base = f'{key} = input,"{default}",type={vt},tag={tag},desc={desc}'
        return base
    else:
        return f'{key} = {typ},{default},type={vt},tag={tag},desc={desc}'

# parse all
parsed = []
for p in PLUGINS:
    meta, sections = parse_plugin(p)
    parsed.append((meta, sections))

# merge arguments (dedupe by key)
merged_args = {}  # key -> (typ, default, opts, tag, desc, source_plugin)
arg_order = []
for meta, sections in parsed:
    for line in sections.get("Argument", []):
        info = parse_argument_line(line)
        if not info:
            continue
        key, typ, default, opts, tag, desc = info
        if key in merged_args:
            continue
        merged_args[key] = (typ, default, opts, tag, desc)
        arg_order.append(key)

# collect sections
def collect(section_name):
    lines = []
    seen = set()
    for meta, sections in parsed:
        for line in sections.get(section_name, []):
            s = line.strip()
            if not s:
                continue
            if s in seen:
                continue
            seen.add(s)
            lines.append(line)
    return lines

script_lines = collect("Script")
rewrite_lines = collect("Rewrite")
host_lines = collect("Host")
mitm_lines = []  # merge hostnames
all_hosts = []
for meta, sections in parsed:
    for line in sections.get("MitM", []):
        line = line.strip()
        if line.startswith("hostname"):
            val = line.split("=", 1)[1].strip()
            for h in val.split(","):
                h = h.strip()
                if h and h not in all_hosts:
                    all_hosts.append(h)
        elif line.startswith("h2"):
            pass
general_lines = collect("General")
rule_lines = collect("Rule")

# metadata from first
meta0 = parsed[0][0]

out = []
out.append(f"#!name = 📺 BiliBili: Biliverse (Enhanced+Global+Redirect+ADBlock)")
out.append(f"#!desc = 哔哩哔哩：增强 + 全球 + 重定向 + 去广告 合并模块")
out.append(f"#!author = VirgilClyne et al.")
out.append(f"#!homepage = https://biliverse.github.io/guide/")
out.append(f"#!icon = https://github.com/Biliverse/Enhanced/raw/main/src/assets/icon_rounded.png")
out.append(f"#!tag = BiliBili,Biliverse")
out.append("")

out.append("[Argument]")
for key in arg_order:
    typ, default, opts, tag, desc = merged_args[key]
    out.append(to_loon_arg(key, typ, default, opts if opts else [], tag, desc))
out.append("")

if general_lines:
    out.append("[General]")
    out.extend(general_lines)
    out.append("")

if rule_lines:
    out.append("[Rule]")
    out.extend(rule_lines)
    out.append("")

if rewrite_lines:
    out.append("[Rewrite]")
    out.extend(rewrite_lines)
    out.append("")

if host_lines:
    out.append("[Host]")
    out.extend(host_lines)
    out.append("")

out.append("[Script]")
out.extend(script_lines)
out.append("")

out.append("[MitM]")
out.append("hostname = " + ", ".join(all_hosts))
# h2 if any plugin had h2=true
h2 = any("h2 = true" in "\n".join(s.get("MitM", [])) for _, s in parsed)
if h2:
    out.append("h2 = true")
out.append("")

pathlib.Path("/opt/modules/loon/bilibili/bilibili-enhance.plugin").write_text("\n".join(out), encoding="utf-8")
print("written")
print("args:", len(arg_order), "scripts:", len(script_lines), "rewrites:", len(rewrite_lines), "hosts:", len(all_hosts))
