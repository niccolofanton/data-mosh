# Real-Time Datamosh in WebGL

Minimal source project accompanying the Codrops article. It reproduces an
inter-frame decoder loop with three.js and `postprocessing`:

```text
new frame = warp(previous frame, motion vectors) + residual
```

## Run locally

```bash
pnpm install
pnpm dev
```

Create and inspect the production build with:

```bash
pnpm build
pnpm preview
```

## Controls

- Hold the pointer or Space to run the effect. `Hold Trigger` latches it on.
- `Cut On Trigger` replaces the current shot while the feedback buffer keeps
  the outgoing picture.
- `Macroblocks`, `Residual` and `Pipeline` expose each stage discussed in the
  article.
- `Show Motion Vectors`, `Arrows Over Picture` and `Show Lost Sectors` are
  diagnostic views; they do not change the underlying motion field.

## Source map

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Renderer, input, resize and shot scheduling |
| `src/scenes.ts` | Six lightweight scenes with distinct motion fields |
| `src/debug.ts` | Tweakpane controls and defaults |
| `src/datamosh/index.ts` | Post-processing pipeline and feedback lifecycle |
| `src/datamosh/effect.ts` | Effect wrapper and camera reprojection state |
| `src/datamosh/shaders.ts` | Decode loop, residual, macroblocks and diagnostics |
| `src/datamosh/velocity-pass.ts` | Per-object screen-space velocity buffer |

The velocity and feedback targets use half-float precision when supported.
Unsupported devices fall back to camera-derived motion and an 8-bit history.
