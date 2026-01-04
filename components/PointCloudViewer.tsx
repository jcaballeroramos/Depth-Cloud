import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import { ProcessedPointCloud, HandGestures } from '../types';

interface PointCloudSceneProps {
  data: ProcessedPointCloud;
  gestureRef: React.MutableRefObject<HandGestures>;
  pointSize: number;
  resetTrigger: number;
  originalImage: string | null;
  showBackground: boolean;
  depthExaggeration: number;
  autoRotate: boolean;
}

const PointCloudShader = {
  vertexShader: `
    uniform float uSizeScale; 
    uniform float uTime;
    uniform float uExplosion; 
    
    varying vec3 vColor;
    varying float vAlpha;
    varying float vDepth;
    varying vec3 vWorldPos;

    // Pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main() {
      vColor = color;
      
      vec3 pos = position;

      // --- 1. EXPLOSION LOGIC (Expands outwards) ---
      if (uExplosion > 0.0) {
        float rnd = random(pos.xy + pos.z);
        // Direction away from center (0,0,0) plus random noise
        vec3 dir = normalize(pos) + vec3(sin(rnd * 10.0), cos(rnd * 15.0), sin(rnd * 5.0));
        
        // Move point outward continuously based on uniform
        pos += dir * uExplosion * 20.0;
        
        // Add tumble rotation during explosion
        float angle = uExplosion * 5.0 * (rnd - 0.5);
        float s = sin(angle); float c = cos(angle);
        float x = pos.x * c - pos.z * s;
        float z = pos.x * s + pos.z * c;
        pos.x = x; pos.z = z;
      }

      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      vWorldPos = pos;
      float depth = -mvPosition.z;
      vDepth = depth;

      // Prevent division by zero or negative
      float z = max(0.1, depth);
      
      // Dynamic Point Size based on distance
      gl_PointSize = clamp(uSizeScale / z, 1.0, 150.0);

      // Fog Logic - Linear fade
      // INCREASED DISTANCE to prevent "lights out" effect when zooming out
      float fogStart = 200.0;
      float fogEnd = 800.0; 
      vAlpha = 1.0 - clamp((depth - fogStart) / (fogEnd - fogStart), 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;
    varying float vDepth;
    varying vec3 vWorldPos;

    void main() {
      // 1. SOFT PARTICLE SHAPE
      vec2 coord = gl_PointCoord * 2.0 - 1.0; 
      float dist = length(coord);
      
      // Soft glow falloff
      float shapeAlpha = 1.0 - smoothstep(0.1, 1.0, dist); 

      if (dist > 1.0) discard;

      // 2. DEPTH TINT (Atmosphere)
      // Fade distant points slightly to blueish/dark to enhance 3D feel
      vec3 finalColor = vColor;
      float atmosphere = smoothstep(20.0, 60.0, vDepth);
      finalColor = mix(finalColor, vec3(0.05, 0.05, 0.1), atmosphere * 0.5);

      // Final Alpha Output
      gl_FragColor = vec4(finalColor, shapeAlpha * vAlpha * 0.95); 
    }
  `
};

// Background Image Plane Component
const BackgroundPlane = ({ imageSrc, visible, width, height, depthOffset }: { imageSrc: string, visible: boolean, width: number, height: number, depthOffset: number }) => {
  const texture = useLoader(THREE.TextureLoader, imageSrc);
  
  if (!visible) return null;

  return (
    <mesh position={[0, 0, depthOffset]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial 
        map={texture} 
        transparent 
        opacity={0.4} 
        depthWrite={false} 
        side={THREE.DoubleSide} 
      />
    </mesh>
  );
};

const PointCloudObject: React.FC<PointCloudSceneProps> = ({ 
  data, 
  gestureRef, 
  pointSize, 
  resetTrigger,
  originalImage,
  showBackground,
  depthExaggeration,
  autoRotate
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const controlsRef = useRef<any>(null); 
  const rotVelocity = useRef({ x: 0, y: 0 }); 
  
  // Animation State Refs
  const currentExplosion = useRef(0); 
  
  const pixelRatio = useThree((state) => state.viewport.dpr);
  const size = useThree((state) => state.size);
  const { camera } = useThree();

  // Reset Logic
  useEffect(() => {
    if (resetTrigger > 0) {
        if (groupRef.current) {
            groupRef.current.rotation.set(0, 0, 0);
            rotVelocity.current = { x: 0, y: 0 };
        }
        if (controlsRef.current) {
            controlsRef.current.reset();
        }
        // Also reset effects
        currentExplosion.current = 0;
    }
  }, [resetTrigger, camera]);

  // Handle Point Size Updates Imperatively
  useEffect(() => {
    if (materialRef.current) {
        materialRef.current.uniforms.uSizeScale.value = pointSize * pixelRatio * size.height * 0.5;
        materialRef.current.uniformsNeedUpdate = true;
    }
  }, [pointSize, pixelRatio, size.height]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    geo.computeBoundingSphere(); 
    return geo;
  }, [data]);

  const scaleFactor = useMemo(() => {
      const targetWidth = 20;
      return targetWidth / Math.max(data.width, 1);
  }, [data.width]);

  const backgroundZ = useMemo(() => {
      const depthScale = Math.max(data.width, data.height) * 0.5;
      return -(depthScale * 0.5) - 20; 
  }, [data.width, data.height]);


  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    // Update Shader Time
    if (materialRef.current) {
        materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
        
        const gestures = gestureRef.current;
        
        // --- EXPLOSION LOGIC (Accumulative) ---
        if (gestures.isExploding) {
            // While held, add to the explosion value so it expands infinitely
            currentExplosion.current += delta * 2.0; 
        } else {
            // When released, snap back elasticity
            currentExplosion.current = THREE.MathUtils.lerp(currentExplosion.current, 0.0, delta * 3.0);
        }
        materialRef.current.uniforms.uExplosion.value = currentExplosion.current;
    }

    const gestures = gestureRef.current;
    const damping = 1.0 - Math.exp(-10.0 * delta);

    const currentScale = groupRef.current.scale.x; 
    let targetBaseScale = scaleFactor * (gestures.scale || 1.2);
    const newBaseScale = THREE.MathUtils.lerp(currentScale, targetBaseScale, damping * 2.0);
    
    groupRef.current.scale.set(newBaseScale, newBaseScale, newBaseScale * depthExaggeration);

    if (gestures.isTracking) {
        rotVelocity.current.y = THREE.MathUtils.lerp(rotVelocity.current.y, gestures.rotation.y, damping);
        rotVelocity.current.x = THREE.MathUtils.lerp(rotVelocity.current.x, gestures.rotation.x, damping);

        groupRef.current.rotation.y += rotVelocity.current.y * delta * 15.0;
        groupRef.current.rotation.x += rotVelocity.current.x * delta * 15.0;
    } else {
        rotVelocity.current.x = THREE.MathUtils.lerp(rotVelocity.current.x, 0, damping);
        
        const targetRotY = autoRotate ? 0.2 : 0;
        rotVelocity.current.y = THREE.MathUtils.lerp(rotVelocity.current.y, targetRotY, damping * 0.5);
        
        groupRef.current.rotation.y += (rotVelocity.current.y) * delta;
        groupRef.current.rotation.x += rotVelocity.current.x * delta;
    }
  });

  const uniforms = useMemo(() => ({
    uSizeScale: { value: pointSize * pixelRatio * size.height * 0.5 },
    uTime: { value: 0 },
    uExplosion: { value: 0 },
  }), []); 

  return (
    <Center>
      <group ref={groupRef}>
        <points geometry={geometry}>
          <shaderMaterial
            ref={materialRef}
            attach="material"
            vertexShader={PointCloudShader.vertexShader}
            fragmentShader={PointCloudShader.fragmentShader}
            transparent={true}
            depthWrite={true}
            blending={THREE.AdditiveBlending} 
            vertexColors={true}
            uniforms={uniforms}
          />
        </points>

        {originalImage && (
            <React.Suspense fallback={null}>
                <BackgroundPlane 
                    imageSrc={originalImage} 
                    visible={showBackground} 
                    width={data.width}
                    height={data.height}
                    depthOffset={backgroundZ}
                />
            </React.Suspense>
        )}
      </group>
      
       <OrbitControls 
          ref={controlsRef}
          makeDefault 
          enableZoom={true} 
          enablePan={true} 
          rotateSpeed={0.5}
          zoomSpeed={0.7}
        />
    </Center>
  );
};

interface PointCloudViewerProps {
  data: ProcessedPointCloud | null;
  gestureRef: React.MutableRefObject<HandGestures>;
  pointSize: number;
  resetTrigger: number;
  originalImage: string | null;
  showBackground: boolean;
  depthExaggeration: number;
  autoRotate: boolean;
}

const PointCloudViewer: React.FC<PointCloudViewerProps> = (props) => {
  if (!props.data) return null;

  return (
    <Canvas camera={{ position: [0, 0, 100], fov: 60 }} dpr={typeof window !== 'undefined' ? window.devicePixelRatio : 1}>
      <color attach="background" args={['#000000']} />
      <PointCloudObject {...props} data={props.data} />
    </Canvas>
  );
};

export default PointCloudViewer;