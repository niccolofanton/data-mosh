import { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { setupMobileScrollPrevention } from '@/components/utils/eventUtils';
import { setupVisibilityChangeDetection } from '@/components/utils/eventUtils';
import { PerformanceMonitor } from '@react-three/drei';
import { Perf } from 'r3f-perf';
import { BackroomModel } from './backroom-model';
import { DataMoshingPostProcessing } from '../data-moshing/post-processing';
import { CameraController, MorphingShape } from '../data-moshing/data-moshing-scene';
import { Leva } from 'leva';

export const OfficeScene2 = () => {
  // State for performance monitoring
  const [showPerf] = useState(false);
  const [frameloop, setFrameloop] = useState<'always' | 'never'>('always');

  // Reference to the point light for animation
  const lightRef = useRef<THREE.PointLight>(null);

  // Handle visibility change to pause rendering when tab is not visible
  useEffect(() => {
    const cleanup = setupVisibilityChangeDetection((isVisible) => {
      setFrameloop(isVisible ? 'always' : 'never');
    });

    return cleanup;
  }, []);

  // Prevent scrolling on mobile devices
  useEffect(() => {
    const cleanup = setupMobileScrollPrevention();
    return cleanup;
  }, []);

  return (
    <>
      <Leva hidden={false} />

      <Canvas
        flat
        className='select-none'
        dpr={1}
        frameloop={frameloop}

        camera={{
          position: [0, 2, 2],
          near: .1,
          far: 50,
          // zoom: 128,
        }}
        gl={{
          powerPreference: "high-performance",
          alpha: false,
          antialias: false,
          stencil: false,
          depth: false,
          outputColorSpace: THREE.SRGBColorSpace,
          // toneMapping: THREE.ACESFilmicToneMapping,
          preserveDrawingBuffer: true,
          logarithmicDepthBuffer: true,
        }}
        onCreated={state => {
          // Disable automatic rendering
          state.gl.autoClear = false;
        }}
      >
        {/* Performance monitor */}
        {showPerf && <Perf position='bottom-right' />}

        <color attach='background' args={['#262626']} />

        <BackroomModel position={[0, 0, 0]} />

        <CameraController></CameraController>

        <MorphingShape />

        {/* Performance monitoring */}
        <PerformanceMonitor
          flipflops={1}
          iterations={5}
          ms={100}
          threshold={.5}
          bounds={() => [30, 500]}
          onDecline={() => { }}
        />

        {/* Lighting */}
        <pointLight ref={lightRef} position={[0, 0, 5]} intensity={2000} distance={5.4} castShadow />

        <ambientLight intensity={1} />

        <DataMoshingPostProcessing />

      </Canvas>
    </>
  );
}; 