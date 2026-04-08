# -*- coding: utf-8 -*-
"""Jordanian dialect corrector + TTS voice lock (unit)."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from app.archive.dialect_corrector import (
    DialectCorrector,
    reset_dialect_corrector_for_tests,
)
from app.services.tts_service import _locked_jordanian_male_voice


@pytest.fixture(autouse=True)
def _reset_dialect_singleton():
    reset_dialect_corrector_for_tests()
    yield
    reset_dialect_corrector_for_tests()


def test_dialect_replaces_eh_question():
    c = DialectCorrector(enabled=True, log_corrections=False)
    out, ok = c.correct_text("إيه اللي صار معك؟")
    assert ok
    assert "شو اللي" in out
    assert "إيه اللي" not in out


def test_dialect_replaces_feen():
    c = DialectCorrector(enabled=True, log_corrections=False)
    out, ok = c.correct_text("فين الكتاب؟")
    assert ok
    assert "وين" in out


def test_dialect_disabled_noop():
    c = DialectCorrector(enabled=False, log_corrections=False)
    out, ok = c.correct_text("إيه اللي صار")
    assert not ok
    assert out == "إيه اللي صار"


def test_detect_markers():
    c = DialectCorrector(enabled=True, log_corrections=False)
    assert c.detect_egyptian_markers("كده تمام")
    assert not c.detect_egyptian_markers("هيك تمام")


def test_locked_rejects_non_jo_voice():
    from app.core.config import settings

    locked = settings.COGNI_ARABIC_TTS_VOICE_LOCKED
    with patch.object(settings, "TTS_FORCE_JORDANIAN", True):
        assert _locked_jordanian_male_voice("ar-EG-SalmaNeural") == locked
        assert _locked_jordanian_male_voice("ar-SA-HamedNeural") == locked


def test_locked_allows_force_off():
    from app.core.config import settings

    with patch.object(settings, "TTS_FORCE_JORDANIAN", False):
        v = _locked_jordanian_male_voice("ar-EG-SalmaNeural")
        assert v == "ar-EG-SalmaNeural"
