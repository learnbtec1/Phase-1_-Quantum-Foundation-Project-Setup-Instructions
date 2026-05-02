# -*- coding: utf-8 -*-
"""
Generate minimal backend/app/templates/btec_record.docx for docxtpl.
Run from repo:  python backend/scripts/ensure_btec_record_template.py
(Replace with the Ministry official .docx when available — keep Jinja tags aligned.)
"""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.shared import Pt


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out = root / "app" / "templates" / "btec_record.docx"
    out.parent.mkdir(parents=True, exist_ok=True)

    d = Document()
    style = d.styles["Normal"]
    style.font.size = Pt(11)

    d.add_paragraph("{{ program_title }}")
    d.add_paragraph()
    p = d.add_paragraph()
    p.add_run("رقم التسجيل: ").bold = True
    p.add_run("{{ student_reg_no }}")
    p = d.add_paragraph()
    p.add_run("اسم الطالب: ").bold = True
    p.add_run("{{ student_name }}")
    p = d.add_paragraph()
    p.add_run("عنوان الواجب: ").bold = True
    p.add_run("{{ assignment_title }}")
    p = d.add_paragraph()
    p.add_run("اسم المقيّم: ").bold = True
    p.add_run("{{ assessor_name }}")
    p = d.add_paragraph()
    p.add_run("عنوان الوحدة: ").bold = True
    p.add_run("{{ unit_title }}")
    p = d.add_paragraph()
    p.add_run("تاريخ التسليم: ").bold = True
    p.add_run("{{ submission_date }}")
    p.add_run("  |  ")
    p.add_run("آخر أجل: ").bold = True
    p.add_run("{{ deadline_date }}")
    p = d.add_paragraph()
    p.add_run("تمديد معتمد: ").bold = True
    p.add_run("{{ extension_approved }}")
    d.add_paragraph()
    p = d.add_paragraph()
    p.add_run("التغذية الراجعة العامة ({{ feedback_date }}):").bold = True
    d.add_paragraph("{{ general_feedback }}")
    d.add_paragraph()
    p = d.add_paragraph()
    p.add_run("نص تسليم الطالب / مسودة المساحة:").bold = True
    d.add_paragraph("{{ submission_body }}")

    d.add_paragraph()
    h2 = d.add_paragraph("جدول المعايير / Criteria grid")
    h2.runs[0].bold = True

    # docxtpl: one template row, for-loop spans cells (see docx-tpl table docs)
    t = d.add_table(rows=2, cols=4)
    hrow = t.rows[0].cells
    hrow[0].text = ""
    hrow[1].text = "Criterion"
    hrow[2].text = "Achieved (YES/NO)"
    hrow[3].text = "Feedback"
    drow = t.rows[1].cells
    drow[0].text = "{% for c in graded_criteria %}"
    drow[1].text = "{{ c.criterion_id }}"
    drow[2].text = "{{ c.achieved }}"
    drow[3].text = "{{ c.feedback }}{% endfor %}"

    d.save(str(out))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
