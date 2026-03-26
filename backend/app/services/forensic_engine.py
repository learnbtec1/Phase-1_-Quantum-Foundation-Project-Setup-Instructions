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

try:
    from app.services.calibration_store import get_calibration_block
except ImportError:
    def get_calibration_block(band: str) -> str:  # type: ignore[misc]
        return ""

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
    # Anthropic model — accept both ANTHROPIC_API_KEY and ANTHROPIC_KEY
    anthropic_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_KEY")
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
# Max retry attempts on rate-limit / transient errors
GRADER_MAX_RETRIES = int(os.getenv("GRADER_MAX_RETRIES", "3"))

semaphore = asyncio.Semaphore(MAX_CONCURRENT)

# ========= Cache =========
_cache: Dict[str, Tuple[datetime, dict]] = {}


def _cache_key(assignment: str, student: str, code: str) -> str:
    # Use full text hash so two students with the same header don't collide
    h = hashlib.sha256(f"{assignment}|{student}|{code}".encode()).hexdigest()
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


def sample_document(text: str, max_chars: int = 16000) -> str:
    """
    Return a representative sample of the document when it exceeds max_chars.
    Strategy: beginning 50% + middle 25% + end 25%
    This ensures we see the intro, body, and conclusion.
    """
    if len(text) <= max_chars:
        return text
    head = int(max_chars * 0.50)
    mid_size = int(max_chars * 0.25)
    tail = int(max_chars * 0.25)
    mid_start = (len(text) - mid_size) // 2
    parts = [
        text[:head],
        f"\n\n[... محتوى محذوف للاختصار ...]\n\n",
        text[mid_start: mid_start + mid_size],
        f"\n\n[... محتوى محذوف للاختصار ...]\n\n",
        text[-tail:],
    ]
    return "".join(parts)


def extract_relevant_excerpt(text: str, criterion_desc: str, max_chars: int = 14000) -> str:
    """
    Extract the most relevant portion of student text for a given criterion.
    Strategy:
      1. Tokenize criterion description into keywords.
      2. Score each paragraph by keyword hit density.
      3. Return top-scoring paragraphs up to max_chars.
      Always includes the first 2000 chars as baseline context.
    If text is short enough to fit entirely, returns it as-is.
    """
    if len(text) <= max_chars:
        return text

    # Build keyword set from criterion description (filter short/stop words)
    stop = {'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'التي', 'الذي',
            'يجب', 'أو', 'و', 'أن', 'لا', 'كل', 'هل', 'a', 'the', 'of', 'and', 'or', 'to'}
    norm_desc = normalize_text(criterion_desc)
    keywords = {
        w for w in re.split(r'\W+', norm_desc)
        if len(w) >= 3 and w not in stop
    }

    # Split text into paragraphs (~500-char windows overlapping slightly)
    paragraphs = [p.strip() for p in re.split(r'\n{1,}', text) if p.strip()]
    if not paragraphs:
        return text[:max_chars]

    # Score each paragraph
    def score(para: str) -> float:
        norm_p = normalize_text(para)
        words = set(re.split(r'\W+', norm_p))
        hits = len(keywords & words)
        return hits / max(len(words), 1)

    scored = sorted(enumerate(paragraphs), key=lambda x: score(x[1]), reverse=True)

    # Always start with first 2000 chars as context baseline
    baseline = text[:2000]
    result_parts = [baseline]
    used_chars = len(baseline)
    used_indices = set()

    for orig_idx, para in scored:
        if used_chars >= max_chars:
            break
        room = max_chars - used_chars
        snippet = para[:room]
        result_parts.append(snippet)
        used_chars += len(snippet)
        used_indices.add(orig_idx)

    return "\n".join(result_parts)


def extract_criterion_section(student_text: str, code: str, max_chars: int = 16000) -> Optional[str]:
    """
    Find the section in student document dedicated to a specific criterion code.
    Looks for lines like 'P1:', 'A.P1 -', 'معيار P1', 'Task 1 - P1', etc.
    Returns the section text if found (up to max_chars), or None if not found.
    """
    code_upper = code.upper()
    bare_code = re.sub(r'^[A-Z]+\.', '', code_upper)  # A.P1 -> P1

    # Regex to detect a heading line for THIS criterion
    # Heading must be short (≤ 80 chars) and contain the criterion code as a word
    heading_re = re.compile(
        rf'(?<![A-Z0-9])(?:[A-Z]{{1,2}}\.)?{re.escape(bare_code)}(?![A-Z0-9])',
        re.IGNORECASE,
    )
    # Regex for ANY criterion heading (to detect end of section)
    any_criterion_re = re.compile(
        r'(?<![A-Z0-9])(?:[A-Z]{1,2}\.)?(?:P|M|D)\d+(?![A-Z0-9])',
        re.IGNORECASE,
    )

    lines = student_text.split('\n')
    heading_line_idx = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        # Must be a short line (heading-like) containing the criterion code
        if 2 <= len(stripped) <= 100 and heading_re.search(stripped):
            # Extra check: this line should look like a heading, not mid-paragraph
            # A heading line typically ends with ':' or '-' or is just the code
            # OR it's short enough (≤ 60 chars) — avoid matching mid-sentence references
            is_heading = (
                stripped.endswith((':',  '-', '–')) or
                len(stripped) <= 60 or
                re.match(r'^[\s\W]*(?:[A-Z]{1,2}\.)?[PMD]\d+', stripped, re.IGNORECASE)
            )
            if is_heading:
                heading_line_idx = i
                break

    if heading_line_idx is None:
        return None

    # Now find where the next criterion section starts
    section_lines = [lines[heading_line_idx]]
    for j in range(heading_line_idx + 1, len(lines)):
        line = lines[j]
        stripped = line.strip()
        # Stop if we hit another criterion heading (short line with a different criterion code)
        if 2 <= len(stripped) <= 100 and any_criterion_re.search(stripped):
            # Make sure it's actually a different criterion (not just a reference)
            found_codes = any_criterion_re.findall(stripped)
            # If the only code found is the current criterion in a non-heading context, skip
            if found_codes and not all(
                re.sub(r'^[A-Z]+\.', '', c.upper()) == bare_code
                for c in found_codes
            ):
                is_next_heading = (
                    stripped.endswith((':', '-', '–')) or
                    len(stripped) <= 60 or
                    re.match(r'^[\s\W]*(?:[A-Z]{1,2}\.)?[PMD]\d+', stripped, re.IGNORECASE)
                )
                if is_next_heading:
                    break
        section_lines.append(line)

    section = '\n'.join(section_lines).strip()

    if len(section) < 100:
        return None

    return section[:max_chars]


def extract_company_section(student_text: str, company_name: str, max_chars: int = 10000) -> Optional[str]:
    """
    Find the section in student document dedicated to a specific company.
    Matches heading lines containing the company name (or a significant substring).
    Returns the section text if found, or None.
    """
    if not company_name or len(company_name) < 2:
        return None

    # Use the longest word in company name (≥4 chars) as the key search term
    words = [w for w in re.split(r'\W+', company_name) if len(w) >= 4]
    if not words:
        words = [company_name[:8]]
    search_term = max(words, key=len)  # longest word is most distinctive

    lines = student_text.split('\n')
    heading_line_idx = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        # Short heading line containing the company name
        if 2 <= len(stripped) <= 100 and re.search(re.escape(search_term), stripped, re.IGNORECASE):
            heading_line_idx = i
            break

    if heading_line_idx is None:
        return None

    # Collect lines until the next similar-length heading
    section_lines = [lines[heading_line_idx]]
    for j in range(heading_line_idx + 1, len(lines)):
        line = lines[j]
        stripped = line.strip()
        # Stop at next short heading that looks like a new company or criterion section
        if 2 <= len(stripped) <= 80:
            looks_like_heading = (
                stripped.endswith((':', '-', '–')) or
                re.match(r'^[\s\W]*(?:[A-Z]{1,2}\.)?[PMD]\d+', stripped, re.IGNORECASE) or
                (len(stripped) <= 50 and re.search(r'[A-Z\u0600-\u06FF]{3,}', stripped))
            )
            # Only stop if it's a NEW section (not this company's heading)
            if looks_like_heading and not re.search(re.escape(search_term), stripped, re.IGNORECASE):
                # Check it's not just a sub-heading within the same company section
                if j > heading_line_idx + 3:  # give at least 3 lines before stopping
                    break
        section_lines.append(line)

    section = '\n'.join(section_lines).strip()
    return section[:max_chars] if len(section) >= 50 else None


def extract_multi_company_excerpt(
    student_text: str,
    code: str,
    desc: str,
    company_names: List[str],
    max_chars: int = 18000,
) -> Tuple[str, str]:
    """
    When student organized document by company (not by criterion code),
    extract the criterion-relevant content from EACH company section.

    Returns:
        (combined_excerpt, source_note)
    """
    per_company = max_chars // max(len(company_names), 1)
    parts = []
    found_companies = []

    for company in company_names:
        company_section = extract_company_section(student_text, company, max_chars=per_company)
        if company_section:
            # From this company section, extract paragraphs most relevant to this criterion
            relevant = extract_relevant_excerpt(company_section, desc or code, max_chars=per_company)
            if relevant and len(relevant) > 80:
                parts.append(f"── محتوى {company} المتعلق بالمعيار {code} ──\n{relevant}")
                found_companies.append(company)

    if not parts:
        # Fall back to keyword extraction from full document
        fallback = extract_relevant_excerpt(student_text, desc or code, max_chars=max_chars)
        note = (
            f"⚠️ لم يُعثَر على قسم بعنوان '{code}' أو بأسماء الشركات في وثيقة الطالب.\n"
            f"   يُعرض المقتطع الأكثر صلة بالمعيار من الوثيقة."
        )
        return fallback, note

    combined = "\n\n".join(parts)[:max_chars]
    note = (
        f"📂 الطالب نظّم إجابته حسب الشركة — عُثر على محتوى في: {', '.join(found_companies)}\n"
        f"   ⚠️ قيّم المعيار {code} بالنظر في مجموع ما قدّمه الطالب لكلتا الشركتين.\n"
        f"   الأدلة موزعة — اجمعها من كلا القسمين قبل الحكم."
    )
    return combined, note


def smart_student_excerpt(student_text: str, code: str, desc: str, max_chars: int) -> str:
    """
    Return as much of the student document as possible within max_chars.
    - If the full document fits: return ALL of it (AI sees everything — best case).
    - If too long: use structure-preserving sampling (50% head + 25% mid + 25% tail)
      rather than keyword scoring, so document flow and section headers are preserved.
    The AI is then instructed to scan the whole provided text and find the relevant
    section itself — far more reliable than Python keyword matching.
    """
    if len(student_text) <= max_chars:
        return student_text
    # Structure-preserving sample — preserves headings and document flow
    return sample_document(student_text, max_chars=max_chars)


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
async def _call_ai_with_retry(prompt: str, max_retries: int = GRADER_MAX_RETRIES) -> str:
    """
    Call the configured AI provider with exponential-backoff retry on 429/overloaded.
    Raises on non-retriable errors. Returns raw text response.
    """
    active_client = None
    if MODEL.startswith("gpt-") or MODEL.startswith("o1-"):
        active_client = openai_client
    elif MODEL.startswith("claude-"):
        active_client = anthropic_client

    if active_client is None:
        raise RuntimeError("لا يوجد عميل AI نشط — تحقق من مفتاح API وإعداد GRADER_MODEL")

    loop = asyncio.get_event_loop()
    last_err = None
    for attempt in range(max_retries):
        try:
            if attempt > 0:
                # Exponential backoff: 5s, 15s, 45s
                wait = 5 * (3 ** (attempt - 1))
                logger.info(f"Retry {attempt}/{max_retries} after {wait}s backoff...")
                await asyncio.sleep(wait)

            if MODEL.startswith("claude-"):
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
                return (response.content[0].text or "").strip()
            else:
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: active_client.chat.completions.create(
                            model=MODEL,
                            max_tokens=MAX_TOKENS,
                            messages=[{"role": "user", "content": prompt}],
                            response_format={"type": "json_object"},
                            temperature=0,   # deterministic — same input → same output
                            seed=42,         # extra reproducibility
                        )
                    ),
                    timeout=REQUEST_TIMEOUT
                )
                return (response.choices[0].message.content or "").strip()

        except Exception as e:
            err_msg = str(e).lower()
            is_retriable = any(x in err_msg for x in ["429", "rate limit", "overloaded", "timeout", "timed out"])
            last_err = e
            if is_retriable and attempt < max_retries - 1:
                logger.warning(f"Retriable API error (attempt {attempt+1}): {e}")
                continue
            raise  # Non-retriable or last attempt

    raise last_err or RuntimeError("Unknown error in _call_ai_with_retry")


async def _grader_rag_context_block(
    assignment: str,
    student: str,
    *,
    criterion_code: str = "",
    criterion_desc: str = "",
) -> str:
    """Retrieve local BTEC corpus chunks and format for grader system context."""
    try:
        from app.services.local_rag import retrieve_local_context, format_rag_context
    except ImportError:
        return ""

    a = clean_and_compress_text(assignment)[:6000]
    s = clean_and_compress_text(student)[:6000]
    tail = f"{criterion_code}\n{(criterion_desc or '')[:2000]}".strip()
    query = "\n".join(x for x in (a, s, tail) if x).strip()[:14000]
    if not query:
        return ""

    try:
        chunks = await retrieve_local_context(
            query=query,
            top_k=5,
            min_score=0.35,
            persona_level="distinction",
            unit_id="",
        )
    except Exception as e:
        logger.warning("[ForensicRAG] retrieve failed: %s", e)
        return ""

    if not chunks:
        return ""

    formatted = format_rag_context(chunks, persona_level="distinction", crystallize=True)
    if not formatted.strip():
        return ""

    return (
        "\n\n## BTEC Ground Truth (textbooks, rubrics, exemplars)\n"
        "ABSOLUTE INSTRUCTION: Evaluate this submission strictly against the provided BTEC textbook context "
        "and past exemplars. When corpus evidence aligns with the assignment requirements, treat it as authoritative.\n"
        f"{formatted}\n"
    )


async def pre_analyze_student_work(
    assignment: str,
    student: str,
    corpus_block: str = "",
) -> dict:
    """
    PASS 1 — Read the ENTIRE student document ONCE.
    Build a content map: companies covered, topics, sections.
    This is shared context injected into every per-criterion evaluation,
    giving the AI 'memory' about the full document even when evaluating a single criterion.
    Returns a dict with keys: companies, topics_covered, sections, overall_summary.
    On failure returns a safe empty map (never blocks grading).
    """
    # Sample the document to fit within token limits (~16k chars = ~8k Arabic tokens)
    # Strategy: beginning 50% + middle 25% + end 25% for representative coverage
    sampled_student = sample_document(student, max_chars=40000)
    logger.info(f"Pre-analysis: doc={len(student):,} chars → sampled={len(sampled_student):,} chars")

    prompt = f"""أنت محلل نصوص أكاديمي.{corpus_block}
مهمتك **قراءة وثيقة الطالب** وإنشاء "خريطة محتوى" موضوعية دقيقة.

لا تُصدر أي حكم جودة الآن. فقط استخرج الحقائق:

الواجب المطلوب (للسياق):
{assignment[:2000]}

═══════ وثيقة الطالب (مُعاينة شاملة) ═══════
{sampled_student}
═══════════════════════════════════

أجب بـ JSON فقط (بدون أي نص خارجه):
{{
  "companies": [
    {{
      "name": "اسم الشركة/المنظمة",
      "content_summary": "ملخص ما كتبه الطالب عنها في 3-5 جمل",
      "topics_addressed": ["موضوع 1", "موضوع 2"],
      "approx_location": "أول الوثيقة / منتصف الوثيقة / آخر الوثيقة"
    }}
  ],
  "all_topics_covered": [
    "قائمة بكل الموضوعات التي تناولها الطالب في كامل الوثيقة"
  ],
  "document_sections": [
    "عناوين أو أجزاء رئيسية في الوثيقة إن وُجدت (مثل: P1, M2, عنوان القسم)"
  ],
  "criteria_sections": {{
    "P1": "وصف موجز للقسم الذي خصصه الطالب للمعيار P1 إن وُجد، أو null",
    "وهكذا لكل معيار موجود في الوثيقة": null
  }},
  "legislation_regulations_mentioned": [
    "أي قوانين أو تشريعات أو لوائح ذكرها الطالب"
  ],
  "key_methods_strategies": [
    "الطرق والاستراتيجيات المذكورة"  
  ],
  "overall_summary": "ملخص شامل لعمل الطالب الكامل في 3-4 جمل — ما الذي حقق وما الذي غطّى"
}}"""

    try:
        raw = await _call_ai_with_retry(prompt, max_retries=2)
        m = re.search(r'\{[\s\S]*\}', raw)
        if m:
            result = json.loads(m.group())
            logger.info(
                f"Pre-analysis done: {len(result.get('companies', []))} companies found, "
                f"{len(result.get('all_topics_covered', []))} topics"
            )
            return result
    except Exception as e:
        logger.warning(f"Pre-analysis failed (non-critical): {e}")
    # Safe empty fallback — grading continues without memory
    return {
        "companies": [],
        "all_topics_covered": [],
        "document_sections": [],
        "legislation_regulations_mentioned": [],
        "key_methods_strategies": [],
        "overall_summary": ""
    }


async def evaluate_one(
    code: str,
    desc: str,
    assignment: str,
    student: str,
    adv_constraints: Dict[str, Any],
    content_map: Optional[dict] = None,   # NEW: shared memory from pre-analysis
    corpus_block: str = "",
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
    try:
        from app.services.local_rag import RAG_ENABLED as _LOCAL_RAG_ON
    except Exception:
        _LOCAL_RAG_ON = False
    # Corpus-augmented prompts must not reuse pre-RAG cache entries
    cached = _get_cached(cache_k) if not _LOCAL_RAG_ON else None
    if cached:
        logger.info(f"Cache hit for {code}")
        return code, cached

    effective_corpus = (corpus_block or "").strip()
    if not effective_corpus:
        try:
            effective_corpus = await _grader_rag_context_block(
                assignment, student, criterion_code=code, criterion_desc=desc or ""
            )
        except Exception as _rag_e:
            logger.warning("[ForensicRAG] per-criterion fetch failed for %s: %s", code, _rag_e)
            effective_corpus = ""

    band = band_from_code(code)

    # ── Try to find the dedicated section for this criterion in the student document ──
    # Large limits so short/medium documents are passed in full to the AI.
    # Claude claude-sonnet-4-5 context = 200k tokens; 60k Arabic chars ≈ 17k tokens — well within limits.
    max_excerpt = 60000 if band == 'DISTINCTION' else 50000
    criterion_section = extract_criterion_section(student, code, max_chars=max_excerpt)
    if criterion_section:
        student_excerpt_text = criterion_section
        section_source_note = (
            f"✅ عُثر على القسم المخصص للمعيار {code} في وثيقة الطالب.\n"
            f"   ⚠️ قيّم من هذا القسم تحديداً — هنا قصد الطالب وضع إجابته عن هذا المعيار.\n"
            f"   لا تبحث خارج هذا القسم إلا إذا كان القسم فارغاً أو مبتوراً."
        )
        logger.info(f"[{code}] Dedicated section found ({len(criterion_section):,} chars)")
    elif content_map and len(content_map.get('companies', [])) >= 2:
        # Student organized by company — try to extract content from each company's section
        company_names = [c['name'] for c in content_map.get('companies', []) if c.get('name')]
        student_excerpt_text, section_source_note = extract_multi_company_excerpt(
            student, code, desc or code, company_names, max_chars=max_excerpt
        )
        logger.info(f"[{code}] Multi-company structure detected ({len(company_names)} companies) — combined excerpt {len(student_excerpt_text):,} chars")
    else:
        # No dedicated section, no multi-company structure.
        # Pass as much of the document as possible (full doc if it fits).
        # Let the AI locate the relevant content itself — semantic search > keyword scoring.
        student_excerpt_text = smart_student_excerpt(student, code, desc or code, max_chars=max_excerpt)
        is_full_doc = len(student) <= max_excerpt
        if is_full_doc:
            section_source_note = (
                f"📄 وثيقة الطالب كاملةً مُرفقة أدناه ({len(student_excerpt_text):,} محرف).\n"
                f"   🔍 مهمتك: تفحّص النص بالكامل وحدِّد بنفسك المقاطع التي تناول فيها الطالب المعيار {code}.\n"
                f"   ابحث عن الفهم والمعنى — لا تقتصر على قسم يحمل اسم المعيار بالضبط.\n"
                f"   الطالب قد يكون قد أجاب على هذا المعيار بأسلوبه الخاص أو ضمن سياق أوسع."
            )
        else:
            section_source_note = (
                f"📄 يُعرض مقطع واسع جداً من وثيقة الطالب ({len(student_excerpt_text):,} محرف من أصل {len(student):,}).\n"
                f"   المقطع يغطي: أول الوثيقة + منتصفها + آخرها (بصياغة بنيوية).\n"
                f"   🔍 مهمتك: تفحّص هذا النص وحدِّد أنت المقاطع المتعلقة بالمعيار {code}.\n"
                f"   ابحث عن الفهم السياقي — الطالب قد أجاب ضمن إطار أوسع وليس في قسم معلَّم بالضبط."
            )
        logger.info(f"[{code}] Full/wide doc provided ({len(student_excerpt_text):,} chars, full={is_full_doc}) — AI to locate section")

    # Map BTEC band to expected cognitive verb level
    band_verb_map = {
        "PASS":        "وصف (Describe) — الطالب يُبيّن ما هو الشيء بوضوح مع تفاصيل كافية ومثال من السياق.",
        "MERIT":       "تحليل (Analyse) — الطالب يُفسّر ويربط: يشرح الأسباب، يكشف العلاقات، ويجيب على لماذا وكيف. يكفي أن يُظهر تفكيراً سببياً واضحاً في أي جزء من إجابته.",
        "DISTINCTION": "تقييم (Evaluate/Justify) — الطالب يُقيّم بشكل معقول: يُبدي حكماً مُبرَّراً، يبرر آراءه بأدلة، يُشير إلى الأهمية أو التأثير أو النتائج المحتملة. لا يُشترط مقارنة رسمية للبدائل — يكفي الاستنتاج المُبرَّر والتقييم المعقول الملائم لمستوى BTEC Level 3.",
    }
    expected_depth = band_verb_map.get(band, "الإجابة يجب أن تكون واضحة ومدعومة.")

    # ── FIX: Quantitative constraints must be scoped to the CRITERION itself ──
    # Do NOT apply a global task-description constraint (e.g. "شركتين")
    # to a criterion whose OWN description uses singular wording (e.g. "الشركة المختارة").
    # Check: does the criterion description itself explicitly mention a number/count?
    SINGULAR_SCOPE_SIGNALS = [
        r'الشركة المختارة', r'شركة مختارة', r'the chosen company', r'a company',
        r'شركة واحدة', r'selected company', r'chosen business',
    ]
    criterion_is_singular_scoped = any(
        re.search(sig, desc, re.IGNORECASE) for sig in SINGULAR_SCOPE_SIGNALS
    )

    # Build quantitative requirements warning only when constraint applies to THIS criterion
    quant_warning = ""
    if adv_constraints and adv_constraints.get("by_target") and not criterion_is_singular_scoped:
        quant_requirements = []
        for target, required_count in adv_constraints["by_target"].items():
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
⚠️ متطلبات كمية صريحة في الواجب — تنطبق على هذا المعيار ⚠️
الواجب نصّ بوضوح على أعداد محددة:
{chr(10).join(quant_requirements)}
تعليمات:
- إذا قدّم الطالب العدد المطلوب أو أكثر → المتطلب مستوفى، انتقل لتقييم العمق.
- نقص بسيط (عنصر واحد) مع عمق كافٍ = قيّم بتأنٍّ — قد يُقبل.
- نقص كبير مع ضعف في المحتوى → NOT ACHIEVED.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

    # Build step-0 based on whether quantitative constraints apply to THIS criterion
    if quant_warning:
        quant_step = f"""**خطوة 0 — التحقق من المتطلبات الكمية:**
الواجب يتضمن متطلبات عددية صريحة تنطبق على هذا المعيار (مذكورة أعلاه).
عدّ العناصر التي قدّمها الطالب وقارن. النقص الكبير عامل ثقيل. النقص البسيط مع عمق = قيّم بتأنٍّ.
"""
    else:
        # Either criterion is singular-scoped OR no global constraints exist
        scope_note = "لأن المعيار نفسه يحدد شركة مختارة (مفرد)." if criterion_is_singular_scoped else "الواجب لا يتضمن متطلبات عددية صريحة."
        quant_step = f"""**خطوة 0 — ملاحظة مهمة بشأن التقييم الكمي:**
🔴 لا تخترع متطلبات كمية. {scope_note}
✅ قيّم بناءً على عمق الفهم وجودة المحتوى فقط.
"""

    # ── Build content-map block from pre-analysis ──
    content_map_block = ""
    if content_map and (content_map.get("companies") or content_map.get("overall_summary")):
        companies_list = ""
        for c in content_map.get("companies", []):
            companies_list += (
                f"\n  • {c.get('name','؟')}: {c.get('content_summary','')} "
                f"(الموقع: {c.get('approx_location','')})"
            )
        topics_list = "، ".join(content_map.get("all_topics_covered", [])[:20])
        laws_list   = "، ".join(content_map.get("legislation_regulations_mentioned", [])[:10])
        methods_list = "، ".join(content_map.get("key_methods_strategies", [])[:15])

        content_map_block = f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 ذاكرة الوثيقة — ما كتبه الطالب في كامل وثيقته:
(هذه المعلومات مستخرجة من القراءة الكاملة للوثيقة — استخدمها كسياق عند البحث عن أدلة للمعيار)

الشركات التي تناولها الطالب:{companies_list if companies_list else " لم تُحدَّد"}

الموضوعات الكلية المغطاة: {topics_list or "غير محددة"}

التشريعات/اللوائح المذكورة: {laws_list or "لم تُذكر"}

الطرق والاستراتيجيات: {methods_list or "لم تُذكر"}

ملخص الوثيقة: {content_map.get('overall_summary', '')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ تعليمات البحث: المعيار {code} قد يكون أدلته موزعة في أماكن متفرقة من الوثيقة.
ابحث عن الفهم المفهومي في كامل الوثيقة — ليس فقط في قسم يحمل اسم المعيار.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

    calibration_block = get_calibration_block(band)

    prompt = f"""أنت مقيّم أكاديمي معتمد من Pearson لمؤهلات BTEC International Level 3.
{effective_corpus}
مهمتك: تقييم المعيار {code} بعد فهم السيناريو الكامل للواجب أولاً — لا تشدد ولا تساهل.

{quant_warning}
{content_map_block}

╔══════════════════════════════════════════════════╗
║  المرحلة 1 — اقرأ وثيقة الواجب كاملاً أولاً    ║
╚══════════════════════════════════════════════════╝
اقرأ هذا الواجب بالكامل قبل أي شيء لتفهم:
  (أ) السيناريو والسياق التجاري/الأكاديمي للواجب — من هي الشركات؟ ما المشكلة المطروحة؟
  (ب) ما الذي يُفترض أن يُثبته الطالب إجمالاً في هذا الواجب
  (ج) ما يطلبه المعيار {code} تحديداً **داخل هذا السيناريو** — ليس تعريفاً نظرياً مجرداً

⚠️ لا تنتقل إلى تقييم إجابة الطالب إلا بعد أن تفهم هذا السيناريو جيداً.

وثيقة الواجب:
───────────────────────────────────────────────────
{assignment[:15000]}
───────────────────────────────────────────────────

╔══════════════════════════════════════════════════╗
║  المرحلة 2 — المعيار المستهدف في سياق الواجب   ║
╚══════════════════════════════════════════════════╝
الكود: {code}  |  المستوى: {band}
نص المعيار كما ورد في الواجب:
  "{desc}"

بناءً على السيناريو الذي قرأتَه، استخلص:
  • ماذا يعني هذا المعيار تحديداً في سياق هذا الواجب؟
  • أي مفاهيم أو موضوعات من الواجب يرتبط بها هذا المعيار؟
  • كيف قد يُثبت طالب هذا المعيار بأسلوبه الخاص داخل هذا السيناريو؟

{quant_step}

╔══════════════════════════════════════════════════╗
║  المرحلة 3 — إجابة الطالب                       ║
╚══════════════════════════════════════════════════╝
{section_source_note}

───────────────────────────────────────────────────
{student_excerpt_text}
───────────────────────────────────────────────────

╔══════════════════════════════════════════════════╗
║  المرحلة 4 — سياسة Pearson للحكم النهائي        ║
╚══════════════════════════════════════════════════╝
المبدأ: التقييم يُبنى على ما أثبته الطالب فعلاً — لا على ما يُفترض أنه يعرفه.

⬛ PASS — (صِف / اشرح / حدِّد / وضِّح)
   ✅ مستوفى: الطالب وصف الموضوع المطلوب بوضوح مع تفاصيل ذات صلة وأمثلة حقيقية من السياق.
      المطلوب: فهم واضح + تفصيل كافٍ + مثال أو أكثر يُثبت فهمه.
   ❌ رفض: مجرد ذكر المصطلح، تكرار جمل السؤال، أو تعداد بلا شرح.

⬛ MERIT — (حلِّل / قارن / ناقش / فسِّر)
   ✅ مستوفى: الطالب أظهر تحليلاً سببياً واضحاً — شرح الأسباب أو النتائج أو العلاقات.
      المطلوب: ربط سببي واضح بما يكفي لإثبات الفهم التحليلي — ليس مجرد وصف مطوّل.
      يكفي: تحليل واضح في أي جزء من الإجابة ولو لم يكن في كل فقرة.
   ❌ رفض: وصف مطوّل بدون أي ربط سببي أو تحليلي في الإجابة كلها.

⬛ DISTINCTION — (قيِّم / برِّر / استنتج / وزِّن / أبدِ حكماً نقدياً)
   ✅ مستوفى: الطالب تجاوز التحليل إلى إبداء حكم مُعلَّل — بيَّن لماذا شيء ما مهم أو فعّال أو مناسب.
      يكفي: حكم واحد واضح مُبرَّر بدليل من الإجابة.
   ❌ رفض: تحليل سببي بدون أي حكم أو استنتاج، أو حكم بدون أي تبرير أو دليل.

ملاحظات:
- الأسلوب اللغوي والأخطاء الإملائية لا يؤثران على الحكم.
- الطالب قد يُثبت الفهم بأسلوبه الخاص — المحك هو الفهم وليس التعبير.

{calibration_block}
╔══════════════════════════════════════════════════╗
║  خطوات التقييم — اتبعها بالترتيب               ║
╚══════════════════════════════════════════════════╝

خطوة 1 — استخلص ماذا يعني المعيار {code} في سياق هذا الواجب تحديداً:
  • ما السيناريو؟ ما المطلوب من الطالب أن يُثبته في هذا السياق؟
  • ما المفاهيم المرتبطة بهذا المعيار داخل الواجب؟

خطوة 2 — حدِّد أين وضع الطالب إجابته على هذا المعيار:
  • إذا كان القسم مخصصاً (✅): قيّم من هذا القسم تحديداً — هذا هو المكان الذي قصد الطالب وضع إجابته.
  • إذا كان الطالب نظّم حسب الشركات (📂): اجمع كل ما قدّمه عبر جميع أقسام الشركات —
    قيّم الأداء الكلي بمجموع إجابته لجميع الشركات، وليس شركة واحدة فقط.
  • إذا كانت الوثيقة كاملة أو مقطعاً واسعاً (📄): أنت من يُحدِّد الموقع —
    تفحّص بنية الوثيقة (العناوين، التقسيمات، أرقام المعايير إن وُجدت)، ثم قيّم
    المقاطع التي يكون فيها الطالب قد ناقش الموضوع ذا الصلة بهذا المعيار في سياق هذا الواجب.
  • في جميع الحالات: ابحث عن الفهم والمعنى السياقي — ليس كلمات مطابقة.
    الطالب قد يُجيب بأسلوبه الخاص دون استخدام اسم المعيار حرفياً.

خطوة 3 — قيّم الأداء وفق سياسة Pearson:
  • هل ما أثبته الطالب يُفي بمتطلبات المعيار بمستواه ({band})؟
  • الدليل يجب أن يكون واضحاً — لا تمنح إذا كان غامضاً، ولا ترفض إذا كان واضحاً كافياً.

خطوة 4 — اقتبس الأدلة الحرفية من نص الطالب الداعمة لحكمك.

أعد النتيجة بـ JSON فقط (بدون أي نص خارجه):
{{
  "achieved": true أو false,
  "quantitative_check": {{
    "applicable": true أو false,
    "required": "المتطلب الكمي الصريح من نص المعيار، أو null",
    "found": "ما قدّمه الطالب فعلاً، أو null",
    "satisfied": true أو false أو null
  }},
  "reasoning": "(1) فهمي للسيناريو وما يعنيه المعيار {code} في هذا الواجب: [استخلاصك] | (2) أين وجدت الإجابة في وثيقة الطالب وما الذي قدّمه: [الموقع + الدليل] | (3) الحكم النهائي ولماذا وفق Pearson: [التبرير]",
  "evidence": ["اقتباس حرفي 1 من إجابة الطالب", "اقتباس حرفي 2 إن وُجد"],
  "quality": "ممتاز / جيد / مقبول / ضعيف",
  "missing_requirements": ["ما يحتاج الطالب لإضافته بالضبط لتحقيق هذا المعيار في سياق هذا الواجب"]
}}"""

    async with semaphore:
        try:
            # تأخير بسيط لتجنب 429 (Rate Limit)
            if GRADER_DELAY_SEC > 0:
                await asyncio.sleep(GRADER_DELAY_SEC)

            # Use unified retry wrapper — handles 429 / overloaded automatically
            raw_text = await _call_ai_with_retry(prompt, max_retries=GRADER_MAX_RETRIES)
            
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
            if "insufficient_quota" in err_msg or ("429" in err_msg and "quota" in err_msg):
                logger.error("OpenAI quota exhausted — add billing credits at https://platform.openai.com/billing")
                reason = "رصيد OpenAI مستنفد. يرجى شحن حساب OpenAI من: platform.openai.com/billing"
            elif "authentication" in err_msg or "invalid_api_key" in err_msg or ("401" in err_msg and "invalid" in err_msg):
                logger.error("API key invalid/unauthorized — update OPENAI_API_KEY or ANTHROPIC_API_KEY in .env")
                reason = "مفتاح API غير صحيح. يرجى تحديث OPENAI_API_KEY أو ANTHROPIC_KEY في ملف backend/.env"
            elif "429" in err_msg or "rate limit" in err_msg or "overloaded" in err_msg:
                logger.warning("API rate limit (429/overloaded). قلّل GRADER_MAX_CONCURRENT أو زِد GRADER_DELAY_SEC في .env")
                reason = "تجاوز حد طلبات API المؤقت. يرجى المسحاولة لاحقاً."
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
    """
    Streaming forensic grading — yields NDJSON lines.

    Two-pass approach:
      Pass 1 (pre_analyze): One AI call reads the ENTIRE student document → content_map
      Pass 2 (evaluate_one): Sequential per-criterion evaluation using content_map as memory
    """
    start_time = time.monotonic()
    job_id = hashlib.md5(f"{time.time()}".encode()).hexdigest()[:8]

    logger.info(f"Job {job_id} started")

    try:
        # Clean and keep full text — excerpting happens per criterion in evaluate_one
        assignment_text = clean_and_compress_text(assignment_text)[:30000]
        # Keep the full cleaned student text — evaluate_one will smart-excerpt per criterion
        student_text_full = clean_and_compress_text(student_text)
        student_text = student_text_full  # no truncation here

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

        # ── PASS 1: Pre-analysis — read the full document, build content map ──
        yield json.dumps({
            "type": "status",
            "message": f"جاري قراءة وثيقة الطالب كاملة لبناء خريطة المحتوى... ({total} معيار)",
            "total": total,
            "job_id": job_id,
            "phase": "pre_analysis"
        }, ensure_ascii=False) + "\n"

        corpus_block = ""
        try:
            corpus_block = await _grader_rag_context_block(assignment_text, student_text)
        except Exception as _rag_job_e:
            logger.warning("[ForensicRAG] shared corpus block failed: %s", _rag_job_e)

        content_map = await pre_analyze_student_work(
            assignment_text, student_text, corpus_block=corpus_block
        )

        companies_found = len(content_map.get("companies", []))
        yield json.dumps({
            "type": "status",
            "message": f"تم بناء خريطة المحتوى: {companies_found} شركة/منظمة — بدء تقييم المعايير...",
            "total": total,
            "job_id": job_id,
            "phase": "evaluation",
            "content_map_summary": content_map.get("overall_summary", "")
        }, ensure_ascii=False) + "\n"

        # ── PASS 2: Sequential per-criterion evaluation (avoids rate limits) ──
        results: Dict[str, Dict] = {}
        for idx, code in enumerate(codes):
            if time.monotonic() - start_time > HARD_DEADLINE:
                logger.warning(f"Job {job_id} hit hard deadline at {len(results)}/{total}")
                break

            code, result = await evaluate_one(
                code,
                descriptions.get(code, f"معيار {code}"),
                assignment_text,
                student_text,
                adv_constraints,
                content_map=content_map,
                corpus_block=corpus_block,
            )
            results[code] = result

            # Yield each criterion result immediately
            yield json.dumps({
                "type": "criterion",
                "code": code,
                "result": result,
                "processed": len(results),
                "total": total
            }, ensure_ascii=False) + "\n"

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