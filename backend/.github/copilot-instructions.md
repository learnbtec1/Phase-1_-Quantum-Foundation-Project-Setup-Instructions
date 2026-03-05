# Copilot Instructions: BTEC Platform 2026 Backend

## Architecture Overview

This is a **dual-stack backend** (Python + Node.js) serving the BTEC Smart Tutoring platform:

- **Python FastAPI** (`app/main.py`) - Primary API engine with AI-powered auto-grading and forensic evaluation
- **Node.js Express** (`src/index.js`) - Assessment result storage and reporting service
- **Hybrid approach**: Python handles complex evaluation logic; Node.js manages simple result persistence

### Key Data Flow
1. Student submissions → FastAPI `/api/evaluate` endpoint
2. GPT-4o forensic grading service processes assignment/student text
3. Criteria evaluation with quote verification (rapideuzz similarity matching)
4. BTEC Staircase Rule enforced (PASS required before MERIT/DISTINCTION)
5. Results optionally persisted via Node.js assessment endpoint

## Critical Project Patterns

### 1. **Pydantic Schema-Driven Design**
All API requests/responses use Pydantic models (`app/models/schemas.py`):
```python
class EvaluationRequest(BaseModel):
    assignmentText: str
    studentText: str
```
- **Pattern**: Always validate input via Pydantic BaseModel before processing
- **Files**: `app/models/schemas.py` defines all contracts
- **When adding endpoints**: Create corresponding schema first, use in route

### 2. **CORS & Security Middleware**
- CORS enabled for all origins (`allow_origins=["*"]`) - **currently permissive for development**
- Helmet-style security recommended for production
- **Action**: Restrict `BACKEND_CORS_ORIGINS` in `app/core/config.py` before deployment

### 3. **OpenAI Integration Pattern**
Forensic grader uses GPT-4o for intelligent evaluation:
```python
# In forensic_grader.py
response = await openai.ChatCompletion.acreate(model="gpt-4o", messages=[...])
```
- **Environment**: Requires `OPENAI_API_KEY` in `.env` (loaded via `dotenv`)
- **Verification**: `verify_quote()` uses rapideuzz fuzzy matching (≥75% threshold) to prevent hallucinations
- **Add features**: Extend prompt engineering in the message content, keep quote verification logic

### 4. **BTEC Staircase Grading Rule**
Implemented in `forensic_grader.py`:
- If any PASS criterion fails → all MERIT/DISTINCTION criteria auto-fail
- **Pattern**: Applied after AI evaluation, enforces pedagogical constraints
- **Modify grading logic** in `evaluate_submission()` function

## Development Workflows

### Local Setup
```bash
# Python backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Node.js backend (separate terminal)
npm install
npm run dev
```

### API Documentation
- FastAPI auto-generates Swagger UI at `http://localhost:8000/docs`
- Use this for manual testing during development

### File Storage
Student progress persists to `backend/data/{student_name}.json` (file-based, not database)

## Code Organization

| Path | Purpose |
|------|---------|
| `app/main.py` | FastAPI app initialization, CORS, main `/api/evaluate` route |
| `app/services/forensic_grader.py` | Core evaluation logic, GPT-4o integration, quote verification |
| `app/models/schemas.py` | Pydantic validation schemas for requests/responses |
| `app/api/v1/endpoints/` | API route groups (assessment, tutor) - currently scaffolded |
| `app/core/config.py` | Configuration management (CORS origins, API version) |
| `src/index.js` | Node.js Express server for assessment result persistence |

## Integration Points

### Python ↔ Node.js Communication
- Currently independent services (no direct calls)
- Potential: Python evaluates → Node.js stores results via HTTP POST to `/api/save-assessment`

### External Dependencies
- **OpenAI API**: Requires valid key, async integration via `openai.ChatCompletion.acreate()`
- **rapideuzz**: Fuzzy string matching for quote verification (prevent AI hallucinations)
- **FastAPI/Uvicorn**: Async framework, use `async def` for endpoints
- **Pydantic v2**: Type validation on request bodies

## When Adding Features

1. **New evaluation criteria?** → Update prompt in `forensic_grader.py`, extend `CriterionResult` schema
2. **New API endpoint?** → Add route in `app/main.py` or `app/api/v1/endpoints/`, define Pydantic schema first
3. **Store student data?** → File goes to `backend/data/`, or use Node.js `/api/save-assessment` endpoint
4. **Add authentication?** → Modify CORS origins in `config.py`, consider JWT middleware
5. **Improve grading?** → Adjust fuzzy matching threshold in `verify_quote()` or BTEC rule logic

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| `OPENAI_API_KEY` not found | Add to `.env` file in project root, ensure `load_dotenv()` runs before API calls |
| Quote verification failing | Check rapideuzz similarity threshold (currently 75%), increase if false negatives |
| CORS errors from frontend | Ensure `BACKEND_CORS_ORIGINS` includes frontend URL in `config.py` |
| Node.js port conflicts | Change `PORT` in `src/index.js` or set `PORT` environment variable |

## Deployment Notes

- **Python**: Use `--workers 4` in production, not `--reload`
- **Dockerfiles**: Node.js Dockerfile exists; create Python equivalent before deployment
- **Environment variables**: Both `.env` (Python) and `process.env` (Node.js) patterns used
