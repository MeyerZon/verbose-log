import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, log } from "../src/index.js";

/** A console that records every call instead of printing. */
function capture() {
  const lines: { method: string; args: unknown[] }[] = [];
  const c = new Proxy(
    {},
    {
      get:
        (_t, p) =>
        (...args: unknown[]) =>
          lines.push({ method: String(p), args }),
    },
  ) as unknown as Console;
  const first = () => lines.map((l) => l.args[0]);
  return { c, lines, first };
}

const ORIG = process.env.VERBOSE;
afterEach(() => {
  // Restore real globals BEFORE touching process.env (browser tests mask it).
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (ORIG === undefined) delete process.env.VERBOSE;
  else process.env.VERBOSE = ORIG;
});

describe("VERBOSE env threshold (numeric, higher = more)", () => {
  it("unset -> base only (rank 0)", () => {
    delete process.env.VERBOSE;
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).warn("c");
    expect(first()).toEqual(["a"]);
  });

  it("VERBOSE=0 -> base only", () => {
    process.env.VERBOSE = "0";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    expect(first()).toEqual(["a"]);
  });

  it("VERBOSE=1 -> ranks 0 and 1", () => {
    process.env.VERBOSE = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).warn("c");
    expect(first()).toEqual(["a", "b"]);
  });

  it("VERBOSE=2 -> every rank", () => {
    process.env.VERBOSE = "2";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).warn("c");
    expect(first()).toEqual(["a", "b", "c"]);
  });

  it("VERBOSE=-1 -> silence everything (even base)", () => {
    process.env.VERBOSE = "-1";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    expect(first()).toEqual([]);
  });
});

describe("parseThreshold", () => {
  // threshold for these helpers is whatever VERBOSE resolves to; we probe with
  // a base (rank 0) call and a deeper (rank 2) call.
  function probe(value: string) {
    process.env.VERBOSE = value;
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("base"); // rank 0
    v.v(2).debug("deep"); // rank 2
    return first();
  }

  it("empty string -> base only", () => {
    expect(probe("")).toEqual(["base"]);
  });

  it("whitespace -> base only", () => {
    expect(probe("   ")).toEqual(["base"]);
  });

  it.each(["false", "off", "no", "none", "OFF"])(
    "%s -> silence all",
    (val) => {
      expect(probe(val)).toEqual([]);
    },
  );

  it.each(["true", "on", "yes", "all", "ALL"])("%s -> enable all", (val) => {
    expect(probe(val)).toEqual(["base", "deep"]);
  });

  it("non-numeric junk -> enable all", () => {
    expect(probe("verbose")).toEqual(["base", "deep"]);
  });

  it("fractional VERBOSE is floored", () => {
    process.env.VERBOSE = "1.5"; // floor -> 1
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.v(1).log("keep"); // 1 <= 1
    v.v(2).log("drop"); // 2 <= 1 false
    expect(first()).toEqual(["keep"]);
  });

  it("very negative numeric clamps to -1 (silence)", () => {
    expect(probe("-5")).toEqual([]);
  });

  it("over-range numeric clamps to max-1 (enable all)", () => {
    expect(probe("9")).toEqual(["base", "deep"]);
  });
});

describe("named levels", () => {
  const LEVELS = ["info", "debug", "trace"] as const;

  it("threshold is the named rank; prints that rank and below", () => {
    process.env.VERBOSE = "debug"; // rank 1 -> print ranks 0,1
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS });
    v.log("base"); // rank 0 -> keep
    v.v("info").log("i"); // rank 0 -> keep
    v.v("debug").log("d"); // rank 1 -> keep
    v.v("trace").log("t"); // rank 2 -> drop
    expect(first()).toEqual(["base", "i", "d"]);
  });

  it("names and numbers are equivalent", () => {
    process.env.VERBOSE = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS });
    v.v("debug").log("a"); // rank 1 -> keep
    v.v(1).log("b"); // rank 1 -> keep
    v.v("trace").log("c"); // rank 2 -> drop
    v.v(2).log("d"); // rank 2 -> drop
    expect(first()).toEqual(["a", "b"]);
  });

  it("VERBOSE accepts a level name (case-insensitive)", () => {
    process.env.VERBOSE = "DEBUG"; // rank 1
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS });
    v.v("debug").log("d"); // rank 1 -> keep
    v.v("trace").log("t"); // rank 2 -> drop
    expect(first()).toEqual(["d"]);
  });

  it("a level name wins over a keyword of the same text", () => {
    process.env.VERBOSE = "all"; // matches level "all" (rank 1), not enable-all
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: ["quiet", "all", "loud"] });
    v.v("quiet").log("q"); // rank 0 -> keep
    v.v("all").log("a"); // rank 1 -> keep
    v.v("loud").log("l"); // rank 2 -> drop (proves threshold is 1, not max)
    expect(first()).toEqual(["q", "a"]);
  });

  it("level option accepts a name", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS, level: "debug" });
    v.v("info").log("i"); // rank 0 -> keep
    v.v("debug").log("d"); // rank 1 -> keep
    v.v("trace").log("t"); // rank 2 -> drop
    expect(first()).toEqual(["i", "d"]);
  });

  it("rejects unknown level names at compile time", () => {
    const { c } = capture();
    const v = createLogger({ console: c, levels: LEVELS });
    // @ts-expect-error "typo" is not a configured level name
    const bad = () => v.v("typo");
    expect(bad).toThrow(RangeError);
  });
});

describe("level cap", () => {
  it("throws on out-of-range / non-integer numeric level (strict)", () => {
    const { c } = capture();
    const v = createLogger({ console: c }); // default max 3 -> ranks 0..2
    expect(() => v.v(3)).toThrow(/out of range \[0, 2\]/);
    expect(() => v.v(-1)).toThrow(RangeError);
    expect(() => v.v(1.5)).toThrow(RangeError);
    expect(() => v.v(2)).not.toThrow();
  });

  it("unknown name error lists the valid names", () => {
    const { c } = capture();
    const v = createLogger({ console: c, levels: ["info", "debug"] });
    expect(() =>
      (v as unknown as { v(x: string): unknown }).v("nope"),
    ).toThrow(/expected one of: info, debug/);
  });

  it("unknown name on an unnamed logger throws without a hint", () => {
    const { c } = capture();
    const v = createLogger({ console: c });
    expect(() =>
      (v as unknown as { v(x: string): unknown }).v("nope"),
    ).toThrow(/unknown level "nope"$/);
  });

  it("clamps an over-range level option (lenient)", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, level: 9 }); // clamps to 2 (all)
    v.v(2).log("x");
    expect(first()).toEqual(["x"]);
  });

  it("level: -1 silences everything", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, level: -1 });
    v.log("base");
    v.v(1).log("hi");
    expect(first()).toEqual([]);
  });

  it("maxLevels widens the valid range", () => {
    const { c } = capture();
    const v = createLogger({ console: c, maxLevels: 5, level: 0 });
    expect(() => v.v(4)).not.toThrow(); // valid (max 5)
    expect(() => v.v(5)).toThrow(RangeError);
  });

  it("levels.length overrides maxLevels", () => {
    const { c } = capture();
    const v = createLogger({ console: c, levels: ["a", "b"], maxLevels: 9 });
    expect(() => v.v(2)).toThrow(RangeError); // max is 2 (from levels)
    expect(() => v.v(1)).not.toThrow();
  });
});

describe("options", () => {
  it("explicit level overrides env", () => {
    process.env.VERBOSE = "2"; // would enable all
    const { c, first } = capture();
    const v = createLogger({ console: c, level: 0 }); // base only
    v.v(1).log("x");
    v.log("y");
    expect(first()).toEqual(["y"]);
  });

  it("custom envVar", () => {
    process.env.MY_V = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c, envVar: "MY_V" });
    v.info("a");
    v.v(1).info("b");
    v.v(2).info("c");
    delete process.env.MY_V;
    expect(first()).toEqual(["a", "b"]);
  });

  it("resolve() takes precedence over env", () => {
    process.env.VERBOSE = "2";
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => 0 }); // base only
    v.v(1).log("x");
    v.log("y");
    expect(first()).toEqual(["y"]);
  });

  it("resolve() finite number is used", () => {
    delete process.env.VERBOSE;
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => 1 });
    v.v(1).log("a");
    v.v(2).log("b");
    expect(first()).toEqual(["a"]);
  });

  it("resolve() returning undefined falls through to env", () => {
    process.env.VERBOSE = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => undefined });
    v.v(1).info("b");
    v.v(2).info("c");
    expect(first()).toEqual(["b"]);
  });

  it("resolve() returning NaN falls through to env", () => {
    process.env.VERBOSE = "2";
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => Number("x") }); // NaN
    v.info("a");
    v.v(2).debug("b");
    expect(first()).toEqual(["a", "b"]);
  });

  it("resolve() returning Infinity falls through to env", () => {
    process.env.VERBOSE = "0";
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => Infinity });
    v.info("a");
    v.v(1).info("b");
    expect(first()).toEqual(["a"]);
  });

  it("level: NaN -> base only (lenient)", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, level: Number.NaN });
    v.log("base");
    v.v(1).log("hi");
    expect(first()).toEqual(["base"]);
  });

  it("threshold is read fresh on each call", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c });
    delete process.env.VERBOSE;
    v.v(1).log("dropped");
    process.env.VERBOSE = "1";
    v.v(1).log("kept");
    expect(first()).toEqual(["kept"]);
  });
});

describe("browser threshold (no process.env)", () => {
  // Mask only process.env (keep nextTick/exit so the vitest worker survives).
  function browser(setup: (g: Record<string, unknown>) => void) {
    const real = process;
    vi.stubGlobal(
      "process",
      new Proxy(real, {
        get: (t, p) => (p === "env" ? undefined : Reflect.get(t, p, t)),
      }),
    );
    setup(globalThis as unknown as Record<string, unknown>);
  }

  it("reads global var", () => {
    browser((g) => {
      g.VERBOSE = 1;
    });
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).info("c");
    delete (globalThis as Record<string, unknown>).VERBOSE;
    expect(first()).toEqual(["a", "b"]);
  });

  it("falls back to localStorage", () => {
    const store = new Map<string, string>([["VERBOSE", "2"]]);
    browser((g) => {
      delete g.VERBOSE;
      g.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
      } as unknown as Storage;
    });
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(2).debug("b");
    delete (globalThis as Record<string, unknown>).localStorage;
    expect(first()).toEqual(["a", "b"]);
  });

  it("localStorage miss -> base only", () => {
    browser((g) => {
      delete g.VERBOSE;
      g.localStorage = { getItem: () => null } as unknown as Storage;
    });
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    delete (globalThis as Record<string, unknown>).localStorage;
    expect(first()).toEqual(["a"]);
  });

  it("throwing localStorage is swallowed -> base only", () => {
    browser((g) => {
      delete g.VERBOSE;
      g.localStorage = {
        getItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage;
    });
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    delete (globalThis as Record<string, unknown>).localStorage;
    expect(first()).toEqual(["a"]);
  });

  it("no global var and no localStorage -> base only", () => {
    browser((g) => {
      delete g.VERBOSE;
      delete g.localStorage;
    });
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    expect(first()).toEqual(["a"]);
  });

  it("non-primitive global VERBOSE is ignored", () => {
    browser((g) => {
      g.VERBOSE = { nope: true };
      delete g.localStorage;
    });
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    delete (globalThis as Record<string, unknown>).VERBOSE;
    expect(first()).toEqual(["a"]); // ignored -> base only
  });

  it("a bundler-polyfilled process.env does not shadow global VERBOSE", () => {
    vi.stubGlobal(
      "process",
      new Proxy(process, {
        get: (t, p) => (p === "env" ? {} : Reflect.get(t, p, t)),
      }),
    );
    (globalThis as Record<string, unknown>).VERBOSE = 1;
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).info("c");
    delete (globalThis as Record<string, unknown>).VERBOSE;
    expect(first()).toEqual(["a", "b"]);
  });
});

describe("proxy behavior", () => {
  it("forwards arbitrary console methods and args", () => {
    process.env.VERBOSE = "2";
    const { c, lines } = capture();
    const v = createLogger({ console: c });
    v.group("g");
    v.table([1, 2, 3]);
    v.error("boom", 42);
    expect(lines.map((l) => l.method)).toEqual(["group", "table", "error"]);
    expect(lines[2]?.args).toEqual(["boom", 42]);
  });

  it("passes through non-function properties ungated", () => {
    const target = {
      data: 123,
      log: (..._a: unknown[]) => undefined,
    } as unknown as Console;
    const v = createLogger({ console: target, level: 0 });
    expect((v as unknown as { data: number }).data).toBe(123);
  });

  it("nested .v() rescopes (last wins)", () => {
    process.env.VERBOSE = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.v(2).v(1).log("kept"); // final rank 1 <= 1
    v.v(0).v(2).log("dropped"); // final rank 2 <= 1 false
    expect(first()).toEqual(["kept"]);
  });

  it("method identity is stable across accesses while passing", () => {
    delete process.env.VERBOSE; // threshold 0, rank-0 methods pass
    const { c } = capture();
    const v = createLogger({ console: c });
    expect(v.log).toBe(v.log);
    expect(v.warn).toBe(v.warn);
    expect(v.v).toBe(v.v);
  });

  it("passing call returns the underlying value; muted returns undefined", () => {
    const target = {
      log: (...args: unknown[]) => args[0],
    } as unknown as Console;
    const v = createLogger({ console: target, level: 1 });
    expect(v.v(1).log("live")).toBe("live"); // 1 <= 1 -> real method
    expect(v.v(2).log("muted")).toBeUndefined(); // 2 <= 1 false -> no-op
  });
});

describe("log export (default logger)", () => {
  it("log is a usable VerboseConsole bound to real console", () => {
    process.env.VERBOSE = "2";
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.v(2).log("hello");
    expect(spy).toHaveBeenCalledWith("hello");
  });

  it("default logger mutes deeper levels when VERBOSE unset", () => {
    delete process.env.VERBOSE;
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.v(1).log("nope");
    log.log("base");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("base");
  });

  it("exposes no default export (named exports only)", async () => {
    const mod = (await import("../src/index.js")) as Record<string, unknown>;
    expect(mod.default).toBeUndefined();
    expect(typeof mod.createLogger).toBe("function");
    expect(mod.log).toBeDefined();
  });
});
