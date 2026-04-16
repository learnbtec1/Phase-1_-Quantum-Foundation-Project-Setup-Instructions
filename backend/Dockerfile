# ── Stage 1: dependency build ────────────────────────────────────────────────
# bullseye — stable base for scientific / audio wheels
FROM python:3.10-slim-bullseye AS builder

WORKDIR /install

# Reduce flaky apt mirror timeouts (common on Docker Desktop / slow networks)
RUN printf 'Acquire::Retries "8";\nAcquire::http::Timeout "120";\nAcquire::https::Timeout "120";\n' \
    > /etc/apt/apt.conf.d/99retry

# System libs needed to compile wheels (chromadb, etc.) + libpq headers if needed
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Includes pysqlite3-binary (SQLite >= 3.35 for Chroma) and edge-tts (see requirements.txt)
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir --prefix=/install/pkgs -r requirements.txt


# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM python:3.10-slim-bullseye

WORKDIR /app

RUN printf 'Acquire::Retries "8";\nAcquire::http::Timeout "120";\nAcquire::https::Timeout "120";\n' \
    > /etc/apt/apt.conf.d/99retry

# Only runtime system libs — no compiler, no headers
# libssl1.1 — some wheels link against OpenSSL 1.1 on bullseye
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ffmpeg \
        ca-certificates \
        curl \
        openssl \
        libssl1.1 \
        libasound2 \
        libgomp1 \
    && update-ca-certificates --fresh \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled packages from builder
COPY --from=builder /install/pkgs /usr/local

# Force UTF-8 stdout/stderr — prevents 'charmap' UnicodeEncodeError on Arabic text
# SSL_CERT_FILE/DIR: HTTPS clients (Google APIs, etc.)
ENV PYTHONIOENCODING=utf-8 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_DIR=/etc/ssl/certs \
    OPENSSL_CONF=/etc/ssl/openssl.cnf

# Copy application source
COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]