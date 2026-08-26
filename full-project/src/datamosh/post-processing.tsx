import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { controls, subscribeControls } from "@/controls";
import { DataMoshManager } from "./manager";
import { DataMoshSettings } from "./effect";
import { moshInput } from "@/state/mosh-input";

/**
 * Deep link for the debug views: `?debug=motion`, `?debug=frames`.
 *
 * Read once at module scope. The bundle only ever runs in the browser, so
 * `window` is always there to read from.
 *
 * OR'd into the settings rather than written into the control's default,
 * because the checkbox still has to be able to turn the view back off - which
 * it could not do if the URL kept re-asserting itself through the default.
 */
const DEBUG_PARAM = new URLSearchParams(window.location.search).get("debug") ?? "";

/**
 * The panel's raw values, mapped onto what the effect actually takes.
 *
 * Annotated on purpose: an unknown or misspelled key is a compile error here,
 * which is exactly how the old `effectAmount` typo slipped through. Everything
 * that is not a straight copy is a deliberate translation - the macroblock
 * switch collapsing to a quantisation of zero, the residual gain carried at ten
 * times its real value, the debug deep links.
 */
const readSettings = (): DataMoshSettings => ({
  effectEnabled: controls.effectEnabled,
  sceneCut: controls.sceneCut,
  fadeDuration: controls.fadeDuration,
  keyframeInterval: controls.keyframeInterval,
  motionSource: controls.motionSource,
  motionGain: controls.motionGain,
  parallax: controls.parallax,
  blockSize: controls.blockSize,
  blockiness: controls.macroblocks ? controls.blockiness : 0,
  frozenBlocks: controls.frozenBlocks,
  lostLayers: controls.lostLayers,
  lostLife: controls.lostLife,
  lostScale: controls.lostScale,
  lostAspect: controls.lostAspect,
  lostVariance: controls.lostVariance,
  mvPrecision: controls.mvPrecision,
  skipThreshold: controls.skipThreshold,
  mismatch: controls.mismatch,
  residualGain: controls.residualGain / 10,
  residualQuant: controls.residualQuant,
  antialias: controls.antialias,
  resolutionScale: controls.resolutionScale,
  debugMotion: controls.debugMotion || DEBUG_PARAM === "motion",
  debugScale: controls.debugScale,
  debugFrames: controls.debugFrames || DEBUG_PARAM === "frames",
});

/**
 * Builds and drives the datamosh post-processing chain.
 *
 * The chain is created once and updated in place: rebuilding it on every
 * control change used to leak render targets, because `removeAllPasses` only
 * drops the references without disposing anything.
 *
 * Nothing here is React state. The panel writes into a plain object and this
 * component hands the result to the manager on the same tick - a control change
 * therefore reaches the shader without waiting for a commit, and moving a
 * slider re-renders nothing. The mosh trigger is one step further removed
 * still: the manager polls the shared input store once per frame.
 */
export const PostProcessing = () => {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  // Covers container resizes too, not just window ones.
  const size = useThree((state) => state.size);

  const managerRef = useRef<DataMoshManager | null>(null);

  useEffect(() => {
    const manager = new DataMoshManager(gl, scene, camera, readSettings());
    managerRef.current = manager;

    const unsubscribe = subscribeControls(() => {
      // The latch is the one control that does not belong to the settings
      // object: it is an input, and it goes to the store the manager polls.
      moshInput.setLatched(controls.latch);
      manager.updateSettings(readSettings());
    });

    return () => {
      unsubscribe();
      // So the store cannot be left holding a trigger for a chain that no
      // longer exists.
      moshInput.setLatched(false);
      manager.dispose();
      managerRef.current = null;
    };
  }, [gl, scene, camera]);

  useEffect(() => {
    managerRef.current?.setSize(size.width, size.height);
    // The two dimensions rather than the object: r3f rebuilds `size` whenever
    // its measured rect changes, and that rect includes `top` and `left`, which
    // move on scroll. This effect therefore re-fired on every scroll tick with
    // identical dimensions - and `setSize` tears down and rebuilds the debug
    // frame views when they are on.
  }, [size.width, size.height]);

  // Priority > 0 takes over the render loop from r3f, which is what lets the
  // composer own the frame.
  useFrame((_, delta) => {
    managerRef.current?.render(delta);
  }, 1);

  return null;
};
