# syntax-deck

The engine and build tools for animated, offline, word-by-word syntax decks.

A deck built with these tools is one self-contained HTML file. It opens from disk and makes no network request. The
words of a text sit on one stage and move between states: a word is lifted out of its line, set under the word that
governs it, tied to the word it agrees with, and put back. A deck can carry:

- a parse for every word, with the basis it rests on;
- a translation built up in parallel with the source text;
- an optional presenter view, a read-only companion window that lists the sources for the step on screen.

It was built with Claude Code.

## Status

Work in progress. This repository cannot yet build a deck on its own, because no worked example and no text data are
included. The data model currently assumes up to four sentences and will be generalised.
The `--stub` and `--scope` options of the tools need a fixture or data that is not included here. A `/new-deck` command for any text, language packs and a worked example will follow.

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

## Licence

MIT, see `LICENSE`. Third-party material is listed in `THIRD_PARTY_NOTICES.md`.
