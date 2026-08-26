# Feeding a Decoder the Wrong Frame

A real-time datamosh effect in WebGL. Not a glitch filter over a finished
render: an actual inter-frame decoder loop, built out of the pieces a video
codec is made of — motion vectors, macroblocks, residuals — and then fed the
wrong reference frame on purpose.

```text
new frame = warp(previous frame, motion vectors) + residual
```

Source project for the Codrops article
**[Feeding a Decoder the Wrong Frame](https://tympanus.net/codrops/?p=)**
by [Niccolò Fanton](https://niccolofanton.dev).

![The effect running in the full project](article/html/video/hero.jpg)

## What's in here

| Folder | What it is |
| --- | --- |
| [`full-project/`](full-project) | **The demo Codrops deploys.** The complete piece: a loaded room, a dancer rig, an image-based sky, a camera controller, the debug frame buffers and a live parameter panel. React + react-three-fiber. |
| [`demo/`](demo) | The same pipeline with everything else taken away: plain three.js, six procedural shots, no downloaded assets. This is the code the article walks through, line for line. |
| [`article/`](article) | The article itself — the prose, the figures, and the eight clips the published page ships instead of live WebGL contexts. |

Both projects are Vite + TypeScript and run the same way:

```bash
pnpm install
pnpm dev
```

`pnpm build` produces a static `dist/`. Both are configured with Vite's
`base: './'`, so the build works from any subdirectory rather than only from a
host root.

## Which one to read

Read `demo/` first. It is the article's argument in about 1,200 lines with nothing in
the way: `main.ts` owns the renderer and the shot schedule, `scenes.ts` is six
scenes chosen for the *kind* of motion each one produces, and `datamosh/` is
the pipeline — a velocity pass, a feedback loop, and one fragment shader where
the decode actually happens.

`full-project/` is the same `datamosh/` folder, wrapped in the scene the hero
video shows. It is the more interesting thing to *look* at and the harder thing
to read, because most of its extra code is about the room, the dancers and the
camera, not about the effect.

## How it works, in one paragraph

Every frame, a velocity pass renders each object's screen-space motion into its
own buffer. While the trigger is held, the pipeline stops presenting the newly
rendered image and instead resamples the *previous* output along those vectors —
the same prediction step a decoder performs on a P-frame — and adds a quantised
residual on top. Because the reference frame is never refreshed, the error
compounds: detail from a shot that is no longer on screen gets dragged around by
motion belonging to a shot that is. The article takes that sentence apart over
nine figures.

## The pipeline, file by file

| File (identical in both projects) | Responsibility |
| --- | --- |
| `datamosh/velocity-pass.ts` | Per-object screen-space velocity, into a half-float target |
| `datamosh/manager.ts` (`index.ts` in `demo/`) | The feedback lifecycle: history targets, keyframes, recovery |
| `datamosh/effect.ts` | The `postprocessing` effect wrapper and camera reprojection state |
| `datamosh/shaders.ts` | The decode loop, the residual, the macroblock grid, the diagnostics |
| `datamosh/debug-view.ts` | The motion-vector and frame-buffer overlays |

Velocity and history targets use half-float precision where the device supports
it, and fall back to camera-derived motion with an 8-bit history where it does
not.

## Credits

- Sky: `kloppenheim_puresky` from [Poly Haven](https://polyhaven.com), CC0.
- Room model (`backroom-transformed.glb`) and dancer animation
  (`thriller.fbx`): **TODO — add the source and licence before publishing.**
- The effect is an original implementation. Datamoshing as a technique comes
  out of artists working with real compressed footage — Takeshi Murata, Sven
  König and Bertrand Planes among the earliest; what is new here is rebuilding
  the mechanism inside a renderer rather than recovering it from a damaged file.

## Licence

[MIT](LICENSE).
