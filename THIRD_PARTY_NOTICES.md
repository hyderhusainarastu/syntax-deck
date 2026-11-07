# Third-party notices

This repository's own code is under the MIT licence (see `LICENSE`). It uses the third-party material below. Licence
identifiers are those recorded in `package-lock.json`.

## npm dependencies (installed by `npm ci`, not copied into this repository)

| Package | Version | Licence | Use |
|---|---|---|---|
| three | 0.186.1 | MIT | Bundled into the built page for the background light and depth. The build keeps legal comments at the end of the script. |
| gsap | 3.15.0 | GSAP "Standard no charge" licence, https://gsap.com/standard-license | Bundled into the built page for animation. This is not an OSI open source licence and it has restrictions (for example on competing products): read it before reuse. |
| esbuild | 0.28.2 | MIT | Build tool. Its platform packages (`@esbuild/*`, 0.28.2, MIT) are optional installs. |
| @fontsource/gentium-book-plus | 5.2.5 | SIL Open Font License 1.1 | Gentium Book Plus, read from `node_modules` at build time and embedded in the built page. |
| playwright | 1.62.1 | Apache-2.0 | Optional. Used only by `npm run qa` and `npm run pdf`. Its `playwright-core` dependency is Apache-2.0, and `fsevents` 2.3.2 (macOS only) is MIT. |

## Fonts

- **Gentium Book Plus**, SIL Open Font License 1.1. Taken from the `@fontsource/gentium-book-plus` package at build time; no font file is
  committed here. Licence text, copied from that package: `licenses/OFL-gentium-book-plus.txt`.
- **Alegreya Sans**, SIL Open Font License 1.1, copyright 2013 The Alegreya Sans Project Authors
  (https://github.com/huertatipografica/Alegreya-Sans). Embedded as base64 in `src/css/fonts.css`. Licence text:
  `licenses/OFL-alegreya-sans.txt`.

The build writes both font licence texts into the built page as a comment, so that the notices travel with every copy.
