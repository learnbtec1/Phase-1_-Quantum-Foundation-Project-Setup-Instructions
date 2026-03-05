import { redirect } from 'next/navigation';

/**
 * /ai-tutor → /ai-teacher
 * Canonical path alias for the Smart Teacher environment.
 */
export default function AiTutorRedirect() {
  redirect('/ai-teacher');
}
