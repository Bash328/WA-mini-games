/* Run: node worker/users.test.mjs  (the rules for usernames and pokes) */
import * as U from "./users.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); } else { fail++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}
const T0 = 1_000_000_000;

console.log("names:");
{
  const why = (n) => U.checkName(n).reason;
  check("a normal name is fine", U.checkName("Kiku_2").ok === true);
  check("trimmed", U.checkName("  Kiku ").name === "Kiku");
  check("case-insensitive key", U.checkName("KIKU").key === U.checkName("kiku").key);
  check("too short", why("ab") === "length");
  check("too long", why("a".repeat(17)) === "length");
  check("spaces and symbols refused", why("a b c") === "chars" && why("kiku!") === "chars" && why("kík") === "chars");
  check("needs a letter", why("12345") === "chars" && why("___") === "chars");
  check("not a string", why(null) === "type" && why(42) === "type");
  check("reserved names", why("admin") === "reserved" && why("Ad_min") === "reserved" && why("CLAUDE") === "reserved");
  check("offensive names, plain and disguised", why("fuckface") === "offensive" && why("sh1thead") === "offensive" && why("n_a_z_i") === "offensive" && why("B1TCH") === "offensive");
  // ponytail: substring matching has the known "Scunthorpe problem": a few innocent names
  // that contain a listed word are refused too. Cheaper than a word list that misses
  // disguises; the player just picks another name.
  check("'ass' inside an ordinary word is fine", U.checkName("classy_cat").ok === true && U.checkName("Hassan_9").ok === true);
  check("a listed word inside a longer name is refused (known trade-off)", U.checkName("Scunthorpe").ok === false);
}

console.log("\ntokens:");
{
  const a = U.newToken(), b = U.newToken();
  check("tokens are 32 hex characters and differ", /^[0-9a-f]{32}$/.test(a) && a !== b);
  const h = await U.hashToken(a);
  check("a token matches its own hash only", U.sameHash(h, await U.hashToken(a)) && !U.sameHash(h, await U.hashToken(b)));
  check("the hash is not the token", h !== a && h.length === 64);
}

console.log("\nstale names:");
{
  const r = U.newRecord("Kiku", "x", T0);
  check("a name used recently is kept", !U.isStale(r, T0 + 89 * 86400000));
  check("a name unused for 90 days is freed", U.isStale(r, T0 + 91 * 86400000));
}

console.log("\nblocking:");
{
  const r = U.newRecord("Kiku", "x", T0);
  check("block adds once", U.block(r, "Pest") && U.block(r, "pest") && r.blocked.length === 1 && r.blocked[0] === "pest");
  check("cannot block yourself", U.block(r, "kiku") === false);
  U.unblock(r, "PEST");
  check("unblock", r.blocked.length === 0);
  for (let i = 0; i < U.MAX_BLOCKED; i++) U.block(r, "user" + i);
  check("the list is capped", U.block(r, "onetoomany") === false && r.blocked.length === U.MAX_BLOCKED);
}

console.log("\npokes:");
{
  const a = U.newRecord("Alice", "x", T0), b = U.newRecord("Bobby", "x", T0), c = U.newRecord("Carol", "x", T0);
  check("a first poke is allowed", U.pokeAllowed(a, b, T0).ok);
  check("not yourself", U.pokeAllowed(a, a, T0).reason === "self");
  U.notePoke(a, b, T0);
  check("the same person again straight away is refused", U.pokeAllowed(a, b, T0 + 1000).reason === "pair-gap");
  check("a different person is fine", U.pokeAllowed(a, c, T0 + 1000).ok);
  check("the same person after the gap is fine", U.pokeAllowed(a, b, T0 + U.POKE_PAIR_GAP_MS + 1).ok);

  // a sender is capped per hour
  const s = U.newRecord("Spammer", "x", T0);
  let allowed = 0;
  for (let i = 0; i < 30; i++) {
    const t = U.newRecord("Target" + i, "x", T0);
    if (U.pokeAllowed(s, t, T0 + i).ok) { U.notePoke(s, t, T0 + i); allowed++; }
  }
  check("one sender gets " + U.POKES_OUT_PER_HOUR + " pokes an hour", allowed === U.POKES_OUT_PER_HOUR, allowed);
  check("and can send again an hour later", U.pokeAllowed(s, U.newRecord("Fresh1", "x", T0), T0 + 3600001 + 30).ok);

  // a target is capped per hour, from many senders
  const victim = U.newRecord("Victim", "x", T0);
  let got = 0;
  for (let i = 0; i < 40; i++) {
    const f = U.newRecord("Sender" + i, "x", T0);
    if (U.pokeAllowed(f, victim, T0 + i).ok) { U.notePoke(f, victim, T0 + i); got++; }
  }
  check("one person can only be poked " + U.POKES_IN_PER_HOUR + " times an hour", got === U.POKES_IN_PER_HOUR, got);

  // muted / blocked / no subscription
  const sub = { endpoint: "https://fcm.googleapis.com/x", keys: {} };
  const t = U.newRecord("Target", "x", T0); t.sub = sub;
  const f = U.newRecord("Friend", "x", T0);
  check("delivers to someone subscribed", U.canDeliver(f, t));
  t.muted = true;
  check("muted: not delivered", !U.canDeliver(f, t));
  t.muted = false; t.blocked.push(f.key);
  check("blocked: not delivered", !U.canDeliver(f, t));
  t.blocked = []; t.sub = null;
  check("no subscription: not delivered", !U.canDeliver(f, t));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
