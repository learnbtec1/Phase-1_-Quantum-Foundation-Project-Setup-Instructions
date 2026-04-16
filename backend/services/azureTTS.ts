/**
 * Azure Speech neural TTS (Node.js) — mirrors Python `app/services/tts_service.py`.
 *
 * Production API uses FastAPI + `azure-cognitiveservices-speech` (Python). This module is for
 * tooling, smoke tests, or a future Node sidecar. Install from `backend/`:
 *   npm install microsoft-cognitiveservices-speech-sdk
 *
 * Env: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
 */
// @ts-nocheck — optional tooling; types resolved when SDK is installed in backend/
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

export type AzureVisemeCue = { audioOffsetMs: number; id: number };

export type AzureTtsResult = {
  audioBuffer: Buffer;
  visemes: AzureVisemeCue[];
  format: 'mp3';
};

export type SynthesizeAzureTtsOptions = {
  text: string;
  /** e.g. en-US-JennyNeural, ar-JO-TaimNeural */
  voiceName?: string;
  region?: string;
  key?: string;
};

function defaultSsml(text: string, voiceName: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  return (
    `<speak version="1.0" xml:lang="en-US">` +
    `<voice name="${voiceName}">` +
    `<prosody rate="1.0" pitch="0%">${esc}</prosody>` +
    `</voice></speak>`
  );
}

export async function synthesizeAzureTts(opts: SynthesizeAzureTtsOptions): Promise<AzureTtsResult> {
  const key = opts.key ?? process.env.AZURE_SPEECH_KEY ?? '';
  const region = opts.region ?? process.env.AZURE_SPEECH_REGION ?? '';
  if (!key || !region) {
    throw new Error('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are required');
  }

  const voiceName = opts.voiceName ?? process.env.AZURE_TTS_VOICE ?? 'en-US-JennyNeural';
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechSynthesisVoiceName = voiceName;
  speechConfig.setSpeechSynthesisOutputFormat(
    sdk.SpeechSynthesisOutputFormat.Audio48Khz192KBitRateMonoMp3,
  );

  const visemes: AzureVisemeCue[] = [];
  const synthesizer = new sdk.SpeechSynthesizer(speechConfig);

  synthesizer.visemeReceived = (_s: unknown, e: { audioOffset: number; visemeId: number }) => {
    const audioOffsetMs = e.audioOffset / 10000;
    visemes.push({ audioOffsetMs, id: e.visemeId });
  };

  try {
    const ssml = defaultSsml(opts.text.trim(), voiceName);
    const result = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
      synthesizer.speakSsmlAsync(
        ssml,
        (r: sdk.SpeechSynthesisResult) => resolve(r),
        (err: string) => reject(new Error(err)),
      );
    });

    if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
      const cancel = sdk.SpeechSynthesisCancellationDetails.fromResult(result);
      throw new Error(`Azure TTS canceled: ${cancel.errorDetails}`);
    }

    const audioBuffer = Buffer.from(result.audioData as ArrayLike<number>);
    return { audioBuffer, visemes, format: 'mp3' };
  } finally {
    try {
      synthesizer.close();
    } catch {
      /* */
    }
  }
}
