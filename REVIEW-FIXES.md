# Review fixes

Audit follow-up for the Codrops submission. This file records every review item,
the chosen action, and the exact prose changes proposed for the article.

## Repository and code

| ID | Feedback | Action | Status |
| --- | --- | --- | --- |
| REP-01 | No CI, tests, or lint in `demo/` | Accepted for this submission; no change requested. | No action |
| REP-02 | Root README does not say which project directory to enter | Added `cd demo` / `cd full-project` before the pnpm commands. | Done |
| REP-03 | Node and pnpm versions are not declared | Added `packageManager: pnpm@10.9.0` and Vite 8's supported Node range to both projects. | Done |
| REP-04 | Three high-severity dev-only audit advisories | Pinned transitive `brace-expansion` to `5.0.9` with a pnpm override; full audit is clean. | Done |
| REP-05 | `.gitignore` describes `article/` twice | The comments describe the intended handoff and the later local exclusion; retained as requested. | No action |
| CODE-01 | Camera motion and easing depend on refresh rate | Converted walking to units per second and easing to an exponential delta-adjusted coefficient. The 60 Hz feel is unchanged; long resumed frames are capped at 100 ms. | Done |
| CODE-02 | Debug deep-link comment contradicts the actual OR logic | Removed only the misleading comment; URL behaviour is unchanged as requested. | Done |
| CODE-03 | `preserveDrawingBuffer` may waste GPU memory | Verified that screenshots, feedback, velocity and debug views use no preserved default framebuffer; removed the flag. | Done |
| CODE-04 | Global Space/WASD handlers also see panel input | Explicitly left unchanged. | No action |
| CODE-05 | Lost sectors still receive the synthetic residual | Explicitly left unchanged; the article wording below describes the implementation honestly. | No action |
| PUB-01 | GitHub repository is private | Keep private during review. | No action for now |
| PUB-02 | Canonical/Open Graph/Twitter URLs point to a 404 | Replaced the old Vercel host with `https://datamosh.niccolofanton.dev`. | Done |
| PUB-03 | Codrops article URL is still a placeholder | Keep `?p=` until Codrops publishes the article and assigns the final URL. | No action for now |
| PUB-04 | Deleted article and media remain in Git history | Remove `article/` from every commit, verify the rewritten object graph, then force-push `main` with a lease. | Pending final verification |
| PUB-05 | Asset credits and licence scope are unclear | Added Poly Haven, Mixamo and Adobe terms; clarified that MIT applies to source code only. The room binary has no embedded provenance, so author/source confirmation remains required before the repository becomes public. | Documented; provenance pending |

## Article — exact replacements

Line numbers refer to the review copy in `pasted-text.txt`.

### ART-01 — Codec and keyframe terminology

- **Lines:** 1–2
- **Replace the first two paragraphs with:**

> A video codec does not store every picture independently. It periodically
> encodes an intra picture that can be reconstructed without referring to an
> earlier picture. Between those points, inter-coded pictures are predicted
> from previously reconstructed reference pictures. At block level, an encoder
> may select a displacement into a reference picture and encode a residual
> correction, or it may encode the block using intra prediction when reference
> prediction is not useful. Because consecutive pictures often resemble one
> another, prediction can save a great deal of data.
>
> Suppress the intra refresh at a scene change and the decoder continues
> reconstructing from references that still belong to the outgoing shot while
> processing data intended for the incoming one. Pixels from the old scene are
> dragged around until a later refresh restores a clean image.

- **Why:** distinguishes intra/inter pictures, reconstructed references and
  intra-coded blocks.

### ART-02 — Historical claim and refresh duration

- **Line:** 3
- **Replace with:**

> Video artists have long used variants of this trick on real files, using
> tools such as hex editors and modified decoders. Here I borrow the idea in
> real time: a fragment shader acts as the decoder for a three.js scene and, by
> default, suppresses refresh for the duration of the gesture.

- **Why:** removes the unsupported “twenty years” claim and matches the optional
  periodic refresh.

### ART-03 — Nature of the motion vectors

- **Line:** 9
- **Replace with:**

> The previous frame means the decoder’s last reconstructed output, not the
> scene renderer’s current output. In this project, the motion texture stores
> graphics-derived screen-space velocity: an approximation of the displacement
> field a video encoder might choose, not the codec’s original motion vectors
> and not a measurement of physical surface motion.

- **Why:** codec vectors are encoder prediction choices; graphics velocity is a
  visual stand-in.

### ART-04 — Feedback behaviour

- **Line:** 12
- **Replace with:**

> The key change is where the shader reads its picture. A post-processing pass
> usually samples the frame the renderer has just drawn. This pass instead
> samples its own previous output at an offset and mixes in a small amount of
> the fresh render. With a constant such as `vec2(0.002, 0.0)`, the history
> drifts sideways while the incoming scene continually replenishes it,
> producing a persistent trailing smear rather than an endlessly translated
> unchanged image.

- **Why:** `mix(dragged, scene, 0.12)` introduces fresh colour every frame.

### ART-05 — Velocity pass as an approximation

- **Lines:** 44–45
- **Replace with:**

> A constant vector looks artificial because it assigns the same displacement
> to every pixel. The renderer can derive how visible geometry moved in screen
> space, so we use that velocity field as a codec-inspired approximation.
>
> We draw the scene a second time with an override material that writes velocity
> instead of colour. Each vertex is projected once with the current model and
> camera matrices, then again with the matrices saved for the same object one
> frame earlier. The difference between those projected positions supplies the
> displacement used by the effect.

- **Why:** avoids equating rasterised velocity with encoder motion vectors.

### ART-06 — Camera/depth fallback and half-float targets

- **Insert after line:** 71
- **Add:**

> The velocity texture is optional. If the browser cannot render to a half-float
> target, the project reconstructs each fragment’s world position from the scene
> depth buffer, projects it with the previous camera matrices, and derives
> camera-only motion in the decode shader. This fallback misses independently
> moving objects but avoids the second geometry pass. Where the velocity pass is
> supported, uncovered background pixels use the same depth-reprojection path.
>
> The velocity and feedback targets use half-float colour attachments when
> supported. Subpixel velocity needs more precision than an 8-bit normalised
> texture, while repeated writes to an 8-bit linear-colour history can quantise
> dark values until they collapse towards black. Unsupported devices fall back
> to unsigned-byte history and camera-only reprojection.

- **Why:** documents two important parts of the implemented pipeline.

### ART-07 — Skip-inspired blocks

- **Lines:** 119 and 132–134
- **Replace the prose paragraph with:**

> Skip. Below a threshold, a block’s motion fades to zero, so its history sample
> stops being displaced. The residual remains active, making this a
> codec-inspired hold rather than a literal skipped-block implementation. A
> short ramp eases the motion into that state to prevent a visible pop.

- **Replace the snippet comment with:**

```glsl
// 3. Under the threshold, motion fades to zero and the history sample holds.
//    The residual path remains active later in the shader.
```

- **Why:** the code suppresses motion but not the residual.

### ART-08 — Lost-sector wording

- **Line:** 142
- **Replace with:**

> The last layer adds the screen’s most visible artefact: rectangles whose
> motion freezes before they reappear elsewhere. In a real stream, a similar
> visual failure can follow transport loss, when data needed to reconstruct an
> area never arrives and the damage persists until an intra refresh repairs it.
> What follows is a loss-inspired sector mask rather than a simulation of that
> mechanism: it suppresses motion in selected rectangles while the residual
> path can still introduce detail.

- **Line 161:** replace “Lost sectors stay hidden” with “The lost-sector masks
  stay disabled”.
- **Why:** matches the shader without changing the chosen visual model.

### ART-09 — GLSL loop comment

- **Line:** 146
- **Replace:**

```glsl
if (fi >= uLostLayers) break;  // constant bound: the loop has to unroll
```

- **With:**

```glsl
if (fi >= uLostLayers) break;  // fixed upper bound keeps execution predictable across WebGL drivers
```

- **Why:** unrolling is not an absolute WebGL 2 requirement.

### ART-10 — Code-fence languages

- **Line 6:** `javascript` → `text`.
- **Lines 13, 46, 61, 99, 120 and 144:** `javascript` → `glsl`.
- **Lines 31 and 76:** retain `javascript` for the scheduling/pseudocode, and
  label line 31 explicitly as pseudocode because its names are not repository
  APIs.

### ART-11 — Article structure

If headings and media were not merely stripped during copy/paste, add these
headings before lines 11, 44, 73, 97, 112, 115, 142 and 163:

```markdown
## 1. Building the feedback loop
## 2. Capturing screen-space velocity
## 3. Turning feedback into a datamosh
## 4. Adding an incomplete residual
## 5. Preserving detail through repeated sampling
## 6. Exposing the block structure
## 7. Adding loss-inspired sectors
## 8. Performance and trade-offs
```

Also restore the missing diagram/media or remove “diagram below” and the
references to steps 3, 4 and 8.

### ART-12 — Perspective-divide wording

- **Line 60:** replace “the perspective divide belongs there, at pixel
  frequency” with “the perspective divide belongs there, per fragment”.
- **Why:** the concept is correct; “per fragment” is the precise rasterisation
  term.

### ART-13 — Trigger wording

- **Line 74:** replace “Pressing the pointer cuts to a shot” with “Pressing the
  pointer, Space key, or touch input cuts to a shot”.
- **Why:** matches the implemented inputs and reads naturally in English.

### ART-14 — Residual reference pictures

- **Lines 97–98:** replace the opening with:

> A real encoder computes its residual against a motion-compensated prediction
> made from reconstructed reference pictures. If I used the complete difference
> between the current render and this deliberately wrong prediction, the
> residual would cancel the mismatch and repair the datamosh. The correction
> therefore has to remain deliberately incomplete.

- **Why:** an encoder may use multiple references, not necessarily the immediately
  preceding frame or a reference from a named “shot”.

### ART-15 — Luma wording

- **Line 110:** replace “The residual carries luma, or brightness detail” with
  “The residual carries a luminance-like brightness signal”.
- **Why:** the chosen coefficients are applied to the project’s working colour
  values and should not be presented as strict encoded-video luma.

### ART-16 — Frame-rate wording

- **Line 112:** replace “Repeating it sixty times a second” with “Repeating it
  once per rendered frame—sixty times a second at 60 fps”.
- **Why:** the feedback rate follows the display loop.

### ART-17 — Artistic block size

- **After line 118:** add:

> I use “block” here in a visual sense. The default 8×8 tile is an artistic
> choice, not a claim about one codec’s fixed macroblock size; modern formats
> use different coding-tree and partition sizes.

- **Why:** avoids presenting the 8 px default as codec-derived.

### ART-18 — Performance caveats

- **Line 163:** append “when the diagnostic overlays are also off” after the
  statement that velocity and decode switch off.
- **Line 165:** replace “Decode is the most expensive pass” with “Decode is
  expected to be the most expensive full-screen pass”.
- **Line 166:** replace “The clearest optimisation target” with “The first
  optimisation target I would measure”.
- **Why:** debug modes keep passes alive, and the performance ranking has no GPU
  timing data attached.
