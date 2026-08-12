# Performance audit

Ten parallel audits over disjoint areas of the codebase, followed by an
implementation pass under one hard constraint: **the rendered image must not
change**. Every applied change is verified pixel-identical, not argued to be.

Restore point: commit `5742e9c`, plus `../data-mosh-backup-20260812.tar.gz`.

---

## How "pixel-identical" was established

The effect is a feedback loop driven by a wall clock, so two runs of the *same*
code diverge — different frame deltas produce a different picture. Nothing can
be compared until that is removed.

`.perf-audit/mosh-verify.mjs` replaces the clock. `performance.now()` becomes a
counter, `requestAnimationFrame` becomes a queue, and frames happen only when
the harness pumps one. The whole history is then a pure function of the frame
count. Two independent page loads of the same build produce **bit-identical
PNGs across 690 frames**, feedback chain included — so any hash that moves after
an edit is a real change to the image.

The protocol: 90 frames of settling in the room shot, then the trigger goes down
and stays down for 600 more, hashing every 60. That covers the idle path, the
gesture path, and the scene cuts between shots. The same init script wraps the
GL context and counts what each frame actually submits.

Every change below was run through it. The eleven hashes are unchanged from the
pre-audit baseline.

---

## What the measurements said

Taken at 3840×2160 (8.3 MP), the closest this machine gets to the 4112×2406 the
author's display runs at.

| | before | after |
|---|---|---|
| idle, mean | 13.38 ms | **8.33 ms** |
| idle, median | 15.70 ms | **8.30 ms** |
| gesture, mean | 19.54 ms | 18.88 ms |
| framebuffer binds / frame, idle | 15.4 | **4.4** |

Idle went from ~75 fps to the 120 Hz cap. The gesture path is essentially
unchanged, which is correct — that is the state where the work is genuinely
needed.

Three things the profile ruled out before any code was touched, each measured
rather than assumed: **zero** shader recompiles, **zero** texture
reallocations and **zero** garbage collections across hundreds of gesture
frames. The mosh median equalled the idle median, so per-frame JavaScript was
never the cost. Cost scales with pixels — flat to ~1 MP, then a cliff — which
is what pointed the work at passes and bandwidth rather than at the frame loop.

---

## Applied

### Pipeline (`41dc30f`)

The datamosh pass ran full-screen on every frame even when its shader's first
statement is `outputColor = inputColor; return`. With `BlendFunction.SRC` that
is a bit-exact reproduction of its own input, and since this is a press-and-hold
gesture it describes most frames. It now switches off with `recover` — and
because it is the only thing in the chain that samples depth, the composer's
per-frame full-screen depth blit switches off with it. Those two are the whole
of the idle improvement above.

Also gated: the keyframe copy (nothing samples it — the I-frame is expressed by
the `uKeyframe` branch in the shader; it existed only to fill a debug preview
that is off by default), and a debug escape hatch that could rasterise the scene
a second time for a view that is not shown.

### Scene and velocity pass (`3cc6a6f`)

The dancer rig arrives from the FBX **with no index buffer** — every triangle
written out with three vertices of its own, 84,816 vertices for 28,272
triangles on the body mesh. Each vertex is therefore skinned three times over,
and each of those runs is sixteen fetches into the bone texture: about a million
vertex-shader invocations per pass across seven dancers, doubled while the
velocity pass measures. `mergeVertices` at 1e-6 welds only bit-identical
vertices, so the triangles it emits are the same triangles in the same order.
The `uv` attribute is deleted first — no material on these meshes carries a map,
so it is never declared in the shader.

The velocity pass draws the same graph a second time, which made three re-derive
every world matrix in a ~955-node scene, 903 of them bones belonging to shots
that are off screen and provably frozen.

The bone-matrix mirror is now gated on the source texture's version, which three
bumps inside `Skeleton.update()` — so an unchanged version means the mirror
already holds this frame's pose.

### Delivery and input (`95d34b4`)

`distDir: 'out'` pointed the webpack build directory at the same folder
`output: 'export'` writes the site to. Build internals were landing inside the
deploy artefact: `out/cache` alone had reached **56 MB** of webpack `.pack.gz`,
next to `out/server`, `out/types` and megabytes of unminified dev chunks — and
the README says to upload the contents of `out/`. After the fix, `out/` is 14 MB
of export and `.next/` holds the 182 MB of build state, separately.

`r3f-perf` was a static import, so it and its graph — stitches, radix icons,
zustand, drei's `Text`, troika-three-text, a base64 font — were in every first
load, with stitches injecting a stylesheet at module scope, for a control that
defaults to off inside a collapsed folder. Now loaded on demand: **none of the
13 initial chunks contains it.**

The blanket non-passive `touchmove` on `document` is now bound to the canvas.
The flag is required for `preventDefault` to work, but on `document` it opted
the entire page out of the compositor fast path — every touch move waiting on a
main thread busy with the composer chain — and it meant the control panel could
never be scrolled. `touchstart` on the canvas and `touchend`/`touchcancel` are
now explicitly passive; none of them call `preventDefault`, and Chrome's
passive-by-default intervention does not cover element targets.

Smaller, same commit: the resize effect depends on the two dimensions rather
than on r3f's `size` object, which carries `top`/`left` and so re-fired on every
scroll tick; `CameraController` takes a selector instead of subscribing to the
whole r3f store; the Lenis configuration callback moved to module scope, where
it stops re-subscribing every render and rebuilding its easing closure on every
scroll frame; `MorphingShape` writes its Euler once instead of twice, halving a
quaternion recomputation; both startup timeout pairs are cleared on unmount; six
unreferenced create-next-app SVGs are gone; and a `preconnect` warms the gstatic
connection the Draco decoder needs.

---

## Tried, measured, reverted

Kept here because the reasoning was sound and only measurement settled it.

**An R8 colour attachment on the stable depth target.** That target is only ever
the destination of a depth-only blit, so its full-resolution RGBA8 colour plane
is ~28 MB of VRAM nothing reads. Isolated measurement put the gesture path at
22.5 ms with it against 19.9 ms without: an R8 + DEPTH32F pair appears to cost
the driver its fast blit path, which is worth more than the memory.

**Rewinding `info.render.frame`** so three's per-frame dedupe would skip the
duplicate `skeleton.update()` and its ~90 KB of bone-texture re-upload. It does
not work: `projectObject` reads the counter *before* `render()` increments it,
and every effect pass in between is itself a `renderer.render` that bumps it, so
the required offset depends on which passes happen to be enabled. Measured no
change; removed rather than propped up. The duplicate upload is confirmed real —
21 uploads per texture shape per frame, i.e. three per rig — and is still there.

---

## Not applied: would change the image

Listed because each is a genuine saving and the trade should be a decision, not
an accident.

- **The motion field is constant per macroblock and is recomputed 64× inside
  each one.** ~600 scalar ops plus 2 texture fetches per fragment that could be
  one small prepass. Bit-exactness is achievable but it is architecture work,
  and it is by a wide margin the largest item on the list.
- **The velocity buffer runs at full resolution while the effect reads 1.56 % of
  its texels** (one per 8×8 macroblock). Halving it is 4× the fill and 4× the
  VRAM, but `NearestFilter` means a different grid picks different texels.
- **The keyframe / feedback / trail chain runs at CSS pixels while the composer
  runs at drawing-buffer pixels.** At DPR 2 that is a quarter of the pixels of
  the image it stores — the comment calls it "a full resolution history", and it
  is not. Fixing it *or* codifying it both change the picture. Worth a decision:
  right now the resolution policy is accidental.
- **The feedback copy could be a buffer rotation** rather than a full-bandwidth
  blit, and the trail copy likewise; together with the terminal copy that is
  three full-frame copies per frame. Output-neutral in principle, but it reaches
  into composer internals and needs an A/B before shipping.
- Half-float cloth positions, fewer solver iterations, single-sided cloth,
  `#define`-gating the found-footage grade chain at its neutral defaults, and
  reassociating the velocity shader's `mat4 × mat4` products — all real, all
  visible or sub-ULP-in-a-feedback-loop.

## Not applied: asset pipeline

Byte-verified but outside a code change, so left for a deliberate step.

- **The room GLB is 99.7 % PNG.** Its four 2048² baked textures re-encoded as
  lossless WebP take the file from 4.39 MB to 2.44 MB — the decoded RGB buffers
  hash identically, so this is lossless in the strict sense.
- **The Draco decoder is ~100 KB fetched from a third origin to decompress
  7,700 bytes** of geometry, and it blocks parsing of the file that gates the
  canvas. The preconnect helps; dropping Draco for meshopt (already bundled)
  would remove the round trip entirely.
- **The dancer FBX is 3.34 MB served uncompressed**, plus ~23 KB gzip of
  `FBXLoader` + `fflate` that exist for that one file. A data-lossless GLB is
  1.41 MB brotli'd.
- **Nothing sets compression or cache headers for `public/`.** Under
  `output: 'export'` there is no server to apply them, so a `_headers` or
  `vercel.json` is the only place: the `.hdr` and `.fbx` alone are ~2.2 MB of
  free brotli, and repeat visitors currently revalidate 8.9 MB.

---

## Correction to an early reading

The first baseline was captured while ten audit agents were saturating the
machine, and it showed the gesture path at a 42.6 ms p95 with periodic stalls.
Re-measured on a quiet machine, the same build gives 10.3 ms. **That p95 was
contention, not the code**, and the "periodic spikes" it implied do not exist.
The numbers in this document are all from the quiet machine.
