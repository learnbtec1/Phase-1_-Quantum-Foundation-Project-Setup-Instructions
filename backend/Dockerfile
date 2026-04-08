# ── Stage 1: dependency build ────────────────────────────────────────────────
# bullseye = Debian 11 with OpenSSL 1.1.x — required by Azure Speech SDK 1.38
# (Debian 12/13 ships OpenSSL 3.x which triggers Error 27 in the SDK's HTTP singleton)
FROM python:3.10-slim-bullseye AS builder

WORKDIR /install

# System libs needed to compile psycopg2 + audio libs
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Includes pysqlite3-binary (SQLite >= 3.35 for Chroma) and edge-tts>=7.x
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir --prefix=/install/pkgs -r requirements.txt


# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM python:3.10-slim-bullseye

WORKDIR /app

# Only runtime system libs — no compiler, no headers
# libssl1.1 provides OpenSSL 1.1.x needed by Azure Speech SDK on Debian 11
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ffmpeg \
        ca-certificates \
        openssl \
        libssl1.1 \
        libasound2 \
        libgomp1 \
    && update-ca-certificates --fresh \
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
    SSL_CERT_DIR=/etc/ssl/certs \
    OPENSSL_CONF=/etc/ssl/openssl.cnf

# Copy application source
COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]