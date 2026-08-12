# Data Mosh

A real-time WebGL demo of a **datamosh** effect, built with Next.js 14,
react-three-fiber and the `postprocessing` library.

You walk around a small 3D room; while you hold the trigger, the image stops
being refreshed and starts smearing along your camera movement, the way a
compressed video looks when its keyframes are dropped.

## Getting started

```bash
pnpm install
pnpm dev          # dev server on http://localhost:3000
```

Other scripts:

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `pnpm build`       | Static export of the site into `out/` (`output: 'export'`) |
| `pnpm preview`     | Build, then serve `out/` locally                           |
| `pnpm serve`       | Serve an already built `out/`                              |
| `pnpm lint`        | ESLint over `src/`                                         |
| `pnpm lint:fix`    | ESLint over `src/` with autofix                            |

> The app is a fully static export, so there is no server runtime: deploy the
> contents of `out/` to any static host.

## Controls

| Input                          | Action                          |
| ------------------------------ | ------------------------------- |
| `W` / `A` / `S` / `D`          | Move the camera                 |
| Mouse move                     | Look around                     |
| `Space`, or hold mouse / touch | Activate the datamosh effect    |

A [Leva](https://github.com/pmndrs/leva) panel in the top-right corner exposes
the effect parameters live: the fade-back duration, the data corruption toggle
and its intensity / density / animation settings, camera auto-rotation, and a
performance overlay.

## How it works

The scene is rendered through an effect composer:

1. A **render pass** draws the room normally.
2. **Copy passes** capture the current color frame and a depth frame, plus the
   effect's own previous output.
3. The **datamosh effect** decides, every frame, what to show.

While the trigger is held, the effect stops reading the freshly rendered frame.
Instead it re-samples its own previous output and displaces the lookup by the
camera movement of that frame, scaled by the per-pixel scene depth: near pixels
slide more than far ones, so the image keeps "moving" with the camera even
though no new geometry is ever drawn. This is the analogue of removing the
I-frames from a compressed video and letting only the motion vectors play.

On top of that, randomized blocks are periodically corrupted — pixelated,
colour-shifted and dusted with noise — to mimic decoder garbage.

When the trigger is released, the effect cross-fades from the frozen, smeared
image back to the clean render over a configurable duration.
