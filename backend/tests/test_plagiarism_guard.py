# -*- coding: utf-8 -*-
"""Unit tests for plagiarism_guard."""
import asyncio

import pytest
from app.archive.plagiarism_guard import PlagiarismGuard


@pytest.fixture
def guard():
    return PlagiarismGuard(min_len=50, strict=False)


def test_short_text_returns_low_score(guard):
    result = asyncio.run(guard.evaluate("نص قصير جداً"))
    assert "score" in result
    assert result["score"] == 0.0
    assert "too_short" in str(result.get("findings", {})).lower() or "length" in result.get("findings", {})


def test_long_clean_text_returns_some_score(guard):
    text = "شرح مفصل عن موضوع الأعمال. " * 20  # long enough
    result = asyncio.run(guard.evaluate(text))
    assert "score" in result
    assert 0 <= result["score"] <= 1
    assert "detail" in result
    assert "findings" in result


def test_ai_markers_increase_score(guard):
    text = "هذا النص من chatgpt وتم إنشاؤه بواسطة openai. " + "جملة إضافية. " * 15
    result = asyncio.run(guard.evaluate(text))
    assert result.get("findings", {}).get("suspected_ai_markers")
