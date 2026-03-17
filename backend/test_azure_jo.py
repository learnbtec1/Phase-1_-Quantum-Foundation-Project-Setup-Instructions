# -*- coding: utf-8 -*-
"""Quick Azure TTS test — Jordanian dialect (ar-JO)"""
import os, sys

# Never commit real keys — set in your environment (see Azure Portal → Speech resource).
KEY = os.environ.get("AZURE_SPEECH_KEY") or os.environ.get("SPEECH_KEY")
REGION = os.environ.get("AZURE_SPEECH_REGION") or os.environ.get("SPEECH_REGION") or "eastus"

VOICES = [
    ("ar-JO-OmarNeural",  "ذكر أردني",   "test_jo_male.wav"),
    ("ar-JO-MaysoonNeural",  "أنثى أردنية", "test_jo_female.wav"),
]

TEXT = "السلام عليكم! أنا دكتور حمزة، معلم BTEC. شو بدك تتعلم اليوم؟"

try:
    import azure.cognitiveservices.speech as speechsdk
except ImportError:
    print("ERROR: azure-cognitiveservices-speech not installed")
    sys.exit(1)

if not KEY:
    print("ERROR: Set AZURE_SPEECH_KEY (or SPEECH_KEY) in the environment before running this test.")
    sys.exit(1)

for voice, label, outfile in VOICES:
    cfg = speechsdk.SpeechConfig(subscription=KEY, region=REGION)
    cfg.speech_synthesis_voice_name = voice
    cfg.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
    )
    audio_cfg = speechsdk.audio.AudioOutputConfig(filename=outfile)
    synth = speechsdk.SpeechSynthesizer(speech_config=cfg, audio_config=audio_cfg)

    result = synth.speak_text_async(TEXT).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        size = os.path.getsize(outfile)
        print(f"OK  [{label}]  voice={voice}  size={size:,} bytes  => {outfile}")
    elif result.reason == speechsdk.ResultReason.Canceled:
        d = result.cancellation_details
        print(f"ERR [{label}]  voice={voice}  reason={d.reason}  detail={d.error_details}")

print("Done.")
