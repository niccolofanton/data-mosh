# Data Mosh

A real-time WebGL demo of a **datamosh** effect, built with Vite,
react-three-fiber and the `postprocessing` library.

You walk around a small 3D room; while you hold the trigger, the image stops
being refreshed and starts smearing along your camera movement, the way a
compressed video looks when its keyframes are dropped.

## Getting started

```bash
pnpm install
pnpm dev            # dev server on http://localhost:5173
```

| Command        | What it does                                               |
| -------------- | ---------------------------------------------------------- |
| `pnpm build`   | ESLint, `tsc --noEmit`, then a production build into `dist/`|
| `pnpm preview` | Build, then serve `dist/` locally                           |
| `pnpm lint`    | ESLint over `src/`                                          |

> The build is a plain static bundle, so there is no server runtime: deploy the
> contents of `dist/` to any static host.

## Controls

| Input                          | Action                       |
| ------------------------------ | ---------------------------- |
| `W` / `A` / `S` / `D`          | Move the camera              |
| Mouse move                     | Look around                  |
| `Space`, or hold mouse / touch | Activate the datamosh effect |

A Tweakpane panel exposes every parameter live, grouped into folders: the
technique and its recovery time, the macroblock grid, the residual, and the
diagnostics. The debug views also have deep links: `?debug=motion`,
`?debug=frames`.

## Layout

```
index.html        the page: metadata, asset preloads, every style, the entry point
src/
  main.tsx        builds the control panel, then mounts the scene
  controls.ts     the Tweakpane panel and every value it drives
  scene/          the room, the subject, the shots, the camera rig
  datamosh/       the effect: manager, velocity pass, shaders, debug views
  state/          stores shared by scene and pipeline: shot, cut, input
archive/          removed from the demo, kept for reference. See archive/README.md
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

For the full account, see the Codrops article,
[Feeding a Decoder the Wrong Frame](https://tympanus.net/codrops/?p=).
