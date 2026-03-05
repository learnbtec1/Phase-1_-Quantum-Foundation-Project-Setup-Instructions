'use client';

export default function OfficeEnvironment() {
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>

      <mesh position={[0, 2.5, -10]}>
        <boxGeometry args={[20, 5, 0.5]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[-10, 2.5, 0]}>
        <boxGeometry args={[0.5, 5, 20]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>
      <mesh position={[10, 2.5, 0]}>
        <boxGeometry args={[0.5, 5, 20]} />
        <meshStandardMaterial color="#1e293b" />
      </mesh>

      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[4, 1.2, 2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[5, 0.6, 2]}>
        <boxGeometry args={[3, 1.2, 2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
      <mesh position={[-5, 0.6, 2]}>
        <boxGeometry args={[3, 1.2, 2]} />
        <meshStandardMaterial color="#334155" />
      </mesh>
    </group>
  );
}
