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
 *   url      — GLB path (default `OFFICE_GLB_PUBLIC_PATH` → `/models/office/office.glb`)
 *   targetZ  — world Z for the office group (default 0.9)
 *   scaleFix — uniform scale multiplier (1 = meters, 0.01 = centimetres)
 *   debug    — log details to console
 *   onReady  — called with (officeGroup, seatAnchor|null)
 */
import React, { useEffect } from 'react';
import { OFFICE_GLB_PUBLIC_PATH } from '@/config/avatar';
import {
  Box3, BoxGeometry, Color, DoubleSide, Group, Mesh,
  MeshStandardMaterial, Object3D, Quaternion, Scene, Vector2, Vector3,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
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

  // ── 4. ROYAL CINEMATIC MATERIAL OVERHAUL ────────────────────────────────
  // ⚠ VRM SAFE: traversal is SCOPED to `office` group only — avatar untouched.
  // Spec: Royal Cinematic Overhaul brief (Step 1).

  // ── Ultra-Natural Scandinavian Material Presets ───────────────────────────
  // Scientifically balanced for 8+ hour eye comfort and soft north-light aesthetics.
  // Shared preset materials (not cloned until map-inheritance requested)
  const matOak      = new MeshStandardMaterial({ color: '#F5F5F5', roughness: 0.82, metalness: 0.02, side: DoubleSide }); // White matte desk/shelves
  const matFabric   = new MeshStandardMaterial({ color: '#2C3E50', roughness: 0.96, metalness: 0.00, side: DoubleSide }); // Dark navy chairs
  const matMetal    = new MeshStandardMaterial({ color: '#C9A830', roughness: 0.40, metalness: 0.60, side: DoubleSide }); // Gold accent metal
  const matCoolWall = new MeshStandardMaterial({ color: '#E8E8E8', roughness: 0.94, metalness: 0.00, side: DoubleSide }); // Light neutral gray walls
  // Back wall panel — fully transparent so HologramWindow at Z=-6 shines through
  const matGlass    = new MeshStandardMaterial({ color: '#000000', transparent: true, opacity: 0.0, depthWrite: false, side: DoubleSide });
  // Royal Navy deep blue for shelves + accent walls — rich, not washed-out
  const matWarmWall = new MeshStandardMaterial({ color: '#060D20', roughness: 0.92, metalness: 0.00, side: DoubleSide }); // Deep royal navy wall
  const matShelf    = new MeshStandardMaterial({ color: '#0A174E', roughness: 0.75, metalness: 0.06, side: DoubleSide }); // Deep royal navy bookshelf

  const allMeshes: Mesh[] = [];
  const _hsl = { h: 0, s: 0, l: 0 };

  /** Safely dispose a material, preventing GPU memory leaks */
  const disposeMat = (m: any): void => {
    if (m && typeof m.dispose === 'function') { try { m.dispose(); } catch (_) {} }
  };

  /**
   * Clone a preset and inherit normalMap / roughnessMap / aoMap from the
   * original so PBR detail is preserved where it exists.
   */
  const withMaps = (preset: MeshStandardMaterial, src: any): MeshStandardMaterial => {
    if (!src?.isMaterial) return preset;
    const out = preset.clone();
    if (src.normalMap)    { out.normalMap = src.normalMap;    out.normalScale.copy(src.normalScale ?? new Vector2(1, 1)); }
    if (src.roughnessMap) out.roughnessMap = src.roughnessMap;
    if (src.aoMap)        out.aoMap = src.aoMap;
    return out;
  };

  /**
   * Classify one material slot → return Scandinavian natural preset, or null to keep.
   * Converts ALL material types (Basic/Phong/Lambert/Custom) → MeshStandardMaterial.
   * HSL override detects over-saturated / artificial colors and replaces them.
   */
  const classifyOneMat = (raw: any, nodeName: string, meshCenterX = 0, meshCenterZ = 0): MeshStandardMaterial | null => {
    // Always replace non-standard materials (Basic, Phong, Lambert, etc.)
    const isNonStandard = raw && !raw.isMeshStandardMaterial && !raw.isMeshPhysicalMaterial;

    if (!raw) return null;
    const col: Color | null = (raw.color && (raw.color as Color).isColor) ? raw.color as Color : null;
    // For non-standard materials without color, force oak default
    if (!col) return isNonStandard ? withMaps(matOak, raw) : null;

    col.getHSL(_hsl);
    const h = _hsl.h * 360;   // 0 – 360
    const s = _hsl.s;          // 0 – 1
    const l = _hsl.l;          // 0 – 1

    // 1. Named tech/metal devices → low-shine classroom metal
    if (/laptop|computer|screen|monitor|keyboard|device/.test(nodeName)) return withMaps(matMetal, raw);

    // 1b. Shelves / bookcases / racks / cabinets → sky blue
    if (/shelf|shelv|bookcase|bookshelf|rack|cabinet|cupboard|bibliotek|polica|polke|ormar/.test(nodeName)) return withMaps(matShelf, raw);

    // 2. Chairs / stools / sofas / couches / fabric → calm grey textile
    if (/chair|stool|sofa|couch|seat|armchair|fabric|cushion/.test(nodeName)) return withMaps(matFabric, raw);

    // 3. WALL RULE: named wall/partition/ceiling OR saturated/warm-orange at high lightness
    //    Right-side wall (meshCenterX > 1.0) → slightly warmer bounce; others → natural cream
    const wallMat = (mat: MeshStandardMaterial) => withMaps(meshCenterX > 1.0 ? matWarmWall : mat, raw);
    // 3a. BACK WALL: flat panel at back of room → transparent so HologramWindow shines through
    if (/wall|partition/.test(nodeName) && meshCenterZ < -0.5) return matGlass;
    if (/wall|partition|ceiling|roof/.test(nodeName)) return wallMat(matCoolWall);
    // Over-saturated warm tones → replace with natural wall
    if (h >= 15 && h <= 45 && s >= 0.20 && l >= 0.45) return wallMat(matCoolWall);

    // 4. Near-white surfaces (panels, trim, plaster) → natural cream wall
    if (l > 0.78 && s < 0.15) return wallMat(matCoolWall);

    // 5. Metallic grey (low sat, mid-bright) → low-shine metal
    if (l > 0.38 && l < 0.72 && s < 0.08) return withMaps(matMetal, raw);

    // 6. Warm wood / amber tones → Scandinavian light oak
    if (h >= 4 && h <= 55 && s > 0.08) return withMaps(matOak, raw);

    // 7. Very dark or over-saturated colors → fabric (catch dark chairs/cushions)
    if (l < 0.12) return withMaps(matFabric, raw);

    // 8. Medium-dark neutrals → oak
    if (l < 0.45 && s < 0.18) return withMaps(matOak, raw);

    // 9. Any remaining over-saturated artificial color → oak default
    if (s > 0.30) return withMaps(matOak, raw);

    // 10. Default → light oak (unified natural Scandinavian)
    return withMaps(matOak, raw);
  };

  let replacedCount = 0;
  office!.traverse((o: Object3D) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    allMeshes.push(mesh);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    const nodeName = `${mesh.name} ${mesh.parent?.name ?? ''}`.toLowerCase();

    // Compute mesh bounding-box centre X/Z (local coords) for wall detection
    const _mbbox = new Box3().setFromObject(mesh);
    const _mc = new Vector3(); _mbbox.getCenter(_mc);
    const meshCenterX = _mc.x;
    const meshCenterZ = _mc.z;

    if (Array.isArray(mesh.material)) {
      mesh.material = (mesh.material as any[]).map(m => {
        const rep = classifyOneMat(m, nodeName, meshCenterX, meshCenterZ);
        if (rep) { disposeMat(m); replacedCount++; return rep; }
        try { if (m) { m.side = DoubleSide; m.needsUpdate = true; } } catch (_) {}
        return m;
      });
    } else {
      const rep = classifyOneMat(mesh.material as any, nodeName, meshCenterX, meshCenterZ);
      if (rep) {
        disposeMat(mesh.material);
        mesh.material = rep;
        replacedCount++;
      } else {
        const raw = mesh.material as any;
        try { if (raw) { raw.side = DoubleSide; raw.needsUpdate = true; } } catch (_) {}
      }
    }
  });

  console.info(
    `%c[OfficeSetLoader] ✅ Royal overhaul — ${replacedCount}/${allMeshes.length} slots replaced (walnut·leather·metal·wall)`,
    'color:#D4AF37;font-weight:bold',
  );
  if (debug) console.info('[OfficeSetLoader] meshes:', allMeshes.map(m => m.name).join(', '));

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

  // ── Back-wall panel hider (world-space, post-scale) ──────────────────
  // After scene.add, hide large flat panels at the far back of the room so
  // the HologramWindow glows through clearly. Targets: world Z < -3.8,
  // thin in Z (< 0.6 world units), wide in X (> 1.5 world units).
  {
    const _wBb = new Box3(), _wC = new Vector3(), _wSz = new Vector3();
    office!.traverse((o: Object3D) => {
      if (!(o as Mesh).isMesh) return;
      const m = o as Mesh;
      _wBb.setFromObject(m);
      _wBb.getCenter(_wC);
      _wBb.getSize(_wSz);
      if (_wC.z < -3.8 && _wSz.z < 0.6 && _wSz.x > 1.5) {
        m.visible = false;
      }
    });
  }

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
  url      = OFFICE_GLB_PUBLIC_PATH,
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
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    dracoLoader.setDecoderConfig({ type: 'js' });
    loader.setDRACOLoader(dracoLoader);
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

    return () => {
      cancelled = true;
      dracoLoader.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, url, targetZ, scaleFix, debug]);

  return null;
}
