// Named, typed levels. Run: VERBOSE=debug npx tsx named-levels.ts
import { createLogger } from "@meyerzon/verbose-log";

const log = createLogger({ levels: ["info", "debug", "trace"] });
//                          info=0 (base), debug=1, trace=2

log.info("info — base, always shown");
log.v("debug").info("debug — shown when VERBOSE >= debug (1)");
log.v("trace").info("trace — shown when VERBOSE >= trace (2)");

// VERBOSE=debug prints info + debug, but not trace.
// Numbers still work and are equivalent: log.v(1) === log.v("debug").

// Uncomment to see the compile-time guard (tsc / tsx will reject it):
// log.v("trcae").info("typo");
