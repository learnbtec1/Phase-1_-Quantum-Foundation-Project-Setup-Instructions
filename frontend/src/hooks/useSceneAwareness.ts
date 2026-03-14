/**
 * useSceneAwareness
 * ─────────────────────────────────────────────────────────────────────────────
 * Scans a THREE.js scene for named objects and exposes helper methods so
 * gesture code can point to real scene geometry (e.g. "whiteboard", "desk").
 *
 * Safe contract:
 * • If scanning fails or the object is not found, all methods return null/false.
 * • IK-based pointing is gated behind USE_IK feature flag (default false).
 * • Gestures relying on scene objects must check hasObject() before proceeding.
 *
 * Usage (inside a React component that has access to the R3F scene):
 *
 *   const { scanScene, getObjectPosition, hasObject } = useSceneAwareness();
 *
 *   // Call once after scene loads:
 *   scanScene(threeScene);
 *
 *   // In gesture code:
 *   if (hasObject('whiteboard')) {
 *     const pos = getObjectPosition('whiteboard');
 *     // point arm toward pos
 *   }
 */
'use client';

import { useCallback, useRef } from 'react';
import * as THREE from 'three';

// Object name aliases — maps logical names to possible THREE Object3D names.
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  whiteboard: ['Whiteboard', 'whiteboard', 'Board', 'SmartBoard'],
  desk:       ['Desk', 'desk', 'Table', 'OfficeDeskMain'],
  screen:     ['Screen', 'screen', 'Monitor', 'TV', 'Display'],
  chair:      ['Chair', 'chair', 'Seat'],
  bookshelf:  ['Bookshelf', 'bookshelf', 'Shelf', 'Cabinet'],
};

export interface SceneAwarenessAPI {
  /** Call once after the THREE.Scene (from OfficeSetLoader) is available. */
  scanScene: (scene: THREE.Object3D) => void;
  /**
   * Returns the world-space centre position of a named object, or null if not found.
   * @param name Logical name (e.g. 'whiteboard') or THREE Object3D name.
   */
  getObjectPosition: (name: string) => THREE.Vector3 | null;
  /** Returns true if the named object exists in the scanned scene. */
  hasObject: (name: string) => boolean;
  /** List of all object names found during the last scan. */
  knownObjects: () => readonly string[];
}

export function useSceneAwareness(): SceneAwarenessAPI {
  // name → world-space bbox centre (reused Vector3 per entry)
  const objectMapRef = useRef<Map<string, THREE.Vector3>>(new Map());

  const scanScene = useCallback((root: THREE.Object3D) => {
    const map = objectMapRef.current;
    map.clear();

    const box  = new THREE.Box3();
    const cent = new THREE.Vector3();

    try {
      root.traverse((obj) => {
        if (!obj.name) return;
        box.setFromObject(obj);
        box.getCenter(cent);
        // Store under exact name
        map.set(obj.name, cent.clone());
        // Also store under normalised lowercase for fuzzy matching
        map.set(obj.name.toLowerCase(), cent.clone());
      });

      // Register aliases
      for (const [logical, candidates] of Object.entries(ALIASES)) {
        for (const c of candidates) {
          const pos = map.get(c) ?? map.get(c.toLowerCase());
          if (pos) {
            map.set(logical, pos.clone());
            break;
          }
        }
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[SceneAwareness] Scanned', map.size, 'objects:', [...map.keys()].slice(0, 20));
      }
    } catch (err) {
      console.warn('[SceneAwareness] Scan failed:', err);
    }
  }, []);

  const getObjectPosition = useCallback((name: string): THREE.Vector3 | null => {
    return (
      objectMapRef.current.get(name) ??
      objectMapRef.current.get(name.toLowerCase()) ??
      null
    );
  }, []);

  const hasObject = useCallback((name: string): boolean => {
    return (
      objectMapRef.current.has(name) ||
      objectMapRef.current.has(name.toLowerCase())
    );
  }, []);

  const knownObjects = useCallback((): readonly string[] => {
    return [...objectMapRef.current.keys()];
  }, []);

  return { scanScene, getObjectPosition, hasObject, knownObjects };
}
