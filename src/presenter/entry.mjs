// Bundle entry. In a ?view=sources tab main.mjs never runs: no deck, no WebGL.
import { isSourceView, mountSourceView, attachSources } from './index.mjs';
if (isSourceView()) mountSourceView();
else { attachSources(); import('../main.mjs'); }
