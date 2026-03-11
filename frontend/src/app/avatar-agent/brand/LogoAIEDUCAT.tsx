'use client';
/**
 * LogoAIEDUCAT.tsx — 3-D or flat brand logo for the classroom scene.
 *
 * Renders "AI-EDUCAT" (or any `text` prop) using either:
 *  - Text3D (drei) — extruded 3-D with bevel, needs a typeface JSON font
 *  - Text  (drei)  — billboard / flat text, needs a TTF font
 *
 * A gold-to-silver metallic gradient is applied via onBeforeCompile.
 *
 * Props:
 *   mount      — "wall" (default) positions the logo on the back glass wall;
 *                "floating" hovers it above the desk area.
 *   useText3D  — true = extruded Text3D; false = flat Text.
 *   fontUrl3D  — path to a Three.js typeface JSON (default: Helvetiker).
 *   fontUrlTTF — path to a TTF font for flat Text (default: Inter Bold).
 */
import React, { useMemo, useRef } from 'react';
import { Text3D, Center, Text } from '@react-three/drei';
import { Color, Euler, Mesh, MeshStandardMaterial } from 'three';

type LogoProps = {
  text?:       string;
  mount?:      'wall' | 'floating';
  position?:   [number, number, number];
  rotation?:   [number, number, number];
  useText3D?:  boolean;
  fontUrl3D?:  string;
  fontUrlTTF?: string;
  size?:       number;
  depth?:      number;
};

export const LogoAIEDUCAT = ({
  text       = 'AI-EDUCAT',
  mount      = 'wall',
  position,
  rotation,
  useText3D  = true,
  fontUrl3D  = '/fonts/helvetiker_regular.typeface.json',
  fontUrlTTF = '/fonts/Inter-Bold.ttf',
  size       = 0.35,
  depth      = 0.08,
}: LogoProps) => {
  const meshRef = useRef<Mesh>(null);

  // Default mount positions — wall: on back glass at z≈+depth/2;
  // floating: hovering over desk area.
  const defaultWallPosition:     [number, number, number] = [0, 1.8,  2.48];
  const defaultFloatingPosition: [number, number, number] = [0, 2.1,  0.9];

  const finalPosition = position ?? (mount === 'wall' ? defaultWallPosition : defaultFloatingPosition);
  const finalRotation = rotation ?? [0, 0, 0];

  // Memoised material with gold→silver gradient via onBeforeCompile.
  // Creating materials inside render without useMemo causes a new GPU shader
  // compilation on every re-render/React reconcile.
  const material = useMemo(() => {
    const mat = new MeshStandardMaterial({
      color:            new Color('#cccccc'),
      metalness:        0.9,
      roughness:        0.2,
      envMapIntensity:  0.6,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.gradientColor1 = { value: new Color('#ffd700') }; // Gold
      shader.uniforms.gradientColor2 = { value: new Color('#c0c0c0') }; // Silver
      shader.fragmentShader = `
        uniform vec3 gradientColor1;
        uniform vec3 gradientColor2;
        ${shader.fragmentShader}
      `.replace(
        '#include <dithering_fragment>',
        `
        vec2 uv = vUv;
        vec3 gradient = mix(gradientColor1, gradientColor2, uv.y);
        gl_FragColor.rgb *= gradient;
        #include <dithering_fragment>
        `,
      );
    };
    return mat;
  }, []);

  return (
    <group position={finalPosition} rotation={new Euler(...finalRotation)}>
      <Center>
        {useText3D ? (
          <Text3D
            ref={meshRef}
            font={fontUrl3D}
            size={size}
            height={depth}
            curveSegments={12}
            bevelEnabled
            bevelThickness={0.01}
            bevelSize={0.01}
            material={material}
          >
            {text}
          </Text3D>
        ) : (
          <Text
            ref={meshRef}
            font={fontUrlTTF}
            fontSize={size}
            material={material}
            anchorX="center"
            anchorY="middle"
          >
            {text}
          </Text>
        )}
      </Center>
    </group>
  );
};
