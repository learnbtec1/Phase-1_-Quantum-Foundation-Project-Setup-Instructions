/** Heuristic: marketing-plan assignment phrasing (Arabic + English). */
export function detectAssignmentIntent(message: string): boolean {
  const text = message.toLowerCase();

  const isAssignment =
    text.includes('واجب') ||
    text.includes('assignment') ||
    text.includes('project');

  const isMarketing =
    text.includes('خطة التسويق') || text.includes('marketing plan');

  return isAssignment && isMarketing;
}
