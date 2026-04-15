import { legacyRootApiResponse } from '../legacyRootApiResponse';

export async function POST() {
  return legacyRootApiResponse('/chat');
}
