import { useState, useRef, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { setupMobileScrollPrevention } from '@/components/utils/eventUtils';
import { setupVisibilityChangeDetection } from '@/components/utils/eventUtils';
import { BackroomModel } from './backroom-model';
import { DataMoshingPostProcessing } from '../data-moshing/post-processing';
import {
  CameraController,
  CutScaledRoom,
  MorphingShape,
} from '../data-moshing/data-moshing-scene';
import { Dancer, OnlyIn, ShotStage } from '../data-moshing/shots';
import { Cloth } from '../data-moshing/cloth/cloth';
import { useControls } from '@/components/ui/controls';
import { Perf } from 'r3f-perf';

/**
 * Folder options for the shared control panel. These two folders are
 * diagnostics, so they sort after the effect's own folders (orders 10-30, see
 * `post-processing.tsx`) and start collapsed.
 */
const PERFORMANCE_FOLDER = { order: 40, collapsed: true } as const;
const CAMERA_FOLDER = { order: 50, collapsed: true } as const;

/**
 * Drawing buffer resolution: the display's own, capped at two.
 *
 * Given as a range rather than a number so r3f reads `devicePixelRatio` itself
 * and keeps up with it - it changes when a window is dragged between a laptop
 * screen and an external monitor, and a value sampled once at mount does not.
 *
 * This replaces a buffer pinned to 720p. Worth knowing what that gave up: the
 * camera being simulated records 720p, and a real recording is soft because it
 * was *captured* soft, so the softness belonged upstream of the noise, the
 * compression and the grade. It also meant the datamosh's macroblocks landed on
 * the grid of the recorded frame rather than on the grid of whatever monitor
 * happens to be showing it - at native resolution an 8 px block is a third of
 * the size on screen that it was, so the tiles read smaller and finer. The
 * Macroblock (px) control is the dial that compensates.
 */
const DPR_RANGE: [number, number] = [1, 2];

/** The shots the room's point light is wanted in. Module scope: stable identity. */
const LIT_SHOTS = ['room'] as const;

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
  const { showPerf } = useControls("⚡ Performance", {
    showPerf: { value: false, label: "Show Performance" },
  }, PERFORMANCE_FOLDER);

  // Camera controls
  const { autoRotateCamera } = useControls("📹 Camera", {
    autoRotateCamera: { value: false, label: "Auto Rotate Camera" },
  }, CAMERA_FOLDER);

  return (
    <>
      {/*
        The control panel needs no host element: it mounts itself as soon as the
        first `useControls` runs and tears itself down with the last one. Its
        sizing and typography live in `@/components/ui/controls`.
      */}
      <Canvas
        flat
        className='select-none'
        dpr={DPR_RANGE}
        frameloop={frameloop}

        camera={{
          position: [0, 2, 2],
          near: .1,
          // Set by the dancers' floor, not by the room. A plane cut off at the
          // far distance shows its edge as a hard line across the frame just
          // below the horizon; pushing the plane out far enough that the edge
          // lands on the horizon itself is what hides it. Near stays at 0.1, so
          // the depth precision is barely affected - it is the near plane that
          // governs it, not the far one.
          far: 200,
        }}
        // Depth convention of this pipeline: standard (hyperbolic) perspective
        // depth in [0, 1], as written by the default depth buffer. The datamosh
        // EffectPass declares EffectAttribute.DEPTH, so the composer attaches a
        // DepthTexture to its input buffer and hands it to the effect, whose
        // shader linearises it (readDepth / getViewZ) to drive the parallax of
        // the camera-only motion vectors. The encoding must therefore stay the
        // default one: `logarithmicDepthBuffer` is deliberately off (it would
        // make the sampled value logarithmic, and with near .1 / far 50 there is
        // no precision problem that would justify it), and `depth` stays enabled
        // so both the composer buffers and the velocity pass get a real depth
        // attachment to test against.
        gl={{
          powerPreference: "high-performance",
          alpha: false,
          antialias: false,
          stencil: false,
          depth: true,
          outputColorSpace: THREE.SRGBColorSpace,
          preserveDrawingBuffer: true,
        }}
        onCreated={state => {
          // Disable automatic rendering
          state.gl.autoClear = false;
        }}
      >
        {/*
          The sky is what the room's openings look out onto, and it is also the
          scene's image based lighting. Both matter to the effect: the doorways
          stop being flat dark holes, which gives the smear a high contrast edge
          to drag, and the subject picks up the sky's colour instead of reading
          as a shape pasted onto the render.

          `ShotStage` owns it because the backdrop is per shot - sky in the
          room, flat grey behind the dancers - while the lighting it provides
          stays on throughout. It is also what advances the shot on a cut.

          Its own Suspense boundary so the 4 MB file does not hold back the rest
          of the scene while it decodes.
        */}
        <Suspense fallback={null}>
          <ShotStage />
        </Suspense>

        <CutScaledRoom>
          <BackroomModel />
        </CutScaledRoom>

        <CameraController autoRotate={autoRotateCamera} />

        <MorphingShape />

        {/* Same reasoning: 3 MB of rig and animation, decoded on its own. */}
        <Suspense fallback={null}>
          <Dancer />
        </Suspense>

        <Cloth />

        {/*
          Lighting. The point light is the room's, and only the room's.

          It is a point at a fixed place, so its falloff makes near objects
          brighter than far ones - correct for a lamp in a room, wrong for a row
          of seven identical dancers, where it lit the lead noticeably harder
          than the ones at the ends and the line stopped reading as one troupe.
          The sky is an infinite environment and lights every one of them the
          same, which is why that shot is left to it alone.
        */}
        <OnlyIn shots={LIT_SHOTS}>
          <pointLight ref={lightRef} position={[0, 0, 5]} intensity={2000} distance={5.4} castShadow />
        </OnlyIn>

        <ambientLight intensity={1} />

        <DataMoshingPostProcessing />

        {showPerf && <Perf position="bottom-right" />}

      </Canvas>
    </>
  );
}; 