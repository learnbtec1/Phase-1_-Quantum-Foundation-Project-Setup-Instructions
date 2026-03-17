# ── Stage 1: dependency build ────────────────────────────────────────────────
# Heavy build tools stay in this stage; only the installed packages are copied.
FROM python:3.10-slim AS builder

WORKDIR /install

# System libs needed to compile psycopg2 + audio libs
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install/pkgs -r requirements.txt


# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM python:3.10-slim

WORKDIR /app

# Only runtime system libs — no compiler, no headers
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ffmpeg \
        ca-certificates \
        openssl \
        libasound2 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled packages from builder
COPY --from=builder /install/pkgs /usr/local

# Force UTF-8 stdout/stderr — prevents 'charmap' UnicodeEncodeError on Arabic text
# SSL_CERT_FILE/DIR: required so Azure Speech SDK (libMicrosoft.CognitiveServices.Speech.core.so)
# can locate CA certificates when initialising its HTTP singleton (fixes Error 27).
ENV PYTHONIOENCODING=utf-8 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_DIR=/etc/ssl/certs

# Copy application source
COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]