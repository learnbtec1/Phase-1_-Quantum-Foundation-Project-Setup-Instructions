/**
 * useRoomTheme.ts — Global room theme hook.
 *
 * Provides a shared palette store (module-level singleton)
 * that any component can read or update. Changes propagate to all subscribers.
 *
 * Public API:
 *   const { palette, setPalette, physicsOn, togglePhysics } = useRoomTheme();
 *
 * Imperative helpers (callable without hooks):
 *   togglePhysics()   enable/disable Box3 collision
 *   sit(group)        move avatar to ChairSeatAnchor
 *   stand(group)      reset avatar to floor
 *   snapToSeat(group) alias for sit()
 *   setOfficeSet(obj) register a loaded Object3D with the collision system
 */
import { useState, useEffect, useCallback } from 'react';
import { ROOM_PALETTE, type RoomPalette } from '../scene/BackdropTheme';
import {
  setEnabled,
  isEnabled,
  sit       as _sit,
  stand     as _stand,
  snapToSeat as _snapToSeat,
  setDeskScene,
} from '../physics/WorldColliders';
import type * as THREE from 'three';

// ── Module-level singleton state ──────────────────────────────────────────────
let _palette: RoomPalette = { ...ROOM_PALETTE };
const _subscribers = new Set<() => void>();
function notify() { _subscribers.forEach(fn => fn()); }

// ── Public hook ───────────────────────────────────────────────────────────────
export interface RoomThemeAPI {
  palette:       RoomPalette;
  physicsOn:     boolean;
  setPalette:    (next: Partial<RoomPalette>) => void;
  togglePhysics: () => void;
}

export function useRoomTheme(): RoomThemeAPI {
  const [palette,   setPaletteState] = useState<RoomPalette>(_palette);
  const [physicsOn, setPhysicsState] = useState<boolean>(isEnabled());

  // Subscribe to external mutations
  useEffect(() => {
    const refresh = () => {
      setPaletteState({ ..._palette });
      setPhysicsState(isEnabled());
    };
    _subscribers.add(refresh);
    return () => { _subscribers.delete(refresh); };
  }, []);

  const setPalette = useCallback((next: Partial<RoomPalette>) => {
    _palette = { ..._palette, ...next };
    notify();
  }, []);

  const togglePhysics = useCallback(() => {
    setEnabled(!isEnabled());
    notify();
  }, []);

  return { palette, physicsOn, setPalette, togglePhysics };
}

// ── Imperative helpers (usable outside React) ─────────────────────────────────
export function togglePhysics():                    void   { setEnabled(!isEnabled()); notify(); }
export function sit       (g: THREE.Group): boolean        { return _sit(g); }
export function stand     (g: THREE.Group): void           { _stand(g); }
export function snapToSeat(g: THREE.Group): void           { _snapToSeat(g); }
export function setOfficeSet(obj: THREE.Object3D): void    { setDeskScene(obj); }
