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
 * Gating model:
 *   - threshold === null  (VERBOSE unset) -> print iff callRank <= 0  // base only
 *   - threshold === n                     -> print iff callRank >= n
 *
 * So `VERBOSE=0` prints every level, `VERBOSE=1` drops level 0, and an unset
 * `VERBOSE` keeps the base (rank 0 / `levels[0]`) calls only.
 *
 * Strict for code, lenient for config: `.v()` throws on an out-of-range or
 * unknown level (developer error), while `VERBOSE` / `level` / `resolve` values
 * are clamped or ignored so external input never crashes the app.
 *
 * Live-toggle caveat: the threshold is re-read on every call. If you change
 * `VERBOSE` at runtime *between* the two halves of a paired console op
 * (`group`/`groupEnd`, `time`/`timeEnd`, `count`/`countReset`), one half may be
 * suppressed and the other not — e.g. an unclosed `group` leaves later output
 * indented. Toggle between logical sections, not inside a pair.
 */

/** A resolved verbosity threshold. `null` means "VERBOSE unset" (base only). */
export type Threshold = number | null;

export interface VerboseLogOptions<L extends readonly string[] = []> {
  /** Env var name read for the threshold in Node. Default `"VERBOSE"`. */
  envVar?: string;
  /**
   * Explicit threshold. When set, env / browser lookup is skipped.
   * `null` = base-only (rank 0), a number = print ranks `>=` it, or a level
   * name. Out-of-range numbers are clamped; unknown names fall back leniently.
   */
  level?: Threshold | (L[number] & string);
  /** Console implementation to proxy. Default `globalThis.console`. */
  console?: Console;
  /**
   * Custom threshold resolver. Runs before the built-in env / browser lookup.
   * Return a number, `null` (base-only), or `undefined` to fall through. A
   * non-finite number (`NaN`/`Infinity`) is also treated as fall-through.
   */
  resolve?: () => Threshold | undefined;
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
  level: Threshold | string | undefined;
  resolve: (() => Threshold | undefined) | undefined;
  /** Level names, pre-lowercased once for cheap lookups. Index = rank. */
  lcLevels: readonly string[];
  max: number;
  /** Memo of the last raw env/global string parsed. */
  memo: { raw: string; out: Threshold } | null;
}

/** Primitive global types accepted as a threshold source. */
const SCALAR_TYPES = new Set(["string", "number", "boolean"]);

/** Floor `n` and clamp it into the valid `[0, max-1]` window. */
function clamp(n: number, max: number): number {
  const i = Math.floor(n);
  if (i < 0) return 0;
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
function passes(level: number, threshold: Threshold): boolean {
  if (threshold === null) return level <= 0;
  return level >= threshold;
}

/**
 * Strict rank resolution for `.v()`. Throws on an out-of-range number or an
 * unknown level name — these are developer mistakes worth surfacing loudly.
 */
function callRank(
  value: number | string,
  lcLevels: readonly string[],
  max: number,
): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || value >= max) {
      throw new RangeError(
        `verbose-log: level ${value} out of range [0, ${max - 1}]`,
      );
    }
    return value;
  }
  const idx = indexOfLevel(lcLevels, value);
  if (idx < 0) {
    throw new RangeError(`verbose-log: unknown level "${value}"`);
  }
  return idx;
}

/** Lenient: parse a raw string value (env / global) into a threshold. */
function parseThreshold(
  raw: string,
  lcLevels: readonly string[],
  max: number,
): Threshold {
  const s = raw.trim();
  if (s === "") return null;
  // Names win over keywords, so a level literally named "off"/"all" still
  // resolves to its rank.
  const named = indexOfLevel(lcLevels, s);
  if (named >= 0) return named;
  const lc = s.toLowerCase();
  if (lc === "false" || lc === "off" || lc === "no") return null;
  if (lc === "true" || lc === "on" || lc === "yes" || lc === "all") return 0;
  const n = Number(s);
  if (Number.isFinite(n)) return clamp(n, max); // clamp() floors fractional env
  // Present but non-numeric, non-name (e.g. "verbose") -> enable all.
  return 0;
}

/** Lenient resolution of the `level` option (number | name | null). */
function resolveLevelOption(
  value: Threshold | string,
  lcLevels: readonly string[],
  max: number,
): Threshold {
  if (value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? clamp(value, max) : null;
  }
  return parseThreshold(value, lcLevels, max);
}

/** Read a threshold from the browser: global var first, then localStorage. */
function readBrowserThreshold(
  key: string,
  lcLevels: readonly string[],
  max: number,
): Threshold {
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
  return null;
}

/** Parse an env string, memoizing the last raw value for the hot path. */
function parseEnvMemo(opts: ResolvedOptions, raw: string): Threshold {
  const m = opts.memo;
  if (m && m.raw === raw) return m.out;
  const out = parseThreshold(raw, opts.lcLevels, opts.max);
  opts.memo = { raw, out };
  return out;
}

/** Resolve the active threshold for a logger, fresh on every call. */
function readThreshold(opts: ResolvedOptions): Threshold {
  if (opts.level !== undefined) {
    return resolveLevelOption(opts.level, opts.lcLevels, opts.max);
  }
  if (opts.resolve) {
    const r = opts.resolve();
    if (r === null) return null;
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
  return readBrowserThreshold(opts.envVar, opts.lcLevels, opts.max);
}

/** Build a gated proxy around `target` for a fixed call `level` (rank). */
function makeProxy<L extends readonly string[]>(
  target: Console,
  level: number,
  opts: ResolvedOptions,
): VerboseConsole<L> {
  // Cache wrappers per property so method identity is stable
  // (`logger.log === logger.log`) and hot paths don't allocate per access.
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (cache.has(prop)) return cache.get(prop);
      if (prop === "v") {
        const vfn = (lvl: number | string): VerboseConsole<L> =>
          makeProxy<L>(t, callRank(lvl, opts.lcLevels, opts.max), opts);
        cache.set(prop, vfn);
        return vfn;
      }
      const value = Reflect.get(t, prop, receiver) as unknown;
      // Non-function members are returned live (never cached) so data
      // properties stay in sync with the underlying console.
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      const wrapper = (...args: unknown[]): unknown => {
        if (passes(level, readThreshold(opts))) return fn.apply(t, args);
        return undefined;
      };
      cache.set(prop, wrapper);
      return wrapper;
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
    lcLevels: levels.map((s) => s.toLowerCase()),
    max,
    memo: null,
  };
  return makeProxy<L>(target, 0, opts);
}

/** Default logger, reading `VERBOSE` from the environment. */
export const log: VerboseConsole = createLogger();
