// Node, ESM. Run: VERBOSE=2 node node-esm.mjs
import { log } from "@meyerzon/verbose-log";

log.info("base — always shown unless VERBOSE=off");
log.v(1).info("level 1 — shown when VERBOSE >= 1");
log.v(2).debug("level 2 — shown when VERBOSE >= 2");

// Threshold is read fresh per call, so this reflects the current env.
log.info(`current VERBOSE = ${process.env.VERBOSE ?? "(unset -> base only)"}`);
