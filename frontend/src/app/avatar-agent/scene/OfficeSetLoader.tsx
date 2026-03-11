'use client';
/**
 * OfficeSetLoader.tsx — Smart office set loader.
 *
 * Strategy (in order):
 *  1. Looks for a node named "OfficeDeskSet" in the loaded GLB.
 *  2. Falls back to name-heuristic (desk|table|chair|seat…) — picks the 6
 *     largest meshes and reparents them under a new OfficeDeskSet group.
 *  3. If still empty → builds a brown wooden-style placeholder desk + dark
 *     chair from BoxGeometry so the room is never blank.
 *
 * After setup:
 *  - ChairSeatAnchor is created / located and exposed via onReady().
 *  - WorldColliders is notified via setDeskScene() / computeChairAnchor().
 *  - window event "officeSet:loaded" is dispatched.
 *
 * Props:
 *   url      — GLB path (default "/assets/office.glb")
 *   targetZ  — world Z for the office group (default 0.9)
 *   scaleFix — uniform scale multiplier (1 = meters, 0.01 = centimetres)
 *   debug    — log details to console
 *   onReady  — called with (officeGroup, seatAnchor|null)
 */
import React, { useEffect } from 'react';
import {
  Box3, BoxGeometry, DoubleSide, Group, Mesh,
  MeshStandardMaterial, Object3D, Quaternion, Scene, Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useThree } from '@react-three/fiber';
import { setDeskScene, computeChairAnchor } from '../physics/WorldColliders';
import { ROOM_BOUNDS } from './RoomShell';

const NAME_HINTS = /desk|table|office|work|chair|seat|stool|sofa/i;

type OfficeSetLoaderProps = {
  url?:     string;
  targetZ?: number;
  scaleFix?: number;
  debug?:   boolean;
  onReady?: (office: Group, seatAnchor: Object3D | null) => void;
};

// ── Pre-allocated temporaries (zero GC in effect) ──────────────────────────
const _box = new Box3();
const _v   = new Vector3();
const _q   = new Quaternion();
const _s   = new Vector3(1, 1, 1);

// ── Desk material constants ─────────────────────────────────────────────────
const DESK_SURFACE_Y = 0.76;   // 76 cm above floor (local space of office group)
const SEAT_Y         = 0.46;   // 46 cm above floor
const SEAT_OFFSET_Z  = 0.55;   // chair sits 55 cm in front of desk centre

// ── 3-tier setup helper (runs outside React, safe on 404) ───────────────────
function setupOffice(
  root:    Group | null,
  scene:   Scene,
  opts: {
    targetZ:  number;
    scaleFix: number;
    debug:    boolean;
    onReady?: (office: Group, seatAnchor: Object3D | null) => void;
  },
): void {
  const { targetZ, scaleFix, debug, onReady } = opts;

  // ── 1. Explicit OfficeDeskSet group ────────────────────────────────────
  let office: Group | null = root
    ? (root.getObjectByName('OfficeDeskSet') as Group | null)
    : null;

  // ── 2. Full-room fallback: wrap entire GLB in a scaleable group ──────
  // For full-room GLBs (e.g. office.glb with Office_* named meshes),
  // picking the "6 largest" meshes would orphan them and lose room context.
  // Instead, wrap the whole root so scaleFix + auto-centering apply uniformly.
  if (!office && root) {
    if (debug) console.info('[OfficeSetLoader] No OfficeDeskSet — wrapping full GLB root.');
    office = new Group();
    office.name = 'OfficeDeskSet';
    // Re-parent all root children into office group
    [...root.children].forEach(child => office!.add(child));
  }

  // ── 3. BoxGeometry placeholder ────────────────────────────────────────
  const isPlaceholder = !office || office.children.length === 0;
  if (isPlaceholder) {
    office = office ?? new Group();
    office.name = 'OfficeDeskSet';

    // Desktop slab
    const desk = new Mesh(
      new BoxGeometry(1.4, 0.06, 0.6),
      new MeshStandardMaterial({ color: '#C06A2B', roughness: 0.6, metalness: 0.05, side: DoubleSide }),
    );
    desk.name = 'Desk_Placeholder';
    desk.position.set(0, DESK_SURFACE_Y, 0);
    desk.castShadow = desk.receiveShadow = true;
    office.add(desk);

    const legMat = new MeshStandardMaterial({ color: '#8E4E20', roughness: 0.7, metalness: 0.05 });
    const legH   = DESK_SURFACE_Y;
    ([[-0.64, -0.26], [0.64, -0.26], [-0.64, 0.26], [0.64, 0.26]] as [number, number][]).forEach(([x, z]) => {
      const leg = new Mesh(new BoxGeometry(0.06, legH, 0.06), legMat);
      leg.position.set(x, legH / 2, z);
      leg.castShadow = true;
      office!.add(leg);
    });

    const seat = new Mesh(
      new BoxGeometry(0.45, 0.05, 0.45),
      new MeshStandardMaterial({ color: '#222831', roughness: 0.8, metalness: 0.02, side: DoubleSide }),
    );
    seat.name = 'ChairSeat';
    seat.position.set(0, SEAT_Y, SEAT_OFFSET_Z);
    seat.castShadow = true;
    office.add(seat);

    const back = new Mesh(
      new BoxGeometry(0.45, 0.45, 0.05),
      new MeshStandardMaterial({ color: '#1B1F27', roughness: 0.8, metalness: 0.02, side: DoubleSide }),
    );
    back.position.set(0, SEAT_Y + 0.26, SEAT_OFFSET_Z + 0.20);
    back.castShadow = true;
    office.add(back);

    if (debug) console.info('[OfficeSetLoader] ⚠ Placeholder desk (no GLB or no matching nodes).');
  }

  // ── 4. Material / shadow fix ──────────────────────────────────────────
  office!.traverse((o: Object3D) => {
    if ((o as Mesh).isMesh) {
      const m = (o as Mesh).material as MeshStandardMaterial;
      if (m) { m.side = DoubleSide; m.needsUpdate = true; }
      (o as Mesh).castShadow    = true;
      (o as Mesh).receiveShadow = true;
      (o as Mesh).frustumCulled = false;
    }
  });

  // ── 5. Position + scale ───────────────────────────────────────────────
  office!.position.set(0, ROOM_BOUNDS.floorY, targetZ);
  // Placeholder is built in real-world metres — do NOT apply scaleFix (which is for cm-unit GLBs)
  const effectiveScale = isPlaceholder ? 1.0 : scaleFix;
  office!.scale.setScalar(effectiveScale);

  // Auto-center: offset group X/Z so the bounding box centroid sits at (0, ?, targetZ)
  // This fixes GLBs whose meshes are offset from the origin (common in marketplace assets).
  if (!isPlaceholder) {
    const bbox = new Box3().setFromObject(office!);
    const center = new Vector3();
    bbox.getCenter(center);
    // Shift group position so mesh centroid lands at X=0, Z=targetZ
    office!.position.x -= center.x;
    office!.position.z -= (center.z - targetZ);
  }

  // ── 6. ChairSeatAnchor ────────────────────────────────────────────────
  let seatAnchor = office!.getObjectByName('ChairSeatAnchor') as Object3D | null;
  if (!seatAnchor) {
    const seatMesh =
      office!.getObjectByName('ChairSeat') ??
      office!.children.find(c => /seat/i.test(c.name)) ??
      null;

    const anchor = new Object3D();
    anchor.name = 'ChairSeatAnchor';
    if (seatMesh) {
      seatMesh.updateWorldMatrix(true, false);
      seatMesh.matrixWorld.decompose(_v, _q, _s);
      anchor.position.copy(_v);
      anchor.position.y += 0.03;
      anchor.quaternion.copy(_q);
    } else {
      anchor.position.set(0, ROOM_BOUNDS.floorY + SEAT_Y + 0.03, targetZ + SEAT_OFFSET_Z);
    }
    office!.add(anchor);
    seatAnchor = anchor;
  }

  // ── 7. Register + add to THREE scene ─────────────────────────────────
  setDeskScene(office!);
  computeChairAnchor();
  // Always add the processed (scaled + centred) office group.
  // Never add raw root — it would bypass scaleFix and auto-centering.
  scene.add(office!);

  onReady?.(office!, seatAnchor);
  window.dispatchEvent(new CustomEvent('officeSet:loaded', { detail: { group: office } }));

  // ── 8. Debug bbox dump ───────────────────────────────────────────────
  if (debug) {
    const wBbox = new Box3().setFromObject(office!);
    const wCtr  = new Vector3();
    wBbox.getCenter(wCtr);
    console.info('[OfficeSetLoader] ✅ ready', {
      placeholder: isPlaceholder,
      children:    office!.children.length,
      position:    office!.position.toArray().map((v: number) => +v.toFixed(3)),
      scale:       office!.scale.toArray().map((v: number) => +v.toFixed(4)),
      worldBboxMin: wBbox.min.toArray().map((v: number) => +v.toFixed(3)),
      worldBboxMax: wBbox.max.toArray().map((v: number) => +v.toFixed(3)),
      worldCenter:  wCtr.toArray().map((v: number) => +v.toFixed(3)),
    });
    // Also store on window for Playwright inspection
    (window as any).__officeDebug = {
      pos: office!.position.toArray(),
      scale: office!.scale.toArray(),
      min: wBbox.min.toArray(),
      max: wBbox.max.toArray(),
      center: wCtr.toArray(),
    };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export function OfficeSetLoader({
  url      = '/assets/office.glb',
  targetZ  = 0.9,
  // 0.01 converts centimetre-unit GLB exports (typical 3D-marketplace assets) to metres.
  // Swap to 1.0 if your GLB was exported in metres (Blender default SI units).
  scaleFix = 0.01,
  debug    = false,
  onReady,
}: OfficeSetLoaderProps) {
  const { scene } = useThree();

  useEffect(() => {
    let cancelled = false;

    const finish = (root: Group | null) => {
      if (cancelled) return;
      setupOffice(root, scene, { targetZ, scaleFix, debug, onReady });
    };

    // Load GLB directly — skip HEAD check (HEAD can abort in Playwright/strict CSP environments
    // even when the resource exists, causing spurious fallback to placeholder).
    // GLTFLoader's own error handler covers 404 gracefully.
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (!cancelled) finish(gltf.scene as Group);
      },
      undefined,
      (err) => {
        if (cancelled) return;
        if (debug) console.warn('[OfficeSetLoader] GLB load error → placeholder.', (err as ErrorEvent).message ?? err);
        finish(null);
      },
    );

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, url, targetZ, scaleFix, debug]);

  return null;
}
