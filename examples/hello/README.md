# examples/hello

An invented Greek sentence, "ὁ παῖς τὸν κύνα ὁρᾷ.", laid out in the shape of the data files described in `AGENTS.md`.

Files: `data/locked/tokens.json`, `data/locked/gap.json` and `data/tree/s1.json`.

Run from the repo root: `npm run check:example` (`check-text` on this folder, first sentence only). It passes. Parses, English
slots and sources are not included, so `npm run build` does not run on it and no screenshot is provided. Copy the files to the
same paths under the repo root only as a starting point for your own data.
