# AGENTS.md

This file provides guidance to Claude Code and other agents when working with code in this repository.

## What this is

`@meyerzon/verbose-log` — a `console` proxy gated by a `VERBOSE` threshold. Drop-in replacement for `console`, but every method is filtered by a per-call verbosity level resolved from the environment (Node) or global/`localStorage` (browser). Ships dual ESM+CJS with `.d.ts` types. Targets Node >= 20 and browsers.

## Commands

```sh
npm run build          # bundle src/index.ts -> dist (ESM+CJS+dts) via tsdown
npm test               # vitest run (one-shot)
npm run test:watch     # vitest watch mode
npm run test:coverage  # vitest run --coverage (enforces 100% across the board)
npm run typecheck      # tsc --noEmit (strict)

# single test by name:
npx vitest run -t "name of the test"
# single file:
npx vitest run test/index.test.ts
```

Coverage thresholds are **100% lines/functions/branches/statements** (`vitest.config.ts`). New code without full coverage fails `test:coverage`. `tsconfig.json` is strict with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` — honor these.

## Architecture

Everything lives in `src/index.ts` (one file, no internal modules). Public exports: `log` (default logger), `createLogger(options?)`, and types `VerboseConsole<L>`, `VerboseLogOptions<L>`, `Threshold`.

The mechanism is a `Proxy` (`makeProxy`) wrapping a `Console`. Each proxy carries a fixed call `level` (rank). On property access:
- `.v(level)` returns a **new** proxy at the requested rank — this is how `log.v(2).info(...)` scopes one call. The base proxy is rank `0`.
- any other prop returns the underlying console member; if it's a function, it's wrapped so it only calls through when `passes(level, readThreshold(opts))` is true.

The threshold is read **fresh on every call** (`readThreshold`), so changing `VERBOSE` / the global at runtime takes effect immediately — don't cache it.

### The gating model (core invariant)

`Threshold` is `number | null`. `null` means "VERBOSE unset". A call at rank `L` prints when:
- `threshold === null` → `L <= 0` (base/rank-0 only)
- `threshold === n` → `L >= n`

So **higher `VERBOSE` = stricter = fewer messages**. `VERBOSE=0` prints everything; unset prints base only. This is the central, counterintuitive rule — preserve it in `passes()` and any docs.

### Strict vs lenient (deliberate split)

- **Strict** — `callRank()` backs `.v()`. Out-of-range numbers, non-integers, and unknown level names throw `RangeError`. `.v()` reflects *your* code; mistakes surface loudly.
- **Lenient** — `parseThreshold()` / `resolveLevelOption()` back `VERBOSE`, the `level` option, and `resolve()`. Numbers clamp into `[0, max-1]`; unrecognized values fall back gracefully. External input must never crash the app.

Keep this asymmetry when editing. Don't make config parsing throw; don't make `.v()` clamp.

### Ranks and named levels

Ranks are `0..max-1`. `max` = `levels.length` when `levels` is given, else `maxLevels` (default 3), floored at 1. Named levels (`createLogger({ levels: ["info","debug","trace"] })`) map name→rank by array order; `levels[0]` is the always-on base. The `const L` generic threads names through to `.v()` for autocomplete + compile-time typo rejection. Name lookup (`indexOfLevel`) is case-insensitive. In `parseThreshold`, a level literally named `"off"`/`"all"` resolves to its rank **before** keyword handling — names win over keywords.

### Threshold resolution order (`readThreshold`)

1. explicit `level` option (if not `undefined`) — via lenient `resolveLevelOption`
2. custom `resolve()` (if it returns non-`undefined`)
3. Node: `process.env[envVar]` (default `VERBOSE`)
4. Browser fallback (`readBrowserThreshold`): `globalThis[VERBOSE]` first, then `localStorage.getItem("VERBOSE")`. `localStorage` access is wrapped in try/catch (privacy mode / sandboxed iframe can throw).

`process` is feature-detected off `globalThis`, never assumed — that's what keeps the same build working in the browser.

## Conventions

- `v` is reserved on the proxy for level scoping; every other member passes through to the underlying console. Don't add other reserved keys without updating the proxy `get` trap and the type.
- `package.json` `files` is `["dist"]` — only built output ships. `save-exact=true` (`.npmrc`): dependency versions are pinned exactly; keep them pinned.
- Keep the single-file structure unless there's a strong reason to split; the whole point is a tiny zero-dep surface.
