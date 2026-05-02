/**
 * Canonical STT locales for Cogni: Web Speech vs Whisper backend.
 * Whisper `language` is ISO-639-1; browser SpeechRecognition prefers BCP-47.
 */
export const COGNI_STT_WEBSPEECH_LANG = 'ar-SA';

/** Whisper / OpenAI `language` parameter — Arabic only (disables auto-detect). */
export const COGNI_STT_WHISPER_LANG = 'ar';
