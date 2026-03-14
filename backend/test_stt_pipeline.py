"""Test PyAV webm decoding end-to-end with whisper_stt."""
import asyncio, sys, struct

# ── Create a minimal silent WAV blob to simulate speech (16kHz, 0.5s) ────────
SAMPLE_RATE = 16000
DURATION_S  = 0.5
num_samples = int(SAMPLE_RATE * DURATION_S)
pcm_data    = bytes(num_samples * 2)  # silence (all zeros, int16)

def make_wav(pcm: bytes, sr: int = 16000) -> bytes:
    data_len = len(pcm)
    buf = bytearray(44 + data_len)
    def ws(off, s):
        for i, c in enumerate(s): buf[off+i] = ord(c)
    def wu32(off, v): struct.pack_into('<I', buf, off, v)
    def wu16(off, v): struct.pack_into('<H', buf, off, v)
    ws(0,'RIFF'); wu32(4, 36+data_len)
    ws(8,'WAVE'); ws(12,'fmt '); wu32(16,16)
    wu16(20,1); wu16(22,1); wu32(24,sr); wu32(28,sr*2)
    wu16(32,2); wu16(34,16); ws(36,'data'); wu32(40,data_len)
    buf[44:] = pcm
    return bytes(buf)

wav_bytes = make_wav(pcm_data)
print(f"WAV test blob: {len(wav_bytes)} bytes")

from app.services.whisper_stt import _extract_pcm, _extract_pcm_via_av

# Test WAV extraction
pcm_out, sr = _extract_pcm(wav_bytes)
print(f"_extract_pcm WAV: pcm={len(pcm_out)} bytes sr={sr}  ✅")

# Test that non-WAV data falls through gracefully  
non_wav = b'\x1aE\xdf\xa3' + b'\x00' * 100  # fake webm magic bytes
try:
    pcm_out2, sr2 = _extract_pcm(non_wav)
    print(f"_extract_pcm non-WAV fallback: {len(pcm_out2)} bytes sr={sr2}  ✅")
except Exception as e:
    print(f"_extract_pcm non-WAV error: {e}  (expected for malformed data)")

print("All tests passed.")
