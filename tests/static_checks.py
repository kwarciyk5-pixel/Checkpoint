"""Static checks: node --check on the inline script and sw.js, smart-quote scan.
Run: python3 tests/static_checks.py"""
import os, re, subprocess, sys, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
assert len(scripts) == 1, "expected one inline <script>"
ok = True

with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
    f.write(scripts[0])
    tmp = f.name
for label, target in (("inline script", tmp), ("sw.js", os.path.join(ROOT, "sw.js"))):
    r = subprocess.run(["node", "--check", target], capture_output=True, text=True)
    print(("PASS" if r.returncode == 0 else "FAIL") + "  node --check " + label)
    if r.returncode:
        print(r.stderr)
        ok = False
os.unlink(tmp)

SMART = "‘’“”"
sources = {"<script> in index.html": scripts[0], "sw.js": open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read()}
hits = 0
for name, src in sources.items():
    for n, line in enumerate(src.splitlines(), 1):
        for ch in SMART:
            if ch in line:
                hits += 1
                print("smart quote %r in %s line %d: %s" % (ch, name, n, line.strip()[:80]))
print(("PASS" if hits == 0 else "FAIL") + "  smart quotes: %d hits" % hits)
ok = ok and hits == 0
sys.exit(0 if ok else 1)
