# Examples

Each file is self-contained. Run them after `npm install @meyerzon/verbose-log`
(or, inside this repo, after `npm run build`).

| File | Run |
| ---- | --- |
| [`node-esm.mjs`](./node-esm.mjs) | `VERBOSE=2 node node-esm.mjs` |
| [`node-cjs.cjs`](./node-cjs.cjs) | `VERBOSE=1 node node-cjs.cjs` |
| [`named-levels.ts`](./named-levels.ts) | `VERBOSE=debug npx tsx named-levels.ts` |
| [`browser.html`](./browser.html) | open in a browser, set `localStorage.VERBOSE` in the console |

Remember: **higher `VERBOSE` = more output**. Unset prints base only;
`VERBOSE=off` silences everything.
