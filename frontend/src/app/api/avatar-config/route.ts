import { NextRequest, NextResponse } from 'next/server';
import { useAvatarConfigStore } from '@/store/avatarConfigStore';

export async function GET() {
  const state = useAvatarConfigStore.getState();
  return NextResponse.json(state.config);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.action === 'reset') {
      useAvatarConfigStore.getState().resetToDefaults();
    } else if (body && typeof body === 'object') {
      useAvatarConfigStore.getState().setConfig({
        isWalking: typeof body.isWalking === 'boolean' ? body.isWalking : undefined,
        idleSwayAmount: typeof body.idleSwayAmount === 'number' ? body.idleSwayAmount : undefined,
        zoomEnabled: typeof body.zoomEnabled === 'boolean' ? body.zoomEnabled : undefined,
      });
    }
    const state = useAvatarConfigStore.getState();
    return NextResponse.json(state.config);
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
}
