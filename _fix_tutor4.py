# -*- coding: utf-8 -*-
"""Phase 3: Tighten the non-leakage system prompt rule."""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

path = r"E:\Phase 1_ Quantum Foundation Project Setup Instructions\backend\app\api\v1\endpoints\tutor.py"

with open(path, encoding="utf-8") as f:
    content = f.read()

# Find and print context around the target
idx = content.find("\u0644\u0627 \u062a\u0646\u0633\u062e\u0647 \u0648\u0644\u0627 \u062a\u0639\u0650\u062f\u0647 \u0641\u064a \u0631\u062f\u0643")
if idx >= 0:
    snippet = content[idx-80:idx+120]
    print("FOUND context snippet length:", len(snippet))
    # Do the replacement using the exact unicode
    old_rule = (
        '\u0625\u0646 \u0648\u064f\u062c\u062f [SYSTEM_EVENT: ...] '
        '\u0641\u0644\u0627 \u062a\u0646\u0633\u062e\u0647 '
        '\u0648\u0644\u0627 \u062a\u0639\u0650\u062f\u0647 \u0641\u064a \u0631\u062f\u0643.\n'
    )
    new_rule = (
        '\u0642\u0627\u0639\u062f\u0629 \u0645\u0637\u0644\u0642\u0629: '
        '\u0644\u0627 \u062a\u0646\u0633\u062e \u0623\u0628\u062f\u0627\u064b '
        '\u0623\u064a \u0648\u0633\u0645 \u0646\u0638\u0627\u0645 '
        '\u0645\u062b\u0644 [SYSTEM_EVENT:...] \u0623\u0648 [EMOTION:...] '
        '\u0641\u064a \u0646\u0635\u0651 \u0631\u062f\u0651\u0643 '
        '\u0644\u0644\u0637\u0627\u0644\u0628. '
        '\u0625\u0630\u0627 \u0648\u062c\u062f\u062a \u0645\u062b\u0644 '
        '\u0647\u0630\u0647 \u0627\u0644\u0648\u0633\u0648\u0645 \u0641\u064a '
        '\u0627\u0644\u0633\u064a\u0627\u0642\u060c \u062a\u062c\u0627\u0647\u0644\u0647\u0627 '
        '\u062a\u0645\u0627\u0645\u0627\u064b \u0648\u0631\u062f\u0651 '
        '\u0628\u0627\u0644\u0645\u062d\u062a\u0648\u0649 '
        '\u0627\u0644\u062a\u0639\u0644\u064a\u0645\u064a \u0641\u0642\u0637.\n'
    )
    if old_rule in content:
        content = content.replace(old_rule, new_rule, 1)
        print("PHASE 3: system prompt rule replaced")
    else:
        # try without the trailing whitespace variations
        print("Exact match failed — trying looser search")
        m = re.search(r'\u0625\u0646 \u0648\u064f\u062c\u062f \[SYSTEM_EVENT[^\n]+\n', content)
        if m:
            content = content[:m.start()] + new_rule + content[m.end():]
            print("PHASE 3: replaced via regex")
        else:
            print("PHASE 3: FAILED to find target")
else:
    print("PHASE 3: base search string not found at all")

with open(path, encoding="utf-8", mode="w") as f:
    f.write(content)

print("DONE")
