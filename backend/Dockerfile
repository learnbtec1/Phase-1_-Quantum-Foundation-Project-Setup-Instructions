# ── Stage 1: dependency build ────────────────────────────────────────────────
# bullseye = Debian 11 مع OpenSSL 1.1.x — مطلوب لدعم Azure Speech SDK
FROM python:3.10-slim-bullseye AS builder

WORKDIR /install

# تثبيت الأدوات اللازمة لبناء المكتبات (psycopg2، audio libs، و pysqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        gcc \
        python3-dev \
    && rm -rf /var/lib/apt/lists/*

# إضافة pysqlite3-binary لضمان وجود نسخة SQLite حديثة لـ ChromaDB
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install/pkgs -r requirements.txt


# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM python:3.10-slim-bullseye

WORKDIR /app

# تثبيت مكتبات التشغيل فقط لتقليل حجم الصورة
# libssl1.1 ضروري لـ Azure SDK، و ffmpeg ضروري لمعالجة صوت Habibi-TTS
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        ffmpeg \
        ca-certificates \
        openssl \
        libssl1.1 \
        libasound2 \
        libgomp1 \
        sqlite3 \
    && update-ca-certificates --fresh \
    && rm -rf /var/lib/apt/lists/*

# نسخ الحزم المثبتة من مرحلة البناء
COPY --from=builder /install/pkgs /usr/local

# Chroma: يستخدم app/sqlite_chroma_compat.py لربط pysqlite3 كـ sqlite3 (LD_PRELOAD كان مساراً خاطئاً)

# إعدادات اللغة والتشفير لضمان عدم حدوث UnicodeEncodeError مع النصوص العربية
# SSL_CERT_DIR: ضروري لـ Azure SDK للتحقق من الشهادات (Fix Error 27)
ENV PYTHONIOENCODING=utf-8 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_DIR=/etc/ssl/certs \
    OPENSSL_CONF=/etc/ssl/openssl.cnf \
    PYTHONUTF8=1

# نسخ سورس الكود بالكامل
COPY . .

# التأكد من وجود مجلدات البيانات والصوت وصلاحياتها
RUN mkdir -p /app/data/audio /app/data/store /app/btec_corpus

EXPOSE 8000

# تشغيل السيرفر باستخدام Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]