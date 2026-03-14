"""Verify all edited modules import cleanly."""
from app.services.whisper_stt import _extract_pcm, _extract_pcm_via_av, transcribe_audio, is_available
print('whisper_stt imports OK')
from app.api.v1.endpoints.agent_ws import router
print('agent_ws imports OK')
print('ALL OK')
