/**
 * BFF response validation: `provider` field from FastAPI TTS must match known backend IDs.
 * Piper syntheses return `local_piper` (see `LocalPiperProvider`); rejecting it caused 502 "TTS integrity".
 */

const TTS_UPSTREAM_PROVIDER_ALLOWLIST = new Set([
  'azure',
  'edge',
  'auto',
  'elevenlabs',
  'local',
  'local_piper',
]);

/** `normalizedProvider` must already be lowercase trim, or empty when backend omits provider. */
export function isTtsUpstreamProviderOk(normalizedProvider: string): boolean {
  const p = normalizedProvider.trim().toLowerCase();
  return p === '' || TTS_UPSTREAM_PROVIDER_ALLOWLIST.has(p);
}
