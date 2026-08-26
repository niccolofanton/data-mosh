import { Suspense, lazy, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useControl } from '@/controls';
import { PostProcessing } from '@/datamosh/post-processing';
import { CameraController } from './camera-controller';
import { MorphingShape } from './morphing-shape';
import { Room } from './room';
import { Dancer, OnlyIn, ShotStage } from './shots';

/**
 * Loaded only when the overlay is switched on.
 *
 * A static import put r3f-perf and its dependency graph - stitches, radix
 * icons, zustand, drei's Text and troika-three-text, plus a base64 font - into
 * the first-load bundle of every visit, and stitches injects its stylesheet at
 * module scope, so the cost was paid on the critical path of a page whose whole
 * job is to get a WebGL scene running. The control defaults to off in a folder
 * that starts collapsed.
 */
const Perf = lazy(() =>
  import('r3f-perf').then((module) => ({ default: module.Perf })),
);

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

/** A touch drag on the view must not scroll the page. */
const preventScroll = (event: TouchEvent) => event.preventDefault();

export const Scene = () => {
  const [frameloop, setFrameloop] = useState<'always' | 'never'>('always');
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // The only two controls that have to be React state: one mounts a component,
  // one is a prop. Everything else the panel drives is read imperatively.
  const showPerf = useControl((values) => values.showPerf);
  const autoRotate = useControl((values) => values.autoRotate);

  // Stop rendering while the tab is in the background.
  useEffect(() => {
    const onVisibilityChange = () =>
      setFrameloop(document.hidden ? 'never' : 'always');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  /**
   * Bound to the canvas rather than to `document`. `{ passive: false }` is
   * required for `preventDefault` to have any effect, and a non-passive
   * `touchmove` listener opts its target out of the browser's compositor fast
   * path: every touch move has to round-trip through the main thread, which is
   * the one running the composer chain. On `document` that applied to the whole
   * page, control panel included, which could then never be scrolled.
   */
  useEffect(() => {
    if (canvas === null) return;
    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    return () => canvas.removeEventListener('touchmove', preventScroll);
  }, [canvas]);

  return (
    <Canvas
      flat
      dpr={DPR_RANGE}
      frameloop={frameloop}
      camera={{
        position: [0, 2, 2],
        // Wide, the way a body-worn camera is wide: a frustum, not a lens
        // distortion. Bending a 50 degree render into a fisheye gives a curved,
        // cropped picture rather than a wide one.
        fov: 79,
        near: 0.1,
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
      // make the sampled value logarithmic, and with near .1 / far 200 there is
      // no precision problem that would justify it), and `depth` stays enabled
      // so both the composer buffers and the velocity pass get a real depth
      // attachment to test against.
      gl={{
        powerPreference: 'high-performance',
        alpha: false,
        antialias: false,
        stencil: false,
        depth: true,
        outputColorSpace: THREE.SRGBColorSpace,
        preserveDrawingBuffer: true,
      }}
      onCreated={(state) => {
        // The composer owns the frame, so r3f must not clear it.
        state.gl.autoClear = false;
        setCanvas(state.gl.domElement);
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

      <Room />

      <CameraController autoRotate={autoRotate} />

      <MorphingShape />

      {/* Same reasoning: 3 MB of rig and animation, decoded on its own. */}
      <Suspense fallback={null}>
        <Dancer />
      </Suspense>

      {/*
        The point light is the room's, and only the room's.

        It is a point at a fixed place, so its falloff makes near objects
        brighter than far ones - correct for a lamp in a room, wrong for a row
        of seven identical dancers, where it lit the lead noticeably harder
        than the ones at the ends and the line stopped reading as one troupe.
        The sky is an infinite environment and lights every one of them the
        same, which is why that shot is left to it alone.
      */}
      <OnlyIn shots={LIT_SHOTS}>
        <pointLight position={[0, 0, 5]} intensity={2000} distance={5.4} castShadow />
      </OnlyIn>

      <ambientLight intensity={1} />

      <PostProcessing />

      {showPerf && (
        <Suspense fallback={null}>
          <Perf position="bottom-right" />
        </Suspense>
      )}
    </Canvas>
  );
};
