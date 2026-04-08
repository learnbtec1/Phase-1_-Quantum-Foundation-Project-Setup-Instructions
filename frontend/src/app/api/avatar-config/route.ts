import { NextRequest, NextResponse } from 'next/server';
import type { AvatarConfig } from '@/store/avatarConfigStore';
import { cloneAvatarConfigDefaults } from '@/store/avatarConfigStore';
import {
  blockAvatarConfigUnlessEnabledInProduction,
  requireAuthenticatedUser,
} from '@/lib/server/bffAuth';

/** Per-user server-side avatar tuning (not a global process singleton). */
const userConfigs = new Map<string, AvatarConfig>();

function getConfigForUser(userId: string): AvatarConfig {
  let c = userConfigs.get(userId);
  if (!c) {
    c = cloneAvatarConfigDefaults();
    userConfigs.set(userId, c);
  }
  return c;
}

export async function GET(req: NextRequest) {
  const blocked = blockAvatarConfigUnlessEnabledInProduction();
  if (blocked) return blocked;

  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json(getConfigForUser(auth.userId));
}

export async function POST(req: NextRequest) {
  const blocked = blockAvatarConfigUnlessEnabledInProduction();
  if (blocked) return blocked;

  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  const current = { ...getConfigForUser(auth.userId) };

  try {
    const body = await req.json();
    if (body?.action === 'reset') {
      const fresh = cloneAvatarConfigDefaults();
      userConfigs.set(auth.userId, fresh);
      return NextResponse.json(fresh);
    }
    if (body && typeof body === 'object') {
      if (typeof body.isWalking === 'boolean') {
        current.isWalking = body.isWalking;
      }
      if (typeof body.idleSwayAmount === 'number') {
        current.idleSwayAmount = body.idleSwayAmount;
      }
      if (typeof body.zoomEnabled === 'boolean') {
        current.zoomEnabled = body.zoomEnabled;
      }
      userConfigs.set(auth.userId, current);
    }
    return NextResponse.json(getConfigForUser(auth.userId));
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
}
