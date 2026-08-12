import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls } from "@/components/ui/controls";
import { DataMoshManager } from "./data-mosh-stuff/DataMoshManager";
import { DataMoshSettings } from "./data-mosh-stuff/data-moshing-effect";
import { CameraSettings, DEFAULT_CAMERA } from "./found-footage/settings";
import { moshInput } from "./mosh-input";

/**
 * Control schemas.
 *
 * They are declared as plain objects, one per folder, instead of being written
 * inline inside `useControls`: the defaults are hand-tuned against what the
 * effect actually looks like on screen, so keeping them in one place makes them
 * reviewable without reading through the component.
 */
const MOSH_CONTROLS = {
  effectEnabled: { value: true, label: "Enabled" },
  // Holds the trigger down without anything being held down. The effect is a
  // gesture - press, mosh, release, recover - and there is no way to sit inside
  // one long enough to look at it, tweak a slider, or read the debug buffers
  // while it is running.
  latch: { value: false, label: "Hold Trigger" },
  // The two canonical techniques. They are separate presets rather than a
  // blend because they break different halves of the decoder loop: a melt
  // keeps the vectors right and the picture wrong, a bloom keeps the picture
  // right and repeats the vectors.
  moshMode: {
    value: "melt",
    options: { "Melt (I-frame removal)": "melt", "Bloom (P-frame dup)": "bloom" },
    label: "Technique",
  },
  sceneCut: { value: true, label: "Cut On Trigger" },
  motionSource: {
    value: "velocity",
    options: { "Velocity Buffer": "velocity", "Camera Only": "camera" },
    label: "Motion Source",
  },
  motionGain: {
    value: 1.5,
    min: 0,
    max: 30,
    step: 0.5,
    label: "Motion Gain",
  },
  parallax: {
    value: 1,
    min: 0,
    max: 4,
    step: 0.05,
    label: "Parallax (Cam Src)",
  },
  fadeDuration: {
    value: 370,
    min: 1,
    max: 2000,
    step: 1,
    label: "Recovery (ms)",
  },
  // In milliseconds rather than in frames: the pumping this produces is a
  // rhythm, and a rhythm should not speed up on a 120 Hz screen. It also keeps
  // the unit consistent with the other two time controls of the panel.
  keyframeInterval: {
    value: 0,
    min: 0,
    max: 3000,
    step: 10,
    label: "Keyframe Every (ms)",
  },
};

const BLOCK_CONTROLS = {
  blockSize: {
    value: 8,
    min: 4,
    max: 64,
    step: 1,
    label: "Macroblock (px)",
  },
  // A plain off switch for the block grid. Turning it off is not "less
  // datamosh": it is the continuous per-pixel warp, which is what an optical
  // flow based emulation looks like - liquid rather than tiled.
  macroblocks: { value: true, label: "Macroblocks" },
  blockiness: {
    value: 1,
    min: 0,
    max: 1,
    step: 0.01,
    label: "Block Quantise",
  },
  // Codecs do not store motion vectors at pixel resolution. Half pel is what
  // MPEG-4 Part 2 uses, and MPEG-4 Part 2 in AVI is the container/codec pair
  // the classic look comes from.
  mvPrecision: {
    value: 2,
    options: { "Full pel": 1, "Half pel (MPEG-4)": 2, "Quarter pel (H.264)": 4 },
    label: "Vector Precision",
  },
  // Zero by default: above it, blocks below the threshold are not coded at all
  // and freeze for good, which reads as untouched holes punched in the moshed
  // picture rather than as ghosting.
  skipThreshold: {
    value: 0,
    min: 0,
    max: 8,
    step: 0.05,
    label: "Skip Below (px)",
  },
  // How likely any one cell is to lose its vector. The ceiling used to be 0.6,
  // which is where this was tuned to sit - a value pinned to the end of its own
  // slider is a range that was set too narrow, so it now goes to 1.
  frozenBlocks: {
    value: 1,
    min: 0,
    max: 1,
    step: 0.01,
    label: "Lost: Density",
  },
  // How many independent grids of regions are laid over each other, each one
  // finer than the last. Density says how likely a cell is to drop out; this
  // says how many populations of cells there are to drop out at all, which is
  // the other half of "how much of the frame is lost" and the one that changes
  // the size mix rather than just the count.
  lostLayers: {
    value: 4,
    min: 1,
    max: 4,
    step: 1,
    label: "Lost: Layers",
  },
  lostLife: {
    value: 50,
    min: 40,
    // Eight seconds. Long enough that a region can outlive a whole gesture,
    // which is what a vector lost for good looks like rather than one that
    // blinks.
    max: 8000,
    step: 5,
    label: "Lost: Refresh (ms)",
  },
  lostScale: { value: 2.65, min: 0.2, max: 8, step: 0.05, label: "Lost: Size" },
  lostAspect: { value: 0.75, min: 0.2, max: 5, step: 0.05, label: "Lost: Aspect" },
  lostVariance: { value: 1, min: 0, max: 1, step: 0.05, label: "Lost: Variance" },
  // Sits with the settings it draws rather than with the other diagnostics: it
  // is the only way to see what the five controls above are actually doing, and
  // it was a folder away from all of them.
  debugLost: { value: false, label: "Lost: Outline" },
  mismatch: {
    value: 0,
    min: 0,
    max: 0.5,
    step: 0.01,
    label: "MC Mismatch",
  },
};

const RESIDUAL_CONTROLS = {
  // Carried at ten times its real value and divided below. The useful range
  // turned out to sit almost entirely under 0.05, where a slider stepping in
  // hundredths has three or four positions in total; scaling the control lets
  // it resolve down to 0.001 without giving the shader a different meaning.
  residualGain: {
    value: 4,
    min: 0,
    max: 30,
    step: 0.01,
    label: "Residual Gain (x10)",
  },
  residualQuant: {
    value: 14,
    min: 2,
    max: 64,
    step: 1,
    label: "Quantiser Steps",
  },
};

/**
 * Camera controls.
 *
 * One camera, not a menu of them: what is wanted is the way a cheap wide-angle
 * body-worn camera renders a scene, not a museum of recording formats. Nothing
 * here is diegetic — no burnt-in timecode, no REC dot, no tape damage — because
 * those only announce "this is a recording" instead of changing how the image
 * behaves.
 *
 * Every starting value is read from `DEFAULT_CAMERA` rather than written here.
 * The two used to be separate lists of the same numbers, which meant the panel
 * could open showing something the pipeline had never been given - and, worse,
 * that the first commit of the controls would silently overwrite the real
 * defaults with the stale ones.
 */
const OPTICS = DEFAULT_CAMERA.optics;
const SIGNAL = DEFAULT_CAMERA.signal;

const CAMERA_CONTROLS = {
  cameraEnabled: { value: DEFAULT_CAMERA.enabled, label: "Enabled" },
  fov: { value: DEFAULT_CAMERA.fov, min: 40, max: 130, step: 1, label: "Field of View" },
  barrel: { value: OPTICS.barrel, min: -0.2, max: 0.6, step: 0.01, label: "Barrel" },
  chromaticAberration: {
    value: OPTICS.chromaticAberration,
    min: 0,
    max: 10,
    step: 0.1,
    label: "Chromatic Ab.",
  },
  rollingShutter: { value: OPTICS.rollingShutter, min: 0, max: 2, step: 0.05, label: "Rolling Shutter" },
  autoExposure: { value: OPTICS.autoExposure, min: 0, max: 1.5, step: 0.05, label: "AE Hunting" },
  whiteBalanceDrift: { value: OPTICS.whiteBalanceDrift, min: 0, max: 1.5, step: 0.05, label: "AWB Drift" },
  noise: { value: OPTICS.noise, min: 0, max: 0.3, step: 0.005, label: "Sensor Noise" },
  fixedPattern: { value: OPTICS.fixedPattern, min: 0, max: 1, step: 0.05, label: "Fixed Pattern" },
  bloomIntensity: { value: DEFAULT_CAMERA.bloom.intensity, min: 0, max: 3, step: 0.05, label: "Bloom" },
  bloomThreshold: { value: DEFAULT_CAMERA.bloom.threshold, min: 0, max: 1, step: 0.01, label: "Bloom Threshold" },
  persistence: { value: SIGNAL.persistence, min: 0, max: 0.98, step: 0.01, label: "Trail" },
  persistenceBias: {
    value: SIGNAL.persistenceBias,
    min: 0,
    max: 1,
    step: 0.05,
    label: "Trail on Highlights",
  },
  chromaBleed: { value: SIGNAL.chromaBleed, min: 0, max: 1.5, step: 0.05, label: "Chroma Bleed" },
  chromaDelay: { value: SIGNAL.chromaDelay, min: 0, max: 8, step: 0.1, label: "Chroma Delay (px)" },
  lift: { value: SIGNAL.lift, min: 0, max: 0.35, step: 0.005, label: "Lifted Blacks" },
  liftTint: { value: SIGNAL.liftTint, label: "Shadow Tint" },
  shoulder: { value: SIGNAL.shoulder, min: 0, max: 0.35, step: 0.005, label: "Held Whites" },
  contrast: { value: SIGNAL.contrast, min: 0.4, max: 1.6, step: 0.01, label: "Contrast" },
  saturation: { value: SIGNAL.saturation, min: 0, max: 1.6, step: 0.02, label: "Saturation" },
  tint: { value: SIGNAL.tint, label: "Cast" },
  // Stepped in hundredths, not twentieths: the tuned value sits at 0.43 and a
  // coarser grid cannot represent it.
  vignette: { value: SIGNAL.vignette, min: 0, max: 1, step: 0.01, label: "Vignette" },
  grain: { value: SIGNAL.grain, min: 0, max: 0.3, step: 0.002, label: "Grain" },
};

const PIPELINE_CONTROLS = {
  resolutionScale: {
    value: 1,
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "Frame Buffer Scale",
  },
  antialias: { value: true, label: "Antialias (FXAA)" },
  debugFrames: { value: false, label: "Show Frame Buffers" },
  debugMotion: { value: false, label: "Show Motion Vectors" },
  debugScale: { value: 8, min: 1, max: 40, step: 0.5, label: "Vector Scale (px)" },
};

/**
 * Folder options. The panel is shared with the scene component, which registers
 * its own folders, so `order` is what keeps the layout deterministic instead of
 * depending on which component happens to mount first: the effect's controls
 * lead, diagnostics follow, collapsed.
 */
const CAMERA_FOLDER = { order: 40, collapsed: true } as const;
const MOSH_FOLDER = { order: 10 } as const;
const BLOCK_FOLDER = { order: 12 } as const;
const RESIDUAL_FOLDER = { order: 14 } as const;
const PIPELINE_FOLDER = { order: 30, collapsed: true } as const;

/**
 * Builds and drives the datamosh post-processing chain.
 *
 * The chain is created once and updated in place: rebuilding it on every
 * control change used to leak render targets, because `removeAllPasses` only
 * drops the references without disposing anything.
 */
export const DataMoshingPostProcessing = () => {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  // Covers container resizes too, not just window ones.
  const size = useThree((state) => state.size);

  // The mosh trigger is deliberately *not* read here: the manager polls the
  // shared store once per frame instead. Routing it through React would
  // re-render this component on every press and release, and would put the
  // recovery behind the commit scheduler.
  const cam = useControls("📷 Camera", CAMERA_CONTROLS, CAMERA_FOLDER);
  const mosh = useControls("🎞️ Datamosh", MOSH_CONTROLS, MOSH_FOLDER);
  const blocks = useControls("🧱 Macroblocks", BLOCK_CONTROLS, BLOCK_FOLDER);
  const residual = useControls("🩸 Residual", RESIDUAL_CONTROLS, RESIDUAL_FOLDER);
  const pipeline = useControls("🔬 Pipeline", PIPELINE_CONTROLS, PIPELINE_FOLDER);

  // The one place the trigger *is* driven from React, and it can be: a latch
  // changes at the rate someone clicks a checkbox, not at input rate. It is
  // released on unmount so the store cannot be left holding a trigger for a
  // component that no longer exists.
  useEffect(() => {
    moshInput.setLatched(mosh.latch);
    return () => moshInput.setLatched(false);
  }, [mosh.latch]);

  // Annotated on purpose: an unknown or misspelled key is a compile error here,
  // which is exactly how the old `effectAmount` typo slipped through.
  const settings: DataMoshSettings = useMemo(
    () => ({
      effectEnabled: mosh.effectEnabled,
      // The schema is key-erased down to `string`, so the unions are put back
      // on here: an unknown value can only ever mean the default.
      moshMode: mosh.moshMode === "bloom" ? "bloom" : "melt",
      sceneCut: mosh.sceneCut,
      fadeDuration: mosh.fadeDuration,
      keyframeInterval: mosh.keyframeInterval,
      motionSource: mosh.motionSource === "camera" ? "camera" : "velocity",
      motionGain: mosh.motionGain,
      parallax: mosh.parallax,
      blockSize: blocks.blockSize,
      blockiness: blocks.macroblocks ? blocks.blockiness : 0,
      frozenBlocks: blocks.frozenBlocks,
      lostLayers: blocks.lostLayers,
      lostLife: blocks.lostLife,
      lostScale: blocks.lostScale,
      lostAspect: blocks.lostAspect,
      lostVariance: blocks.lostVariance,
      mvPrecision: blocks.mvPrecision,
      skipThreshold: blocks.skipThreshold,
      mismatch: blocks.mismatch,
      residualGain: residual.residualGain / 10,
      residualQuant: residual.residualQuant,
      antialias: pipeline.antialias,
      resolutionScale: pipeline.resolutionScale,
      debugMotion: pipeline.debugMotion,
      debugLost: blocks.debugLost,
      debugScale: pipeline.debugScale,
      debugFrames: pipeline.debugFrames,
    }),
    [mosh, blocks, residual, pipeline],
  );

  const cameraSettings: CameraSettings = useMemo(
    () => ({
      enabled: cam.cameraEnabled,
      fov: cam.fov,
      optics: {
        barrel: cam.barrel,
        chromaticAberration: cam.chromaticAberration,
        rollingShutter: cam.rollingShutter,
        autoExposure: cam.autoExposure,
        whiteBalanceDrift: cam.whiteBalanceDrift,
        noise: cam.noise,
        fixedPattern: cam.fixedPattern,
      },
      signal: {
        chromaBleed: cam.chromaBleed,
        chromaDelay: cam.chromaDelay,
        persistence: cam.persistence,
        persistenceBias: cam.persistenceBias,
        lift: cam.lift,
        liftTint: cam.liftTint,
        shoulder: cam.shoulder,
        contrast: cam.contrast,
        saturation: cam.saturation,
        tint: cam.tint,
        vignette: cam.vignette,
        grain: cam.grain,
      },
      bloom: {
        intensity: cam.bloomIntensity,
        threshold: cam.bloomThreshold,
        smoothing: DEFAULT_CAMERA.bloom.smoothing,
      },
    }),
    [cam],
  );

  // The wide angle of a bodycam has to come from the frustum, not from the lens
  // distortion: bending a 50 degree render into a fisheye gives a curved,
  // cropped picture rather than a wide one.
  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    if (!perspective.isPerspectiveCamera) return;
    if (perspective.fov === cameraSettings.fov) return;

    perspective.fov = cameraSettings.fov;
    perspective.updateProjectionMatrix();
  }, [camera, cameraSettings.fov]);

  const managerRef = useRef<DataMoshManager | null>(null);
  // Read by the construction effect without making them dependencies: the
  // pipeline must not be rebuilt when a slider moves.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const cameraRef = useRef(cameraSettings);
  cameraRef.current = cameraSettings;

  useEffect(() => {
    const manager = new DataMoshManager(
      gl,
      scene,
      camera,
      settingsRef.current,
      cameraRef.current,
    );
    managerRef.current = manager;

    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [gl, scene, camera]);

  useEffect(() => {
    managerRef.current?.updateSettings(settings, cameraSettings);
  }, [settings, cameraSettings]);

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
