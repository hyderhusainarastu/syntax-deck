// harvest.mjs: where merge-parses and check-parse read the optional Morpheus analyser output.
// Real runs read the normalised copy written by tools/normalize-harvests.mjs from a file the user supplies.
// --stub reads a fixture that is not included in this repository.
import { existsSync } from 'node:fs';
import { readJson } from './ctx.mjs';

export function morpheusFile(ctx) {
  return ctx.stub ? ctx.D('research/raw/morpheus.json') : ctx.P('research/normalized/morpheus.json');
}
