'use client';

/**
 * يحمّل Azure Speech SDK من `public/vendor/microsoft-speech-sdk.bundle.min.js`
 * (نسخة المتصفح الرسمية). يعرّف `window.SpeechSDK` ولا يمرّ عبر Turbopack/Webpack
 * لحلّ حزمة `microsoft-cognitiveservices-speech-sdk` — يتجنّب أخطاء Module not found.
 *
 * عند ترقية الحزمة: انسخ من
 * `node_modules/microsoft-cognitiveservices-speech-sdk/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js`
 * إلى `public/vendor/microsoft-speech-sdk.bundle.min.js`.
 */

export type MicrosoftSpeechSdkModule = typeof import('microsoft-cognitiveservices-speech-sdk');

const SCRIPT_SRC = '/vendor/microsoft-speech-sdk.bundle.min.js';
const SCRIPT_ATTR = 'data-ms-speech-sdk';

let loadPromise: Promise<MicrosoftSpeechSdkModule> | null = null;

function getGlobalSdk(): MicrosoftSpeechSdkModule | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { SpeechSDK?: MicrosoftSpeechSdkModule }).SpeechSDK;
}

export async function ensureMicrosoftSpeechSdk(): Promise<MicrosoftSpeechSdkModule> {
  if (typeof window === 'undefined') {
    throw new Error('Azure Speech SDK is available in the browser only');
  }

  const existing = getGlobalSdk();
  if (existing) return existing;

  if (!loadPromise) {
    loadPromise = new Promise<MicrosoftSpeechSdkModule>((resolve, reject) => {
      const finish = () => {
        const sdk = getGlobalSdk();
        if (sdk) resolve(sdk);
        else reject(new Error('SpeechSDK global missing after script load'));
      };

      const prev = document.querySelector(`script[${SCRIPT_ATTR}="1"]`);
      if (prev && typeof (prev as HTMLScriptElement).addEventListener === 'function') {
        if (getGlobalSdk()) {
          finish();
          return;
        }
        prev.addEventListener('load', finish);
        prev.addEventListener('error', () => {
          reject(new Error(`Speech SDK script failed: ${SCRIPT_SRC}`));
        });
        return;
      }

      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.setAttribute(SCRIPT_ATTR, '1');
      s.onload = () => finish();
      s.onerror = () => {
        reject(
          new Error(
            `Failed to load Azure Speech SDK from ${SCRIPT_SRC}. Ensure the file exists under public/vendor.`,
          ),
        );
      };
      document.head.appendChild(s);
    }).then(
      (sdk) => sdk,
      (err: unknown) => {
        loadPromise = null;
        throw err;
      },
    );
  }

  return loadPromise;
}
