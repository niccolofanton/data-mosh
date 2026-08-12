'use client';

/**
 * ============================================================================
 * Control panel adapter - Driftpane (Tweakpane v4) with a leva-shaped React API
 * ============================================================================
 *
 * Replaces `leva` with `@niccolofanton/driftpane`, a non-invasive layer on top
 * of Tweakpane v4 that adds localStorage persistence, a draggable/resizable
 * panel and a presets menu. The public API is deliberately a near clone of the
 * subset of leva this project used, so call sites read almost identically:
 *
 *   // before (leva)
 *   const { fadeDuration } = useControls('Trail', {
 *     fadeDuration: { value: 370, min: 1, max: 2000, step: 1, label: 'Fade (ms)' },
 *   });
 *   const { showPerf } = useControls({
 *     Performance: folder({ showPerf: { value: false } }, { collapsed: true }),
 *   });
 *   <Leva theme={...} />            // panel host component
 *
 *   // after (this module)
 *   const { fadeDuration } = useControls('Trail', {
 *     fadeDuration: { value: 370, min: 1, max: 2000, step: 1, label: 'Fade (ms)' },
 *   });
 *   const { showPerf } = useControls('Performance',
 *     { showPerf: { value: false } },
 *     { collapsed: true },
 *   );
 *   // no host component: the panel is created on demand
 *
 * Differences from leva worth knowing:
 *  - the folder title is always the FIRST argument (leva's nested `folder()`
 *    helper has no equivalent, and nothing here needed nesting);
 *  - there is no `<Leva />` element to render; the pane appears as soon as the
 *    first hook mounts and disappears when the last one unmounts;
 *  - values persist across reloads, and the panel remembers where it was
 *    dragged and how it was resized.
 *
 * ---------------------------------------------------------------------------
 * ADDING A CONTROL
 * ---------------------------------------------------------------------------
 *
 *   const { blockSize, debugFrames, mode } = useControls('Corruption', {
 *     blockSize:   { value: 16, min: 2, max: 64, step: 2, label: 'Block size' },
 *     debugFrames: { value: false, label: 'Debug frames' },
 *     mode:        { value: 'soft', options: ['soft', 'hard'], label: 'Mode' },
 *     tint:        { value: '#ff0044', label: 'Tint' },   // colour picker
 *     gain:        0.5,                                    // bare-value shorthand
 *   });
 *
 * Supported shapes: number (slider when `min`/`max` are given), boolean, string
 * (Tweakpane renders a colour picker for CSS colour strings), and select via
 * `options` (array or label -> value map). `useButton(folder, label, onClick)`
 * adds an action. Types are inferred - no annotations needed.
 *
 * Two components may pass the SAME folder title; their controls merge into that
 * one folder. Keys must then be unique within the folder.
 *
 * ---------------------------------------------------------------------------
 * HOW IT FITS TOGETHER
 * ---------------------------------------------------------------------------
 *
 *   use-controls.ts   React hooks: schema -> registration, values -> state
 *   control-pane.ts   singleton registry + Tweakpane/Driftpane lifecycle
 *   schema.ts         public schema types, inference, normalisation, coercion
 *   tweakpane-api.ts  minimal structural typings for Tweakpane v4
 *   controls.css      the three metrics inherited from the old leva theme
 *
 * The pane is a pure function of the registry: registrations are collected and
 * flushed on the next macrotask, and the panel is rebuilt only when the
 * resulting structure actually differs. That is what makes StrictMode's double
 * mount, HMR and lazily mounting components (R3F children, Suspense) safe -
 * see the long comment in `control-pane.ts` for why Driftpane requires it.
 */

export { useButton, useControls } from './use-controls';
export type {
  BooleanControl,
  ControlPrimitive,
  ControlSchema,
  ControlSpec,
  ControlValue,
  ControlValues,
  FolderOptions,
  NumberControl,
  SelectControl,
  StringControl,
} from './schema';
