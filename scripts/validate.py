#!/usr/bin/env python3
"""Validate Egern / Loon module wiring.

Checks, for every module in this repository:

- Egern YAML parses; compat_arguments, compat_arguments_schema,
  compat_arguments_desc and {{{placeholders}}} agree.
- Egern env argument templates are valid JSON and contain no duplicate keys.
- Loon [Argument] names match the ${placeholders} passed to script(...).
- Egern and Loon variants of the same module expose the same argument names.
- Local raw URLs (script_url / icon) point at files that exist in this repo.
- Every JavaScript file passes `node --check`.

Usage:
    python3 scripts/validate.py [--root PATH]

Exit code is 0 when everything passes, 1 otherwise.
"""
import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

RAW_PREFIX = "https://raw.githubusercontent.com/xzavier-amico/modules/master/"
PLACEHOLDER_RE = re.compile(r"\{\{\{([A-Za-z0-9_.-]+)\}\}\}")
LOON_PLACEHOLDER_RE = re.compile(r"\$\{([A-Za-z0-9_.-]+)\}")
LOON_SECTION_RE = re.compile(r"^\[([^\]]+)\]$")
LOON_ARG_RE = re.compile(r"^([A-Za-z0-9_.-]+)\s*=")
LOON_SCRIPT_RE = re.compile(
    r'script\(\s*"([^"]+)"\s*(?:,\s*(\{(?:\$\{[^}]+\}|[^{}])*\}))?\s*\)'
)
LOON_BUILTINS = {
    "url", "urlMatch", "request", "response", "done", "argument",
    "persistentStore", "notification", "script", "httpClient", "environment",
}


class Checker:
    def __init__(self, root):
        self.root = root
        self.errors = []

    def error(self, path, message):
        try:
            rel = path.relative_to(self.root)
        except ValueError:
            rel = path
        self.errors.append(f"{rel}: {message}")

    def ok(self, path, condition, message):
        if not condition:
            self.error(path, message)
        return condition


def walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk_strings(item)


def parse_loon(path):
    """Return ({section: [lines]}, full_text)."""
    text = path.read_text(encoding="utf-8", errors="replace")
    sections = {}
    current = None
    for line in text.splitlines():
        stripped = line.strip()
        match = LOON_SECTION_RE.match(stripped)
        if match:
            current = match.group(1)
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)
    return sections, text


def loon_arguments(sections):
    args = []
    for line in sections.get("Argument", []):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = LOON_ARG_RE.match(stripped)
        if match:
            args.append(match.group(1))
    return args


def check_local_url(checker, path, url):
    if not isinstance(url, str) or not url.startswith(RAW_PREFIX):
        return
    relative = url[len(RAW_PREFIX):].split("?", 1)[0]
    if not (checker.root / relative).is_file():
        checker.error(path, f"local URL points at a missing file: {relative}")


def check_egern(checker, path):
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        checker.error(path, f"YAML parse failed: {exc}")
        return
    if not isinstance(data, dict):
        checker.error(path, "top-level YAML value is not a mapping")
        return

    checker.ok(path, bool(data.get("name")), "missing name")

    args = data.get("compat_arguments") or {}
    schema = data.get("compat_arguments_schema") or {}
    desc = data.get("compat_arguments_desc") or ""
    if not isinstance(args, dict) or not isinstance(schema, dict):
        checker.error(path, "compat_arguments / compat_arguments_schema must be mappings")
        return

    if args:
        missing = sorted(set(args) - set(schema))
        extra = sorted(set(schema) - set(args))
        checker.ok(path, not missing, f"arguments without schema entry: {missing}")
        checker.ok(path, not extra, f"schema entries without argument: {extra}")

        for name, default in args.items():
            checker.ok(path, name in desc, f"argument {name} missing from compat_arguments_desc")
            options = (schema.get(name) or {}).get("options") or []
            if options:
                normalized = [str(item) for item in options]
                checker.ok(
                    path,
                    str(default) in normalized,
                    f"default {default!r} for {name} not in options {normalized}",
                )

        used = set()
        for text in walk_strings(data):
            for name in PLACEHOLDER_RE.findall(text):
                used.add(name)
                checker.ok(path, name in args, f"unknown placeholder {{{{{name}}}}}")

        unused = sorted(set(args) - used)
        checker.ok(path, not unused, f"arguments never used by the module: {unused}")
    else:
        for text in walk_strings(data):
            checker.ok(path, not PLACEHOLDER_RE.search(text), "placeholder used without compat_arguments")

    for text in walk_strings(data):
        check_local_url(checker, path, text)

    scriptings = data.get("scriptings") or []
    checker.ok(path, isinstance(scriptings, list), "scriptings must be a list")
    if not isinstance(scriptings, list):
        return
    for index, item in enumerate(scriptings):
        if not isinstance(item, dict) or len(item) != 1:
            checker.error(path, f"scriptings[{index}] must contain exactly one phase")
            continue
        phase, spec = next(iter(item.items()))
        if phase not in ("http_request", "http_response"):
            checker.error(path, f"scriptings[{index}] has unknown phase {phase!r}")
            continue
        if not isinstance(spec, dict):
            checker.error(path, f"scriptings[{index}].{phase} must be a mapping")
            continue
        for key in ("name", "match", "script_url"):
            checker.ok(path, bool(spec.get(key)), f"scriptings[{index}].{phase} missing {key}")
        check_local_url(checker, path, spec.get("script_url"))
        env = spec.get("env") or {}
        if isinstance(env, dict):
            for key, value in env.items():
                if key.endswith("$argument") and isinstance(value, str):
                    if PLACEHOLDER_RE.sub("null", value).lstrip().startswith(("{", "[")):
                        check_json_template(checker, path, value)


def check_json_template(checker, path, template):
    def no_duplicates(pairs):
        seen = set()
        for key, value in pairs:
            if key in seen:
                raise ValueError(f"duplicate key {key!r}")
            seen.add(key)
        return dict(pairs)

    filled = PLACEHOLDER_RE.sub("null", template)
    try:
        json.loads(filled, object_pairs_hook=no_duplicates)
    except (json.JSONDecodeError, ValueError) as exc:
        checker.error(path, f"invalid JSON argument template: {exc}")


def check_loon(checker, path):
    sections, text = parse_loon(path)
    args = loon_arguments(sections)
    arg_set = set(args)
    checker.ok(path, len(args) == len(arg_set), f"duplicate [Argument] names: {sorted(args)}")

    for name in args:
        used = re.search(r"\$\{" + re.escape(name) + r"\}", text)
        checker.ok(path, bool(used), f"[Argument] {name} is never used")

    calls = []
    for url, obj in LOON_SCRIPT_RE.findall(text):
        names = LOON_PLACEHOLDER_RE.findall(obj or "")
        calls.append((url, names))
        if not obj:
            continue
        checker.ok(path, len(names) == len(set(names)), f"duplicate placeholders in script argument object: {names}")
        for name in names:
            if name in LOON_BUILTINS:
                continue
            checker.ok(path, name in arg_set, f"script argument ${{{name}}} is not declared in [Argument]")

    by_url = {}
    for url, names in calls:
        by_url.setdefault(url.split("?", 1)[0], set()).add(tuple(sorted(names)))
    for url, variants in by_url.items():
        if len(variants) > 1:
            checker.error(path, f"script {url} is called with different argument sets: {sorted(variants)}")

    non_empty = [set(names) for _, names in calls if names]
    if args and non_empty and max(len(names) for names in non_empty) == len(arg_set):
        for names in non_empty:
            missing = sorted(arg_set - names)
            checker.ok(path, not missing, f"script call omits declared arguments: {missing}")

    for url in re.findall(r'"(https://[^"]+)"', text):
        check_local_url(checker, path, url)


def check_pair(checker, egern_path, loon_path):
    try:
        egern_data = yaml.safe_load(egern_path.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        return
    egern_args = set((egern_data or {}).get("compat_arguments") or {})
    sections, _ = parse_loon(loon_path)
    loon_args = set(loon_arguments(sections))
    if egern_args != loon_args:
        only_egern = sorted(egern_args - loon_args)
        only_loon = sorted(loon_args - egern_args)
        checker.error(
            egern_path,
            f"argument sets differ from {loon_path.relative_to(checker.root)}: "
            f"only Egern={only_egern}, only Loon={only_loon}",
        )


def check_js(checker):
    node = shutil.which("node")
    if not node:
        checker.error(checker.root, "node not found; cannot run JavaScript syntax checks")
        return 0
    count = 0
    for path in sorted(checker.root.glob("egern/**/*.js")) + sorted(checker.root.glob("loon/**/*.js")):
        count += 1
        result = subprocess.run(
            [node, "--check", str(path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip().splitlines()
            checker.error(path, "node --check failed: " + (detail[0] if detail else "unknown error"))
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parent.parent,
        help="repository root (default: parent of scripts/)",
    )
    options = parser.parse_args()
    root = options.root.resolve()
    checker = Checker(root)

    egern_paths = sorted(root.glob("egern/*/*.yaml"))
    loon_paths = sorted(root.glob("loon/*/*.plugin"))
    for path in egern_paths:
        check_egern(checker, path)
    for path in loon_paths:
        check_loon(checker, path)

    loon_by_key = {(path.parent.name, path.stem): path for path in loon_paths}
    for egern_path in egern_paths:
        loon_path = loon_by_key.get((egern_path.parent.name, egern_path.stem))
        if loon_path:
            check_pair(checker, egern_path, loon_path)

    js_count = check_js(checker)

    print(f"checked {len(egern_paths)} Egern modules, {len(loon_paths)} Loon plugins, {js_count} JS files")
    if checker.errors:
        for message in checker.errors:
            print(f"ERROR {message}")
        print(f"FAILED ({len(checker.errors)} errors)")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
