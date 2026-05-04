# -*- coding: utf-8 -*-
"""Replace user_message_for_llm by line range (494-531)."""

path = r"E:\Phase 1_ Quantum Foundation Project Setup Instructions\backend\app\api\v1\endpoints\tutor.py"

with open(path, encoding="utf-8") as f:
    lines = f.readlines()

# Verify we're targeting the right block
assert "def user_message_for_llm" in lines[493], f"Wrong line 494: {lines[493]}"
assert 'return raw or' in lines[530], f"Wrong line 531: {lines[530]}"

NEW_FUNC = '''\
def user_message_for_llm(raw_message: str, context: dict) -> str:
    """
    آخر دور user للنموذج: لا يُمرَّر نص [SYSTEM_EVENT:…] خام أبداً.
    يُستبدل بتوجيه عربي داخلي نظيف قبل أن يصل إلى النموذج اللغوي.
    الترتيب: فحص SYSTEM_EVENT أولاً (قبل أي return آخر) لضمان صفر تسريب.
    """
    raw = (raw_message or "").strip()

    # ── PHASE 1: Intercept ALL [SYSTEM_EVENT:…] variants FIRST ───────────────
    # Runs BEFORE `if stripped:` so even mixed messages (partial tag + other text)
    # are caught and converted to a clean Arabic instruction.
    if "[SYSTEM_EVENT:" in raw.upper():
        _ru = raw.upper()
        # Grade / assessment nudge
        if any(k in _ru for k in ("التقييم", "GRADE", "درجت", "ASSESSMENT", "درجة".upper())):
            return (
                "الطالب أنهى للتو مسار تقييم. علّق بلطف باللهجة الأردنية على النتيجة "
                "إن وُجدت في السياق، ثم اسأله عن نقطة يريد تحسينها."
            )
        # Silence / proactive ice-breaker
        if any(k in _ru for k in ("صمت", "صامت", "SILENT", "SILENCE", "IDLE", "QUIET", "NUDGE")):
            return (
                "مبادرة بعد صمت: اطرح سؤالاً تفاعلياً واحداً قصيراً بالأردنية الدافئة "
                "يرتبط بالدرس. لا تذكر الصمت أو أي وسم نظام."
            )
        # Welcome / greeting
        if any(k in _ru for k in ("GREETING", "WELCOME", "قدّم".upper(), "ترحيب".upper(), "سلام".upper())):
            return (
                "ترحيب دافئ بالأردنية: قدّم نفسك كمعلّم رقمي كوجني وابدأ محادثة طبيعية."
            )
        # Internal thought / thinker proactive
        if any(k in _ru for k in ("THOUGHT", "فكرة".upper(), "INTERNAL", "PROACTIVE")):
            return (
                "مبادرة لطيفة: ردّ بجملة واحدة قصيرة بالأردنية تُظهر الاهتمام "
                "وادخل في موضوع الدرس مباشرة."
            )
        # BTEC / training mode
        if any(k in _ru for k in ("BTEC", "تدريب".upper(), "TRAINING")):
            return (
                "الطالب في وضع التدريب. ابدأ بسؤال BTEC مناسب بالأردنية "
                "دون ذكر اسم الوضع أو أي وسم نظام."
            )
        # Subject / focus selection
        if any(k in _ru for k in ("SUBJECT", "مادة".upper(), "موضوع".upper(), "FOCUS")):
            return (
                "الطالب اختار مادة للتركيز. انتقل بلطف إلى سؤال أو تحدٍّ يتناسب "
                "مع المادة والمستوى المستهدف."
            )
        # Deep-link trigger
        if "DEEP_LINK" in _ru:
            return (
                "الطالب دخل من رابط يحدد وحدة وهدف مستوى. افتح بلهجة أردنية طبيعية "
                "وانتقل إلى سؤال يتناسب مع الهدف."
            )
        # Catch-all for any unrecognised SYSTEM_EVENT variant
        return (
            "توجيه داخلي: نفّذ المطلوب بجملة أو جملتين بالأردنية؛ "
            "لا تنسخ أي وسم داخلي ولا تذكر [SYSTEM_EVENT]."
        )

    # ── No SYSTEM_EVENT: normal user message path ─────────────────────────────
    stripped = strip_internal_llm_markers(raw).strip()
    if stripped:
        return stripped
    if context.get("proactive_engagement"):
        return (
            "مبادرة بعد صمت: الطالب لم يرسل رسالة منذ فترة. "
            "ردّ بجملة قصيرة دافئة باللهجة الأردنية مع سؤال تفاعلي يرتبط بالدرس."
        )
    if context.get("thinker_proactive_speech"):
        return (
            "مبادرة لطيفة: ردّ بجملة واحدة قصيرة بالأردنية تُظهر الاهتمام؛ "
            "لا تذكر النظام أو الوسوم."
        )
    if context.get("deep_link_trigger_event"):
        return (
            "رابط معلّم: الطالب دخل من رابط يحدد وحدة وهدف مستوى. "
            "افتح بلهجة أردنية طبيعية وانتقل إلى سؤال مناسب."
        )
    if context.get("cogni_welcome_turn"):
        return "ترحيب افتتاحي قصير باللهجة الأردنية؛ قدّم نفسك كمعلّم رقمي كوجني."
    return raw or "…"

'''

# Lines are 0-indexed; func is lines[493:531] (494–531 inclusive)
lines[493:531] = [NEW_FUNC]

with open(path, encoding="utf-8", mode="w") as f:
    f.writelines(lines)

print("SUCCESS: user_message_for_llm replaced at lines 494-531")
# Verify
with open(path, encoding="utf-8") as f:
    verify = f.read()
assert "PHASE 1: Intercept ALL [SYSTEM_EVENT" in verify, "Verify failed!"
print("VERIFY: new function present in file")
