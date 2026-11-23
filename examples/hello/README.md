# examples/hello

An invented English sentence, "The old dog sees the cat.", laid out in the shape of the data files described in `AGENTS.md`.

Not built, not validated. The engine and its checks are written for Greek text and four sentences: `check:text` rejects Latin
letters, and `check:parse` needs Morpheus harvests. This example therefore shows the file shapes only. It will not pass
`npm run build` as it stands, and no screenshot is included. A working example needs the language-pack work listed under Status in the root README.

Files: `data/locked/tokens.json` and `data/tree/s1.json`. Copy them to the same paths under the repo root only as a starting point for your own data.
