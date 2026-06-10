<p align="center">
  <img src="assets/logo.png" alt="verbose-log" width="640" />
</p>

# @meyerzon/verbose-log

[![CI](https://github.com/MeyerZon/verbose-log/actions/workflows/ci.yml/badge.svg)](https://github.com/MeyerZon/verbose-log/actions/workflows/ci.yml)

A `console` proxy gated by a `VERBOSE` threshold. Use it exactly like the
built-in `console`, but attach a verbosity level to any call and let the
environment decide what actually prints. Works in Node and the browser.

## Install

```sh
npm install @meyerzon/verbose-log
```

## Usage

```ts
import { log } from "@meyerzon/verbose-log";

log.info("always-ish (level 0)");
log.v(1).info("shown when VERBOSE >= ... see rules below");
log.v(2).warn("deeper detail");

// Full console surface is proxied:
log.v(1).table([{ a: 1 }]);
log.group("scope");
log.v(2).debug("trace-ish");
log.groupEnd();
```

`.v(n)` scopes the next call to verbosity level `n`. A plain call is level `0`.

## Gating rules

`VERBOSE` is a **threshold**. A call at level `L` prints when:

| `VERBOSE`     | Effective rule        | Prints                       |
| ------------- | --------------------- | ---------------------------- |
| _unset_       | `L <= 0`              | base (level 0) only          |
| `0`           | `L >= 0`              | every level                  |
| `1`           | `L >= 1`              | level 1 and above (0 muted)  |
| `n`           | `L >= n`              | level `n` and above          |
| `true`/`all`  | `L >= 0`              | every level                  |
| `false`/`off` | `L <= 0`              | base only                    |

Higher `VERBOSE` = stricter = fewer messages. Levels are ranks `0..max-1`
(`max` defaults to **3**, so ranks `0`, `1`, `2`).

```sh
VERBOSE=0 node app.js   # everything
VERBOSE=2 node app.js   # only level >= 2
node app.js             # base only
```

## Named levels

Give levels names instead of bare numbers. They are an **ordered** list (low ->
high verbosity); the index is the rank, and `levels[0]` is the always-on base.
Names are fully typed — autocomplete at call sites, typos rejected by the
compiler. `VERBOSE` accepts a name or a number.

```ts
import { createLogger } from "@meyerzon/verbose-log";

const log = createLogger({ levels: ["info", "debug", "trace"] });
//                          info=0 (base), debug=1, trace=2

log.info("always shown");        // rank 0
log.v("debug").info("detail");   // rank 1
log.v("trace").info("deep");     // rank 2
log.v(1).info("same as debug");  // numbers still work

// @ts-expect-error — not a configured level
log.v("trcae").info("typo caught at compile time");
```

```sh
VERBOSE=debug node app.js   # debug + trace
VERBOSE=trace node app.js   # trace only
VERBOSE=1     node app.js   # same as VERBOSE=debug
```

### Why this is useful

- **Readable call sites** — `v("trace")` says what `v(2)` cannot.
- **Typo protection** — an unknown level name fails `tsc`; at runtime `.v()`
  throws a `RangeError` (developer errors are loud).
- **CLI `-v` / `-vv` / `-vvv`** — count the flags and feed the rank in:

  ```ts
  const verbosity = (argv.match(/-v/g) ?? []).length; // 0..n
  const log = createLogger({ maxLevels: 3, level: Math.min(verbosity, 2) });
  ```

- **Bounded granularity for library authors** — `maxLevels` (or a fixed
  `levels` list) caps how verbose consumers can get, keeping your library's
  `VERBOSE` vocabulary small and stable.

### Strict vs lenient

- **`.v()` is strict** — an out-of-range number, a non-integer, or an unknown
  name throws `RangeError`. This is your code; mistakes should surface.
- **`VERBOSE` / `level` / `resolve` are lenient** — out-of-range numbers are
  clamped into `[0, max-1]` and unrecognized values fall back gracefully.
  External input must never crash the app.

## Browser

There is no `process.env` in the browser, so the threshold is resolved from,
in order:

1. a global variable — `globalThis.VERBOSE`
2. `localStorage.getItem("VERBOSE")`

```js
globalThis.VERBOSE = 1;
// or
localStorage.setItem("VERBOSE", "1");
```

## Customizing

```ts
import { createLogger } from "@meyerzon/verbose-log";

const log = createLogger({
  envVar: "MY_VERBOSE",        // read a different env var (default "VERBOSE")
  level: 1,                    // hard-code the threshold; skips env lookup
  console: myConsole,          // proxy a custom console
  resolve: () => getLevel(),   // custom resolver: number | null | undefined
  levels: ["info", "debug"],   // named, ordered levels (sets max = length)
  maxLevels: 3,                // numeric cap when `levels` is omitted (default 3)
});
```

- `level: null` forces base-only; `level` also accepts a level name.
- `resolve` returning `undefined` falls through to the env / browser lookup.
- `levels` sets the cap to its length; otherwise `maxLevels` (default `3`) caps
  the numeric range.
- The threshold is read **fresh on every call**, so changing `VERBOSE` (or the
  global var) at runtime takes effect immediately. Caveat: if you toggle it
  *between* the halves of a paired op (`group`/`groupEnd`, `time`/`timeEnd`,
  `count`/`countReset`) one half may be suppressed and the other not — toggle
  between logical sections, not inside a pair.

### Resolution order

For each call the threshold is resolved in this order, first hit wins:
`level` option → `resolve()` (a non-finite return is skipped) → the env var (if
actually set) → `globalThis[envVar]` → `localStorage`. A bundler-polyfilled
`process.env` without the var does **not** shadow the browser sources, and a
non-primitive global (object/function set by another script) is ignored rather
than coerced.

## API

- `log` — default logger reading `VERBOSE`.
- `createLogger(options?)` — make a configured logger. Generic over the level
  names, so `createLogger({ levels: ["a", "b"] })` types `.v()` to `"a" | "b" |
  number`.
- Types: `VerboseConsole<L>`, `VerboseLogOptions<L>`, `Threshold`.

> Note: `v` is reserved on the proxy for level scoping; everything else passes
> through to the underlying console.

## License

MIT
