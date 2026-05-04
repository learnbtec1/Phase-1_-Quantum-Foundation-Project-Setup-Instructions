import { Canvas } from "@react-three/fiber";
import { Float, Environment, Stars, Html } from "@react-three/drei";
import { Suspense } from "react";
import ariaAvatar from "@/assets/aria-avatar.png";

// ⚠ Performance: Canvas is full-screen but pointer-events-none on wrapper
// so overlay glass panels remain interactive.
function AriaAvatar() {
  return (
    <Float speed={1.4} floatIntensity={0.6} rotationIntensity={0.15}>
      {/* صورة الأفاتار الواقعية كـ HTML داخل مشهد 3D */}
      <Html
        center
        transform
        distanceFactor={2.4}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: "50%",
            overflow: "hidden",
            border: "2px solid rgba(125, 240, 255, 0.55)",
            boxShadow:
              "0 0 60px rgba(34, 211, 238, 0.55), inset 0 0 40px rgba(16, 185, 129, 0.35)",
          }}
        >
          <img
            src={ariaAvatar}
            alt="ARIA"
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }}
          />
        </div>
      </Html>
      {/* حلقة هولوغرافيّة خارجيّة */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.7, 0.012, 16, 100]} />
        <meshStandardMaterial color="#7df0ff" emissive="#22d3ee" emissiveIntensity={1.4} />
      </mesh>
      <mesh rotation={[Math.PI / 2.4, Math.PI / 6, 0]}>
        <torusGeometry args={[1.95, 0.008, 16, 100]} />
        <meshStandardMaterial color="#10b981" emissive="#10b981" emissiveIntensity={1.2} />
      </mesh>
      <mesh rotation={[Math.PI / 1.8, Math.PI / 3, 0]}>
        <torusGeometry args={[2.2, 0.006, 16, 100]} />
        <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.9} />
      </mesh>
    </Float>
  );
}

export function AriaScene() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={["#070b18"]} />
        <fog attach="fog" args={["#070b18", 6, 14]} />
        <ambientLight intensity={0.25} />
        <pointLight position={[3, 2, 4]} intensity={1.2} color="#22d3ee" />
        <pointLight position={[-4, -2, 2]} intensity={0.8} color="#10b981" />
        <pointLight position={[0, 3, -3]} intensity={0.6} color="#fbbf24" />
        <Suspense fallback={null}>
          <AriaAvatar />
          <Stars radius={40} depth={30} count={1500} factor={3} fade speed={0.5} />
          <Environment preset="night" />
        </Suspense>
      </Canvas>
    </div>
  );
}