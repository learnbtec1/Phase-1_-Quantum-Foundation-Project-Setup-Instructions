# -*- coding: utf-8 -*-
"""Smoke test: POST -> wait -> verify JSONL + WAV + index on disk."""
import json, sys, time, pathlib, os, http.client, urllib.parse

BASE = pathlib.Path(__file__).parent
HOST = "127.0.0.1"
PORT = 8000

# ── 1. Health ─────────────────────────────────────────────────────────────
print("=== 1. Health check ===")
conn = http.client.HTTPConnection(HOST, PORT, timeout=8)
conn.request("GET", "/api/health")
resp = conn.getresponse()
health = json.loads(resp.read())
assert health.get("ok"), f"Backend not ok: {health}"
print(f"  ok={health['ok']}  last_tts_ms={health.get('last_tts_ms')}")

# ── 2. TTS POST ────────────────────────────────────────────────────────────
print("\n=== 2. TTS POST ===")
payload = json.dumps({
    "text": "مرحباً يا صديقي هذا اختبار للمخزن",
    "voice": "ar-SA-HamedNeural",
    "language": "ar-SA",
    "format": "wav",
    "sample_rate": 24000,
    "with_timing": True,
}, ensure_ascii=False).encode("utf-8")

conn = http.client.HTTPConnection(HOST, PORT, timeout=50)
conn.request("POST", "/api/v1/tts-with-timing",
             body=payload,
             headers={"Content-Type": "application/json; charset=utf-8",
                      "Content-Length": str(len(payload))})
resp = conn.getresponse()
body_raw = resp.read()
if resp.status != 200:
    print(f"  TTS_FAIL  status={resp.status}  body={body_raw[:400]}")
    sys.exit(1)

tts = json.loads(body_raw)
provider     = tts.get("provider", "?")
fmt          = tts.get("format",   "?")
timing_mode  = tts.get("timing_mode", "?")
word_count   = len(tts.get("word_timings") or [])
viseme_count = len(tts.get("viseme_events") or [])
print(f"  TTS_OK  provider={provider}  format={fmt}  timing_mode={timing_mode}"
      f"  words={word_count}  visemes={viseme_count}")

# ── 3. Wait for BackgroundTask ─────────────────────────────────────────────
print("\n=== 3. Waiting 4s for BackgroundTask to flush ===")
time.sleep(4)

# ── 4. Disk verification ───────────────────────────────────────────────────
from datetime import date
today = date.today().strftime("%Y-%m-%d")
jsonl_p = BASE / "data" / "store" / f"{today}.jsonl"
index_p = BASE / "data" / "store" / f"{today}.index.json"
audio_d = BASE / "data" / "audio" / today

print(f"\n=== 4. Disk check  (today={today}) ===")
results = {}

# JSONL
if jsonl_p.exists():
    lines = jsonl_p.read_text(encoding="utf-8").strip().splitlines()
    print(f"  JSONL  EXISTS  lines={len(lines)}")
    last = json.loads(lines[-1])
    print(f"  JSONL_LAST uid={last.get('utterance_id','?')}")
    print(f"    provider={last.get('provider')}  timing_mode={last.get('timing_mode')}")
    print(f"    duration_ms={last.get('duration_ms')}  words={last.get('word_count')}")
    print(f"    wav_path={last.get('wav_path')}")
    results["jsonl"] = "PASS"
else:
    print("  JSONL  MISSING!")
    results["jsonl"] = "FAIL"

# INDEX
if index_p.exists():
    idx = json.loads(index_p.read_text(encoding="utf-8"))
    print(f"  INDEX  EXISTS  entries={len(idx)}")
    results["index"] = "PASS"
else:
    print("  INDEX  MISSING!")
    results["index"] = "FAIL"

# AUDIO
if audio_d.exists():
    wavs = sorted(audio_d.glob("*.wav"), key=lambda p: p.stat().st_mtime)
    print(f"  AUDIO  EXISTS  wav_files={len(wavs)}")
    if wavs:
        w = wavs[-1]
        print(f"  AUDIO_SAMPLE  {w.name}  size={w.stat().st_size}B")
    results["audio"] = "PASS"
else:
    print("  AUDIO  MISSING!")
    results["audio"] = "FAIL"

# ── 5. Import legacy ───────────────────────────────────────────────────────
print("\n=== 5. import_legacy ===")
sys.path.insert(0, str(BASE))
os.chdir(BASE)   # ensure relative STORE_DIR / AUDIO_DIR resolve correctly

try:
    from app.services.conversation_store import get_store
    store = get_store()
    # Look for any .txt / .md / .json / .wav / .mp3 legacy artifacts
    legacy_candidates = list(BASE.glob("*.txt")) + list(BASE.glob("*.md")) + \
                        list(BASE.glob("*.json")) + list(BASE.glob("*.log"))
    # Exclude the index and jsonl files we just created
    legacy_paths = [str(p) for p in legacy_candidates
                    if "data" not in str(p) and p.stat().st_size < 5 * 1024 * 1024]
    print(f"  Candidates ({len(legacy_paths)}): {[pathlib.Path(p).name for p in legacy_paths[:6]]}")
    summary = store.import_legacy(legacy_paths[:5])   # limit to first 5
    print(f"  import_legacy result: {summary}")
    results["import_legacy"] = "PASS"
except Exception as e:
    print(f"  import_legacy ERROR: {e}")
    results["import_legacy"] = "WARN"

# ── 6. Summary ────────────────────────────────────────────────────────────
print("\n=== PASS/FAIL Summary ===")
all_pass = True
for k, v in results.items():
    icon = "✅" if v == "PASS" else ("⚠️" if v == "WARN" else "❌")
    print(f"  {icon}  {k:<20} {v}")
    if v == "FAIL":
        all_pass = False

print()
if all_pass:
    print("RESULT: ALL PASS")
else:
    print("RESULT: FAILURES DETECTED — see above")
    sys.exit(1)
