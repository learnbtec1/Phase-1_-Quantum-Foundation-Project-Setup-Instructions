# -*- coding: utf-8 -*-
"""
Avatar Emotional Engine v1.0
-----------------------------
يُحوّل مخرجات التقييم الأكاديمي إلى بيانات مشاعر متعددة الطبقة
لتوجيه نقاط التحكم في الأفاتار (25 نقطة).

المبدأ الجوهري:
  — حتى التقييم السلبي (REFER) يُقدَّم بلهجة تشجيعية دافئة.
  — التحسّن بين المحاولات يُولّد مشاعر اعتراف واحتفال مرئية.
  — كل طبقة مُعيَّنة يمكن استهدافها مباشرة بـ VRM BlendShape أو Three.js.

الإخراج يُرسَل إلى:
  — AvatarCanvas.tsx  عبر window event  "eduverse:avatar-emotion"
  — أو مُضمَّن في استجابة JSON من /api/v1/eduverse/grade-verified
"""
from __future__ import annotations

from typing import Dict, Any, Optional

# ─── Base emotion profiles per BTEC grade ────────────────────────────────────
_GRADE_BASE: Dict[str, Dict[str, float]] = {
    "DISTINCTION": {
        # Facial
        "smile_weight":        0.85,
        "mouth_open":          0.20,   # slight open (enthusiasm)
        "brow_raise_inner":    0.35,
        "brow_raise_outer":    0.25,
        "brow_furrow":         0.00,
        "eye_wide":            0.40,
        "cheek_puff":          0.10,
        # Head / body
        "head_nod_freq":       1.20,   # frequent nods (affirmation)
        "head_tilt_deg":       3.00,   # gentle tilt (warmth)
        "forward_lean":        0.00,
        # Gaze
        "gaze_openness":       0.90,
        "blink_rate_mult":     0.85,   # fewer blinks (excitement)
        # Speech / gesture
        "speech_rate":         1.10,
        "speech_pitch":        1.05,
        "gesture_energy":      0.80,
        "gesture_type_index":  0,      # 0 = open_palms (celebration)
    },
    "MERIT": {
        "smile_weight":        0.65,
        "mouth_open":          0.10,
        "brow_raise_inner":    0.15,
        "brow_raise_outer":    0.10,
        "brow_furrow":         0.00,
        "eye_wide":            0.20,
        "cheek_puff":          0.00,
        "head_nod_freq":       0.90,
        "head_tilt_deg":       2.00,
        "forward_lean":        0.00,
        "gaze_openness":       0.80,
        "blink_rate_mult":     1.00,
        "speech_rate":         1.00,
        "speech_pitch":        1.02,
        "gesture_energy":      0.55,
        "gesture_type_index":  1,      # 1 = calm_open (affirming)
    },
    "PASS": {
        "smile_weight":        0.40,
        "mouth_open":          0.05,
        "brow_raise_inner":    0.05,
        "brow_raise_outer":    0.05,
        "brow_furrow":         0.10,
        "eye_wide":            0.10,
        "cheek_puff":          0.00,
        "head_nod_freq":       0.70,
        "head_tilt_deg":       1.00,
        "forward_lean":        0.00,
        "gaze_openness":       0.70,
        "blink_rate_mult":     1.10,
        "speech_rate":         0.95,
        "speech_pitch":        1.00,
        "gesture_energy":      0.35,
        "gesture_type_index":  1,
    },
    "REFER": {
        # Encouraging, not sad — concern with warmth
        "smile_weight":        0.15,   # subtle smile (empathy, not sorrow)
        "mouth_open":          0.00,
        "brow_raise_inner":    0.00,
        "brow_raise_outer":    0.00,
        "brow_furrow":         0.25,   # gentle concern
        "eye_wide":            0.00,
        "cheek_puff":          0.00,
        "head_nod_freq":       0.40,
        "head_tilt_deg":      -1.50,   # lean forward (attentive care)
        "forward_lean":        0.05,
        "gaze_openness":       0.88,   # strong eye contact (empathy)
        "blink_rate_mult":     1.30,
        "speech_rate":         0.88,   # slower (deliberate)
        "speech_pitch":        0.97,
        "gesture_energy":      0.20,
        "gesture_type_index":  2,      # 2 = pointing_toward_student (guidance)
    },
}

_GESTURE_NAMES = ["open_palms", "calm_open", "pointing_toward_student", "thumbs_up"]
_TEACHING_TONES = {
    "DISTINCTION": "celebratory",
    "MERIT":       "affirming_guidance",
    "PASS":        "gentle_encouragement",
    "REFER":       "encouraging_correction",
}


# ─── Longitudinal modifier  ──────────────────────────────────────────────────

def _apply_longitudinal_modifier(
    emotion: Dict[str, float],
    had_previous_failure: bool,
    now_improved:         bool,
) -> str:
    """
    Adjust emotion values based on the student's learning trajectory.
    Returns a string tag describing the longitudinal context.
    """
    if now_improved:
        # Visible pride/satisfaction: student recovered from a previous failure
        emotion["smile_weight"]     = min(1.0, emotion["smile_weight"]     + 0.12)
        emotion["brow_raise_inner"] = min(1.0, emotion["brow_raise_inner"] + 0.10)
        emotion["head_nod_freq"]    = min(2.0, emotion["head_nod_freq"]    + 0.35)
        emotion["gesture_energy"]   = min(1.0, emotion["gesture_energy"]   + 0.18)
        emotion["speech_pitch"]     = min(1.2, emotion["speech_pitch"]     + 0.04)
        return "improved_from_failure"

    if had_previous_failure:
        # Persistent struggle — lean in more, show concern, slow speech
        emotion["brow_furrow"]    = min(1.0, emotion["brow_furrow"] + 0.12)
        emotion["head_tilt_deg"] -= 1.5   # leaning forward more
        emotion["gaze_openness"]  = min(1.0, emotion["gaze_openness"] + 0.06)
        emotion["speech_rate"]    = max(0.70, emotion["speech_rate"]  - 0.05)
        emotion["forward_lean"]   = min(0.15, emotion["forward_lean"] + 0.05)
        return "persistent_struggle"

    return "first_attempt"


# ─── Main entry point ─────────────────────────────────────────────────────────

def generate_emotion_metadata(
    assessment_result: Dict[str, Any],
    previous_grade:    Optional[str] = None,
) -> Dict[str, Any]:
    """
    Convert an assessment result dict into a 25-point avatar emotion metadata packet.

    Args:
        assessment_result : full result dict from forensic_engine
                            (must contain "final_grade" and optionally "criteria"/"criteria_results")
        previous_grade    : grade string from a previous attempt, for longitudinal adjustment

    Returns:
        emotion_metadata  : JSON-serialisable dict structured for AvatarCanvas.tsx
    """
    raw_grade = (assessment_result.get("final_grade") or "REFER").upper()
    final_grade = raw_grade if raw_grade in _GRADE_BASE else "REFER"

    # Gather criteria results from either field name
    criteria_results: Dict[str, Any] = (
        assessment_result.get("criteria")
        or assessment_result.get("criteria_results")
        or {}
    )

    # Compute per-criterion stats
    total    = len(criteria_results)
    achieved = sum(1 for r in criteria_results.values() if r.get("achieved", False))
    achieved_pct = (achieved / total * 100) if total > 0 else 0.0

    # Copy base profile (mutable)
    emotion = dict(_GRADE_BASE[final_grade])

    # Fine-tune within the grade band based on achieved percentage
    # e.g. 90 % MERIT feels more positive than 55 % MERIT
    band_offset = (achieved_pct - 60.0) / 250.0   # ±0.16 range
    emotion["smile_weight"]  = max(0.0, min(1.0, emotion["smile_weight"]  + band_offset))
    emotion["gaze_openness"] = max(0.0, min(1.0, emotion["gaze_openness"] + band_offset * 0.5))

    # Longitudinal modifier
    had_prev_failure = (
        previous_grade is not None
        and previous_grade.upper() in ("REFER", "PASS")
    )
    now_improved = had_prev_failure and final_grade in ("MERIT", "DISTINCTION")
    longitudinal_tag = _apply_longitudinal_modifier(emotion, had_prev_failure, now_improved)

    # Criteria that were not achieved (for pointed feedback)
    unachieved = [
        code for code, r in criteria_results.items()
        if not r.get("achieved", True)
    ]

    # Gesture name
    gesture_idx  = int(emotion.get("gesture_type_index", 1))
    gesture_name = _GESTURE_NAMES[min(gesture_idx, len(_GESTURE_NAMES) - 1)]

    # Teaching tone
    teaching_tone = _TEACHING_TONES.get(final_grade, "affirming_guidance")
    if longitudinal_tag == "improved_from_failure":
        teaching_tone = "celebratory_recovery"

    # ─── Build output packet ──────────────────────────────────────────────────
    metadata: Dict[str, Any] = {
        "version":           "1.0",
        "grade":             final_grade,
        "achieved_percent":  round(achieved_pct, 1),
        "teaching_tone":     teaching_tone,
        "unachieved_criteria": unachieved,

        # ── Facial layer (maps to VRM BlendShape weights 0–1) ─────────────────
        "face": {
            "smile":       round(emotion["smile_weight"],      3),
            "mouth_open":  round(emotion["mouth_open"],        3),
            "brow_raise":  round(
                (emotion["brow_raise_inner"] + emotion["brow_raise_outer"]) / 2, 3
            ),
            "brow_furrow": round(emotion["brow_furrow"],       3),
            "eye_wide":    round(emotion["eye_wide"],          3),
            "cheek_puff":  round(emotion["cheek_puff"],        3),
        },

        # ── Gaze layer (maps to VRM LookAt + saccadic FSM parameters) ────────
        "gaze": {
            "openness":        round(emotion["gaze_openness"],   3),
            "target":          "camera",          # always face the viewer
            "blink_rate_mult": round(emotion["blink_rate_mult"], 3),
        },

        # ── Head / body layer (maps to neck bone + hip shift) ─────────────────
        "head": {
            "tilt_deg":    round(emotion["head_tilt_deg"],  2),
            "nod_freq":    round(emotion["head_nod_freq"],  2),
            "forward_lean": round(emotion["forward_lean"],  3),
        },

        # ── Speech prosody layer (maps to Azure TTS SSML prosody params) ──────
        "speech": {
            "rate":  round(emotion["speech_rate"],  3),
            "pitch": round(emotion["speech_pitch"], 3),
        },

        # ── Gesture layer (maps to animation clip selector) ───────────────────
        "gesture": {
            "energy": round(emotion["gesture_energy"], 3),
            "type":   gesture_name,
        },

        # ── Longitudinal meta (injected into TTS preamble for personalised speech) ──
        "longitudinal": {
            "had_previous_attempt": previous_grade is not None,
            "previous_grade":       previous_grade,
            "context":              longitudinal_tag,
        },
    }

    return metadata
