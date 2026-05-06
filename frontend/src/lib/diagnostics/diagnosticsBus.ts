/**
 * Central diagnostic bus — thin façade over {@link diagInc}.
 * Prefer subsystem-specific modules for readability at call sites.
 */
export { diagInc, isDiagnosticsEnabled, setDiagnosticsEnabled } from './diagnosticsStore';
