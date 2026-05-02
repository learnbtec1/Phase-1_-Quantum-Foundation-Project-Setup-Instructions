import { detectAssignmentIntent } from '@/lib/ai/detectAssignmentIntent';
import { fetchMarketingPlanCriteria } from '@/lib/ai/ragClient';
import { speakWithTTS } from '@/ai/io/tts';

function buildExplanation(results: string[]): string {
  const lines =
    results.length > 0
      ? results
      : [
          'Executive Summary',
          'Market Analysis',
          'Target Audience',
          'Marketing Strategy',
          'Budget Planning',
        ];
  const body = lines.map((n, i) => `${i + 1}. ${n}`).join('\n');
  return `تمام 👌 خليني أشرح لك معايير واجب خطة التسويق:\n\n${body}`;
}

/** Returns true when RAG + TTS handled the turn (skip normal WS chat). */
export async function handleUserMessage(message: string): Promise<boolean> {
  if (!detectAssignmentIntent(message)) return false;

  try {
    const data = await fetchMarketingPlanCriteria();
    const explanation = buildExplanation(data.results ?? []);
    const audio = await speakWithTTS(explanation, { emotion: 'explaining', emotionIntensity: 0.7 });
    if (!audio) return false;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('avatar:intent', {
          detail: { intent: 'explaining', emotion: 'neutral', urgency: 0.6 },
        }),
      );
    }
    return true;
  } catch (e: unknown) {
    console.error('[handleUserMessage] RAG explanation / TTS failed:', e);
    return false;
  }
}
