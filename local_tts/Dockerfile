# Piper: official release binary + bundled ONNX/espeak libs (not PyPI `piper-tts`).
# Arabic: ar_JO kareem medium → paths must match main.py (PIPER_MODEL_PATH=/app/models/model.onnx).
FROM python:3.10-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Piper v1.2.0+ assets are piper_amd64.tar.gz / piper_arm64.tar.gz (not piper_linux_x86_64).
ARG PIPER_VERSION=1.2.0
ARG PIPER_ARCH=amd64
RUN wget -qO /tmp/piper.tgz "https://github.com/rhasspy/piper/releases/download/v${PIPER_VERSION}/piper_${PIPER_ARCH}.tar.gz" \
    && tar -xzf /tmp/piper.tgz -C /tmp \
    && for f in /tmp/piper/libonnxruntime.so* /tmp/piper/libpiper_phonemize.so* /tmp/piper/libespeak-ng.so*; do \
         if [ -e "$f" ]; then cp -av "$f" /usr/local/lib/; fi; \
       done \
    && ldconfig \
    && rm -rf /usr/share/espeak-ng-data \
    && cp -a /tmp/piper/espeak-ng-data /usr/share/espeak-ng-data \
    && mkdir -p /usr/local/share/piper \
    && if [ -f /tmp/piper/libtashkeel_model.ort ]; then cp -av /tmp/piper/libtashkeel_model.ort /usr/local/share/piper/; fi \
    && mv /tmp/piper/piper /usr/local/bin/piper \
    && chmod +x /usr/local/bin/piper \
    && rm -rf /tmp/piper.tgz /tmp/piper

ENV PIPER_BIN=/usr/local/bin/piper

RUN mkdir -p /app/models \
    && wget -qO /app/models/model.onnx \
        "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx" \
    && wget -qO /app/models/model.onnx.json \
        "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV PIPER_MODEL_PATH=/app/models/model.onnx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
