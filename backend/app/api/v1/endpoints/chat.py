# -*- coding: utf-8 -*-
"""
Chat endpoint: POST /api/v1/chat
Uses Dr. Hamza persona — A-Agent V200 (BTEC Adaptive Teacher).
Accepts { "message", "history" } and returns { "reply", "dialogue", "action", "emotion", "intent" }.
"""
from __future__ import annotations
import asyncio
import re
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.v1.endpoints.tutor import _get_dr_hamza_response
from app.services.forensic_engine import forensic_grade

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response schemas ────────────────────────────────────────────────

class HistoryEntry(BaseModel):
    user: str = ""
    assistant: str = ""


class SimpleChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: Optional[List[HistoryEntry]] = Field(default_factory=list)


class SimpleChatResponse(BaseModel):
    reply   : str   # full 3-line reply
    dialogue: str   # spoken text (line 1)
    action  : str   # gesture text without asterisks (line 2)
    emotion : str   # blendshape tag (line 3)
    intent  : str   # locally classified intent
    ok      : bool  = True
    error   : Optional[str] = None
    degraded: bool  = False


class EvaluationRequest(BaseModel):
    assignment: str = Field(..., min_length=10, description="نص التكليف/الواجب")
    submission: str = Field(..., min_length=10, description="نص إجابة الطالب")
    student_id: Optional[str] = Field(None, description="معرف الطالب (اختياري للذاكرة الطولية)")


class VeronaEvaluationResponse(BaseModel):
    status      : str   # "success" | "error"
    raw_nexus   : dict  # نتيجة محرك NEXUS الخام
    verona_reply: str   # الرد الثلاثي الأجزاء (فيرونا)
    dialogue    : str   # النص المنطوق فقط
    action      : str   # الحركة فقط (بدون نجوم)
    emotion     : str   # الوسم العاطفي


# ── Allowed emotion tags ──────────────────────────────────────────────────────

ALLOWED_EMOTIONS = {'neutral', 'friendly', 'thinking', 'encouraging', 'strict', 'celebrate'}


# ── BTEC Mock DB (Distinction Roadmap) ───────────────────────────────────────

BTEC_MOCK_DB: dict[str, dict] = {
    "unit1": {
        "name": "Business Dynamics",
        "distinction_tips": [
            "قدّم تحليلاً نقدياً مقارناً بين نماذج الأعمال (مثل Sole Trader مقابل PLC) مع أدلة إحصائية محددة.",
            "ربط كل معيار بسياق محلي أردني أو خليجي معاصر (مثل شركة أرامكو أو زين) يُظهر عمق الفهم التطبيقي.",
            "استخدم تحليل SWOT كاملاً مع استنتاجات استراتيجية مترابطة لا مجرد سرد النقاط.",
        ],
    },
    "unit3": {
        "name": "Personal and Business Finance",
        "distinction_tips": [
            "حلّل البيانات المالية (P&L, Balance Sheet) بمنهجية التحليل الأفقي والعمودي مع تفسير الاتجاهات.",
            "اربط قرارات التمويل بمؤشرات الربحية (Return on Capital) وأثرها على أصحاب المصلحة.",
            "أظهر وعياً بمخاطر الائتمان والتدفق النقدي وكيفية إدارتها — هذا ما يُميّز بين Merit وDistinction.",
        ],
    },
}


def get_distinction_roadmap(unit_id: str) -> list[str]:
    """Returns Distinction tips for the given unit, or generic tips if unit not found."""
    unit = BTEC_MOCK_DB.get(unit_id.lower(), None)
    if unit:
        return unit["distinction_tips"]
    # Generic Distinction roadmap when unit not matched
    return [
        "اعتمد على الأدلة والإحصاءات الموثوقة، وليس المعلومات العامة فقط.",
        "اربط كل نقطة بمعيار BTEC محدد وأظهر كيف تجاوزت المتطلبات الدنيا.",
        "قدّم تقييماً نقدياً يشمل السلبيات والإيجابيات بدلاً من الوصف الأحادي الجانب.",
    ]


# ── Intent classifier (local, zero-cost) ─────────────────────────────────────

_INTENT_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\b(btec|p[123]|m[123]|d[123]|distinction|merit|pass|lo\d|criteria|criterion|unit\s*\d)\b', re.I), 'btec_question'),
    (re.compile(r'\b(\u0645\u0639\u064a\u0627\u0631|\u0645\u0639\u0627\u064a\u064a\u0631|\u062a\u0645\u064a\u064a\u0632|\u062c\u062f\u0627\u0631\u0629|\u0646\u062c\u0627\u062d|\u0648\u062d\u062f\u0629|\u0628\u064a\u062a\u064a\u0633\u064a|\u062a\u0643\u0644\u064a\u0641)\b', re.I), 'btec_question'),
    (re.compile(r'\b(\u0644\u0645\u0627\u0630\u0627|\u0643\u064a\u0641|\u0645\u0627 \u0647\u0648|\u0645\u0627 \u0647\u064a|\u0627\u0634\u0631\u062d|what|why|how|when|who|explain|define)\b', re.I), 'general_question'),
    (re.compile(r'\b(\u0627\u0631\u064a\u062f|\u0623\u0631\u064a\u062f|\u0645\u0645\u0643\u0646|please|\u0628\u062f\u064a|\u0633\u0627\u0639\u062f\u0646\u064a|\u0623\u062d\u062a\u0627\u062c|help me|can you|give me)\b', re.I), 'request'),
    (re.compile(r'\b(\u0645\u0634 \u0641\u0627\u0647\u0645|\u0645\u0627 \u0641\u0647\u0645\u062a|confused|lost|\u0644\u0627 \u0623\u0641\u0647\u0645|\u0634\u0648 \u064a\u0639\u0646\u064a|i don.t get)\b', re.I), 'confusion'),
    (re.compile(r'\b(\u0634\u0643\u0631|\u064a\u0633\u0644\u0645\u0648\u0627|\u064a\u0633\u0644\u0645|thanks|thank you|\u0645\u0645\u062a\u0627\u0632|\u0628\u0631\u0627\u0641\u0648|\u0631\u0627\u0626\u0639|awesome)\b', re.I), 'gratitude'),
    (re.compile(r'\b(\u0645\u0631\u062d\u0628\u0627|\u0623\u0647\u0644\u0627|hi|hello|hey|\u0643\u064a\u0641\u0643|\u0634\u0648 \u0627\u062e\u0628\u0627\u0631\u0643)\b', re.I), 'greeting'),
    (re.compile(r'\b(\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629|\u0628\u0627\u064a|bye|goodbye|\u064a\u0644\u0627 \u0648\u062f\u0627\u0639)\b', re.I), 'farewell'),
]

_DISTINCTION_RE = re.compile(
    r'\b(distinction|تميز|امتياز|مميز|d\d+|وحدة\s*\d+|unit\s*\d+)\b', re.I | re.UNICODE
)

def _extract_unit_id(text: str) -> str:
    """Extract unit identifier from message text (e.g. 'unit1', 'unit3', 'وحدة 3')."""
    m = re.search(r'\b(?:unit|وحدة)\s*(\d+)\b', text, re.I | re.UNICODE)
    return f"unit{m.group(1)}" if m else "unknown"

def _classify_intent(text: str) -> str:
    if _DISTINCTION_RE.search(text):
        return 'distinction_request'
    for pattern, intent in _INTENT_RULES:
        if pattern.search(text):
            return intent
    return 'idle'


# ── Emotion fallback keywords ─────────────────────────────────────────────────

_EMOTION_KEYWORDS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\u0645\u0628\u0631\u0648\u0643|\u0645\u0645\u062a\u0627\u0632|\u0631\u0627\u0626\u0639|\u0623\u062d\u0633\u0646\u062a|\u0628\u0631\u0627\u0641\u0648|\U0001f389', re.I), 'celebrate'),
    (re.compile(r'\u064a\u0644\u0627|\u0647\u0645\u0629|\u062a\u0642\u062f\u0631|\u062b\u0642\u062a\u064a \u0641\u064a\u0643|\u062c\u0631\u0628|\u0646\u0628\u0644\u0634',   re.I), 'encouraging'),
    (re.compile(r'\u0641\u0643\u0631|\u0627\u0634\u0631\u062d|\u064a\u0639\u0646\u064a|\u062e\u0644\u064a\u0646\u064a|\u062f\u0642\u064a\u0642\u0629|\u0628\u0641\u0647\u0645',    re.I), 'thinking'),
    (re.compile(r'\u062a\u0646\u0628\u0647|\u0644\u0627\u0632\u0645|\u0645\u0647\u0645|\u0631\u0643\u0632|\u0636\u0631\u0648\u0631\u064a',           re.I), 'strict'),
    (re.compile(r'\u0623\u0647\u0644\u064a\u0646|\u0643\u064a\u0641\u0643|\u0634\u0648 \u0627\u062e\u0628\u0627\u0631\u0643|\u062d\u064a\u0627\u0643|\u0623\u0647\u0644\u0627\u064b',   re.I), 'friendly'),
]

_ACTION_DEFAULTS: dict[str, str] = {
    'celebrate':   '\u064a\u0644\u0648\u062d \u0628\u064a\u062f\u064a\u0647 \u0628\u062d\u0645\u0627\u0633 \u0648\u064a\u0628\u062a\u0633\u0645 \u0627\u0628\u062a\u0633\u0627\u0645\u0629 \u0639\u0631\u064a\u0636\u0629',
    'encouraging': '\u064a\u0641\u062a\u062d \u0643\u0641\u064a\u0647 \u0628\u0644\u0637\u0641 \u0648\u064a\u062d\u0631\u0651\u0643 \u0630\u0631\u0627\u0639\u064a\u0647 \u0644\u0644\u0623\u0645\u0627\u0645',
    'thinking':    '\u064a\u0645\u064a\u0644 \u0631\u0623\u0633\u0647 \u0642\u0644\u064a\u0644\u0627\u064b \u0648\u0639\u064a\u0646\u0627\u0647 \u062a\u062a\u0623\u0645\u0644\u0627\u0646',
    'strict':      '\u064a\u0634\u064a\u0631 \u0628\u0625\u0635\u0628\u0639\u0647 \u0628\u062b\u0642\u0629 \u0648\u064a\u0646\u0638\u0631 \u0644\u0644\u0623\u0645\u0627\u0645 \u0645\u0628\u0627\u0634\u0631\u0629',
    'friendly':    '\u064a\u0628\u062a\u0633\u0645 \u0628\u0644\u0637\u0641 \u0648\u064a\u0645\u064a\u0644 \u0631\u0623\u0633\u0647 \u0642\u0644\u064a\u0644\u0627\u064b',
    'neutral':     '\u064a\u0648\u0645\u0626 \u0628\u0631\u0623\u0633\u0647 \u0628\u0631\u0641\u0642',
}


# ── Format helpers ────────────────────────────────────────────────────────────

def _verify_format(text: str) -> bool:
    return (
        bool(re.search(r'\*[^*]+\*', text)) and
        bool(re.search(r'\[EMOTION:\s*\w+\]', text))
    )


def _infer_emotion(text: str) -> str:
    for pattern, emotion in _EMOTION_KEYWORDS:
        if pattern.search(text):
            return emotion
    return 'friendly'


def _patch_format(text: str) -> str:
    """Ensures the reply has *action* and [EMOTION: tag].

    When no *action* is found the model likely emitted a bare action line
    (no asterisks).  Per the 3-part contract that line is always the last
    non-empty line before [EMOTION:].  We extract it, wrap it in *...*,
    and exclude it from the dialogue instead of appending a generic default
    alongside it (which caused the bare text to leak into the chat UI).
    """
    has_action    = bool(re.search(r'\*[^*]+\*', text))
    emotion_match = re.search(r'\[EMOTION:\s*(\w+)\]', text)
    emotion       = emotion_match.group(1).lower() if emotion_match else _infer_emotion(text)
    if emotion not in ALLOWED_EMOTIONS:
        emotion = 'friendly'
    cleaned = re.sub(r'\s*\[EMOTION:\s*\w+\]', '', text).rstrip()
    if not has_action:
        # The last non-empty line is the bare action line — extract & wrap it.
        lines = [l.strip() for l in cleaned.splitlines() if l.strip()]
        if len(lines) >= 2:
            bare_action = lines.pop()   # remove from dialogue content
            cleaned = '\n'.join(lines)
        else:
            bare_action = _ACTION_DEFAULTS.get(emotion, _ACTION_DEFAULTS['neutral'])
        cleaned += f'\n*{bare_action}*'
    return cleaned + f'\n[EMOTION: {emotion}]'


def _parse_reply(text: str) -> dict:
    """Splits 3-line reply into dialogue, action, and emotion."""
    action_m  = re.search(r'\*([^*]+)\*', text)
    emotion_m = re.search(r'\[EMOTION:\s*(\w+)\]', text)
    action    = action_m.group(1).strip()  if action_m  else _ACTION_DEFAULTS['neutral']
    emotion   = emotion_m.group(1).lower() if emotion_m else 'friendly'
    if emotion not in ALLOWED_EMOTIONS:
        emotion = 'friendly'
    dialogue  = re.sub(r'\*[^*]+\*', '', text)
    dialogue  = re.sub(r'\[EMOTION:\s*\w+\]', '', dialogue).strip()
    return {'dialogue': dialogue, 'action': action, 'emotion': emotion}


# ── Verona Bridge: NEXUS → 3-part reply ────────────────────────────────────────

def format_verona_response(nexus_data: dict) -> str:
    """
    محوّل البيانات من محرك الاستدلال NEXUS إلى شخصية فيرونا.
    جدول الخمسة صفوف (بترتيب الأولوية):
      1. DISTINCTION أو longitudinal_improvement  → celebrate
      2. confidence < 0.7                         → thinking
      3. MERIT أو PASS                            → friendly
      4. REFER أو FAIL                            → encouraging
      5. افتراضي                                  → neutral
    """
    final_grade  = str(nexus_data.get("final_grade", "")).upper()
    is_improved  = bool(nexus_data.get("longitudinal_improvement", False))
    confidence   = float(nexus_data.get("confidence", 1.0))

    reasoning = (
        nexus_data.get("reasoning")
        or nexus_data.get("summary")
        or "لم يتم العثور على تبرير محدد."
    )

    # ── Row 1: Distinction / improvement ─────────────────────────────────────
    if is_improved or final_grade == "DISTINCTION":
        emotion  = "[EMOTION: celebrate]"
        action   = "*تصفق بخفة وتبتسم بفخر، مشيرةً إلى الشاشة باعتزاز*"
        dialogue = f"ما شاء الله، {reasoning}" if is_improved else f"تميّز حقيقي! {reasoning}"

    # ── Row 2: Low confidence → needs careful analysis ────────────────────────
    elif confidence < 0.7:
        emotion  = "[EMOTION: thinking]"
        action   = "*تضع يدها على ذقنها وتتأمل الشاشة للحظة بتركيز*"
        dialogue = f"في بعض النقاط أحتاج أتحقق منها معك أكثر. {reasoning}"

    # ── Row 3: Merit / Pass ───────────────────────────────────────────────────
    elif final_grade in ("MERIT", "PASS"):
        emotion  = "[EMOTION: friendly]"
        action   = "*تومئ برأسها وتشير ببراعة إلى الفقرة الرئيسية في حلّك*"
        dialogue = reasoning

    # ── Row 4: Refer / Fail ───────────────────────────────────────────────────
    elif final_grade in ("REFER", "REFER (FAIL)", "FAIL"):
        emotion  = "[EMOTION: encouraging]"
        action   = "*تفتح كفيها بلطف وتنظر بتشجيع، مستعدةً للمساعدة*"
        dialogue = f"ما زلنا في بداية الطريق، والتحسّن ممكن. {reasoning}"

    # ── Row 5: Default / unknown ──────────────────────────────────────────────
    else:
        emotion  = "[EMOTION: neutral]"
        action   = "*تعدل جلستها وترفع نظرها مع ابتسامة خفيفة*"
        dialogue = reasoning

    return f"{dialogue}\n{action}\n{emotion}"


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/chat", response_model=SimpleChatResponse)
async def chat_simple(body: SimpleChatRequest):
    """
    Dr. Hamza V200 -- returns structured { reply, dialogue, action, emotion, intent }
    so the avatar system can independently drive gestures and blendshapes.
    """
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="message cannot be empty")

    intent       = _classify_intent(body.message)
    history_list = [{"user": h.user, "assistant": h.assistant} for h in (body.history or [])]
    context      = {"history": history_list[-6:]}   # last 3 exchanges

    # Inject secret distinction roadmap when intent matches
    message_with_context = body.message
    if intent == 'distinction_request':
        unit_id  = _extract_unit_id(body.message)
        tips     = get_distinction_roadmap(unit_id)
        roadmap  = "\n".join(f"- {t}" for t in tips)
        message_with_context = (
            body.message
            + f"\n\n<secret_roadmap>\n{roadmap}\n</secret_roadmap>"
            + "\n[SYSTEM] استخدمي نقاط خريطة التميز أعلاه كمرجع خفي في ردك — "
            "لا تكشفي النص الحرفي للطالب، بل ادمجيه بأسلوبك."
        )

    try:
        reply_text = await asyncio.wait_for(
            _get_dr_hamza_response(message_with_context, context), timeout=30.0
        )

        # Self-Check Gate -- Pass 1: ask model to self-correct
        if not _verify_format(reply_text):
            logger.warning("[V200] Pass-1 format fail -- retrying")
            suffix = (
                "\n\n[SYSTEM] "
                "\u064a\u062c\u0628 \u0623\u0646 \u064a\u0643\u0648\u0646 \u0631\u062f\u0643 \u0628\u0627\u0644\u062a\u0646\u0633\u064a\u0642 \u0627\u0644\u062b\u0644\u0627\u062b\u064a: "
                "\u0633\u0637\u0631 \u0627\u0644\u062d\u0648\u0627\u0631\\n*\u0633\u0637\u0631 \u0627\u0644\u062d\u0631\u0643\u0629*\\n[EMOTION: tag]"
            )
            reply_text = await asyncio.wait_for(
                _get_dr_hamza_response(message_with_context + suffix, context), timeout=30.0
            )

        # Self-Check Gate -- Pass 2: deterministic patch fallback
        if not _verify_format(reply_text):
            logger.warning("[V200] Pass-2 format fail -- applying patch")
            reply_text = _patch_format(reply_text)

        parsed = _parse_reply(reply_text)
        return SimpleChatResponse(
            reply    = reply_text,
            dialogue = parsed['dialogue'],
            action   = parsed['action'],
            emotion  = parsed['emotion'],
            intent   = intent,
        )

    except asyncio.TimeoutError:
        logger.error("[V200] chat timeout after 30s")
        _deg = (
            "\u0623\u0646\u0627 \u0645\u0648\u062c\u0648\u062f! \u0628\u0633 \u0627\u0644\u0631\u062f \u062a\u0623\u062e\u0631 \u0647\u0644\u0623. \u062c\u0627\u0648\u0628\u0643 \u0628\u0639\u062f \u062b\u0627\u0646\u064a\u0629.\n"
            "*\u064a\u0628\u062a\u0633\u0645 \u0628\u0635\u0628\u0631*\n[EMOTION: friendly]"
        )
        _p = _parse_reply(_deg)
        return SimpleChatResponse(
            reply=_deg, dialogue=_p['dialogue'], action=_p['action'],
            emotion=_p['emotion'], intent=intent,
            ok=False, error='TIMEOUT', degraded=True,
        )
    except Exception as e:
        err_str = str(e)
        is_rate = '429' in err_str or 'quota' in err_str.lower() or 'rate_limit' in err_str.lower()
        logger.exception("[V200] chat error: %s", e)
        _deg = (
            "\u0623\u0646\u0627 \u0645\u0648\u062c\u0648\u062f! \u0628\u0633 \u062e\u062f\u0645\u0629 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a \u0645\u0634\u063a\u0648\u0644\u0629 \u0647\u0644\u0623. \u062c\u0627\u0648\u0628\u0643 \u0628\u0639\u062f \u0644\u062d\u0638\u0629.\n"
            "*\u064a\u0628\u062a\u0633\u0645 \u0628\u0647\u062f\u0648\u0621*\n[EMOTION: friendly]"
        )
        _p = _parse_reply(_deg)
        return SimpleChatResponse(
            reply=_deg, dialogue=_p['dialogue'], action=_p['action'],
            emotion=_p['emotion'], intent=intent,
            ok=False,
            error='OPENAI_RATE_LIMIT' if is_rate else 'OPENAI_ERROR',
            degraded=True,
        )


@router.post("/evaluate-and-speak", response_model=VeronaEvaluationResponse)
async def evaluate_and_speak(payload: EvaluationRequest):
    """
    يشغّل محرك NEXUS للتحقيق الجنائي في إجابة الطالب ثم يُحوّل النتيجة
    إلى رد فيرونا الثلاثي الأجزاء (حوار | حركة | وسم عاطفة).

    POST /api/v1/evaluate-and-speak
    Body: { "assignment": "...", "submission": "...", "student_id": "..." }
    """
    if not payload.assignment.strip() or not payload.submission.strip():
        raise HTTPException(
            status_code=400,
            detail="assignment و submission مطلوبان ولا يمكن أن يكونا فارغَين"
        )

    try:
        # 1. تشغيل محرك NEXUS الجنائي (30s timeout)
        nexus_result = await asyncio.wait_for(
            forensic_grade(payload.assignment, payload.submission), timeout=30.0
        )

        # 2. تحويل نتائج NEXUS إلى لغة فيرونا الثلاثية
        verona_reply = format_verona_response(nexus_result)

        # 3. تحليل الرد للواجهة الأمامية
        parsed = _parse_reply(verona_reply)

        return VeronaEvaluationResponse(
            status       = "success",
            raw_nexus    = nexus_result,
            verona_reply = verona_reply,
            dialogue     = parsed["dialogue"],
            action       = parsed["action"],
            emotion      = parsed["emotion"],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[Verona] evaluate-and-speak error: %s", e)
        raise HTTPException(
            status_code=500,
            detail="فشل في تقييم الإجابة. يرجى التحقق من صحة النصوص والمحاولة لاحقاً."
        )
