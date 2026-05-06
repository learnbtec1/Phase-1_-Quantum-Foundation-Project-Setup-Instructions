/** Numeric severity for packed metrics / sorting (low = informational). */
export const DiagnosticsSeverity = {
  INFO: 0,
  WARN: 1,
  ERROR: 2,
  CRITICAL: 3,
} as const;

export type DiagnosticsSeverityId = (typeof DiagnosticsSeverity)[keyof typeof DiagnosticsSeverity];

export function severityLabel(s: DiagnosticsSeverityId): string {
  switch (s) {
    case DiagnosticsSeverity.INFO:
      return 'INFO';
    case DiagnosticsSeverity.WARN:
      return 'WARN';
    case DiagnosticsSeverity.ERROR:
      return 'ERROR';
    case DiagnosticsSeverity.CRITICAL:
      return 'CRITICAL';
    default:
      return 'UNKNOWN';
  }
}
