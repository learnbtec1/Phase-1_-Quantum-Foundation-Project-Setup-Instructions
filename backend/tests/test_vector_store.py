# -*- coding: utf-8 -*-
"""Tests for ChromaBtecVectorStore (metadata filters + semantic fallback)."""
from __future__ import annotations

import pytest

def _const_embed(_: str) -> list[float]:
    """Same vector for every query so ranking is stable across chunks (text-embedding-3-small dim)."""
    return [0.02] * 1536


@pytest.fixture()
def chroma_btec_store(tmp_path):
    import chromadb

    from app.services.vector_store.chroma_store import ChromaBtecVectorStore

    path = str(tmp_path)
    name = "test_btec_kb"
    client = chromadb.PersistentClient(path=path)
    client.create_collection(name=name)
    store = ChromaBtecVectorStore(
        persist_dir=path,
        collection_name=name,
        embedding_fn=_const_embed,
    )
    return store


def test_chroma_add_and_similarity_filter_p1(chroma_btec_store):
    store = chroma_btec_store
    emb = _const_embed("")
    store.add_documents(
        [
            {"content": "Criterion P1 pass level explain marketing", "embedding": emb},
            {"content": "Merit M2 unrelated content", "embedding": emb},
        ],
        [
            {"criterion_code": "P1", "source_file": "u.pdf"},
            {"criterion_code": "M2", "source_file": "u.pdf"},
        ],
        ids=["c1", "c2"],
    )

    hits = store.similarity_search(
        "what is P1",
        k=5,
        filters={"criterion_code": "P1"},
        n_results=5,
    )
    assert len(hits) >= 1
    for h in hits:
        assert h["metadata"].get("criterion_code") == "P1"


def test_chroma_filtered_zero_falls_back_semantic(chroma_btec_store):
    store = chroma_btec_store
    emb = _const_embed("")
    store.add_documents(
        [{"content": "only generic BTEC text with no criterion tag", "embedding": emb}],
        [{"criterion_code": "M2", "source_file": "x.pdf"}],
        ids=["only1"],
    )

    hits = store.similarity_search(
        "BTEC business",
        k=3,
        filters={"criterion_code": "P1"},
        n_results=3,
    )
    assert len(hits) == 1
    assert "BTEC" in (hits[0].get("document") or "")


def test_metadata_filter_to_chroma_where_and():
    from app.services.vector_store.base import metadata_filter_to_chroma_where

    w = metadata_filter_to_chroma_where({"unit_id": "unit_4", "criterion_code": "P1"})
    assert w is not None
    assert "$and" in w
    assert len(w["$and"]) == 2
