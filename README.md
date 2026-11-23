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

## Use from an AI coding agent

Agents (Codex, Claude Code, Cursor, Gemini CLI, Copilot) read `AGENTS.md`, which holds the deck data schema, the build
and check commands, and the rules for what not to edit. `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md`
only point to it.

## What is here

- `src/`: the stage engine (`engine/`), the panels (`panels/`), the background light (`world/`), the presenter view
  (`presenter/`), the CSS and the page shell.
- `tools/`: the build and the checks. `build.mjs` compiles the steps, checks the data, and bundles everything into one
  HTML file. `compile-steps.mjs`, `check-text.mjs`, `check-parse.mjs`, `check-cites.mjs`, `merge-parses.mjs`,
  `normalize-harvests.mjs`, `qa.mjs` and `pdf.mjs` are the other tools. `tools/lib/` holds their shared helpers.
- `licenses/`: licence texts for the embedded fonts. See `THIRD_PARTY_NOTICES.md`.

## Requirements

Node 18 or later. Install with `npm ci`. Playwright is an optional dependency, used only by `npm run qa` and
`npm run pdf`; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to install without downloading a browser.

## Data and notices

A deck's data (text, trees, parses, sources) lives outside this code. The build writes notices only from data it is
given: an optional `data/deck.json` with `title` and `notices`. It adds no text about any deck.

Anyone who uses this with outside sources is responsible for following each source's terms.

## Presenting

Before you present a deck, run through the talk pre-flight checklist in
[palimnote-templates](https://github.com/hyderhusainarastu/palimnote-templates/blob/main/checklists/talk-preflight.md).
Open the built file from disk on the presenting machine and press through every step once.

## Example

`examples/hello/` shows the shape of the data files with an invented English sentence. It is an illustration only: it has not
been built or validated, and the current checks expect Greek text (see its README).

## Related

- [palimnote-tools](https://github.com/hyderhusainarastu/palimnote-tools): catalogue of the small tools.
- [palimnote-templates](https://github.com/hyderhusainarastu/palimnote-templates): templates and checklists, including the talk pre-flight.
- [interactive-critical-edition](https://github.com/hyderhusainarastu/interactive-critical-edition): a related offline, single-page scholarly edition.

Keywords: syntax slides, sentence parsing, grammar visualisation, agreement, word-by-word animation, offline HTML presentation,
classics teaching, digital humanities.

## Licence

MIT, see `LICENSE`. Third-party material is listed in `THIRD_PARTY_NOTICES.md`.

Part of palimnote-tools - more at https://github.com/hyderhusainarastu
