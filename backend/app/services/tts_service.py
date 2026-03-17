# -*- coding: utf-8 -*-
"""
Azure Neural TTS Service — Jordanian Arabic (ar-JO-OmarNeural / ar-JO-MaysoonNeural)
==================================================================================
Synthesizes SSML using the Azure Speech SDK and returns raw MP3 bytes, 
along with precise temporal viseme (lip-sync) and word boundary cues.

تم تحسين الأداء عبر إعادة استخدام SpeechSynthesizer مع قفل (Lock) لضمان السلامة في البيئات متعددة الخيوط.
تم إضافة نظام اصطياد الأحداث (Visemes & Word Boundaries) لربط عصب النطق مع الأفاتار 3D.
Default voice:  ar-JO-OmarNeural   (male, Dr. Hamza - EXCLUSIVE)
Rare fallback:  ar-JO-MaysoonNeural   (female - avoid unless explicitly requested)

Install:
    pip install azure-cognitiveservices-speech>=1.37.0
"""
from __future__ import annotations

import asyncio
import functools
import logging
import re as _re
from typing import Optional, Tuple, List, Dict, Any

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

# Any run of ASCII letters/digits (possibly hyphenated) = English token
_EN_TOKEN   = _re.compile(r'([A-Za-z][A-Za-z0-9]*(?:[/-][A-Za-z0-9]+)*)')
# All-uppercase abbreviation: PESTLE, SWOT, BTEC, KPI, GDP …
_ACRONYM_RE = _re.compile(r'^[A-Z][A-Z0-9]{1,}$')


def _xml_escape(s: str) -> str:
    """Escape XML special characters in a plain-text node."""
    return (
        s
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&apos;')
    )


def _split_segments(text: str) -> list[tuple[str, str]]:
    """
    Split *text* into alternating ``('ar', …)`` and ``('en', …)`` segments.
    Any run of ASCII letters/digits is treated as English; everything else as Arabic.
    """
    segments: list[tuple[str, str]] = []
    last = 0
    for m in _EN_TOKEN.finditer(text):
        if m.start() > last:
            segments.append(('ar', text[last:m.start()]))
        segments.append(('en', m.group()))
        last = m.end()
    if last < len(text):
        segments.append(('ar', text[last:]))
    return segments


def _render_segment(kind: str, content: str) -> str:
    """
    Convert one text segment to its SSML representation.

    * Arabic segments → plain XML-escaped text (TaimNeural handles dialect natively).
    * English acronyms (ALL-CAPS, ≥2 letters) → spelled letter-by-letter inside
      ``<lang xml:lang="en-GB"><say-as interpret-as="spell-out">``.
    * Other English words → ``<lang xml:lang="en-GB">`` for correct phonetics.
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


def _chunk_to_ssml(chunk: str) -> str:
    """Convert a plain-text chunk (no boundary punctuation) to SSML inner XML."""
    return ''.join(_render_segment(k, v) for k, v in _split_segments(chunk))


def _clean_tts_text(text: str) -> str:
    """
    Final defensive pass: strip all formatting markers before passing text to Azure.

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
    # Collapse extra spaces / blank lines left by the deletions above
    text = _re.sub(r'[ \t]{2,}', ' ', text)
    text = _re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


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


def _build_ssml(text: str, voice_name: str, rate: float = 0.95, emotion: str = 'neutral', persona_level: str = 'pass') -> str:
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

    # F2 Fix: Azure SSML requires signed relative percentage e.g. "+15%" not "115%"
    _r_offset = round((rate - 1.0) * 100)
    rate_pct = f"+{_r_offset}%" if _r_offset >= 0 else f"{_r_offset}%"

    # ── Triple-Persona Engine: apply level-based rate multiplier and pitch wrapper ──
    # Pass: warm/funny → slightly faster, high pitch (+5%)
    # Merit: serious academic → professional pace, neutral pitch
    # Distinction: challenger → noticeably faster, deep pitch (-10%)
    _PERSONA_RATE_MUL = {'pass': 1.10, 'merit': 1.08, 'distinction': 1.15}
    _PERSONA_PITCH    = {'pass': '+5%', 'merit': '+0%', 'distinction': '-10%'}
    persona_rate_mul = _PERSONA_RATE_MUL.get((persona_level or 'pass').lower(), 1.0)
    persona_pitch    = _PERSONA_PITCH.get((persona_level or 'pass').lower(), '+0%')
    # Persona rate is the ABSOLUTE speaking rate — not compounded with emotion rate.
    # F2 Fix: signed relative percentage — "+8%" = 8% faster, "-5%" = 5% slower.
    # Emotion table still controls style-degree and pitch for expressiveness.
    _p_offset = round((persona_rate_mul - 1.0) * 100)
    rate_pct = f"+{_p_offset}%" if _p_offset >= 0 else f"{_p_offset}%"

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

        chunk_ssml = _chunk_to_ssml(chunk) if chunk else ''
        is_question = bool(punct) and ('؟' in punct or '?' in punct)

        if chunk_ssml:
            if is_question:
                ssml_parts.append(
                    f'<prosody pitch="+8%">{chunk_ssml}{_xml_escape(punct)}</prosody>'
                )
            else:
                ssml_parts.append(chunk_ssml + (_xml_escape(punct) if punct else ''))

        if punct and i < len(tokens):
            pause_ms = 320 if ('.' in punct or '\n' in punct) else 200
            ssml_parts.append(f'<break time="{pause_ms}ms"/>')

    body = '\n'.join(ssml_parts)

    # Wrap body in persona pitch prosody (skip wrapper when pitch is neutral)
    if persona_pitch and persona_pitch != '+0%':
        body = f'<prosody pitch="{persona_pitch}">{body}</prosody>'

    return (
        f'<speak version="1.0" '
        f'xmlns="http://www.w3.org/2001/10/synthesis" '
        f'xmlns:mstts="https://www.w3.org/2001/mstts" '
        f'xml:lang="ar-JO">'
        f'<voice name="{voice_name}" xml:lang="ar-JO">'
        f'<mstts:express-as style="friendly" styledegree="{styledegree}" xml:lang="ar-JO">'
        f'<prosody rate="{rate_pct}" pitch="{pitch_extra}">'
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
        self._default_voice = default_voice
        self._prosody_rate = prosody_rate
        self._timeout = request_timeout

        self._speech_config = None
        self._synthesizer = None  # persistent synthesizer for low latency
        self._config_lock = asyncio.Lock()   # lock for creating/changing config
        self._synthesis_lock = asyncio.Lock() # lock for actual synthesis (thread safety)

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
    ) -> Tuple[bytes, List[Dict[str, Any]], List[Dict[str, Any]]]:
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
        """
        text = _clean_tts_text((text or "").strip())
        if not text:
            raise ValueError("TTS text cannot be empty after cleanup")

        if not _SDK_AVAILABLE:
            raise RuntimeError(
                "azure-cognitiveservices-speech is not installed. "
                "Run: pip install azure-cognitiveservices-speech>=1.37.0"
            )

        voice = voice_name or self._default_voice
        if not voice:
            raise RuntimeError("No voice name provided and no default configured.")

        ssml = _build_ssml(text, voice, self._prosody_rate, emotion=emotion, persona_level=persona_level)

        # Ensure synthesizer is ready
        synthesizer = await self._ensure_synthesizer()

        loop = asyncio.get_running_loop()
        timeout_val = timeout if timeout is not None else self._timeout

        # Use a lock to serialize synthesis calls (because synthesizer is not thread-safe)
        sync_func = functools.partial(
            self._synthesize_sync,
            synthesizer=synthesizer,
            ssml=ssml,
            voice_name=voice,
        )

        try:
            async with self._synthesis_lock:
                result = await asyncio.wait_for(
                    loop.run_in_executor(None, sync_func),
                    timeout=timeout_val,
                )
        except asyncio.TimeoutError:
            logger.error("[AzureTTS] synthesis timed out after %ss", timeout_val)
            raise

        return result

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
            details = speechsdk.SpeechSynthesisCancellationDetails.from_result(result)
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