# -*- coding: utf-8 -*-
"""
btec_knowledge.py — BTEC Unit Knowledge Base Loader
====================================================
Loads, caches, and queries structured BTEC unit specification files
stored in backend/data/btec_specs/*.json.

Each JSON file represents one BTEC unit with its criteria at Pass/Merit/Distinction
levels. This service powers Cogni's adaptive teaching logic — it infers the student's
current pedagogical level and identifies the next unachieved criterion to scaffold.

Usage example (in tutor.py / agent_ws.py):
    from app.services.btec_knowledge import (
        load_unit, infer_teaching_level, get_next_criterion, list_units
    )
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Knowledge base directory (relative to this file: ../../data/btec_specs/) ─
_SPECS_DIR: Path = (
    Path(__file__).parent.parent.parent.parent  # backend/
    / "data"
    / "btec_specs"
)

# ── Level ordering for staircase logic ───────────────────────────────────────
_LEVEL_ORDER = ("pass", "merit", "distinction")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _specs_dir() -> Path:
    """Return the btec_specs directory path (auto-resolves from this file's location)."""
    return _SPECS_DIR


@lru_cache(maxsize=32)
def load_unit(unit_id: str) -> Optional[dict]:
    """Load and cache a BTEC unit specification JSON by unit_id.

    Scans all *.json files in the specs directory and returns the first
    whose ``unit_id`` field matches.  Returns ``None`` if not found.

    Args:
        unit_id: e.g. "unit25", "unit1" — must match the ``unit_id`` field in JSON.

    Returns:
        Parsed JSON dict, or None.
    """
    specs_dir = _specs_dir()
    if not specs_dir.exists():
        logger.warning("[BTECKnowledge] btec_specs directory not found: %s", specs_dir)
        return None

    for json_file in sorted(specs_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            if data.get("unit_id") == unit_id:
                logger.debug("[BTECKnowledge] Loaded unit %r from %s", unit_id, json_file.name)
                return data
        except Exception as exc:
            logger.warning("[BTECKnowledge] Failed to parse %s: %s", json_file.name, exc)

    logger.warning("[BTECKnowledge] Unit %r not found in specs dir", unit_id)
    return None


def list_units() -> list[dict]:
    """Return a summary list of all available BTEC units (id + title + criterion count).

    Returns:
        List of dicts: [{unit_id, title, qualification, criterion_count}, ...]
    """
    specs_dir = _specs_dir()
    if not specs_dir.exists():
        return []

    result = []
    for json_file in sorted(specs_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            result.append({
                "unit_id":         data.get("unit_id", ""),
                "title":           data.get("title", ""),
                "qualification":   data.get("qualification", ""),
                "criterion_count": len(data.get("criteria", [])),
                "filename":        json_file.name,
            })
        except Exception as exc:
            logger.warning("[BTECKnowledge] Failed to list %s: %s", json_file.name, exc)

    return result


def infer_teaching_level(achieved: list[str], unit: dict) -> str:
    """Determine the pedagogical level (pass/merit/distinction) based on achieved criteria.

    Logic — BTEC Staircase:
    - If all Pass AND all Merit criteria are achieved → "distinction"
    - If all Pass criteria are achieved → "merit"
    - Otherwise → "pass"

    Args:
        achieved: List of criterion codes already achieved, e.g. ["P1", "P2", "P3"].
        unit:     Loaded unit dict from load_unit().

    Returns:
        "pass", "merit", or "distinction".
    """
    criteria = unit.get("criteria", [])
    achieved_upper = {c.strip().upper() for c in achieved}

    pass_codes = {c["code"].upper() for c in criteria if c.get("level") == "pass"}
    merit_codes = {c["code"].upper() for c in criteria if c.get("level") == "merit"}

    all_pass_done = pass_codes.issubset(achieved_upper)
    all_merit_done = merit_codes.issubset(achieved_upper)

    if all_pass_done and all_merit_done:
        return "distinction"
    elif all_pass_done:
        return "merit"
    else:
        return "pass"


def get_next_criterion(achieved: list[str], unit: dict) -> Optional[dict]:
    """Find the next unachieved criterion the student should target.

    Follows BTEC staircase — only considers Merit/Distinction criteria after
    all lower-band criteria have been achieved.

    Args:
        achieved: List of criterion codes already achieved.
        unit:     Loaded unit dict from load_unit().

    Returns:
        Criterion dict {code, level, description, scaffold_question, keywords},
        or None if all criteria are achieved.
    """
    achieved_upper = {c.strip().upper() for c in achieved}
    criteria = unit.get("criteria", [])

    # Walk levels in order: pass → merit → distinction
    for level in _LEVEL_ORDER:
        level_criteria = [c for c in criteria if c.get("level") == level]
        for criterion in level_criteria:
            code = criterion.get("code", "").upper()
            if code not in achieved_upper:
                logger.debug(
                    "[BTECKnowledge] Next target criterion: %s (%s)", code, level
                )
                return criterion

    logger.info("[BTECKnowledge] All criteria achieved for unit %r", unit.get("unit_id"))
    return None


def get_achieved_summary(achieved: list[str], unit: dict) -> dict:
    """Return a structured summary of achievement status for each criterion.

    Args:
        achieved: List of achieved criterion codes.
        unit:     Loaded unit dict.

    Returns:
        {
          "total": int,
          "achieved_count": int,
          "by_level": {
            "pass":        {"total": n, "achieved": n, "codes": ["P1", ...]},
            "merit":       {"total": n, "achieved": n, "codes": ["M1", ...]},
            "distinction": {"total": n, "achieved": n, "codes": ["D1", ...]}
          }
        }
    """
    achieved_upper = {c.strip().upper() for c in achieved}
    criteria = unit.get("criteria", [])

    by_level: dict = {
        "pass": {"total": 0, "achieved": 0, "codes": []},
        "merit": {"total": 0, "achieved": 0, "codes": []},
        "distinction": {"total": 0, "achieved": 0, "codes": []},
    }

    for c in criteria:
        level = c.get("level", "pass")
        code = c.get("code", "").upper()
        if level in by_level:
            by_level[level]["total"] += 1
            by_level[level]["codes"].append(code)
            if code in achieved_upper:
                by_level[level]["achieved"] += 1

    total = sum(v["total"] for v in by_level.values())
    achieved_count = sum(v["achieved"] for v in by_level.values())

    return {
        "total": total,
        "achieved_count": achieved_count,
        "by_level": by_level,
    }


def invalidate_cache() -> None:
    """Clear the LRU cache — useful after uploading a new unit spec."""
    load_unit.cache_clear()
    logger.info("[BTECKnowledge] LRU cache cleared")
