/* Run: node worker/canonical.test.mjs */

import { canonicalRedirect } from "./canonical.mjs";

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log((ok ? "  PASS  " : "  FAIL  ") + name);
  if (!ok) { console.log("     got:  " + JSON.stringify(got));
             console.log("     want: " + JSON.stringify(want)); fail++; } else pass++;
}

console.log("www redirects to the apex:");
check("bare root",
  canonicalRedirect("https://www.wa-minigames.online/"),
  "https://wa-minigames.online/");
check("path preserved",
  canonicalRedirect("https://www.wa-minigames.online/tic-tac-toe/"),
  "https://wa-minigames.online/tic-tac-toe/");

console.log("\nthe game state survives the redirect (this is the whole game):");
check("?s= preserved exactly",
  canonicalRedirect("https://www.wa-minigames.online/tic-tac-toe/?s=N4Ig5iBcIC4JYGMC0MCGyYHsCmIA0IAblAEwFxQgCM2AzAI6YDO_slA8qwEa"),
  "https://wa-minigames.online/tic-tac-toe/?s=N4Ig5iBcIC4JYGMC0MCGyYHsCmIA0IAblAEwFxQgCM2AzAI6YDO_slA8qwEa");
check("underscore in state not mangled",
  canonicalRedirect("https://www.wa-minigames.online/chess/?s=aB_cD_eF"),
  "https://wa-minigames.online/chess/?s=aB_cD_eF");
check("multiple params kept in order",
  canonicalRedirect("https://www.wa-minigames.online/mancala/?s=abc&x=1"),
  "https://wa-minigames.online/mancala/?s=abc&x=1");

console.log("\neverything else is served as-is (null = no redirect):");
check("apex untouched",
  canonicalRedirect("https://wa-minigames.online/tic-tac-toe/?s=abc"), null);
check("workers.dev untouched",
  canonicalRedirect("https://wa-minigames.cwakiku.workers.dev/"), null);
check("versioned preview URL untouched",
  canonicalRedirect("https://abc123-wa-minigames.cwakiku.workers.dev/"), null);
check("localhost dev untouched",
  canonicalRedirect("http://127.0.0.1:8787/tic-tac-toe/?s=abc"), null);
check("a host merely containing www is untouched",
  canonicalRedirect("https://wwwx.wa-minigames.online/"), null);
check("apex with www later in the path is untouched",
  canonicalRedirect("https://wa-minigames.online/www./"), null);
check("garbage input does not throw",
  canonicalRedirect("not a url"), null);

console.log("\n" + (fail ? "RESULT: " + fail + " FAILED, " + pass + " passed"
                         : "RESULT: all " + pass + " checks passed"));
process.exit(fail ? 1 : 0);
