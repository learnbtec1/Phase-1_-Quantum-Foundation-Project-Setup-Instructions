# -*- coding: utf-8 -*-
"""
pdf_service.py — Automated Academic Progress Report Generator
═══════════════════════════════════════════════════════════════════
Generates a bilingual (Arabic/English) BTEC progress report PDF using ReportLab.

Dependencies
  pip install reportlab arabic-reshaper python-bidi

Arabic text pipeline
  Raw Arabic text → arabic_reshaper.reshape() → bidi.get_display() → ReportLab

Sections
  1. Header — EDUVERSE branding, student name, date
  2. BTEC Grade Summary table — one row per evaluation (P/M/D/R)
  3. Cognitive Scaffolding Insight — compares earliest vs latest evaluation
  4. Verona Recommendations — extracted from last 3 evaluations
"""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── Arabic text helpers ───────────────────────────────────────────────────────

def _ar(text: str) -> str:
    """
    Reshape + bidi-reorder Arabic text for correct ReportLab rendering.
    Returns the original string unchanged if libraries are unavailable.
    """
    try:
        import arabic_reshaper                        # type: ignore[import]
        from bidi.algorithm import get_display        # type: ignore[import]
        return get_display(arabic_reshaper.reshape(text))
    except ImportError:
        return text   # graceful degradation — text may render LTR on some systems


# ── Font registration ─────────────────────────────────────────────────────────

_FONT_REGISTERED = False
_ARABIC_FONT     = "Helvetica"    # fallback if no Arabic font available


def _register_arabic_font() -> None:
    """
    Register an Arabic-capable TTF with ReportLab.
    Tries (in order):
      1. EDUVERSE_ARABIC_FONT_PATH env var — operator-supplied path
      2. /usr/share/fonts/**/NotoNaskhArabic-Regular.ttf — common Linux location
      3. Falls back to Helvetica (Latin only — Arabic may render as boxes)
    """
    global _FONT_REGISTERED, _ARABIC_FONT
    if _FONT_REGISTERED:
        return

    from reportlab.pdfbase import pdfmetrics          # type: ignore[import]
    from reportlab.pdfbase.ttfonts import TTFont       # type: ignore[import]

    candidates: list[str] = []

    # Operator override
    env_path = os.getenv("EDUVERSE_ARABIC_FONT_PATH", "").strip()
    if env_path:
        candidates.append(env_path)

    # System paths
    system_searches = [
        "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
        "/usr/share/fonts/opentype/noto/NotoNaskhArabic-Regular.otf",
        "C:/Windows/Fonts/arabic.ttf",
        "C:/Windows/Fonts/Tahoma.ttf",  # contains Arabic glyphs
    ]
    candidates.extend(system_searches)

    for path in candidates:
        if os.path.isfile(path):
            try:
                pdfmetrics.registerFont(TTFont("Arabic", path))
                _ARABIC_FONT = "Arabic"
                logger.info("[PDF] Arabic font registered: %s", path)
                break
            except Exception as exc:
                logger.warning("[PDF] Could not register font %s: %s", path, exc)

    if _ARABIC_FONT == "Helvetica":
        logger.warning(
            "[PDF] No Arabic font found. Set EDUVERSE_ARABIC_FONT_PATH to a valid TTF path. "
            "Arabic glyphs will render as boxes on systems without built-in Arabic support."
        )

    _FONT_REGISTERED = True


# ── Grade helpers ─────────────────────────────────────────────────────────────

_GRADE_COLOR: dict[str, tuple[float, float, float]] = {
    "D": (0.13, 0.55, 0.13),   # green
    "M": (0.07, 0.35, 0.70),   # blue
    "P": (0.80, 0.50, 0.00),   # amber
    "R": (0.75, 0.10, 0.10),   # red
}

_GRADE_LABEL: dict[str, str] = {
    "D": "Distinction / امتياز",
    "M": "Merit / جيد جداً",
    "P": "Pass / ناجح",
    "R": "Refer / إعادة",
}

def _grade_trend(grades: list[str]) -> str:
    """Convert a list of grades into an emoji trend indicator."""
    if not grades:
        return "—"
    order = {"R": 0, "P": 1, "M": 2, "D": 3}
    scores = [order.get(g, 0) for g in grades]
    if len(scores) < 2:
        return grades[-1]
    delta = scores[-1] - scores[0]
    arrow = "⬆" if delta > 0 else ("⬇" if delta < 0 else "➡")
    return f"{grades[-1]} {arrow}"


# ── Main generator ────────────────────────────────────────────────────────────

def generate_student_report(
    student_id: str,
    student_name: str,
    evaluations: list[dict],
) -> bytes:
    """
    Generate a PDF progress report and return its bytes.

    Args:
        student_id:   UUID or display ID of the student.
        student_name: Display name (Arabic or English).
        evaluations:  List of evaluation dicts (from EvaluationRepository.get_all_by_student).
                      Each dict must have: id, title, final_grade, criteria, feedback.
    Returns:
        Raw PDF bytes.
    """
    from reportlab.lib import colors                     # type: ignore[import]
    from reportlab.lib.pagesizes import A4               # type: ignore[import]
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore[import]
    from reportlab.lib.units import cm                   # type: ignore[import]
    from reportlab.platypus import (                     # type: ignore[import]
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    )

    _register_arabic_font()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2 * cm,
        title=f"EDUVERSE Progress Report — {student_name}",
    )

    styles = getSampleStyleSheet()
    ar_style = ParagraphStyle(
        "Arabic",
        fontName=_ARABIC_FONT,
        fontSize=11,
        leading=18,
        alignment=2,  # right-align for Arabic
        wordWrap="RTL",
    )
    heading_style = ParagraphStyle(
        "EduverseHeading",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=16,
        textColor=colors.HexColor("#1a237e"),
    )
    sub_style = ParagraphStyle(
        "EduverseSub",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=10,
        textColor=colors.HexColor("#555555"),
    )

    story = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # ── 1. Header ─────────────────────────────────────────────────────────────
    story.append(Paragraph("EDUVERSE Academic Progress Report", heading_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(f"Student: {student_name} &nbsp;|&nbsp; ID: {student_id} &nbsp;|&nbsp; Date: {now}", sub_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#1a237e")))
    story.append(Spacer(1, 0.5 * cm))

    # Arabic header
    story.append(Paragraph(_ar("تقرير التقدم الأكاديمي — منصة نيكسوس"), ar_style))
    story.append(Paragraph(_ar(f"اسم الطالب: {student_name}  |  التاريخ: {now}"), ar_style))
    story.append(Spacer(1, 0.6 * cm))

    # ── 2. BTEC Grade Summary table ───────────────────────────────────────────
    story.append(Paragraph("BTEC Grade Summary", styles["Heading2"]))
    story.append(Spacer(1, 0.3 * cm))

    if not evaluations:
        story.append(Paragraph("No evaluations recorded yet.", styles["Normal"]))
    else:
        tbl_data = [["#", "Assignment", "Grade", "Criteria", "Achieved"]]
        for idx, ev in enumerate(evaluations, 1):
            grade  = str(ev.get("final_grade", "—"))
            crit   = ev.get("criteria", {}) or {}
            total  = len(crit)
            done   = sum(1 for v in crit.values() if isinstance(v, dict) and v.get("achieved"))
            tbl_data.append([
                str(idx),
                str(ev.get("title", "—"))[:40],
                grade,
                str(total),
                f"{done}/{total}",
            ])

        tbl = Table(tbl_data, colWidths=[1 * cm, 8.5 * cm, 2 * cm, 2.5 * cm, 2.5 * cm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, 0), colors.HexColor("#1a237e")),
            ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
            ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",     (0, 0), (-1, 0), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#f5f5f5"), colors.white]),
            ("FONTSIZE",     (0, 1), (-1, -1), 9),
            ("GRID",         (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("ALIGN",        (2, 0), (-1, -1), "CENTER"),
            ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",   (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        # Colour the grade cells
        for row_idx, ev in enumerate(evaluations, 1):
            grade = str(ev.get("final_grade", "—"))
            rgb   = _GRADE_COLOR.get(grade, (0.4, 0.4, 0.4))
            tbl.setStyle(TableStyle([
                ("TEXTCOLOR", (2, row_idx), (2, row_idx),
                 colors.Color(*rgb)),
                ("FONTNAME",  (2, row_idx), (2, row_idx), "Helvetica-Bold"),
            ]))
        story.append(tbl)

    story.append(Spacer(1, 0.8 * cm))

    # ── 3. Cognitive Scaffolding Insight ─────────────────────────────────────
    story.append(Paragraph("Cognitive Scaffolding Insight", styles["Heading2"]))
    story.append(Spacer(1, 0.3 * cm))

    if len(evaluations) >= 2:
        first = evaluations[0]
        last  = evaluations[-1]
        trend = _grade_trend([str(e.get("final_grade", "R")) for e in evaluations])
        insight_en = (
            f"First evaluation: {first.get('final_grade','—')} — "
            f"{first.get('title','')[:50]}. "
            f"Latest evaluation: {last.get('final_grade','—')} — "
            f"{last.get('title','')[:50]}. "
            f"Overall trajectory: {trend}."
        )
        insight_ar = _ar(
            f"التقييم الأول: {first.get('final_grade','—')} — "
            f"آخر تقييم: {last.get('final_grade','—')} — "
            f"المسار العام: {trend}"
        )
        story.append(Paragraph(insight_en, styles["Normal"]))
        story.append(Spacer(1, 0.2 * cm))
        story.append(Paragraph(insight_ar, ar_style))
    elif len(evaluations) == 1:
        story.append(Paragraph(
            "Only one evaluation recorded. Re-submit after completing more tasks to see trajectory.",
            styles["Normal"],
        ))
    else:
        story.append(Paragraph("No evaluations available.", styles["Normal"]))

    story.append(Spacer(1, 0.8 * cm))

    # ── 4. Verona Recommendations ─────────────────────────────────────────────
    story.append(Paragraph("Verona AI Recommendations", styles["Heading2"]))
    story.append(Spacer(1, 0.3 * cm))

    recent = evaluations[-3:] if len(evaluations) >= 3 else evaluations
    recs   = []
    for ev in recent:
        fb = str(ev.get("feedback", "")).strip()
        if fb and len(fb) > 10:
            recs.append(fb[:250])   # cap feedback length per evaluation

    if recs:
        for i, rec in enumerate(recs, 1):
            story.append(Paragraph(f"{i}. {rec}", styles["Normal"]))
            story.append(Spacer(1, 0.2 * cm))
    else:
        story.append(Paragraph("No recommendations available.", styles["Normal"]))

    story.append(Spacer(1, 0.5 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#aaaaaa")))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        _ar("نيكسوس — منصة التعليم الذكي  |  تقرير مُولَّد بواسطة الذكاء الاصطناعي"),
        ar_style,
    ))

    doc.build(story)
    return buf.getvalue()
