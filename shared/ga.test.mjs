// Run: node shared/ga.test.mjs
// ga.js must send nothing from this machine (localhost, 127.0.0.1, ::1) and everything from a real hostname.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("./ga.js", import.meta.url), "utf8");
let fail = 0;
const check = (name, ok) => { if (!ok) { fail++; console.log("  FAIL  " + name); } };

function run(hostname) {
  const scripts = []; let onLoad = null;
  const win = {                                   // in a browser `window` is the global object: so is this
    location: { hostname, pathname: "/", search: "" },
    navigator: {},
    addEventListener: (t, f) => { if (t === "load") onLoad = f; },
    document: { createElement: () => ({}), head: { appendChild: (s) => scripts.push(s) } },
  };
  win.window = win;
  vm.runInContext(src, vm.createContext(win));
  if (onLoad) onLoad();
  return { hits: (win.dataLayer || []).length, scripts: scripts.length };
}

for (const h of ["localhost", "127.0.0.1", "[::1]"]) {
  const r = run(h);
  check(h + ": no hits queued", r.hits === 0);
  check(h + ": the analytics library is not loaded", r.scripts === 0);
}
for (const h of ["wa-minigames.online", "www.wa-minigames.online", "wa-minigames.somebody.workers.dev"]) {
  const r = run(h);
  check(h + ": hits are queued (js + config)", r.hits === 2);
  check(h + ": the analytics library is loaded", r.scripts === 1);
}
check("a lookalike host is not treated as local", run("localhost.evil.com").hits === 2);
console.log(fail ? fail + " FAILED" : "ga.js ok");
process.exit(fail ? 1 : 0);
