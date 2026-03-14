/**
 * selectFemaleArabicVoice — picks the best female Arabic voice from Web Speech API.
 * Falls back to any Arabic voice if no female-specific voice is available.
 */
export function selectFemaleArabicVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const byName = voices.find(v =>
    (v.lang?.toLowerCase().startsWith('ar')) &&
    /zariyah|salma|female|unna|asma|layla|leila|sahar|aisha|amina|noura|noora/i.test(v.name)
  );
  const byLang = voices.find(v => v.lang?.toLowerCase().startsWith('ar'));
  return byName ?? byLang ?? null;
}
