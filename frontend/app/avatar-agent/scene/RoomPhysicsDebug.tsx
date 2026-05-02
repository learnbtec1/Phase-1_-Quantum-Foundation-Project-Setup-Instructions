'use client';

/**
 * Dev-only wireframes for ROOM_BOUNDS cage + walk floor rectangle.
 * Enable with NEXT_PUBLIC_DEBUG_PHYSICS_COLLIDERS=true — invisible colliders stay off in production.
 */
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ROOM_BOUNDS } from '@/app/avatar-agent/scene/RoomShell';

export function RoomPhysicsDebugEdges(): React.ReactElement | null {
  const { roomEdges, floorFootprintGeom, boxCenter } = useMemo(() => {
    const rb = ROOM_BOUNDS;
    const w = rb.maxX - rb.minX;
    const h = rb.ceilY - rb.floorY;
    const d = rb.maxZ - rb.minZ;
    const box = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();

    const fy = rb.floorY + 0.004;
    const corners = [
      new THREE.Vector3(rb.minX, fy, rb.minZ),
      new THREE.Vector3(rb.maxX, fy, rb.minZ),
      new THREE.Vector3(rb.maxX, fy, rb.maxZ),
      new THREE.Vector3(rb.minX, fy, rb.maxZ),
      new THREE.Vector3(rb.minX, fy, rb.minZ),
    ];
    const fp = new THREE.BufferGeometry().setFromPoints(corners);

    const cx = (rb.minX + rb.maxX) / 2;
    const cy = (rb.floorY + rb.ceilY) / 2;
    const cz = (rb.minZ + rb.maxZ) / 2;

    return {
      roomEdges: edges,
      floorFootprintGeom: fp,
      boxCenter: new THREE.Vector3(cx, cy, cz),
    };
  }, []);

  useEffect(() => {
    return () => {
      roomEdges.dispose();
      floorFootprintGeom.dispose();
    };
  }, [roomEdges, floorFootprintGeom]);

  return (
    <group name="RoomPhysicsDebugEdges">
      <lineSegments geometry={floorFootprintGeom} raycast={() => undefined}>
        <lineBasicMaterial color="#ff3355" depthTest />
      </lineSegments>
      <lineSegments
        position={[boxCenter.x, boxCenter.y, boxCenter.z]}
        geometry={roomEdges}
        raycast={() => undefined}
      >
        <lineBasicMaterial color="#33ff66" depthTest />
      </lineSegments>
    </group>
  );
}
