# -*- coding: utf-8 -*-
"""
Azure Neural TTS Service — Jordanian Arabic (ar-JO-OmarNeural / ar-JO-MaysoonNeural)
==================================================================================
Synthesizes SSML using the Azure Speech SDK and returns raw MP3 bytes, 
along with precise temporal viseme (lip-sync) and word boundary cues.

تم تحسين الأداء عبر إعادة استخدام SpeechSynthesizer مع قفل (Lock) لضمان السلامة في البيئات متعددة الخيوط.
تم إضافة نظام اصطياد الأحداث (Visemes & Word Boundaries) لربط عصب النطق مع الأفاتار 3D.
Default voice:  ar-JO-TaimNeural   (male, Dr. Hamza — confirmed working in eastus)
Rare fallback:  ar-JO-SanaNeural   (female — confirmed working in eastus)

Install:
    pip install azure-cognitiveservices-speech>=1.37.0
"""
from __future__ import annotations

import asyncio
import functools
import logging
import os
import random
import re as _re
import uuid
from typing import Optional, Tuple, List, Dict, Any
from xml.sax.saxutils import escape as _xml_sax_escape

try:
    import azure.cognitiveservices.speech as speechsdk
    _SDK_AVAILABLE = True
except ImportError:
    speechsdk = None
    _SDK_AVAILABLE = False
    logging.warning(
        "[AzureTTS] azure-cognitiveservices-speech not installed. "
        "Run: pip install azure-cognitiveservices-speech>=1.37.0"
    )

logger = logging.getLogger(__name__)


def is_azure_tts_auth_failure(exc: BaseException) -> bool:
    """
    True when Azure Speech SDK / REST error indicates invalid key, subscription, or auth.
    Used to force edge-tts/gTTS even if TTS_DISABLE_NON_AZURE_FALLBACK is set.
    """
    s = str(exc).lower()
    c = s.replace(" ", "")
    if "401" in s or "403" in s:
        return True
    if any(
        x in s
        for x in (
            "authentication",
            "unauthorized",
            "invalid api key",
            "access denied",
            "permission denied",
        )
    ):
        return True
    if "invalidsubscription" in c or "authenticationfailure" in c:
        return True
    return False


def _locked_jordanian_male_voice(requested: Optional[str]) -> str:
    """
    Cogni policy: locked male Jordanian neural (COGNI_ARABIC_TTS_VOICE_LOCKED).
    When TTS_FORCE_JORDANIAN is True, reject any voice name that does not contain ``ar-JO``.
    """
    try:
        from app.core.config import settings as _cfg

        locked = str(getattr(_cfg, "COGNI_ARABIC_TTS_VOICE_LOCKED", "ar-JO-TaimNeural") or "ar-JO-TaimNeural")
        force_jo = bool(getattr(_cfg, "TTS_FORCE_JORDANIAN", True))
    except Exception:
        locked = "ar-JO-TaimNeural"
        force_jo = True
    r = (requested or "").strip()
    if not force_jo:
        return r or locked
    if r and "ar-JO" not in r:
        logger.warning(
            "[AzureTTS] Non-Jordanian voice %r rejected — using locked Jordanian %s",
            r,
            locked,
        )
        r = ""
    eff = r or locked
    if eff != locked:
        logger.warning("[AzureTTS] Voice %r overridden — Cogni uses locked male Jordanian %s", eff, locked)
    return locked


# ── §3  SSML builder — Jordanian Arabic + English term handler ────────────────
#
# Design decisions:
#   1. We do NOT convert Jordanian colloquial words (هيك, كتير, يلا …) to MSA.
#      ar-JO-OmarNeural is trained on Jordanian dialect; this is the verified male voice
#      MSA made it sound Egyptian/formal.  Let the voice model do its job.
#
#   2. English tokens (PESTLE, SWOT, BTEC, …) are wrapped in
#      <lang xml:lang="en-GB"> so Azure applies English phonetics instead of
#      Arabic-letter-reading them (which produced "بيست" for PESTLE).
#      All-caps acronyms also get <say-as interpret-as="spell-out"> so they are
#      read letter-by-letter: P-E-S-T-L-E.
#
#   3. Style changed from "customerservice" → "friendly":
#      "friendly" is fully supported by ar-JO-TaimNeural and keeps the warm,
#      conversational Jordanian persona without risking Azure falling back to a
#      neutral/MSA style (which "customerservice" can trigger on JO voices).

# Sentence/clause boundary punctuation (captured for segmentation)
_SENT_BOUNDARY = _re.compile(r'([.،؟!؟\n]+)\s*')

# Any run of ASCII letters/digits (possibly hyphenated) = candidate English token
_EN_TOKEN   = _re.compile(r'([A-Za-z][A-Za-z0-9]*(?:[/-][A-Za-z0-9]+)*)')


def _is_all_ascii(s: str) -> bool:
    return bool(s) and all(ord(c) < 128 for c in s)
# All-uppercase abbreviation: PESTLE, SWOT, BTEC, KPI, GDP …
_ACRONYM_RE = _re.compile(r'^[A-Z][A-Z0-9]{1,}$')

# XML 1.0 — disallow control chars except TAB / LF / CR (Azure SSML parser rejects them).
_INVALID_XML_CHAR_RE = _re.compile("[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]")


def _xml_escape(s: str) -> str:
    """Escape XML special characters in a plain-text node (SSML-safe)."""
    if not s:
        return ""
    return _xml_sax_escape(s, {'"': '&quot;', "'": '&apos;'})


def _strip_invalid_xml_chars(s: str) -> str:
    """Remove characters that are illegal in XML 1.0 text (prevents Azure 0x80045003 SSML errors)."""
    if not s:
        return ""
    return _INVALID_XML_CHAR_RE.sub("", s)


def _split_segments(text: str) -> list[tuple[str, str]]:
    """
    Split *text* into ``('ar', …)`` and ``('en', …)`` segments.
    Short Latin snippets (≤2 letter-runs) stay in the Arabic stream so the Jordanian
    voice does not switch to en-GB mid-phrase. Longer English phrases get ``<lang en-GB>``.
    """
    segments: list[tuple[str, str]] = []
    last = 0
    for m in _EN_TOKEN.finditer(text):
        if m.start() > last:
            segments.append(('ar', text[last:m.start()]))
        en_run = m.group()
        # Wrap en-GB only for pure-ASCII runs longer than 3 chars (short tokens stay on ar-JO voice)
        if len(en_run.strip()) > 3 and _is_all_ascii(en_run):
            segments.append(('en', en_run))
        else:
            if segments and segments[-1][0] == 'ar':
                segments[-1] = ('ar', segments[-1][1] + en_run)
            else:
                segments.append(('ar', en_run))
        last = m.end()
    if last < len(text):
        tail = text[last:]
        if segments and segments[-1][0] == 'ar':
            segments[-1] = ('ar', segments[-1][1] + tail)
        else:
            segments.append(('ar', tail))
    return segments


def _render_segment(kind: str, content: str) -> str:
    """
    Convert one text segment to its SSML representation.

    * Arabic segments → plain XML-escaped text (TaimNeural handles dialect natively).
    * English acronyms (ALL-CAPS, ≥2 letters) → spelled letter-by-letter inside
      ``<lang xml:lang="en-GB"><say-as interpret-as="spell-out">``.
    * Long English phrases (>2 letter-runs in a segment) → ``<lang xml:lang="en-GB">``.
    * Short Latin snippets stay in the Arabic stream (same Jordanian neural voice).
    """
    safe = _xml_escape(content)
    if kind == 'ar':
        return safe
    if _ACRONYM_RE.match(content):
        return (
            f'<lang xml:lang="en-GB">'
            f'<say-as interpret-as="spell-out">{safe}</say-as>'
            f'</lang>'
        )
    return f'<lang xml:lang="en-GB">{safe}</lang>'


def _plain_chunk_to_ssml(chunk: str) -> str:
    """Convert a plain-text chunk (no boundary punctuation) to SSML inner XML."""
    return ''.join(_render_segment(k, v) for k, v in _split_segments(chunk))


_SLOT_MARK = "\uffffSLOT{}\uffff"


def _extract_ssml_placeholders(text: str) -> tuple[str, list[str]]:
    """Move inline SSML fragments out before bracket/markdown stripping; restore later."""
    slots: list[str] = []
    t = text

    def _grab(pat: _re.Pattern[str]) -> None:
        nonlocal t

        def _sub(m: _re.Match[str]) -> str:
            slots.append(m.group(0))
            return _SLOT_MARK.format(len(slots) - 1)

        t = pat.sub(_sub, t)

    for pat in (
        _re.compile(r"<break\b[^>]*/\s*>", _re.I),
        _re.compile(r"<prosody\b[^>]*>.*?</prosody>", _re.I | _re.S),
        _re.compile(r"<say-as\b[^>]*>.*?</say-as>", _re.I | _re.S),
        _re.compile(r"<lang\b[^>]*>.*?</lang>", _re.I | _re.S),
        _re.compile(r"<phoneme\b[^>]*>.*?</phoneme>", _re.I | _re.S),
        _re.compile(r"<emphasis\b[^>]*>.*?</emphasis>", _re.I | _re.S),
    ):
        _grab(pat)
    return t, slots


_SLOT_REF = _re.compile(r"\uffffSLOT(\d+)\uffff")


def _chunk_to_ssml_with_slots(chunk: str, slots: list[str]) -> str:
    """Escape plain Arabic/English runs; pass through preserved SSML slots verbatim."""
    if not slots:
        return _plain_chunk_to_ssml(chunk)
    out: list[str] = []
    pos = 0
    for m in _SLOT_REF.finditer(chunk):
        head = chunk[pos:m.start()]
        if head.strip():
            out.append(_plain_chunk_to_ssml(head))
        idx = int(m.group(1))
        if 0 <= idx < len(slots):
            out.append(slots[idx])
        pos = m.end()
    tail = chunk[pos:]
    if tail.strip():
        out.append(_plain_chunk_to_ssml(tail))
    return "".join(out)


def _clean_tts_text(text: str) -> str:
    """
    Final defensive pass: strip all formatting markers before passing text to Azure.

    **Arabic diacritics (tashkeel, U+064B–U+065F and U+0670) are preserved** — never strip them;
    ar-JO-TaimNeural uses them for stable Jordanian pronunciation.

    agent_ws.py already strips emotion/action tags via _parse_reply(), but edge cases
    still reach here — e.g. multi-word emotion names (\x5bEMOTION: strict evaluation\x5d),
    lowercase variants (\x5bemotion: sad\x5d), nested brackets, or markdown that the LLM
    occasionally outputs inside the dialogue line.  Azure TTS reads every character it
    receives, so ANY residual bracket/asterisk content produces unintended English speech.

    Strips:
      - [EMOTION: tag], [ACTION: ...] and ANY [...] sequence regardless of content
      - *action stage directions* and **bold** markers (1 or 2 asterisks)
      - __underscore emphasis__
      - Redundant whitespace / blank lines produced by the above deletions
    """
    # Remove any [...] block (greedy-safe: max 300 chars, no nested brackets)
    text = _re.sub(r'\[[^\]]{0,300}\]', '', text)
    # Remove *...* and **...** blocks (action lines, markdown bold)
    text = _re.sub(r'\*{1,2}[^*]{0,400}\*{1,2}', '', text)
    # Remove __emphasis__
    text = _re.sub(r'_{2}[^_]{0,200}_{2}', '', text)
    # Latin brand names → Arabic script so _split_segments() does NOT wrap them in
    # <lang xml:lang="en-GB"> (same ar-JO neural voice then sounds like a "second
    # speaker" mid-sentence when English phonetics kick in).
    text = _re.sub(r'(?i)\bcogni\b', 'كوجني', text)
    text = _re.sub(r'(?i)\beduverse\b', 'إيدوفيرس', text)
    text = _re.sub(r'(?i)\basas\b', 'أساس', text)

    # Markdown line headers (# …) and stray bold markers often leak from the LLM
    text = _re.sub(r'(?m)^#{1,6}\s+', '', text)
    text = _re.sub(r'`{1,3}[^`]{0,2000}`{1,3}', '', text)
    text = _re.sub(r'\*{2,}', '', text)

    # Collapse extra spaces / blank lines left by the deletions above
    text = _re.sub(r'[ \t]{2,}', ' ', text)
    text = _re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def _prepare_tts_text(raw: str) -> tuple[str, list[str]]:
    """Strip markdown/brackets while preserving LLM inline SSML (break, prosody, …)."""
    t, slots = _extract_ssml_placeholders((raw or "").strip())
    t = _clean_tts_text(t)
    t = _strip_invalid_xml_chars(t)
    slots = [_strip_invalid_xml_chars(s) for s in slots]
    return t, slots


def _plain_text_for_edge_tts_from_prepared(cleaned: str) -> str:
    """Strip SSML slot placeholders so edge-tts receives speakable plain text only."""
    t = _SLOT_REF.sub(" ", cleaned or "")
    t = _re.sub(r"\s+", " ", t).strip()
    return t


# ── Edge TTS (Microsoft Edge online — same neural voice IDs as Azure, no subscription) ──
# Jordanian male + regional fallbacks if a voice is unavailable (after TTS_EDGE_FALLBACK_VOICE).
_BASE_EDGE_VOICE_FALLBACKS: tuple[str, ...] = (
    "ar-JO-TaimNeural",
    "ar-JO-OmarNeural",
    "ar-JO-HamedNeural",
    "ar-SA-HamedNeural",
)

_ARABIC_VISEME_EDGE: dict[str, int] = {
    "ا": 2,
    "أ": 2,
    "إ": 2,
    "آ": 2,
    "ب": 21,
    "پ": 21,
    "ت": 19,
    "ط": 19,
    "ث": 17,
    "ج": 16,
    "ح": 12,
    "ه": 12,
    "خ": 20,
    "غ": 20,
    "ق": 20,
    "ك": 20,
    "د": 19,
    "ض": 19,
    "ذ": 17,
    "ظ": 17,
    "ر": 13,
    "ز": 15,
    "س": 15,
    "ص": 15,
    "ش": 16,
    "ع": 2,
    "ف": 18,
    "ل": 14,
    "م": 21,
    "ن": 19,
    "و": 7,
    "ي": 6,
    "ى": 6,
    "ة": 19,
    "ء": 1,
}


def _word_first_viseme_edge(word: str) -> int:
    for ch in word:
        if ch in _ARABIC_VISEME_EDGE:
            return _ARABIC_VISEME_EDGE[ch]
        if ch.isalpha():
            return 1
    return 0


EDGE_TTS_EMOTION_PROSODY: dict[str, dict[str, str]] = {
    "neutral": {"rate": "+0%", "pitch": "+0Hz"},
    "friendly": {"rate": "+4%", "pitch": "+5Hz"},
    "thinking": {"rate": "-14%", "pitch": "-5Hz"},
    "encouraging": {"rate": "+10%", "pitch": "+7Hz"},
    "strict": {"rate": "-8%", "pitch": "-8Hz"},
    "celebrate": {"rate": "+18%", "pitch": "+12Hz"},
    "celebrating": {"rate": "+18%", "pitch": "+12Hz"},
    "excited": {"rate": "+12%", "pitch": "+9Hz"},
    "happy": {"rate": "+6%", "pitch": "+5Hz"},
    "proud": {"rate": "+5%", "pitch": "+4Hz"},
    "surprised": {"rate": "+6%", "pitch": "+8Hz"},
    "curious": {"rate": "+3%", "pitch": "+3Hz"},
    "attentive": {"rate": "+1%", "pitch": "+2Hz"},
    "empathetic": {"rate": "-10%", "pitch": "-4Hz"},
    "concerned": {"rate": "-10%", "pitch": "-5Hz"},
    "sad": {"rate": "-14%", "pitch": "-9Hz"},
    "anxious": {"rate": "-6%", "pitch": "-3Hz"},
    "relax": {"rate": "+0%", "pitch": "+0Hz"},
    "calm": {"rate": "+0%", "pitch": "+1Hz"},
    "strictevaluation": {"rate": "-8%", "pitch": "-8Hz"},
}

DEFAULT_EDGE_TTS_PROSODY: dict[str, str] = {"rate": "+0%", "pitch": "+0Hz"}


def edge_tts_cues_to_websocket_shapes(
    word_bounds: List[Dict[str, Any]],
    viseme_events: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Map edge-tts timings to agent_ws / Azure-style viseme_cues + word_cues."""
    word_cues = [
        {"t": int(max(0.0, float(w.get("start_time", 0)))), "w": w.get("word", "")}
        for w in word_bounds
    ]
    viseme_cues = [
        {"t": int(max(0.0, float(v.get("offset_ms", 0)))), "id": int(v.get("viseme_id", 0))}
        for v in viseme_events
    ]
    return viseme_cues, word_cues


def approx_viseme_cues_from_word_cues(
    word_cues: List[Dict[str, Any]],
    dialogue: str,
) -> List[Dict[str, Any]]:
    """
    Build Azure-style viseme_cues ({t, id}) from word boundary timings when the SDK
    produced word_cues but an empty viseme stream. Uses the same time base as the
    audio (no second synthesis).
    """
    if not word_cues:
        return []
    sorted_w = sorted(word_cues, key=lambda x: int(x.get("t", 0) or 0))
    if not sorted_w:
        return []
    d = (dialogue or "").strip()
    est_end = int(sorted_w[-1].get("t", 0) or 0) + max(
        250, min(8000, len(d) * 42 if d else 600)
    )
    cues: List[Dict[str, Any]] = []
    for i, w in enumerate(sorted_w):
        t = int(max(0, w.get("t", 0) or 0))
        next_t = int(sorted_w[i + 1].get("t", 0) or 0) if i + 1 < len(sorted_w) else est_end
        span = max(80, next_t - t)
        cues.append({"t": t, "id": 4})
        mid = t + min(140, max(50, span // 3))
        cues.append({"t": mid, "id": 12})
        tail = min(next_t - 15, mid + min(90, span // 2))
        if tail > mid:
            cues.append({"t": tail, "id": 0})
    return cues


async def synthesize_edge_tts_mp3(
    raw_text: str,
    rate: str = "+0%",
    pitch: str = "+0Hz",
    voice: Optional[str] = None,
) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Synthesize via edge-tts streaming. Returns (mp3_bytes, word_timings, viseme_events).
    word_timings: [{word, start_time, end_time}] in ms; viseme_events: [{offset_ms, viseme_id}].
    """
    import edge_tts

    cleaned, _slots = _prepare_tts_text((raw_text or "").strip())
    plain = _plain_text_for_edge_tts_from_prepared(cleaned)
    if not plain:
        raise ValueError("edge-tts: empty text after cleanup")

    locked = _locked_jordanian_male_voice(voice)
    try:
        from app.core.config import settings as _cfg

        edge_fb = str(getattr(_cfg, "TTS_EDGE_FALLBACK_VOICE", "ar-JO-TaimNeural") or "ar-JO-TaimNeural")
    except Exception:
        edge_fb = "ar-JO-TaimNeural"
    voices: list[str] = []
    for v in (locked, edge_fb, *_BASE_EDGE_VOICE_FALLBACKS):
        if v and v not in voices:
            voices.append(v)

    last_err: Optional[BaseException] = None
    for vn in voices:
        try:
            communicate = edge_tts.Communicate(plain, vn, rate=rate, pitch=pitch)
            audio_chunks: List[bytes] = []
            word_bounds: List[Dict[str, Any]] = []

            async for chunk in communicate.stream():
                ctype = chunk.get("type")
                if ctype == "audio":
                    audio_chunks.append(chunk["data"])
                elif ctype in ("WordBoundary", "SentenceBoundary"):
                    offset_ms = chunk.get("offset", 0) / 10_000
                    dur_ms = chunk.get("duration", 0) / 10_000
                    word_bounds.append(
                        {
                            "word": chunk.get("text", ""),
                            "start_time": offset_ms,
                            "end_time": offset_ms + dur_ms,
                        }
                    )

            if not audio_chunks:
                raise RuntimeError("edge-tts returned no audio")

            mp3_bytes = b"".join(audio_chunks)
            viseme_events: List[Dict[str, Any]] = []
            for wb in word_bounds:
                word = wb["word"]
                open_ms = max(0.0, wb["start_time"] - 30)
                vid = _word_first_viseme_edge(str(word))
                if vid != 0:
                    viseme_events.append({"offset_ms": open_ms, "viseme_id": vid})
                viseme_events.append({"offset_ms": wb["end_time"], "viseme_id": 0})

            logger.info(
                "[EdgeTTS] OK voice=%s bytes=%d words=%d",
                vn,
                len(mp3_bytes),
                len(word_bounds),
            )
            return mp3_bytes, word_bounds, viseme_events
        except Exception as e:
            last_err = e
            logger.warning("[EdgeTTS] voice %s failed: %s", vn, e)

    raise RuntimeError(f"edge-tts: all voices failed ({last_err!s})")


# ── Emotion → SSML prosody mapping ─────────────────────────────────────────
# Tuple: (rate_float, styledegree_str, pitch_str)
# styledegree controls Azure express-as style intensity (0.0 – 2.0).
# pitch_str is a relative percentage applied globally to the utterance.
_EMOTION_PROSODY: dict[str, tuple[float, str, str]] = {
    'thinking':    (0.80, '0.9', '+1%'),
    'sad':         (0.82, '1.0', '-2%'),
    'concerned':   (0.86, '1.0', '+0%'),
    'empathetic':  (0.87, '1.1', '+1%'),
    'strict':      (0.87, '1.3', '+0%'),
    'calm':        (0.92, '1.0', '+1%'),
    'relax':       (0.92, '1.0', '+1%'),
    'neutral':     (0.93, '1.0', '+2%'),
    'attentive':   (0.97, '1.1', '+2%'),
    'curious':     (0.97, '1.1', '+2%'),
    'friendly':    (0.97, '1.2', '+2%'),
    'proud':       (1.00, '1.3', '+2%'),
    'happy':       (1.02, '1.4', '+3%'),
    'encouraging': (1.05, '1.5', '+3%'),
    'excited':     (1.10, '1.8', '+4%'),
    'surprised':   (1.08, '1.6', '+4%'),
    'celebrate':   (1.12, '2.0', '+5%'),
    'celebration': (1.12, '2.0', '+5%'),
}


def _build_ssml(
    text: str,
    voice_name: str,
    rate: float = 0.95,
    emotion: str = 'neutral',
    persona_level: str = 'pass',
    *,
    ssml_slots: Optional[List[str]] = None,
    client_voice_rate: float = 1.0,
    client_pitch_scale: float = 1.0,
) -> str:
    """
    Build production-quality SSML for ar-JO-TaimNeural:

    • ``mstts:express-as style="friendly"``  — warm, conversational Jordanian tone
    • English acronyms (PESTLE/SWOT/BTEC…) → spelled letter-by-letter in en-GB
    • Other English words → en-GB phonetics (no more Arabic letter-reading)
    • Sentence-boundary breath pauses (200–320 ms)
    • Questions → ``<prosody pitch="+8%">`` for natural Arabic intonation rise
    • Emotion-aware rate/styledegree/pitch via _EMOTION_PROSODY table
    • Persona-level rate multiplier and pitch wrapper (Triple-Persona Engine)
    """
    # Override rate/styledegree/pitch from emotion table when emotion is known
    prosody_entry = _EMOTION_PROSODY.get((emotion or 'neutral').lower())
    if prosody_entry:
        rate, styledegree, pitch_extra = prosody_entry
    else:
        styledegree = '1.2'
        pitch_extra = '+2%'

    # ── Triple-Persona Engine: apply level-based rate multiplier and pitch wrapper ──
    # Pass: warm/funny → slightly faster, high pitch (+5%)
    # Merit: serious academic → professional pace, neutral pitch
    # Distinction: challenger → noticeably faster, deep pitch (-10%)
    _PERSONA_RATE_MUL = {'pass': 1.10, 'merit': 1.08, 'distinction': 1.15}
    _PERSONA_PITCH    = {'pass': '+5%', 'merit': '+0%', 'distinction': '-10%'}
    persona_rate_mul = _PERSONA_RATE_MUL.get((persona_level or 'pass').lower(), 1.0)
    persona_pitch    = _PERSONA_PITCH.get((persona_level or 'pass').lower(), '+0%')
    # Persona rate × client (Cogni voice_defaults.rate from frontend persona_init)
    _cvr = max(0.72, min(1.22, float(client_voice_rate or 1.0)))
    _cps = max(0.88, min(1.18, float(client_pitch_scale or 1.0)))
    effective_mul = max(0.5, min(1.35, persona_rate_mul * _cvr))
    _p_offset = round((effective_mul - 1.0) * 100)
    rate_pct = f"+{_p_offset}%" if _p_offset >= 0 else f"{_p_offset}%"

    # Nudge pitch from client pitchScale (e.g. 1.02 → +~1%)
    pitch_extra_num = 0.0
    pe = (pitch_extra or "+0%").strip()
    _pct = _re.match(r"^([+-]?)([0-9]*\.?[0-9]+)\s*%$", pe)
    if _pct:
        sign, num_s = _pct.group(1), _pct.group(2)
        try:
            pitch_extra_num = float(num_s)
            if sign == "-":
                pitch_extra_num = -abs(pitch_extra_num)
        except ValueError:
            pitch_extra_num = 2.0
    elif pe:
        pitch_extra_num = 2.0
    pitch_extra_num += round((_cps - 1.0) * 100) * 0.15
    pitch_extra_adj = f"+{pitch_extra_num}%" if pitch_extra_num >= 0 else f"{pitch_extra_num:.1f}%"

    slots = ssml_slots or []

    tokens = _SENT_BOUNDARY.split(text)
    ssml_parts: list[str] = []
    i = 0
    while i < len(tokens):
        chunk = tokens[i].strip()
        i += 1
        punct = tokens[i].strip() if i < len(tokens) else ''
        if punct:
            i += 1

        if not chunk and not punct:
            continue

        chunk_ssml = _chunk_to_ssml_with_slots(chunk, slots) if chunk else ''
        is_question = bool(punct) and ('؟' in punct or '?' in punct)

        if chunk_ssml:
            # Emotional prosody: micro-pause after laughter (ههه…) — sounds less "flat"
            if _re.search(r'ه{3,}', chunk):
                chunk_ssml += '<break time="200ms"/>'
            # V29 — per-sentence pitch variation (±2%) + question rise with jitter
            _pv = round(random.uniform(-2.0, 2.0), 1)
            if is_question:
                _pv = round(8.0 + random.uniform(-1.0, 1.0), 1)
                _pp = f"+{_pv:.1f}%" if _pv >= 0 else f"{_pv:.1f}%"
                ssml_parts.append(
                    f'<prosody pitch="{_pp}">{chunk_ssml}{_xml_escape(punct)}</prosody>'
                )
            else:
                _pp = f"+{_pv:.1f}%" if _pv >= 0 else f"{_pv:.1f}%"
                ssml_parts.append(
                    f'<prosody pitch="{_pp}">{chunk_ssml}{_xml_escape(punct) if punct else ""}</prosody>'
                )

        if punct and i < len(tokens):
            pause_ms = 320 if ('.' in punct or '\n' in punct) else 200
            # Slightly longer breath pauses when "thinking" / empathetic (less robotic)
            emo_l = (emotion or "neutral").lower()
            if emo_l in ("thinking", "concerned", "empathetic", "sad"):
                pause_ms = min(420, pause_ms + 90)
            # V29 — random micro-pauses (human hesitation) before breath pause
            _micro = ""
            if random.random() < 0.3:
                _micro = f'<break time="{50 if random.random() < 0.5 else 100}ms"/>'
            ssml_parts.append(_micro + f'<break time="{pause_ms}ms"/>')

    body = '\n'.join(ssml_parts)
    # Azure rejects / cancels when inner prosody is empty (0 audio) — e.g. punctuation-only cleanup.
    if not body.strip():
        body = _plain_chunk_to_ssml(_xml_escape((text or "").strip() or "…"))

    # Wrap body in persona pitch prosody (skip wrapper when pitch is neutral)
    if persona_pitch and persona_pitch != '+0%':
        body = f'<prosody pitch="{persona_pitch}">{body}</prosody>'

    try:
        from app.core.config import settings as _settings
        _cfg_voice = getattr(_settings, "TTS_ARABIC_VOICE", voice_name)
    except Exception:
        _cfg_voice = voice_name
    logger.info(
        "[AzureTTS] SSML voice in use: %s (settings.TTS_ARABIC_VOICE=%s) emotion=%s",
        voice_name,
        _cfg_voice,
        emotion,
    )

    return (
        f'<speak version="1.0" '
        f'xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" '
        f'xml:lang="ar-JO">'
        f'<voice name="{voice_name}" xml:lang="ar-JO">'
        f'<mstts:express-as style="friendly" styledegree="{styledegree}" xml:lang="ar-JO">'
        f'<prosody rate="{rate_pct}" pitch="{pitch_extra_adj}">'
        f'{body}'
        f'</prosody>'
        f'</mstts:express-as>'
        f'</voice>'
        f'</speak>'
    )


class AzureTTSService:
    """
    Thread‑safe Azure TTS service using a persistent synthesizer with a lock.
    """

    def __init__(
        self,
        speech_key: Optional[str] = None,
        speech_region: Optional[str] = None,
        default_voice: Optional[str] = None,
        prosody_rate: float = 1.05,
        request_timeout: float = 15.0,
    ) -> None:
        self._key = speech_key
        self._region = speech_region
        self._prosody_rate = prosody_rate
        self._timeout = request_timeout

        self._speech_config = None
        self._synthesizer = None  # persistent synthesizer for low latency
        self._config_lock = asyncio.Lock()   # lock for creating/changing config
        self._synthesis_lock = asyncio.Lock() # lock for actual synthesis (thread safety)

        # Fail fast at construction: missing Azure Speech env → no synthesis until configured
        try:
            from app.core.config import settings as _settings

            _k = (self._key if self._key is not None else _settings.AZURE_SPEECH_KEY) or ""
            _r = (self._region if self._region is not None else _settings.AZURE_SPEECH_REGION) or ""
            _k = str(_k).replace("\ufeff", "").replace("\u200b", "").strip()
            _r = str(_r).replace("\ufeff", "").replace("\u200b", "").strip()
            self._available = bool(_k and _r)
            dv = default_voice if default_voice is not None else getattr(_settings, "TTS_ARABIC_VOICE", None)
            self._default_voice = _locked_jordanian_male_voice(dv)
        except Exception:
            self._available = bool(speech_key and speech_region)
            self._default_voice = _locked_jordanian_male_voice(default_voice)
        if not self._available:
            logger.error(
                "[AzureTTS] Azure Speech disabled — set non-empty AZURE_SPEECH_KEY and AZURE_SPEECH_REGION "
                "(see app/core/config.py)."
            )

    async def _ensure_synthesizer(self):
        """
        Lazily create the SpeechConfig and SpeechSynthesizer.
        This method is thread-safe via _config_lock.
        """
        async with self._config_lock:
            if self._synthesizer is not None:
                return self._synthesizer

            if self._key is None or self._region is None:
                from app.core.config import settings
                self._key = self._key or settings.AZURE_SPEECH_KEY
                self._region = self._region or settings.AZURE_SPEECH_REGION

            self._key = str(self._key or "").replace("\ufeff", "").replace("\u200b", "").strip()
            self._region = str(self._region or "").replace("\ufeff", "").replace("\u200b", "").strip()
            if not self._key or not self._region:
                raise RuntimeError(
                    "Azure Speech credentials missing. Provide them in constructor "
                    "or set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in environment."
                )

            config = speechsdk.SpeechConfig(
                subscription=self._key,
                region=self._region,
            )
            config.set_speech_synthesis_output_format(
                speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3
            )
            self._speech_config = config

            self._synthesizer = speechsdk.SpeechSynthesizer(
                speech_config=self._speech_config,
                audio_config=None,
            )
            logger.info(
                "[AzureTTS] Persistent synthesizer created | region=%s",
                self._region,
            )
            return self._synthesizer

    async def synthesize(
        self,
        text: str,
        voice_name: Optional[str] = None,
        timeout: Optional[float] = None,
        emotion: str = 'neutral',
        persona_level: str = 'pass',
        client_voice_rate: float = 1.0,
        client_pitch_scale: float = 1.0,
        usage_user_id: Optional[uuid.UUID] = None,
    ) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], str]:
        """
        Synthesize *text* to MP3 bytes with temporal cues.

        Args:
            text        : Arabic (or mixed) text to speak.
            voice_name  : Azure neural voice name. If None, uses default.
            timeout     : Override the default request timeout (seconds).

        Returns:
            A tuple containing:
            - Raw MP3 bytes.
            - List of viseme cues [{"t": ms, "id": viseme_id}, ...].
            - List of word boundary cues [{"t": ms, "w": "word"}, ...].
            - Provider id: ``"edge"`` or ``"azure"``.
        """
        raw_in = (text or "").strip()
        try:
            from app.archive.dialect_corrector import maybe_correct_egyptian_for_tts

            text_for_tts = maybe_correct_egyptian_for_tts(raw_in, context="azure_tts_synthesize")
        except Exception:
            text_for_tts = raw_in
        cleaned, slots = _prepare_tts_text(text_for_tts)
        if not cleaned:
            raise ValueError("TTS text cannot be empty after cleanup")

        voice = _locked_jordanian_male_voice(voice_name or self._default_voice)

        from app.core.config import settings as _cfg

        primary = str(getattr(_cfg, "TTS_PRIMARY_PROVIDER", "azure") or "azure").lower().strip()
        plain_edge = _plain_text_for_edge_tts_from_prepared(cleaned)

        async def _synthesize_edge_pack() -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]], str]:
            emo = (emotion or "neutral").lower()
            pros = EDGE_TTS_EMOTION_PROSODY.get(emo, DEFAULT_EDGE_TTS_PROSODY)
            async with self._synthesis_lock:
                mp3_b, wb, ve = await synthesize_edge_tts_mp3(
                    text_for_tts,
                    rate=pros["rate"],
                    pitch=pros["pitch"],
                    voice=voice,
                )
            v_cues, w_cues = edge_tts_cues_to_websocket_shapes(wb, ve)
            if usage_user_id and plain_edge:
                try:
                    from app.services.usage_service import log_tts_usage

                    log_tts_usage(usage_user_id, len(plain_edge))
                except Exception:
                    pass
            logger.info(
                "[TTS] edge-tts | voice=%s | %d bytes | visemes=%d words=%d",
                voice,
                len(mp3_b),
                len(v_cues),
                len(w_cues),
            )
            return mp3_b, v_cues, w_cues, "edge"

        _force_edge = bool(getattr(_cfg, "TTS_FORCE_FALLBACK", False)) or os.getenv(
            "TTS_FORCE_FALLBACK", ""
        ).lower() in ("1", "true", "yes")
        if _force_edge:
            if not plain_edge:
                raise ValueError("TTS_FORCE_FALLBACK: edge-tts cannot synthesize this text after cleanup")
            logger.info("[TTS] TTS_FORCE_FALLBACK — using edge-tts only (Azure skipped)")
            return await _synthesize_edge_pack()

        if primary != "azure" and plain_edge:
            try:
                return await _synthesize_edge_pack()
            except Exception as ex:
                logger.warning("[TTS] Edge primary failed, falling back to Azure: %s", ex)

        def _allow_edge_after_azure_fail(exc: BaseException) -> bool:
            if bool(getattr(_cfg, "TTS_DISABLE_NON_AZURE_FALLBACK", False)):
                return is_azure_tts_auth_failure(exc)
            return True

        if not _SDK_AVAILABLE:
            if plain_edge:
                logger.warning("[TTS] Azure SDK missing — using edge-tts")
                return await _synthesize_edge_pack()
            raise RuntimeError(
                "azure-cognitiveservices-speech is not installed and edge-tts cannot run. "
                "Run: pip install azure-cognitiveservices-speech>=1.37.0"
            )

        if not getattr(self, "_available", True):
            if plain_edge:
                logger.warning("[TTS] Azure credentials missing — using edge-tts")
                return await _synthesize_edge_pack()
            raise RuntimeError(
                "Azure TTS unavailable: AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing in environment "
                "(edge-tts also failed or was skipped)."
            )

        ssml = _build_ssml(
            cleaned,
            voice,
            self._prosody_rate,
            emotion=emotion,
            persona_level=persona_level,
            ssml_slots=slots,
            client_voice_rate=client_voice_rate,
            client_pitch_scale=client_pitch_scale,
        )

        synthesizer = await self._ensure_synthesizer()

        loop = asyncio.get_running_loop()
        timeout_val = timeout if timeout is not None else self._timeout

        sync_func = functools.partial(
            self._synthesize_sync,
            synthesizer=synthesizer,
            ssml=ssml,
            voice_name=voice,
        )

        max_retries = max(0, int(getattr(_cfg, "TTS_AZURE_RETRY_COUNT", 1)))
        delay_sec = float(getattr(_cfg, "TTS_AZURE_RETRY_DELAY_SEC", 2.5))

        try:
            for attempt in range(max_retries + 1):
                try:
                    async with self._synthesis_lock:
                        result = await asyncio.wait_for(
                            loop.run_in_executor(None, sync_func),
                            timeout=timeout_val,
                        )
                    if usage_user_id and result:
                        try:
                            from app.services.usage_service import log_tts_usage

                            log_tts_usage(usage_user_id, len(cleaned))
                        except Exception:
                            pass
                    mp3_b, v_cues, w_cues = result
                    return mp3_b, v_cues, w_cues, "azure"
                except asyncio.TimeoutError as te:
                    logger.error("[AzureTTS] synthesis timed out after %ss", timeout_val)
                    if plain_edge and _allow_edge_after_azure_fail(te):
                        logger.warning("⚠️ Azure failed: %s. Falling back to edge-tts", te)
                        return await _synthesize_edge_pack()
                    raise
                except RuntimeError as e:
                    err_s = str(e).lower()
                    transient = (
                        "429" in err_s
                        or "too many requests" in err_s
                        or "rate limit" in err_s
                    )
                    if attempt < max_retries and transient:
                        logger.warning(
                            "[AzureTTS] transient rate/error — retry %d/%d after %.1fs | %s",
                            attempt + 1,
                            max_retries,
                            delay_sec,
                            e,
                        )
                        await asyncio.sleep(delay_sec)
                        continue
                    if plain_edge and _allow_edge_after_azure_fail(e):
                        logger.warning("⚠️ Azure failed: %s. Falling back to edge-tts", e)
                        return await _synthesize_edge_pack()
                    raise
                except Exception as e:
                    err_s = str(e).lower()
                    if attempt < max_retries and (
                        "429" in err_s or "too many requests" in err_s or "rate limit" in err_s
                    ):
                        logger.warning(
                            "[AzureTTS] transient — retry %d/%d after %.1fs | %s",
                            attempt + 1,
                            max_retries,
                            delay_sec,
                            e,
                        )
                        await asyncio.sleep(delay_sec)
                        continue
                    if plain_edge and _allow_edge_after_azure_fail(e):
                        logger.warning("⚠️ Azure failed: %s. Falling back to edge-tts", e)
                        return await _synthesize_edge_pack()
                    raise
        except Exception as outer:
            if plain_edge and _allow_edge_after_azure_fail(outer):
                logger.warning("⚠️ Azure failed: %s. Falling back to edge-tts", outer)
                return await _synthesize_edge_pack()
            raise

    def _synthesize_sync(
        self,
        synthesizer: speechsdk.SpeechSynthesizer,
        ssml: str,
        voice_name: str,
    ) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Blocking synthesis — runs in executor thread.
        This method assumes the caller has already acquired _synthesis_lock.
        """
        logger.info(
            "[AzureTTS] ▶ Synthesizing | voice=%s | chars=%d",
            voice_name,
            len(ssml),
        )
        logger.debug("[AzureTTS] Full SSML:\n%s", ssml)

        viseme_cues: List[Dict[str, Any]] = []
        word_cues: List[Dict[str, Any]] = []

        def on_viseme(evt):
            # audio_offset is in ticks (100 nanoseconds), divide by 10000 to get ms
            viseme_cues.append({
                "t": int(evt.audio_offset / 10000), 
                "id": evt.viseme_id
            })

        def on_word(evt):
            word_cues.append({
                "t": int(evt.audio_offset / 10000), 
                "w": evt.text
            })

        # Connect event listeners before synthesis
        synthesizer.viseme_received.connect(on_viseme)
        synthesizer.synthesis_word_boundary.connect(on_word)

        # Use the synthesizer directly
        result = synthesizer.speak_ssml_async(ssml).get()

        # CRITICAL FIX: Disconnect listeners immediately after synthesis
        # to prevent duplicate events on the persistent synthesizer in future calls.
        synthesizer.viseme_received.disconnect_all()
        synthesizer.synthesis_word_boundary.disconnect_all()

        if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
            audio_bytes = bytes(result.audio_data)
            if not audio_bytes:
                raise RuntimeError("Azure TTS returned empty audio bytes")
            logger.info(
                "[AzureTTS] ✅ Done | voice=%s | %d bytes | Visemes: %d | Words: %d",
                voice_name,
                len(audio_bytes),
                len(viseme_cues),
                len(word_cues)
            )
            # We now return the audio ALONG with the critical timing timelines
            return audio_bytes, viseme_cues, word_cues

        if result.reason == speechsdk.ResultReason.Canceled:
            details = speechsdk.SpeechSynthesisCancellationDetails(result)
            msg = (
                f"Azure TTS canceled — reason={details.reason.name}, "
                f"code={details.error_code}, details={details.error_details}"
            )
            logger.error("[AzureTTS] ❌ %s", msg)
            raise RuntimeError(msg)

        raise RuntimeError(f"Azure TTS unexpected result reason: {result.reason}")

    async def reload_credentials(self):
        """
        Force recreation of synthesizer on next call (e.g., after environment update).
        This clears the existing synthesizer; next synthesize will create a new one.
        """
        async with self._config_lock:
            self._synthesizer = None
            self._speech_config = None
            self._key = None
            self._region = None
            logger.info("[AzureTTS] Credentials cleared. Will reload from settings.")


def synthesize(text: str) -> str:
    """
    Synchronous smoke test for TTS data dirs + edge-tts (no Azure required).

    ``python -c "from app.services.tts_service import synthesize; print(synthesize('مرحبا'))"``
    """
    try:
        from app.archive.tts_data_dirs import ensure_tts_data_dirs

        ensure_tts_data_dirs()
    except Exception as e:
        return f"TTS smoke: data dirs error: {type(e).__name__}: {e}"
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        return (
            "TTS smoke: edge-tts not installed - run: pip install edge-tts "
            "(data/audio dirs OK; install dependency to test synthesis)"
        )
    t = (text or "").strip()
    if not t:
        return "TTS smoke: empty text"

    async def _once() -> Tuple[bytes, int, int]:
        mp3_b, wb, _ve = await synthesize_edge_tts_mp3(t, rate="+0%", pitch="+0Hz", voice=None)
        return mp3_b, len(wb), len(_ve)

    try:
        mp3_b, nw, nv = asyncio.run(_once())
        return (
            f"ok edge-tts | text_len={len(t)} | audio_bytes={len(mp3_b)} | words={nw} | viseme_events={nv}"
        )
    except Exception as e:
        return f"TTS smoke failed: {type(e).__name__}: {e}"