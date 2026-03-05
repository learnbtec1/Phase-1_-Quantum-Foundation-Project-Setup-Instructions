"use client";
import React, { Suspense, useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars, Html, PerspectiveCamera, Environment, Float, Box, Sky, Text } from '@react-three/drei';
import * as THREE from 'three';

interface BTECEngineProps {
  config: any;
  onStartTask?: () => void;
  onDeskClick?: () => void;
  onBoardClick?: () => void;
  onComputerClick?: () => void;
  onCharacterClick?: (characterName: string, companyData?: InfoCardData) => void;
}

// بطاقة معلومات تفاعلية
interface InfoCardData {
  title: string;
  company?: string;
  ownership?: string;
  scope?: string;
  size?: string;
  details?: string[];
  role?: string;
}

// شخصية NPC (Non-Player Character)
interface CharacterProps {
  name: string;
  label: string;
  position: [number, number, number];
  bodyColor: string;
  onClick?: () => void;
}

function Character({ name, label, position, bodyColor, onClick }: CharacterProps) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <group 
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = 'default'; }}
    >
      {/* الجسم */}
      <mesh position={[0, 1, 0]} castShadow>
        <capsuleGeometry args={[0.3, 1, 8, 16]} />
        <meshStandardMaterial 
          color={hovered ? new THREE.Color(bodyColor).multiplyScalar(1.3) : bodyColor}
          emissive={hovered ? bodyColor : '#000000'}
          emissiveIntensity={hovered ? 0.3 : 0}
        />
      </mesh>
      
      {/* الرأس */}
      <mesh position={[0, 1.9, 0]} castShadow>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial color="#ffdbac" />
      </mesh>
      
      {/* العيون */}
      <mesh position={[0.1, 2, 0.2]} castShadow>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#000000" />
      </mesh>
      <mesh position={[-0.1, 2, 0.2]} castShadow>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#000000" />
      </mesh>
      
      {/* الذراعين */}
      <mesh position={[0.4, 1.2, 0]} rotation={[0, 0, 0.3]} castShadow>
        <capsuleGeometry args={[0.1, 0.6, 8, 16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh position={[-0.4, 1.2, 0]} rotation={[0, 0, -0.3]} castShadow>
        <capsuleGeometry args={[0.1, 0.6, 8, 16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      
      {/* القدمين */}
      <mesh position={[0.15, 0.3, 0]} castShadow>
        <capsuleGeometry args={[0.12, 0.6, 8, 16]} />
        <meshStandardMaterial color="#654321" />
      </mesh>
      <mesh position={[-0.15, 0.3, 0]} castShadow>
        <capsuleGeometry args={[0.12, 0.6, 8, 16]} />
        <meshStandardMaterial color="#654321" />
      </mesh>
      
      {/* الاسم والتسمية التوضيحية الطافية */}
      <Text
        position={[0, 2.7, 0]}
        fontSize={0.25}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.03}
        outlineColor="#000000"
      >
        {label}
      </Text>
      
      {/* أيقونة الحوار عند التحويم */}
      {hovered && (
        <Html position={[0, 3.3, 0]} center>
          <div className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold shadow-2xl text-sm whitespace-nowrap animate-pulse flex items-center gap-2">
            <span className="text-xl">🔍</span>
            <span>انقر لرؤية المعلومات</span>
          </div>
        </Html>
      )}
    </group>
  );
}

// مكتب تفاعلي
function InteractiveDesk({ onClick, color }: { onClick?: () => void; color: string }) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <group 
      position={[-5, 0.75, 0]} 
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* سطح المكتب */}
      <mesh castShadow>
        <boxGeometry args={[3, 0.1, 1.5]} />
        <meshStandardMaterial 
          color={hovered ? '#8b4513' : '#654321'} 
          emissive={hovered ? '#ff6600' : '#000000'}
          emissiveIntensity={hovered ? 0.4 : 0}
        />
      </mesh>
      {/* الأرجل */}
      <mesh position={[-1.2, -0.5, 0.6]} castShadow>
        <boxGeometry args={[0.1, 1, 0.1]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      <mesh position={[1.2, -0.5, 0.6]} castShadow>
        <boxGeometry args={[0.1, 1, 0.1]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      <mesh position={[-1.2, -0.5, -0.6]} castShadow>
        <boxGeometry args={[0.1, 1, 0.1]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      <mesh position={[1.2, -0.5, -0.6]} castShadow>
        <boxGeometry args={[0.1, 1, 0.1]} />
        <meshStandardMaterial color="#4a3728" />
      </mesh>
      {hovered && (
        <Html position={[0, 1.5, 0]} center>
          <div className="bg-green-500 text-white px-4 py-2 rounded-full font-bold shadow-xl text-sm whitespace-nowrap">
            📋 انقر للبحث عن الشركات
          </div>
        </Html>
      )}
    </group>
  );
}

// لوحة بيضاء تفاعلية
function InteractiveBoard({ onClick }: { onClick?: () => void }) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <group 
      position={[0, 2, -8]} 
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <mesh castShadow>
        <boxGeometry args={[6, 3, 0.1]} />
        <meshStandardMaterial 
          color={hovered ? '#f0f0f0' : '#ffffff'} 
          emissive={hovered ? '#4444ff' : '#000000'}
          emissiveIntensity={hovered ? 0.3 : 0}
        />
      </mesh>
      {hovered && (
        <Html position={[0, 2, 0]} center>
          <div className="bg-blue-500 text-white px-4 py-2 rounded-full font-bold shadow-xl text-sm whitespace-nowrap">
            📊 انقر لتحليل PESTLE
          </div>
        </Html>
      )}
    </group>
  );
}

// كمبيوتر تفاعلي
function InteractiveComputer({ onClick }: { onClick?: () => void }) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <group 
      position={[5, 1, 0]} 
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* الشاشة */}
      <mesh position={[0, 0.5, 0]} castShadow>
        <boxGeometry args={[1.5, 1, 0.05]} />
        <meshStandardMaterial color={hovered ? '#1a1a2e' : '#0f0f1e'} emissive={hovered ? '#00ff00' : '#001100'} emissiveIntensity={0.3} />
      </mesh>
      {/* القاعدة */}
      <mesh position={[0, 0, 0.2]} castShadow>
        <boxGeometry args={[0.3, 0.5, 0.3]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      {hovered && (
        <Html position={[0, 1.8, 0]} center>
          <div className="bg-purple-500 text-white px-4 py-2 rounded-full font-bold shadow-xl text-sm whitespace-nowrap">
            💻 انقر لكتابة التقرير
          </div>
        </Html>
      )}
    </group>
  );
}

// شجرة إجرائية (Procedural Tree)
function Tree({ position }: { position: [number, number, number] }) {
  const trunkHeight = Math.random() * 1.5 + 2; // 2-3.5m
  const crownSize = Math.random() * 0.8 + 1.2; // 1.2-2m
  
  return (
    <group position={position}>
      {/* الجذع */}
      <mesh position={[0, trunkHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[0.15, 0.2, trunkHeight, 8]} />
        <meshStandardMaterial color="#3d2817" />
      </mesh>
      {/* التاج (3 طبقات) */}
      <mesh position={[0, trunkHeight + crownSize * 0.3, 0]} castShadow>
        <coneGeometry args={[crownSize, crownSize * 1.5, 8]} />
        <meshStandardMaterial color="#228b22" />
      </mesh>
      <mesh position={[0, trunkHeight + crownSize * 0.7, 0]} castShadow>
        <coneGeometry args={[crownSize * 0.7, crownSize * 1.2, 8]} />
        <meshStandardMaterial color="#2a9d2a" />
      </mesh>
      <mesh position={[0, trunkHeight + crownSize * 1.1, 0]} castShadow>
        <coneGeometry args={[crownSize * 0.5, crownSize * 0.9, 8]} />
        <meshStandardMaterial color="#32cd32" />
      </mesh>
    </group>
  );
}

// مجموعة الأشجار العشوائية
function TreeCluster() {
  const trees = useMemo(() => {
    const positions: [number, number, number][] = [];
    for (let i = 0; i < 30; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * 15 + 10; // 10-25m من المركز
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      // تجنب وضع الأشجار فوق المكتب أو اللوحة
      if (Math.abs(x + 5) > 2 || Math.abs(z) > 2) {
        positions.push([x, 0, z]);
      }
    }
    return positions;
  }, []);

  return (
    <>
      {trees.map((pos, i) => (
        <Tree key={i} position={pos} />
      ))}
    </>
  );
}

// حقول القمح التفاعلية
function WheatField() {
  const [hovered, setHovered] = useState(false);
  const wheat = useMemo(() => {
    const positions: [number, number, number][] = [];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 15; col++) {
        positions.push([
          -20 + col * 1.2,
          0.3,
          -15 + row * 1.2
        ]);
      }
    }
    return positions;
  }, []);

  return (
    <group
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); }}
    >
      {wheat.map((pos, i) => (
        <mesh key={i} position={pos} castShadow>
          <boxGeometry args={[0.8, 0.6, 0.8]} />
          <meshStandardMaterial 
            color={hovered ? "#ffd700" : "#daa520"}
            emissive={hovered ? "#ff8c00" : "#000000"}
            emissiveIntensity={hovered ? 0.3 : 0}
          />
        </mesh>
      ))}
      {hovered && (
        <Html position={[-12, 2, -10]} center>
          <div className="bg-yellow-600 text-white px-4 py-3 rounded-xl font-bold shadow-2xl max-w-xs">
            <div className="text-2xl mb-2">🔍 محاصيل القمح</div>
            <p className="text-sm">قمح عضوي يتطلب عمالة مكثفة • تكلفة عالية • جودة ممتازة</p>
          </div>
        </Html>
      )}
    </group>
  );
}

// حظيرة تفاعلية (Barn)
function Barn({ onClick }: { onClick?: () => void }) {
  const [hovered, setHovered] = useState(false);
  
  return (
    <group 
      position={[15, 0, -20]}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = 'default'; }}
    >
      {/* الجدران */}
      <mesh position={[0, 2.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[8, 5, 6]} />
        <meshStandardMaterial 
          color={hovered ? "#a52a2a" : "#8b0000"}
          emissive={hovered ? "#ff0000" : "#000000"}
          emissiveIntensity={hovered ? 0.2 : 0}
        />
      </mesh>
      {/* السقف */}
      <mesh position={[0, 5.5, 0]} castShadow>
        <coneGeometry args={[6, 2.5, 4]} />
        <meshStandardMaterial color="#654321" />
      </mesh>
      {/* الباب */}
      <mesh position={[0, 1.5, 3.05]} castShadow>
        <boxGeometry args={[2, 3, 0.1]} />
        <meshStandardMaterial color="#3d2817" />
      </mesh>
      {/* النوافذ */}
      <mesh position={[2.5, 3, 3.05]} castShadow>
        <boxGeometry args={[1, 1, 0.1]} />
        <meshStandardMaterial color="#87ceeb" opacity={0.6} transparent />
      </mesh>
      <mesh position={[-2.5, 3, 3.05]} castShadow>
        <boxGeometry args={[1, 1, 0.1]} />
        <meshStandardMaterial color="#87ceeb" opacity={0.6} transparent />
      </mesh>
      
      {/* التسمية التوضيحية */}
      <Text
        position={[0, 6.5, 0]}
        fontSize={0.6}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="#000000"
      >
        🏚️ الحظيرة
      </Text>
      
      {/* معلومات عند التحويم */}
      {hovered && (
        <Html position={[0, 7.5, 0]} center>
          <div className="bg-red-700 text-white px-4 py-3 rounded-xl font-bold shadow-2xl max-w-sm">
            <div className="text-2xl mb-2 flex items-center gap-2">
              <span>🔍</span>
              <span>معلومات المزرعة</span>
            </div>
            <p className="text-sm leading-relaxed">
              حظيرة تخزين تقليدية • مساحة 48 متر² • تستخدم لتخزين المعدات والعلف
            </p>
          </div>
        </Html>
      )}
    </group>
  );
}

export default function BTECEngine({ config, onStartTask, onDeskClick, onBoardClick, onComputerClick, onCharacterClick }: BTECEngineProps) {
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // تحديد نوع البيئة بناءً على الوحدة
  const isAgriculturalUnit = config?.scenario === 'agricultural' || config?.id === 'unit-1';
  
  const handleCharacterInteraction = (characterName: string, companyData?: InfoCardData) => {
    if (onCharacterClick) {
      onCharacterClick(characterName, companyData);
    } else {
      alert(`مرحباً! أنا ${characterName}. كيف يمكنني مساعدتك؟`);
    }
  };
  
  const handleContextLost = useCallback((e: Event) => {
    try { e.preventDefault(); } catch {}
    console.warn('WebGL context lost — attempting to recover');
  }, []);

  const handleContextRestored = useCallback(() => {
    console.info('WebGL context restored');
  }, []);

  useEffect(() => {
    return () => {
      const c = canvasElRef.current;
      if (c) {
        try {
          c.removeEventListener('webglcontextlost', handleContextLost as EventListener);
          c.removeEventListener('webglcontextrestored', handleContextRestored as EventListener);
        } catch {}
      }
    };
  }, [handleContextLost, handleContextRestored]);

  return (
    <div className="absolute inset-0 z-0 bg-black" style={{ touchAction: 'none' }}>
      <Canvas
        shadows
        frameloop="always"
        onCreated={({ gl, scene }) => {
          const canvas = gl.domElement as HTMLCanvasElement;
          canvasElRef.current = canvas;
          gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
          canvas.addEventListener('webglcontextlost', handleContextLost, false);
          canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
          
          // إضافة ضباب للوحدة الزراعية
          if (isAgriculturalUnit) {
            scene.fog = new THREE.Fog('#e8f5e9', 30, 80);
            scene.background = new THREE.Color('#c8e6c9'); // سماء خضراء فاتحة
          }
        }}
      >
        <PerspectiveCamera makeDefault position={[0, 5, 12]} />
        <OrbitControls enableDamping maxPolarAngle={Math.PI / 2.1} enableZoom={false} />
        
        {/* السماء والبيئة للوحدة الزراعية */}
        {isAgriculturalUnit && (
          <>
            <Sky sunPosition={[100, 20, 100]} />
            <Environment preset="park" />
          </>
        )}
        
        {!isAgriculturalUnit && (
          <>
            <Stars radius={80} depth={30} count={2000} factor={3} />
            <Environment preset="city" />
          </>
        )}
        
        {/* إضاءة سياقية: البيئة الزراعية تحتاج ضوء شمس قوي ومباشر */}
        {isAgriculturalUnit ? (
          <>
            <ambientLight intensity={0.8} color="#fff8dc" />
            <directionalLight position={[10, 15, 5]} intensity={1.2} castShadow color="#ffd700" />
            <hemisphereLight intensity={0.5} groundColor="#8b4513" color="#87ceeb" />
          </>
        ) : (
          <>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 10, 5]} intensity={0.8} castShadow />
          </>
        )}
        
        {/* الأرضية */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial 
            color={isAgriculturalUnit ? "#3da849" : "#1a1a1a"} 
            roughness={0.9}
          />
        </mesh>

        {/* عناصر المزرعة (للوحدة الزراعية فقط) */}
        {isAgriculturalUnit && (
          <>
            <TreeCluster />
            <WheatField />
            <Barn onClick={() => handleCharacterInteraction('Barn')} />
            
            {/* الشخصيات NPCs مع بيانات الشركات */}
            <Character 
              name="Victoria"
              label="Victoria - Green Valley Owner"
              position={[-7, 0, 2]}
              bodyColor="#da70d6"
              onClick={() => handleCharacterInteraction('Victoria', {
                title: "مالكة مزرعة الوادي الأخضر",
                company: "Green Valley Family Farm",
                ownership: "ملكية عائلية خاصة (Partnership)",
                scope: "محلي (نطاق 10 كم)",
                size: "صغير - 8 موظفين - £120,000 سنوياً",
                details: [
                  "✓ منتجات عضوية عالية الجودة",
                  "✓ علاقات قوية مع المجتمع المحلي",
                  "✓ تكاليف تشغيل منخفضة"
                ],
                role: "Owner & Farm Manager"
              })}
            />
            <Character 
              name="Stefan"
              label="Stefan - Finance Partner"
              position={[-15, 0, -10]}
              bodyColor="#4169e1"
              onClick={() => handleCharacterInteraction('Stefan', {
                title: "شريك مالي - خبير العمليات",
                company: "Green Valley Family Farm",
                ownership: "شراكة مالية",
                scope: "محلي (نطاق 10 كم)",
                size: "صغير - 8 موظفين",
                details: [
                  "📊 مسؤول عن التخطيط المالي",
                  "📈 تحليل الأرقام والكفاءة",
                  "💰 إدارة الميزانية والاستثمار"
                ],
                role: "Finance & Operations"
              })}
            />
            <Character 
              name="Farm Worker"
              label="Ahmed - Field Worker"
              position={[18, 0, -18]}
              bodyColor="#ff8c00"
              onClick={() => handleCharacterInteraction('Farm Worker', {
                title: "عامل حقل - فريق الإنتاج",
                company: "Green Valley Family Farm",
                ownership: "موظف",
                scope: "محلي",
                size: "جزء من فريق 8 موظفين",
                details: [
                  "🌱 مسؤول عن الزراعة والحصاد",
                  "💧 إدارة الري والصيانة",
                  "🛠️ صيانة المعدات الزراعية"
                ],
                role: "Field Operations"
              })}
            />
          </>
        )}

        {/* العناصر التفاعلية */}
        <InteractiveDesk onClick={onDeskClick || onStartTask} color={config.color} />
        <InteractiveBoard onClick={onBoardClick} />
        <InteractiveComputer onClick={onComputerClick} />

        {/* عنوان الوحدة */}
        <Html transform position={[0, 6, -6]} distanceFactor={8}>
          <div className="bg-gradient-to-br from-slate-900 to-green-900 p-8 border-4 border-green-500 rounded-2xl text-center shadow-2xl" style={{ width: '700px' }}>
            <h1 className="text-5xl font-black text-white uppercase italic mb-2">{config.title}</h1>
            {config.subtitle && (
              <p className="text-lg text-green-400 font-semibold">{config.subtitle}</p>
            )}
          </div>
        </Html>
      </Canvas>
    </div>
  );
}
