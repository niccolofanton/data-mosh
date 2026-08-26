import { useSyncExternalStore } from 'react';
import { Pane } from 'tweakpane';

/**
 * The demo's control panel: one Tweakpane, built once at boot.
 *
 * Everything the panel can change lives in the single mutable object below, and
 * Tweakpane binds straight into it - no schema layer, no registry, no React
 * ownership. That is the whole design, and it is possible because of what the
 * controls actually drive: almost all of them end up in
 * `DataMoshManager.updateSettings`, which is imperative and runs inside the
 * render loop. Routing them through component state only ever added a commit
 * between a slider and the frame it was meant to change.
 *
 * The two that genuinely need React - one mounts the perf overlay, one is a
 * prop - read through `useControl`, which subscribes to the same notification.
 *
 * Defaults are hand-tuned against what the effect looks like on screen, so they
 * are kept together here rather than scattered across the call sites.
 */
export const controls = {
  // --- 🎞️ Datamosh ---------------------------------------------------------
  effectEnabled: true,
  /**
   * Holds the trigger down without anything being held down. The effect is a
   * gesture - press, mosh, release, recover - and there is otherwise no way to
   * sit inside one long enough to look at it, move a slider, or read the debug
   * buffers while it is running.
   */
  latch: false,
  sceneCut: true,
  motionSource: 'velocity' as 'velocity' | 'camera',
  motionGain: 1.5,
  parallax: 1,
  fadeDuration: 370,
  /**
   * In milliseconds rather than in frames: the pumping this produces is a
   * rhythm, and a rhythm should not speed up on a 120 Hz screen. It also keeps
   * the unit consistent with the other two time controls of the panel.
   */
  keyframeInterval: 0,

  // --- 🧱 Macroblocks -------------------------------------------------------
  blockSize: 8,
  /**
   * A plain off switch for the block grid. Turning it off is not "less
   * datamosh": it is the continuous per-pixel warp, which is what an optical
   * flow based emulation looks like - liquid rather than tiled.
   */
  macroblocks: true,
  blockiness: 1,
  /**
   * Codecs do not store motion vectors at pixel resolution. Half pel is what
   * MPEG-4 Part 2 uses, and MPEG-4 Part 2 in AVI is the container/codec pair
   * the classic look comes from.
   */
  mvPrecision: 2,
  /**
   * Zero by default: above it, blocks below the threshold are not coded at all
   * and freeze for good, which reads as untouched holes punched in the moshed
   * picture rather than as ghosting.
   */
  skipThreshold: 0,
  /** How likely any one cell is to lose its vector. */
  frozenBlocks: 1,
  /**
   * How many independent grids of regions are laid over each other, each one
   * finer than the last. Density says how likely a cell is to drop out; this
   * says how many populations of cells there are to drop out at all, which is
   * the other half of "how much of the frame is lost" and the one that changes
   * the size mix rather than just the count.
   */
  lostLayers: 4,
  lostLife: 50,
  lostScale: 2.65,
  lostAspect: 0.75,
  lostVariance: 1,
  mismatch: 0,

  // --- 🩸 Residual ----------------------------------------------------------
  /**
   * Carried at ten times its real value and divided at the mapping. The useful
   * range sits almost entirely under 0.05, where a slider stepping in
   * hundredths has three or four positions in total; scaling the control lets
   * it resolve down to 0.001 without giving the shader a different meaning.
   */
  residualGain: 4,
  residualQuant: 14,

  // --- 🔬 Pipeline ----------------------------------------------------------
  resolutionScale: 1,
  antialias: true,
  debugFrames: false,
  debugMotion: false,
  debugScale: 8,

  // --- ⚡ Diagnostics -------------------------------------------------------
  showPerf: false,
  autoRotate: false,
};

export type Controls = typeof controls;

// --- Notification ------------------------------------------------------------

const listeners = new Set<() => void>();

/** Fires after any control changes. The values are read off `controls`. */
export const subscribeControls = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * A single control as React state, for the two that have to be: `showPerf`
 * mounts a component, `autoRotate` is a prop. Everything else is read
 * imperatively and never causes a render.
 *
 * The selector must return a primitive - `useSyncExternalStore` compares
 * snapshots by identity, and `controls` is mutated in place rather than
 * replaced, so returning the object itself would never register as a change.
 */
export const useControl = <T extends number | boolean | string>(
  select: (values: Controls) => T,
): T => useSyncExternalStore(subscribeControls, () => select(controls));

// --- The pane ----------------------------------------------------------------

/**
 * Builds the panel. Called once from `main.tsx`, before React mounts.
 *
 * Folder order is the order these calls are written in, and the diagnostics
 * start collapsed: the effect's own controls are what the demo is about.
 */
export const createControlPane = (): (() => void) => {
  const pane = new Pane({ title: 'Data Mosh' });

  const mosh = pane.addFolder({ title: '🎞️ Datamosh' });
  mosh.addBinding(controls, 'effectEnabled', { label: 'Enabled' });
  mosh.addBinding(controls, 'latch', { label: 'Hold Trigger' });
  mosh.addBinding(controls, 'sceneCut', { label: 'Cut On Trigger' });
  mosh.addBinding(controls, 'motionSource', {
    label: 'Motion Source',
    options: { 'Velocity Buffer': 'velocity', 'Camera Only': 'camera' },
  });
  mosh.addBinding(controls, 'motionGain', { label: 'Motion Gain', min: 0, max: 30, step: 0.5 });
  mosh.addBinding(controls, 'parallax', { label: 'Parallax (Background)', min: 0, max: 4, step: 0.05 });
  mosh.addBinding(controls, 'fadeDuration', { label: 'Recovery (ms)', min: 1, max: 2000, step: 1 });
  mosh.addBinding(controls, 'keyframeInterval', { label: 'Keyframe Every (ms)', min: 0, max: 3000, step: 10 });

  const blocks = pane.addFolder({ title: '🧱 Macroblocks' });
  blocks.addBinding(controls, 'blockSize', { label: 'Macroblock (px)', min: 4, max: 64, step: 1 });
  blocks.addBinding(controls, 'macroblocks', { label: 'Macroblocks' });
  blocks.addBinding(controls, 'blockiness', { label: 'Block Quantise', min: 0, max: 1, step: 0.01 });
  blocks.addBinding(controls, 'mvPrecision', {
    label: 'Vector Precision',
    options: { 'Full pel': 1, 'Half pel (MPEG-4)': 2, 'Quarter pel (H.264)': 4 },
  });
  blocks.addBinding(controls, 'skipThreshold', { label: 'Skip Below (px)', min: 0, max: 8, step: 0.05 });
  blocks.addBinding(controls, 'frozenBlocks', { label: 'Lost: Density', min: 0, max: 1, step: 0.01 });
  blocks.addBinding(controls, 'lostLayers', { label: 'Lost: Layers', min: 1, max: 4, step: 1 });
  // Eight seconds at the top end: long enough that a region can outlive a whole
  // gesture, which is what a vector lost for good looks like rather than one
  // that blinks.
  blocks.addBinding(controls, 'lostLife', { label: 'Lost: Refresh (ms)', min: 40, max: 8000, step: 5 });
  blocks.addBinding(controls, 'lostScale', { label: 'Lost: Size', min: 0.2, max: 8, step: 0.05 });
  blocks.addBinding(controls, 'lostAspect', { label: 'Lost: Aspect', min: 0.2, max: 5, step: 0.05 });
  blocks.addBinding(controls, 'lostVariance', { label: 'Lost: Variance', min: 0, max: 1, step: 0.05 });
  blocks.addBinding(controls, 'mismatch', { label: 'MC Mismatch', min: 0, max: 0.5, step: 0.01 });

  const residual = pane.addFolder({ title: '🩸 Residual' });
  residual.addBinding(controls, 'residualGain', { label: 'Residual Gain (x10)', min: 0, max: 30, step: 0.01 });
  residual.addBinding(controls, 'residualQuant', { label: 'Quantiser Steps', min: 2, max: 64, step: 1 });

  const pipeline = pane.addFolder({ title: '🔬 Pipeline', expanded: false });
  pipeline.addBinding(controls, 'resolutionScale', { label: 'History/velocity texture scale', min: 0.2, max: 1, step: 0.05 });
  pipeline.addBinding(controls, 'antialias', { label: 'Antialias (FXAA)' });
  pipeline.addBinding(controls, 'debugFrames', { label: 'Show Frame Buffers' });
  pipeline.addBinding(controls, 'debugMotion', { label: 'Show Motion Vectors' });
  pipeline.addBinding(controls, 'debugScale', { label: 'Vector Scale (px)', min: 1, max: 40, step: 0.5 });

  const diagnostics = pane.addFolder({ title: '⚡ Diagnostics', expanded: false });
  diagnostics.addBinding(controls, 'showPerf', { label: 'Show Performance' });
  diagnostics.addBinding(controls, 'autoRotate', { label: 'Auto Rotate Camera' });

  // One listener on the root: Tweakpane bubbles every binding's change up to
  // the pane, and it has already written the new value into `controls` by the
  // time this runs.
  pane.on('change', () => {
    for (const listener of [...listeners]) listener();
  });

  return () => pane.dispose();
};

// When this module is replaced, the pane it built is orphaned on screen.
import.meta.hot?.dispose(() => {
  document.querySelector('.tp-dfwv')?.remove();
});
