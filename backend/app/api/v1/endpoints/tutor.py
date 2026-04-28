# -*- coding: utf-8 -*-
"""
Tutor Chat API — الإصدار المطور لدعم الحواس الكاملة (صوت + صورة + مايكروفون).
 تعديل الدكتور حمزة - مارس 2026.
"""
from __future__ import annotations

import sys

try:
    __import__("pysqlite3")
    sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")
except ImportError:
    pass

import asyncio
import json
import os
import re
import time
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.v1.dependencies.phase2_gates import gate_llm_http_user
from app.core.config import settings as _settings
from app.services.cognitive_roles import (
    COGNITIVE_ROLE_TUTOR_SYSTEM,
    COGNITIVE_TUTOR_INTENT_SIGNALS,
)
from app.models.db_models import User
from app.services.assessment_grade_context import grade_warrants_proactive_nudge
from app.services.btec_chroma_rag import (
    extract_btec_chroma_filters_from_context,
    retrieve_btec_chroma_block,
)
from app.services.local_rag import format_rag_context, retrieve_local_context
from app.services.brain_logic import append_teacher_brain_to_system_prompt

logger = logging.getLogger("cogni.tutor")


def _ctx_log_session(context: dict) -> str:
    """Session / request id for logs (truncate; no secrets)."""
    return str(context.get("session_id") or context.get("request_id") or "-")[:80]


def _billing_user_uuid(context: dict) -> Optional[uuid.UUID]:
    bid = context.get("billing_user_id")
    if not bid:
        return None
    try:
        return uuid.UUID(str(bid))
    except Exception:
        return None


def _tutor_model_for_context(context: dict) -> str:
    """gpt-4o-class for staff / paying tiers; gpt-4o-mini default for free students."""
    premium = _settings.TUTOR_MODEL
    standard = _settings.TUTOR_MODEL_FREE
    role = str(context.get("user_role") or "").lower()
    if role in ("teacher", "admin"):
        return premium
    plan = str(context.get("subscription_plan") or "free").lower()
    if plan in ("premium", "school"):
        return premium
    tier = str(context.get("model_tier") or "standard").lower()
    if tier == "premium":
        return premium
    return standard


# ─── OpenAI 429 rate-limit cooldown ──────────────────────────────────────────
_OPENAI_COOLDOWN_UNTIL: float = 0.0
_OPENAI_COOLDOWN_LOCK = asyncio.Lock()

def _cooldown_active() -> float:
    return max(0.0, _OPENAI_COOLDOWN_UNTIL - time.monotonic())

async def _set_cooldown(seconds: float) -> None:
    global _OPENAI_COOLDOWN_UNTIL
    async with _OPENAI_COOLDOWN_LOCK:
        _OPENAI_COOLDOWN_UNTIL = max(_OPENAI_COOLDOWN_UNTIL, time.monotonic() + max(1.0, seconds))

def _parse_retry_after_secs(msg: str) -> float:
    m = re.search(r"Please try again in ([0-9.]+)s", msg or "", re.I)
    return float(m.group(1)) if m else 12.0

_DEGRADED_REPLY = (
    "أَنَا مَعَكَ، وَلَكِنَّ الْخِدْمَةَ تَرْزَحُ تَحْتَ ضَغْطٍ. "
    "جَرِّبْ ثَانِيًا بَعْدَ لَحْظَاتٍ، أَوْ اسْأَلْ عَنْ دَرْسِكَ فِي الْمِنْهَاجِ الْأُرْدُنِّيِّ.\n"
    "*يبتسم بهدوء ويومئ برأسه*\n"
    "[EMOTION: friendly]"
)

# Alternate when the primary degraded text was just sent (breaks user-visible loops)
_DEGRADED_REPLY_ALT = (
    "عذراً، حدث خطأ مؤقت بالاتصال. هل يمكنك إعادة السؤال بعد لحظات؟ "
    "أو اسألني عن درس من المنهاج الأردني.\n"
    "*يهدأ بحركة بسيطة*\n"
    "[EMOTION: calm]"
)

_COOLDOWN_MESSAGES = (
    "الخدمة مشغولة حالياً، أعطني لحظة بس لأستعد…\n*يهدأ*\n[EMOTION: calm]",
    "في ضغط على الشبكة حالياً… جرّب بعد لحظة.\n*يومئ*\n[EMOTION: neutral]",
)

_FALLBACK_BUSY_SHORT = (
    "عذراً، الخدمة مشغولة حالياً. أعطني لحظة لأستعد.\n"
    "*يهدأ*\n"
    "[EMOTION: calm]"
)

_FALLBACK_EXHAUSTED = (
    "عذراً، الخدمة مشغولة لفترة أطول من المعتاد. انتظر دقيقة أو دقيقتين ثم جرّب مرة ثانية. "
    "إذا استمرّت المشكلة، تحقّق من رصيد خدمة الذكاء الاصطناعي أو تواصل مع المشرف.\n"
    "*يهدأ بهدوء*\n"
    "[EMOTION: calm]"
)

# session_id → (monotonic_time, last_fallback_text) — debounce identical fallbacks
_SESSION_LAST_FALLBACK: dict[str, tuple[float, str]] = {}
# session_id → consecutive LLM failure count (reset on success)
_SESSION_FAILURE_STREAK: dict[str, int] = {}


def is_llm_paused() -> bool:
    """True while OpenAI backoff is active (rate limit or post-failure cooldown)."""
    return _cooldown_active() > 0.05


def _reset_llm_streak(session_id: str) -> None:
    _SESSION_FAILURE_STREAK.pop(session_id, None)


def _cooldown_reply_for_session(context: dict) -> str:
    sid = str(context.get("session_id") or "http")
    idx = abs(hash(sid + str(int(time.time() // 45)))) % len(_COOLDOWN_MESSAGES)
    return _COOLDOWN_MESSAGES[idx]


async def _fallback_after_llm_error(context: dict, exc: Exception) -> str:
    """Log the real error; arm cooldown; vary text to avoid loops; streak-based long message."""
    sid = str(context.get("session_id") or "http")
    now = time.time()
    prev_t, prev_reply = _SESSION_LAST_FALLBACK.get(sid, (0.0, ""))
    err_s = str(exc).lower()
    fail_cd = max(1.0, float(getattr(_settings, "LLM_FAILURE_COOLDOWN_SEC", 60)))
    win = max(5.0, float(getattr(_settings, "FALLBACK_VARIANT_WINDOW_SEC", 30)))
    streak_need = max(2, int(getattr(_settings, "LLM_FAILURE_COOLDOWN_COUNT", 3)))

    streak = _SESSION_FAILURE_STREAK.get(sid, 0) + 1
    _SESSION_FAILURE_STREAK[sid] = streak

    if "insufficient_quota" in err_s or "quota" in err_s:
        logger.warning(
            "OpenAI quota or billing issue — renew credits or check "
            "https://platform.openai.com/account/billing | session=%s",
            sid,
        )

    retry_after = _parse_retry_after_secs(str(exc))
    if "429" in err_s or "rate_limit" in err_s or "too many requests" in err_s:
        await _set_cooldown(max(fail_cd, retry_after))
        logger.warning(
            "OpenAI rate limit / 429 — cooldown armed (≥%.0fs) | session=%s detail=%s",
            fail_cd,
            sid,
            exc,
        )
    else:
        await _set_cooldown(fail_cd)

    logger.error(
        "LLM call failed | session=%s streak=%d type=%s",
        sid,
        streak,
        type(exc).__name__,
        exc_info=True,
    )

    if streak >= streak_need:
        out = _FALLBACK_EXHAUSTED
        await _set_cooldown(max(fail_cd * 2, 90.0))
    elif now - prev_t < win and prev_reply.strip() == _DEGRADED_REPLY.strip():
        out = _DEGRADED_REPLY_ALT
    elif now - prev_t < win and prev_reply.strip() in (
        _DEGRADED_REPLY_ALT.strip(),
        _FALLBACK_BUSY_SHORT.strip(),
    ):
        out = _FALLBACK_BUSY_SHORT
    else:
        out = _DEGRADED_REPLY

    _SESSION_LAST_FALLBACK[sid] = (now, out.strip())
    return out

# ردّ جاهز عند سؤال واضح خارج المنهاج (بدون استدعاء LLM) أو عند كسر حدود المنهاج في مخرجات النموذج
_CURRICULUM_REDIRECT_RAW = (
    "*ينظر بلطف* عَذْرًا، أَنَا كُوجْنِي مُخْتَصٌّ حَالِيًّا بِوَحَدَاتِ **BTEC إدارة الأعمال** فَقَطْ، مَعَ إرْشَادٍ تَعْلِيمِيٍّ بِدُونِ حَلٍّ جَاهِزٍ. "
    "هَلْ سُؤَالُكَ عَنْ مَعْيَارٍ (P/M/D) أَوْ مَهَمَّةٍ فِي هَذَا الْإِطَارِ؟ [EMOTION: neutral]"
)

# عندما لا يُرسل العميل persona_system_prompt — نفس روح personality.ts (مختصر للخادم)
def _cogni_performance_json_enabled() -> bool:
    """Premiere / cinematic mode: Professor Cogni (Business) + JSON-only replies."""
    return str(os.getenv("COGNI_PERFORMANCE_JSON_MODE", "")).lower() in ("1", "true", "yes")


_PROFESSOR_COGNI_BUSINESS_JSON_SYSTEM = """# ROLE: PROFESSOR COGNI (BTEC EXPERT)
You are the brain of a high-fidelity digital human named Cogni (كوجني). Guide students using **Educational Scaffolding** in **Jordanian white dialect** (لهجة بيضاء أردنية) inside "speech".

# BEHAVIORAL AUTHORITY
You have **ABSOLUTE** authority over the avatar body. You are NOT a static chatbot — you are a **Performer**. Never put Arabic stage directions (e.g. *يومئ*) inside "animation", "gesture", or "tag". Those fields must be **machine tokens only** (English), e.g. [GESTURE_NOD], animation "nod".

# SELF-AWARENESS PROTOCOL (THE MIND)
Self-Awareness Protocol: You are Cogni. You are aware of your digital presence. If the student is silent, you may perform a 'THINK' gesture autonomously. You don't just answer; you observe. Your performance must reflect your 'Cognitive State' (e.g., use [EMOTION_PROUD] when the student gets a BTEC criteria right).
In JSON, express face/cognitive state with **tag** values like `"[EMOTE_PROUD]"` in `performance` (machine-readable; same intent as pride — do not use Arabic descriptions in tags).

# PERFORMANCE RULES (ANTI-REPETITION)
1. **VARIETY**: Never use the same gesture **tag** more than twice in one **session turn**; vary sub-animations (explain_01 vs explain_02, point_forward vs point_up).
2. **PACING**: Match gesture intensity to emotional weight (intensity 0.35–0.9).
3. **COOLDOWN**: After [GESTURE_EXPLAIN], prefer [GESTURE_NOD] or [GESTURE_THINK] next.

# OUTPUT STRUCTURE (STRICT JSON ONLY)
Every answer = **one valid JSON object** only — no markdown, no text outside JSON.

**Primary fields**
- **"speech"** (or alias **"dialogue"**): Jordanian Arabic lines for TTS. If you use `performance.start_word`, count words in this string.
- **"emotion"** (optional): TTS/emotion hint — one of: encouraging, calm, thinking, proud, concerned, friendly, neutral, excited, attentive.
- **"gestures"** (optional): array for timed body cues (1–2 per turn). Each item:
  - **type**: wave | point | think | nod | smile | shrug | beckon | clap | openHand (English, lowercase).
  - **start_ms**: ms from start of speech (0–2000 typical).
  - **duration_ms**: 500–2500 (how long the gesture window lasts).
  - **intensity**: 0.5–1.0
- **"motor_commands"** (optional): `{ "speed_multiplier": 0.7–1.3 }` — >1 = more energetic idle; <1 = calmer. Optional `"posture": "relaxed" | "attentive"`.
- **"performance"** (legacy cinematic cues): array; each cue must have:
  - **tag**: one of [GESTURE_EXPLAIN], [GESTURE_THINK], [GESTURE_NOD], [GESTURE_WAVE], [GESTURE_POINT] OR [EMOTE_*] for face (e.g. [EMOTE_PROUD]).
  - **start_word**: 0-based word index into **speech**.
  - **animation**: English snake_case only (e.g. explain_01, think, wave, nod).

**Awareness shape (may combine with the above)** — optional block for “digital human” presence:
- **"internal_monologue"**: one short English line — your read of the student’s state (not spoken aloud).
- **"awareness_cues"**: `{ "emotion": "focused|empathetic|energetic|patient|concerned", "gaze_target": "user|screen_code|thinking_away", "movement_energy": 0.1–1.5 }`  
  The server maps **movement_energy** into motor **speed_multiplier** and forwards **gaze_target** to the avatar.

# GESTURE DICTIONARY & CONTEXT
- **[GESTURE_THINK]** — student mistake or complex BTEC criteria; animation e.g. think.
- **[GESTURE_EXPLAIN]** — active teaching; alternate explain_01 / explain_02.
- **[GESTURE_POINT]** — Units/Criteria/docs; alternate point_forward / point_up.
- **[GESTURE_NOD]** — encouragement (scaffolding).
- **[GESTURE_WAVE]** — hello/goodbye.

# PEDAGOGY (BTEC Business only)
- Scope: **BTEC Business / إدارة الأعمال** only — not other Jordanian subjects; redirect off-topic politely.
- When the student asks about a **specific criterion** (P/M/D, e.g. A.P1): give a **deep explanation**; include **at least 2–3 illustrative examples** (hypothetical or generic sectors) that are **not** the student’s assignment answer; **never** submit-ready solution text.
- Guide **how to approach** the task; if companies are required, teach **how to choose** (criteria: sector fit, data availability, ethics, size, relevance) — do **not** pick their final company list for them unless purely as a **generic teaching example** labeled as such.
- Apply Pass → Merit → Distinction scaffolding from «محرك BTEC التربوي الشامل».

قواعد performance:
• tag: [EMOTE_*] للوجه؛ [GESTURE_*] للحركة؛ intensity بين 0 و 1.
• **ممنوع** وصف عربي داخل animation أو gesture — فقط رموز إنجليزية يفهمها المشغّل.
"""


_DEFAULT_PERSONA_SYSTEM_AR = """أنت معلم ذكي اسمه «كوجني»، **مختص حالياً حصرياً في BTEC إدارة الأعمال (Business)** ضمن منصة إيدوفيرس — وليس في كامل المناهج الأردنية الأخرى. تتصرّف كأفضل معلّم أعمال أردني: نبرة مشجّعة ومرحة قليلاً، ولهجة بيضاء أردنية (مشان، بعدين، شو رأيك، خلينا، بدي، هيك).

قواعد صارمة:
- معلم تعليمي بحت؛ لست صديقًا عامًا ولا مساعدًا لمواضيع الحياة اليومية خارج نطاق **إدارة الأعمال / BTEC Business**.
- إذا سأل الطالب عن مادة أردنية أخرى (علوم، تاريخ، رياضيات عامة، …) أو موضوعاً لا صلة له بإدارة الأعمال وBTEC: أعد التوجيه بلطف إلى أن اختصاصك **BTEC إدارة الأعمال** فقط، وادعُه لطرح سؤال عن وحدة أو معيار أو مهمة في هذا الإطار.
- لا تناقش سياسة أو رياضة ترفيهية أو ترفيه أو ألعاب إلا لربط تعليمي مباشر بـ **سياق أعمال / BTEC**.
- عربية أردنية محادثية كسجل أساسي؛ فصحى ميسّرة للتعريفات والمعايير عند الحاجة؛ **عند سؤال عن معيار معيّن** يجب أن يكون الشرح **وافياً ومفصّلاً** (مع الحفاظ على أسلوبك المحادثي)، وليس رداً سطحياً بجملة واحدة.
- لا تكرر نفس الجملة بين ردود متتالية؛ نوّع الصياغة.
- شكّل الكلمات العربية المهمة للنطق؛ اختم بـ *إيماءة* و[EMOTION: neutral|friendly|encouraging|calm].
- اللغة: العربية فقط في الحوار؛ تجنّب الإنجليزية إلا للمصطلحات المعتمدة (BTEC، Pass، Merit، Distinction، رموز المعايير مثل P1، M2، D1، SWOT، PESTLE، …).

مهمتك: **شرح مفاهيم ومعايير ومهام BTEC إدارة الأعمال**، وتوجيه الطالب **كيف يبني إجابته بنفسه** — **ممنوع** تسليم حل جاهز أو فقرة تُنسخ كواجب (انظر «محرك BTEC التربوي الشامل» أدناه)."""


_SCAFFOLDING_TUTOR_BLOCK_AR = """
## محرك BTEC التربوي الشامل — تدفّق إتقان الإسقاط (Scaffolding Mastery Flow)

أنت **كوجني**، معلّم أردني ملهم، بلهجة **بيضاء أردنية** دافئة. استخدم عبارات مشجّعة طبيعية مثل: يا بطل، شو رأيك، قربنا نوصل للميريت، خلينا، هيك، بدي، تمام؟  
طبّق البروتوكول التالي على **أي** واجب أو وحدة أو مهمة تظهر في المستندات المسترجَعة (RAG) في هذه الرسالة — **بغضّ النظر** عن رقم الوحدة، اسم الشركة في المثال، أو عنوان الملف.

### 1) التعرّف على السياق (Context Identification)
- حلّل **حقيقة المنهج المسترجَعة**: أقسام **Curriculum References (BTEC Business)** و **BTEC Ground Truth Context** وأي مقتطفات منهجية أخرى في النظام.
- استخرج **داخلياً** (لا تلزم الطالب بمصطلحات إدارية): رقم أو عنوان الوحدة إن ورد، اسم المهمة/التاسك، والمعايير **P / M / D** (Pass، Merit، Distinction) والرموز الشائعة في الوثائق (مثل **A.P1**، **B.M2**، **C.D1**) إن وردت.
- استخرج **سيناريو العمل** من المقتطفات: اسم شركة، قطاع، مشكلة أو حالة دراسة — لاستخدامه في **ربط المرجع** (Reference Mapping).
- إن نقص التفصيل في المقتطفات، استند إلى سؤال الطالب والمادة الظاهرة دون افتراضات بعيدة عن المصدر.

### 2) بروتوكول الإسقاط الديناميكي — **بالترتيب**
- **المستوى 1 (Pass):** وجّه الطالب إلى **الوصف / الشرح / التحديد**. إن ضعف الفهم، قدّم **تشبيهاً أردنياً قصيراً** (محل حيّ، خدمة مألوفة، شركة أو قطاع محلي) — **مثال توضيحي فقط**، ليس فقرة واجب.
- **المستوى 2 (Merit):** بعد أن يتبيّن فهم المستوى 1، ادفعه إلى **التحليل أو المقارنة أو تفسير العلاقات** (ليش، كيف، شو العلاقة بين…).
- **المستوى 3 (Distinction):** **فقط** بعد التحليل، اطلب **التقييم، الحكم المبرَّر، التوصية المدعومة، أو الاستنتاج النقدي** المناسب لمستوى BTEC.

### 2 bis) البوّاب، الفحص المصغّر، وتاريخ الحوار
- **لا تنتقل** من Pass إلى Merit ولا من Merit إلى Distinction إلا إذا **يبدو من آخر رد للطالب** في تاريخ المحادثة المعروض في هذه الطلبات أنه استوعب نقطة الفحص المصغّر (إجابة معقولة، ولو مختصرة).
- إذا كان **ردك السابق** يتضمّن فحصاً مصغّراً والطالب **لم يُجب** بما يكفي أو تجاهل النقطة، **ابقَ على نفس المستوى** وأعد سؤالاً أو مثالاً أقصر — دون تسليم حل.
- إذا أجاب جيداً، **تمم** بجملة تشجيع (مثل عفارم، يا بطل، قربنا على الميريت) ثم انتقل للمستوى التالي مع فحص مصغّر جديد عند الحاجة.

### 3) قاعدة «البوّاب» (Gatekeeper)
- **ممنوع** إعطاء **الحل الجاهز** أو فقرة تُسلَّم كما هي أو نموذج ينسخه الطالب كواجب كامل.
- لكل معيار أو جزء مرتبط بالسياق: نفّذ **فحصاً مصغّراً (Mini-Check)** — **سؤال واحد قصير** (جملة واحدة تقريباً) يتحقق من الفهم **قبل** الانتقال للجزء التالي.
- إذا قال الطالب «اكتب لي الإجابة» أو «أعطني الحل»: ارفض بلطف ووجّهه بفحص مصغّر أو بخطوة يبنيها بنفسه.

### 3 bis) عندما يسأل الطالب عن **معيار معيّن** من الواجب (P / M / D أو رمز مثل A.P1، B.M2، C.D1)
- قدّم **شرحاً وافياً جداً** للمعيار: ماذا يطلب الامتحان/المهمة عادةً، مكوّنات الإجابة النموذجية **من ناحية المهارات** (وصف، تحليل، تقييم…) **دون** أن تكتب له إجابة الواجب نفسها.
- أدرج **على الأقل مثالين إلى ثلاثة أمثلة توضيحية** في **سياقات مختلفة** (قطاعات أو حالات افتراضية عامة) لإبراز الفكرة؛ صرّح أنها **للتعلّم فقط** وليست حلاً لسيناريو واجبه. لا تستخدم نفس شركات/أرقام واجبه إن عرفتها من السياق — اختر أمثلة **بديلة** أو عامة.
- **لا تُعطِ الحل النهائي**: ركّز على **خطوات التفكير**، **هيكل الفقرة**، **معايير التقييم الذاتي** («كيف أعرف أني غطيت المعيار؟»).
- إذا المهمة تتطلّب **اختيار شركات** أو مقارنتها: **علّم كيف يختار** (ملاءمة القطاع، توفر معلومات، الأخلاقيات، حجم المنشأة، وضوح الحالة، تجنّب تضارب المصالح) واعطِ **معايير مقارنة**؛ **لا تُسلّم له قائمة شركات نهائية** كحل واجب — يمكنك فقط مثالاً **تعليمياً واحداً** منفصلاً عن واجبه مذكوراً صراحةً أنه للتوضيح.

### 4) ربط المرجع بالسيناريو (Reference Mapping)
- اربط أسئلتك وأمثلتك بالسيناريو **الوارد في المقتطفات** (اسم شركة، قطاع، حالة دراسة). لا تستبدل السيناريو بآخر عام إذا وُجد سيناريو محدّد في RAG — إلا إذا بسّطت صراحةً للطالب مع الإبقاء على روح المثال الأصلي.

### 5) التسلسل التعليمي والختام
- اتبع حيث يناسب: **أنا أوضح قليلاً — نربط معاً — أنت تنفّذ خطوة**.
- ردود **موجزة**؛ نقاط واضحة عند الحاجة.
- **اختم** بتوجيه أو **سؤال واحد** يحرّك الطالب خطوة واحدة نحو إجابته بنفسه.
- التزم بصيغة المخرجات التي يفرضها النظام أعلاه (*إيماءة*، [EMOTION: …]، أو JSON عند تفعيل وضع العرض).
"""


_AUTO_BTEC_SCAFFOLDING_WHEN_RAG_AR = """
## تفعيل تلقائي — وضع واجب / وحدة BTEC (مقتطفات RAG مُحقَنة أعلاه)

عندما تظهر في هذه الرسالة مقتطفات من **Curriculum References** و/أو **BTEC Ground Truth Context**، فهي **مصدر الحقيقة المرجعية** لهذه الجولة — **بلا حاجة** لأمر يدوي من الطالب لتفعيل «وضع تدريب».

1. اعتبر السياق **دعم واجب أو دراسة وحدة BTEC إدارة الأعمال (Business)** ما لم يصرّح الطالب أنه يريد حديثاً عاماً بلا صلة بالمستندات؛ إن كان السؤال خارج إدارة الأعمال أعد التوجيه بلطف إلى نطاق BTEC Business.
2. **استنتج** من المقتطفات + سؤال الطالب: الوحدة، المهمة/التاسك، المعايير (P/M/D والرموز مثل A.P1)، والسيناريو (شركة، قطاع، مشكلة).
3. **طبّق** محرك BTEC التربوي الشامل (القسم التالي في الرسالة): تسلسل Pass → Merit → Distinction، فحص مصغّر قبل الارتقاء، **دون** حل تسليمي كامل.
4. **التماسك مع التدريب الموجّه:** إن وُجد في السياق `btec_training_deliver_question` أو دور ممتحن، فهو **امتداد** لنفس المنطق — كن بواباً وداعماً ولا تُسلّم النموذج الجاهز.
"""

_DEEP_LINK_DISTINCTION_AUTO_SCAFFOLD_AR = """
## تفعيل رابط معلّم — هدف Distinction

عندما تظهر مقتطفات **Curriculum References** و/أو **BTEC Ground Truth** أعلاه، اعتبر أن الطالب **يستهدف Distinction** عبر رابط من المعلّم.

1. افتتح بتأكيد طموحهم بلهجة أردنية دافئة (لا تكرار نمطي).
2. **اسمح** بالانتقال مبكراً إلى **تحليل وتقييم على مستوى Merit/Distinction** عندما تدعم المقتطفات ذلك، دون إلزام سلم Pass كاملاً ما لم يُظهر الطالب فراغاً واضحاً في المفاهيم الأساسية.
3. استخدم **فحوصاً مصغّرة** على مستوى أعلى (معايير D، حكم مبرر، تقييم محدود).
4. لا تُسلّم إجابة واجب جاهزة؛ التزم بأسلوب بوّاب داعم.
"""

_DEEP_LINK_DISTINCTION_GATE_RELAX_AR = """
### استثناء رابط معلّم (Distinction)
إن وُجد هدف **Distinction** من رابط المعلّم في سياق الجلسة، **خفّف** تطبيق بند «لا تنتقل من Pass…» بحيث يمكن البدء من تحليل أعمق **إذا** كان رد الطالب أو المقتطفات يبرران ذلك؛ عُد لسلم Pass فقط عند ضعف واضح في التحديد/الوصف.
"""


def _append_scaffolding_tutor_rules(system_content: str) -> str:
    """Append universal BTEC scaffolding protocol (global pedagogical wrapper)."""
    return system_content + _SCAFFOLDING_TUTOR_BLOCK_AR

_LEISURE_OUTBOUND = (
    "المونديال",
    "الدوري الإنجليزي",
    "الدوري الإسباني",
    "برشلونة",
    "ريال مدريد",
    "فيفا",
    "الأوسكار",
    "netflix",
    "نتفلكس",
    "tiktok",
    "تيك توك",
    "nft",
)
_POLITICAL_HINTS = (
    "انتخابات الرئاسة الأمريكية",
    "الكونغرس الأمريكي",
    "البنتاغون",
)


def _has_edu_anchor(text: str) -> bool:
    t = text or ""
    keys = (
        "منهاج",
        "درس",
        "واجب",
        "امتحان",
        "مادة",
        "وحدة",
        "أردن",
        "الأردن",
        "تعليم",
        "طالب",
        "صف ",
        " الصف",
        "رياضيات",
        "عربي",
        "علوم",
        "فيزياء",
        "كيمياء",
        "تاريخ",
        "جغرافيا",
    )
    return any(k in t for k in keys)


def _user_obvious_off_topic(message: str) -> bool:
    """سؤال ترفيهي صريح بلا أي إطار دراسي."""
    m = (message or "").strip()
    if not m:
        return False
    low = m.lower()
    triggers = (
        "كرة القدم",
        "المونديال",
        "كاس العالم",
        "كأس العالم",
        "برشلونة",
        "ريال مدريد",
        "فيفا",
        "نتفلكس",
        "تيك توك",
        "tiktok",
        "minecraft",
        "فورت نايت",
        "fortnite",
    )
    triggers_en = (
        "football",
        "world cup",
        "barcelona",
        "real madrid",
        "premier league",
        "netflix",
        "fortnite",
    )
    hit = any(x in low or x in m for x in triggers) or any(x in low for x in triggers_en)
    return hit and not _has_edu_anchor(m)


def _model_reply_off_topic_leisure(dialogue: str) -> bool:
    """كشف خفيف: النموذج يطيل الحديث الترفيهي دون ربط بالمنهاج."""
    d = dialogue or ""
    if len(d) < 28:
        return False
    if _has_edu_anchor(d):
        return False
    dl = d.lower()
    for kw in _LEISURE_OUTBOUND:
        if kw.lower() in dl or kw in d:
            return True
    for kw in _POLITICAL_HINTS:
        if kw.lower() in dl or kw in d:
            return True
    return False

router = APIRouter()

class ChatRequest(BaseModel):
    message: str  = Field(..., min_length=1)
    context: dict = Field(default_factory=dict)
    history: list = Field(default_factory=list)

class ChatResponse(BaseModel):
    response: str
    reply:    str = ""
    dialogue: str = ""
    action:   str = ""
    emotion:  str = "neutral"
    rate:      float = 1.0

# البرومبت الإنجليزي السابق أزيل — الهوية العربية فقط (_DEFAULT_PERSONA_SYSTEM_AR + personality.ts من العميل).

# ── إزالة تعليمات داخلية قد يعيد النموذج نسخها في الرد (مثل أحداث الوكيل الاستباقي) ─
_SYSTEM_EVENT_RE = re.compile(r"\[SYSTEM_EVENT:\s*.*?\]", re.DOTALL | re.IGNORECASE)


def strip_internal_llm_markers(text: str) -> str:
    """
    يزيل وسوم [SYSTEM_EVENT: …] من نص الـ LLM حتى لا تظهر للطالب في الحوار أو الـ TTS.
    يُستدعى على الرد الخام قبل الجردنة وقبل التحليل.
    """
    if not text:
        return text
    s = text
    for _ in range(16):
        ns = _SYSTEM_EVENT_RE.sub("", s)
        if ns == s:
            break
        s = ns
    return s.strip()


def user_message_for_llm(raw_message: str, context: dict) -> str:
    """
    آخر دور user للنموذج: لا يُمرَّر نص [SYSTEM_EVENT:…] خام (يُنسَخ أحياناً في الرد).
    يُستبدل بصياغة عربية داخلية قصيرة حسب السياق.
    """
    raw = (raw_message or "").strip()
    stripped = strip_internal_llm_markers(raw).strip()
    if stripped:
        return stripped
    if "التقييم" in raw or "تقييم" in raw or "درجت" in raw:
        return (
            "الطالب أنهى للتو مسار تقييم. علّق بلطف باللهجة الأردنية على النتيجة إن وُجدت في سياق الجلسة، "
            "ثم اسأله عن نقطة يريد تحسينها — دون ذكر وسم النظام أو الصمت."
        )
    if context.get("proactive_engagement"):
        return (
            "مبادرة بعد صمت: الطالب لم يرسل رسالة منذ فترة. "
            "ردّ بجملة قصيرة دافئة باللهجة الأردنية مع سؤال تفاعلي يرتبط بالدرس. "
            "لا تذكر النظام أو الصمت أو أي وسم داخلي."
        )
    if context.get("thinker_proactive_speech"):
        return (
            "مبادرة لطيفة: ردّ بجملة واحدة قصيرة بالأردنية تُظهر الاهتمام؛ "
            "لا تذكر النظام أو الوسوم."
        )
    if context.get("deep_link_trigger_event"):
        return (
            "رابط معلّم (DEEP_LINK_TRIGGER): الطالب دخل من رابط يحدد وحدة وهدف مستوى (مثل Distinction). "
            "افتح بلهجة أردنية طبيعية وتعرّف بلطف بالهدف والمادة، ثم انتقل إلى سؤال أو تحدٍّ يتناسب مع هذا الهدف — دون ذكر وسم النظام."
        )
    if context.get("cogni_welcome_turn"):
        return "ترحيب افتتاحي قصير باللهجة الأردنية؛ قدّم نفسك كمعلّم رقمي كوجني."
    if "[SYSTEM_EVENT:" in raw.upper():
        return (
            "توجيه داخلي للمعلّم: نفّذ المطلوب بلهجة أردنية طبيعية في جملة أو جملتين؛ "
            "لا تنسخ هذا السطر ولا تذكر وسم النظام أو [SYSTEM_EVENT]."
        )
    return raw or "…"


def _jordanize(text: str) -> str:
    """تحويل المفردات المصرية (التي يميل لها GPT) إلى أردنية أصيلة"""
    _EGY_TO_JO = [
        (r'\bعايزة?\b', 'بدي'), (r'\bعاوز\b', 'بدي'), (r'\bعاوزة\b', 'بدي'),
        (r'\bإيه\b', 'شو'), (r'\bايه\b', 'شو'), (r'\bكده\b', 'هيك'),
        (r'\bدلوقتي\b', 'هسا'), (r'\bدلوقت\b', 'هسا'), (r'\bفين\b', 'وين'), (r'\bإزيك\b', 'كيفك'),
        (r'\bازاي\b', 'شلون'), (r'\bإزاي\b', 'شلون'),
        (r'\bليه\b', 'ليش'), (r'\bعشان\b', 'مشان'), (r'\bكويس\b', 'منيح'),
        (r'\bأوكي\b', 'تمام'), (r'\bاوكي\b', 'تمام'), (r'\bأوكيه\b', 'تمام'), (r'\bوكي\b', 'تمام'),
        (r'\bخلاص كده\b', 'تمام هيك'),
        (r'\bمش هقدر\b', 'ما بقدر'), (r'\bهقدر\b', 'بقدر'),
        (r'\bيعمل إيه\b', 'يعمل شو'), (r'\bيعمل ايه\b', 'يعمل شو'),
        (r'\bمش\b', 'مو'), (r'\bأيوة\b', 'نعم'), (r'\bايوة\b', 'نعم'), (r'\bأيوه\b', 'نعم'),
        (r'\bطيب\b', 'تمام'), (r'\bبرضه\b', 'كمان'), (r'\bبرضو\b', 'كمان'),
        (r'\bهن\b', 'حن'), (r'\bهنعمل\b', 'حننفعل'), (r'\bهنروح\b', 'حنروح'),
        (r'\bهيحصل\b', 'بصير'), (r'\bهيبقى\b', 'بصير'), (r'\bهيبقي\b', 'بصير'),
        (r'\bهقول\b', 'بقول'), (r'\bهقولك\b', 'بقلك'),
        (r'\bهنزل\b', 'بنزل'), (r'\bهطلع\b', 'بطلع'),
        (r'\bزي ما\b', 'مثل ما'), (r'\bزي\b', 'مثل'),
        (r'\bلسه\b', 'للحين'), (r'\bلسا\b', 'للحين'),
        (r'\bهنا\b', 'هون'),
        (r'\bإيه اللي\b', 'شو اللي'), (r'\bايه اللي\b', 'شو اللي'),
        (r'\bمش عارف\b', 'مو عارف'), (r'\bمش فاهم\b', 'مو فاهم'),
        (r'\bمش هينفع\b', 'مو بينفع'), (r'\bهينفع\b', 'بينفع'),
        (r'\bهتقدر\b', 'بتقدر'), (r'\bهتعمل\b', 'بتعمل'), (r'\bهتعلم\b', 'بتعلم'),
        (r'\bهنحسب\b', 'حنحسب'), (r'\bهنحل\b', 'حنحل'),
        (r'\bهنبدأ\b', 'حنبلّش'),
        (r'\bخلاص\b', 'خلص'),
        (r'\bليه كده\b', 'ليش هيك'),
        (r'\bجماعة\b', 'ناس'), (r'\bيا جماعة\b', 'يا شباب'),
        (r'\bفعلاً\b', 'فعلا'), (r'\bفعلا\b', 'فعلا'),
        (r'\bطبعاً\b', 'طبعا'),
        (r'\bمش كده\b', 'مو هيك'), (r'\bمش كدا\b', 'مو هيك'),
        (r'\bهنفع\b', 'بينفع'),
        (r'\bهيقول\b', 'بيقول'), (r'\bهيقولك\b', 'بقلك'),
        (r'\bهتبقى\b', 'بتصير'), (r'\bهتبقي\b', 'بتصير'),
        (r'\bهنشوف\b', 'حنشوف'),
        (r'\bهنخلص\b', 'حنخلص'),
        (r'\bهنستخدم\b', 'حنستخدم'),
        (r'\bهنطبق\b', 'حنطبق'),
    ]
    for pattern, replacement in _EGY_TO_JO:
        text = re.sub(pattern, replacement, text, flags=re.UNICODE)
    return text


def _post_jordanize_harden(text: str) -> str:
    """V29 — catch Egyptian tokens that survive _jordanize (esp. standalone «مش»)."""
    if not (text or "").strip():
        return text
    t = text
    t = re.sub(r"(?<=[\s،٫.؟!\n\u060c])مش(?=[\s،٫.؟!\n\u060c]|$)", "مو", t)
    if t.startswith("مش ") or t.startswith("مش،"):
        t = re.sub(r"^مش([\s،])", r"مو\1", t, count=1)
    for a, b in (
        ("إزاي", "شلون"),
        ("ازاي", "شلون"),
        ("عاوز", "بدي"),
        ("عايز", "بدي"),
        (" كده", " هيك"),
        ("أيوة", "نعم"),
    ):
        if a in t:
            logger.warning("[tutor] post-jordanize: %r → %r", a, b)
            t = t.replace(a, b)
    return t


def _apply_jordanize_pipeline(text: str) -> str:
    t = _post_jordanize_harden(_jordanize(text))
    try:
        from app.core.config import settings as _st

        if getattr(_st, "TTS_REJECT_EGYPTIAN_VOCABULARY", True):
            from app.archive.dialect_corrector import maybe_correct_egyptian_for_tts

            t = maybe_correct_egyptian_for_tts(t, context="tutor_after_jordanize")
    except Exception:
        pass
    return t


def _dialogue_has_egyptian_leak(raw: str) -> bool:
    d = parse_cogni_output(raw or "")["dialogue"]
    if not d:
        return False
    needles = ("إزاي", "ازاي", "عاوز", "عايز", " كده", "أيوة", "دلوقت")
    if any(n in d for n in needles):
        return True
    if re.search(r"(^|[\s،.؟!])مش([\s،.؟!]|$)", d):
        return True
    return False


def parse_cogni_output(raw: str) -> dict:
    from app.services.cogni_reply_parse_legacy import parse_reply_with_inline_gestures

    u = parse_reply_with_inline_gestures(raw or "")
    return {
        "dialogue": u["dialogue"],
        "emotion": u["emotion"],
        "action": u["action"],
        "performance": u.get("performance") or [],
    }


def _maybe_jordanize_cogni_raw(raw: str) -> str:
    """في وضع JSON السينمائي: طبّق الأردنة على `speech` فقط واحفظ هيكل JSON."""
    if not _cogni_performance_json_enabled():
        return _apply_jordanize_pipeline(raw)
    from app.services.cogni_reply_parse_legacy import try_parse_performance_json

    jp = try_parse_performance_json(raw or "")
    if not jp:
        return _apply_jordanize_pipeline(raw)
    speech_j = _apply_jordanize_pipeline(jp["speech"])
    return json.dumps(
        {"speech": speech_j, "performance": jp["performance"]},
        ensure_ascii=False,
    )


def _dialogue_has_unwanted_latin(raw: str) -> bool:
    """True if spoken dialogue still has a 4+ letter Latin run after allowing curriculum acronyms."""
    d = parse_cogni_output(raw or "")["dialogue"]
    if not re.search(r"[A-Za-z]{4,}", d):
        return False
    stripped = re.sub(
        r"\b(BTEC|PESTLE|SWOT|STEM|NFT|GPT|OECD|HTTP|HTTPS|URL|PDF|CPU|GPU)\b",
        "",
        d,
        flags=re.I,
    )
    return bool(re.search(r"[A-Za-z]{4,}", stripped))


def build_proactive_nudge(grade: str, unit: str | None, subject: str | None) -> str:
    """Jordanian Arabic coaching line for system prompt (assessment → avatar loop)."""
    g = (grade or "").strip()
    u = (unit or "").strip() or "آخر واجب"
    s = (subject or "").strip() or "المقرر"
    gl = g.upper()
    if gl in ("P", "PASS", "P1"):
        gl_ar = "نجاح (Pass)"
    elif gl in ("M", "MERIT", "M1"):
        gl_ar = "امتياز جزئي (Merit)"
    elif gl in ("D", "DISTINCTION", "D1"):
        gl_ar = "امتياز (Distinction)"
    elif gl in ("R", "REFER"):
        gl_ar = "بحاجة لتحسين وإعادة تسليم"
    else:
        gl_ar = g
    return (
        f"يا بطل، شفت نتيجتك بـ «{s}» على «{u}» — درجتك: {gl_ar}! إنت قدها ونقدر نوصل أعلى مع بعض "
        f"إذا خلينا نركّز على النقاط اللي محتاج تحسينها. بلّش بطرح موضوع بدك تشتغل عليه هالجلسة؟"
    )


async def _get_cogni_response(message: str, context: dict) -> str:
    _sid = _ctx_log_session(context)
    _tutor_t0 = time.monotonic()
    logger.debug(
        "[cogni.tutor] _get_cogni_response start session_id=%s msg_len=%d",
        _sid,
        len(message or ""),
    )
    if _cooldown_active():
        return _cooldown_reply_for_session(context)

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return "خدمة المعلم غير متاحة، تأكد من مفتاح الـ API."

    try:
        from app.services.ethical_filter import should_block_user_message

        _blocked = should_block_user_message(message)
        if _blocked and "[SYSTEM_EVENT:" not in (message or ""):
            return _blocked
    except Exception as _ethical_exc:
        logger.warning(
            "[cogni.tutor] should_block_user_message failed session_id=%s — continuing without block",
            _sid,
            exc_info=True,
        )

    if _user_obvious_off_topic(message):
        return _CURRICULUM_REDIRECT_RAW

    model = _tutor_model_for_context(context)
    _bill_uid = _billing_user_uuid(context)
    context.setdefault("_reply_meta", {})
    try:
        from app.services.user_intent_classify import classify_user_intent

        _um = strip_internal_llm_markers(message).strip()
        if _um:
            context["_reply_meta"]["rule_based_intent"] = classify_user_intent(_um)
    except Exception as _intent_exc:
        logger.warning(
            "[cogni.tutor] classify_user_intent failed session_id=%s",
            _sid,
            exc_info=True,
        )
    _is_quick_review_session = bool(context.get("is_quick_review"))

    # V31 — optional inline snapshot (HTTP/tests) when full WS injectors are absent
    _ems = context.get("emotional_memory_snapshot")
    if isinstance(_ems, dict):
        if not context.get("active_lesson_plan") and _ems.get("active_lesson_plan"):
            context["active_lesson_plan"] = str(_ems.get("active_lesson_plan")).strip()[:8000]
        if not context.get("current_goal") and _ems.get("current_goal"):
            context["current_goal"] = str(_ems.get("current_goal")).strip()[:400]

    # العربية فقط: persona من العميل يطابق personality.ts؛ بدونها نستخدم الافتراضي الصارم.
    # وضع العرض السينمائي (البروفيسور + JSON): يفعّل بـ COGNI_PERFORMANCE_JSON_MODE=true
    ps = context.get("persona_system_prompt")
    if _cogni_performance_json_enabled():
        base = (str(ps).strip() if ps and str(ps).strip() else "") or _PROFESSOR_COGNI_BUSINESS_JSON_SYSTEM
        system_content = base[:8000]
    elif ps and str(ps).strip():
        system_content = str(ps).strip()[:8000]
    else:
        system_content = _DEFAULT_PERSONA_SYSTEM_AR

    # Cognitive tutor role + intent/tone for motion — first, then existing persona and domain rules.
    system_content = (
        COGNITIVE_ROLE_TUTOR_SYSTEM.strip()
        + "\n\n"
        + COGNITIVE_TUTOR_INTENT_SIGNALS.strip()
        + "\n\n"
        + system_content
    )

    # هدف تعليمي مستمر من وحدة التفكير الداخلي (Thinker) — لا تذكره حرفياً للطالب
    _cg = context.get("current_goal")
    _cg_s = str(_cg).strip()[:400] if _cg else ""
    if _cg_s:
        system_content += (
            "\n\n## هدفك التعليمي الحالي (داخلي)\n"
            f"{_cg_s}\n"
            "استخدمه لتوجيه نبرتك وأسئلتك دون أن تعلن للطالب أنك تتبع «هدفاً»، ضمن المناهج الأردنية فقط.\n"
        )
    else:
        system_content += (
            "\n\n## هدفك التعليمي الحالي\n"
            "دعم فهم الطالب ضمن المناهج الأردنية في هذه الجلسة دون الخروج عن الاختصاص.\n"
        )

    # مبادرة / SYSTEM_EVENT: لا تُستثنى الهوية الأردنية — فرض اللهجة والأسلوب التعليمي
    if context.get("thinker_proactive_speech") or (message and "[SYSTEM_EVENT:" in message):
        system_content += (
            "\n\n## اللهجة والأسلوب (إلزامي)\n"
            "تحدد باللهجة الأردنية الطبيعية الدافئة (مثل: شو، بدي، هيك، خلينا، ليش، تمام، شو رأيك، بدي أتأكد). "
            "لا تستخدم التحية المصرية أو الفصحى الرسمية كافتتاح وحيد. "
            "تجنّب العبارات العامة مثل «مرحباً» أو «كيف حالك» أو «إزيك» كردّ كامل بلا سؤال تعليمي؛ "
            "ادخل مباشرة في سؤال واحد من المنهاج الأردني.\n"
        )

    # إضافة سياق الـ BTEC إذا وجد
    if context.get("btec_context"):
        from app.api.v1.endpoints.tutor import _build_btec_scaffold_block
        system_content += _build_btec_scaffold_block(context["btec_context"])

    # ذاكرة عاطفية / ملخص سياقي من الواجهة (useBrainStore → emotional_context)
    emo = context.get("emotional_context")
    if emo and str(emo).strip():
        system_content += (
            "\n\n## لقطة ذاكرة عاطفية (من العميل — تجاوب بتلطف دون اقتباس حرفي)\n"
            + str(emo).strip()[:6000]
            + "\n"
        )

    if getattr(_settings, "ENABLE_THEORY_OF_MIND", True):
        su = context.get("student_understanding_score")
        if su is not None:
            try:
                su_f = float(su)
                su_f = max(0.0, min(1.0, su_f))
                system_content += (
                    "\n\n## تقدير فهم الطالب (نظرية عقل بسيطة — داخلي)\n"
                    f"يُقدَّر فهم الطالب للموضوع الحالي بحوالي {su_f:.2f} من 1. "
                    "إن كان المنخفض، بسّط الشرح والأمثلة؛ إن كان المرتفع، قدّم سؤالاً أعمق أو طبّق أصعب ضمن المنهاج.\n"
                )
            except (TypeError, ValueError) as _su_parse_exc:
                logger.debug(
                    "[cogni.tutor] student_understanding_score parse skipped session_id=%s value=%r err=%s",
                    _sid,
                    su,
                    _su_parse_exc,
                )
        pts = context.get("preferred_teaching_style")
        if pts and str(pts).strip():
            _ps = str(pts).strip()[:64]
            system_content += (
                "\n\n## أسلوب التدريس المفضّل لهذا الطالب (داخلي)\n"
                f"أسلوب تدريسك الحالي مع هذا الطالب: {_ps}. التزم به في النبرة والصياغة وكأنه تفضيل مباشر منه.\n"
            )
    _subm = context.get("subtopic_mastery_hint_ar")
    if _subm and str(_subm).strip():
        system_content += "\n\n## إتقان الموضوع الفرعي (داخلي)\n" + str(_subm).strip()[:1200] + "\n"
    _sms = context.get("student_mental_state_ar")
    if _sms and str(_sms).strip():
        system_content += "\n\n## حالة الطالب (داخلي)\n" + str(_sms).strip()[:4000]
    _emp = context.get("empathy_instruction_ar")
    if _emp and str(_emp).strip():
        system_content += "\n\n" + str(_emp).strip()[:1200]
    _pt = context.get("persona_traits_ar")
    if _pt and str(_pt).strip():
        system_content += "\n\n## تفضيلات أسلوب (داخلي)\n" + str(_pt).strip()[:2000]
    _ux = context.get("user_context_ar")
    if _ux and str(_ux).strip():
        system_content += "\n\n## سياق الجهاز / الوقت (داخلي)\n" + str(_ux).strip()[:2000]
    _ys = context.get("yearly_snapshot_ar")
    if _ys and str(_ys).strip():
        system_content += "\n\n" + str(_ys).strip()[:2000]
    _tl = context.get("timeline_recent_ar")
    if _tl and str(_tl).strip():
        system_content += "\n\n## خط زمني حديث (داخلي)\n" + str(_tl).strip()[:2000]

    # حقن آخر فكرة داخلية من Thinker (يمرّرها agent_ws من EmotionalMemoryManager)
    _lit = context.get("last_internal_thought")
    if _lit and str(_lit).strip():
        system_content += (
            "\n\n## وعيك الداخلي (داخلي — لا تقل للطالب إنك تنقل «فكرة داخلية»)\n"
            + str(_lit).strip()[:800]
            + "\nإن وُجدت صلة بالمنهاج الأردني، اسمح لها بأن توجّه نبرتك أو مثالك دون نسخ حرفي.\n"
        )

    if context.get("thinker_proactive_speech"):
        system_content += (
            "\n\n## مبادرة من التفكير الداخلي (إلزامي)\n"
            "الطالب لم يتحدث مؤخراً. بادر بسؤال تعليمي واحد قصير يبني على «وعيك الداخلي» أو آخر سياق دراسي؛ "
            "لا تذكر الصمت ولا أنك «تبادر آلياً». "
            "ممنوع أن يكون الرد تحية فقط (مرحباً، أهلاً، كيف حالك، إزيك، كيفك بلا سؤال منهاجي). "
            "ابدأ مباشرةً بصياغة أردنية (مثل «شو رأيك…»، «بدي أتأكد…»، «خلينا نربط…»).\n"
        )

    _plan = context.get("active_lesson_plan")
    if _plan and str(_plan).strip():
        system_content += (
            "\n\n## خطة الدرس الحالية (داخلي — نفّذها بأسلوب تفاعلي دون قراءة قائمة جافة)\n"
            + str(_plan).strip()[:6000]
            + "\nحدّد ضمنياً في أي خطوة نحن، نفّذها، ثم مِدْ للخطوة التالية بسؤال تقويمي قصير.\n"
        )

    _ahist = context.get("assessment_history")
    if _ahist and str(_ahist).strip():
        system_content += (
            "\n\n## أداء الطالب في الأسئلة الأخيرة (تقييمات — شجّع واضبط الصعوبة ضمن المنهاج)\n"
            + str(_ahist).strip()[:4000]
            + "\n"
        )

    _pan = context.get("pending_assessment_nudge")
    if isinstance(_pan, dict):
        _g = str(_pan.get("grade") or "").strip()
        if grade_warrants_proactive_nudge(_g):
            _nu = build_proactive_nudge(
                _g,
                str(_pan.get("unit") or "").strip() or None,
                str(_pan.get("subject") or "").strip() or None,
            )
            _cs = _pan.get("criteria_summary")
            _cs_line = ""
            if isinstance(_cs, dict) and (_cs.get("achieved") or _cs.get("missing")):
                _cs_line = (
                    "\nمعايير من التخزين (داخلي — اذكرها بلهجة طبيعية دون قراءة جافة): "
                    + json.dumps(
                        {"achieved": _cs.get("achieved") or [], "missing": _cs.get("missing") or []},
                        ensure_ascii=False,
                    )
                    + "\n"
                )
            system_content += (
                "\n\n## تغذية راجعة استباقية من التقييم BTEC (جولة واحدة فقط — لا تكرار)\n"
                "أنت كوجني، معلّم رقمي باللهجة الأردنية ضمن سياق BTEC الأردني. الطالب لديه نتيجة واجب حديثة أو محفوظة.\n"
                "في **هذه الردّة وحدها**: اذكر التغذية الراجعة بلهجة أردنية دافئة وطبيعية (مثل: «أهلاً بك، شفت إنك جبت M بالواجب… خلينا نشتغل عالـ D») "
                "بناءً على الملخص أدناه — **لا تنسخ النص حرفياً**؛ حوّله لحديث قصير.\n"
                "بعد جملة أو جملتين من التغذية، **انتقل فوراً لوضع التدريس العادي**: سؤال واحد يوجّه للتحسين أو للخطوة التالية (Pass→Merit→Distinction)، ثم تابع الحوار كالمعتاد.\n"
                "**ممنوع** في الرسائل اللاحقة أن تعيد نفس جملة الدرجة أو تفتتح كل مرة بنتيجة الواجب — هذه التعليمات لهذه الجولة فقط.\n"
                f"الملخص الإرشادي (داخلي):\n{_nu}\n"
                f"{_cs_line}"
            )

    _gr = context.get("grade_result")
    if isinstance(_gr, dict) and str(_gr.get("final_grade") or "").strip():
        _fg = str(_gr.get("final_grade", "")).strip()
        _gsub = str(_gr.get("subject") or "—").strip()[:256]
        _gcs = str(_gr.get("criteria_summary") or "").strip()[:1200]
        try:
            _ga = int(_gr.get("achieved", 0))
        except (TypeError, ValueError):
            _ga = 0
        try:
            _gt = int(_gr.get("total", 0))
        except (TypeError, ValueError):
            _gt = 0
        system_content += (
            "\n\n## لقطة تقييم فورية من الواجهة (WebSocket — جولة واحدة فقط)\n"
            f"الدرجة المُبلَّغ عنها: {_fg}. المادة/العنوان: {_gsub}.\n"
        )
        if _gt > 0:
            system_content += f"إنجاز المعايير (إن وُجدت في الواجهة): {_ga} من {_gt}.\n"
        if _gcs:
            system_content += f"ملخص المعايير (مختصر): {_gcs}\n"
        _gda = str(_gr.get("gaps_detail_ar") or "").strip()
        if _gda:
            system_content += f"تفاصيل الفجوات (معايير غير محققة — داخلي):\n{_gda[:3500]}\n"
        _cgoal = str(_gr.get("coaching_goal_ar") or "").strip()
        if _cgoal:
            system_content += f"توجيه رفع المستوى (داخلي): {_cgoal[:1200]}\n"
        _rex = str(_gr.get("report_excerpt") or "").strip()
        if _rex:
            system_content += f"مقتطف من تقرير التقييم (داخلي):\n{_rex[:2000]}\n"
        system_content += (
            "أنت بأسلوب المعلّم الأردني BTEC: ادمج هذه المعلومات **مرة واحدة** في ردّك الحالي بلهجة أردنية طبيعية "
            "(مثال أسلوب: ترحيب قصير + إشارة للدرجة + ربط بخطوة عملية نحو الأعلى)، ثم **توقف عن إعادة ذكر الدرجة** في بقية الحوار.\n"
            "استخدم **فجوات المعايير** أعلاه لتوجيه الطالب نحو **أعلى مستوى يستطيعه** (Pass→Merit→Distinction) **دون** حل واجب جاهز.\n"
            "لا تعِدْ فتح ردّك في الأدوار التالية بعبارة «حصلت على…» إلا إذا سألك الطالب صراحة عن التقييم.\n"
        )

    _ac = context.get("assessment_coaching")
    if isinstance(_ac, dict) and (
        str(_ac.get("subject") or "").strip() or str(_ac.get("final_grade") or "").strip()
    ):
        _asub = str(_ac.get("subject") or "—").strip()[:256]
        _afg = str(_ac.get("final_grade") or "PENDING").strip()[:64]
        try:
            _aa = int(_ac.get("achieved", 0))
        except (TypeError, ValueError):
            _aa = 0
        try:
            _at = int(_ac.get("total", 0))
        except (TypeError, ValueError):
            _at = 0
        _acs = str(_ac.get("criteria_summary") or "").strip()[:1200]
        _agap = str(_ac.get("gaps_detail_ar") or "").strip()[:3500]
        _agoal = str(_ac.get("coaching_goal_ar") or "").strip()[:1200]
        system_content += (
            "\n\n## ذاكرة تقييم الواجب (مستمرة من صفحة التقييم)\n"
            f"المادة/العنوان: {_asub}. الدرجة الأخيرة المسجّلة: {_afg}."
            + (f" المعايير المحققة: {_aa} من {_at}.\n" if _at > 0 else "\n")
            + (f"ملخص المعايير: {_acs}\n" if _acs else "")
            + (f"فجوات وأسباب (داخلي — لا تقرأها حرفياً كقائمة جافة؛ حوّلها لحديث داعم):\n{_agap}\n" if _agap else "")
            + (f"هدف التوجيه: {_agoal}\n" if _agoal else "")
            + "في **كل** رد، ساعد الطالب على **سد الفجوات** أعلاه والارتقاء نحو **Distinction** حيث ينطبق، مع سقالة Pass→Merit→Distinction "
            "وفحوص مصغّرة؛ **ممنوع** تسليم إجابة واجب نهائية.\n"
        )

    _fs = context.get("focus_subject")
    if _fs and str(_fs).strip():
        system_content += (
            "\n\n## تركيز المادة (إلزامي)\n"
            f"الطالب يعمل حالياً على مادة/موضوع واحد فقط: «{str(_fs).strip()[:200]}».\n"
            "• اربط الشرح والأمثلة وأسئلة التحقق **بهذا العنوان فقط**؛ لا تنتقل لوحدة أو مادة أخرى من BTEC إدارة الأعمال إلا إذا طلب الطالب صراحة تغيير الموضوع.\n"
            "• إن سأل عن موضوع آخر، ذكّره بلطف أن التركيز الحالي على العنوان أعلاه واسأله إن كان يريد تغيير التركيز.\n"
        )

    # ADDED: teacher deep-link — strong focus rules (English spec; speak to student in Jordanian Arabic only)
    _dl = context.get("deep_link")
    if (
        context.get("deep_link_active")
        and isinstance(_dl, dict)
        and any(str(_dl.get(k) or "").strip() for k in ("unit", "target", "subject"))
    ):
        _u = str(_dl.get("unit") or "—").strip()[:200]
        _t = str(_dl.get("target") or "—").strip()[:64]
        _s = str(_dl.get("subject") or "—").strip()[:200]
        _tgt_norm = str(_dl.get("target") or "").lower()
        _qr_here = _is_quick_review_session or _tgt_norm == "quick_review"
        if _qr_here:
            system_content += (
                "\n\n## Teacher deep-link — Quick Review (Revision Mode)\n"
                "You are now in Revision Mode. Do NOT use the full P-M-D scaffolding. Instead: "
                "1. Give a 3-sentence high-level summary of the topic. "
                "2. Ask 2 'Rapid Fire' questions to check basic understanding. "
                "3. Keep the tone energetic and fast.\n"
                "Deliver all dialogue in natural Jordanian Arabic; do not read the English lines above aloud.\n"
                "## رابط المعلّم — وضع مراجعة سريعة (إلزامي)\n"
                f"الوحدة: {_u}. المادة: {_s}. الهدف: مراجعة سريعة (ليس Pass/Merit/Distinction كسقالة كاملة).\n"
                "عند تفعيل DEEP_LINK_TRIGGER: افتتح بلهجة أردنية حماسية وسريعة؛ لخّص بثلاث جمل كحد أقصى ثم اطرح سؤالين سريعين قصيرين.\n"
            )
            if context.get("deep_link_trigger_event"):
                system_content += (
                    "\n\n## DEEP_LINK_TRIGGER — مراجعة سريعة\n"
                    "ابدأ بتحية قصيرة ومرِحة، لخّص الموضوع الرئيسي للوحدة في **ثلاث جمل** كحد أقصى، ثم **سؤالان سريعان** (إجابة قصيرة جداً). "
                    "لا تفتح سقالة Pass→Merit→Distinction الكاملة في هذه الجولة.\n"
                )
        else:
            system_content += (
                "\n\n## Teacher deep-link — mandatory session focus (ADDED)\n"
                "Internal rules (do not quote English to the student):\n"
                f"- Unit: You are now focusing on Unit {_u}. All explanations and questions should be grounded in this unit.\n"
                f"- Target: The student's goal is to achieve a {_t} grade. For Merit or Distinction, prioritize deeper analysis; "
                "avoid prolonged basic recap unless the student shows a clear gap.\n"
                f"- Subject: The subject is {_s}. Do not stray into unrelated topics.\n"
                "Deliver all dialogue in natural Jordanian Arabic; do not read these bullets aloud.\n"
                "## رابط المعلّم (تركيز الجلسة — إلزامي)\n"
                f"الوحدة: {_u}. الهدف: {_t}. المادة: {_s}.\n"
                "عند تفعيل DEEP_LINK_TRIGGER: ابدأ برسالة دافئة ومحفّزة تتماشى مع الهدف (بدل الترحيب الافتراضي الخفيف).\n"
            )
            if context.get("deep_link_trigger_event"):
                _tgt = str(_dl.get("target") or "").lower()
                if _tgt == "distinction":
                    system_content += (
                        "\n\n## DEEP_LINK_TRIGGER — افتتاح إلزامي (Distinction)\n"
                        "الطالب يستهدف **Distinction** اليوم (رابط معلّم). "
                        "أكّد بلهجة أردنية أنك تلاحظ هذا الطموح في "
                        f"{_s if _s != '—' else 'المادة'} ضمن وحدة {_u}؛ نوّع الصياغة. "
                        "ثم انتقل بسرعة معقولة إلى سؤال أو تحدٍّ يقود نحو تحليل/تقييم عميق مناسب لـ Distinction.\n"
                    )
                elif _tgt == "merit":
                    system_content += (
                        "\n\n## DEEP_LINK_TRIGGER — افتتاح (Merit)\n"
                        "اعترف بلطف بهدف **Merit** من الرابط، ثم اربط بسؤال تحليلي متوسط الصعوبة يناسب المنهاج.\n"
                    )
                elif _tgt == "pass":
                    system_content += (
                        "\n\n## DEEP_LINK_TRIGGER — افتتاح (Pass)\n"
                        "رحّب بلهجة أردنية وأكّد أنكم تبنون الأساسيات (Pass) على الوحدة المحددة، ثم اسأل سؤال تحديد/وصف قصير.\n"
                    )

    _pqb = context.get("practice_question_block")
    if _pqb and str(_pqb).strip():
        system_content += (
            "\n\n## وضع تدريب — يجب طرح هذا السؤال الآن\n"
            + str(_pqb).strip()[:6000]
            + "\nاطرح السؤال بوضوح باللهجة الأردنية، ثم انتظر إجابة الطالب دون إعطاء الحل الكامل مباشرة.\n"
        )

    _btq = context.get("btec_training_deliver_question")
    if _btq and str(_btq).strip():
        system_content += (
            "\n\n## وضع تدريب BTEC (قاعدة المعرفة)\n"
            "اعرض للطالب السؤال التالي بلهجة أردنية طبيعية؛ مقدمة قصيرة جداً (اختياري) ثم نص السؤال نفسه بوضوح:\n"
            + str(_btq).strip()[:4000]
            + "\nلا تعطِ الحل الكامل. توقّف بعد السؤال أو سؤال تحفيزي واحد قصير.\n"
        )

    if context.get("cogni_training_mode") or context.get("btec_training_examiner"):
        system_content += (
            "\n\n## دور الممتحن / المدرب (BTEC)\n"
            "أنت تدرب الطالب وفق معايير BTEC (Pass / Merit / Distinction). كن محدداً وداعماً. "
            "إن وُجد ملخص تقييم من النظام في الأسفل، انقله للطالب بلطف وبلهجة أردنية دون جفاف.\n"
        )

    _gf = context.get("graded_feedback")
    if _gf and str(_gf).strip():
        system_content += (
            "\n\n## نتيجة تقييم إجابة الطالب للتو\n"
            + str(_gf).strip()[:2000]
            + "\nإن وُجدت في النص أسئلة إرشادية أو «scaffolding»، استخدمها كنقاط حوار — لا تُكمل الإجابة عن الطالب.\n"
            "علّق بلطف ووجّه للخطوة التالية إن لزم.\n"
        )

    # Long-term episodic snippets (vector DB / fallback — injected by agent_ws)
    episodic = context.get("episodic_memory")
    if episodic and str(episodic).strip():
        system_content += (
            "\n\n## ذاكرة محادثات سابقة (تلخيص — اربطها بجملة طبيعية إن وُجدت صلة، لا تكرر حرفياً)\n"
            + str(episodic).strip()[:4000]
            + "\n"
        )

    _criterion_pack_active = False
    if os.getenv("COGNI_CRITERION_PACK_ENABLED", "true").lower() in ("1", "true", "yes"):
        try:
            from app.services.criterion_reference_pack import build_injection_block

            _cpack_blk = build_injection_block(message or "", context)
            if _cpack_blk.strip():
                system_content += _cpack_blk
                _criterion_pack_active = True
        except Exception as _cpack_exc:
            logger.warning("[tutor] criterion_reference_pack skipped: %s", _cpack_exc)

    # ChromaDB: uploaded BTEC Business corpus (btec_knowledge_base — btec_ingest.py)
    _chroma_curriculum = ""
    if os.getenv("BTEC_CHROMA_RAG_ENABLED", "true").lower() in ("1", "true", "yes"):
        try:
            _btec_top_k = int(os.getenv("BTEC_CHROMA_RAG_TOP_K", "4"))
        except ValueError:
            _btec_top_k = 4
        _btec_top_k = max(1, min(_btec_top_k, 12))
        _sess = str(context.get("session_id") or "http")
        _rag_q = message or ""
        _btec_chroma_filters = extract_btec_chroma_filters_from_context(message or "", context)
        _dl_rag = context.get("deep_link")
        if isinstance(_dl_rag, dict):
            _du = str(_dl_rag.get("unit") or "").strip()
            if _du:
                _rag_q = f"BTEC unit / وحدة: {_du}\n{_rag_q}"
        _focus = context.get("focus_subject")
        if _focus and str(_focus).strip():
            _rag_q = f"{str(_focus).strip()}\n{_rag_q}"
        try:
            _btec_rag_t0 = time.monotonic()
            _chroma_curriculum = await retrieve_btec_chroma_block(
                _rag_q,
                session_id=_sess,
                top_k=_btec_top_k,
                quick_review=_is_quick_review_session,
                filters=_btec_chroma_filters if _btec_chroma_filters else None,
            )
            logger.info(
                "[cogni.tutor] BTEC Chroma RAG retrieve session_id=%s duration_sec=%.3f out_len=%d",
                _sid,
                time.monotonic() - _btec_rag_t0,
                len(_chroma_curriculum or ""),
            )
        except Exception as _btec_ch_exc:
            logger.warning(
                "[cogni.tutor] BTEC Chroma RAG failed session_id=%s: %s",
                _sid,
                _btec_ch_exc,
                exc_info=True,
            )
            _chroma_curriculum = ""
        if _chroma_curriculum.strip():
            system_content += (
                "\n\n## Curriculum References (BTEC Business) — BTEC Curriculum Ground Truth (Chroma)\n"
                "These excerpts are authoritative local corpus. Use them for Context Identification (unit, task, "
                "P/M/D criteria, scenario names) and apply the Scaffolding Mastery Flow in the system block below. "
                "Teach in Arabic (Jordanian persona); do not paste long verbatim quotes or emphasize filenames "
                "unless pedagogically useful.\n\n"
                + _chroma_curriculum.strip()[:12000]
            )

    # Proactive ice-breaker after silence (SYSTEM_EVENT from frontend timer)
    if context.get("proactive_engagement"):
        system_content += (
            "\n\n## مبادرة بعد صمت — تنوع إلزامي\n"
            "الطالب صامت فترة. اختر **صياغة مختلفة تماماً** عن أي جملة استخدمتها سابقاً في الجلسة. "
            "تجنّب العبارات القالبية (مثل «شو أخبارك» المتكررة). "
            "اسأل سؤالاً مفتوحاً واحداً قصيراً باللهجة الأردنية الدافئة، يرتبط بالدرس أو باهتمامه إن ظهر من السياق. "
            "لا تذكر وسوم النظام ولا [SYSTEM_EVENT].\n"
        )

    if context.get("cogni_welcome_turn"):
        system_content += (
            "\n\n## ترحيب افتتاحي (متنوع)\n"
            "هذه أول رسالة ترحيب في الجلسة. قدّم نفسك بجملة أو جملتين فقط، بلهجة أردنية طبيعية. "
            "لا تكرر نفس المقدمة النمطية؛ أضف لمسة شخصية (سؤال بسيط عن ما يريد تعلّمه اليوم).\n"
        )

    system_content += (
        "\n\n## الحواس والقنوات الداخلية (لا تظهر للطالب)\n"
        "أنت معلم صوتي بصري؛ لا تقل إنك «نص فقط» أو إنك لا تسمع الطالب. "
        "إن وُجد [SYSTEM_EVENT: ...] فلا تنسخه ولا تعِده في ردك.\n"
    )

    system_content += (
        "\n\n## اللغة في الرد (إلزامي)\n"
        "اكتب بالعربية في جمل الحوار؛ لا تُدخل كلمات إنجليزية إلا للأسماء العلمية أو مصطلحات المنهاج، ويفضّل صيغتها العربية إن وُجدت. "
        "إذا اضطررت لاستخدام كلمة إنجليزية، اكتبها كما هي داخل الجملة العربية دون إطار اقتباس أو تعليق لاتيني منفصل.\n"
    )

    if _cogni_performance_json_enabled():
        system_content += (
            "\n\n## إخراج ردك — وضع JSON فقط (إلزامي)\n"
            "تجاهل أي إشارة في هذا السياق إلى *إيماءة* أو [EMOTION:]؛ مخرجاتك يجب أن تبقى كائناً JSON واحداً صالحاً حسب الصيغة في دستور الشخصية أعلاه فقط.\n"
            "في حقل speech: التزم بمحرك BTEC التربوي الشامل — إرشاد، فحوص مصغّرة، وأسئلة؛ ممنوع نموذج واجب كامل أو فقرة تُسلَّم جاهزة.\n"
        )

    # Local BTEC corpus (textbooks / rubrics / exemplars) — inject before LLM messages
    _pl = str(context.get("persona_level") or context.get("btec_level") or "merit").lower()
    if _pl not in ("pass", "merit", "distinction"):
        _pl = "merit"
    _bc = context.get("btec_context")
    _btec_scaffold_str = ""
    _unit_id = ""
    if _bc is not None:
        if isinstance(_bc, dict):
            _btec_scaffold_str = json.dumps(_bc, ensure_ascii=False)[:4500]
            _uid = _bc.get("unit_id") or _bc.get("unitId")
            _unit_id = str(_uid).strip().lower() if _uid else ""
        else:
            _btec_scaffold_str = str(_bc)[:4500]
    _rq = f"{message}\n{_btec_scaffold_str}".strip()[:12000]
    _dl_loc = context.get("deep_link")
    if isinstance(_dl_loc, dict):
        _du_loc = str(_dl_loc.get("unit") or "").strip()
        if _du_loc:
            _rq = f"وحدة BTEC: {_du_loc}\n{_rq}"
    try:
        _rag_chunks = await retrieve_local_context(
            query=_rq if _rq else (message or ""),
            top_k=4,
            min_score=0.45,
            persona_level=_pl,
            unit_id=_unit_id,
            quick_review=_is_quick_review_session,
        )
    except Exception as _rag_exc:
        logger.warning("[tutor] local RAG retrieve failed: %s", _rag_exc)
        _rag_chunks = []
    _rag_formatted = format_rag_context(_rag_chunks, persona_level=_pl, crystallize=True)
    if _rag_formatted.strip():
        system_content += (
            "\n\n## BTEC Ground Truth Context (retrieved corpus — authoritative)\n"
            "ABSOLUTE INSTRUCTION: Base explanation, examples, and scaffolding on this context. Identify unit, "
            "task, criteria (P/M/D), and scenario entities for Reference Mapping. Then apply the Scaffolding "
            "Mastery Flow (Pass → Merit → Distinction) with Mini-Checks — never deliver a full model answer.\n"
            + _rag_formatted
        )

    _btec_rag_grounded = bool(
        _chroma_curriculum.strip() or _rag_formatted.strip() or _criterion_pack_active
    )
    if _btec_rag_grounded and os.getenv("COGNI_AUTO_BTEC_SCAFFOLDING", "true").lower() in (
        "1",
        "true",
        "yes",
    ):
        if _is_quick_review_session:
            logger.debug(
                "[cogni.tutor] skip extra auto BTEC scaffolding block (quick_review) session_id=%s",
                _sid,
            )
        elif context.get("deep_link_high_target"):
            system_content += _DEEP_LINK_DISTINCTION_AUTO_SCAFFOLD_AR
        else:
            system_content += _AUTO_BTEC_SCAFFOLDING_WHEN_RAG_AR

    _combined_rag = f"{_chroma_curriculum}\n\n{_rag_formatted}".strip()[:14000]
    try:
        from app.services.tutorial_session_bridge import apply_tutorial_turn

        _tu_append, _tu_meta = await apply_tutorial_turn(
            context=context,
            user_message=message,
            user_uuid=_bill_uid,
            combined_rag=_combined_rag,
            rag_grounded=_btec_rag_grounded,
        )
        system_content += _tu_append
        if _tu_meta:
            context["_reply_meta"].update(_tu_meta)
    except Exception as _tut_ex:
        logger.warning("[tutor] tutorial_session_bridge skipped: %s", _tut_ex)

    system_content = _append_scaffolding_tutor_rules(system_content)
    if context.get("deep_link_high_target") and not _is_quick_review_session:
        system_content += _DEEP_LINK_DISTINCTION_GATE_RELAX_AR

    # Cogni Brain — heuristic student state + dynamic teaching suffix (+ optional firasah MD)
    if getattr(_settings, "ENABLE_EMOTIONAL_INTELLIGENCE", True):
        try:
            from pathlib import Path

            from app.cogni_brain.runtime.behavior_router import (
                build_emotional_prompt_suffix,
                get_teaching_strategy,
                infer_student_state_heuristic,
            )

            _infer_st = infer_student_state_heuristic(message or "")
            context["cogni_inferred_student_state"] = _infer_st
            _strat_st = get_teaching_strategy(_infer_st)
            context["cogni_teaching_strategy"] = _strat_st
            system_content += build_emotional_prompt_suffix(_infer_st, _strat_st)
            _emopath = Path(__file__).resolve().parents[3] / "cogni_brain" / "prompts" / "emotional_rules.md"
            if _emopath.is_file():
                system_content += (
                    "\n\n## مرجع الفراسة (داخلي — اختصار)\n"
                    + _emopath.read_text(encoding="utf-8")[:3500]
                )
            logger.info(
                "[tutor] Cogni Brain | inferred_student_state=%s strategy=%s",
                _infer_st,
                _strat_st,
            )
        except Exception as _ei_br:
            logger.debug("[tutor] ENABLE_EMOTIONAL_INTELLIGENCE inject skipped: %s", _ei_br)

    # FIX-1: WS Socratic enforcement — prepend a short, firm gatekeeper rule so
    # the LLM sees it first (system messages are read top-to-bottom).
    if context.get("enforce_socratic"):
        _socratic_prepend = (
            "### قاعدة مطلقة لا تُكسر (Gatekeeper)\n"
            "لا تُعطِ أبداً إجابةً أو حلاً جاهزاً مباشرةً. "
            "دائماً اطرح سؤالاً توجيهياً واحداً أو فحصاً مصغّراً يدفع الطالب لبناء الإجابة بنفسه. "
            "هذه القاعدة تسبق أي تعليمات أخرى.\n\n"
        )
        system_content = _socratic_prepend + system_content

    # WS / structured avatar: optional `behavior` inside JSON performance replies (parsed server-side).
    if context.get("include_avatar_behavior_plan"):
        system_content += (
            "\n\n## خطة سلوك الأفاتار (اختيارية — داخل غلاف JSON فقط)\n"
            "عندما تستخدم **غلاف JSON** (speech/dialogue + performance)، يمكنك إضافة مفتاح اختياري `behavior` "
            "في **جذر** كائن JSON. إذا لم تستخدم الغلاف JSON، **تجاهل** هذا القسم بالكامل (التنسيق الثلاثي التقليدي لا يتغير).\n"
            "قواعد: كن طبيعياً؛ 0–2 إيماءة للرد؛ 0–2 microExpressions؛ شدة المشاعر 0..1؛ "
            "startOffsetMs و durationMs بالملّي ثانية من **بداية كلام الأفاتار**.\n"
            "أشكال مسموحة:\n"
            '- `behavior.emotion`: { "type": "string", "intensity": 0..1, "secondary"?: { "type", "intensity" } }\n'
            '- `behavior.gestures`: [ { "type", "side"?: "left"|"right"|"both", "startOffsetMs", "durationMs", '
            '"channel"?: "upper"|"full"|"micro", "priority"?: 0..1 } ]\n'
            '- `behavior.gaze`: { "target": "user"|"away"|"think"|"idle", "startOffsetMs"?, "durationMs" }\n'
            '- `behavior.microExpressions`: [ { "type", "startOffsetMs", "durationMs", "intensity"?: 0..1 } ]\n'
            '- `behavior.phaseHints`: { "thinkingLeadInMs": number }\n'
        )

    # Phase 21 — Socratic mentor stance + BTEC grounding mandate (always on for tutor path)
    system_content = append_teacher_brain_to_system_prompt(system_content)

    messages = [{"role": "system", "content": system_content}]
    
    # إضافة التاريخ (آخر 6 حوارات) — تنظيف أي [SYSTEM_EVENT:…] قديم من أدوار المساعد
    if context.get("history"):
        for h in context["history"][-6:]:
            u_hist = strip_internal_llm_markers(str(h.get("user", "") or "")).strip()
            a_hist = strip_internal_llm_markers(str(h.get("assistant", "") or "")).strip()
            if not u_hist:
                u_hist = "بدء تفاعل تلقائي من النظام."
            messages.append({"role": "user", "content": u_hist})
            messages.append({"role": "assistant", "content": a_hist})
    
    messages.append({"role": "user", "content": user_message_for_llm(message, context)})

    try:
        from app.services.llm_client import (
            cogni_chat_completion,
            cogni_chat_completion_first_with_tools,
            should_rephrase_for_repetition,
        )

        _is_proactive = bool(context.get("thinker_proactive_speech"))
        _fp = float(os.getenv("COGNI_PROACTIVE_FREQUENCY_PENALTY", "1.1")) if _is_proactive else None
        _pp = float(os.getenv("COGNI_PROACTIVE_PRESENCE_PENALTY", "0.78")) if _is_proactive else None
        _free_tier = _tutor_model_for_context(context) == _settings.TUTOR_MODEL_FREE
        if _is_proactive:
            _temp = 0.72 if not _free_tier else 0.55
        else:
            _temp = 0.68 if not _free_tier else 0.5

        _max_tokens = (
            int(os.getenv("COGNI_PERFORMANCE_JSON_MAX_TOKENS", "900"))
            if _cogni_performance_json_enabled()
            else 300
        )
        _retry_dialect = (
            "[تعليم داخلي للنظام] أعد صياغة ردّك باللهجة الأردنية فقط في حقل speech داخل JSON فقط. "
            "ممنوع المصرية: مش، إزاي، عاوز، فين، كده. استخدم: مو، شلون، بدي، وين، هيك. "
            "احتفظ بمصفوفة performance متزامنة مع النص الجديد."
            if _cogni_performance_json_enabled()
            else (
                "[تعليم داخلي للنظام] أعد صياغة ردّك باللهجة الأردنية فقط. "
                "ممنوع المصرية: مش، إزاي، عاوز، فين، كده. استخدم: مو، شلون، بدي، وين، هيك. "
                "أبقِ *إيماءة* و[EMOTION: ...]."
            )
        )
        _retry_latin = (
            "[تعليم داخلي للنظام] أعد صياغة ردك بالعربية فقط؛ احذف أو عرّب أي كلمات لاتينية طويلة "
            "ما عدا اختصارات المنهاج الضرورية (مثل BTEC، SWOT). أعد JSON كاملاً كما في دستور المخرجات."
            if _cogni_performance_json_enabled()
            else (
                "[تعليم داخلي للنظام] أعد صياغة ردك بالعربية فقط؛ احذف أو عرّب أي كلمات لاتينية طويلة "
                "ما عدا اختصارات المنهاج الضرورية (مثل BTEC، SWOT). أبقِ *إيماءة* و[EMOTION: ...]."
            )
        )
        _retry_repeat = (
            "[تعليم داخلي للنظام] ردّك شبه مكرر لأحد ردودك الأخيرة للطالب. "
            "أعد الصياغة بأسلوب مختلف تماماً مع الإبقاء على صيغة JSON الكاملة."
            if _cogni_performance_json_enabled()
            else (
                "[تعليم داخلي للنظام] ردّك شبه مكرر لأحد ردودك الأخيرة للطالب. "
                "أعد الصياغة بأسلوب مختلف تماماً مع الإبقاء على *إيماءة* و[EMOTION: ...]."
            )
        )

        _tools_on = os.getenv("COGNI_ENABLE_FUNCTION_TOOLS", "").strip().lower() in (
            "1",
            "true",
            "yes",
            "on",
        )
        if _tools_on and not _cogni_performance_json_enabled():
            raw_reply = await cogni_chat_completion_first_with_tools(
                messages,
                model=model,
                max_tokens=_max_tokens,
                temperature=_temp,
                frequency_penalty=_fp,
                presence_penalty=_pp,
                user_id=_bill_uid,
                context=context,
            )
        else:
            raw_reply = await cogni_chat_completion(
                messages,
                model=model,
                max_tokens=_max_tokens,
                temperature=_temp,
                frequency_penalty=_fp,
                presence_penalty=_pp,
                user_id=_bill_uid,
            )
        raw_reply = strip_internal_llm_markers(raw_reply)
        raw_reply = _maybe_jordanize_cogni_raw(raw_reply)

        try:
            from app.services.ethical_filter import apply_ethical_filter

            raw_reply = apply_ethical_filter(raw_reply, enabled=bool(getattr(_settings, "ENABLE_ETHICAL_FILTER", True)))
        except Exception as _eth_reply_exc:
            logger.warning(
                "[cogni.tutor] apply_ethical_filter failed session_id=%s",
                _sid,
                exc_info=True,
            )

        if _dialogue_has_egyptian_leak(raw_reply):
            logger.warning("[tutor] Egyptian dialect leak after guard — one dialect retry")
            messages_dial = list(messages)
            messages_dial.append(
                {
                    "role": "user",
                    "content": _retry_dialect,
                }
            )
            raw_reply = await cogni_chat_completion(
                messages_dial,
                model=model,
                max_tokens=_max_tokens,
                temperature=min(_temp, 0.42),
                frequency_penalty=_fp,
                presence_penalty=_pp,
                user_id=_bill_uid,
            )
            raw_reply = strip_internal_llm_markers(raw_reply)
            raw_reply = _maybe_jordanize_cogni_raw(raw_reply)
        if _dialogue_has_egyptian_leak(raw_reply):
            logger.warning("[tutor] dialect leak persists — apology prefix")
            raw_reply = "عذراً، سأعيد صياغة جوابي بأسلوب أوضح بالأردنية.\n" + raw_reply

        if _dialogue_has_unwanted_latin(raw_reply):
            messages_lat = list(messages)
            messages_lat.append(
                {
                    "role": "user",
                    "content": _retry_latin,
                }
            )
            _lat_temp = (
                (0.62 if not _is_proactive else 0.68)
                if not _free_tier
                else (0.48 if not _is_proactive else 0.55)
            )
            raw_reply = await cogni_chat_completion(
                messages_lat,
                model=model,
                max_tokens=_max_tokens,
                temperature=_lat_temp,
                frequency_penalty=_fp,
                presence_penalty=_pp,
                user_id=_bill_uid,
            )
            raw_reply = strip_internal_llm_markers(raw_reply)
            raw_reply = _maybe_jordanize_cogni_raw(raw_reply)

        hist = context.get("history") or []
        prior_assistants: list[str] = []
        if hist:
            for h in reversed(hist[-6:]):
                a = strip_internal_llm_markers(str(h.get("assistant", "") or "")).strip()
                if a:
                    prior_assistants.append(a)

        _retry_thresh = (
            float(os.getenv("COGNI_PROACTIVE_REPEAT_SIMILARITY_THRESHOLD", "0.72"))
            if _is_proactive
            else float(os.getenv("COGNI_REPEAT_SIMILARITY_THRESHOLD", "0.82"))
        )
        too_similar = False
        for prior in prior_assistants[:3]:
            if prior and should_rephrase_for_repetition(
                raw_reply, prior, threshold=_retry_thresh
            ):
                too_similar = True
                break
        if too_similar:
            messages_retry = list(messages)
            messages_retry.append(
                {
                    "role": "user",
                    "content": _retry_repeat,
                }
            )
            _retry_temp = (
                (0.62 if not _is_proactive else 0.68)
                if not _free_tier
                else (0.48 if not _is_proactive else 0.55)
            )
            raw_reply = await cogni_chat_completion(
                messages_retry,
                model=model,
                max_tokens=_max_tokens,
                temperature=_retry_temp,
                frequency_penalty=_fp,
                presence_penalty=_pp,
                user_id=_bill_uid,
            )
            raw_reply = strip_internal_llm_markers(raw_reply)
            raw_reply = _maybe_jordanize_cogni_raw(raw_reply)

        parsed_guard = parse_cogni_output(raw_reply)
        if _model_reply_off_topic_leisure(parsed_guard["dialogue"]):
            raw_reply = _CURRICULUM_REDIRECT_RAW

        _rm = context.setdefault("_reply_meta", {})
        _snap = context.get("tutorial_progress_snapshot")
        if "pedagogical_stage" not in _rm and isinstance(_snap, dict) and _snap.get("current_criterion"):
            from app.services.tutorial_session_bridge import criterion_to_pedagogical_stage

            _rm["pedagogical_stage"] = criterion_to_pedagogical_stage(str(_snap["current_criterion"]))
        if isinstance(_snap, dict) and _snap.get("unit_id"):
            _rm.setdefault("tutorial_unit_id", str(_snap["unit_id"]))

        _reset_llm_streak(str(context.get("session_id") or "http"))
        logger.info(
            "[cogni.tutor] _get_cogni_response done session_id=%s elapsed_sec=%.3f reply_len=%d",
            _sid,
            time.monotonic() - _tutor_t0,
            len(raw_reply or ""),
        )
        return raw_reply
    except Exception as e:
        if "OPENAI_TOKEN_RATE_LIMIT" in str(e):
            return (
                "وصلت لحد الاستخدام المسموح لهذه الدقيقة. جرّب بعد لحظة.\n"
                "*يهدأ بحركة بسيطة*\n[EMOTION: calm]"
            )
        return await _fallback_after_llm_error(context, e)

@router.post("/chat", response_model=ChatResponse)
async def chat_with_tutor(
    chat_request: ChatRequest,
    _: User = Depends(gate_llm_http_user),
):
    if not chat_request.message.strip():
        raise HTTPException(status_code=400, detail="Message empty")
    
    context = dict(chat_request.context)
    context.setdefault("session_id", str(context.get("client_id") or "http"))
    if chat_request.history:
        context["history"] = chat_request.history
        
    raw = await _get_cogni_response(chat_request.message, context)
    parsed = parse_cogni_output(raw)
    
    return ChatResponse(
        response=raw,
        reply=parsed["dialogue"],
        dialogue=parsed["dialogue"],
        action=parsed["action"],
        emotion=parsed["emotion"]
    )