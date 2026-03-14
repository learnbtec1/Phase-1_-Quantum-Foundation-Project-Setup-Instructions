# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

from app.services.conversation_store import ConversationStore

# Test 1: mojibake
moji = "\u00d9\u2026\u00d8\u00b1\u00d8\u00ad\u00d8\u00a8\u00d8\u00a7\u00d9\u2039"
fixed = ConversationStore._fix_mojibake(moji)
print("Test 1 mojibake:", repr(moji[:8]), "->", repr(fixed))
assert "\u0645\u0631\u062d\u0628" in fixed, f"FAIL: got {repr(fixed)}"
print("  PASS")

# Test 2: clean Arabic unchanged
clean = "\u0645\u0631\u062d\u0628\u0627\u064b"
result = ConversationStore._fix_mojibake(clean)
assert result == clean, f"FAIL: was modified to {repr(result)}"
print("Test 2 clean Arabic: PASS")

# Test 3: Latin unchanged
lat = "Hello world 123"
assert ConversationStore._fix_mojibake(lat) == lat
print("Test 3 Latin: PASS")

print("\nAll tests PASS")
