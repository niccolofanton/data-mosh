# Building a Real-Time Datamosh Effect in WebGL

**Dek (20 words):** A room that melts when you hold the trigger: how a fake video decoder drags one shot into the next.

**Tags:** WebGL · Three.js · Shaders · Post-Processing · Glitch · react-three-fiber

---

We render a room, measure how every pixel moved, snap that motion onto a macroblock grid, and hand it to the wrong picture.

It runs on three.js and react-three-fiber, as one custom `Effect` in a pmndrs `postprocessing` chain.

The quickest way in is the demo.

[VIDEO V1: hero clip, 6s, GUI hidden. Starts on the room shot, camera walking forward and strafing right, clean image. At 1.0s the trigger goes down and holds: the edit cuts to the dancer limbo, and the room you were just watching is dragged across it in sliding 8 px tiles. Released at 5.0s, the picture settles back to clean by 5.4s.]

Nothing in that clip is a video file. The cut is the camera jumping, and the smear on top of it is the last frame refusing to leave.

I have been collecting poor images for years. Bodycam uploads, camcorder tapes, dashcam clips: footage where the rolling shutter and the auto exposure do more work than the operator.

Degradation reads as evidence. If a picture is this damaged, somebody must have been there, and nobody had time to clean it up.

The datamosh sits at the end of that chain, and it is the one artefact there that needs a decoder to be wrong.

The demo carries a whole found-footage camera simulation as well, neutral until you open its folder. This article leaves it alone.

Every path in the code comments below is relative to `src/`, in the repo linked at the top of this page. Every control named below lives in the `Data Mosh` panel.

## The Decoder Loop

A P-frame carries almost no picture. It carries one motion vector per macroblock and a correction, and the decoder builds the rest from what it already holds:

`new = warp(previous, mv) + residual`

The demo owns all three terms. `warp` is a block vector snapped to the sub-pixel grid a codec stores.

`previous` is `pFrame`, the effect's own last output. `residual` is the high-frequency part of the incoming picture.

Take the keyframes away and the loop keeps running against a `previous` that belongs to another shot. The shader here is a decoder that has been lied to, and it keeps working anyway.

The two canonical techniques break a different half of that line, and they sit as a union type at the top of the effect file:

```ts
// datamosh/effect.ts (simplified)
// Each technique breaks a different half of the decoder loop:
// new = warp(previous, mv) + residual
export type MoshMode =
  // I-frame removal: the motion stays right, the texture is from another shot.
  | "melt"
  // P-frame duplication: one motion field, re-applied to its own result.
  | "bloom";
```

Melt keeps measuring motion honestly and lands it on a picture from another shot: right motion, wrong texture. A cut makes it legible, which `Cut On Trigger` supplies on the frame the gesture starts.

The edit rotates through three shots: a room, a limbo with seven dancers, a sheet of cloth.

Swinging the camera around one room leaves the walls and the palette in agreement, and the melt then reads as a glitch on a single image.

Bloom captures the field once and re-applies it to its own result, so the displacement compounds at roughly n·mv and the residual climbs towards clipping.

[VIDEO V2: A/B pair, two 5s clips side by side, both starting on the room shot from the same camera pose, GUI hidden. Left, `Technique` at `Melt (I-frame removal)`: the edit cuts and the tiles slide with plausible motion while the texture on them belongs to the shot that is gone. Right, `Technique` at `Bloom (P-frame dup)`: no cut, one field re-applied to itself, the displacement compounding and the picture climbing towards white.]

## Where the Motion Comes From

`Motion Source` offers two fields. `Velocity Buffer` measures everything that moved. `Camera Only` knows the camera alone and costs no second draw.

The two are alternatives. Summing them would count the camera twice, so the reprojection takes over only where the velocity pass rasterised nothing.

That reprojection rides on three matrices, refreshed once per frame in `updateReprojectionMatrices`:

```ts
// datamosh/effect.ts (simplified)
// (P * V)^-1 = V^-1 * P^-1, and V^-1 is the camera's world matrix.
uInvViewProjection.copy(camera.matrixWorld)
  .multiply(camera.projectionMatrixInverse);

// The previous transform, complete.
uPrevViewProjection.multiplyMatrices(
  projection, scratchMatrix.copy(previousMatrixWorld).invert());
// The previous orientation, carried to the current position.
camera.getWorldPosition(scratchPosition);
scratchMatrix.copy(previousMatrixWorld).setPosition(scratchPosition);
uPrevViewProjectionRot.multiplyMatrices(projection, scratchMatrix.invert());
```

The shader unprojects a pixel with the depth buffer and projects it twice: with the full previous transform, and with the previous orientation carried to the current position.

The difference between those two results is the parallax alone, so `Parallax (Cam Src)` weights that term and nothing else. Zero is rotation only, one is physically correct.

After a cut, the previous pose is the current pose, so the motion comes out at exactly zero.

The measured field costs a second draw of the whole scene through `scene.overrideMaterial`. Its fragment shader keeps the perspective divide per fragment, because a divided value interpolates wrongly:

```glsl
// datamosh/velocity-pass.ts (simplified)
vec2 ndcCurrent  = vClipCurrent.xy  / vClipCurrent.w;
vec2 ndcPrevious = vClipPrevious.xy / vClipPrevious.w;
vec2 velocity = (ndcCurrent - ndcPrevious) * 0.5;   // ndc [-1,1] to uv [0,1]

if (vClipPrevious.w <= 0.0) velocity = vec2(0.0);   // behind the previous plane
gl_FragColor = vec4(clamp(velocity, -uMaxVelocity, uMaxVelocity), 0.0, 1.0);
```

Alpha 1 marks coverage. `MAX_VELOCITY` clamps at 0.25 uv per frame, since a quarter of the screen in one frame is beyond anything legitimate.

The filter is `NearestFilter`. Interpolating across a silhouette mixes two uncorrelated motions and returns an alpha of 0.5, which means nothing.

Rigged dancers need a previous pose as well, and three rewrites the bone texture in place, so the pass mirrors it under a version guard.

I found that out watching a T-shaped patch of vectors sit nowhere near a dancer.

`Show Motion Vectors` draws the field the effect is about to use, after the block quantisation and the skip, and it opens directly at [`?debug=motion`](https://data-mosh-demo.vercel.app/?debug=motion).

[VIDEO V3: 5s, the dancer limbo, camera locked off, `🔬 Pipeline` folder visible. `Show Motion Vectors` goes off to on at 1.0s and the picture is replaced by the block field: hue is direction, brightness is magnitude, grey is a block standing still, macroblock grid on top. The seven dancers glow in their direction colours while the floor and the columns stay grey.]

### Continuous Warp

Everything that reads as compression happens on a grid, built at the top of `mainImage`. `Macroblock (px)` defaults to 8, because a DCT residual is coded in 8x8 tiles:

```glsl
// datamosh/shaders.ts (simplified)
vec2 blocks  = max(resolution / max(uBlockSize, 1.0), vec2(1.0));
vec2 blockId = floor(uv * blocks);
vec2 blockUV = (blockId + 0.5) / blocks;

// uBlockiness at 0 reads the vector per pixel, at 1 at the block centre.
vec2 mvUV = mix(uv, blockUV, uBlockiness);
// ...
vec3 moshed = sampleHistory(uv - motion);   // one offset for the whole block
```

With `Block Quantise` at 0 the vector is fetched per pixel, and the room stretches as one continuous liquid with no seam anywhere in it.

[VIDEO V4: 4s, the room shot, `Block Quantise` held at 0 for the whole clip, `Cut On Trigger` off, trigger held from 0.3s, camera panning slowly left at constant speed, `🧱 Macroblocks` folder visible. The room smears as one liquid sheet, with no tile edge anywhere.]

### Quantised Blocks

At 1 the vector is read once at the block centre and applied to all 64 pixels of the tile, so tiles slide as rigid units and disagree along every edge.

`Vector Precision` snaps that vector to half a pixel, the MPEG-4 Part 2 grid, which is what makes neighbouring blocks travel visibly different distances.

[VIDEO V5: 4s, identical camera path, identical hold and identical panel state to V4, `Block Quantise` at 1. The same smear breaks into hard 8 px tiles that slide by different amounts and tear along straight seams.]

## The Residual

A decoder receives its residual from an encoder that knew the true next frame. We have neither: no encoder, and a reference belonging to a shot that is already gone.

So we take the high frequencies of the incoming picture and transmit only the ones the prediction lacks.

Inside `residualAt`, both pictures go through the same four-tap box blur, and the difference against it is the high pass:

```glsl
// datamosh/shaders.ts (simplified)
// 1.5 px: wide enough to keep the contours, tight enough to leave the colour.
vec2 r = vec2(1.5) / resolution;
vec3 lowCurrent = texture2D(inputBuffer, uv + vec2(r.x, 0.0)).rgb;
// ... three more taps, and the same four around uv - motion into lowPredicted

// Both high passes, as luminance.
float hc = dot(current   - lowCurrent   * 0.25, vec3(0.299, 0.587, 0.114));
float hp = dot(predicted - lowPredicted * 0.25, vec3(0.299, 0.587, 0.114));
```

The luma weights are there because a codec quantises chroma far more coarsely. An RGB residual deposits the new shot's palette onto the old picture.

The radius took two attempts. At half a macroblock the new shot bled its colour through, and the held frame looked semi-transparent.

The gate and the quantiser close the function, and the caller adds the result to the warped frame:

```glsl
// datamosh/shaders.ts (simplified)
// Transmitted only where the incoming frame has more local contrast.
float residual = abs(hc) > abs(hp) ? hc - hp : 0.0;

// Dead zone quantiser, as in a real encoder: flat areas send nothing.
float steps = max(uResidualQuant, 1.0);
return vec3(floor(residual * steps + 0.5) / steps);
// ... and at the call site, gain only; the full line adds the skip and the fade:
moshed += residualAt(uv, motion, inputColor.rgb, moshed) * uResidualGain;
```

**Old low, new high, zero where they agree.**

Why does a term re-added on every frame stop growing? The answer arrives by elimination, from three versions that kept growing.

The first version was a plain high pass of the incoming frame. The same contour reaches the loop every frame and integrates until the edges clip, however low the gain.

The second was the full prediction error, which is what a real encoder transmits. That is precisely the correction that lands a decoder back on the true frame.

I held the trigger, watched the ghosts of the new shot arrive, and then watched them win.

An encoder computes its residual against the reference the decoder will hold. Handing it a wrong one is what produces the ghosts in the first place.

[VIDEO V6: A/B pair, two 5s clips side by side, both starting on the room shot from the same camera pose, `Cut On Trigger` on so the gesture cuts to the dancer limbo, trigger latched from 0.5s to 4.5s in both, GUI hidden. Left is the shipped gate: the dancers print as edges over the dragged room and then stop changing. Right is the full prediction error: those ghosts fill in, and by 2.5s the picture has converged onto the clean limbo while the trigger is still down.]

The third version was the plain difference `hc - hp`, ungated, and it ate the picture more quietly.

Rearranged with a gain `g`, that version expands to `predicted*(1 - g) + blur(predicted)*g + g*hc`. The first two terms are a blur re-applied sixty times a second, an inverted unsharp mask.

Wherever the new shot was flat they were the only terms left, and the held picture was smoothed into mush.

[VIDEO V9: A/B pair, two 4s clips side by side, both starting on the room shot with a large flat wall filling the frame, `Cut On Trigger` on, trigger latched for the whole take, GUI hidden. Left is the ungated difference: the held picture flattens and its contours go, quietly, over about three seconds. Right is the shipped gate: the same contours are still standing at the end.]

The magnitude gate deletes those two terms. Where the prediction already carries the stronger edge, the term is zero, so it can never integrate.

The cost is that the residual only adds contrast, carries no colour of its own, and spends eight texture fetches per pixel.

`Quantiser Steps` is 14, coarse enough that flat areas send nothing. `Residual Gain (x10)` carries ten times the shader value, so the slider resolves down to 0.001.

## The Complete Moshing Step

Here is the whole per-pixel step, with the lens remap, the debug branch, the mismatch term and the zero-motion exit taken out:

```glsl
// datamosh/shaders.ts (simplified)
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // A recovered picture, or a keyframe, is the clean render.
  if (uRecover >= 1.0 || uKeyframe > 0.5) { outputColor = inputColor; return; }
  // The fade scales the prediction, so the smear decelerates and comes to rest.
  float warp = 1.0 - uRecover;

  // macroblock grid
  vec2 blocks  = max(resolution / max(uBlockSize, 1.0), vec2(1.0));
  vec2 blockUV = (floor(uv * blocks) + 0.5) / blocks;
  vec2 mvUV    = mix(uv, blockUV, uBlockiness);
  // one vector: measured where there is coverage, analytic elsewhere
  vec4 measured = texture2D(uVelocity, mvUV);
  float useMeasured = uMotionSource * step(0.5, measured.a);
  vec2 motion = mix(cameraMotionAt(mvUV), measured.xy, useMeasured) * uMotionGain * warp;

  // sub-pixel snap, then the blocks that stay put
  float mvSteps = max(uMvPrecision, 1.0);
  vec2 motionPx = motion * resolution;
  motion = mix(motionPx, floor(motionPx * mvSteps + 0.5) / mvSteps, uBlockiness) / resolution;
  float skip = (1.0 - smoothstep(uSkipThreshold * 0.5, uSkipThreshold,
                                 length(motion * resolution))) * uBlockiness;
  motion *= 1.0 - max(skip, lostRegion(blockUV).x * uBlockiness);

  // warp the previous output, add the residual of the new one
  vec3 moshed = sampleHistory(uv - motion);
  moshed += residualAt(uv, motion, inputColor.rgb, moshed) * uResidualGain * (1.0 - skip) * warp;
  outputColor = vec4(mix(clamp(moshed, 0.0, 1.0), inputColor.rgb, uRecover), 1.0);
}
```

`uRecover` is the scalar the gesture produces, 0 while the trigger is down. Scaling `warp` by it pulls the motion and the residual down together, so a released smear comes to rest.

One elision worth naming: the real `skip` guards a zero `Skip Below (px)`, because a `smoothstep` with equal edges is undefined in GLSL and returns 1 on some drivers, which freezes the entire frame.

## Why the Held Frame Dissolved

In an early build, holding the trigger with the camera still cost the frozen picture its definition frame by frame, until the contours were gone.

[VIDEO V7: A/B pair, two 4s clips side by side, the room shot, identical camera pose and identical 3.7s hold, hands off the mouse so the camera only drifts, GUI hidden. Left, a build with `sampleHistory` replaced by a plain `texture2D(pFrame, uv - motion)`: the held frame goes soft after a second and ends as fog. Right, the shipped Catmull-Rom lookup: the same frame keeps its edges for the whole hold.]

This is because the chain re-reads its own output while the vectors are snapped to half a pixel. The offset is therefore guaranteed to be fractional, and every bilinear fetch averages two texels, sixty times a second.

The fix is `sampleHistory`, the function `mainImage` now calls where it used to fetch, a Catmull-Rom lookup of nine bilinear fetches covering a 4x4 footprint:

```glsl
// datamosh/shaders.ts (simplified)
vec2 samplePos = uv * resolution;
vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
vec2 f = samplePos - texPos1;

vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);   // the two central weights
vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
vec2 w12 = w1 + w2;                         // folded into one bilinear fetch
vec2 offset12 = w2 / max(w12, vec2(1e-5));  // 1e-5 guards the divisor
// ... nine weighted fetches of pFrame accumulate into result
```

The negative lobe reconstructs an edge where bilinear averages it away. Every temporal anti-aliasing history buffer carries this filter, for this same reason.

The result is clamped to 0..1, because that lobe can overshoot, and an overshoot fed back into itself diverges.

Above it sits a cheap exit. Below 0.001 pixels of motion the shader reads its own texel directly, which covers most of the frame whenever the camera is close to still.

## Losing the Vectors

A dropped packet takes out whatever run of macroblocks it happened to carry, for as long as the next one takes to arrive, and then it is somewhere else entirely.

My first version was a per-block coin flip on a fixed hash of the block id. The same blocks then sit still for the whole gesture, painting long straight streaks that read as a broken shader.

`lostRegion` lays up to four layers of cells over the frame, each finer than the last, each on its own clock:

```glsl
// datamosh/shaders.ts (simplified)
for (int i = 0; i < 4; i++) {          // constant bound: the loop has to unroll
    float fi = float(i);
    if (fi >= uLostLayers) break;
    vec2 cells = vec2(7.0, 5.0) * (1.0 + fi * 1.6) / max(uLostScale, 0.05);
    vec2 cellId = floor(uv * cells);
    float t = uTime / max(uLostLife, 16.0) + hash13(vec3(cellId, fi + 5.0));
    // ... a rectangle of random size and offset, per slot, then the duty cycle:
    if (fract(t) > 0.12 + hash13(vec3(cellId, floor(t) + 61.0)) * 0.45) continue;
}
```

A region lives a random fraction of its slot, so most of them blink out early and no streak has time to become a line. `max(uLostLife, 16.0)` floors that clock at about one frame.

`Lost: Outline` draws that field a pixel and a half wide whatever the size of the region, and [`?debug=lost`](https://data-mosh-demo.vercel.app/?debug=lost) opens on it.

[VIDEO V8: 5s, the room shot, camera panning slowly left, `Cut On Trigger` off, `🧱 Macroblocks` folder visible. `Lost: Outline` goes off to on at 1.0s over a clean picture and white rectangles start blinking in and out at four different sizes; at 2.5s the trigger goes down and holds, and blocks all over the frame stop moving while the rest of the picture smears past them.]

## Implementation Notes

One scalar per frame governs the chain. `recover` sits at 0 while the trigger is down and ramps back to 1 over `Recovery (ms)`, 370 by default.

The gating sits in the manager, immediately before `composer.render`:

```ts
// datamosh/manager.ts (simplified)
const moshing = recover < 1;
// The debug view is the other reason to run: it draws the field while idle.
this.moshPass.enabled =
  settings.effectEnabled && (moshing || settings.debugMotion);
// The only pass that samples depth, so the composer's blit goes with it.
this.renderPass.needsDepthBlit = this.moshPass.enabled;
this.effect.setMotionFrozen(bloom && moshing && !gestureStart);
```

Measured at 3840x2160 on a quiet machine, with every change verified pixel-identical by a deterministic harness, that gate took the idle frame from a 13.38 ms mean and a 15.70 ms median to 8.33 and 8.30.

Framebuffer binds went from 15.4 to 4.4 per frame.

The gesture path barely moved, 19.54 ms to 18.88 ms, which is the point: nothing was cut that the effect actually needed.

The gate is worth that much because the pass had been running full screen to reproduce its own input bit for bit, since its first statement is `outputColor = inputColor; return` and its blend function is `SRC`.

A second cut came from the geometry. The dancer FBX arrives with no index buffer, 84,816 vertices for 28,272 triangles on the body mesh alone, every position written out once per triangle that touches it.

Welding at 1e-6 leaves 14,294 unique positions, so each one had been skinned close to six times over.

Across seven dancers and every mesh they carry, that is 1,031,352 vertex shader invocations per pass, doubled while the velocity pass measures, and 173,656 after `mergeVertices`.

Rejected with a measurement: an R8 colour attachment would replace a 28 MB RGBA8 plane that nothing reads on the stable depth target, and it cost 22.5 ms against 19.9 ms on the gesture path.

Three traps, each worth half a day.

`EffectComposer.createDepthTexture` clones the depth texture, and `THREE.Texture.copy` copies the `Source` by reference, so the read and write attachments end up as the same image.

That is a `GL_INVALID_OPERATION` once per frame, forever, while the rendering looks fine. Still there in 6.39.1.

`readDepth` and `getViewZ` come free from `EffectMaterial`, and they return real data only if the effect declares `EffectAttribute.DEPTH`. Without it everything compiles, runs, and reprojects silently wrong.

`autoRenderToScreen` promotes the last pass to the one drawing on the canvas, and a `CopyPass` doing that writes to the canvas in place of its own target. Put the feedback capture last and it quietly stops happening.

Known limits: the motion field is constant per macroblock and gets recomputed 64 times inside each one, and the velocity buffer runs at full resolution while the effect reads 1.56% of its texels.

The feedback chain is sized in CSS pixels while the composer runs in drawing-buffer pixels, so at DPR 2 the history holds a quarter of the pixels of the image it stores.

`Lost: Outline` is redrawn by a later stage from its own clock, so it maps the shape of the loss, and the blocks frozen this frame are a different set.

There is no context-lost handling and no `prefers-reduced-motion`.

## Wrap-Up

[DEMO: live embed of https://data-mosh-demo.vercel.app/ with the `Data Mosh` panel open, `🎞️ Datamosh` and `🧱 Macroblocks` expanded.]

Five things worth doing to it. Push `Vector Precision` to `Quarter pel (H.264)` and `Macroblock (px)` to 16 for a modern-codec look.

Drive `Keyframe Every (ms)` from an audio beat so the picture pumps on the downbeat.

Feed the effect a video texture where the 3D scene is now, which is what the original technique acted on. Switch `Motion Source` to `Camera Only` on weak hardware and the second scene draw disappears.

Raise `MC Mismatch`, which lets a block fetch a neighbour's vector, and shorten `Lost: Refresh (ms)` for a corrupted transport stream.

What I do next is the prepass, which kills that recompute.

## Final Thoughts

pmndrs `postprocessing` is why a custom effect here is a subclass with a constructor and an update, and nothing more.

The shader's hash functions are Dave Hoskins style, cited as such in the source. The history filter is the Catmull-Rom tap arrangement every TAA implementation carries, and I took it from that tradition.

The dancer rig is Mixamo.

The rest of the credit goes to operators: bodycam, camcorder and dashcam uploads, all shot by someone with no interest in how the picture looked.

Their compression artefacts are the only reference material this effect has, and I have spent more hours scrubbing through them than writing the shader.

Sixty frames a second of committed nonsense, and the decoder never once complains. That part was fun.

---
---

# Self-audit

All figures below are counted by script over this file.

| Metric | Target | Actual |
|---|---|---|
| Prose words | 1400-2400 | 2299 |
| Code blocks | 8-14 | 10 |
| Median lines per block | ~9, none over 30 | 9.0, max 29 |
| Blocks under 10 lines | 60% | 60% (6/10) |
| Total code lines | n/a | 111 |
| Words per code line | 9+ (Article) | 20.7 |
| Median paragraph words | < 35 | 24 (5 paragraphs of 97 run over, max 37) |
| Median sentence words | ~16 | 15 |
| H2 count | 3-9 | 9 (+2 H3 for the A/B twins) |
| Consecutive code blocks | 0 | 0 |
| Blocks missing a file-path comment | 0 | 0 |
| Blocks missing a pointer sentence | 0 | 0 |
| First moving image, % into text | < 5% | 2.0% (45 words in) |
| Stack named within 35 words | yes | word 27 (three.js) |
| Visual elements | 1 per ~250 words | 10 (9 videos + the demo), 1 per 230 words |
| Largest gap between visuals | < 500 | 467 (across `Implementation Notes`) |
| Imperative headings | ≤ 1 | 0 |
| Question headings | ≤ 1 | 0 |
| Performance claims without a number | 0 | 0 |
| Long dashes in the article body | 0 | 0 (the only one in this file is the row naming the character) |
| Antithetical "it isn't X, it's Y" | 0 | 0 |
| Exclamation marks / emoji in prose | 0 | 0 |
| GUI controls named verbatim | ≥ 3 | 22 |
| A/B pairs | ≥ 1 | 5 (V2, V4/V5, V6, V7, V9) |

Two targets missed and left standing, with the reason. **Prose words** land at 2299 against a plan of 1850, which is the top of the observed house range and 62% above its median: the residual and the implementation notes carry the two things the corpus never has, a fully explained central mechanism and real numbers, and cutting either to hit a self-imposed count would trade the article's only competitive advantage for tidiness. **Five paragraphs** run between 36 and 37 words, where the house rule is 35.

# The eight checks

1. **Central mechanism explained, or elided?** Explained. `The Residual` prints the two high passes, the magnitude gate, the dead-zone quantiser and the luma weights, and `The Complete Moshing Step` prints the whole of `mainImage`.
2. **Effect shown in isolation, before/after?** Yes. V1 runs clean → held → recovered in one take, and V4/V5 are the same shot one control apart.
3. **A wrong result staged, with cause and fix?** Yes, three times. V6 (the residual converging on the clean render), V9 (the ungated difference flattening the picture) and V7 (the held frame dissolving), each with observation → cause → fix → block.
4. **A rejected alternative with the reason?** Yes, four. The R8 depth attachment (22.5 ms against 19.9 ms), the plain high pass (integrates until clipping), the full prediction error (converges on the clean render), the fixed per-block hash (long straight streaks).
5. **A gotcha worth half a day?** Yes. `depthTexture.clone()` sharing its `Source` by reference: `GL_INVALID_OPERATION` once per frame, forever, while the render looks correct. Verified present in the installed 6.39.1.
6. **A signature sentence?** Yes: *"Degradation reads as evidence. If a picture is this damaged, somebody must have been there, and nobody had time to clean it up."*
7. **Any snippet using a variable the narration never created?** No. Every identifier is defined in its own block, introduced in the prose (`recover`, `warp`, `pFrame`, `skip`), or is a uniform whose GUI control is named in the same section.
8. **Does the first body sentence paraphrase the dek?** No. The dek promises a melting room and a fake decoder; the first sentence is the verb chain that indexes the article: render → measure → snap onto a grid → hand to the wrong picture.

---

# SHOOTING LIST

Nine clips and one embed, in shooting order. Everything that runs on the shipped build comes first; the three pairs that need a temporary edit to the shader come last, and they share one patch session.

## What you need to know about the scene before you start

**The edit rotates through three shots**, `room` to `dancer` to `cloth` and back. A cut advances by one, and it only fires on a melt gesture with `Cut On Trigger` on. A fresh page load starts on `room`, so reaching the dancer limbo means triggering once, releasing, and waiting out the recovery.

**The shots are mutually exclusive.** The room holds no dancers. The dancer limbo holds seven figures at fixed positions, a floor, columns and a blurred sky, and no room at all. How many dancers are in frame is decided by framing alone, since there is no control for it.

**Only the room shot has a camera you can drive.** `W`/`A`/`S`/`D` walk in every shot, but the two limbo shots place the camera outright and hold it there, while the room shot eases the aim back towards a resting pose at about two percent per frame when nothing is driving it. That slow drift is the only sub-pixel motion available with your hands off the controls, and two clips below depend on it.

**Hiding the panel.** There is no hotkey. Click the `Data Mosh` title to collapse it into a pill, drag it out of frame by that same title, or hide `#data-mosh-controls` from the console. Where a clip calls for a folder to be visible, leave the panel where it sits and frame around it.

**Resetting between takes.** The panel persists in `localStorage` under `driftpane:data-mosh-v1:*`, so a reload keeps whatever you last set. Clear those keys and reload to get the schema defaults back.

**The FPS overlay** is `Show Performance` in the `⚡ Performance` folder, off by default. Leave it off.

**Global capture rules.** 1920x1080, 60 fps, MP4 H.264, muted, autoplay. No cursor, no browser chrome. For any clip that holds the trigger with the camera still, latch `Hold Trigger` so no hand rests on the pointer; the latch survives a window blur.

**Defaults to return to:** `Technique` `Melt (I-frame removal)`, `Cut On Trigger` on, `Motion Source` `Velocity Buffer`, `Motion Gain` 1.5, `Parallax (Cam Src)` 1, `Recovery (ms)` 370, `Keyframe Every (ms)` 0, `Macroblock (px)` 8, `Macroblocks` on, `Block Quantise` 1, `Vector Precision` `Half pel (MPEG-4)`, `Skip Below (px)` 0, `MC Mismatch` 0, `Residual Gain (x10)` 4, `Quantiser Steps` 14, `Lost: Density` 1, `Lost: Layers` 4, `Lost: Refresh (ms)` 50, `Lost: Size` 2.65, `Lost: Aspect` 0.75, `Lost: Variance` 1, `Lost: Outline` off, `Vector Scale (px)` 8.

---

## 1. V1 · the hero clip · intro, within the first 50 words

**What must be seen:** a walk through the room that looks like ordinary footage, then the shot tearing loose from itself: the room cuts away to a limbo of dancers while the picture you were just watching keeps sliding across it in tiles, before settling back to clean as if nothing had happened.

**Setup:** full frame, panel collapsed and out of shot. Fresh page load, so the edit is on `room`. Camera at eye height, a room corner in shot for a hard vertical edge to smear. All controls at their defaults.

**Action:** 0.0s to 1.0s hold `W` and strafe right with `D`, clean image. 1.0s press and hold, the cut to the dancer limbo fires on that frame. 1.0s to 5.0s keep strafing right while holding, so the smear has one constant direction. 5.0s release. 5.0s to 5.4s the recovery cross-fade. 5.4s to 6.0s clean.

**Duration:** 6s. A true loop is impossible here, since the camera has walked and cannot be back where it started. Fade the last 0.2s to black instead.

**Notes:** this is the first thing anyone sees and the only before and after of the whole effect, so the first and last second must be unambiguously clean. Frame so the incoming limbo has a dancer near the centre at 1.0s, which gives the cut a legible target.

## 2. V2 · melt against bloom · `The Decoder Loop`

**What must be seen:** on the left, tiles sliding with plausible motion while the texture on them belongs to a room that is no longer there. On the right, the same displacement stamped on itself again and again, stretching further every frame and washing towards white.

**Setup:** two clips, panel out of shot, both starting on `room` from the same camera pose, camera panning right at a constant slow rate. Clip MELT: `Technique` `Melt (I-frame removal)`, `Cut On Trigger` on. Clip BLOOM: `Technique` `Bloom (P-frame dup)`. Everything else default.

**Action (both, identical):** 0.0s to 0.5s clean, already panning. 0.5s press and hold. 0.5s to 5.0s keep panning and holding. 5.0s end while still holding.

**Duration:** 5s each, cut to the same frame count.

**Notes:** the two camera paths agree until 0.5s and diverge after it, because the melt cuts and the bloom stays in the room. That difference is half of what the pair is showing, so do not try to hide it. Do not release the trigger in either clip. If the bloom clips to white before 4.0s, lower `Motion Gain` to 1.0 in both and reshoot both.

## 3. V4 · continuous warp · `### Continuous Warp` · pairs with V5

**What must be seen:** the room stretching like a sheet of liquid, dragged sideways by the camera, with no tile edge anywhere in the picture.

**Setup:** full frame with the `🧱 Macroblocks` folder visible in shot. On `room`, medium shot with a room corner on the left. `Block Quantise` to 0, `Cut On Trigger` **off** so the smear reads as the deformation of a known room. Everything else default.

**Action:** 0.0s clean and still. 0.3s latch `Hold Trigger`. 0.3s to 4.0s pan slowly left with the mouse, about 25 degrees total, constant speed. 4.0s end while still latched.

**Duration:** 4s.

**Notes:** V5 has to repeat this pan exactly, so keep it slow and even, and do not reload between the two takes. If the two pans do not match, reshoot both.

## 4. V5 · quantised blocks · `### Quantised Blocks` · twin of V4

**What must be seen:** the identical movement, now built from hard 8 px tiles that slide by visibly different amounts and tear open straight seams between neighbours.

**Setup:** identical to V4 in every respect, panel included. `Block Quantise` back to 1. Nothing else changed.

**Action:** identical to V4, second for second.

**Duration:** 4s, same frame count as V4.

**Notes:** shoot immediately after V4 without reloading and without touching the camera. Composite side by side, hairline gap, no burned-in labels. Deliver one MP4.

## 5. V8 · the lost regions · `Losing the Vectors`

**What must be seen:** white-bordered rectangles blinking on and off across a clean picture at four different sizes, and then, once the trigger goes down, blocks all over the frame standing still while the picture smears past them.

**Setup:** full frame with the `🧱 Macroblocks` folder visible in shot. On `room`, framing a wall with high-contrast detail. `Lost: Outline` off to on at 1.0s, `Cut On Trigger` off, every lost control at its default.

**Action:** 0.0s to 1.0s clean picture, no outline. 1.0s tick `Lost: Outline`, rectangles start blinking. 1.0s to 2.5s clean picture with the overlay only. 2.5s press and hold to the end, panning slowly left.

**Duration:** 5s.

**Notes:** the overlay is drawn by a later stage on its own clock, so the outlined rectangles show the shape and the rhythm of the loss, while the blocks frozen in that frame are a different set. Do not cut the clip in a way that promises they line up. One control moves per clip: leave `Lost: Density` alone.

## 6. V3 · the motion field · `Where the Motion Comes From`

**What must be seen:** the picture replaced by a map of movement, the row of dancers blazing in hue-coded blocks against a dead grey floor and columns, with the macroblock grid ruling the whole frame.

**Setup:** full frame with the `🔬 Pipeline` folder visible in shot. Get to the dancer limbo first: from a fresh load, trigger once, release, and wait for the recovery to finish. Then `Show Motion Vectors` off to on at 1.0s, `Vector Scale (px)` at 8.

**Action:** 0.0s to 1.0s the clean limbo, camera locked, dancers moving. 1.0s tick `Show Motion Vectors`. 1.0s to 5.0s hold on the debug view while the choreography runs.

**Duration:** 5s.

**Notes:** the debug view runs with the effect idle, so no trigger during the take. At the default `Lost: Density` the field is punched through with blinking grey rectangles where the vectors are dropped; that is correct and worth keeping, since the next section explains it. The article links `?debug=motion`, which reaches the same state without touching the panel.

## 7. V6 · WRONG RESULT: the residual cancels itself · `The Residual`

**What must be seen:** on the left, the dancers printing as edges over the dragged room and then holding steady. On the right, those same ghosts filling in, taking colour, and rebuilding the clean limbo inside two seconds, cancelling the effect while the trigger is still down.

**Setup:** two clips, panel out of shot, both starting on `room` from the same camera pose, framing an area with strong contrast. `Cut On Trigger` on, `Residual Gain (x10)` 4, `Quantiser Steps` 14. Clip SHIPPED on the current build, clip PATCHED on the edited one.

**Action (both, identical):** 0.0s to 0.5s clean. 0.5s latch `Hold Trigger`, the cut fires. 0.5s to 4.5s camera untouched. 4.5s unlatch. 5.0s end.

**Duration:** 5s each, same frame count.

**Notes:** let PATCHED run the full five seconds latched. The reader has to see that the clean frame arrives with the trigger still down.

**Patch.** In `src/datamosh/shaders.ts`, line 359, replace:

```glsl
        float residual = abs(hc) > abs(hp) ? hc - hp : 0.0;
```

with:

```glsl
        float residual = dot(current - predicted, vec3(0.299, 0.587, 0.114));
```

## 8. V9 · WRONG RESULT: the ungated difference · `The Residual`

**What must be seen:** on the left, a held picture going quietly flat, its contours smoothed away over about three seconds without anything dramatic happening. On the right, the same contours still standing at the end.

**Setup:** two clips, panel out of shot, both starting on `room` with a large flat wall filling most of the frame, since the failure only shows where the incoming picture is flat. `Cut On Trigger` on, everything else default. Clip SHIPPED on the current build, clip PATCHED on the edited one.

**Action (both, identical):** 0.0s to 0.3s clean. 0.3s latch `Hold Trigger`, the cut fires. 0.3s to 4.0s camera untouched. 4.0s end while still latched.

**Duration:** 4s each, same frame count.

**Notes:** this failure is slow and quiet, so the pair has to be laid side by side, with both states on screen at once. A viewer cannot hold three seconds of sharpness in memory.

**Patch.** Same file, same line 359, replace it with:

```glsl
        float residual = hc - hp;
```

## 9. V7 · WRONG RESULT: the held frame dissolves · `Why the Held Frame Dissolved`

**What must be seen:** on the left, a held frame visibly dissolving, contours going soft and then gone, until the picture is a smooth smear of colour. On the right, the identical held frame keeping its edges for the whole take.

**Setup:** two clips, panel out of shot, both on `room`, camera in the same pose, framing hard high-contrast edges such as a room corner. `Cut On Trigger` on, everything else default. Clip SHIPPED on the current build, clip PATCHED on the edited one.

**Action (both, identical):** nudge the mouse once just before recording, so the camera is easing back towards its resting pose during the take. 0.0s to 0.3s clean. 0.3s latch `Hold Trigger`. 0.3s to 3.7s hands off the mouse and the keyboard. 3.7s to 4.0s still latched, end.

**Duration:** 4s each, same frame count.

**Notes:** that nudge is the point. With the camera at exact rest the measured motion is zero, the shader takes its zero-motion exit, and the two builds read the same texel: the pair would prove nothing. The drift has to be present and too slow to see. Do not shoot this in a limbo shot, where the camera holds perfectly still by design.

**Patch.** Same file, lines 506 to 508, replace:

```glsl
        vec3 moshed = length(motion * resolution) < 0.001
            ? texture2D(pFrame, uv).rgb
            : sampleHistory(uv - motion);
```

with:

```glsl
        vec3 moshed = texture2D(pFrame, uv - motion).rgb;
```

That removes the Catmull-Rom lookup and the zero-motion exit together, which is the version described in the text.

## 10. DEMO · the live embed · `Wrap-Up`, first element

Standard Codrops iframe of `https://data-mosh-demo.vercel.app/`, full content width, the `Data Mosh` panel open with `🎞️ Datamosh` and `🧱 Macroblocks` expanded, since the five named variants live across both. This is the one place in the article where the panel is meant to be visible. Caption: `W`/`A`/`S`/`D` to move, mouse to look, `Space` or hold to trigger.

## Patch session order

Shoot the three SHIPPED sides of V6, V9 and V7 in one pass on the current build, noting the camera pose for each. Then apply the V6 patch, shoot V6 PATCHED, change the same line for V9, shoot V9 PATCHED, then apply the V7 patch and shoot V7 PATCHED. Revert the file when the session is over, and diff it against `main` before you do anything else with the repo.

## Optional eleventh clip

`Implementation Notes` runs 351 words with nothing moving, which is the largest visual gap in the piece and still inside the house limit. If you want to close it: a screen recording of the devtools console spooling `GL_INVALID_OPERATION` once per frame over a render that looks perfect. It is the cheapest clip in the list and it shows the trap that costs a reader half a day.
