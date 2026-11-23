# syntax-deck

Engine and build tools that turn deck data into one offline HTML file of animated, word-by-word syntax slides.

## Using this in your project

- Status: engine only. No text data or worked deck ships here, so `npm run build` fails until you supply data.
- Install: `npm ci` (Node 18+). Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` unless you need `qa` or `pdf`.
- Commands (exit 0 = ok, 1 = a check failed, nothing is written on failure):
  - `npm run compile`: `src/steps/*.mjs` to `build/steps.json`.
  - `npm run check:text`, `check:parse`, `check:cites`: validate data.
  - `npm run build` (`build:strict` makes warnings fatal): writes `build/deck.html`, one file, no network at runtime.
  - `npm run qa`, `npm run pdf`: need Playwright and a browser.
  - Flags: `--scope s1` (first sentence only), `--steps <dir>` (probe a folder of step files), `--out <file>`, `--stub` (needs a fixture not included).
- Deck data layout, relative to the repo root (read from `tools/lib/data.mjs`, `tools/lib/refs.mjs`):
  - `data/locked/tokens.json`: array of `{id, g, s, raw, text, post}`. `id` is `s1.01` to `s4.99` (sentence, position), `g` the 1-based global order, `post` the trailing punctuation.
  - `data/locked/gap.json`: `{gapSentence: [{id: "g.01", text, post}], variant: {id: "v.01", text} | null}`.
  - `data/tree/s1.json` to `s4.json`: `{root, nodes: [{id, parent, type, label, tokens}]}`. Node ids look like `S1` or `S1.a`. `type` is one of finite, ptc, conj, gabs, indst, analogy, neutral. Exactly one root.
  - `data/parses/s1.json` to `s4.json`: `{rows: [{id, lemma, pos, features, basis, ...}]}`, one row per token in order.
  - `data/en/s1.json` to `s4.json`: English slots for the parallel translation.
  - `data/sources/citations.json`, `data/sources/lsj-passage.json`: sources a step may cite.
  - `data/deck.json` (optional): `{title, notices: []}`.
  - `src/steps/overture.mjs`, `s1.mjs` to `s4.mjs`, `close.mjs`: the presses. Step keys are listed at the top of `tools/compile-steps.mjs`.
  - Text in strings can reference tokens as `{s1.03}` or `{s1.03..s1.05}`.
- Never put secrets, private records or unlicensed source text in `data/`; the build embeds it in the page.
- No PROMPT.md: CLI.

## Working on this repo

- Setup: `npm ci`. Test: there is no test suite yet; run `for f in tools/*.mjs tools/lib/*.mjs src/*/*.mjs; do node --check "$f"; done` for a syntax check (offline).
- Edit `src/` (engine, panels, world, presenter, css) and `tools/`. Do not edit `package-lock.json` by hand or `licenses/`.
- `build/`, `node_modules/` and `projects/` are git-ignored; do not commit them.
- The checks currently assume Greek text and up to four sentences (a Latin letter in a token fails `check:text`).
- Keep the build offline: no network calls, no CDN links in the page.
