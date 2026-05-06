# -*- coding: utf-8 -*-
"""
phonetic_filter.py — Jordanian Arabic Phonetic Middleware
=========================================================

Sits between the LLM output and the TTS engine.  Word-level Jordanization
(`_jordanize`) already produces correct LEXICAL forms (هسا, بدي, شو ..).
This middleware adds PHONETIC accuracy so the TTS engine articulates them
with Levantine / Jordanian colour instead of MSA defaults.

Pipeline order:
    LLM text
      → tutor._apply_jordanize_pipeline   (lexical: MSA→Jordanian, Egyptian→Jordanian)
      → dialect_corrector.maybe_correct_egyptian_for_tts  (final-pass cleanup)
      → apply_jordanian_phonetics(text)   ← THIS MODULE
      → edge_tts / elevenlabs / piper Communicate(...)

Why this matters:
    Edge TTS (`ar-JO-TaimNeural`, `ar-JO-SanaNeural`) and most Arabic TTS
    voices read undiacritized words with default MSA vowels — `بدي` becomes
    /badi/ (Egyptian-flavoured) instead of the Jordanian /biddi/.  Adding
    targeted tashkeel (with shadda) on a small set of high-frequency
    function words dramatically improves perceived dialect accuracy.

Design rules:
    • Whole-word regex with `\b` boundaries — never replace inside a longer
      word (so `بدي` doesn't break inside `بديهي`).
    • Common one-letter clitic prefixes (و, ف, ب, ل, ك) handled explicitly
      for the highest-frequency forms.
    • Skip the entire pipeline if the input is already substantially
      diacritized (≥ 15 % of chars are tashkeel) — assume the LLM already
      did the work.
    • Do NOT touch:
        – English words / numbers / Latin punctuation
        – Inline stage-direction asterisks `*…*`
        – Performance tags `[wave]`, `[EMOTION:..]`
    • Optional Q→G transformation (Bedouin Jordanian) gated by env flag
      `JORDANIAN_QAF_TO_GAF=true`.  Off by default — most LLM-driven
      educational use prefers urban Levantine Q.
"""
from __future__ import annotations

import os
import re
from typing import List, Tuple

# ── Tashkeel / harakat unicode reference ──────────────────────────────────
# FATHA       \u064E    َ
# DAMMA       \u064F    ُ
# KASRA       \u0650    ِ
# SUKUN       \u0652    ْ
# SHADDA      \u0651    ّ
# TANWEEN F   \u064B    ً
# TANWEEN D   \u064C    ٌ
# TANWEEN K   \u064D    ٍ
# DAGGER ALIF \u0670    ٰ

_TASHKEEL_CHARS = "\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670"
_TASHKEEL_RE = re.compile(f"[{_TASHKEEL_CHARS}]")


def _tashkeel_density(text: str) -> float:
    """Fraction of characters that are diacritics (0..1)."""
    if not text:
        return 0.0
    arabic = sum(1 for c in text if "\u0600" <= c <= "\u06FF")
    if arabic == 0:
        return 0.0
    diacritics = len(_TASHKEEL_RE.findall(text))
    return diacritics / arabic


# ══════════════════════════════════════════════════════════════════════════════
# 1. Core Jordanian function-word phonetic dictionary
#    Each entry: (whole-word pattern, fully-diacritized replacement)
#    Patterns use `\b` so matching is restricted to standalone tokens.
# ══════════════════════════════════════════════════════════════════════════════
_JORDANIAN_PHONETIC_MAP: List[Tuple[str, str]] = [
    # ── الزمان / الظرف ──────────────────────────────────────────────────────
    (r"\bهسا\b",        "هَسَّا"),       # /hassa/ — Levantine "now"
    (r"\bهلأ\b",        "هَلَّأ"),        # /halla?/
    (r"\bهالوقت\b",     "هَالْوَقْت"),    # /halwaqt/
    (r"\bهلوقت\b",      "هَلْوَقْت"),
    (r"\bبكرا\b",       "بُكْرَا"),       # /bukra/
    (r"\bدغري\b",       "دُغْرِي"),       # /dughri/
    (r"\bتوقيت\b",      "تَوْقِيت"),

    # ── الإرادة / الفعل ─────────────────────────────────────────────────────
    (r"\bبدي\b",        "بِدِّي"),         # /biddi/ — sukoon at end + shadda on dal
    (r"\bبدك\b",        "بِدَّك"),
    (r"\bبدها\b",       "بِدَّها"),
    (r"\bبده\b",        "بِدُّه"),
    (r"\bبدنا\b",       "بِدْنَا"),
    (r"\bبدكم\b",       "بِدْكُم"),
    (r"\bبدهم\b",       "بِدْهُم"),
    (r"\bرح\b",         "رَح"),           # future particle
    (r"\bبقدر\b",       "بَقْدَر"),
    (r"\bلازم\b",       "لَازِم"),
    (r"\bخليني\b",      "خَلِّينِي"),
    (r"\bخلينا\b",      "خَلِّينَا"),
    (r"\bخليك\b",       "خَلِّيك"),
    (r"\bيلا\b",        "يَلَّا"),
    (r"\bبلش\b",        "بَلَّش"),
    (r"\bنبلش\b",       "نِبْلَش"),

    # ── الأدوات / الروابط ──────────────────────────────────────────────────
    (r"\bمشان\b",       "مِشَان"),
    (r"\bعشان\b",       "عَشَان"),
    (r"\bبس\b",         "بَس"),
    (r"\bلمّن\b",       "لَمَّن"),
    (r"\bلمن\b",        "لَمَّن"),         # missing-shadda variant
    (r"\bكمان\b",       "كَمَان"),
    (r"\bبرضه\b",       "بَرْضُه"),
    (r"\bمتل\b",        "مِتْل"),
    (r"\bزي\b",         "زَي"),
    (r"\bيعني\b",       "يَعْنِي"),
    (r"\bمشانهيك\b",    "مِشَان هَيْك"),    # word-fusion guard

    # ── الاستفهام ───────────────────────────────────────────────────────────
    (r"\bشو\b",         "شُو"),
    (r"\bوين\b",        "وِين"),
    (r"\bليش\b",        "لِيش"),
    (r"\bمين\b",        "مِين"),
    (r"\bكيفك\b",       "كِيفَك"),
    (r"\bكيفكم\b",      "كِيفْكُم"),
    (r"\bكيفاش\b",      "كِيفَاش"),
    (r"\bكيف\b",        "كِيف"),
    (r"\bإيمتى\b",      "إِيمْتَى"),
    (r"\bامتى\b",       "إِيمْتَى"),
    (r"\bقديش\b",       "قَدِّيش"),

    # ── الإثبات / النفي ─────────────────────────────────────────────────────
    (r"\bآه\b",         "آه"),
    (r"\bأيوا\b",       "أَيْوَا"),
    (r"\bعنجد\b",       "عَنْجَد"),
    (r"\bفعلياً\b",     "فِعْلِيَّاً"),
    (r"\bوالله\b",      "وَاللَّه"),
    (r"\bمو\b",         "مُو"),
    (r"\bمش\b",         "مِش"),
    (r"\bأبداً\b",      "أَبَدَاً"),

    # ── الإشارة / الأشياء ──────────────────────────────────────────────────
    (r"\bهاي\b",        "هَاي"),
    (r"\bهاد\b",        "هَاد"),
    (r"\bهيك\b",        "هِيْك"),
    (r"\bهون\b",        "هُون"),
    (r"\bهنيك\b",       "هْنِيك"),
    (r"\bإشي\b",        "إِشِي"),
    (r"\bاشي\b",        "إِشِي"),
    (r"\bشي\b",         "شِي"),
    (r"\bكتير\b",       "كْتِير"),
    (r"\bشوي\b",        "شْوَي"),
    (r"\bشوية\b",       "شْوَيَّة"),

    # ── الضمائر العامية ────────────────────────────────────────────────────
    (r"\bإنت\b",        "إِنْت"),
    (r"\bانت\b",        "إِنْت"),
    (r"\bإنتي\b",       "إِنْتِي"),
    (r"\bانتي\b",       "إِنْتِي"),
    (r"\bإحنا\b",       "إِحْنَا"),
    (r"\bاحنا\b",       "إِحْنَا"),

    # ── الصفات / تشجيع ─────────────────────────────────────────────────────
    (r"\bمنيح\b",       "مْنِيح"),
    (r"\bمنيحة\b",      "مْنِيحَة"),
    (r"\bمنيحين\b",     "مْنِيحِين"),
    (r"\bأحسنت\b",      "أَحْسَنْت"),
    (r"\bممتاز\b",      "مُمْتَاز"),
    (r"\bعفيا\b",       "عَفْيَا"),
    (r"\bيسلموا\b",     "يِسْلَمُوا"),
    (r"\bيا غالي\b",    "يَا غَالِي"),
    (r"\bيا كبير\b",    "يَا كْبِير"),
    (r"\bيا بطل\b",     "يَا بَطَل"),

    # ── الأفعال الشائعة ────────────────────────────────────────────────────
    (r"\bبفهم\b",       "بَفْهَم"),
    (r"\bبتفهم\b",      "بِتْفْهَم"),
    (r"\bبيفهم\b",      "بِيِفْهَم"),
    (r"\bبدرس\b",       "بَدْرُس"),
    (r"\bبشتغل\b",      "بَشْتَغِل"),
    (r"\bبروح\b",       "بَرُوح"),
    (r"\bبجي\b",        "بَجِي"),
    (r"\bبشوف\b",       "بَشُوف"),
    (r"\bبحكي\b",       "بَحْكِي"),
    (r"\bبحكيلك\b",     "بَحْكِيلَك"),
    (r"\bبشرحلك\b",     "بَشْرَحْلَك"),
    (r"\bأشرحلك\b",     "أَشْرَحْلَك"),
    (r"\bقلّي\b",       "قِلِّي"),
    (r"\bقللي\b",       "قِلِّي"),
    (r"\bعطني\b",       "عَطْنِي"),
    (r"\bخبّرني\b",     "خَبِّرْنِي"),
    (r"\bخبرني\b",      "خَبِّرْنِي"),
    (r"\bجرّب\b",       "جَرِّب"),

    # ── شائع التركيب ───────────────────────────────────────────────────────
    (r"\bبده وقت\b",    "بِدُّه وَقْت"),
    (r"\bبدي ساعدك\b",  "بِدِّي سَاعْدَك"),
    (r"\bما في\b",      "مَا فِي"),
    (r"\bفي إشي\b",     "فِي إِشِي"),
]


# ══════════════════════════════════════════════════════════════════════════════
# 2. Clitic-prefix tolerant patterns
#    Catches و / ف / ب / ل-prefixed forms of the most common particles.
#    These are NOT covered by the `\bword\b` patterns above because the prefix
#    becomes part of the same Arabic token (no whitespace separator).
# ══════════════════════════════════════════════════════════════════════════════
_CLITIC_PREFIXES = "وف"  # و = "and", ف = "so" — most common

_JORDANIAN_CLITIC_MAP: List[Tuple[str, str]] = [
    # و + word  →  و + diacritized
    (r"\bو(بدي)\b",        "وَبِدِّي"),
    (r"\bو(بدك)\b",        "وَبِدَّك"),
    (r"\bو(بده)\b",        "وَبِدُّه"),
    (r"\bو(بدها)\b",       "وَبِدَّها"),
    (r"\bو(بدنا)\b",       "وَبِدْنَا"),
    (r"\bو(هيك)\b",        "وَهِيْك"),
    (r"\bو(هاي)\b",        "وَهَاي"),
    (r"\bو(هاد)\b",        "وَهَاد"),
    (r"\bو(شو)\b",         "وْشُو"),
    (r"\bو(كمان)\b",       "وْكَمَان"),
    (r"\bو(كتير)\b",       "وْكْتِير"),
    (r"\bو(لازم)\b",       "وْلَازِم"),
    (r"\bو(يلا)\b",        "وْيَلَّا"),
    (r"\bو(بس)\b",         "وْبَس"),
    # ف + word
    (r"\bف(هيك)\b",        "فْهِيْك"),
    (r"\bف(لازم)\b",       "فْلَازِم"),
    (r"\bف(شو)\b",         "فْشُو"),
]


# ══════════════════════════════════════════════════════════════════════════════
# 3. Sun-letter "ال" → shadda enforcement
#    MSA convention: ال + sun letter assimilates the lām ⇒ shadda on next letter.
#    Many LLM outputs omit the shadda (cosmetic), and TTS reads it as /al/ which
#    sounds slightly off in Levantine.  Adding the shadda nudges pronunciation.
# ══════════════════════════════════════════════════════════════════════════════
_SUN_LETTERS = "تثدذرزسشصضطظلن"
_SHADDA_CHAR = "\u0651"  # ّ
_SUN_LETTER_RE = re.compile(
    rf"(\bال)([{_SUN_LETTERS}])(?![\u064B-\u0652\u0670])"  # not already vowel-marked
)


def _apply_sun_letter_shadda(text: str) -> str:
    """Add shadda after `ال` when followed by a sun letter without diacritics."""
    # Use a callable replacement so the shadda char isn't interpreted as a regex backslash escape.
    return _SUN_LETTER_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{_SHADDA_CHAR}", text)


# ══════════════════════════════════════════════════════════════════════════════
# 4. Optional Q→G (Bedouin / rural Jordanian)  —  env-flag controlled
#    When `JORDANIAN_QAF_TO_GAF=true` we swap ق with گ (kāf with diacritic-3) so
#    Edge TTS's Arabic engine articulates a hard /g/ instead of a glottal /q/.
#    NOTE:  this changes orthography and is OFF by default — most BTEC tutoring
#    contexts in EDUVERSE use urban Amman Levantine where ق → glottal stop /ʔ/.
# ══════════════════════════════════════════════════════════════════════════════
def _qaf_to_gaf_enabled() -> bool:
    return (os.getenv("JORDANIAN_QAF_TO_GAF", "false") or "").strip().lower() in (
        "1", "true", "yes",
    )


_QG_KEEP_TOKENS = {
    # Don't transform ق → گ inside religious / academic terms commonly read as MSA.
    "القرآن", "القران", "الله", "اللهم",
}

_QAF_BOUNDARY_RE = re.compile(r"\bق")


def _maybe_qaf_to_gaf(text: str) -> str:
    if not _qaf_to_gaf_enabled():
        return text
    # Quick guard: never transform inside the keep-tokens list.
    parts = re.split(r"(\s+)", text)
    out = []
    for token in parts:
        if token in _QG_KEEP_TOKENS:
            out.append(token)
        else:
            out.append(_QAF_BOUNDARY_RE.sub("گ", token))
    return "".join(out)


# ══════════════════════════════════════════════════════════════════════════════
# 5. Final-pass: case-ending / tanween cleanup (Levantine pause form)
#    Levantine speech drops final case-ending tanween (`ٌ ٍ ً`) on most words.
#    Removing them prevents the TTS from voicing the case ending.
# ══════════════════════════════════════════════════════════════════════════════
_FINAL_TANWEEN_RE = re.compile(r"[\u064B\u064C\u064D](?=\s|$|[\.,!\?؟،])")


def _strip_final_tanween(text: str) -> str:
    return _FINAL_TANWEEN_RE.sub("", text)


# ══════════════════════════════════════════════════════════════════════════════
# 6. Compile patterns once at import time for efficiency
# ══════════════════════════════════════════════════════════════════════════════
_COMPILED_MAP: List[Tuple[re.Pattern, str]] = [
    (re.compile(p), repl) for p, repl in _JORDANIAN_PHONETIC_MAP
]
_COMPILED_CLITIC: List[Tuple[re.Pattern, str]] = [
    (re.compile(p), repl) for p, repl in _JORDANIAN_CLITIC_MAP
]


# ══════════════════════════════════════════════════════════════════════════════
# 7. Public API
# ══════════════════════════════════════════════════════════════════════════════
def apply_jordanian_phonetics(
    text: str,
    *,
    enabled: bool = True,
    skip_if_already_diacritized: bool = True,
    diacritic_threshold: float = 0.15,
) -> str:
    """Apply Jordanian phonetic transformations for TTS pronunciation.

    Args:
        text: Source text (already lexically Jordanized — see
              `tutor._apply_jordanize_pipeline`).
        enabled: Master kill-switch; pass False to bypass entirely.
        skip_if_already_diacritized: Don't double-diacritize when the LLM
              already produced ≥ `diacritic_threshold` density.  Default ON.
        diacritic_threshold: 0..1 fraction of Arabic chars that are tashkeel.

    Returns:
        Phonetically-enhanced text suitable for an Arabic TTS engine.
        Idempotent: applying twice yields the same result.
    """
    if not enabled or not text:
        return text or ""

    # Skip if the LLM already provided thorough diacritization.
    if skip_if_already_diacritized and _tashkeel_density(text) >= diacritic_threshold:
        return text

    out = text

    # 1. Whole-word phonetic substitutions.
    for pattern, repl in _COMPILED_MAP:
        out = pattern.sub(repl, out)

    # 2. Common clitic-prefix variants (و..., ف...).
    for pattern, repl in _COMPILED_CLITIC:
        out = pattern.sub(repl, out)

    # 3. ال + sun letter → add shadda.
    out = _apply_sun_letter_shadda(out)

    # 4. Drop final case-ending tanween (Levantine pause form).
    out = _strip_final_tanween(out)

    # 5. Optional Q → G (Bedouin variant).  Default OFF.
    out = _maybe_qaf_to_gaf(out)

    return out


# Convenience re-export for symmetry with the user-facing spec name.
def filter_for_tts(text: str) -> str:
    """Production entry point — same as `apply_jordanian_phonetics(text)`.

    Reads kill-switch from env: `PHONETIC_FILTER_DISABLED=true` bypasses.
    """
    if (os.getenv("PHONETIC_FILTER_DISABLED", "false") or "").strip().lower() in (
        "1", "true", "yes",
    ):
        return text
    return apply_jordanian_phonetics(text)
