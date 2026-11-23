# syntax-deck

The engine and build tools for animated, offline, word-by-word syntax decks.

A deck built with these tools is one self-contained HTML file. It opens from disk and makes no network request. The
words of a text sit on one stage and move between states: a word is lifted out of its line, set under the word that
governs it, tied to the word it agrees with, and put back. A deck can carry:

- a parse for every word, with the basis it rests on;
- a translation built up in parallel with the source text;
- an optional presenter view, a read-only companion window that lists the sources for the step on screen.

## Status: engine only

Work in progress. This repository cannot yet build a deck on its own, because no worked example and no text data are
included. The data model currently assumes up to four sentences and will be generalised.
The `--stub` and `--scope` options of the tools need a fixture or data that is not included here. A `/new-deck` command for any text, language packs and a worked example will follow.

## Works with

Any tool that can run Node and read a repository. The build is a plain command line, so the assistant only needs to
read files and run commands.

| Surface | How | Status |
|---|---|---|
| Codex | reads `AGENTS.md` | pointer file in repo |
| Claude Code | reads `CLAUDE.md`, which points to `AGENTS.md` | pointer file in repo |
| Cursor | reads `AGENTS.md` | pointer file in repo |
| Gemini CLI | reads `GEMINI.md`, which points to `AGENTS.md` | pointer file in repo |
| GitHub Copilot | reads `.github/copilot-instructions.md`, which points to `AGENTS.md` | pointer file in repo |
| ChatGPT, Claude.ai, Gemini (chat) | paste the data schema from `AGENTS.md` and ask for data files | manual; you run the commands |
| No assistant | `npm run ...` by hand | works |

## Quick start

Common to every surface:

```
npm ci
npm test
npm run check:example
```

Per surface, point the assistant at this repository and give it the same task. It will find `AGENTS.md`.

- Codex: `codex "Read AGENTS.md. Check examples/hello with npm run check:example, then explain the data files."`
- Claude Code: `claude "Read AGENTS.md, run npm test, and describe the deck data layout."`
- Cursor: open the folder; the agent loads `AGENTS.md`. Ask it to run `npm run check:example`.
- Gemini CLI: `gemini "Read AGENTS.md and run npm run check:example."`
- Copilot: in the agent chat, ask it to follow `.github/copilot-instructions.md` and run `npm test`.
- Chat apps: paste the "Deck data layout" section of `AGENTS.md`, describe your text, and save the JSON it returns under `data/`.

## Example

`examples/hello/` holds an invented Greek sentence (one token file, an empty gap file, one tree). This command checks it:

```
$ npm run check:example
ok   check-text: 0 failure(s), 0 warning(s)
```

That is the only check the example covers. It has no parses, English slots or sources, so `npm run build` does not
run on it, and no screenshot is included. To build a deck you supply the full data set listed in `AGENTS.md`.

## How it differs

Slide tools show a finished diagram. This one keeps every word of the text on one stage and moves it between states,
and it records the basis for each parse. The output is one HTML file with no network request, so it opens from disk
at a venue with no connection.

## Limits

- Engine only: no complete worked deck and no text data ship here.
- The checks expect Greek text (a Latin letter in a token fails `check:text`) and up to four sentences.
- `build`, `qa` and `pdf` need the dependencies from `npm ci`. `qa` and `pdf` also need a Playwright browser.
- `--stub` needs a fixture that is not included.
- The tests cover `check-text` only. The build and the engine have no automated tests yet.

## What is here

- `src/`: the stage engine (`engine/`), the panels (`panels/`), the background light (`world/`), the presenter view
  (`presenter/`), the CSS and the page shell.
- `tools/`: the build and the checks. `build.mjs` compiles the steps, checks the data, and bundles everything into one
  HTML file. `compile-steps.mjs`, `check-text.mjs`, `check-parse.mjs`, `check-cites.mjs`, `merge-parses.mjs`,
  `normalize-harvests.mjs`, `qa.mjs` and `pdf.mjs` are the other tools. `tools/lib/` holds their shared helpers.
- `licenses/`: licence texts for the embedded fonts. See `THIRD_PARTY_NOTICES.md`.

## Requirements

Node 20 or later (developed on Node 24; CI runs 20, 22 and 24; Node 18 is not tested). Install with `npm ci`. Playwright is an optional dependency, used only by `npm run qa` and
`npm run pdf`; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to install without downloading a browser.

## Data and notices

A deck's data (text, trees, parses, sources) lives outside this code. The build writes notices only from data it is
given: an optional `data/deck.json` with `title` and `notices`. It adds no text about any deck.

Anyone who uses this with outside sources is responsible for following each source's terms.

## Presenting

Before you present a deck: open the built file from disk on the presenting machine, with the network off, and press
through every step once. Check the projector resolution and that the fonts render.

## Related

- [palimnote-tools](https://github.com/hyderhusainarastu/palimnote-tools): catalogue of the small tools.
- [palimnote-templates](https://github.com/hyderhusainarastu/palimnote-templates): templates and checklists, and checklists.
- [interactive-critical-edition](https://github.com/hyderhusainarastu/interactive-critical-edition): a related offline, single-page scholarly edition.

Keywords: syntax slides, sentence parsing, grammar visualisation, agreement, word-by-word animation, offline HTML presentation,
classics teaching, digital humanities.

## Licence

MIT, see `LICENSE`. Third-party material is listed in `THIRD_PARTY_NOTICES.md`.

Part of palimnote-tools - more at https://github.com/hyderhusainarastu
