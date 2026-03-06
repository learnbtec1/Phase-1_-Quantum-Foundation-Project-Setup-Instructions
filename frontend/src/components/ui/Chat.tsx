# ===== Anthropic Claude API =====
# تنبيه: لتشغيل Sonnet 4.6 بنجاح لاحقاً، يجب استبدال هذا المفتاح بمفتاح يبدأ بـ sk-ant-
ANTHROPIC_API_KEY=REDACTED_OPENAI_KEY_1

# ===== OpenAI API =====
OPENAI_API_KEY=REDACTED_OPENAI_KEY_1

# ===== Pinecone =====
PINECONE_API_KEY=REDACTED_PINECONE_KEY
PINECONE_ENVIRONMENT=aws
PINECONE_INDEX_NAME=learnmore
PINECONE_REGION=us-east-1
PINECONE_HOST=https://learnmore-e21zcyk.svc.aped-4627-b74a.pinecone.io

# ===== Google Custom Search =====
GOOGLE_API_KEY=REDACTED_GOOGLE_KEY
GOOGLE_CX_ID=33e393ae1981747b1

# ===== Grading Engine Configuration (Anthropic Claude 4.6 Sonnet) =====
GRADER_MODEL=claude-4-6-sonnet-latest
GRADER_MAX_TOKENS=3000
GRADER_HARD_DEADLINE_SEC=120
GRADER_REQUEST_TIMEOUT=60
GRADER_MAX_CONCURRENT=2
GRADER_DELAY_SEC=1.5
GRADER_CACHE_TTL=86400
GRADER_SELF_CONSISTENCY=1
GRADER_PROMPT_VERSION=2026.03.02-Ultimate-Single-File
GRADER_TOPIC_THRESHOLD=0.35

# ===== Server Configuration =====
API_V1_STR=/api/v1
BACKEND_CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]
DATABASE_URL=sqlite:///./test.db
PORT=8000
HOST=127.0.0.1
ENVIRONMENT=development
DEBUG=true

# ===== Plagiarism Detection =====
PLAGIARISM_MIN_LEN=80
PLAGIARISM_STRICT=false