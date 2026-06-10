// Node, CommonJS. Run: VERBOSE=1 node node-cjs.cjs
const { createLogger } = require("@meyerzon/verbose-log");

const log = createLogger(); // reads VERBOSE

log.info("base — always shown");
log.v(1).warn("level 1 — shown when VERBOSE >= 1");
log.v(2).debug("level 2 — needs VERBOSE >= 2");
