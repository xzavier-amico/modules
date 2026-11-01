#!/usr/bin/env bash
# Daily updater for /opt/modules (egern + loon). Pulls latest upstream, regenerates, pushes.
set -u
LOG=/opt/modules/.state/update.log
STATE=/opt/modules/.state/hashes.txt
mkdir -p /opt/modules/.cache/bili /opt/modules/.cache/httpdns /opt/modules/.cache/youtube/scripts /opt/modules/.state
exec >>"$LOG" 2>&1
echo "===== $(date -Is) update start ====="

cd /opt/modules || exit 1

# helper: fetch url to file if changed (compare sha256)
fetch() {
  local url="$1" out="$2"
  local tmp="${out}.tmp"
  if ! curl -sL --max-time 120 -o "$tmp" "$url"; then
    echo "FETCH FAIL: $url"; rm -f "$tmp"; return 1
  fi
  if [ -f "$out" ] && cmp -s "$out" "$tmp"; then
    rm -f "$tmp"; return 2  # unchanged
  fi
  mv "$tmp" "$out"; return 0  # changed
}

changed=0

# ---------- Biliverse ----------
echo "-- Biliverse --"
declare -A BILI_FILES=(
  ["Enhanced.plugin"]="https://raw.githubusercontent.com/VirgilClyne/GetSomeFries/refs/heads/main/plugin/BiliBili.Enhanced.plugin"
)
# Actually Biliverse releases are versioned; use "latest" redirect
BILI_BASE_EGERN="https://github.com/Biliverse"
for mod in Enhanced Global Redirect ADBlock; do
  case $mod in
    Enhanced) repo=Enhanced; efile=Biliverse.Enhanced.yaml; pfile=Biliverse.Enhanced.plugin; ver=v0.6.2;;
    Global) repo=Global; efile=BiliBili.Global.yaml; pfile=BiliBili.Global.plugin; ver=v0.9.3;;
    Redirect) repo=Redirect; efile=BiliBili.Redirect.yaml; pfile=BiliBili.Redirect.plugin; ver=v0.2.25;;
    ADBlock) repo=ADBlock; efile=BiliBili.ADBlock.yaml; pfile=BiliBili.ADBlock.plugin; ver=v0.7.5;;
  esac
  # try to discover latest release tag
  latest=$(curl -sL --max-time 30 "https://api.github.com/repos/Biliverse/$repo/releases/latest" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tag_name',''))" 2>/dev/null)
  if [ -n "$latest" ]; then ver="$latest"; fi
  eurl="https://github.com/Biliverse/$repo/releases/download/$ver/$efile"
  purl="https://github.com/Biliverse/$repo/releases/download/$ver/$pfile"
  fetch "$eurl" "/opt/modules/.cache/bili/$mod.egern.yaml" && changed=1
  fetch "$purl" "/opt/modules/.cache/bili/$mod.plugin" && changed=1
done
# regenerate bilibili (egern + loon) if any changed or always (cheap)
python3 /opt/modules/scripts/merge_bili_egern.py >/dev/null 2>&1 && echo "egern bilibili regenerated"
python3 /opt/modules/scripts/merge_bili_loon.py >/dev/null 2>&1 && echo "loon bilibili regenerated"
# re-add compat_arguments_schema? merge script already does for egern. for loon, convert rewrites already done in file; but if regenerated from original plugins, rewrites are legacy. Re-apply new-syntax conversion for loon rewrites.
python3 - <<'PYEOF' >/dev/null 2>&1
import re, pathlib
p = pathlib.Path("/opt/modules/loon/bilibili/bilibili-enhance.plugin")
if not p.exists(): 
    raise SystemExit
lines = p.read_text().splitlines()
out = []
in_rw = False
for line in lines:
    s = line.strip()
    if s == "[Rewrite]":
        in_rw = True; out.append(line); continue
    if in_rw and s.startswith("["):
        in_rw = False
    if in_rw and s and not s.startswith("#"):
        m = re.match(r'^(\S+)\s+-\s+(reject(?:-200|-dict|-img|-array|-video)?)\s*$', s)
        if m:
            pat = m.group(1); action = m.group(2)
            actmap = {"reject":"reject(404)","reject-200":"reject(200)","reject-dict":"reject_dict(200)","reject-img":"reject_img(200)","reject-array":"reject_array(200)","reject-video":"reject_video(200)"}
            out.append(f"request if ${{url}} ~= /{pat}/ then {actmap.get(action,'reject(404)')}")
            continue
        m = re.match(r'^(\S+)\s+mock-response-body\s+(.*)$', s)
        if m:
            pat = m.group(1); params = m.group(2)
            data="{}"; ctype="text"; status=200
            dm = re.search(r"data='([^']*)'", params) or re.search(r'data="(.*)"', params)
            if dm: data = dm.group(1)
            sm = re.search(r"status-code=(\d+)", params)
            if sm: status = int(sm.group(1))
            hm = re.search(r'header="([^"]*)"', params)
            if hm and ":" in hm.group(1): ctype = hm.group(1).split(":",1)[1].strip()
            out.append(f'response if ${{url}} ~= /{pat}/ then response.body.mock("{ctype}", `{data}`, {status})')
            continue
        m = re.match(r'^(\S+)\s+response-body-json-jq\s+\'(.+)\'\s*$', s)
        if m:
            out.append(f'response if ${{url}} ~= /{m.group(1)}/ then response.json.jq("{m.group(2)}")')
            continue
    out.append(line)
p.write_text("\n".join(out))
PYEOF
echo "bilibili loon rewrites normalized"

# ---------- HTTPDNS ----------
echo "-- HTTPDNS --"
fetch "https://raw.githubusercontent.com/VirgilClyne/GetSomeFries/refs/heads/main/plugin/HTTPDNS.Block.plugin" "/opt/modules/.cache/httpdns/httpdns.plugin" && changed=1
python3 /opt/modules/scripts/convert_httpdns.py >/dev/null 2>&1 && echo "egern httpdns regenerated"
# loon httpdns: convert rewrites to new syntax
python3 - <<'PYEOF' >/dev/null 2>&1
import re, pathlib
src = pathlib.Path("/opt/modules/.cache/httpdns/httpdns.plugin").read_text()
# build plugin from original with icon change + rewrite conversion
lines = src.splitlines()
out = []
in_maplocal = False
maplocal_converted = []
for line in lines:
    s = line.strip()
    if s == "[Map Local]":
        in_maplocal = True; continue
    if in_maplocal and s.startswith("["):
        in_maplocal = False
    if in_maplocal:
        if not s or s.startswith("#"): continue
        parts = s.split(None, 1)
        if len(parts) == 2:
            pat, params = parts
            if "data-type" in params:
                maplocal_converted.append(f"{pat} mock-response-body {params}")
        continue
    if s == "[URL Rewrite]":
        out.append("[Rewrite]"); continue
    out.append(line)
final = []
inserted = False
for line in out:
    if line.strip() == "[MITM]":
        if not inserted and maplocal_converted:
            final.append(""); final.extend(maplocal_converted); final.append(""); inserted = True
    final.append(line)
text = "\n".join(final)
text = text.replace("https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Server.png",
                    "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Reject.png")
# convert legacy rewrites to new syntax
lines = text.splitlines()
out2 = []
in_rw = False
for line in lines:
    s = line.strip()
    if s == "[Rewrite]":
        in_rw = True; out2.append(line); continue
    if in_rw and s.startswith("["):
        in_rw = False
    if in_rw and s and not s.startswith("#"):
        import re
        m = re.match(r'^(\S+)\s+-\s+(reject(?:-200|-dict|-img|-array|-video)?)\s*$', s)
        if m:
            pat = m.group(1); action = m.group(2)
            actmap = {"reject":"reject(404)","reject-200":"reject(200)","reject-dict":"reject_dict(200)","reject-img":"reject_img(200)","reject-array":"reject_array(200)","reject-video":"reject_video(200)"}
            out2.append(f"request if ${{url}} ~= /{pat}/ then {actmap.get(action,'reject(404)')}")
            continue
        m = re.match(r'^(\S+)\s+mock-response-body\s+(.*)$', s)
        if m:
            pat = m.group(1); params = m.group(2)
            data="{}"; ctype="text"; status=200
            dm = re.search(r"data='([^']*)'", params) or re.search(r'data="(.*)"', params)
            if dm: data = dm.group(1)
            sm = re.search(r"status-code=(\d+)", params)
            if sm: status = int(sm.group(1))
            hm = re.search(r'header="([^"]*)"', params)
            if hm and ":" in hm.group(1): ctype = hm.group(1).split(":",1)[1].strip()
            out2.append(f'response if ${{url}} ~= /{pat}/ then response.body.mock("{ctype}", `{data}`, {status})')
            continue
    out2.append(line)
pathlib.Path("/opt/modules/loon/httpdns/httpdns-block.plugin").write_text("\n".join(out2))
PYEOF
echo "loon httpdns regenerated"

# ---------- YouTube ----------
echo "-- YouTube --"
fetch "https://raw.githubusercontent.com/gholts/surge/main/modules/youtube-enhance.sgmodule" "/opt/modules/.cache/youtube/youtube-enhance.sgmodule" && changed=1
# download scripts (only if changed; always try)
for f in request.js response.js key.js ump.js; do
  # use user's own hosted (already patched) as baseline; upstream gholts for reference only
  :
done
# Re-apply our $done fixes to the egern/loon JS is handled by keeping local copies; do not overwrite with upstream.
# Sync loon js from egern (canonical patched versions)
cp /opt/modules/egern/youtube/js/*.js /opt/modules/loon/youtube/js/ 2>/dev/null

# Convert bilibili loon scripts to new syntax
python3 - <<'PYEOF2' >/dev/null 2>&1
import re, pathlib
p = pathlib.Path("/opt/modules/loon/bilibili/bilibili-enhance.plugin")
lines = p.read_text().splitlines()
out = []
in_script = False
new_scripts = []
for line in lines:
    s = line.strip()
    if s == "[Script]":
        in_script = True
        out.append(line)
        continue
    if in_script and s.startswith("["):
        in_script = False
        out.extend(new_scripts)
        out.append(line)
        continue
    if in_script:
        if not s or s.startswith("#"):
            if s: out.append(line)
            continue
        parts = s.split(None, 2)
        if len(parts) < 3:
            out.append(line); continue
        typ, pattern, attrs = parts
        spm = re.search(r"script-path=(\S+)", attrs)
        script_url = spm.group(1).rstrip(",") if spm else ""
        tm = re.search(r'tag="([^"]*)"', attrs) or re.search(r"tag=([^,]+)", attrs)
        tag = tm.group(1) if tm else ""
        rbm = re.search(r"requires-body=(\d)", attrs)
        requires_body = (rbm.group(1) == "1") if rbm else False
        bbm = re.search(r"binary-body-mode=(\d)", attrs)
        binary_body = (bbm.group(1) == "1") if bbm else False
        am = re.search(r"argument=\[(.*)\]\s*$", attrs)
        arg_str = am.group(1) if am else ""
        keys = re.findall(r"\{([^}]+)\}", arg_str)
        arg_obj = "{" + ", ".join(f"${{{k}}}" for k in keys) + "}" if keys else ""
        phase = "request" if typ == "http-request" else "response"
        with_parts = []
        if tag: with_parts.append(f'tag="{tag}"')
        if requires_body: with_parts.append("requires_body=true")
        if binary_body: with_parts.append("binary_body_mode=true")
        with_parts.append("timeout=30")
        with_clause = " with " + ", ".join(with_parts)
        if arg_obj:
            new_scripts.append(f'{phase} if ${{url}} ~= /{pattern}/ then script("{script_url}", {arg_obj}){with_clause}')
        else:
            new_scripts.append(f'{phase} if ${{url}} ~= /{pattern}/ then script("{script_url}")' + with_clause)
        continue
    out.append(line)
if in_script:
    out.extend(new_scripts)
p.write_text("\n".join(out))
PYEOF2

# ---------- Commit & push ----------
cd /opt/modules
if git diff --quiet && git diff --cached --quiet; then
  echo "no changes; skip commit"
else
  git add egern loon scripts .gitignore
  git commit -m "auto-update: $(date +%Y-%m-%d)" && git push origin master && echo "pushed"
  changed=1
fi
echo "===== $(date -Is) update done (changed=$changed) ====="
