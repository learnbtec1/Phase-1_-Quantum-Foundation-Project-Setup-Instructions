import azure.cognitiveservices.speech as s
from app.core.config import settings
cfg = s.SpeechConfig(subscription=settings.AZURE_SPEECH_KEY, region=settings.AZURE_SPEECH_REGION)
synth = s.SpeechSynthesizer(speech_config=cfg, audio_config=None)
for voice in ['ar-JO-TaimNeural', 'ar-JO-SanaNeural', 'ar-SA-HamedNeural', 'ar-SA-ZariyahNeural']:
    ssml = f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar"><voice name="{voice}">مرحبا</voice></speak>'
    result = synth.speak_ssml_async(ssml).get()
    print(f'{voice}: {result.reason} | {len(result.audio_data)} bytes')
