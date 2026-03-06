# -*- coding: utf-8 -*-
"""
نظام تقييم متكامل للحلول متعددة الملفات (Integrated Multi-File Solution Grading)
===================================================================================

الهدف: تقييم حل واحد مكون من ملفات متعددة كـ entity موحدة
- يتم إرسال الواجب مرة واحدة
- يتم إرسال جميع ملفات الحل معاً
- التقييم يتم على أساس أن هذه **كل** الحل
- النتيجة النهائية **موحدة** لجميع الملفات

مثال:
POST /api/v1/assessment/evaluate-multi-file

{
  "assignment_text": "الواجب...",
  "solutions": [
    {
      "file_label": "TalkMateAI",
      "file_content": "محتوى الملف 1...",
      "description": "وصف الملف (اختياري)"
    },
    {
      "file_label": "Phase-1",
      "file_content": "محتوى الملف 2...",
      "description": "وصف الملف (اختياري)"
    }
  ]
}

الاستجابة:
{
  "final_grade": "MERIT",
  "consolidated_summary": "تقييم موحد لكل ملفات الحل...",
  "by_file": {
    "TalkMateAI": { criteria results... },
    "Phase-1": { criteria results... }
  },
  "integrated_criteria": {
    "P1": { achieved: true, evidence_from_files: [...] },
    "M1": { achieved: true, evaluation_across_files: "..." }
  }
}
"""

from __future__ import annotations
import os
import re
import json
import asyncio
import time
import hashlib
import logging
from typing import Dict, List, Any, AsyncGenerator, Optional, Tuple
from datetime import datetime

from dotenv import load_dotenv

# استيراد محرك التقييم الموجود
from app.services.forensic_engine import (
    forensic_grade,
    extract_criteria_codes,
    extract_criteria_descriptions,
    calculate_final_grade_btec,
    clean_and_compress_text,
)

load_dotenv()
logger = logging.getLogger("integrated-grader")

# ========= Helper Functions =========

def combine_solution_texts(solutions: List[Dict[str, Any]]) -> str:
    """
    دمج محتويات الملفات المتعددة مع حفظ الفواصل والعلامات
    """
    combined = []
    for idx, sol in enumerate(solutions, 1):
        file_label = sol.get("file_label", f"File {idx}")
        content = sol.get("file_content", "")
        description = sol.get("description", "")
        
        # إضافة علامة الملف
        combined.append(f"\n{'='*70}")
        combined.append(f"📄 [{file_label}]")
        if description:
            combined.append(f"   {description}")
        combined.append(f"{'='*70}\n")
        combined.append(content)
    
    return "\n".join(combined)


def analyze_per_file_achievements(
    assignment_text: str,
    solutions: List[Dict[str, Any]],
    criteria_codes: List[str]
) -> Dict[str, Dict[str, bool]]:
    """
    تحليل سريع: أي ملف يحقق أي معيار؟
    يساعد الخوارزمية على فهم توزيع المعايير عبر الملفات
    """
    per_file = {}
    
    for sol in solutions:
        file_label = sol.get("file_label", "Unknown")
        content = sol.get("file_content", "").lower()
        
        # بحث بسيط عن الكلمات المفتاحية لكل معيار
        file_achievements = {}
        for code in criteria_codes:
            # تبسيط: ابحث عن اسم المعيار في المحتوى
            # في النسخة الحقيقية يتم تقييم دقيق لاحقاً
            has_relevance = code.lower() in content or "معيار" in content
            file_achievements[code] = has_relevance
        
        per_file[file_label] = file_achievements
    
    return per_file


async def evaluate_integrated(
    assignment_text: str,
    solutions: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    تقييم متكامل لحل متعدد الملفات
    
    الخطوات:
    1. دمج الملفات مع الحفاظ على الفواصل
    2. استخراج معايير الواجب
    3. تقييم الحل المدمج
    4. تحليل إضافي: أي ملف يساهم في أي معيار
    5. النتيجة النهائية الموحدة
    """
    
    logger.info(f"🔄 بدء تقييم متكامل لـ {len(solutions)} ملف(ات)")
    
    # 1. دمج الملفات
    combined_student_text = combine_solution_texts(solutions)
    
    # 2. التنظيف
    assignment_clean = clean_and_compress_text(assignment_text)[:30000]
    student_clean = clean_and_compress_text(combined_student_text)[:150000]
    
    # 3. استخراج المعايير
    criteria_codes = extract_criteria_codes(assignment_clean)
    if len(criteria_codes) < 2:
        return {
            "error": "لم يتم العثور على معايير كافية",
            "message": "الواجب يجب أن يحتوي على معيارين على الأقل"
        }
    
    logger.info(f"✅ تم استخراج {len(criteria_codes)} معيار: {criteria_codes}")
    
    # 4. تحليل سريع: أي ملف يحقق أي معيار
    per_file_map = analyze_per_file_achievements(
        assignment_clean,
        solutions,
        criteria_codes
    )
    logger.info(f"📊 توزيع المعايير عبر الملفات: {per_file_map}")
    
    # 5. التقييم الفعلي باستخدام المحرك الموجود
    logger.info("🤖 بدء التقييم بواسطة AI...")
    full_result = await forensic_grade(assignment_clean, student_clean)
    
    # 6. دمج النتائج: إضافة معلومات عن توزيع الملفات
    integrated_result = {
        "final_grade": full_result.get("final_grade"),
        "summary": full_result.get("summary", ""),
        "consolidated_summary": f"""
تقييم متكامل للحل متعدد الملفات:
- عدد الملفات: {len(solutions)}
- الملفات المُقيّمة: {', '.join(sol.get('file_label', 'Unknown') for sol in solutions)}
- عدد المعايير المقيّمة: {len(criteria_codes)}

{full_result.get('summary', '')}

💡 ملاحظة: تم تقييم جميع الملفات معاً كحل موحد واحد.
        """.strip(),
        
        "file_distribution": per_file_map,  # أي ملف يساهم في أي معيار
        "files_evaluated": len(solutions),
        
        "criteria": full_result.get("criteria", {}),
        
        # معلومات تفصيلية عن كل ملف
        "solution_files": [
            {
                "label": sol.get("file_label"),
                "description": sol.get("description", ""),
                "content_preview": sol.get("file_content", "")[:300] + "..."
            }
            for sol in solutions
        ]
    }
    
    logger.info(f"✅ اكتمل التقييم المتكامل - النتيجة: {integrated_result['final_grade']}")
    
    return integrated_result


async def evaluate_integrated_stream(
    assignment_text: str,
    solutions: List[Dict[str, Any]]
) -> AsyncGenerator[str, None]:
    """
    نسخة streaming من التقييم المتكامل
    تُرجع NDJSON lines عند اكتمال كل جزء
    """
    
    combined_text = combine_solution_texts(solutions)
    assignment_clean = clean_and_compress_text(assignment_text)[:30000]
    student_clean = clean_and_compress_text(combined_text)[:150000]
    
    # استخراج المعايير
    criteria_codes = extract_criteria_codes(assignment_clean)
    
    yield json.dumps({
        "type": "status",
        "message": f"بدء تقييم متكامل لـ {len(solutions)} ملف(ات)...",
        "files_count": len(solutions),
        "criteria_count": len(criteria_codes)
    }, ensure_ascii=False) + "\n"
    
    # تقييم الحل المدمج
    # هنا يمكن إضافة streaming من المحرك الأساسي
    result = await forensic_grade(assignment_clean, student_clean)
    
    yield json.dumps({
        "type": "final",
        "final_grade": result["final_grade"],
        "criteria": result.get("criteria", {}),
        "solution_files": len(solutions)
    }, ensure_ascii=False) + "\n"


# ========= API Route Handler (مثال FastAPI) =========

# يتم إضافة هذا في main.py:
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

class SolutionFile(BaseModel):
    file_label: str
    file_content: str
    description: Optional[str] = None

class MultiFileGradingRequest(BaseModel):
    assignment_text: str
    solutions: List[SolutionFile]

@app.post("/api/v1/assessment/evaluate-multi-file")
async def grade_multi_file(request: MultiFileGradingRequest):
    try:
        result = await evaluate_integrated(
            request.assignment_text,
            [s.dict() for s in request.solutions]
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/assessment/evaluate-multi-file/stream")
async def grade_multi_file_stream(request: MultiFileGradingRequest):
    async def stream_generator():
        async for line in evaluate_integrated_stream(
            request.assignment_text,
            [s.dict() for s in request.solutions]
        ):
            yield line
    
    return StreamingResponse(
        stream_generator(),
        media_type="application/x-ndjson"
    )
"""
