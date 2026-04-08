# -*- coding: utf-8 -*-
from app.services.tts_service import approx_viseme_cues_from_word_cues


def test_approx_viseme_from_words_empty():
    assert approx_viseme_cues_from_word_cues([], "hello") == []


def test_approx_viseme_from_words_order_and_ids():
    wc = [{"t": 0, "w": "Hi"}, {"t": 100, "w": "there"}]
    cues = approx_viseme_cues_from_word_cues(wc, "Hi there")
    assert len(cues) >= 2
    assert all("t" in c and "id" in c for c in cues)
    assert cues[0]["t"] <= cues[-1]["t"]
