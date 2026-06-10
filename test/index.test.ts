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

describe("VERBOSE env threshold (numeric)", () => {
  it("unset -> only level 0 prints", () => {
    delete process.env.VERBOSE;
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).warn("c");
    expect(first()).toEqual(["a"]);
  });

  it("VERBOSE=0 -> all levels print", () => {
    process.env.VERBOSE = "0";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).warn("c");
    expect(first()).toEqual(["a", "b", "c"]);
  });

  it("VERBOSE=1 -> drops level 0", () => {
    process.env.VERBOSE = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    v.v(2).warn("c");
    expect(first()).toEqual(["b", "c"]);
  });

  it("negative threshold clamps to 0 (prints all)", () => {
    process.env.VERBOSE = "-1";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    expect(first()).toEqual(["a", "b"]);
  });
});

describe("parseThreshold", () => {
  function only0For(value: string) {
    process.env.VERBOSE = value;
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("base");
    v.v(1).info("hi");
    return first();
  }
  function allFor(value: string) {
    process.env.VERBOSE = value;
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("base");
    v.v(2).debug("deep");
    return first();
  }

  it("empty string -> base only", () => {
    expect(only0For("")).toEqual(["base"]);
  });

  it("whitespace -> base only", () => {
    expect(only0For("   ")).toEqual(["base"]);
  });

  it.each(["false", "off", "no", "OFF", "No"])("%s -> base only", (val) => {
    expect(only0For(val)).toEqual(["base"]);
  });

  it.each(["true", "on", "yes", "all", "ALL", "Yes"])(
    "%s -> enable all",
    (val) => {
      expect(allFor(val)).toEqual(["base", "deep"]);
    },
  );

  it("non-numeric junk -> enable all", () => {
    expect(allFor("verbose")).toEqual(["base", "deep"]);
  });

  it("numeric string trims whitespace", () => {
    process.env.VERBOSE = "  2  ";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.v(1).info("drop");
    v.v(2).info("keep");
    expect(first()).toEqual(["keep"]);
  });
});

describe("named levels", () => {
  const LEVELS = ["info", "debug", "trace"] as const;

  it("gates by rank, plain call is base (rank 0)", () => {
    process.env.VERBOSE = "debug";
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS });
    v.log("base"); // rank 0 -> drop
    v.v("info").log("i"); // rank 0 -> drop
    v.v("debug").log("d"); // rank 1 -> keep
    v.v("trace").log("t"); // rank 2 -> keep
    expect(first()).toEqual(["d", "t"]);
  });

  it("names and numbers are equivalent", () => {
    process.env.VERBOSE = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS });
    v.v("debug").log("a"); // rank 1 -> keep
    v.v(1).log("b"); // rank 1 -> keep
    v.v("info").log("c"); // rank 0 -> drop
    v.v(0).log("d"); // rank 0 -> drop
    expect(first()).toEqual(["a", "b"]);
  });

  it("VERBOSE accepts a level name (case-insensitive)", () => {
    process.env.VERBOSE = "TRACE";
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS });
    v.v("debug").log("d"); // rank 1 -> drop
    v.v("trace").log("t"); // rank 2 -> keep
    expect(first()).toEqual(["t"]);
  });

  it("a level name wins over a keyword of the same text", () => {
    process.env.VERBOSE = "all"; // matches level "all" (rank 1), not enable-all
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: ["quiet", "all", "loud"] });
    v.v("quiet").log("q"); // rank 0 -> drop
    v.v("all").log("a"); // rank 1 -> keep
    expect(first()).toEqual(["a"]);
  });

  it("level option accepts a name", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, levels: LEVELS, level: "debug" });
    v.v("info").log("i"); // rank 0 -> drop
    v.v("debug").log("d"); // rank 1 -> keep
    expect(first()).toEqual(["d"]);
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
    expect(() => v.v(3)).toThrow(RangeError);
    expect(() => v.v(-1)).toThrow(RangeError);
    expect(() => v.v(1.5)).toThrow(RangeError);
    expect(() => v.v(2)).not.toThrow();
  });

  it("throws on unknown name for a named logger (strict)", () => {
    const { c } = capture();
    const v = createLogger({ console: c, levels: ["a", "b"] });
    expect(() => (v as unknown as { v(x: string): unknown }).v("nope")).toThrow(
      RangeError,
    );
  });

  it("clamps an over-range VERBOSE threshold (lenient)", () => {
    process.env.VERBOSE = "9"; // clamps to 2
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.v(2).log("x"); // 2 >= 2 -> keep
    v.v(1).log("y"); // 1 >= 2 -> drop
    expect(first()).toEqual(["x"]);
  });

  it("clamps an over-range level option (lenient)", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, level: 9 }); // clamps to 2
    v.v(2).log("x");
    v.v(1).log("y");
    expect(first()).toEqual(["x"]);
  });

  it("maxLevels widens the valid range", () => {
    const { c, lines } = capture();
    const v = createLogger({ console: c, maxLevels: 5, level: 0 });
    v.v(4).log("x"); // valid (max 5)
    expect(lines).toHaveLength(1);
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
    process.env.VERBOSE = "2";
    const { c, lines } = capture();
    const v = createLogger({ console: c, level: 0 });
    v.v(2).log("x");
    expect(lines).toHaveLength(1);
  });

  it("level: null -> base only", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, level: null });
    v.log("base");
    v.v(1).log("hi");
    expect(first()).toEqual(["base"]);
  });

  it("custom envVar", () => {
    process.env.MY_V = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c, envVar: "MY_V" });
    v.info("a");
    v.v(1).info("b");
    delete process.env.MY_V;
    expect(first()).toEqual(["b"]);
  });

  it("resolve() takes precedence over env", () => {
    process.env.VERBOSE = "2";
    const { c, lines } = capture();
    const v = createLogger({ console: c, resolve: () => 0 });
    v.v(2).log("x");
    expect(lines).toHaveLength(1);
  });

  it("resolve() returning undefined falls through to env", () => {
    process.env.VERBOSE = "1";
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => undefined });
    v.info("a");
    v.v(1).info("b");
    expect(first()).toEqual(["b"]);
  });

  it("resolve() may return null (base only)", () => {
    process.env.VERBOSE = "0";
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => null });
    v.info("a");
    v.v(1).info("b");
    expect(first()).toEqual(["a"]);
  });

  it("resolve() over-range number is clamped", () => {
    const { c, first } = capture();
    const v = createLogger({ console: c, resolve: () => 9 }); // clamp to 2
    v.v(2).log("x");
    v.v(1).log("y");
    expect(first()).toEqual(["x"]);
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
  // Mask only process.env (keep nextTick/exit so the vitest worker survives)
  // so the browser resolution path runs.
  function browser(setup: (g: Record<string, unknown>) => void) {
    const real = process;
    vi.stubGlobal(
      "process",
      new Proxy(real, {
        get: (t, p) => (p === "env" ? undefined : Reflect.get(t, p, t)),
      }),
    );
    const g = globalThis as unknown as Record<string, unknown>;
    setup(g);
  }

  it("reads global var", () => {
    browser((g) => {
      g.VERBOSE = 1;
    });
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.info("a");
    v.v(1).info("b");
    delete (globalThis as Record<string, unknown>).VERBOSE;
    expect(first()).toEqual(["b"]);
  });

  it("falls back to localStorage", () => {
    const store = new Map<string, string>([["VERBOSE", "0"]]);
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
});

describe("proxy behavior", () => {
  it("forwards arbitrary console methods and args", () => {
    process.env.VERBOSE = "0";
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
    const v = createLogger({ console: target, level: null });
    expect((v as unknown as { data: number }).data).toBe(123);
  });

  it("nested .v() rescopes (last wins)", () => {
    process.env.VERBOSE = "2";
    const { c, first } = capture();
    const v = createLogger({ console: c });
    v.v(1).v(2).log("kept"); // final rank 2 >= 2
    v.v(2).v(0).log("dropped"); // final rank 0 < 2
    expect(first()).toEqual(["kept"]);
  });

  it("muted call returns undefined; live call returns underlying value", () => {
    const target = {
      log: (...args: unknown[]) => args[0],
    } as unknown as Console;
    const v = createLogger({ console: target, level: 1 });
    expect(v.v(0).log("muted")).toBeUndefined();
    expect(v.v(1).log("live")).toBe("live");
  });
});

describe("log export (default logger)", () => {
  it("log is a usable VerboseConsole bound to real console", () => {
    process.env.VERBOSE = "0";
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.v(2).log("hello");
    expect(spy).toHaveBeenCalledWith("hello");
  });

  it("default logger mutes high levels when VERBOSE unset", () => {
    delete process.env.VERBOSE;
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.v(2).log("nope");
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
