#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Smoke test for Lahajati.ai Jordanian Arabic TTS.

Run from the backend/ directory:
    python test_tts.py

Requires:
    - httpx  (already in requirements.txt)
    - LAHAJATI_API_KEY env var  OR  the demo key embedded in lahajati_tts.py

Saves output to: test_voice_output.mp3
"""
import asyncio
import pathlib
import sys

# Allow running directly from backend/ without installing the package
sys.path.insert(0, str(pathlib.Path(__file__).parent))


async def main() -> None:
    from app.services.lahajati_tts import synthesize  # noqa: PLC0415

    text = (
        "مرحباً بك في منصة إديوفيرس، "
        "أنا الدكتور حمزة، "
        "سأكون مرشدك في هذه الرحلة التعليمية."
    )

    print(f"[TTS Test] Synthesizing {len(text)} chars …")
    mp3 = await synthesize(text)

    if mp3:
        out = pathlib.Path("test_voice_output.mp3")
        out.write_bytes(mp3)
        print(f"[TTS Test] ✅ SUCCESS — {len(mp3):,} bytes saved to {out.resolve()}")
    else:
        print(
            "[TTS Test] ❌ FAILED — synthesize() returned None\n"
            "           Check LAHAJATI_API_KEY env var and network connectivity."
        )
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

