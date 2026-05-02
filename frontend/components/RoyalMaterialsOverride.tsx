'use client';
/**
 * RoyalMaterialsOverride — runs once after scene mount.
 * Traverses every mesh in the R3F scene and re-skins it to the
 * Royal Ultra-Lux Executive Suite palette:
 *   Walls      → Matte Royal Navy (#0A174E) | Feature wall → Royal Blue Satin (#4169E1)
 *   Floor      → Walnut (#3E2A1F, satin sheen)
 *   Desk top   → Gloss white | Desk base/legs → Gold
 *   Chairs     → Navy velvet
 *   TV cabinet → Preserved Walnut (no recolor)
 *   Metals     → Royal Gold (#D4AF37) or Silver (#C0C0C0)
 *   Carpets    → Desaturated Burgundy
 * Also lifts crushed blacks across all non-metal meshes.
 */
import * as THREE from 'three';
import React, { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

interface PhysProps {
  color: string;
  roughness: number;
  metalness: number;
  envMapIntensity?: number;
}

function applyStandard(mesh: THREE.Mesh, p: PhysProps): void {
  const prev = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

  const std = new THREE.MeshStandardMaterial({
    color:            new THREE.Color(p.color),
    roughness:        p.roughness,
    metalness:        p.metalness,
    envMapIntensity:  p.envMapIntensity ?? 0.35,
  });

  // Inherit baked texture maps from existing material when present
  const src = prev as unknown as Record<string, unknown>;
  if (src && typeof src === 'object') {
    if (src['map'])          std.map          = src['map']          as THREE.Texture;
    if (src['normalMap'])    std.normalMap    = src['normalMap']    as THREE.Texture;
    if (src['roughnessMap']) std.roughnessMap = src['roughnessMap'] as THREE.Texture;
    if (src['aoMap'])        std.aoMap        = src['aoMap']        as THREE.Texture;
  }

  (prev as { dispose?: () => void })?.dispose?.();

  mesh.material      = std;
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
}

export default function RoyalMaterialsOverride(): null {
  const { scene } = useThree();

  useEffect(() => {
    // ── Royal Palette ─────────────────────────────────────────────────────
    const W_MAIN:    PhysProps = { color: '#0A174E', roughness: 0.90, metalness: 0.00 };
    const W_FEATURE: PhysProps = { color: '#4169E1', roughness: 0.65, metalness: 0.05 };
    const FLOOR_W:   PhysProps = { color: '#3E2A1F', roughness: 0.25, metalness: 0.10 };
    const DESK_TOP:  PhysProps = { color: '#FFFFFF', roughness: 0.08, metalness: 0.00 };
    const GOLD:      PhysProps = { color: '#D4AF37', roughness: 0.20, metalness: 1.00, envMapIntensity: 0.70 };
    const CHAIR_N:   PhysProps = { color: '#0A174E', roughness: 0.92, metalness: 0.00 };
    const TV_WALNUT: PhysProps = { color: '#3E2A1F', roughness: 0.40, metalness: 0.05, envMapIntensity: 0.40 };
    const SHELF_N:   PhysProps = { color: '#0A174E', roughness: 0.40, metalness: 0.00 };
    const SILVER:    PhysProps = { color: '#C0C0C0', roughness: 0.30, metalness: 0.90 };

    scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const mesh = o as THREE.Mesh;
      mesh.castShadow    = true;
      mesh.receiveShadow = true;

      const name = (mesh.name || '').toLowerCase();

      // Preserve & elevate TV cabinet — walnut + gold hardware (no recolor to blue)
      if (/tv|media|console|cabinet|entertainment/.test(name)) {
        applyStandard(mesh, TV_WALNUT); return;
      }
      // Walls — feature wall behind avatar gets satin blue, rest navy
      if (/wall|partition|panel|plaster/.test(name)) {
        applyStandard(mesh, /feature|accent|behind|avatar/.test(name) ? W_FEATURE : W_MAIN);
        return;
      }
      if (/floor|ground|base/.test(name))                       { applyStandard(mesh, FLOOR_W);  return; }
      if (/desk|table|workspace/.test(name)) {
        applyStandard(mesh, /top|surface|counter/.test(name) ? DESK_TOP : GOLD); return;
      }
      if (/chair|seat|sofa|armchair/.test(name))                { applyStandard(mesh, CHAIR_N);  return; }
      if (/handle|knob|trim|frame|lamp|light/.test(name))       { applyStandard(mesh, GOLD);     return; }
      if (/shelf|bookcase|books/.test(name)) {
        applyStandard(mesh, /edge|border|bevel/.test(name) ? SILVER : SHELF_N); return;
      }
      if (/rug|carpet|mat/.test(name)) {
        applyStandard(mesh, { color: '#8B3A3A', roughness: 0.95, metalness: 0.0 }); return;
      }

      // ── Global: lift crushed blacks (excludes metals) ──────────────────
      const isMetal = /metal|gold|silver|handle|knob|trim/.test(name);
      if (isMetal) return;

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        const stdM = m as THREE.MeshStandardMaterial;
        if (!stdM?.color) return;
        const hsl = { h: 0, s: 0, l: 0 };
        stdM.color.getHSL(hsl);
        if (hsl.l < 0.20) {
          hsl.l = 0.20;
          stdM.color.setHSL(hsl.h, hsl.s, hsl.l);
          stdM.roughness   = Math.max(0.70, stdM.roughness   ?? 0.70);
          stdM.metalness   = Math.min(0.20, stdM.metalness   ?? 0.00);
          stdM.needsUpdate = true;
        }
      });
    });
  }, [scene]);

  return null;
}
