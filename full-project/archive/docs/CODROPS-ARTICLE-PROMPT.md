# Prompt operativo per scrivere un articolo Codrops

Questo file contiene un prompt pronto all'uso che applica
[`CODROPS-ARTICLE-GUIDELINES.md`](./CODROPS-ARTICLE-GUIDELINES.md).

## Come si usa

1. Compila il **BRIEF** (la prima sezione del prompt). È l'unica parte che devi scrivere tu.
2. Passa al modello sia questo file sia `CODROPS-ARTICLE-GUIDELINES.md`.
3. Il prompt lavora in **quattro fasi con due punti di controllo**: dopo la fase 1 (genere) e
   dopo la fase 2 (scaletta + piano dei media) ti chiede conferma. Non saltarli: correggere una
   scaletta costa un minuto, correggere 2.000 parole costa un pomeriggio.
4. L'articolo esce in inglese, perché Codrops pubblica in inglese. Il prompt è in inglese per
   la stessa ragione: mescolare le lingue nella consegna produce calchi.

## Cosa preparare prima

- Repo pubblico e demo live (URL). Se non li hai, sappilo: dimezzano il valore del pezzo.
- I file sorgente da cui estrarre gli snippet, con i percorsi reali.
- **Le misure di performance**, se le hai. È il vantaggio competitivo più grande: nessuno dei
  dieci articoli analizzati contiene un solo numero.
- Un elenco dei media che puoi produrre (video, GIF, screenshot, debug view).
- I nomi esatti dei controlli della tua GUI.

---
---

# THE PROMPT — copy everything below this line

You are writing a technical article for **Codrops** (tympanus.net/codrops). You have been
given `CODROPS-ARTICLE-GUIDELINES.md`, derived from measuring ten published Codrops articles.
Treat it as the house style guide and follow it literally, including its numeric targets.

## BRIEF — fill this in

```
PROJECT:            <name and one-line description>
LIVE DEMO:          <url, or "none">
REPO:               <url, or "none">
STACK:              <libraries and versions that matter>
THE CORE TRICK:     <the one mechanism a reader could not reconstruct alone, in 2 sentences>
WHY I BUILT IT:     <the personal origin — an obsession, a constraint, a reference>
CULTURAL ANCHOR:    <historical/hardware limitation the effect descends from, if any>
SOURCE FILES:       <real paths I can quote from>
PERFORMANCE DATA:   <real measurements, or "none">
GOTCHAS:            <API traps, half-days lost, non-obvious failures>
REJECTED ALTERNATIVES: <what you tried or considered, and why you refused it>
MEDIA I CAN MAKE:   <videos, GIFs, screenshots, debug views, GUI presets>
GUI CONTROL NAMES:  <exact labels, verbatim>
KNOWN LIMITS:       <what does not work, what you skipped, what costs too much>
```

## PHASE 1 — Pick the genre. Stop and confirm.

Choose **Tutorial**, **Article** (build log / case study), or **Playground**, using the
decision rule in §2 of the guidelines: if a reader cannot reasonably rebuild the thing by
following a linear path, it is an Article, not a Tutorial.

Output: the genre, two sentences of justification, the target word count, the target
prose-to-code ratio, and the target number of code blocks. **Then stop and ask for
confirmation.** Do not write prose yet.

## PHASE 2 — Outline and media plan. Stop and confirm.

Produce, as a table:

- Every section, in order, with its heading **in final form**, its function, and its word
  budget.
- For each section: which code blocks it contains, their source file path, and their
  approximate line count.
- For each section: which visual asset it contains, and what that asset **shows**.

Constraints to satisfy in the outline itself, and to state that you have satisfied:

- The first moving image lands within the first 50 words.
- No gap larger than 500 words without a visual.
- The closing is three separate sections: limits → variants → credits.
- Headings are ~60% noun phrases, ~25% gerunds. At most one question, at most one imperative,
  and each must earn its place.
- Numbered headings only for steps of a construction; sub-steps stay unnumbered.
- At least one A/B pair: two twin sections, same code, one parameter apart, one visual each.
- At least one section that stages a **wrong** result, with the chain *visual observation →
  cause → fix*.
- If PERFORMANCE DATA is not "none", one section holds real numbers.

**Then stop and ask for confirmation.**

## PHASE 3 — Write it.

### Opening
First sentence: a chain of verbs that *is* the outline (`take a video → pixelate → extrude →
control with physics`). Stack named within 35 words. Then either send the reader to the demo
and react alongside them, or open with the cultural anchor before the stack. Never restate the
dek. No "have you ever wondered". No table of contents, no prerequisites, no setup section, no
"what you'll learn".

### Voice
- `I` for anything arguable: origin, taste, contested decisions, admitted shortcuts.
- `we` for the mechanism and the work.
- `you` for perception, exploration, permission.
- Never write `we` for code you did not write during the article. If a variable appears in a
  snippet without the narration having created it, either rewrite the snippet or switch to `I`.
- Present tense for behaviour; present perfect for long-running obsessions; past tense only for
  the project's biography.
- Never define a term. Always attach its function in the same sentence: *"TypedArrays **for
  performance**"*.
- Pick one register — dry understatement, or declared enthusiasm paired with technical honesty
  — and hold it for the whole piece.
- Write one signature sentence that establishes the register on its own.
- Sentences ~16 words. Paragraphs under 35 words, never more than 3 lines.

### Code
- Median 9 lines per block, 60% under 10, none over 30.
- **Never two blocks in a row.** A bridge sentence always sits between them.
- Every block is preceded by a ~20-word pointer sentence naming the file and the insertion
  point: *"Add this at the bottom of the `createVariable` method:"*
- Every block opens with its file path as a comment: `// core/PhysicsWorld.js (simplified)`.
- Elide with `// ...`; mark rewrites `(simplified)`. No block is complete —
- — except exactly one consolidation block at the midpoint: *"Here's the final complete X:"*
- Prose explains **why** the block exists; inline comments mark **what** each group of lines
  does. Prose never narrates the code line by line.
- Every magic number is justified. If there is an `8.0` or a `16.0/17.0`, say where it comes
  from.

### The hard concept
Use the 7-move method from §10 of the guidelines: constraint stated as an impossibility → the
trick in one sentence → both sides side by side → a bold mnemonic on its own line → the
reader's question asked out loud and answered by elimination → the algebra last, as a
derivation that confirms an intuition already given in plain English → an honest coda admitting
what the solution costs.

For an abstraction with nothing to show yet, use the 8-move method instead: disambiguate the
names → define by contrast with known behaviour → state the benefit → anchor to something the
reader already does → one minimal *complete* self-commented example → the payoff → social proof
on real sites → only then the personal case.

Anchor, do not analogise: *"If this sounds familiar, that's because it is how post-processing
works in Three.js."*

### Visuals
Call each asset out in the text with a placeholder line stating what it must show:
`[VIDEO: the smear following the camera, gesture held for 2s, 4-second loop]`. Name GUI
controls verbatim at least three times, so the reader produces the missing images themselves.
Where a debug view exists, link it with its URL parameter.

### Closing
Three sections, three jobs, none of them a summary:
1. **Implementation Notes / Gotchas** (~300 words) — limits, trade-offs, costs, API traps,
   optimisations not taken and why. Put the real numbers here.
2. **Wrap-Up** (~100 words) — five named, concrete variants, plus what *you* will do next.
3. **Final Thoughts** (~150 words) — no technique. Named credits, thanks, a personal ending.

## PHASE 4 — Self-audit. Report it, do not just claim it.

Count, and print the actual figures next to the targets:

| Metric | Target | Actual |
|---|---|---|
| Prose words | 1400–2400 (400–600 Playground) | |
| Code blocks | 8–14 | |
| Median lines per block | ~9, none over 30 | |
| Words per code line | 5–6 Tutorial / 9+ Article | |
| Median paragraph words | < 35 | |
| Median sentence words | ~16 | |
| H2 count | 3–9 | |
| Consecutive code blocks | **0** | |
| Blocks missing a file-path comment | **0** | |
| Blocks missing a pointer sentence | **0** | |
| First moving image, % into text | < 5% | |
| Largest gap between visuals | < 500 words | |
| Imperative headings | ≤ 1 | |
| Question headings | ≤ 1 | |
| Performance claims without a number | **0** | |

Then verify each of these, answering yes/no with the evidence:

- Does the piece explain its own central mechanism, or does it elide it behind a comment?
- Is the effect named in the title shown **in isolation**, before/after?
- Is there at least one wrong result staged, with cause and fix?
- Is there at least one rejected alternative **with the reason for the refusal**?
- Is there at least one gotcha that would have cost the reader half a day?
- Is there a signature sentence?
- Does any snippet use a variable the narration never created?
- Does the first body sentence paraphrase the dek?

Where a target is missed, say so and fix it. Do not report a target as met without the count.

## OUTPUT FORMAT

1. The proposed **dek** (17–21 words) and 4–6 tags.
2. The article, in Markdown, English, with `[VIDEO: …]` / `[IMAGE: …]` / `[DEMO: …]`
   placeholders describing exactly what each asset must show.
3. The self-audit table and the yes/no checks.
4. A short list of the assets you need me to produce, in shooting order.

Write the article. Do not pad it: on Codrops the median piece is 1.417 words, and pieces of 600
words get published when the 600 words are the right ones.
