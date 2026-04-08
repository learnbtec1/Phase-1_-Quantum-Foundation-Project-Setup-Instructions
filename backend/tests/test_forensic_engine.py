# -*- coding: utf-8 -*-
"""Unit tests for forensic_engine (BTEC grading logic, text helpers)."""
import pytest
from app.archive.forensic_engine import (
    band_from_code,
    extract_criteria_codes,
    calculate_final_grade_btec,
    normalize_text,
    find_quote_smart,
    clean_and_compress_text,
)


class TestBandFromCode:
    def test_pass(self):
        assert band_from_code("P1") == "PASS"
        assert band_from_code("p2") == "PASS"
        assert band_from_code("A.P1") == "PASS"

    def test_merit(self):
        assert band_from_code("M1") == "MERIT"
        assert band_from_code("m3") == "MERIT"

    def test_distinction(self):
        assert band_from_code("D1") == "DISTINCTION"
        assert band_from_code("D2") == "DISTINCTION"

    def test_unknown(self):
        assert band_from_code("X1") == "UNKNOWN"


class TestExtractCriteriaCodes:
    def test_simple(self):
        text = "P1: شرح. M1: تحليل. D1: مقارنة."
        codes = extract_criteria_codes(text)
        assert "P1" in codes
        assert "M1" in codes
        assert "D1" in codes

    def test_deduplicate(self):
        text = "P1 و P1 مرة أخرى"
        codes = extract_criteria_codes(text)
        assert codes.count("P1") == 1

    def test_empty(self):
        assert extract_criteria_codes("") == []
        assert extract_criteria_codes("لا معايير هنا") == []


class TestCalculateFinalGradeBtec:
    def test_refer_if_pass_fails(self):
        results = {"P1": {"achieved": False}, "M1": {"achieved": True}}
        assert calculate_final_grade_btec(results) == "REFER"

    def test_pass_if_merit_fails(self):
        results = {"P1": {"achieved": True}, "M1": {"achieved": False}}
        assert calculate_final_grade_btec(results) == "PASS"

    def test_merit_if_distinction_fails(self):
        results = {"P1": {"achieved": True}, "M1": {"achieved": True}, "D1": {"achieved": False}}
        assert calculate_final_grade_btec(results) == "MERIT"

    def test_distinction_all_achieved(self):
        results = {"P1": {"achieved": True}, "M1": {"achieved": True}, "D1": {"achieved": True}}
        assert calculate_final_grade_btec(results) == "DISTINCTION"

    def test_empty_criteria(self):
        assert calculate_final_grade_btec({}) == "DISTINCTION"  # all_pass = True when empty


class TestNormalizeText:
    def test_strips_diacritics(self):
        t = normalize_text("مُراجَعَة")
        assert "ُ" not in t

    def test_normalizes_alif(self):
        assert "ا" in normalize_text("أحمد")


class TestFindQuoteSmart:
    def test_exact_match(self):
        student = "هذه إجابة الطالب المطلوبة."
        r = find_quote_smart(student, "إجابة الطالب")
        assert r["found"] is True
        assert r["confidence"] == 100
        assert r["start_index"] >= 0

    def test_not_found(self):
        r = find_quote_smart("نص قصير", "اقتباس طويل غير موجود")
        assert r["found"] is False

    def test_short_quote(self):
        r = find_quote_smart("نص طويل جداً", "ab")
        assert r["found"] is False  # len < 5


class TestCleanAndCompressText:
    def test_compresses_newlines(self):
        t = clean_and_compress_text("سطر1\n\n\n\nسطر2")
        assert "\n\n\n" not in t
        assert "سطر1" in t and "سطر2" in t
