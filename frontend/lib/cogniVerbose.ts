/**
 * Pipeline diagnostics for Cogni / avatar / brain — **default OFF** so production builds stay quiet.
 * Enable with `NEXT_PUBLIC_DEBUG_AVATAR=true` or `NEXT_PUBLIC_DEBUG_COGNI=true`.
 */

export function isCogniVerbose(): boolean {
  if (typeof process === "undefined") return false;
  return (
    process.env.NEXT_PUBLIC_DEBUG_AVATAR === "true" ||
    process.env.NEXT_PUBLIC_DEBUG_COGNI === "true"
  );
}

export function cogniVerbose(...args: unknown[]): void {
  if (isCogniVerbose()) console.log(...args);
}

export function cogniVerboseWarn(...args: unknown[]): void {
  if (isCogniVerbose()) console.warn(...args);
}
