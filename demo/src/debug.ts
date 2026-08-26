import { Pane } from 'tweakpane';

/**
 * The pipeline reads these inside the render loop, so a slider reaches the
 * shader on the same frame it is moved. The defaults are the ones the effect
 * was tuned against.
 */
export const controls = {
  // What the decoder does and where its motion comes from.
  effectEnabled: true,
  /** Holds the trigger down without a button held, to sit inside a gesture. */
  latch: false,
  sceneCut: true,
  motionGain: 1.5,
  parallax: 1,
  fadeDuration: 370,
  /** 0 = one keyframe for the whole gesture (infinite GOP). */
  keyframeInterval: 0,

  // The block grid and the ways a block can go wrong: quantised, skipped,
  // stolen from a neighbour, or never delivered at all.
  blockSize: 8,
  /** Off = continuous per pixel warp: a liquid smear instead of sliding tiles. */
  macroblocks: true,
  blockiness: 1,
  mvPrecision: 2,
  skipThreshold: 0,
  frozenBlocks: 1,
  lostLayers: 4,
  lostLife: 50,
  lostScale: 2.65,
  lostAspect: 0.75,
  lostVariance: 1,
  mismatch: 0,

  // The correction added on top of the prediction, and how coarsely it is quantised.
  /** Carried at ten times its real value: the useful range sits under 0.05. */
  residualGain: 4,
  residualQuant: 14,

  // Buffer resolution and the two views: antialiased render, or raw vectors.
  resolutionScale: 1,
  antialias: true,
  debugMotion: false,
  /** What the vector view draws: the hue field, the arrows, or both. */
  debugView: 'both' as 'both' | 'field' | 'arrows',
  debugScale: 8,
  /** Draws the vector arrows over the picture itself, in negative. */
  showMotionArrows: false,
  /** Outlines the packet-loss rectangles in white, and changes nothing else. */
  showLostSectors: false,
};

/** Builds the panel. `onChange` fires after any control changes. */
export const createPane = (onChange: () => void): void => {
  const pane = new Pane({ title: 'Data Mosh' });

  const mosh = pane.addFolder({ title: '🎞️ Datamosh' });
  mosh.addBinding(controls, 'effectEnabled', { label: 'Enabled' });
  mosh.addBinding(controls, 'latch', { label: 'Hold Trigger' });
  mosh.addBinding(controls, 'sceneCut', { label: 'Cut On Trigger' });
  mosh.addBinding(controls, 'motionGain', { label: 'Motion Gain', min: 0, max: 30, step: 0.5 });
  mosh.addBinding(controls, 'parallax', { label: 'Parallax (Background)', min: 0, max: 4, step: 0.05 });
  mosh.addBinding(controls, 'fadeDuration', { label: 'Recovery (ms)', min: 1, max: 2000, step: 1 });
  mosh.addBinding(controls, 'keyframeInterval', { label: 'Keyframe Every (ms)', min: 0, max: 3000, step: 10 });

  const blocks = pane.addFolder({ title: '🧱 Macroblocks' });
  blocks.addBinding(controls, 'blockSize', { label: 'Macroblock (px)', min: 4, max: 64, step: 1 });
  blocks.addBinding(controls, 'macroblocks', { label: 'Macroblocks' });
  blocks.addBinding(controls, 'blockiness', { label: 'Block Quantise', min: 0, max: 1, step: 0.01 });
  blocks.addBinding(controls, 'mvPrecision', { label: 'Vector Precision', options: { 'Full pel': 1, 'Half pel (MPEG-4)': 2, 'Quarter pel (H.264)': 4 } });
  blocks.addBinding(controls, 'skipThreshold', { label: 'Skip Below (px)', min: 0, max: 8, step: 0.05 });
  blocks.addBinding(controls, 'frozenBlocks', { label: 'Lost: Density', min: 0, max: 1, step: 0.01 });
  blocks.addBinding(controls, 'lostLayers', { label: 'Lost: Layers', min: 1, max: 4, step: 1 });
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
  pipeline.addBinding(controls, 'debugMotion', { label: 'Show Motion Vectors' });
  pipeline.addBinding(controls, 'debugView', { label: 'Vector View', options: { 'Colour + arrows': 'both', 'Colour only': 'field', 'Arrows only': 'arrows' } });
  pipeline.addBinding(controls, 'debugScale', { label: 'Vector Scale (px)', min: 1, max: 40, step: 0.5 });
  pipeline.addBinding(controls, 'showMotionArrows', { label: 'Arrows Over Picture' });
  pipeline.addBinding(controls, 'showLostSectors', { label: 'Show Lost Sectors' });

  // One listener on the root: Tweakpane bubbles every binding's change up to the
  // pane, and has already written the new value into `controls` by then.
  pane.on('change', onChange);
};

// When this module is replaced, the pane it built is orphaned on screen.
import.meta.hot?.dispose(() => {
  document.querySelector('.tp-dfwv')?.remove();
});
