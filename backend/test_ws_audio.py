Start-Process 'E:\Phase 1_ Quantum Foundation Project Setup Instructions\backend\test_jo_male.wav'# -*- coding: utf-8 -*-
"""Test WS agent endpoint — verify audio_base64 is included in speech frames."""
import asyncio
import json
import sys

async def test():
    try:
        import websockets
    except ImportError:
        print("ERROR: websockets not installed. Run: pip install websockets")
        return

    uri = "ws://127.0.0.1:8000/ws/agent"
    print(f"Connecting to {uri} ...")
    try:
        async with websockets.connect(uri, ping_timeout=30, open_timeout=10) as ws:
            print("Connected!")
            # Wait a moment for the welcome greeting first
            for _ in range(15):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=8)
                    data = json.loads(msg)
                    t = data.get("type", "?")
                    has_audio = bool(data.get("audio_base64", ""))
                    audio_len = len(data.get("audio_base64", ""))
                    visemes = len(data.get("viseme_cues", []))
                    words = len(data.get("word_cues", []))
                    print(f"FRAME type={t} has_audio={has_audio} audio_len={audio_len} visemes={visemes} words={words}")
                    if t in ("speech", "tts_unavailable"):
                        dial = str(data.get("dialogue", ""))[:80]
                        fmt = data.get("audio_format", "?")
                        print(f"  dialogue={dial}")
                        print(f"  audio_format={fmt}")
                        if has_audio:
                            print(f"  RESULT: ✅ AUDIO PRESENT — {audio_len} chars of base64")
                        else:
                            print(f"  RESULT: ❌ NO AUDIO — type was {t}")
                        break
                    elif t == "error":
                        print(f"  ERROR: {data.get('error', data)}")
                        break
                except asyncio.TimeoutError:
                    print("TIMEOUT waiting for frame")
                    break

            # Now test with a text message
            print("\n--- Sending text message ---")
            await ws.send(json.dumps({"type": "text", "text": "مرحبا"}))
            print("Sent text: مرحبا")

            for _ in range(20):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=12)
                    data = json.loads(msg)
                    t = data.get("type", "?")
                    has_audio = bool(data.get("audio_base64", ""))
                    audio_len = len(data.get("audio_base64", ""))
                    visemes = len(data.get("viseme_cues", []))
                    words = len(data.get("word_cues", []))
                    print(f"FRAME type={t} has_audio={has_audio} audio_len={audio_len} visemes={visemes} words={words}")
                    if t in ("speech", "tts_unavailable"):
                        dial = str(data.get("dialogue", ""))[:80]
                        fmt = data.get("audio_format", "?")
                        print(f"  dialogue={dial}")
                        print(f"  audio_format={fmt}")
                        if has_audio:
                            print(f"  RESULT: ✅ AUDIO PRESENT — {audio_len} chars of base64")
                        else:
                            print(f"  RESULT: ❌ NO AUDIO — type was {t}")
                        break
                    elif t == "error":
                        print(f"  ERROR: {data.get('error', data)}")
                        break
                except asyncio.TimeoutError:
                    print("TIMEOUT waiting for text-response frame")
                    break
    except Exception as e:
        print(f"CONNECTION ERROR: {e}")

asyncio.run(test())
