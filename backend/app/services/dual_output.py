# -*- coding: utf-8 -*-
"""
Dual output: same assessment → concise **teacher** view (decision) vs **student** view (learning).
Does not re-run models; assembles from `assess_btec_rag` result fields.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _find_spec_key_for_code(code: str, spec_criteria: Any) -> Optional[str]:
    if not isinstance(spec_criteria, dict):
        return None
    c = (code or "").strip()
    if not c:
        return None
    if c in spec_criteria:
        return c
    cu = c.upper().replace(" ", "")
    for k in spec_criteria:
        ks = str(k).strip()
        if ks.upper().replace(" ", "") == cu:
            return ks
    return None


def _minimum_acceptable_for_code(code: str, assignment_spec: Dict[str, Any]) -> Optional[str]:
    if assignment_spec.get("assignment_spec_ok") is not True:
        return None
    crit = assignment_spec.get("criteria")
    k = _find_spec_key_for_code(code, crit)
    if not k or not isinstance(crit, dict):
        return None
    row = crit.get(k)
    if not isinstance(row, dict):
        return None
    ma = str(row.get("minimum_acceptable") or "").strip()
    return ma if ma else None


def _mean_criterion_confidence(criteria_results: Any) -> Optional[float]:
    vals: List[float] = []
    if not isinstance(criteria_results, list):
        return None
    for r in criteria_results:
        if not isinstance(r, dict):
            continue
        c = r.get("confidence")
        if isinstance(c, (int, float)) and 0.0 <= float(c) <= 1.0:
            vals.append(float(c))
    if not vals:
        return None
    return round(sum(vals) / len(vals), 4)


def _merged_flags(result: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    cv = result.get("consistency_validation")
    if isinstance(cv, dict) and isinstance(cv.get("flags"), list):
        for x in cv["flags"]:
            s = str(x).strip()
            if s and s not in out:
                out.append(s)
        return out
    bf = result.get("balance_flags")
    if isinstance(bf, list):
        for x in bf:
            s = str(x).strip()
            if s and s not in out:
                out.append(s)
    return out


def build_teacher_view(result: Dict[str, Any]) -> Dict[str, Any]:
    """
    For educators: quick band, per-code achieved, system flags, mean row confidence.
    """
    cr = result.get("criteria_results") or []
    asp = result.get("assignment_spec")
    assignment_spec = asp if isinstance(asp, dict) else None
    criteria_summary: List[Dict[str, Any]] = []
    if isinstance(cr, list):
        for r in cr:
            if not isinstance(r, dict):
                continue
            code = str(r.get("code") or "").strip()
            if not code:
                continue
            row_out: Dict[str, Any] = {"code": code, "achieved": bool(r.get("achieved"))}
            if assignment_spec is not None:
                m = _minimum_acceptable_for_code(code, assignment_spec)
                if m:
                    row_out["minimum_acceptable"] = m
            crl = r.get("confidence_reason")
            if isinstance(crl, list) and crl:
                row_out["confidence_reason"] = [str(x) for x in crl if str(x).strip()][:20]
            csa = r.get("confidence_summary_ar")
            if isinstance(csa, list) and csa:
                row_out["confidence_summary_ar"] = [str(x) for x in csa if str(x).strip()][:5]
            cfv = r.get("confidence")
            if isinstance(cfv, (int, float)):
                row_out["criterion_confidence"] = round(float(cfv), 4)
            criteria_summary.append(row_out)
    out: Dict[str, Any] = {
        "grade_band": result.get("grade_band"),
        "criteria_summary": criteria_summary,
        "flags": _merged_flags(result),
        "confidence": _mean_criterion_confidence(cr),
        "evidence_diversity_ok": result.get("evidence_diversity_ok"),
        "criteria_undetected": bool(result.get("criteria_undetected")),
    }
    if isinstance(result.get("spec_quality"), (int, float)):
        out["spec_quality"] = float(result["spec_quality"])
    if "spec_penalties_disabled" in result:
        out["spec_penalties_disabled"] = result.get("spec_penalties_disabled")
    if isinstance(result.get("student_level"), str) and result.get("student_level"):
        out["student_level"] = str(result.get("student_level"))
    if "relax_thresholds" in result:
        out["relax_thresholds"] = result.get("relax_thresholds")
    if "grade_band_stability_applied" in result:
        out["grade_band_stability_applied"] = result.get("grade_band_stability_applied")
    if "grade_band_upper_guard_applied" in result:
        out["grade_band_upper_guard_applied"] = result.get("grade_band_upper_guard_applied")
    aud = result.get("audit")
    if isinstance(aud, dict):
        out["audit"] = aud
    if isinstance(result.get("overall_confidence"), (int, float)):
        out["overall_confidence"] = float(result["overall_confidence"])
    fmt = result.get("submission_format")
    if isinstance(fmt, str) and fmt.strip():
        out["submission_format"] = fmt.strip()
    lbl = result.get("submission_format_label")
    if isinstance(lbl, str) and lbl.strip():
        out["submission_format_label"] = lbl.strip()
    asp2 = result.get("assignment_spec")
    if isinstance(asp2, dict):
        if asp2.get("assignment_spec_ok") is True:
            out["assignment_spec_brief"] = {
                "ok": True,
                "assignment_type": asp2.get("assignment_type"),
                "expected_format": asp2.get("expected_format"),
                "evidence_count": len(asp2["evidence_required"])
                if isinstance(asp2.get("evidence_required"), list)
                else 0,
                "criteria_count": len(asp2["criteria"]) if isinstance(asp2.get("criteria"), dict) else 0,
            }
        else:
            out["assignment_spec_brief"] = {"ok": False}
    return out


def build_student_view(result: Dict[str, Any]) -> Dict[str, Any]:
    """
    For learners: pedagogy (feedback) + optional guided improvement; no duplicate LLM work.
    """
    feedback = result.get("student_feedback")
    if not isinstance(feedback, list):
        feedback = []
    out_s: Dict[str, Any] = {
        "feedback": feedback,
        "improvement": result.get("student_improvement"),
    }
    mom = result.get("progress_momentum_ar")
    if isinstance(mom, str) and mom.strip():
        out_s["momentum"] = mom.strip()[:2000]
    return out_s


def apply_dual_output(result: Dict[str, Any]) -> None:
    """Attaches `teacher` and `student` to the same payload returned by the API."""
    if not isinstance(result, dict):
        return
    result["teacher"] = build_teacher_view(result)
    result["student"] = build_student_view(result)
