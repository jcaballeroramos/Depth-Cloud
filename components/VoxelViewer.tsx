import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import { ProcessedPointCloud, HandGestures } from '../types';

interface VoxelObjectProps {
  data: ProcessedPointCloud;
  gestureRef: React.MutableRefObject<HandGestures>;
  depthExaggeration: number;
  autoRotate: boolean;
  voxelSize: number;
}

const VoxelObject: React.FC<VoxelObjectProps> = ({ 
  data, 
  gestureRef, 
  depthExaggeration,
  autoRotate,
  voxelSize
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const rotVelocity = useRef({ x: 0, y: 0 });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  const shaderRef = useRef<THREE.Shader>(null);
  const currentExplosion = useRef(0);

  // Initialize Voxels
  useEffect(() => {
    if (!meshRef.current) return;

    const count = data.count;
    meshRef.current.count = count;

    for (let i = 0; i < count; i++) {
        const x = data.positions[i * 3];
        const y = data.positions[i * 3 + 1];
        const z = data.positions[i * 3 + 2] * depthExaggeration;

        const r = data.colors[i * 3];
        const g = data.colors[i * 3 + 1];
        const b = data.colors[i * 3 + 2];

        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        meshRef.current.setColorAt(i, new THREE.Color(r, g, b));
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;

  }, [data, depthExaggeration]); 

  const customMaterial = useMemo(() => {
    // Shinier material for "Lego" aesthetic that catches light better
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.2, 
      metalness: 0.1,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uExplosion = { value: 0 };
      shader.uniforms.uTime = { value: 0 };

      shader.vertexShader = `
        uniform float uExplosion;
        uniform float uTime;
        
        float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }
        
        mat3 rotateY(float angle) {
            float s = sin(angle);
            float c = cos(angle);
            return mat3(c, 0, s, 0, 1, 0, -s, 0, c);
        }
        mat3 rotateX(float angle) {
            float s = sin(angle);
            float c = cos(angle);
            return mat3(1, 0, 0, 0, c, -s, 0, s, c);
        }
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        if (uExplosion > 0.0) {
            vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float rnd = random(instancePos.xy);
            vec3 dir = normalize(instancePos);
            dir.x += (random(instancePos.yz) - 0.5) * 0.5;
            dir.y += (random(instancePos.xz) - 0.5) * 0.5;
            vec3 offset = dir * uExplosion * 50.0;
            transformed += offset;
            float angle = uExplosion * 10.0 * rnd;
            transformed = rotateY(angle) * rotateX(angle * 0.5) * transformed;
        }
        `
      );
      shaderRef.current = shader;
    };

    return mat;
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const gestures = gestureRef.current;
    
    if (shaderRef.current) {
        if (gestures.isExploding) {
            currentExplosion.current += delta * 1.5;
        } else {
            currentExplosion.current = THREE.MathUtils.lerp(currentExplosion.current, 0, delta * 3.0);
        }
        shaderRef.current.uniforms.uExplosion.value = currentExplosion.current;
        shaderRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }

    const damping = 1.0 - Math.exp(-10.0 * delta);
    const currentScale = groupRef.current.scale.x; 
    const scaleFactor = 15 / Math.max(data.width, 1); 
    let targetBaseScale = scaleFactor * (gestures.scale || 1.0);
    const newBaseScale = THREE.MathUtils.lerp(currentScale, targetBaseScale, damping * 2.0);
    
    groupRef.current.scale.set(newBaseScale, newBaseScale, newBaseScale);

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

  return (
    <Center>
      <group ref={groupRef}>
        <instancedMesh 
            ref={meshRef} 
            args={[undefined, undefined, data.count]} 
            castShadow 
            receiveShadow 
            material={customMaterial}
        >
            <boxGeometry args={[0.92, 0.92, 0.92]} />
        </instancedMesh>
      </group>
    </Center>
  );
};

interface VoxelViewerProps {
  data: ProcessedPointCloud | null;
  gestureRef: React.MutableRefObject<HandGestures>;
  resetTrigger: number;
  depthExaggeration: number;
  autoRotate: boolean;
  voxelDensity: number; 
}

const VoxelViewer: React.FC<VoxelViewerProps> = (props) => {
  if (!props.data) return null;

  return (
    <Canvas 
      shadows 
      camera={{ position: [0, 0, 80], fov: 50 }} 
      dpr={[1, 1.5]}
      gl={{ 
        toneMapping: THREE.ACESFilmicToneMapping, 
        toneMappingExposure: 1.2,
        antialias: true 
      }}
    >
      <color attach="background" args={['#08080c']} />
      
      {/* --- STUDIO LIGHTING SETUP --- */}
      
      {/* 1. Ambient: Soft fill for shadows */}
      <ambientLight intensity={0.4} color="#ccccff" />
      
      {/* 2. Key Light: Main source, strong shadows, warm */}
      <directionalLight 
        position={[30, 50, 25]} 
        intensity={2.2} 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0001}
        color="#fffaee"
      />
      
      {/* 3. Fill Light: From opposite side, cooler, softer, no shadows */}
      <directionalLight 
        position={[-30, 20, 10]} 
        intensity={0.8} 
        color="#cceeff" 
      />
      
      {/* 4. Rim Light: Back light to highlight edges, strong intensity */}
      <spotLight 
        position={[0, 40, -50]} 
        intensity={3.0} 
        angle={0.6} 
        penumbra={0.5} 
        color="#ffffff" 
      />

      <VoxelObject 
        data={props.data}
        gestureRef={props.gestureRef}
        depthExaggeration={props.depthExaggeration}
        autoRotate={props.autoRotate}
        voxelSize={1.0}
      />
      
      <OrbitControls makeDefault enableZoom={true} enablePan={true} rotateSpeed={0.5} zoomSpeed={0.7} />
    </Canvas>
  );
};

export default VoxelViewer;