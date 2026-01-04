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
    
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      vColor = color;
      
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      float depth = -mvPosition.z;
      // Prevent division by zero or negative
      float z = max(0.1, depth);
      
      // Dynamic Point Size based on distance
      gl_PointSize = clamp(uSizeScale / z, 1.0, 100.0);

      // Fog Logic - Linear fade
      float fogStart = 20.0;
      float fogEnd = 80.0;
      vAlpha = 1.0 - clamp((depth - fogStart) / (fogEnd - fogStart), 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      // gl_PointCoord is 0.0 to 1.0
      vec2 coord = gl_PointCoord * 2.0 - 1.0; // Map to -1..1
      float distSq = dot(coord, coord);

      if (distSq >= 1.0) discard;

      // Improved Interpolation:
      float shapeAlpha = pow(1.0 - distSq, 2.0);

      // Combine with vertex alpha (fog) and apply a slight global transparency 
      gl_FragColor = vec4(vColor, shapeAlpha * vAlpha * 0.95); 
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
    }
  }, [resetTrigger, camera]);

  // Handle Point Size Updates Imperatively
  useEffect(() => {
    if (materialRef.current) {
        // Adjust for the normalized scale (approx 20 units height)
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

  // Calculate scaling factor to normalize the object size in the view
  // Target width ~ 20 world units
  const scaleFactor = useMemo(() => {
      const targetWidth = 20;
      return targetWidth / Math.max(data.width, 1);
  }, [data.width]);

  // Calculate Background Depth
  const backgroundZ = useMemo(() => {
      const depthScale = Math.max(data.width, data.height) * 0.5;
      return -(depthScale * 0.5) - 20; // Place it slightly behind the furthest point
  }, [data.width, data.height]);


  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const gestures = gestureRef.current;
    const damping = 1.0 - Math.exp(-10.0 * delta);

    // Apply scale dynamically including depth exaggeration on Z axis
    const currentScale = groupRef.current.scale.x; // Use X as base since X/Y are uniform
    
    // Determine Target Base Scale (Gesture vs Default)
    let targetBaseScale = scaleFactor * (gestures.scale || 1.2);
    
    // Smooth Scale Transition
    const newBaseScale = THREE.MathUtils.lerp(currentScale, targetBaseScale, damping * 2.0);
    
    // Apply: X/Y = Base, Z = Base * Exaggeration
    groupRef.current.scale.set(newBaseScale, newBaseScale, newBaseScale * depthExaggeration);

    // Rotation Logic
    if (gestures.isTracking) {
      rotVelocity.current.y = THREE.MathUtils.lerp(rotVelocity.current.y, gestures.rotation.y, damping);
      rotVelocity.current.x = THREE.MathUtils.lerp(rotVelocity.current.x, gestures.rotation.x, damping);

      groupRef.current.rotation.y += rotVelocity.current.y * delta * 15.0;
      groupRef.current.rotation.x += rotVelocity.current.x * delta * 15.0;

    } else {
        // Idle / Auto Rotate
        rotVelocity.current.x = THREE.MathUtils.lerp(rotVelocity.current.x, 0, damping);
        
        // If AutoRotate is ON, maintain a constant spin, otherwise dampen to 0
        const targetRotY = autoRotate ? 0.2 : 0;
        rotVelocity.current.y = THREE.MathUtils.lerp(rotVelocity.current.y, targetRotY, damping * 0.5);
        
        groupRef.current.rotation.y += (rotVelocity.current.y) * delta;
        groupRef.current.rotation.x += rotVelocity.current.x * delta;
    }
  });

  const uniforms = useMemo(() => ({
    uSizeScale: { value: pointSize * pixelRatio * size.height * 0.5 },
  }), []); 

  return (
    <Center>
      <group ref={groupRef}>
        
        {/* Points */}
        <points geometry={geometry}>
          <shaderMaterial
            ref={materialRef}
            attach="material"
            vertexShader={PointCloudShader.vertexShader}
            fragmentShader={PointCloudShader.fragmentShader}
            transparent={true}
            depthWrite={true}
            blending={THREE.NormalBlending} 
            vertexColors={true}
            uniforms={uniforms}
          />
        </points>

        {/* Background Image Plane attached to the group */}
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

interface ViewerProps {
  data: ProcessedPointCloud | null;
  gestureRef: React.MutableRefObject<HandGestures>;
  pointSize: number;
  resetTrigger?: number; 
  originalImage?: string | null;
  showBackground?: boolean;
  depthExaggeration?: number;
  autoRotate?: boolean;
}

const PointCloudViewer: React.FC<ViewerProps> = ({ 
  data, 
  gestureRef, 
  pointSize, 
  resetTrigger = 0,
  originalImage = null,
  showBackground = false,
  depthExaggeration = 1.0,
  autoRotate = false
}) => {
  return (
    <div className="w-full h-full bg-slate-900 shadow-inner">
      <Canvas 
        camera={{ position: [0, 0, 35], fov: 50 }}
        dpr={Math.min(2, window.devicePixelRatio)} 
        gl={{ 
          antialias: false,
          powerPreference: "high-performance",
          alpha: false,
          stencil: false,
          depth: true
        }}
      >
        <color attach="background" args={['#050505']} />
        
        {data ? (
          <PointCloudObject 
            data={data} 
            gestureRef={gestureRef} 
            pointSize={pointSize} 
            resetTrigger={resetTrigger}
            originalImage={originalImage}
            showBackground={showBackground}
            depthExaggeration={depthExaggeration}
            autoRotate={autoRotate}
          />
        ) : (
          <mesh>
             <gridHelper args={[20, 20, 0x222222, 0x111111]} />
          </mesh>
        )}
        
        {!data && <OrbitControls makeDefault />}

      </Canvas>
    </div>
  );
};

export default PointCloudViewer;