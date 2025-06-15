import { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { setupMobileScrollPrevention } from '@/components/utils/eventUtils';
import { setupVisibilityChangeDetection } from '@/components/utils/eventUtils';
import { PerformanceMonitor } from '@react-three/drei';
import { BackroomModel } from './backroom-model';
import { DataMoshingPostProcessing } from '../data-moshing/post-processing';
import { CameraController, MorphingShape } from '../data-moshing/data-moshing-scene';
import { folder, Leva, useControls } from 'leva';
import { Perf } from 'r3f-perf';

const DemoName = () => (
  <div style={{
    position: 'fixed',
    bottom: '16px',
    left: '32px',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: '20px',
    borderRadius: '12px',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 255, 255, 0.1)'
  }}>
    <div style={{
      fontSize: '28px',
      color: 'white',
      pointerEvents: 'none',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      marginBottom: '8px'
    }}>
      Data Moshing Effect
    </div>

    <div style={{
      fontSize: '14px',
      color: 'rgba(255, 255, 255, 0.8)',
      marginBottom: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      lineHeight: '1.4'
    }}>
      <div>🎮 <strong>WASD</strong> to move camera</div>
      <div>🖱️ <strong>Click</strong> or <strong>Spacebar</strong> to activate effect</div>
      <div>🖱️ <strong>Mouse</strong> to look around</div>
    </div>

    <div style={{
      fontSize: '14px',
      color: 'rgba(255, 255, 255, 0.7)',
      letterSpacing: '0.5px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontWeight: '400'
    }}>
      made by <span style={{ textDecoration: 'underline' }}>
        <a href="https://niccolofanton.dev" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255, 255, 255, 0.9)', textDecoration: 'underline' }}>niccolofanton</a>
      </span>

      {" • "}
      <a href="https://github.com/niccolofanton/image-trail-shader" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255, 255, 255, 0.9)', textDecoration: 'underline' }}>GitHub</a>
    </div>
  </div>
);

export const OfficeScene2 = () => {

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

  // Performance controls
  const { showPerf } = useControls({
    "⚡ Performance": folder({
      showPerf: { value: false, label: "Show Performance" },
    }, { collapsed: true }),
  });

  // Camera controls
  const { autoRotateCamera } = useControls({
    "📹 Camera": folder({
      autoRotateCamera: { value: false, label: "Auto Rotate Camera" },
    }, { collapsed: true }),
  });

  return (
    <>
      <Leva
        hidden={false}
        oneLineLabels={true}
        theme={{
          sizes: {
            rootWidth: '300px',
            controlWidth: '140px'
          },
          fontSizes: {
            root: '11px'
          },
          space: {
            rowGap: '6px'
          },
          fonts: {
            mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
            sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
          }
        }}
      />
      <DemoName />


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

        <color attach='background' args={['#262626']} />

        <BackroomModel position={[0, 0, 0]} />

        <CameraController autoRotate={autoRotateCamera}></CameraController>

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

        {showPerf && <Perf position="bottom-right" />}

      </Canvas>
    </>
  );
}; 