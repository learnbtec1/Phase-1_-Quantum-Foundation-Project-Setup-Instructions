# -*- coding: utf-8 -*-
"""
Phase 2: Add backend SYSTEM_EVENT_LEAK guard after the primary strip call (line 1436),
and harden the system prompt non-leakage rule (Phase 3).
"""
path = r"E:\Phase 1_ Quantum Foundation Project Setup Instructions\backend\app\api\v1\endpoints\tutor.py"

with open(path, encoding="utf-8") as f:
    content = f.read()

# ── PHASE 2: Leak guard after primary strip (line ~1436 original, now shifted) ─
# Find the primary strip call context
OLD_STRIP = '        raw_reply = strip_internal_llm_markers(raw_reply)\n        raw_reply = _maybe_jordanize_cogni_raw(raw_reply)\n\n        try:\n            from app.services.ethical_filter import apply_ethical_filter'

NEW_STRIP = '        raw_reply = strip_internal_llm_markers(raw_reply)\n        raw_reply = _maybe_jordanize_cogni_raw(raw_reply)\n        # ── PHASE 2: Runtime leak guard ─────────────────────────────────────────\n        if "[SYSTEM_EVENT:" in (raw_reply or "").upper():\n            import logging as _lg\n            _lg.getLogger("cogni.tutor").warning(\n                "[SYSTEM_EVENT_LEAK] Tag survived strip — forcing second pass. session=%s",\n                context.get("session_id", "?"),\n            )\n            raw_reply = strip_internal_llm_markers(raw_reply)\n\n        try:\n            from app.services.ethical_filter import apply_ethical_filter'

if OLD_STRIP in content:
    content = content.replace(OLD_STRIP, NEW_STRIP, 1)
    print("PHASE 2 leak guard: injected")
else:
    print("PHASE 2 leak guard: target not found")

# ── PHASE 3: Tighten non-leakage rule in system prompt ──────────────────────
OLD_RULE = '        "\\u0625\\u0646 \\u0648\\u064f\\u062c\\u062f [SYSTEM_EVENT: ...] \\u0641\\u0644\\u0627 \\u062a\\u0646\\u0633\\u062e\\u0647 \\u0648\\u0644\\u0627 \\u062a\\u0639\\u0650\\u062f\\u0647 \\u0641\\u064a \\u0631\\u062f\\u0643.\\n"'
# Use the actual Arabic text to match
OLD_RULE_AR = '            "إن وُجد [SYSTEM_EVENT: ...] فلا تنسخه ولا تعِده في ردك.\\n"'
NEW_RULE_AR = (
    '            "قاعدة مطلقة: لا تنسخ أبداً أي وسم نظام مثل [SYSTEM_EVENT:...] أو [EMOTION:...] '
    'أو [ACTION:...] في نصّ ردّك للطالب.\\n"'
    '\n            "إذا وجدت مثل هذه الوسوم في السياق، تجاهلها تماماً وردّ بالمحتوى التعليمي فقط.\\n"'
)

if OLD_RULE_AR in content:
    content = content.replace(OLD_RULE_AR, NEW_RULE_AR, 1)
    print("PHASE 3 system prompt rule: tightened")
else:
    # Search for it differently
    import re
    pattern = r'\"إن وُجد \[SYSTEM_EVENT'
    match = re.search(pattern, content)
    if match:
        print(f"PHASE 3: Found at position {match.start()} — context:")
        print(repr(content[match.start()-5:match.start()+120]))
    else:
        print("PHASE 3: system prompt target not found, searching nearby text...")
        idx = content.find("لا تنسخه ولا تعِده في ردك")
        if idx >= 0:
            print("Found partial match at:", idx)
            print(repr(content[idx-30:idx+80]))

with open(path, encoding="utf-8", mode="w") as f:
    f.write(content)

print("\nDONE")
