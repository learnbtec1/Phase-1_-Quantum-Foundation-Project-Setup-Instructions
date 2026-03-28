from app.sqlite_chroma_compat import ensure_modern_sqlite3_for_chroma

ensure_modern_sqlite3_for_chroma()

from fastapi import FastAPI

app = FastAPI()

# This file is intentionally left blank.