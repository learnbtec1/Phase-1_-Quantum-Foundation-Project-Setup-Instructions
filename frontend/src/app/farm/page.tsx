import { redirect } from 'next/navigation';

/**
 * /farm → /unit-1-agriculture
 * Canonical path for the virtual farm environment.
 */
export default function FarmRedirect() {
  redirect('/unit-1-agriculture');
}
