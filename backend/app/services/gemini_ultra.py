# -*- coding: utf-8 -*-
"""Google Gemini: Socratic Jordanian BTEC tutor — strict JSON (explanation, media_prompt, game_idea)."""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict

from app.core.config import settings

logger = logging.getLogger(__name__)

_FENCE_RE = re.compile(r"^```(?:json)?\s*([\s\S]*?)\s*```$", re.IGNORECASE)


def _strip_json_fence(s: str) -> str:
    t = (s or "").strip()
    m = _FENCE_RE.match(t)
    if m:
        return m.group(1).strip()
    return t


_SYSTEM_INSTRUCTION = (
    "أنت 'إيدوفيرس ألترا' (Eduverse Ultra Tutor)، معلم أردني خبير بتدريس معايير BTEC المهنية (Pearson). "
    "منهجيتك هي 'الأسئلة السقراطية'. "
    "مهمتك الأساسية: لا تعطِ الإجابة المباشرة للطالب أبدًا لمنع الغش (Plagiarism). "
    "بدلًا من ذلك، اشرح المفهوم بلهجة أردنية أكاديمية مبسّطة ولطيفة، واختم الشرح بسؤال محفز للتفكير يوجه الطالب نحو الحل. "
    "يجب أن ترجع استجابتك بصيغة JSON فقط، تحتوي على المفاتيح التالية حصراً:\n"
    "1. 'explanation': الشرح السقراطي باللهجة الأردنية.\n"
    "2. 'media_prompt': وصف دقيق باللغة الإنجليزية لتوليد فيديو (Veo) أو صورة ثلاثية الأبعاد تفصل المفهوم.\n"
    "3. 'game_idea': فكرة لتحدي سريع (Mini-Game) أو سؤال خيارات ذهني تفاعلي."
)


def generate_tutor_response(criterion: str, brief_text: str) -> Dict[str, Any]:
    """
    Call Gemini as 'Eduverse Ultra Tutor' — Socratic, Jordanian; JSON keys: explanation, media_prompt, game_idea.
    """
    import google.generativeai as genai
    from google.generativeai.types import GenerationConfig

    api_key = (settings.GEMINI_API_KEY or settings.GOOGLE_API_KEY or "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured for Ultra Tutor.")

    genai.configure(api_key=api_key)
    # Set GEMINI_ULTRA_MODEL in env (e.g. gemini-2.5-pro or your workspace’s current Pro tier).
    model_id = (settings.GEMINI_ULTRA_MODEL or "gemini-1.5-pro").strip()

    user_prompt = (
        f"المعيار المطلوب تحقيقه (Criterion): {criterion}\n\n"
        f"محتوى الواجب (Brief Context): {brief_text}\n\n"
        "بناءً على المعيار والمحتوى أعلاه، قم بتوليد ردك التفاعلي."
    )

    try:
        model = genai.GenerativeModel(
            model_name=model_id,
            system_instruction=_SYSTEM_INSTRUCTION,
        )
        contents: Any = [user_prompt]
    except TypeError:
        model = genai.GenerativeModel(model_name=model_id)
        contents = [f"{_SYSTEM_INSTRUCTION}\n\n{user_prompt}"]

    generation_config = GenerationConfig(
        temperature=0.4,
        response_mime_type="application/json",
    )

    try:
        response = model.generate_content(
            contents=contents,
            generation_config=generation_config,
        )
    except Exception as e:
        logger.exception("Gemini generate_content failed")
        raise RuntimeError(f"حدث خطأ أثناء الاتصال بمحرك التفكير: {e!s}") from e

    raw = _strip_json_fence(getattr(response, "text", None) or "")
    if not raw:
        raise ValueError("استجابة النموذج فارغة.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as je:
        logger.error("Failed to parse JSON from Gemini: %s", je)
        raise ValueError("فشل في معالجة استجابة الذكاء الاصطناعي.") from je
