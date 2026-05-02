'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { isObservabilityEnabled } from './config';
import {
  tickObservabilityHub,
  notifyObservabilitySubscribers,
  patchRendererInfo,
} from './observabilityHub';
import { recordAvatarRootWorldPosition } from './motionDiagnostics';
import { touchMotionEvent } from './motionDiagnostics';
import { recordGestureName } from './behaviorAnalyzer';
import { pushEventStream } from './eventStream';
import { startStateConsistencyProbe, stopStateConsistencyProbe } from './stateConsistency';
import { resetAllObservability } from './resetAll';
import { getObservabilityNotifyStride } from './selfHealingEngine';

const _pos = new THREE.Vector3();

type Props = {
  /** Pass from parent — env flag is checked at parent level too */
  enabled: boolean;
  groupRef: RefObject<THREE.Group | null>;
};

/**
 * Single R3F hook site for FPS / memory sampling / root drift / event stream.
 * Must live inside <Canvas>.
 */
export function ObservabilityR3F({ enabled, groupRef }: Props): null {
  const gl = useThree((s) => s.gl);
  const frameIdx = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    resetAllObservability();
    startStateConsistencyProbe();
    return () => {
      stopStateConsistencyProbe();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onGesture = (e: Event): void => {
      const d = (e as CustomEvent<{ type?: string }>).detail;
      touchMotionEvent();
      const t = typeof d?.type === 'string' ? d.type : 'gesture';
      recordGestureName(t);
      pushEventStream('motion', 'avatar:gesture', d);
    };
    const onVrma = (e: Event): void => {
      touchMotionEvent();
      pushEventStream('motion', 'avatar:vrma:active', (e as CustomEvent).detail);
    };
    const onSpeakStart = (): void => {
      pushEventStream('audio', 'avatar:speak:start');
    };
    const onSpeakEnd = (): void => {
      pushEventStream('audio', 'avatar:speak:end');
    };
    window.addEventListener('avatar:gesture', onGesture as EventListener);
    window.addEventListener('avatar:vrma:active', onVrma as EventListener);
    window.addEventListener('avatar:speak:start', onSpeakStart);
    window.addEventListener('avatar:speak:end', onSpeakEnd);
    return () => {
      window.removeEventListener('avatar:gesture', onGesture as EventListener);
      window.removeEventListener('avatar:vrma:active', onVrma as EventListener);
      window.removeEventListener('avatar:speak:start', onSpeakStart);
      window.removeEventListener('avatar:speak:end', onSpeakEnd);
    };
  }, [enabled]);

  useFrame((_, delta) => {
    if (!enabled) return;
    const now = performance.now();
    tickObservabilityHub(delta, now);
    frameIdx.current += 1;

    if (frameIdx.current % 9 === 0 && groupRef.current) {
      groupRef.current.getWorldPosition(_pos);
      recordAvatarRootWorldPosition(_pos.x, _pos.y, _pos.z);
    }

    if (frameIdx.current % 120 === 0) {
      const mem = gl.info.memory;
      if (mem) patchRendererInfo(mem.geometries, mem.textures);
    }

    const stride = getObservabilityNotifyStride();
    if (stride > 0 && frameIdx.current % stride === 0) {
      notifyObservabilitySubscribers();
    }
  });

  return null;
}
