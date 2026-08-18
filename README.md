# Data Mosh

A real-time WebGL demo of a **datamosh** effect, built with Next.js 14,
react-three-fiber and the `postprocessing` library.

You walk around a small 3D room; while you hold the trigger, the image stops
being refreshed and starts smearing along your camera movement, the way a
compressed video looks when its keyframes are dropped.

## Getting started

```bash
pnpm install
pnpm dev            # dev server on http://localhost:3000
```

| Command        | What it does                                               |
| -------------- | ---------------------------------------------------------- |
| `pnpm build`   | ESLint, then a static export of the site into `out/`        |
| `pnpm preview` | Build, then serve `out/` locally                            |
| `pnpm lint`    | ESLint over `src/`                                          |

> The app is a fully static export, so there is no server runtime: deploy the
> contents of `out/` to any static host.

## Controls

| Input                          | Action                       |
| ------------------------------ | ---------------------------- |
| `W` / `A` / `S` / `D`          | Move the camera              |
| Mouse move                     | Look around                  |
| `Space`, or hold mouse / touch | Activate the datamosh effect |

A Tweakpane panel exposes every parameter live, grouped into folders: the
technique and its recovery time, the macroblock grid, the residual, the
simulated camera, and the diagnostics. The debug views also have deep links:
`?debug=motion`, `?debug=lost`, `?debug=frames`.

## Layout

```
src/
  app/            Next.js route, metadata, global stylesheet
  scene/          the room, the subject, the cloth, the shots, the camera rig
  datamosh/       the effect: manager, velocity pass, shaders, debug views
  found-footage/  the simulated camera: optics, sensor, signal
  state/          stores shared by scene and pipeline: shot, cut, input
  controls/       the control panel, as a React hook
  lib/            build-time helpers
```

## How it works

The scene is rendered through an effect composer:

1. A **render pass** draws the room normally.
2. A **velocity pass** measures how far every pixel moved since the last frame.
3. **Copy passes** capture the current colour frame, a depth frame, and the
   effect's own previous output.
4. The **datamosh effect** decides, every frame, what to show.

While the trigger is held, the effect stops reading the freshly rendered frame.
It re-samples its own previous output and displaces the lookup by the measured
motion, snapped onto a macroblock grid. This is the analogue of removing the
I-frames from a compressed video and letting only the motion vectors play.

Two further pieces make it read as a codec rather than as a blur: a share of the
blocks lose their vectors and freeze, and a residual carries the difference
between the two frames' local contrast through a dead-zone quantiser.

When the trigger is released, the effect cross-fades from the frozen, smeared
image back to the clean render over a configurable duration.

For the full account, see [`docs/CODROPS-ARTICLE.md`](docs/CODROPS-ARTICLE.md).
Performance measurements are in [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).
