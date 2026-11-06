#!/usr/bin/env bash
# Updater for /opt/modules (egern + loon). Pulls latest upstream, regenerates, pushes.
set -u
LOG=/opt/modules/.state/update.log
STATE=/opt/modules/.state/hashes.txt
mkdir -p /opt/modules/.cache/httpdns /opt/modules/.cache/youtube/scripts /opt/modules/.state
exec >>"$LOG" 2>&1
echo "===== $(date -Is) update start ====="

cd /opt/modules || exit 1

# helper: fetch url to file if changed (compare sha256)
fetch() {
  local url="$1" out="$2"
  local tmp="${out}.tmp"
  if ! curl -sL --max-time 120 -A "Loon/3.5.1 (983)" -o "$tmp" "$url"; then
    echo "FETCH FAIL: $url"; rm -f "$tmp"; return 1
  fi
  if [ -f "$out" ] && cmp -s "$out" "$tmp"; then
    rm -f "$tmp"; return 2  # unchanged
  fi
  mv "$tmp" "$out"; return 0  # changed
}

changed=0

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
mkdir -p /opt/modules/.cache/youtube/scripts
yt_changed=0
for f in request.js response.js key.js ump.js; do
  if fetch "https://raw.githubusercontent.com/gholts/surge/main/scripts/youtube/$f" "/opt/modules/.cache/youtube/scripts/$f"; then
    yt_changed=1
  fi
done
if [ "$yt_changed" = "1" ]; then
  # patch for Egern/Loon compat
  if python3 /opt/modules/scripts/patch_youtube.py /opt/modules/.cache/youtube/scripts/*.js; then
    cp /opt/modules/.cache/youtube/scripts/*.js /opt/modules/egern/youtube/js/
    cp /opt/modules/.cache/youtube/scripts/*.js /opt/modules/loon/youtube/js/
    echo "youtube js patched & synced"
    changed=1
  else
    echo "youtube patch FAILED; keeping old js"
  fi
else
  # no upstream change; still sync egern->loon
  cp /opt/modules/egern/youtube/js/*.js /opt/modules/loon/youtube/js/ 2>/dev/null
fi

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
