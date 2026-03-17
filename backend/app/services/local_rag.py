# -*- coding: utf-8 -*-
"""
local_rag.py — Advanced Local BTEC Document Retrieval Augmentation
===================================================================
Performs a "thermal scan" of a configured local directory for BTEC
PDF / DOCX / TXT files, chunks them, builds an inverted TF-IDF index,
and retrieves the top-k most relevant passages for a given query.

Used to enrich Cogni's responses for Merit and Distinction levels with
direct inline citations from actual BTEC specification documents.

Configuration (env vars):
  LOCAL_RAG_DIR         Path to scan  (default: E:/BTEC)
  LOCAL_RAG_CHUNK_SIZE  Chars per chunk (default: 600)
  LOCAL_RAG_MAX_FILES   Max files to index (default: 50)
  LOCAL_RAG_ENABLED     "true" to enable (default: false — opt-in)

Usage::
    from app.services.local_rag import retrieve_local_context, rag_status
    chunks = await retrieve_local_context("PESTLE analysis Merit", top_k=3)
    # Returns: [{text, source, page, score}, ...]
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("nexus.local_rag")

# ── Configuration (read from env, with safe defaults) ────────────────────────
_DEFAULT_RAG_DIR = r"E:\BTEC"

RAG_DIR      = Path(os.getenv("LOCAL_RAG_DIR",      _DEFAULT_RAG_DIR))
CHUNK_SIZE   = int(os.getenv("LOCAL_RAG_CHUNK_SIZE", "600"))
MAX_FILES    = int(os.getenv("LOCAL_RAG_MAX_FILES",  "50"))
RAG_ENABLED  = os.getenv("LOCAL_RAG_ENABLED", "false").lower() in ("1", "true", "yes")

# ── Atlas knowledge file (highest-priority source) ────────────────────────────
ATLAS_FILENAME = Path(os.getenv("LOCAL_KNOWLEDGE_ATLAS", "COGNI_KNOWLEDGE_ATLAS.md")).name
ATLAS_BOOST    = 1.8   # Score multiplier applied to every chunk from the Atlas file

# ── Unit 1: Business Environments — priority focus ───────────────────────────
UNIT1_BOOST        = 1.4   # Extra score multiplier for Unit 1 source files
UNIT1_FILE_PATTERNS = ("unit1", "unit_1", "business_environment", "business environment")
UNIT1_KEYWORDS = frozenset([
    "stakeholder", "stakeholders", "business environment", "pestle", "swot",
    "ownership", "shareholders", "employee", "employees", "customer", "customers",
    "supplier", "suppliers", "economic", "social", "technology", "government",
    "regulation", "competition", "competitor", "internal", "external",
    # Arabic Unit 1 terms
    "أصحاب المصلحة", "البيئة التجارية", "المساهمون", "المنافسة", "الحكومة",
    "الاقتصاد", "الموردون", "الملكية",
])

# ── Arabic stopwords (high-frequency, low-information tokens) ─────────────────
_AR_STOPWORDS = frozenset([
    "في", "من", "إلى", "على", "أن", "هذا", "هذه", "ذلك", "التي", "الذي",
    "وفي", "مع", "كما", "عن", "لا", "ما", "حيث", "ان", "كان", "كانت",
    "يكون", "يمكن", "التي", "قد", "إن", "لقد", "أو", "لم", "ثم", "حتى",
    "بعد", "قبل", "بين", "كل", "لكل", "عند", "أي", "لكن", "بل", "منذ",
    "and", "or", "the", "a", "an", "in", "of", "to", "for", "is", "are",
    "was", "be", "by", "with", "at", "this", "that", "it", "its", "on",
])


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class RagChunk:
    text:   str
    source: str          # filename (no path)
    page:   int = 0      # 1-based page / chunk index
    score:  float = 0.0  # TF-IDF relevance score


@dataclass
class _DocIndex:
    chunks:     List[RagChunk]
    tf:         List[dict]   # term → raw freq, per chunk
    df:         dict         # term → doc count across corpus
    idf:        dict         # term → idf weight
    file_hash:  str = ""     # SHA-256 of file bytes (for staleness detection)
    built_at:   float = field(default_factory=time.time)


# ── Module-level index cache ──────────────────────────────────────────────────
_INDEX:  Optional[_DocIndex] = None
_LOCK    = asyncio.Lock()
_LAST_BUILT: float = 0.0
_CACHE_TTL  = 300.0   # rebuild every 5 minutes


# ── Text extraction helpers ────────────────────────────────────────────────────

def _extract_text(path: Path) -> str:
    """Extract raw text from PDF / DOCX / TXT.  Gracefully skips unreadable files."""
    suffix = path.suffix.lower()
    try:
        if suffix == ".txt":
            for enc in ("utf-8", "utf-8-sig", "cp1256", "latin-1"):
                try:
                    return path.read_text(encoding=enc)
                except UnicodeDecodeError:
                    continue
            return path.read_bytes().decode("utf-8", errors="replace")

        if suffix == ".docx":
            import docx  # python-docx
            doc = docx.Document(str(path))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        if cell.text.strip():
                            paragraphs.append(cell.text.strip())
            return "\n".join(paragraphs)

        if suffix == ".pdf":
            import fitz  # pymupdf
            doc = fitz.open(str(path))
            pages: List[str] = []
            for page in doc:
                text = page.get_text().strip()
                if text:
                    pages.append(text)
            return "\n".join(pages)

    except ImportError as e:
        logger.debug("[RAG] Missing library for %s: %s", path.name, e)
    except Exception as e:
        logger.warning("[RAG] Extraction failed %s: %s", path.name, e)
    return ""


def _chunk_text(text: str, source: str, chunk_size: int = CHUNK_SIZE) -> List[RagChunk]:
    """Split text into overlapping chunks (25% overlap for context continuity)."""
    # Normalise whitespace
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    if not text:
        return []

    step    = max(1, int(chunk_size * 0.75))   # 75% step = 25% overlap
    chunks: List[RagChunk] = []
    idx     = 0
    page    = 1

    while idx < len(text):
        snippet = text[idx: idx + chunk_size]
        if snippet.strip():
            chunks.append(RagChunk(text=snippet.strip(), source=source, page=page))
        idx  += step
        page += 1

    return chunks


# ── TF-IDF index helpers ──────────────────────────────────────────────────────

def _tokenise(text: str) -> List[str]:
    """Very lightweight Arabic + English tokenizer."""
    # Lower-case, keep Arabic + Latin alphanumeric, split on everything else
    text = text.lower()
    tokens = re.findall(r'[\u0600-\u06ff]+|[a-z0-9]+', text)
    return [t for t in tokens if t not in _AR_STOPWORDS and len(t) > 1]


def _build_index(chunks: List[RagChunk]) -> _DocIndex:
    """Build a TF-IDF index from a list of chunks."""
    N        = len(chunks)
    tf_list: List[dict] = []
    df: dict = {}

    for chunk in chunks:
        tokens = _tokenise(chunk.text)
        tf: dict = {}
        for tok in tokens:
            tf[tok] = tf.get(tok, 0) + 1
        tf_list.append(tf)
        for tok in set(tf):
            df[tok] = df.get(tok, 0) + 1

    # IDF = log(N / (df + 1))  — smoothed
    idf = {tok: math.log((N + 1) / (cnt + 1)) for tok, cnt in df.items()}

    return _DocIndex(chunks=chunks, tf=tf_list, df=df, idf=idf)


def _score_chunk(query_tokens: List[str], tf: dict, idf: dict) -> float:
    """TF-IDF cosine-like score for one chunk against tokenised query."""
    score = 0.0
    for tok in query_tokens:
        if tok in tf:
            tf_val  = 1 + math.log(tf[tok]) if tf[tok] > 0 else 0
            idf_val = idf.get(tok, 0.0)
            score  += tf_val * idf_val
    return score


# ── Index building / refreshing ───────────────────────────────────────────────

def _scan_files(rag_dir: Path) -> List[Path]:
    """Return up to MAX_FILES PDF/DOCX/TXT files, most recently modified first."""
    files: List[Path] = []
    for ext in ("*.pdf", "*.docx", "*.txt", "*.PDF", "*.DOCX"):
        files.extend(rag_dir.rglob(ext))
    # Sort by mtime desc, limit
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:MAX_FILES]


def _build_or_refresh() -> Optional[_DocIndex]:
    """Synchronous index build — called inside a thread-pool executor."""
    global _LAST_BUILT

    if not RAG_ENABLED:
        return None

    if not RAG_DIR.exists():
        logger.warning("[RAG] Directory not found: %s — RAG disabled", RAG_DIR)
        return None

    files = _scan_files(RAG_DIR)
    if not files:
        logger.info("[RAG] No PDF/DOCX/TXT files found in %s", RAG_DIR)
        return None

    all_chunks: List[RagChunk] = []
    for fpath in files:
        text = _extract_text(fpath)
        if text:
            chunks = _chunk_text(text, source=fpath.name, chunk_size=CHUNK_SIZE)
            all_chunks.extend(chunks)
            logger.debug("[RAG] Indexed %d chunks from %s", len(chunks), fpath.name)

    if not all_chunks:
        return None

    index = _build_index(all_chunks)
    _LAST_BUILT = time.time()
    logger.info("[RAG] Index built: %d chunks from %d files", len(all_chunks), len(files))
    return index


async def _ensure_index() -> Optional[_DocIndex]:
    """Return the current index, rebuilding asynchronously if stale."""
    global _INDEX, _LAST_BUILT

    now = time.time()
    if _INDEX is not None and (now - _LAST_BUILT) < _CACHE_TTL:
        return _INDEX

    async with _LOCK:
        # Double-check inside lock
        now = time.time()
        if _INDEX is not None and (now - _LAST_BUILT) < _CACHE_TTL:
            return _INDEX
        logger.info("[RAG] Building/refreshing index from %s …", RAG_DIR)
        loop = asyncio.get_event_loop()
        _INDEX = await loop.run_in_executor(None, _build_or_refresh)
        return _INDEX


# ── Public API ────────────────────────────────────────────────────────────────

async def retrieve_local_context(
    query: str,
    top_k: int = 3,
    min_score: float = 0.5,
    persona_level: str = "pass",
    unit_id: str = "",
) -> List[RagChunk]:
    """Retrieve the top-k most relevant local document chunks for a query.

    Only activates for Merit and Distinction personas (Pass receives no RAG
    augmentation — keep it warm and conversational).

    Args:
        query:         Student message or derived search query.
        top_k:         Maximum chunks to return.
        min_score:     Minimum TF-IDF score threshold.
        persona_level: "pass" | "merit" | "distinction"

    Returns:
        List of RagChunk (may be empty if RAG disabled or no matches).
    """
    # Pass mode → skip RAG (keep it warm, not academic)
    if persona_level == "pass":
        return []

    if not RAG_ENABLED:
        return []

    index = await _ensure_index()
    if index is None or not index.chunks:
        return []

    query_tokens = _tokenise(query)
    if not query_tokens:
        return []

    _query_lower = query.lower()
    _unit1_active = unit_id.lower() == "unit1" or any(kw in _query_lower for kw in UNIT1_KEYWORDS)

    scored: List[tuple[float, int]] = []
    for i, (chunk, tf) in enumerate(zip(index.chunks, index.tf)):
        s = _score_chunk(query_tokens, tf, index.idf)
        # Atlas priority: boost score for chunks from COGNI_KNOWLEDGE_ATLAS.md
        if chunk.source == ATLAS_FILENAME:
            s *= ATLAS_BOOST
        # Unit 1 priority: boost chunks from Unit 1 source files when topic matches
        if _unit1_active:
            _src = (chunk.source or "").lower()
            if any(pat in _src for pat in UNIT1_FILE_PATTERNS):
                s *= UNIT1_BOOST
        if s >= min_score:
            scored.append((s, i))

    # Sort descending by score, take top_k
    scored.sort(reverse=True)
    results: List[RagChunk] = []
    for score, idx in scored[:top_k]:
        chunk = index.chunks[idx]
        chunk.score = round(score, 3)
        results.append(chunk)

    logger.info(
        "[RAG] Query=%r persona=%s → %d chunks found (top score=%.2f)",
        query[:50], persona_level, len(results),
        results[0].score if results else 0.0,
    )
    return results


def rag_status() -> dict:
    """Return a status dict for health checks / debug endpoints."""
    return {
        "enabled":     RAG_ENABLED,
        "rag_dir":     str(RAG_DIR),
        "dir_exists":  RAG_DIR.exists() if RAG_ENABLED else False,
        "indexed":     _INDEX is not None,
        "chunk_count": len(_INDEX.chunks) if _INDEX else 0,
        "last_built":  _LAST_BUILT,
        "cache_ttl_s": _CACHE_TTL,
    }


def format_rag_context(
    chunks: List[RagChunk],
    persona_level: str = "merit",
    crystallize: bool = True,
) -> str:
    """Format retrieved chunks into a system-prompt injection block.

    Args:
        chunks:        Retrieved RAG chunks.
        persona_level: "merit" | "distinction" — controls header label.
        crystallize:   True (default) — instructs the LLM to *synthesize* the
                       knowledge into natural Arabic instead of quoting verbatim.
                       False — legacy citation mode with source prefix.

    Output is appended to the BTEC scaffold block when RAG hits are found.
    """
    if not chunks:
        return ""

    level_label = {
        "merit":       "Merit-level analytical depth",
        "distinction": "Distinction-level evaluative depth",
    }.get(persona_level, "analytical depth")

    if crystallize:
        lines = [
            "",
            "=" * 63,
            f"LOCAL BTEC KNOWLEDGE — CRYSTALLIZE MODE ({level_label.upper()})",
            "INSTRUCTION: Do NOT copy the following text verbatim.",
            "SYNTHESIZE the core concepts into your own clear Arabic explanation.",
            "Integrate knowledge naturally — sound like a teacher who has read this,",
            "not a student who is quoting it. No citation prefixes required.",
            "=" * 63,
        ]
    else:
        lines = [
            "",
            "=" * 63,
            f"LOCAL BTEC DOCUMENT CONTEXT — {level_label.upper()}",
            "Use the following excerpts to support your explanation.",
            "Paraphrase naturally — no verbatim copy.",
            "=" * 63,
        ]

    for i, chunk in enumerate(chunks, 1):
        atlas_tag = " [ATLAS]" if chunk.source == ATLAS_FILENAME else ""
        lines.append(f"\n[Source {i}{atlas_tag}: {chunk.source} | chunk {chunk.page}]")
        lines.append(chunk.text[:500])   # cap per-chunk injection to 500 chars

    lines.append("=" * 63)
    return "\n".join(lines)
