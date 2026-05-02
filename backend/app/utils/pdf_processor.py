# -*- coding: utf-8 -*-
"""
PDF helpers — extract BTEC-style assignment criteria text for frontend `assignmentCriteria`
(plain string pasted into assessment brief / Ultra Tutor context).
"""
from __future__ import annotations

import re
from pathlib import Path

from app.services.submission_merge import MAX_BYTES_PER_FILE, extract_text_from_bytes

_HEADER = "معايير الواجب (مستخرجة من PDF):\n\n"
_MAX_CHARS = 100_000
_MIN_CHARS = 40


def extract_btec_criteria(file_path: str) -> str:
    """
    Read a local assignment-brief PDF and return normalized plain text compatible with the
    frontend `assignmentCriteria` field (teacher-facing criteria summary).

    Uses the same text extraction pipeline as submissions (`extract_text_from_bytes`).
    """
    path = Path(file_path).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError("Expected a .pdf file (BTEC assignment brief).")

    data = path.read_bytes()
    if len(data) > MAX_BYTES_PER_FILE:
        raise ValueError("PDF exceeds maximum allowed size.")

    raw = (extract_text_from_bytes(path.name, data) or "").strip()
    if len(raw) < _MIN_CHARS:
        raise ValueError(
            "Extracted too little text from PDF (scanned pages may need OCR elsewhere)."
        )

    # Paragraphs → lines; collapse horizontal whitespace.
    chunks: list[str] = []
    for block in re.split(r"\n{2,}", raw):
        line = " ".join(block.split())
        if line:
            chunks.append(line)

    body_lines: list[str] = []
    for line in chunks[:120]:
        stripped = line.strip()
        if stripped.startswith(("•", "-", "*", "–")):
            body_lines.append(stripped)
        else:
            body_lines.append(f"• {stripped}")

    body = "\n".join(body_lines)
    if len(body) > _MAX_CHARS:
        body = body[:_MAX_CHARS].rstrip() + "…"

    return _HEADER + body
