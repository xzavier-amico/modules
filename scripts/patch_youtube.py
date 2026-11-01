#!/usr/bin/env python3
"""Patch gholts YouTube scripts for Egern/Loon compat (regex-based, robust)."""
import sys, pathlib, re

def fix_done_arg(arg):
    """Fix a $done(...) argument string."""
    arg = arg.strip()
    if arg == "" or arg == "void 0" or arg == "undefined":
        return "{}"
    # ternary: X ? void 0 : Y  ->  X ? {} : Y
    arg = re.sub(r'\?\s*void\s*0\s*:', '?{}:', arg)
    # ternary: X ? Y : void 0  ->  X ? Y : {}
    arg = re.sub(r':\s*void\s*0\s*$', ':{}', arg)
    # trailing :void 0 before closing paren (handled by $ above mostly)
    arg = re.sub(r':\s*void\s*0(\s*\))', r':{}\1', arg)
    return arg

def patch(path):
    t = open(path).read()
    # Replace $done(...) calls: match one level of nested parens
    def repl(m):
        inner = m.group(1)
        new_inner = fix_done_arg(inner)
        return "$done(" + new_inner + ")"
    t = re.sub(r'\$done\(([^()]*(?:\([^()]*\)[^()]*)*)\)', repl, t)

    # large-body guard in response.js (only where $response exists)
    t = re.sub(r'!\$response\.body\?\.length\)\s*return\s*\$done\(\{\}\)',
               '!$response.body?.length||$response.body.length>5242880)return $done({})', t)

    # verify no bare $done() remain
    assert not re.search(r'\$done\(\s*\)', t), f"{path}: bare $done() remains"
    pathlib.Path(path).write_text(t)
    print(f"patched {path}")

if __name__ == "__main__":
    for p in sys.argv[1:]:
        patch(p)
