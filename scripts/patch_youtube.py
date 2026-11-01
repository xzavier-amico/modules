#!/usr/bin/env python3
"""Patch gholts YouTube scripts for Egern/Loon compat."""
import sys, pathlib, re

def patch(path):
    t = open(path).read()
    orig = t

    # request.js: catch block $done() -> $done({})
    t = t.replace("d?.endsWith(\"/initplayback\")?$done(g()):$done()",
                  "d?.endsWith(\"/initplayback\")?$done(g()):$done({})")

    # response.js: early returns + catch
    t = t.replace("$response.body?.length)return $done();",
                  "$response.body?.length||$response.body.length>5242880)return $done({});")
    t = t.replace('catch(g){console.log("YouTube response: "+g),$done()}',
                  'catch(g){console.log("YouTube response: "+g),$done({})}')
    # void 0 in response done call
    t = t.replace("e(e(n,a)?{body:B.toBinary(n)}:void 0)",
                  "e(e(n,a)?{body:B.toBinary(n)}:{})")

    # ump.js: early returns
    t = t.replace("$response.body?.length)return $done();",
                  "$response.body?.length)return $done({});")
    t = t.replace("$done(c.body===$response.body?void 0:{body:c.body})",
                  "$done(c.body===$response.body?{}:{body:c.body})")
    # ump catch? check if $done() remains
    # key.js: early returns + catch
    t = t.replace("$response.body?.length)return $done();",
                  "$response.body?.length)return $done({});")
    # key.js catch: console.log("YouTube keys: "+e),$done()
    t = t.replace('console.log("YouTube keys: "+e),$done()',
                  'console.log("YouTube keys: "+e),$done({})')
    # also key.js other $done() occurrences (storage write etc.) - replace remaining bare $done()
    t = t.replace("$done()", "$done({})")

    # generic: any remaining bare $done() -> $done({})
    t = t.replace("$done()", "$done({})")

    # verify
    remaining = t.count("$done()")
    assert remaining == 0, f"{path}: {remaining} bare $done() remain"
    # verify void 0 near done gone
    assert "void 0:{body" not in t and "void 0)}" not in t.replace("void 0)}catch", ""), f"{path}: void 0 remains"
    pathlib.Path(path).write_text(t)
    print(f"patched {path}")

if __name__ == "__main__":
    for p in sys.argv[1:]:
        patch(p)
