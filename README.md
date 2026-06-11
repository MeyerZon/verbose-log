<p align="center">
  <img src="assets/logo.png" alt="verbose-log" width="640" />
</p>

# @meyerzon/verbose-log

[![CI](https://github.com/MeyerZon/verbose-log/actions/workflows/ci.yml/badge.svg)](https://github.com/MeyerZon/verbose-log/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@meyerzon/verbose-log.svg)](https://www.npmjs.com/package/@meyerzon/verbose-log)
[![types](https://img.shields.io/npm/types/@meyerzon/verbose-log.svg)](https://www.npmjs.com/package/@meyerzon/verbose-log)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)
![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen.svg)

A `console` proxy gated by a `VERBOSE` threshold. Use it exactly like the
built-in `console`, but attach a verbosity level to any call and let the
environment decide what actually prints.

- **Zero dependencies**, dual **ESM + CJS** with full `.d.ts` types.
- **Node ≥ 20 and browsers.**
- **Higher `VERBOSE` = more output**, just like `-v` / `-vv` / `-vvv`.
- **Live**: change `VERBOSE` (or `localStorage`) at runtime, next call obeys —
  no restart, no page refresh.
- **Devtools-friendly**: passing calls keep your original file/line.
- **Typed named levels** with autocomplete and typo protection.

## Why this exists

I write tests for a living. Three times now I've dropped the same shape of code
into a suite — a hand-rolled `if (process.env.VERBOSE) console.log(...)` gate so
a failing case could be coaxed into explaining itself, then quietly torn back out
before the commit. The third time, I stopped deleting it and packaged it instead.

`verbose-log` is that gate, made permanent and worth keeping. Leave your
breadcrumbs in the code where the bug actually lives. Keep the suite silent by
default so CI stays readable. When something flakes, turn the knob — `VERBOSE=2` —
and the same code starts talking. No new logging framework, no churn — just
`console` with a threshold.

## Install

```sh
npm install @meyerzon/verbose-log
```

## Usage

```ts
import { log } from "@meyerzon/verbose-log";

log.info("always shown");          // rank 0 (base)
log.v(1).info("shown at VERBOSE>=1");
log.v(2).warn("shown at VERBOSE>=2");

// The full console surface is proxied:
log.v(1).table([{ a: 1 }]);
log.group("scope");
log.v(2).debug("deep detail");
log.groupEnd();
```

`.v(n)` scopes the next call to verbosity level `n`. A plain call is level `0`.

## Gating rules

`VERBOSE` is a **threshold**: a call at rank `L` prints when `L <= VERBOSE`.
Higher `VERBOSE` = **more** output (the `-v` / `-vv` mental model). Levels are
ranks `0..max-1` (`max` defaults to **3**, so ranks `0`, `1`, `2`).

| `VERBOSE`      | Prints                                  | Like   |
| -------------- | --------------------------------------- | ------ |
| _unset_ or `0` | base (rank 0) only                      |        |
| `1`            | ranks 0–1                               | `-v`   |
| `2`            | ranks 0–2 (everything, at default max)  | `-vv`  |
| `n`            | ranks `0..n`                            |        |
| `true` / `all` | every level                             |        |
| `off` / `false`| nothing — silences even the base        |        |

```sh
node app.js             # base only
VERBOSE=1 node app.js   # base + level 1
VERBOSE=2 node app.js   # everything (default max)
VERBOSE=off node app.js # silence completely
```

## Named levels

Give levels names instead of bare numbers. They are an **ordered** list (low ->
high verbosity); the index is the rank, and `levels[0]` is the base. Names are
fully typed — autocomplete at call sites, typos rejected by the compiler.
`VERBOSE` accepts a name or a number.

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
VERBOSE=info  node app.js   # base only
VERBOSE=debug node app.js   # info + debug
VERBOSE=trace node app.js   # everything
VERBOSE=1     node app.js   # same as VERBOSE=debug
```

### Why this is useful

- **Readable call sites** — `v("trace")` says what `v(2)` cannot.
- **Typo protection** — an unknown level fails `tsc`; at runtime `.v()` throws a
  `RangeError` that lists the valid names.
- **CLI `-v` / `-vv` / `-vvv`** — count the flags and feed the rank in:

  ```ts
  const verbosity = (process.argv.join(" ").match(/-v/g) ?? []).length;
  const log = createLogger({ maxLevels: 3, level: Math.min(verbosity, 2) });
  ```

- **Per-module namespaces** — there is no `debug`-style namespace selector, but a
  distinct env var per module gives the same selective control:

  ```ts
  const log = createLogger({ envVar: "VERBOSE_DB" }); // VERBOSE_DB=2 node app.js
  ```

- **Bounded granularity for library authors** — `maxLevels` (or a fixed `levels`
  list) caps how verbose consumers can get, keeping the `VERBOSE` vocabulary
  small and stable.

### Strict vs lenient

- **`.v()` is strict** — an out-of-range number, a non-integer, or an unknown
  name throws `RangeError`. This is your code; mistakes should surface.
- **`VERBOSE` / `level` / `resolve` are lenient** — out-of-range numbers are
  clamped into `[-1, max-1]` and unrecognized values fall back gracefully.
  External input must never crash the app.

## Browser

There is no `process.env` in the browser, so the threshold is resolved from, in
order:

1. a global variable — `globalThis.VERBOSE`
2. `localStorage.getItem("VERBOSE")`

```js
globalThis.VERBOSE = 1;
// or, persisted across reloads:
localStorage.setItem("VERBOSE", "2");
```

Both honor a custom `envVar`, so `createLogger({ envVar: "DEBUG_X" })` reads
`globalThis.DEBUG_X` / `localStorage.DEBUG_X`. Unlike `debug`, a change takes
effect on the **next call** — no page refresh.

> **Chrome/Edge gotcha:** `console.debug` output is hidden unless the devtools
> console **Verbose** log level is enabled. If `log.v(n).debug(...)` passes the
> threshold but you see nothing, check that filter — it's a devtools default,
> not this library.

## Stripping logs in production

`log.*` calls are ordinary function calls with side effects, so bundlers cannot
tree-shake them away. To drop them from a production build, use your minifier:

```js
// terser / esbuild minify options
{ compress: { drop_console: true } }
// or target only this lib's entry point via pure_funcs / a wrapper
```

Or gate at the source by pointing `resolve`/`level` at your build mode.

## Customizing

```ts
import { createLogger } from "@meyerzon/verbose-log";

const log = createLogger({
  envVar: "MY_VERBOSE",       // read a different env var (default "VERBOSE")
  level: 1,                   // hard-code the threshold; skips env lookup
  console: myConsole,         // proxy a custom console
  resolve: () => getLevel(),  // custom resolver: number | undefined
  levels: ["info", "debug"],  // named, ordered levels (sets max = length)
  maxLevels: 3,               // numeric cap when `levels` is omitted (default 3)
});
```

- `level` accepts a number, a level name, `0` for base-only, or `-1` to silence.
- `resolve` returning `undefined` (or a non-finite number) falls through to the
  env / browser lookup.
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
actually set) → `globalThis[envVar]` → `localStorage` → base only. A
bundler-polyfilled `process.env` without the var does **not** shadow the browser
sources, and a non-primitive global (object/function set by another script) is
ignored rather than coerced.

## Examples

Runnable snippets live in [`examples/`](./examples): Node ESM, Node CJS, named
levels in TypeScript, and a browser page.

## API

- `log` — default logger reading `VERBOSE`.
- `createLogger(options?)` — make a configured logger. Generic over the level
  names, so `createLogger({ levels: ["a", "b"] })` types `.v()` to
  `"a" | "b" | number`.
- Types: `VerboseConsole<L>`, `VerboseLogOptions<L>`, `Threshold`.

> Note: `v` is reserved on the proxy for level scoping; everything else passes
> through to the underlying console.

## Alternatives — when to use this, when not

Logging tools sort along two independent axes: **how much** to log (verbosity
depth) and **where** it came from (which subsystem). `verbose-log` does the
first — one `VERBOSE` knob over a drop-in `console`, zero deps. It deliberately
does **not** do namespaces, severity routing, structured output, or transports.

| Library                                            | Focus                                                       | Reach for it when…                                                      |
| -------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| **verbose-log**                                    | Verbosity **depth** via one `VERBOSE` env; drop-in console  | You want a single knob to dial how *much* console output an app/CLI emits, with no new API to learn |
| [`debug`](https://github.com/debug-js/debug)       | **Namespaces** (`DEBUG=app:db,app:api`)                     | You want to switch *subsystems* on/off, not depth                       |
| [`loglevel`](https://github.com/pimterry/loglevel) | **Severity** levels (trace→error), tiny, per-module loggers | You want standard severity methods in the browser, with named loggers   |
| [`consola`](https://github.com/unjs/consola)       | Pretty reporters, tags, prompts (Node + browser)            | You want nicely formatted, colorful dev output                          |
| [`pino`](https://github.com/pinojs/pino)           | Fast **structured** JSON logging                            | You need production logs / observability at high throughput             |
| [`winston`](https://github.com/winstonjs/winston)  | Transports + formats (files, HTTP, services)                | You need to route logs to multiple destinations in production           |
| `if (process.env.VERBOSE) console.log(...)`        | Nothing — hand-rolled                                       | …never again; that boilerplate is exactly what this replaces            |

The axes compose: it's common to run **pino** (or plain `console`) for
production and reach for **verbose-log** as the dev-time verbosity dial, or to
pair it with **debug** when you also need per-subsystem switches. If you find
yourself wanting namespaces, child loggers with bound context, or JSON output,
you've outgrown this library — use one of the above.

## License

MIT
