/**
 * verbose-log — a console proxy gated by a `VERBOSE` threshold.
 *
 * Behaves like the standard `console`, but every method is filtered by a
 * verbosity level resolved from the environment (Node) or the global scope /
 * `localStorage` (browser).
 *
 * Levels are ranks (`0..max-1`). A logger may name them — `levels: ["info",
 * "debug", "trace"]` maps name -> rank by order — so calls read `v("debug")`
 * with autocomplete and typo protection. Numbers still work everywhere.
 *
 * Gating model (higher `VERBOSE` = MORE output, like `-v` / `-vv` / `-vvv`):
 *   - print a call at rank `L` iff `L <= threshold`
 *   - `VERBOSE` unset / `0` -> threshold `0` -> base (rank 0) only
 *   - `VERBOSE=2`           -> threshold `2` -> ranks 0,1,2  (i.e. `-vv`)
 *   - `VERBOSE=off`         -> threshold `-1` -> silence everything (even base)
 *   - `VERBOSE=all`/`true`  -> threshold max -> every level
 *
 * Strict for code, lenient for config: `.v()` throws on an out-of-range or
 * unknown level (developer error), while `VERBOSE` / `level` / `resolve` values
 * are clamped or ignored so external input never crashes the app.
 *
 * Call sites are preserved: a passing call returns the real (bound) console
 * method, so browser devtools still point at *your* line, not this library.
 *
 * Live-toggle caveat: the threshold is re-read on every call. If you change
 * `VERBOSE` at runtime *between* the two halves of a paired console op
 * (`group`/`groupEnd`, `time`/`timeEnd`, `count`/`countReset`), one half may be
 * suppressed and the other not — toggle between logical sections, not inside a
 * pair.
 */

/** A resolved verbosity threshold: print a call at rank `L` iff `L <= threshold`. */
export type Threshold = number;

export interface VerboseLogOptions<L extends readonly string[] = []> {
  /** Env var name read for the threshold in Node. Default `"VERBOSE"`. */
  envVar?: string;
  /**
   * Explicit threshold. When set, env / browser lookup is skipped. A number
   * (print ranks `<=` it; `-1` silences everything) or a level name. Out-of-range
   * numbers are clamped.
   */
  level?: number | (L[number] & string);
  /** Console implementation to proxy. Default `globalThis.console`. */
  console?: Console;
  /**
   * Custom threshold resolver. Runs before the built-in env / browser lookup.
   * Return a number, or `undefined` to fall through. A non-finite number
   * (`NaN`/`Infinity`) is also treated as fall-through.
   */
  resolve?: () => number | undefined;
  /** Ordered level names, low -> high verbosity. Index = rank. */
  levels?: L;
  /** Max number of ranks when `levels` is not set. Default `3`. */
  maxLevels?: number;
}

/** Accepted argument to `.v()`: a configured level name, or any rank number. */
type LevelArg<L extends readonly string[]> = L extends readonly []
  ? number
  : L[number] | number;

/** A `console` with an extra `.v(level)` to scope calls to a verbosity level. */
export interface VerboseConsole<L extends readonly string[] = []>
  extends Console {
  /** Scope subsequent calls to verbosity `level` (a name or a rank number). */
  v(level: LevelArg<L>): VerboseConsole<L>;
}

interface ResolvedOptions {
  envVar: string;
  level: number | string | undefined;
  resolve: (() => number | undefined) | undefined;
  /** Original level names, used for error messages. Index = rank. */
  names: readonly string[];
  /** Level names, pre-lowercased once for cheap lookups. Index = rank. */
  lcLevels: readonly string[];
  max: number;
  /** Memo of the last raw env/global string parsed. */
  memo: { raw: string; out: number } | null;
}

/** Primitive global types accepted as a threshold source. */
const SCALAR_TYPES = new Set(["string", "number", "boolean"]);

/** Keywords that silence everything (threshold `-1`). */
const OFF_WORDS = new Set(["false", "off", "no", "none"]);

/** Keywords that enable every level (threshold `max-1`). */
const ALL_WORDS = new Set(["true", "on", "yes", "all"]);

/** Shared suppressed call — returned (not allocated) when a call is gated out. */
const NOOP = (): undefined => undefined;

/** Floor `n` and clamp it into the `[-1, max-1]` window (`-1` = silence all). */
function clamp(n: number, max: number): number {
  const i = Math.floor(n);
  if (i < -1) return -1;
  if (i > max - 1) return max - 1;
  return i;
}

/** Index of `name` in a pre-lowercased level list, or `-1`. */
function indexOfLevel(lcLevels: readonly string[], name: string): number {
  const lc = name.toLowerCase();
  for (let i = 0; i < lcLevels.length; i++) {
    if (lcLevels[i] === lc) return i;
  }
  return -1;
}

/** Decide whether a call at `level` passes the active `threshold`. */
function passes(level: number, threshold: number): boolean {
  return level <= threshold;
}

/**
 * Strict rank resolution for `.v()`. Throws on an out-of-range number or an
 * unknown level name — these are developer mistakes worth surfacing loudly.
 */
function callRank(value: number | string, opts: ResolvedOptions): number {
  const max = opts.max;
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value >= max) {
      throw new RangeError(
        `verbose-log: level ${value} out of range [0, ${max - 1}]`,
      );
    }
    return value;
  }
  const idx = indexOfLevel(opts.lcLevels, value);
  if (idx < 0) {
    const hint = opts.names.length
      ? ` (expected one of: ${opts.names.join(", ")})`
      : "";
    throw new RangeError(`verbose-log: unknown level "${value}"${hint}`);
  }
  return idx;
}

/** Lenient: parse a raw string value (env / global) into a threshold. */
function parseThreshold(
  raw: string,
  lcLevels: readonly string[],
  max: number,
): number {
  const s = raw.trim();
  if (s === "") return 0; // present but empty -> base only
  // Names win over keywords, so a level literally named "off"/"all" still
  // resolves to its rank.
  const named = indexOfLevel(lcLevels, s);
  if (named >= 0) return named;
  const lc = s.toLowerCase();
  if (OFF_WORDS.has(lc)) return -1;
  if (ALL_WORDS.has(lc)) return max - 1;
  const n = Number(s);
  if (Number.isFinite(n)) return clamp(n, max); // clamp() floors fractional env
  // Present but non-numeric, non-name (e.g. "verbose") -> be verbose: enable all.
  return max - 1;
}

/** Lenient resolution of the `level` option (number | name). */
function resolveLevelOption(
  value: number | string,
  lcLevels: readonly string[],
  max: number,
): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? clamp(value, max) : 0; // NaN -> base only
  }
  return parseThreshold(value, lcLevels, max);
}

/**
 * Read a threshold from the browser: global var first, then localStorage.
 * Returns `undefined` when neither source is present.
 */
function readBrowserThreshold(
  key: string,
  lcLevels: readonly string[],
  max: number,
): number | undefined {
  const g = globalThis as Record<string, unknown>;
  if (key in g) {
    const raw = g[key];
    if (SCALAR_TYPES.has(typeof raw)) {
      return parseThreshold(String(raw), lcLevels, max);
    }
    // A non-primitive collision (another script set an object/function on the
    // same global) is ignored — fall through to localStorage rather than
    // coercing "[object Object]" into enable-all.
  }
  try {
    const ls = (g as { localStorage?: Storage }).localStorage;
    if (ls && typeof ls.getItem === "function") {
      const v = ls.getItem(key);
      if (v != null) return parseThreshold(v, lcLevels, max);
    }
  } catch {
    // localStorage access can throw (privacy mode, sandboxed iframe).
  }
  return undefined;
}

/** Parse an env string, memoizing the last raw value for the hot path. */
function parseEnvMemo(opts: ResolvedOptions, raw: string): number {
  const m = opts.memo;
  if (m && m.raw === raw) return m.out;
  const out = parseThreshold(raw, opts.lcLevels, opts.max);
  opts.memo = { raw, out };
  return out;
}

/** Resolve the active threshold for a logger, fresh on every call. */
function readThreshold(opts: ResolvedOptions): number {
  if (opts.level !== undefined) {
    return resolveLevelOption(opts.level, opts.lcLevels, opts.max);
  }
  if (opts.resolve) {
    const r = opts.resolve();
    if (typeof r === "number" && Number.isFinite(r)) return clamp(r, opts.max);
    // `undefined` or a non-finite number -> fall through to env / browser.
  }
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  if (env && typeof env === "object") {
    const raw = env[opts.envVar];
    // A bundler-polyfilled `process.env` (no real var) must not shadow the
    // documented browser sources — only return when the var is actually set.
    if (raw != null) return parseEnvMemo(opts, raw);
  }
  // Nothing set anywhere -> base only (rank 0).
  return readBrowserThreshold(opts.envVar, opts.lcLevels, opts.max) ?? 0;
}

/** Build a gated proxy around `target` for a fixed call `level` (rank). */
function makeProxy<L extends readonly string[]>(
  target: Console,
  level: number,
  opts: ResolvedOptions,
): VerboseConsole<L> {
  // Cache the `.v` factory and per-method bound functions. Bound methods keep
  // a stable identity AND preserve the caller's devtools call site.
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === "v") {
        let vfn = cache.get(prop);
        if (vfn === undefined) {
          vfn = (lvl: number | string): VerboseConsole<L> =>
            makeProxy<L>(t, callRank(lvl, opts), opts);
          cache.set(prop, vfn);
        }
        return vfn;
      }
      const value = Reflect.get(t, prop, receiver) as unknown;
      // Non-function members are returned live so data properties stay in sync.
      if (typeof value !== "function") return value;
      // Gate at access time. Suppressed -> shared no-op; passing -> the REAL
      // method, bound, so devtools blames the caller's line, not this file.
      if (!passes(level, readThreshold(opts))) return NOOP;
      let bound = cache.get(prop);
      if (bound === undefined) {
        bound = (value as (...a: unknown[]) => unknown).bind(t);
        cache.set(prop, bound);
      }
      return bound;
    },
  }) as unknown as VerboseConsole<L>;
}

/** Create a verbose console with the given options. */
export function createLogger<const L extends readonly string[] = []>(
  options: VerboseLogOptions<L> = {},
): VerboseConsole<L> {
  const levels = (options.levels ?? []) as readonly string[];
  const max = Math.max(1, levels.length || (options.maxLevels ?? 3));
  const target = options.console ?? globalThis.console;
  const opts: ResolvedOptions = {
    envVar: options.envVar ?? "VERBOSE",
    level: options.level,
    resolve: options.resolve,
    names: levels,
    lcLevels: levels.map((s) => s.toLowerCase()),
    max,
    memo: null,
  };
  return makeProxy<L>(target, 0, opts);
}

/** Default logger, reading `VERBOSE` from the environment. */
export const log: VerboseConsole = createLogger();
