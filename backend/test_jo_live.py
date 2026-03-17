# -*- coding: utf-8 -*-
"""Live end-to-end test: Jordanian voice via /api/v1/tts-with-timing"""
import json, base64, urllib.request, urllib.error

URL = "http://127.0.0.1:8000/api/v1/tts-with-timing"
PAYLOAD = {
    "text": "أهلاً وسهلاً! أنا دكتور حمزة، معلّم BTEC بلهجة أردنية. كيف أقدر أساعدك اليوم؟",
    "voice": "ar-JO-OmarNeural",
    "language": "ar-JO",
    "emotion": "friendly",
    "with_timing": True,
    "format": "wav",
}

body = json.dumps(PAYLOAD, ensure_ascii=False).encode("utf-8")
req = urllib.request.Request(
    URL,
    data=body,
    headers={"Content-Type": "application/json; charset=utf-8"},
    method="POST",
)

print("POST", URL)
print("Voice :", PAYLOAD["voice"])
print("Emotion:", PAYLOAD["emotion"])
print()

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()}")
    raise SystemExit(1)

provider    = data.get("provider", "?")
timing_mode = data.get("timing_mode", "?")
words       = data.get("word_timings", [])
visemes     = data.get("viseme_events", [])
wav_b64     = data.get("audio_wav_base64")
mp3_b64     = data.get("audio_mp3_base64")

print(f"  provider   : {provider}")
print(f"  timing_mode: {timing_mode}")
print(f"  words      : {len(words)}")
print(f"  visemes    : {len(visemes)}")

if wav_b64:
    wav_bytes = base64.b64decode(wav_b64)
    with open("test_jo_live.wav", "wb") as f:
        f.write(wav_bytes)
    print(f"  WAV size   : {len(wav_bytes):,} bytes => test_jo_live.wav")
elif mp3_b64:
    mp3_bytes = base64.b64decode(mp3_b64)
    with open("test_jo_live.mp3", "wb") as f:
        f.write(mp3_bytes)
    print(f"  MP3 size   : {len(mp3_bytes):,} bytes => test_jo_live.mp3")
else:
    print("  WARNING: no audio in response!")

# Show first 3 word timings
if words:
    print("\n  Word timings (first 3):")
    for w in words[:3]:
        print(f"    {w.get('word','?'):15s}  {w.get('start_time',0):.0f}ms – {w.get('end_time',0):.0f}ms")

# Also test female voice
print()
print("--- Testing ar-JO-MaysoonNeural (female) ---")
PAYLOAD2 = dict(PAYLOAD, voice="ar-JO-MaysoonNeural", emotion="neutral",
                text="مرحباً طلابي الأعزاء. اليوم سنتعلم معاً كيف نكتب تقريراً احترافياً باللغة الإنجليزية.")
body2 = json.dumps(PAYLOAD2, ensure_ascii=False).encode("utf-8")
req2 = urllib.request.Request(URL, data=body2,
    headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
try:
    with urllib.request.urlopen(req2, timeout=30) as resp2:
        data2 = json.loads(resp2.read().decode("utf-8"))
    wav2 = data2.get("audio_wav_base64") or data2.get("audio_mp3_base64")
    ext2 = "wav" if data2.get("audio_wav_base64") else "mp3"
    if wav2:
        raw2 = base64.b64decode(wav2)
        with open(f"test_jo_female.{ext2}", "wb") as f:
            f.write(raw2)
        print(f"  ar-JO-MaysoonNeural: {len(raw2):,} bytes | provider={data2.get('provider')} | words={len(data2.get('word_timings',[]))}")
except Exception as e:
    print(f"  Female voice error: {e}")

print()
print("✅ Jordanian voice pipeline OK")
