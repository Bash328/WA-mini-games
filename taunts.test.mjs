// Sanity checks for taunts.js. Run: node taunts.test.mjs
// Fails on: duplicate lines in a pool, over-long lines, a catchphrase (a whole
// sentence) reused in 3+ different pools, or an unknown/empty category.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const win = {};
vm.runInNewContext(readFileSync(new URL("./taunts.js", import.meta.url), "utf8"), { window: win });
const T = win.TAUNT_LINES;
const SHARED = ["loss", "reversal", "confidence", "lastChance", "win", "forfeit", "draw"];
const MAX_LEN = 90, MAX_POOLS_PER_PHRASE = 2;

const problems = [];
const phraseUse = new Map(); // sentence -> Set of "game.category"
for (const [game, block] of Object.entries(T)) {
  for (const [cat, lines] of Object.entries(block)) {
    const where = `${game}.${cat}`;
    if (game === "_" && !SHARED.includes(cat)) problems.push(`${where}: unknown generic category`);
    if (!lines.length) problems.push(`${where}: empty`);
    if (new Set(lines).size !== lines.length) problems.push(`${where}: duplicate line`);
    for (const l of lines) {
      if (l.length > MAX_LEN) problems.push(`${where}: too long: ${l}`);
      for (const s of l.split(/(?<=[.!?])\s+/)) {
        if (s.split(/\s+/).length < 2) continue;
        const k = s.toLowerCase();
        if (!phraseUse.has(k)) phraseUse.set(k, new Set());
        phraseUse.get(k).add(where);
      }
    }
  }
}
for (const [s, pools] of phraseUse) {
  if (pools.size > MAX_POOLS_PER_PHRASE) problems.push(`"${s}" is in ${pools.size} pools: ${[...pools].join(", ")}`);
}

if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("taunts.js ok");
