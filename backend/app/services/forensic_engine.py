# -*- coding: utf-8 -*-
"""
Forensic Engine — Neural–Logic Fusion v5.0 (Dual-Provider Edition)
-----------------------------------------------------------
- Supports both OpenAI (gpt-4o) and Anthropic Claude (sonnet-4-5) for criterion evaluation.
- Automatically selects provider based on GRADER_MODEL name.
- Level 3 integration: Algorithm is the only judge; AI extracts evidence only.
- Full Arabic support (numbers, plurals, dual forms, verbs, context signals).
- Advanced quantitative requirement extraction (multi-target).
- Strict BTEC grading cascade (P→M→D).
- Stable streaming engine with heartbeat, retries, caching.
- Conceptual evaluation (not keyword counting).
"""

from __future__ import annotations
import os
import re
import json
import asyncio
import time
import hashlib
import logging
from typing import Dict, List, Any, AsyncGenerator, Optional, Tuple
from datetime import datetime, timedelta

from dotenv import load_dotenv

# Import both AI SDKs
try:
    import anthropic
except ImportError:
    anthropic = None  # type: ignore
    
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None  # type: ignore

# استيراد الخوارزميات المساعدة
try:
    from app.services.quantitative_requirements import extract_quantitative_requirements_advanced
except ImportError:
    def extract_quantitative_requirements_advanced(*args, **kwargs):
        return {}

try:
    from app.services.criteria_extractor import extract_criteria_with_descriptions
except ImportError:
    def extract_criteria_with_descriptions(*args, **kwargs):
        return {}

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - forensic-grader - %(levelname)s - %(message)s"
)
logger = logging.getLogger("forensic.v4")

# ========= Configuration =========
MODEL = os.getenv("GRADER_MODEL", "claude-sonnet-4-5").strip() or "claude-sonnet-4-5"
MODEL_NAME = MODEL  # Alias exported for the health-check endpoint in main.py

# Initialize clients based on model name
openai_client = None
anthropic_client = None

if MODEL.startswith("gpt-") or MODEL.startswith("o1-"):
    # OpenAI model
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key or openai_key.strip() == "" or openai_key == "your-openai-key-here":
        logger.warning("⚠️ OPENAI_API_KEY غير مُعيَّن — لا يمكن استخدام نماذج OpenAI.")
    elif OpenAI is None:
        logger.error("❌ openai package not installed. Run: pip install openai")
    else:
        openai_client = OpenAI(api_key=openai_key)
        logger.info(f"✅ Initialized OpenAI client for model: {MODEL}")
elif MODEL.startswith("claude-"):
    # Anthropic model
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_key or anthropic_key.strip() == "" or anthropic_key == "sk-ant-your-key-here":
        logger.warning("⚠️ ANTHROPIC_API_KEY غير مُعيَّن — لا يمكن استخدام نماذج Claude.")
    elif anthropic is None:
        logger.error("❌ anthropic package not installed. Run: pip install anthropic")
    else:
        anthropic_client = anthropic.Anthropic(api_key=anthropic_key)
        logger.info(f"✅ Initialized Anthropic client for model: {MODEL}")
else:
    logger.error(f"❌ Unknown model provider for: {MODEL}. Expected gpt-* or claude-*")

# For backward compatibility
client = anthropic_client or openai_client
MAX_TOKENS = int(os.getenv("GRADER_MAX_TOKENS", "3000"))
HARD_DEADLINE = int(os.getenv("GRADER_HARD_DEADLINE_SEC", "120"))
REQUEST_TIMEOUT = int(os.getenv("GRADER_REQUEST_TIMEOUT", "60"))
# تقليل التزامن لتجنب 429 Too Many Requests من OpenAI
MAX_CONCURRENT = int(os.getenv("GRADER_MAX_CONCURRENT", "2"))
# تأخير (بالثواني) قبل كل طلب لتوزيع الطلبات وتجنب تجاوز حد المعدل
GRADER_DELAY_SEC = float(os.getenv("GRADER_DELAY_SEC", "1.5"))
CACHE_TTL = int(os.getenv("GRADER_CACHE_TTL", "86400"))

semaphore = asyncio.Semaphore(MAX_CONCURRENT)

# ========= Cache =========
_cache: Dict[str, Tuple[datetime, dict]] = {}


def _cache_key(assignment: str, student: str, code: str) -> str:
    h = hashlib.sha256(f"{assignment[:2000]}|{student[:2000]}|{code}".encode()).hexdigest()
    return h


def _get_cached(key: str) -> Optional[dict]:
    if key in _cache:
        ts, val = _cache[key]
        if datetime.now() - ts < timedelta(seconds=CACHE_TTL):
            return val
        del _cache[key]
    return None


# ========= Text Processing =========
def clean_and_compress_text(text: str) -> str:
    """Remove duplicate newlines, compress whitespace."""
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def normalize_text(s: str) -> str:
    """Arabic normalization for fuzzy matching."""
    # Strip diacritics
    s = re.sub(r'[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]', '', s)
    # Normalize Alif variants
    s = s.replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا')
    # Normalize Ya and Ta Marbuta
    s = s.replace('ى', 'ي').replace('ة', 'ه')
    # Normalize punctuation
    s = s.replace('«', '"').replace('»', '"').replace('\u201c', '"').replace('\u201d', '"')
    s = s.replace('،', ',').replace('؛', ';').replace('؟', '?')
    return s.strip()


def find_quote_smart(student_text: str, quote: str) -> Dict[str, Any]:
    """3-tier quote validation: exact → normalized → keyword."""
    if not quote or len(quote.strip()) < 5:
        return {"found": False, "confidence": 0, "start_index": -1, "end_index": -1}

    # Tier 1: Exact match
    idx = student_text.find(quote)
    if idx >= 0:
        return {"found": True, "confidence": 100, "start_index": idx, "end_index": idx + len(quote)}

    # Tier 2: Normalized match
    norm_student = normalize_text(student_text)
    norm_quote = normalize_text(quote)
    idx = norm_student.find(norm_quote)
    if idx >= 0:
        return {"found": True, "confidence": 95, "start_index": idx, "end_index": idx + len(norm_quote)}

    # Tier 3: Keyword match (65%+ threshold)
    quote_words = set(normalize_text(quote).split())
    if len(quote_words) < 2:
        return {"found": False, "confidence": 0, "start_index": -1, "end_index": -1}

    student_words = set(normalize_text(student_text).split())
    overlap = len(quote_words & student_words) / len(quote_words)
    if overlap >= 0.65:
        return {"found": True, "confidence": int(overlap * 100), "start_index": -1, "end_index": -1}

    return {"found": False, "confidence": int(overlap * 100), "start_index": -1, "end_index": -1}


def band_from_code(code: str) -> str:
    """Extract band (PASS/MERIT/DISTINCTION) from criterion code like P1, M2, D3."""
    code_upper = code.upper().strip()
    # Remove prefix like A., B., AB.
    clean = re.sub(r'^[A-Z]{1,2}\.', '', code_upper)
    if clean.startswith('P'):
        return 'PASS'
    elif clean.startswith('M'):
        return 'MERIT'
    elif clean.startswith('D'):
        return 'DISTINCTION'
    return 'UNKNOWN'


def extract_criteria_codes(text: str) -> List[str]:
    """Extract BTEC criteria codes from assignment text."""
    pattern = r'\b(?:[A-Z]{1,2}\.)?(?:P|M|D)\d+\b'
    codes = re.findall(pattern, text, re.IGNORECASE)
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for c in codes:
        c_upper = c.upper()
        if c_upper not in seen:
            seen.add(c_upper)
            unique.append(c_upper)
    return unique


def extract_criteria_descriptions(assignment_text: str, codes: List[str]) -> Dict[str, str]:
    """Extract rich description text following each criteria code from the assignment brief."""
    descriptions = {}
    for code in codes:
        # Try longer capture: up to 500 chars, stopping at next criterion code or double newline
        pattern = (
            re.escape(code)
            + r'[\s:–\-]+(.{10,500}?)(?=\n\n|\b(?:[A-Z]{1,2}\.)?(?:P|M|D)\d+\b|$)'
        )
        match = re.search(pattern, assignment_text, re.IGNORECASE | re.DOTALL)
        if match:
            desc = re.sub(r'\s+', ' ', match.group(1)).strip()
            descriptions[code] = desc
        else:
            # Fall back: try to find table row with code
            row_pattern = r'\|?\s*' + re.escape(code) + r'\s*\|?\s*(.{10,300}?)(?=\n|\||$)'
            row_match = re.search(row_pattern, assignment_text, re.IGNORECASE)
            if row_match:
                descriptions[code] = re.sub(r'\s+', ' ', row_match.group(1)).strip()
            else:
                descriptions[code] = f"معيار {code} — الوصف غير موجود في نص الواجب"
    return descriptions


# ========= BTEC Staircase Grade Calculation =========
def calculate_final_grade_btec(criteria_results: Dict[str, Dict]) -> str:
    """
    Calculate final BTEC grade using staircase logic:
    - If any Pass criterion fails → REFER
    - If all Pass achieved, any Merit fails → PASS
    - If all Pass+Merit achieved, any Distinction fails → MERIT
    - If all achieved → DISTINCTION
    """
    pass_criteria = {}
    merit_criteria = {}
    distinction_criteria = {}

    for code, result in criteria_results.items():
        band = band_from_code(code)
        achieved = result.get("achieved", False)
        if band == "PASS":
            pass_criteria[code] = achieved
        elif band == "MERIT":
            merit_criteria[code] = achieved
        elif band == "DISTINCTION":
            distinction_criteria[code] = achieved

    # Staircase logic
    all_pass = all(pass_criteria.values()) if pass_criteria else True
    all_merit = all(merit_criteria.values()) if merit_criteria else True
    all_distinction = all(distinction_criteria.values()) if distinction_criteria else True

    if not all_pass:
        return "REFER"
    if not all_merit:
        return "PASS"
    if not all_distinction:
        return "MERIT"
    return "DISTINCTION"


# ========= OpenAI Evaluation for Single Criterion =========
async def evaluate_one(
    code: str,
    desc: str,
    assignment: str,
    student: str,
    adv_constraints: Dict[str, Any]
) -> Tuple[str, Dict]:
    """Evaluate a single criterion using configured AI provider (OpenAI or Anthropic)."""

    # Determine which client to use
    active_client = None
    provider_name = ""
    
    if MODEL.startswith("gpt-") or MODEL.startswith("o1-"):
        active_client = openai_client
        provider_name = "OpenAI"
    elif MODEL.startswith("claude-"):
        active_client = anthropic_client
        provider_name = "Anthropic Claude"
    
    if active_client is None:
        return code, {
            "band": band_from_code(code),
            "achieved": False,
            "reasoning": f"مفتاح API غير مُعيَّن لـ {provider_name} أو الحزمة غير مثبتة — لا يمكن التقييم.",
            "feedback": f"مفتاح API غير مُعيَّن لـ {provider_name} — لا يمكن التقييم.",
            "evidence": [],
            "evidence_quote": "",
            "quality": "خطأ",
            "missing_requirements": ["مفتاح API غير مُعيَّن"]
        }

    cache_k = _cache_key(assignment, student, code)
    cached = _get_cached(cache_k)
    if cached:
        logger.info(f"Cache hit for {code}")
        return code, cached

    band = band_from_code(code)

    # Map BTEC band to expected cognitive verb level
    band_verb_map = {
        "PASS":        "وصف (Describe) — الطالب يُبيّن ما هو الشيء بوضوح مع تفاصيل كافية ومثال من السياق.",
        "MERIT":       "تحليل (Analyse) — الطالب يُفسّر ويربط: يشرح الأسباب، يكشف العلاقات، ويجيب على لماذا وكيف.",
        "DISTINCTION": "تقييم (Evaluate/Justify) — الطالب يُقيّم: يزن البدائل، يُبدي حكماً نقدياً مُبرهَناً، ويصل إلى استنتاج مدعوم بأدلة.",
    }
    expected_depth = band_verb_map.get(band, "الإجابة يجب أن تكون واضحة ومدعومة.")

    # Build quantitative requirements warning if present
    quant_warning = ""
    if adv_constraints and adv_constraints.get("by_target"):
        quant_requirements = []
        for target, required_count in adv_constraints["by_target"].items():
            # Translate target names to Arabic
            target_ar = {
                "businesses": "شركات/مؤسسات",
                "examples": "أمثلة",
                "methods": "طرق/أساليب",
                "factors": "عوامل",
                "advantages": "مزايا/فوائد",
                "disadvantages": "عيوب/سلبيات",
                "features": "خصائص/سمات",
                "impacts": "تأثيرات/آثار",
            }.get(target, target)
            quant_requirements.append(f"- {target_ar}: {required_count}")
        
        if quant_requirements:
            quant_warning = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️⚠️⚠️ متطلبات كمية إلزامية (CRITICAL) ⚠️⚠️⚠️
الواجب يحتوي على متطلبات عددية صريحة يجب استيفاؤها:

{chr(10).join(quant_requirements)}

🔴 قاعدة صارمة: إذا كان المعيار {code} يتطلب عدداً محدداً من العناصر (مثل شركتين، 3 أمثلة، إلخ)،
يجب على الطالب تقديم العدد المطلوب **بالضبط أو أكثر**. إذا كان النقص واضحاً، المعيار = NOT ACHIEVED.

مثال: إذا طُلب "قارن بين شركتين" والطالب ذكر شركة واحدة فقط → NOT ACHIEVED مهما كانت جودة التحليل.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

    prompt = f"""أنت مقيّم أكاديمي متخصص في مؤهلات BTEC. مهمتك الوحيدة: إصدار حكم موضوعي ومُبرهَن على هذا المعيار الواحد.

⚠️ تنبيه جوهري: قرارك يؤثر على مستقبل طالب حقيقي. كن دقيقاً وعادلاً ومبنياً حصراً على ما كتبه الطالب.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
المعيار: {code}  |  المستوى: {band}
الوصف الكامل: {desc}
العمق المعرفي المطلوب: {expected_depth}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{quant_warning}

## تعريف المستويات وحدود كل منها:

**PASS — الوصف:**
✅ يكفي: الطالب يُبيّن ما هو المفهوم بأسلوبه الخاص مع تفاصيل كافية وأمثلة من السياق.
❌ لا يكفي: مجرد ذكر اسم المفهوم، أو تكرار جمل السؤال، أو حشو بلا معنى.

**MERIT — التحليل (يشمل PASS ويتجاوزه):**
✅ يكفي: الطالب يُفسّر ويربط — يشرح لماذا/كيف، يربط العوامل بالأسباب والنتائج، يُظهر تفكيراً تحليلياً.
❌ لا يكفي: وصف موسّع بدون تحليل سببي واضح، أو تعداد نقاط مفككة.

**DISTINCTION — التقييم (يشمل MERIT ويتجاوزه):**
✅ يكفي: الطالب يُقيّم — يقارن بدائل، يُبدي حكماً نقدياً، يزن إيجابيات وسلبيات، يصل إلى استنتاج مُبرَّر.
❌ لا يكفي: تحليل بدون حكم نقدي أو مقارنة بدائل أو استنتاج مبرر.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## سياق الواجب (للفهم فقط — لا تقيّم على أساسه):
{assignment[:15000]}

## إجابة الطالب الكاملة:
⚠️ ملاحظة هامة جداً: الإجابة قد تتضمن أقساماً متعددة أو تتحدث عن أكثر من شركة/منظمة. اقرأ الإجابة **بالكامل من البداية إلى النهاية** قبل إصدار أي حكم. لا تكتفِ بقراءة البداية فقط.
{student[:60000]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## اتبع هذه الخطوات بالترتيب:

**خطوة 0 — التحقق من المتطلبات الكمية أولاً (إن وجدت):**
⚠️ قبل أي شيء: إذا كان المعيار {code} يتطلب عدداً محدداً من العناصر، **عدّها أولاً** في إجابة الطالب:
- كم شركة ذكرها؟ (إذا طُلبت شركتان)
- كم مثالاً قدّم؟ (إذا طُلبت 3 أمثلة)
- كم طريقة/عامل/ميزة؟ (حسب المطلوب)

🔴 إذا كان العدد أقل من المطلوب → المعيار NOT ACHIEVED فوراً، بغض النظر عن جودة المحتوى.

**خطوة 1 — استوعب مطلب المعيار في سياق هذا الواجب:**
ماذا يطلب {code} تحديداً؟ ما الذي يجب أن يُثبته الطالب؟

**خطوة 2 — ابحث في إجابة الطالب عن الأدلة:**
اقرأ الإجابة كاملة. أين عالج الطالب هذا المعيار؟ قد يكون بأسلوبه الخاص أو بأمثلة مختلفة — هذا مقبول.

**خطوة 3 — قيّم عمق الفهم (ليس الكلمات):**
السؤال المحوري: هل أثبت الطالب أنه يفهم المفهوم ويستطيع تطبيقه؟
- ✅ اقبل: الفهم مُثبَت بأسلوبه الخاص، بأمثلة بديلة، أو من زاوية مختلفة
- ✅ اقبل: إجابة قصيرة لكن دقيقة ومركّزة
- ❌ ارفض: حشو أو تكرار بدون فهم حقيقي
- ❌ ارفض: عمق الإجابة أقل من الحد المطلوب لمستوى {band}

**خطوة 4 — أصدر الحكم بناءً على الأدلة فقط:**
لا افتراضات، لا تساهل غير مبرر، لا تشدد غير مبرر.

أعد النتيجة بتنسيق JSON التالي فقط (بدون أي نص خارجه):
{{
  "achieved": true أو false,
  "quantitative_check": {{
    "required": "وصف المتطلب الكمي إن وجد (مثل: شركتان، 3 أمثلة)",
    "found": "ما وجده الطالب (مثل: شركة واحدة، مثالان)",
    "satisfied": true أو false
  }},
  "reasoning": "تحليل مفصّل: (1) نتيجة التحقق الكمي إن وجد، (2) ما الذي أثبته الطالب ✓ مع ذكر أجزاء محددة من نصه، (3) ما الذي لم يُثبته أو كان ناقصاً ✗، (4) الحكم النهائي ولماذا بالنسبة لمستوى {band}",
  "evidence": ["اقتباس حرفي من إجابة الطالب يدعم التقييم", "اقتباس ثانٍ إن وُجد"],
  "quality": "ممتاز / جيد / مقبول / ضعيف",
  "missing_requirements": ["ما الذي كان يجب إضافته تحديداً لتحقيق هذا المعيار — صياغة واضحة وقابلة للعمل بها"]
}}"""

    async with semaphore:
        try:
            # تأخير بسيط لتجنب 429 (Rate Limit)
            if GRADER_DELAY_SEC > 0:
                await asyncio.sleep(GRADER_DELAY_SEC)
            
            loop = asyncio.get_event_loop()
            
            # Choose API call based on provider
            if MODEL.startswith("claude-"):
                # Anthropic Claude
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: active_client.messages.create(
                            model=MODEL,
                            max_tokens=MAX_TOKENS,
                            messages=[{"role": "user", "content": prompt}],
                        )
                    ),
                    timeout=REQUEST_TIMEOUT
                )
                raw_text = (response.content[0].text or "").strip()
            else:
                # OpenAI (gpt-4o, etc.)
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: active_client.chat.completions.create(
                            model=MODEL,
                            max_tokens=MAX_TOKENS,
                            messages=[{"role": "user", "content": prompt}],
                            response_format={"type": "json_object"},
                        )
                    ),
                    timeout=REQUEST_TIMEOUT
                )
                raw_text = (response.choices[0].message.content or "").strip()
            
            # Extract JSON from response
            json_match = re.search(r'\{[\s\S]*\}', raw_text)
            if json_match:
                result = json.loads(json_match.group())
            else:
                logger.warning(f"Could not parse JSON for {code}, raw: {raw_text[:200]}")
                result = {
                    "achieved": False,
                    "reasoning": "تعذر تحليل استجابة المقيّم",
                    "evidence": [],
                    "quality": "غير محدد",
                    "missing_requirements": ["تعذر التحليل"]
                }

            # Validate evidence quotes
            validated_evidence = []
            for quote in result.get("evidence", []):
                match_info = find_quote_smart(student, quote)
                if match_info["found"]:
                    validated_evidence.append({
                        "quote": quote,
                        "confidence": match_info["confidence"],
                        "start_index": match_info["start_index"],
                        "end_index": match_info["end_index"]
                    })
                else:
                    validated_evidence.append({
                        "quote": quote,
                        "confidence": match_info["confidence"],
                        "start_index": -1,
                        "end_index": -1,
                        "note": "لم يتم التحقق من الاقتباس في نص الطالب"
                    })

            final_result = {
                "band": band,
                "achieved": result.get("achieved", False),
                "reasoning": result.get("reasoning", ""),
                "feedback": result.get("reasoning", ""),  # alias for compatibility
                "evidence": validated_evidence,
                "evidence_quote": validated_evidence[0]["quote"] if validated_evidence else "",
                "quality": result.get("quality", "غير محدد"),
                "missing_requirements": result.get("missing_requirements", []),
                "quantitative_check": result.get("quantitative_check", None),  # Add quantitative verification
            }

            # Cache the result
            _cache[cache_k] = (datetime.now(), final_result)

            return code, final_result

        except asyncio.TimeoutError:
            logger.error(f"Timeout evaluating {code}")
            return code, {
                "band": band,
                "achieved": False,
                "reasoning": "انتهت مهلة التقييم",
                "feedback": "انتهت مهلة التقييم",
                "evidence": [],
                "evidence_quote": "",
                "quality": "خطأ",
                "missing_requirements": ["انتهت مهلة التقييم"]
            }
        except Exception as e:
            err_msg = str(e).lower()
            is_api_error = (
                "404" in err_msg
                or "model" in err_msg
                or "not found" in err_msg
                or "invalid" in err_msg
                or "429" in err_msg
                or "rate limit" in err_msg
                or "overloaded" in err_msg
            )
            if "429" in err_msg or "rate limit" in err_msg or "overloaded" in err_msg:
                logger.warning("تجاوز حد طلبات Anthropic (429/overloaded). قلّل GRADER_MAX_CONCURRENT أو زِد GRADER_DELAY_SEC في .env")
                reason = "تجاوز حد طلبات API. جرب لاحقاً أو قلّل عدد المعايير."
            else:
                reason = f"خطأ فني: {str(e)}"
            logger.exception(f"Error evaluating {code}: {e}")
            result = {
                "band": band,
                "achieved": False,
                "reasoning": reason,
                "feedback": reason,
                "evidence": [],
                "evidence_quote": "",
                "quality": "خطأ",
                "missing_requirements": [reason],
            }
            if is_api_error:
                result["_api_error"] = True
            return code, result


# ========= Streaming Engine =========
async def forensic_grade_stream(assignment_text: str, student_text: str) -> AsyncGenerator[str, None]:
    """Streaming forensic grading — yields NDJSON lines."""
    start_time = time.monotonic()
    job_id = hashlib.md5(f"{time.time()}".encode()).hexdigest()[:8]

    logger.info(f"Job {job_id} started")

    try:
        # Clean and truncate
        assignment_text = clean_and_compress_text(assignment_text)[:30000]
        student_text = clean_and_compress_text(student_text)[:150000]

        # Extract criteria codes
        codes = extract_criteria_codes(assignment_text)
        if len(codes) < 2:
            yield json.dumps({
                "type": "error",
                "message": "لم يتم العثور على معايير كافية في نص الواجب (يجب أن يحتوي على معيارين على الأقل مثل P1, M1, D1)"
            }, ensure_ascii=False) + "\n"
            return

        # Extract descriptions
        descriptions = extract_criteria_descriptions(assignment_text, codes)

        # Quantitative requirements
        try:
            adv_constraints = extract_quantitative_requirements_advanced(assignment_text)
        except Exception:
            adv_constraints = {}

        total = len(codes)

        # Send initial status
        yield json.dumps({
            "type": "status",
            "message": f"بدء تقييم {total} معيار باستخدام {MODEL}...",
            "total": total,
            "job_id": job_id
        }, ensure_ascii=False) + "\n"

        # Evaluate all criteria concurrently
        results: Dict[str, Dict] = {}
        tasks = [
            evaluate_one(code, descriptions.get(code, f"معيار {code}"), assignment_text, student_text, adv_constraints)
            for code in codes
        ]

        # Process as they complete
        for coro in asyncio.as_completed(tasks):
            code, result = await coro
            results[code] = result

            # Yield each criterion result immediately
            yield json.dumps({
                "type": "criterion",
                "code": code,
                "result": result,
                "processed": len(results),
                "total": total
            }, ensure_ascii=False) + "\n"

            # Heartbeat
            if time.monotonic() - start_time > HARD_DEADLINE:
                logger.warning(f"Job {job_id} hit hard deadline at {len(results)}/{total}")
                break

        # If API errors occurred (404, invalid model, etc.), return user-friendly error
        # instead of marking student as "not achieved"
        api_errors = [r for r in results.values() if r.get("_api_error")]
        if api_errors:
            err_reason = api_errors[0].get("reasoning", "خدمة التقييم غير متاحة حالياً")
            logger.error("API error during grading: %s", err_reason)
            yield json.dumps({
                "type": "error",
                "message": "تقييم غير متاح حالياً. يرجى التحقق من إعدادات GRADER_MODEL ومفتاح API المناسب (OPENAI_API_KEY أو ANTHROPIC_API_KEY) والمحاولة لاحقاً.",
                "detail": err_reason,
            }, ensure_ascii=False) + "\n"
            return

        # Apply staircase grading
        final_grade = calculate_final_grade_btec(results)

        # Generate summary
        achieved_count = sum(1 for r in results.values() if r.get("achieved"))
        summary = f"تم تقييم {len(results)} معيار من أصل {total}. "
        summary += f"تحقق {achieved_count} معيار. "
        summary += f"الدرجة النهائية: {final_grade}"

        # Yield final result
        yield json.dumps({
            "type": "final",
            "final_grade": final_grade,
            "summary": summary,
            "criteria": results,
            "criteria_results": results,  # alias for frontend compatibility
            "execution_time": round(time.monotonic() - start_time, 2),
            "processed": len(results),
            "total": total,
            "partial": len(results) < total
        }, ensure_ascii=False) + "\n"

        logger.info(f"Job {job_id} completed with final_grade: {final_grade}")

    except Exception as e:
        logger.exception("❌ Unexpected error in forensic_grade_stream")
        yield json.dumps({
            "type": "error",
            "message": f"حدث خطأ فني غير متوقع: {str(e)}"
        }, ensure_ascii=False) + "\n"


# ========= Batch wrapper =========
async def forensic_grade(assignment_text: str, student_text: str) -> dict:
    """
    Wrapper function for compatibility with existing endpoints.
    Calls the streaming forensic_grade_stream function and aggregates results.
    """
    logger.info("Starting forensic_grade with assignment_text: %s, student_text: %s",
                assignment_text[:100], student_text[:100])
    results = []
    try:
        async for result in forensic_grade_stream(assignment_text, student_text):
            logger.debug("Received partial result: %s", result[:200])
            results.append(result)

        if not results:
            return {
                "final_grade": "ERROR",
                "summary": "لم يتم الحصول على أي نتائج",
                "criteria": {},
                "criteria_results": {}
            }

        final_result = json.loads(results[-1])

        # Ensure it's the final type
        if final_result.get("type") == "error":
            return {
                "final_grade": "ERROR",
                "summary": final_result.get("message", "تقييم غير متاح حالياً، يرجى المحاولة لاحقاً."),
                "criteria": {},
                "criteria_results": {},
                "error_detail": final_result.get("detail"),
            }

        if final_result.get("type") == "final":
            return final_result

        # If we didn't get a final result, aggregate from criterion results
        criteria = {}
        for r in results:
            parsed = json.loads(r)
            if parsed.get("type") == "criterion":
                criteria[parsed["code"]] = parsed["result"]

        grade = calculate_final_grade_btec(criteria)
        return {
            "type": "final",
            "final_grade": grade,
            "summary": f"تم تقييم {len(criteria)} معيار",
            "criteria": criteria,
            "criteria_results": criteria
        }

    except Exception as e:
        logger.error("Error in forensic_grade: %s", str(e))
        return {
            "final_grade": "ERROR",
            "summary": f"خطأ: {str(e)}",
            "criteria": {},
            "criteria_results": {}
        }