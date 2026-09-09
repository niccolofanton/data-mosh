# Archive

Nothing here is built, imported or served. It is kept because it was written
against this codebase and would be expensive to reconstruct, not because the
demo needs it.

| Path | What it is | Why it left |
| --- | --- | --- |
| `camera-sim/` | A found-footage camera simulation: barrel distortion, chromatic aberration, rolling shutter, sensor noise, bloom, and a signal stage with chroma bleed, trail, grade, vignette and grain. Six modules, ~760 lines. | Off by default (`DEFAULT_CAMERA.enabled === false`), so it contributed nothing to the picture while costing three effect passes and a full-resolution trail target in the chain. |
| `docs/CAMERA-SIM.md` | The research behind that simulation — how real cheap cameras actually degrade an image, and which of those artefacts are worth shading. | Documents `camera-sim/`. |
| `docs/CODROPS-ARTICLE-PROMPT.md`, `docs/CODROPS-ARTICLE-GUIDELINES.md` | The brief and the house style used to write `docs/CODROPS-ARTICLE.md`. | Process scaffolding for a deliverable that is already written. |
| `docs/CODROPS-ARTICLE.pdf` | Rendered from `docs/CODROPS-ARTICLE.md`. | Generated; the Markdown is the source of truth. Untracked. |
| `codrops-research/` | Sitemaps, an index of the Codrops corpus, and five independent per-article analyses. | Intermediate working files. Untracked. |
| `public/browserconfig.xml`, `public/mstile-150x150.png` | Windows 8 / IE11 pinned-tile metadata. | Orphaned: `index.html` never carried the `msapplication-config` meta tag that would have pointed at them. |

## Putting the camera simulation back

Three passes and a copy, in this order in `DataMoshManager`'s constructor:

1. `BloomEffect` and `OpticsSensorEffect`, **before** the keyframe copy — in a
   real camera the lens and the sensor come before the encoder, so the codec
   compresses an image that is already dirty.
2. `SignalEffect` **after** the feedback copy — those artefacts belong to the
   tape being played, not to the picture being recorded, so they must not enter
   the prediction chain.
3. A `CopyPass` into a full-resolution trail target immediately after it, wired
   with `signal.setTrailTexture`.

Two things were unpicked from the rest of the code when it left, and have to go
back with it:

- **The lens remap.** The datamosh shader reads the velocity buffer and the
  scene depth, neither of which went through the optics stage, while working on
  a picture that did. `camera-sim/shaders/lens-remap.ts` and the
  `lensJacobianInverse` helper that used to sit in `datamosh/shaders.ts` are
  what kept the three in the same coordinates; the manager fed them per frame
  through `DataMoshEffect.setLensRemap(barrel, skew)`.
- **`Lost: Outline`.** The lost-vector debug overlay was drawn by the signal
  stage, deliberately downstream of the feedback copy — drawn upstream it gets
  dragged and redrawn by the loop instead of marking it. It went with the stage.

The field of view is the one piece that stayed: `DEFAULT_CAMERA.fov` was 79°,
and the `Canvas` camera in `scene/canvas.tsx` now carries that number directly.
