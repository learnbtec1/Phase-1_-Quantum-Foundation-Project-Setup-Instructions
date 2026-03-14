# -*- coding: utf-8 -*-
"""
mojibake_fix.py — One-shot repair of Arabic mojibake in today's JSONL.

Reads YYYY-MM-DD.jsonl, tries latin-1 → utf-8 decode on any "legacy" record
whose text field contains Mojibake patterns (Ø / Ù). Creates a .bak backup
first. Idempotent: safe to run multiple times.
"""
import json, os, shutil, datetime, io, sys, re

ROOT  = r"E:\Phase 1_ Quantum Foundation Project Setup Instructions\backend"
TODAY = datetime.date.today().strftime("%Y-%m-%d")
path  = os.path.join(ROOT, "data", "store", f"{TODAY}.jsonl")
bak   = path + ".bak"

if not os.path.isfile(path):
    print(f"[SKIP] {path} not found")
    sys.exit(0)

# Backup
shutil.copy2(path, bak)
print(f"[BACKUP] {bak}")

MOJI_PAT = re.compile(r"[\xc3-\xd5][\x80-\xbf]|Ø|Ù|Ã")

def maybe_fix_mojibake(s: str) -> str:
    """latin-1 bytes re-decoded as utf-8 — fixes the classic CP1252/windows-1256 mojibake."""
    try:
        bs = s.encode("latin-1", errors="strict")
        return bs.decode("utf-8")
    except Exception:
        return s

fixed_lines = 0
total_lines = 0

with io.open(path + ".tmp", "w", encoding="utf-8", newline="\n") as out, \
     io.open(path, "r", encoding="utf-8", errors="replace") as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line.strip():
            out.write("\n")
            continue
        total_lines += 1
        try:
            obj = json.loads(line)
        except Exception:
            out.write(line + "\n")
            continue

        text = obj.get("text", "")
        if isinstance(text, str) and MOJI_PAT.search(text):
            new_text = maybe_fix_mojibake(text)
            if new_text != text:
                obj["text"] = new_text
                fixed_lines += 1

        out.write(json.dumps(obj, ensure_ascii=False) + "\n")

os.replace(path + ".tmp", path)
print(f"[DONE] Scanned {total_lines} lines. Fixed {fixed_lines} mojibake records.")
print(f"[FILE] {path}")
print(f"[BAK]  {bak}")
