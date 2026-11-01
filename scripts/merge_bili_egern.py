#!/usr/bin/env python3
import yaml, pathlib, re

PLUGINS = [
    ("Enhanced", "/opt/modules/.cache/bili/Enhanced.egern.yaml", "/opt/modules/.cache/bili/Enhanced.plugin"),
    ("Global", "/opt/modules/.cache/bili/Global.egern.yaml", "/opt/modules/.cache/bili/Global.plugin"),
    ("Redirect", "/opt/modules/.cache/bili/Redirect.egern.yaml", "/opt/modules/.cache/bili/Redirect.plugin"),
    ("ADBlock", "/opt/modules/.cache/bili/ADBlock.egern.yaml", "/opt/modules/.cache/bili/ADBlock.plugin"),
]

def parse_surge_args(path):
    # returns dict: surge_key -> {type, default, options, tag, desc}
    text = pathlib.Path(path).read_text(encoding="utf-8")
    in_arg = False
    res = {}
    for line in text.splitlines():
        if line.strip() == "[Argument]":
            in_arg = True
            continue
        if in_arg and line.strip().startswith("["):
            in_arg = False
            continue
        if not in_arg:
            continue
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, rest = line.split("=", 1)
        key = key.strip(); rest = rest.strip()
        # parse tag/desc
        ti = rest.find("tag="); di = rest.find("desc=")
        cut = len(rest)
        if ti != -1: cut = min(cut, ti)
        if di != -1: cut = min(cut, di)
        head = rest[:cut].rstrip(",").strip()
        tag = ""; desc = ""
        if ti != -1:
            tag_end = di if (di != -1 and di > ti) else len(rest)
            tag = rest[ti:tag_end].strip().rstrip(",").strip()
            tag = tag[len("tag="):].strip().strip('"')
        if di != -1:
            desc = rest[di + len("desc="):].strip().strip('"')
        parts = [p.strip() for p in split_csv(head)]
        typ = parts[0] if parts else "input"
        opts = parts[1:]
        default = ""; options = None
        if typ == "switch":
            default = opts[0] if opts else "true"
            options = ["true", "false"]
        elif typ == "select":
            cleaned = [o.strip().strip('"') for o in opts]
            if cleaned:
                default = cleaned[0]
                options = cleaned
        else:
            if opts:
                default = opts[0].strip().strip('"')
            options = []
        res[key] = {"type": typ, "default": default, "options": options, "tag": tag, "desc": desc}
    return res

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

# load native egern yamls
docs = {}
surge_args = {}
for name, epath, spath in PLUGINS:
    docs[name] = yaml.safe_load(pathlib.Path(epath).read_text())
    surge_args[name] = parse_surge_args(spath)

# merged compat_arguments (dedupe shared)
merged_args = {}  # key -> default value (str)
for name, _, _ in PLUGINS:
    for k, v in docs[name]["compat_arguments"].items():
        if k not in merged_args:
            merged_args[k] = v

# merged compat_arguments_desc: concatenate
desc_parts = []
for name, _, _ in PLUGINS:
    d = docs[name].get("compat_arguments_desc")
    if d:
        desc_parts.append(f"## {name}\n{d.strip()}")
merged_desc = "\n\n".join(desc_parts)

# build compat_arguments_schema from surge metadata (original keys)
schema = {}
for name, _, spath in PLUGINS:
    for sk, info in surge_args[name].items():
        if sk in schema:
            continue
        entry = {}
        entry["name"] = info["tag"] if info["tag"] else sk
        if info["desc"]:
            entry["description"] = info["desc"]
        if info["type"] == "switch":
            entry["options"] = ["true", "false"]
        elif info["options"]:
            entry["options"] = info["options"]
        else:
            entry["options"] = []
        schema[sk] = entry

# merge scriptings
merged_scriptings = []
seen_names = set()
for name, _, _ in PLUGINS:
    for s in docs[name].get("scriptings", []):
        merged_scriptings.append(s)

# merge map_locals
merged_map_locals = []
seen_ml = set()
for name, _, _ in PLUGINS:
    for ml in (docs[name].get("map_locals") or []):
        key = ml.get("match")
        if key in seen_ml:
            continue
        seen_ml.add(key)
        merged_map_locals.append(ml)

# merge url_rewrites
merged_url_rewrites = []
for name, _, _ in PLUGINS:
    for ur in (docs[name].get("url_rewrites") or []):
        merged_url_rewrites.append(ur)

# merge body_rewrites
merged_body_rewrites = []
for name, _, _ in PLUGINS:
    for br in (docs[name].get("body_rewrites") or []):
        merged_body_rewrites.append(br)

# merge mitm hostnames
merged_hosts = []
seen_h = set()
for name, _, _ in PLUGINS:
    for h in docs[name].get("mitm", {}).get("hostnames", {}).get("includes", []):
        if h not in seen_h:
            seen_h.add(h)
            merged_hosts.append(h)

# build merged doc
merged = {}
merged["name"] = "📺 BiliBili: Biliverse (Enhanced+Global+Redirect+ADBlock)"
merged["description"] = "哔哩哔哩：增强 + 全球 + 重定向 + 去广告 合并模块。"
merged["author"] = "VirgilClyne et al."
merged["homepage"] = "https://biliverse.github.io/guide/"
merged["icon"] = "https://github.com/Biliverse/Enhanced/raw/main/src/assets/icon_rounded.png"
merged["open_url"] = "http://boxjs.com/#/app/Biliverse.Enhanced"
merged["compat_arguments"] = merged_args
merged["compat_arguments_desc"] = merged_desc
merged["compat_arguments_schema"] = schema
if merged_map_locals:
    merged["map_locals"] = merged_map_locals
if merged_url_rewrites:
    merged["url_rewrites"] = merged_url_rewrites
if merged_body_rewrites:
    merged["body_rewrites"] = merged_body_rewrites
merged["scriptings"] = merged_scriptings
merged["mitm"] = {"hostnames": {"includes": merged_hosts}}

# dump
out_path = pathlib.Path("/opt/modules/egern/bilibili/bilibili-enhance.yaml")
# custom dump to preserve order-ish; use yaml.dump with sort_keys=False
with open(out_path, "w", encoding="utf-8") as f:
    yaml.dump(merged, f, allow_unicode=True, sort_keys=False, default_flow_style=False, width=10000)
print("written", out_path)
print("args:", len(merged_args), "schema:", len(schema), "scripts:", len(merged_scriptings))
print("map_locals:", len(merged_map_locals), "url_rewrites:", len(merged_url_rewrites), "body_rewrites:", len(merged_body_rewrites))
