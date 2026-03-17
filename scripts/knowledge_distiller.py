# -*- coding: utf-8 -*-
"""
knowledge_distiller.py — EDUVERSE Knowledge Atlas Generator
=============================================================
Scans F:\\jimini+sonnet+deep+hamza (the physical BTEC asset library) and the
backend/data/btec_specs/ knowledge base, then distils everything into a single
lightweight Markdown file:

    COGNI_KNOWLEDGE_ATLAS.md

This atlas is Sonnet's permanent reference:
  • Which BTEC units exist on disk
  • What document types are available per unit
  • What Cogni already knows (parsed spec files)
  • A ready "test prompt" for each unit

Usage:
    python scripts/knowledge_distiller.py
"""

import os
import json
from datetime import datetime
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
SOURCE_DIR   = Path(r"F:\jimini+sonnet+deep+hamza")
SPECS_DIR    = PROJECT_ROOT / "backend" / "data" / "btec_specs"
OUTPUT_FILE  = PROJECT_ROOT / "COGNI_KNOWLEDGE_ATLAS.md"

# ── Config ───────────────────────────────────────────────────────────────────
DOC_EXTENSIONS  = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".txt", ".md"}
MAX_KEY_FILES   = 6   # max sample filenames per folder
MAX_DEPTH       = 4   # don't recurse deeper than this inside SOURCE_DIR


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1 — Scan physical asset library (F:\jimini+sonnet+deep+hamza)
# ══════════════════════════════════════════════════════════════════════════════

def scan_source_dir(source: Path) -> dict:
    """Walk the source directory and build a structured inventory."""
    if not source.exists():
        print(f"⚠️  Source directory not found: {source}")
        print("   → Skipping physical asset scan. Atlas will show specs-only data.")
        return {}

    print(f"🔍 Scanning: {source}")
    inventory: dict[str, dict] = {}
    source_str = str(source)

    for root, dirs, files in os.walk(source):
        # Respect max depth
        rel = os.path.relpath(root, source)
        depth = 0 if rel == "." else len(Path(rel).parts)
        if depth >= MAX_DEPTH:
            dirs.clear()
            continue

        # Skip hidden / system dirs
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in {"__pycache__", "node_modules"}]

        folder_name = os.path.basename(root)
        rel_path    = os.path.relpath(root, source)

        # Only index folders that look unit/business/subject related
        folder_lower = folder_name.lower()
        is_relevant = any(kw in folder_lower for kw in [
            "unit", "business", "btec", "assignment", "marking", "scheme",
            "brief", "coursework", "task", "level3", "level 3",
        ])
        if not is_relevant and depth == 0:
            is_relevant = True  # always include top-level dirs

        if not is_relevant:
            continue

        doc_types: set[str] = set()
        key_files: list[str] = []
        total_docs = 0

        for fname in sorted(files):
            ext = Path(fname).suffix.lower()
            if ext in DOC_EXTENSIONS:
                doc_types.add(ext)
                total_docs += 1
                if len(key_files) < MAX_KEY_FILES:
                    key_files.append(fname)

        if total_docs == 0 and not any(
            Path(root, f).suffix.lower() in DOC_EXTENSIONS for f in files
        ):
            continue  # skip empty dirs

        inventory[rel_path] = {
            "folder_name":  folder_name,
            "rel_path":     rel_path.replace("\\", "/"),
            "depth":        depth,
            "total_docs":   total_docs,
            "doc_types":    sorted(doc_types),
            "key_files":    key_files,
        }

    print(f"   ✅ Found {len(inventory)} relevant folders with documentation")
    return inventory


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — Read parsed BTEC specs (backend/data/btec_specs/*.json)
# ══════════════════════════════════════════════════════════════════════════════

def load_btec_specs(specs_dir: Path) -> list[dict]:
    """Load all parsed unit spec JSONs."""
    specs = []
    if not specs_dir.exists():
        print(f"⚠️  btec_specs dir not found: {specs_dir}")
        return specs

    for json_file in sorted(specs_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            specs.append(data)
            print(f"   📘 Loaded spec: {json_file.name} — {len(data.get('criteria', []))} criteria")
        except Exception as e:
            print(f"   ⚠️  Failed to parse {json_file.name}: {e}")

    return specs


# ══════════════════════════════════════════════════════════════════════════════
# Phase 3 — Generate the Atlas Markdown
# ══════════════════════════════════════════════════════════════════════════════

def write_atlas(inventory: dict, specs: list[dict], output: Path) -> None:
    """Write the COGNI_KNOWLEDGE_ATLAS.md file."""
    lines: list[str] = []
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── Header ───────────────────────────────────────────────────────────────
    lines += [
        "# 🧠 COGNI KNOWLEDGE ATLAS",
        f"> Generated: {now} | Source: `{SOURCE_DIR}` + `backend/data/btec_specs/`",
        "",
        "This is Cogni's distilled reference for all physical BTEC learning assets and parsed unit specs.",
        "Use this atlas to guide scaffolding, criterion targeting, and resource references during tutoring.",
        "",
        "---",
        "",
    ]

    # ── Section 1: Parsed Unit Specs (Cogni already knows these) ─────────────
    lines += [
        "## ✅ Parsed Unit Specs (Cogni's Live Knowledge Base)",
        "",
        "These units are fully loaded into Cogni's adaptive teaching engine.",
        "Each criterion has an Arabic scaffold question for Pass / Merit / Distinction levels.",
        "",
    ]

    if not specs:
        lines.append("> ⚠️ No parsed specs found in `backend/data/btec_specs/`\n")
    else:
        for unit in specs:
            unit_id    = unit.get("unit_id", "?")
            title      = unit.get("title", unit_id)
            qual       = unit.get("qualification", "BTEC Level 3")
            criteria   = unit.get("criteria", [])
            pass_codes = [c["code"] for c in criteria if c.get("level") == "pass"]
            merit_codes= [c["code"] for c in criteria if c.get("level") == "merit"]
            dist_codes = [c["code"] for c in criteria if c.get("level") == "distinction"]

            lines += [
                f"### 📘 `{unit_id}` — {title}",
                f"**Qualification:** {qual}",
                f"**Criteria:** Pass [{', '.join(pass_codes)}] | Merit [{', '.join(merit_codes)}] | Distinction [{', '.join(dist_codes)}]",
                "",
            ]

            # Criteria table
            lines.append("| Code | Level | Description | Scaffold Question (AR) |")
            lines.append("|------|-------|-------------|------------------------|")
            for c in criteria:
                code = c.get("code", "")
                lvl  = c.get("level", "").capitalize()
                desc = c.get("description", "")[:70] + ("…" if len(c.get("description","")) > 70 else "")
                sq   = c.get("scaffold_question", "")[:60] + ("…" if len(c.get("scaffold_question","")) > 60 else "")
                lines.append(f"| `{code}` | {lvl} | {desc} | {sq} |")

            lines += ["", "---", ""]

    # ── Section 2: Physical Asset Inventory ──────────────────────────────────
    lines += [
        "## 📂 Physical Asset Library",
        f"> Source directory: `{SOURCE_DIR}`",
        "",
    ]

    if not inventory:
        lines += [
            "> ⚠️ Source directory not found or empty.",
            "> Run `python scripts/knowledge_distiller.py` after mounting the F: drive.",
            "",
        ]
    else:
        # Group by depth-0 (top-level folders)
        top_level = {k: v for k, v in inventory.items() if v["depth"] == 0}
        nested    = {k: v for k, v in inventory.items() if v["depth"] > 0}

        lines.append("### Top-Level Folders")
        lines.append("")
        lines.append("| Folder | Documents | Types | Sample Files |")
        lines.append("|--------|-----------|-------|--------------|")
        for rel, info in sorted(top_level.items()):
            types = ", ".join(info["doc_types"]) or "—"
            samples = ", ".join(info["key_files"][:3]) or "—"
            lines.append(f"| `{info['folder_name']}` | {info['total_docs']} | {types} | {samples} |")

        lines.append("")

        if nested:
            lines.append("### Unit / Subject Sub-folders")
            lines.append("")
            for rel, info in sorted(nested.items(), key=lambda x: x[1]["depth"]):
                indent = "  " * (info["depth"] - 1)
                samples = " • ".join(info["key_files"][:3]) or "—"
                types   = " ".join(info["doc_types"]) or "—"
                lines.append(f"{indent}- **{info['folder_name']}** (`{info['rel_path']}`) — {info['total_docs']} docs [{types}]")
                if info["key_files"]:
                    lines.append(f"{indent}  → {samples}")

        lines += ["", "---", ""]

    # ── Section 3: Teaching Logic Reference ──────────────────────────────────
    lines += [
        "## 🎓 Cogni Teaching Logic (BTEC Staircase)",
        "",
        "The adaptive engine in `tutor.py` uses the following level-detection formula:",
        "",
        "```",
        "if all Pass criteria achieved AND all Merit achieved → Distinction mode",
        "elif all Pass criteria achieved                      → Merit mode (Analytical)",
        "else                                                 → Pass mode (Descriptive)",
        "```",
        "",
        "| Level | Arabic Register | Bloom Verb | Teaching Instruction |",
        "|-------|----------------|------------|----------------------|",
        "| Pass | شرح بسيط | اشرح / صف | Ask student to DESCRIBE and LIST facts |",
        "| Merit | تحليل واضح | قارن / حلّل | Ask student to COMPARE and ANALYSE |",
        "| Distinction | نقد ومنطق أكاديمي | قيّم / طوّر | Ask student to EVALUATE and JUSTIFY |",
        "",
        "---",
        "",
    ]

    # ── Section 4: Test Prompts ───────────────────────────────────────────────
    lines += [
        "## 🧪 Ready Test Prompts",
        "",
        "Use these prompts in the avatar session to test Cogni's adaptive scaffolding:",
        "",
    ]

    for unit in specs:
        unit_id = unit.get("unit_id", "?")
        title   = unit.get("title", unit_id)
        criteria = unit.get("criteria", [])
        pass_codes = [c["code"] for c in criteria if c.get("level") == "pass"]
        first_pass = pass_codes[0] if pass_codes else "P1"

        lines += [
            f"### Test: {title}",
            "",
            "**Scenario A — Struggling student (zero achieved):**",
            f"```",
            f"WebSocket btec_progress: {{unit_id: '{unit_id}', achieved: []}}",
            f"Expected: Pass mode → Cogni asks descriptive question about {first_pass}",
            f"```",
            "",
        ]

        if len(pass_codes) >= 2:
            all_pass = json.dumps(pass_codes)
            merit_codes = [c["code"] for c in criteria if c.get("level") == "merit"]
            first_merit = merit_codes[0] if merit_codes else "M1"
            lines += [
                "**Scenario B — All Pass done, Merit pending:**",
                f"```",
                f"WebSocket btec_progress: {{unit_id: '{unit_id}', achieved: {all_pass}}}",
                f"Expected: Merit mode → Cogni switches to analytical questions targeting {first_merit}",
                f"```",
                "",
            ]

    lines += [
        "---",
        "",
        f"*Atlas last regenerated: {now}*",
        "*To update: `python scripts/knowledge_distiller.py`*",
    ]

    output.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n✅ Atlas written → {output}")
    print(f"   Lines: {len(lines)} | Size: {output.stat().st_size // 1024} KB")


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 60)
    print("  COGNI Knowledge Distiller — EDUVERSE Atlas Generator")
    print("=" * 60)
    print()

    print("Phase 1: Scanning physical asset library…")
    inventory = scan_source_dir(SOURCE_DIR)
    print()

    print("Phase 2: Loading parsed BTEC specs…")
    specs = load_btec_specs(SPECS_DIR)
    print()

    print("Phase 3: Writing atlas…")
    write_atlas(inventory, specs, OUTPUT_FILE)
    print()
    print("Done. Give COGNI_KNOWLEDGE_ATLAS.md to Sonnet as context.")
