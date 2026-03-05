#!/usr/bin/env python3
"""Minimal BTEC Backend Server"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="BTEC Forensic Engine (GPT-4o)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "status": "Online", 
        "engine": "GPT-4o Forensic Mode",
        "version": "2.0 Pro"
    }

@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "service": "BTEC Backend",
        "port": 8000
    }

@app.post("/api/evaluate")
async def evaluate(assignment_text: str, student_text: str):
    return {
        "status": "ready",
        "message": "Evaluation endpoint ready. Configure OpenAI API key to enable full functionality."
    }

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("🚀 BTEC Backend Server Starting...")
    print("=" * 60)
    print("📍 API running on: http://127.0.0.1:8000")
    print("📚 API docs: http://127.0.0.1:8000/docs")
    print("=" * 60)
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True, log_level="debug")
