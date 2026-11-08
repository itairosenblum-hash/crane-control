#!/usr/bin/env python3
"""מעדכן חותמת גרסה (?v=...) בכל הייבואים, כדי שדפדפנים יטענו מיד קוד חדש אחרי עדכון.
הרצה: python3 scripts/bump-version.py   (לפני כל commit שמשנה את האתר)"""
import re, time, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime("%Y%m%d%H%M")
files = [root / "index.html", *sorted((root / "js").glob("*.js"))]
pat = re.compile(r'''((?:from\s+|import\(\s*|src=)["'](?:\./|js/)[\w-]+\.js)(?:\?v=\w+)?(["'])''')
for f in files:
    s = f.read_text(encoding="utf-8")
    n = pat.sub(lambda m: f"{m.group(1)}?v={v}{m.group(2)}", s)
    n = re.sub(r'export const APP_VERSION = "[^"]*";', f'export const APP_VERSION = "{v}";', n)
    if n != s:
        f.write_text(n, encoding="utf-8")
print("version", v)
