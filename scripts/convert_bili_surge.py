#!/usr/bin/env python3
"""Convert Biliverse Surge .plugin files into one merged Egern module."""
import re, os, pathlib, json

PLUGINS = [
    ("Enhanced", "/tmp/opencode/bili/Enhanced.plugin",
     "https://github.com/Biliverse/Enhanced/releases/download/v0.6.2/"),
    ("Global", "/tmp/opencode/bili/Global.plugin",
     "https://github.com/Biliverse/Global/releases/download/v0.9.3/"),
    ("Redirect", "/tmp/opencode/bili/Redirect.plugin",
     "https://github.com/Biliverse/Redirect/releases/download/v0.2.25/"),
    ("ADBlock", "/tmp/opencode/bili/ADBlock.plugin",
     "https://github.com/Biliverse/ADBlock/releases/download/v0.7.5/"),
]

def parse_plugin(path):
    text = pathlib.Path(path).read_text(encoding="utf-8")
    # split sections
    sections = {}
    cur = None
    for line in text.splitlines():
        m = re.match(r"^\[(.+)\]\s*$", line.strip())
        if m:
            cur = m.group(1)
            sections[cur] = []
            continue
        if cur is not None:
            sections[cur].append(line)
    # metadata from header comments
    meta = {}
    for line in text.splitlines():
        m = re.match(r"^#!(\w+)\s*=\s*(.*)$", line.strip())
        if m:
            meta[m.group(1)] = m.group(2)
    return sections, meta

def to_snake(key):
    # Home.Switch -> home_switch ; ForceHost -> force_host ; Feed.AD -> feed_ad
    key = key.replace(".", "_")
    # insert underscore before uppercase (camelCase) but keep consecutive caps
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", s)
    return s.lower()

# shared arg keys that should be merged across modules
SHARED = {"Storage": "storage", "LogLevel": "log_level"}

def parse_argument_line(line):
    # Key = type,default,...  OR  Key = type,"val",tag=...,desc=...
    # returns (key, type, default, options_list, tag, desc)
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    # split key and rest on first '='
    if "=" not in line:
        return None
    key, rest = line.split("=", 1)
    key = key.strip()
    rest = rest.strip()
    # parse type (first token before comma)
    # type can be switch/input/select
    # rest like: switch,true,tag=...,desc=...
    # or select,"a","b",tag=...,desc=...
    # or input,"",tag=...,desc=...
    # find tag= and desc= (desc may contain commas inside quotes? desc text has commas sometimes unquoted). We'll parse carefully.
    # First split off tag= and desc= by regex
    tag = ""; desc = ""
    # extract tag=... up to desc= or end
    m_tag = re.search(r"tag=([^,]*|\"[^\"]*\")", rest)
    # simpler: find 'tag=' and 'desc=' positions
    ti = rest.find("tag=")
    di = rest.find("desc=")
    # the part before tag/desc is type + default + options
    cut = len(rest)
    if ti != -1:
        cut = min(cut, ti)
    if di != -1:
        cut = min(cut, di)
    head = rest[:cut].rstrip(",").strip()
    if ti != -1:
        # tag value may be quoted
        tag_part = rest[ti:]
        if di != -1 and di > ti:
            tag_str = rest[ti:di].strip().rstrip(",")
        else:
            tag_str = rest[ti:].strip()
        tag = tag_str[len("tag="):].strip().strip('"')
    if di != -1:
        desc = rest[di + len("desc="):].strip().strip('"')
    # parse head: type, then defaults/options
    parts = [p.strip() for p in split_csv(head)]
    typ = parts[0] if parts else "input"
    opts = parts[1:]
    # default
    default = ""
    options = []
    if typ == "switch":
        default = opts[0] if opts else "true"
        options = ["true", "false"]
    elif typ == "select":
        # all quoted strings are options; first is default
        cleaned = [o.strip().strip('"') for o in opts]
        if cleaned:
            default = cleaned[0]
            options = cleaned
    else:  # input
        if opts:
            default = opts[0].strip().strip('"')
        options = None
    return key, typ, default, options, tag, desc

def split_csv(s):
    # split on commas not inside quotes
    res = []
    cur = ""
    inq = False
    for ch in s:
        if ch == '"':
            inq = not inq
            cur += ch
        elif ch == ',' and not inq:
            res.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        res.append(cur)
    return res

def parse_scripts(section_lines):
    scripts = []
    for line in section_lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # format: type pattern key=val,... 
        m = re.match(r"^(http-request|http-response)\s+(.+?)\s+requires-body", line)
        if not m:
            # maybe no requires-body
            m2 = re.match(r"^(http-request|http-response)\s+(.+?)\s+script-path=", line)
            if not m2:
                continue
            typ = m2.group(1)
            pattern = m2.group(2).strip()
            rest = line[len(typ)+len(pattern)+2:].strip()  # rough
        else:
            typ = m.group(1)
            pattern = m.group(2).strip()
            rest = line[len(typ)+len(pattern)+1:].strip()
        # parse kv from rest
        # rest contains requires-body=..., binary-body-mode=..., script-path=..., tag=..., argument=[...]
        kv = {}
        # extract argument=[...] first
        am = re.search(r"argument=\[(.*)\]\s*$", rest)
        argument_str = None
        if am:
            argument_str = am.group(1)
            rest = rest[:am.start()].strip().rstrip(",").strip()
        # now parse comma-separated kv (but values may contain commas in tag? tag has no commas usually; script-path no comma)
        # split rest by comma
        for part in rest.split(","):
            part = part.strip()
            if not part:
                continue
            if "=" in part:
                k, v = part.split("=", 1)
                kv[k.strip()] = v.strip()
        # binary_body
        binary_body = kv.get("binary-body-mode") == "1"
        body_required = kv.get("requires-body") == "1"
        script_path = kv.get("script-path")
        tag = kv.get("tag")
        scripts.append({
            "type": typ,
            "pattern": pattern,
            "body_required": body_required,
            "binary_body": binary_body,
            "script_path": script_path,
            "tag": tag,
            "argument_str": argument_str,
        })
    return scripts

def parse_mitm(section_lines):
    hosts = []
    for line in section_lines:
        line = line.strip()
        if line.startswith("hostname"):
            # hostname = a, b, c
            val = line.split("=", 1)[1].strip()
            for h in val.split(","):
                h = h.strip()
                if h:
                    hosts.append(h)
        # h2 = true ignore
    return hosts

def parse_rewrites(section_lines):
    # returns list of (kind, data)
    rules = []
    for line in section_lines:
        line = line.strip()
        if not line or line.startswith("#"):
            # keep comments? skip
            continue
        rules.append(line)
    return rules

def convert_argument_key(surge_key):
    if surge_key in SHARED:
        return SHARED[surge_key]
    return to_snake(surge_key)

def main():
    # collect args across modules, merged
    # arg info: snake_key -> {type, default, options, tag, desc, surge_key}
    args = {}  # snake -> info
    # track which surge keys map to which snake (for argument json)
    # modules data
    modules = []
    for name, path, base in PLUGINS:
        sections, meta = parse_plugin(path)
        # args
        mod_args = {}  # surge_key -> snake
        arg_lines = sections.get("Argument", [])
        for line in arg_lines:
            info = parse_argument_line(line)
            if not info:
                continue
            key, typ, default, options, tag, desc = info
            snake = convert_argument_key(key)
            mod_args[key] = snake
            if snake not in args:
                args[snake] = {
                    "type": typ,
                    "default": default,
                    "options": options,
                    "tag": tag,
                    "desc": desc,
                    "surge_key": key,
                }
            else:
                # merge defaults? keep first
                pass
        # scripts
        scripts = parse_scripts(sections.get("Script", []))
        # mitm
        mitm = parse_mitm(sections.get("MitM", []))
        # rewrites
        rewrites = parse_rewrites(sections.get("Rewrite", []))
        modules.append({
            "name": name,
            "meta": meta,
            "base": base,
            "args": mod_args,  # surge_key -> snake
            "scripts": scripts,
            "mitm": mitm,
            "rewrites": rewrites,
        })

    # Build yaml
    out = []
    out.append("#=======================================================================================")
    out.append("# BiliBili Biliverse — Enhanced + Global + Redirect + ADBlock (merged) — Egern 模块")
    out.append("#")
    out.append("# 由 Biliverse 的 4 个 Surge 模块合并转换而来：")
    out.append("#   Enhanced (v0.6.2) / Global (v0.9.3) / Redirect (v0.2.25) / ADBlock (v0.7.5)")
    out.append("# 脚本直接引用上游 GitHub Releases 的 bundle.js（绝对 URL），无需本地托管。")
    out.append("#=======================================================================================")
    out.append("")
    out.append('name: "BiliBili Biliverse (Enhanced+Global+Redirect+ADBlock)"')
    out.append('description: "哔哩哔哩：增强 + 全球 + 重定向 + 去广告 合并模块。"')
    out.append('author: "VirgilClyne et al."')
    out.append('homepage: "https://biliverse.github.io/guide/"')
    out.append('icon: "https://github.com/Biliverse/Enhanced/raw/main/src/assets/icon_rounded.png"')
    out.append("")

    # compat_arguments
    out.append("# ---- 参数（snake_case；Surge 原始键名通过 {{{...}}} 注入到 argument JSON）----")
    out.append("compat_arguments:")
    for snake, info in args.items():
        # default value as string
        dv = info["default"]
        if info["type"] == "switch":
            dv = "true" if str(dv).lower() in ("true", "1", "yes") else "false"
        else:
            dv = str(dv)
        out.append(f'  {snake}: "{dv}"')
    out.append("")

    # compat_arguments_schema
    out.append("compat_arguments_schema:")
    for snake, info in args.items():
        out.append(f"  {snake}:")
        out.append(f'    name: "{info["tag"] or snake}"')
        if info["desc"]:
            out.append(f'    description: "{info["desc"]}"')
        if info["type"] == "switch":
            out.append("    options: [\"true\", \"false\"]")
        elif info["options"]:
            opts = ", ".join(f'"{o}"' for o in info["options"])
            out.append(f"    options: [{opts}]")
        else:
            out.append("    options: []")
    out.append("")

    # scriptings
    out.append("scriptings:")
    idx = 0
    for mod in modules:
        for sc in mod["scripts"]:
            idx += 1
            name = f"biliverse.{mod['name'].lower()}.{idx}"
            # build http_request/http_response key
            kind = "http_request" if sc["type"] == "http-request" else "http_response"
            out.append(f"  # {sc['tag']}")
            out.append(f"  - {kind}:")
            out.append(f'      name: "{name}"')
            # match: convert surge regex to yaml string (escape backslashes already in pattern)
            pat = sc["pattern"]
            out.append(f'      match: "{pat.replace(chr(92), chr(92)+chr(92))}"')
            out.append(f'      script_url: "{sc["script_path"]}"')
            if sc["body_required"]:
                out.append("      body_required: true")
            if sc["binary_body"]:
                out.append("      binary_body: true")
            if sc["body_required"]:
                out.append("      max_size: 33554432")
                out.append("      timeout: 60")
            # env argument
            if sc["argument_str"]:
                # argument_str like: {Home.Switch},{Home.Tab},...
                # parse keys
                keys = re.findall(r"\{([^}]+)\}", sc["argument_str"])
                # build json
                json_parts = []
                for sk in keys:
                    snake = mod["args"][sk]
                    info = args[snake]
                    if info["type"] == "switch":
                        json_parts.append('"' + sk + '":{{{' + snake + '}}}')
                    else:
                        json_parts.append('"' + sk + '":"{{{' + snake + '}}}"')
                arg_json = "{" + ",".join(json_parts) + "}"
                out.append("      env:")
                out.append(f"        _compat.$argument: '{arg_json}'")
            out.append("")

    # rewrites
    out.append("# ---- URL Rewrite / body rewrite (best-effort conversion) ----")
    out.append("rewrites:")
    # collect reject rules
    reject_added = False
    for mod in modules:
        for rw in mod["rewrites"]:
            # reject-dict / reject / mock-response-body / response-body-json-jq / response if mock_file
            # handle simple reject lines
            m = re.match(r"^(\^.*?|https?.*?)\s+-\s+reject-dict\s*$", rw)
            if m:
                pat = m.group(1).strip()
                out.append(f"  - match: \"{pat.replace(chr(92), chr(92)+chr(92))}\"")
                out.append("    actions:")
                out.append("      - respond:")
                out.append("          status: 200")
                out.append("          body: \"{}\"")
                reject_added = True
                continue
            m = re.match(r"^(\^.*?|https?.*?)\s+-\s+reject(?:-200|-img|-video)?\s*$", rw)
            if m:
                pat = m.group(1).strip()
                loc = "http://reject/"
                out.append(f"  - match: \"{pat.replace(chr(92), chr(92)+chr(92))}\"")
                out.append("    actions:")
                out.append("      - respond:")
                out.append("          status: 404")
                reject_added = True
                continue
            # jq rewrites are handled in body_rewrites section below
            if "response-body-json-jq" in rw:
                continue
            # mock_file / mock / header.add / response if ... -> skip
            if "mock_file" in rw or "mock(" in rw or "mock-response-body" in rw or "response if" in rw:
                out.append(f"  # skipped (complex rewrite): {rw[:100]}")
                continue
            out.append(f"  # unhandled: {rw[:100]}")
    if not reject_added:
        out.append("  []")
    out.append("")

    # body_rewrites: convert response-body-json-jq lines
    body_rewrites = []
    for mod in modules:
        for rw in mod["rewrites"]:
            m = re.search(r"\^(\S+)\s+response-body-json-jq\s+'(.+)'", rw)
            if m:
                urlpat = "^" + m.group(1)
                filt = m.group(2)
                body_rewrites.append((urlpat, filt))
    if body_rewrites:
        out.append("body_rewrites:")
        for urlpat, filt in body_rewrites:
            out.append(f"  - response_jq:")
            out.append(f'      match: "{urlpat.replace(chr(92), chr(92)+chr(92))}"')
            out.append(f'      filter: \'{filt}\'')
        out.append("")

    # mitm
    all_hosts = []
    for mod in modules:
        for h in mod["mitm"]:
            if h not in all_hosts:
                all_hosts.append(h)
    out.append("mitm:")
    out.append("  hostnames:")
    out.append("    includes:")
    for h in all_hosts:
        out.append(f'      - "{h}"')
    out.append("")

    out_text = "\n".join(out)
    outdir = pathlib.Path("/opt/modules/egern/bilibili")
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "bilibili-enhance.yaml").write_text(out_text, encoding="utf-8")
    print("written", outdir / "bilibili-enhance.yaml")
    print("args:", len(args))
    print("scripts:", idx)

if __name__ == "__main__":
    main()
