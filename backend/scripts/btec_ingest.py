#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ingest BTEC Business curriculum files from backend/data/btec-bus into ChromaDB.

Uses the same persistent Chroma path as app.services.episodic_memory (backend/data/chroma_cogni)
but a dedicated collection: btec_knowledge_base.

Run from repository root (or anywhere) with PYTHONPATH pointing at backend::

    cd /path/to/repo
    set PYTHONPATH=backend
    python backend/scripts/btec_ingest.py

Override source folder (optional)::

    set BTEC_INGEST_DATA_DIR=E:\\path\\to\\extra\\pdfs
    python backend/scripts/btec_ingest.py

Or pass ``--data-dir`` once per root; re-run to add another tree to the same Chroma collection.

On Unix::

    PYTHONPATH=backend python backend/scripts/btec_ingest.py

Requires OPENAI_API_KEY in the environment or backend/.env (text-embedding-3-small).

PDFs and DOCX are discovered and loaded via ``langchain_community.document_loaders.DirectoryLoader``
(recursive globs). Plain text files use ``DirectoryLoader`` where UTF-8 works; otherwise a
per-file fallback with multiple encodings. Documents are split and written **per source file**
so memory stays bounded.

Idempotent per file: before re-adding chunks, existing rows with the same ``source_file``
metadata (path relative to btec-bus) are deleted.
"""
from __future__ import annotations

import sys

# Chroma PersistentClient — same SQLite swap as app.main (pysqlite3-binary in requirements.txt).
try:
    __import__("pysqlite3")
    sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")
except ImportError:
    pass

import argparse
import hashlib
import logging
import os
import re
import time
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

# ── Resolve backend root on sys.path (same pattern as export_training_data.py) ─
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

logger = logging.getLogger("btec_ingest")

# Match app.services.episodic_memory._DATA_DIR (PersistentClient path)
_CHROMA_PERSIST_DIR = _BACKEND_ROOT / "data" / "chroma_cogni"
_BTEC_DIR_DEFAULT = _BACKEND_ROOT / "data" / "btec-bus"
_COLLECTION_NAME = "btec_knowledge_base"


def _resolve_ingest_root(cli_path: Path | None) -> Path:
    """CLI --data-dir wins; else BTEC_INGEST_DATA_DIR; else backend/data/btec-bus."""
    if cli_path is not None:
        return cli_path
    env_dir = (os.getenv("BTEC_INGEST_DATA_DIR") or "").strip()
    if env_dir:
        return Path(env_dir)
    return _BTEC_DIR_DEFAULT

_EMBED_BATCH = 48
_EMBED_MODEL = "text-embedding-3-small"
_CHUNK_SIZE = 600
_CHUNK_OVERLAP = 100


def _load_env() -> None:
    env_file = _BACKEND_ROOT.parent / ".env"
    if env_file.is_file() and load_dotenv:
        load_dotenv(env_file)
    be = _BACKEND_ROOT / ".env"
    if be.is_file() and load_dotenv:
        load_dotenv(be, override=False)


def _iter_txt_files(root: Path) -> Iterable[Path]:
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name.startswith("~$") or p.name.startswith("."):
            continue
        if p.suffix.lower() != ".txt":
            continue
        yield p


def _count_ingestable_files(root: Path) -> tuple[int, int, int]:
    """Counts by extension, case-insensitive (Docker/Linux is case-sensitive for globs)."""
    pdf = docx = txt = 0
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        s = p.suffix.lower()
        if s == ".pdf":
            pdf += 1
        elif s == ".docx":
            docx += 1
        elif s == ".txt":
            txt += 1
    return pdf, docx, txt


def _directory_loader_document_batches(
    btec_root: Path,
    glob_pattern: str,
    loader_cls: type,
    loader_kwargs: Dict | None = None,
) -> Iterable[Tuple[Path, List]]:
    """
    Stream (resolved_path, page_docs) using DirectoryLoader.lazy_load().
    Assumes consecutive documents from the same file share metadata['source'].
    """
    from langchain_community.document_loaders import DirectoryLoader

    loader_kwargs = loader_kwargs or {}
    dl = DirectoryLoader(
        str(btec_root),
        glob=glob_pattern,
        loader_cls=loader_cls,
        loader_kwargs=loader_kwargs,
        recursive=True,
        show_progress=False,
    )
    current_key: Path | None = None
    batch: List = []

    try:
        for doc in dl.lazy_load():
            raw = doc.metadata.get("source") or ""
            if not raw:
                continue
            src = Path(raw).resolve()
            if "~$" in src.name:
                continue
            if current_key is not None and src != current_key:
                yield current_key, batch
                batch = []
            current_key = src
            batch.append(doc)
        if current_key is not None and batch:
            yield current_key, batch
    except Exception as e:
        logger.error("DirectoryLoader (%s): %s", glob_pattern, e)


def _load_txt_documents(path: Path, btec_root: Path) -> List:
    """TextLoader with encoding fallbacks (DirectoryLoader often fails on mixed encodings)."""
    from langchain_community.document_loaders import TextLoader
    from langchain_core.documents import Document

    rel = path.relative_to(btec_root).as_posix()
    docs: List = []
    for enc in ("utf-8", "utf-8-sig", "cp1256", "latin-1"):
        try:
            loader = TextLoader(str(path), encoding=enc)
            docs = loader.load()
            break
        except (UnicodeDecodeError, OSError, ValueError):
            continue
    if not docs:
        text = path.read_bytes().decode("utf-8", errors="replace")
        docs = [Document(page_content=text, metadata={"source": rel})]
    for d in docs:
        d.metadata.setdefault("source", rel)
    return docs


def _split_documents(docs: List) -> List:
    try:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
    except ImportError:
        from langchain.text_splitter import RecursiveCharacterTextSplitter  # type: ignore

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=_CHUNK_SIZE,
        chunk_overlap=_CHUNK_OVERLAP,
        length_function=len,
        add_start_index=False,
    )
    return splitter.split_documents(docs)


def _sort_page_docs(docs: List) -> List:
    def _page_key(d) -> int:
        m = d.metadata or {}
        p = m.get("page", m.get("page_number", 0))
        try:
            return int(p)
        except (TypeError, ValueError):
            return 0

    return sorted(docs, key=_page_key)


def _page_number_for_chunk(meta: dict) -> int:
    if not meta:
        return 0
    for key in ("page", "page_number"):
        v = meta.get(key)
        if v is None:
            continue
        try:
            n = int(v)
            if key == "page" and n >= 0:
                return n + 1
            return max(0, n)
        except (TypeError, ValueError):
            continue
    return 0


def _stable_chunk_id(source_rel: str, chunk_index: int) -> str:
    h = hashlib.sha256(f"{source_rel}\0{chunk_index}".encode("utf-8")).hexdigest()[:20]
    return f"btec_{h}_{chunk_index:05d}"


# Match btec_chroma_rag.BTEC_CRITERION_CODE_RE (P1, M2, D3, A.P1, …)
_CRITERION_IN_TEXT_RE = re.compile(
    r"\b(?:[A-Za-z]\.|[0-9]\.)?([PpMmDd])(\d{1,2})\b",
)


def _unit_id_from_relative_path(rel: str) -> str:
    if not rel:
        return "unknown"
    m = re.search(r"(?:unit|u)[_/\- ](\d+)", rel, re.I)
    if m:
        return f"unit_{m.group(1)}"
    m2 = re.search(r"\bu(\d+)\b", rel, re.I)
    if m2:
        return f"unit_{m2.group(1)}"
    return "unknown"


def _criterion_level_from_text(text: str, filename: str = "") -> tuple[str, str]:
    """Return (criterion_code, level) with level in Pass|Merit|Distinction or ""."""
    for blob in (text[:8000], filename):
        if not blob:
            continue
        m = _CRITERION_IN_TEXT_RE.search(blob)
        if m:
            pm = m.group(1).upper()
            num = m.group(2)
            code = f"{pm}{num}"
            level = {"P": "Pass", "M": "Merit", "D": "Distinction"}.get(pm, "")
            return code, level
    return "", ""


def _ingest_document_list(
    resolved_path: Path,
    btec_root: Path,
    docs: List,
    collection,
    embeddings,
    dry_run: bool,
) -> int:
    """Split, delete prior rows for this source_file, embed and add. Returns chunk count."""
    try:
        rel = resolved_path.relative_to(btec_root.resolve()).as_posix()
    except ValueError:
        rel = resolved_path.name

    if not docs:
        return 0

    docs = _sort_page_docs(docs)
    chunks = _split_documents(docs)
    if not chunks:
        logger.warning("No chunks after split: %s", rel)
        return 0

    metadatas: List[dict] = []
    documents: List[str] = []
    ids: List[str] = []
    logical_index = 0

    for ch in chunks:
        text = (ch.page_content or "").strip()
        if not text:
            continue
        page_num = _page_number_for_chunk(ch.metadata or {})
        unit_id = _unit_id_from_relative_path(rel)
        crit, level = _criterion_level_from_text(text, resolved_path.name)
        meta = {
            "source_file": rel,
            "page_number": int(page_num),
            "chunk_index": int(logical_index),
            "unit_id": unit_id,
            "criterion_code": crit,
            "level": level,
        }
        metadatas.append(meta)
        documents.append(text)
        ids.append(_stable_chunk_id(rel, logical_index))
        logical_index += 1

    if not documents:
        return 0

    _unique_ids = len(set(ids))
    if _unique_ids != len(ids):
        logger.warning(
            "Source %s: duplicate chunk ids in batch (total=%d unique=%d) — check splitter / stable id logic",
            rel,
            len(ids),
            _unique_ids,
        )
    logger.info(
        "Ingest prepare %s: chunks=%d unique_ids=%d (replaces prior Chroma rows for this source_file)",
        resolved_path.name,
        len(documents),
        _unique_ids,
    )

    if dry_run:
        logger.info("[dry-run] Would ingest %s — chunks=%d", rel, len(documents))
        return len(documents)

    try:
        collection.delete(where={"source_file": {"$eq": rel}})
    except Exception:
        try:
            collection.delete(where={"source_file": rel})
        except Exception as e2:
            logger.debug("Delete (optional) for %s: %s", rel, e2)

    total_added = 0
    for start in range(0, len(documents), _EMBED_BATCH):
        batch_docs = documents[start : start + _EMBED_BATCH]
        batch_meta = metadatas[start : start + _EMBED_BATCH]
        batch_ids = ids[start : start + _EMBED_BATCH]
        vectors = embeddings.embed_documents(batch_docs)
        collection.add(
            ids=batch_ids,
            documents=batch_docs,
            metadatas=batch_meta,
            embeddings=vectors,
        )
        total_added += len(batch_docs)
        logger.debug(
            "Chroma add batch: file=%s batch_size=%d cumulative_added=%d",
            resolved_path.name,
            len(batch_docs),
            total_added,
        )
        time.sleep(0.02)

    logger.info(
        "Processing: %s — chunks_added=%d unique_ids=%d",
        resolved_path.name,
        total_added,
        len(set(ids)),
    )
    return total_added


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest BTEC documents into ChromaDB.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="Root folder to scan (default: env BTEC_INGEST_DATA_DIR or backend/data/btec-bus)",
    )
    parser.add_argument(
        "--chroma-dir",
        type=Path,
        default=_CHROMA_PERSIST_DIR,
        help="Chroma persistent directory (default: same as episodic_memory)",
    )
    parser.add_argument("--dry-run", action="store_true", help="List work only; no Chroma writes")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    _load_env()
    if not os.getenv("OPENAI_API_KEY", "").strip():
        logger.error("OPENAI_API_KEY is not set. Add it to .env or the environment.")
        return 1

    btec_root = _resolve_ingest_root(args.data_dir).resolve()
    if not btec_root.is_dir():
        logger.error("Data directory does not exist: %s", btec_root)
        return 1

    chroma_dir = args.chroma_dir.resolve()
    chroma_dir.mkdir(parents=True, exist_ok=True)

    npdf, ndocx, ntxt = _count_ingestable_files(btec_root)
    logger.info(
        "Corpus %s — files found: pdf=%d docx=%d txt=%d (all zero → nothing to ingest; on host add files under backend/data/btec-bus)",
        btec_root,
        npdf,
        ndocx,
        ntxt,
    )

    try:
        import chromadb
        from langchain_community.document_loaders import PyPDFLoader, UnstructuredWordDocumentLoader
        from langchain_openai import OpenAIEmbeddings
    except ImportError as e:
        logger.error("Missing dependency: %s — pip install -r backend/requirements.txt", e)
        return 1

    client = chromadb.PersistentClient(path=str(chroma_dir))
    collection = client.get_or_create_collection(
        name=_COLLECTION_NAME,
        metadata={"description": "BTEC Business Administration curriculum (ingested)"},
    )

    embeddings = OpenAIEmbeddings(model=_EMBED_MODEL)

    total_chunks = 0
    ok_sources = 0
    failed = 0
    seen_paths: set[Path] = set()

    logger.info(
        "Chroma path=%s | collection=%s | model=%s",
        chroma_dir,
        _COLLECTION_NAME,
        _EMBED_MODEL,
    )

    # ── PDF / DOCX: recursive DirectoryLoader (uppercase extensions: Linux bind mounts)
    for glob_pat, cls in (
        ("**/*.pdf", PyPDFLoader),
        ("**/*.PDF", PyPDFLoader),
        ("**/*.docx", UnstructuredWordDocumentLoader),
        ("**/*.DOCX", UnstructuredWordDocumentLoader),
    ):
        for path_key, doc_batch in _directory_loader_document_batches(btec_root, glob_pat, cls):
            seen_paths.add(path_key)
            try:
                n = _ingest_document_list(
                    path_key, btec_root, doc_batch, collection, embeddings, args.dry_run
                )
                if n > 0:
                    ok_sources += 1
                total_chunks += n
            except Exception as e:
                failed += 1
                logger.error("Skipped after error: %s — %s", path_key.name, e)

    # ── TXT: try DirectoryLoader (utf-8); fallback per-file for bad encodings ─
    from langchain_community.document_loaders import TextLoader

    txt_seen: set[Path] = set()
    for txt_glob in ("**/*.txt", "**/*.TXT"):
        for path_key, doc_batch in _directory_loader_document_batches(
            btec_root,
            txt_glob,
            TextLoader,
            loader_kwargs={"encoding": "utf-8"},
        ):
            txt_seen.add(path_key)
            seen_paths.add(path_key)
            try:
                n = _ingest_document_list(
                    path_key, btec_root, doc_batch, collection, embeddings, args.dry_run
                )
                if n > 0:
                    ok_sources += 1
                total_chunks += n
            except Exception as e:
                failed += 1
                logger.error("Skipped after error: %s — %s", path_key.name, e)

    for txt_path in _iter_txt_files(btec_root):
        rp = txt_path.resolve()
        if rp in txt_seen:
            continue
        seen_paths.add(rp)
        try:
            docs = _load_txt_documents(txt_path, btec_root)
            n = _ingest_document_list(
                rp, btec_root, docs, collection, embeddings, args.dry_run
            )
            if n > 0:
                ok_sources += 1
            total_chunks += n
        except Exception as e:
            failed += 1
            logger.error("Skipped TXT after error: %s — %s", txt_path.name, e)

    logger.info(
        "Summary — distinct sources processed: %d | non-empty ingests: %d | failed batches: %d | total chunks: %d",
        len(seen_paths),
        ok_sources,
        failed,
        total_chunks,
    )
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
