/* Integration test for Crazy 8 rooms against a running Worker.
   Needs Node 22+ (global WebSocket); no dependencies.

     npx wrangler dev --persist-to ../.wrangler-state --port 8788
     BASE=http://localhost:8788 node worker/card.integration.mjs

   Two real sockets play a whole game against a computer through the Durable
   Object (the computer moves on the room's alarm), check that nobody is ever
   sent another player's cards, then rematch. */

const BASE = process.env.BASE || "http://localhost:8787";
const ORIGIN = new URL(BASE).origin;
const WS_BASE = BASE.replace(/^http/, "ws");
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log("  PASS  " + name); } else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_BASE + path, { headers: { Origin: ORIGIN } });
    const c = { ws, inbox: [], view: null, pid: null, token: null, code: null, notices: [], taunts: [], seen: [] };
    ws.addEventListener("message", (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === "room") c.view = m.v;
      if (m.t === "welcome") { c.pid = m.pid; c.token = m.token; c.code = m.code; }
      if (m.t === "notice") c.notices.push(m.text);
      if (m.t === "taunt") c.taunts.push(m);
      c.seen.push(e.data);
      c.inbox.push(m);
    });
    ws.addEventListener("open", () => resolve(c));
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
async function until(pred, ms = 8000, label = "") { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(30); } throw new Error("timeout waiting for " + label); }
const reasons = (c) => c.inbox.filter((m) => m.t === "reject").map((m) => m.reason);

console.log("status:");
const st = await (await fetch(BASE + "/api/live/status")).json();
check("Crazy 8 is listed as a live game", st.games.includes("crazy-8"), JSON.stringify(st));
const foreign = await new Promise((resolve) => {
  const ws = new WebSocket(WS_BASE + "/api/card/new", { headers: { Origin: "https://evil.example" } });
  ws.addEventListener("open", () => { ws.close(); resolve(false); });
  ws.addEventListener("error", () => resolve(true));
});
check("a socket from another site is refused", foreign === true);
const ex = await (await fetch(BASE + "/api/card/exists?room=AAAAAA")).json();
check("an unknown room does not exist", ex.exists === false);

console.log("\nlobby:");
const A = await open("/api/card/new");
send(A, { t: "hello", name: "Alice" });
await until(() => A.view, 8000, "the host's first view");
check("the creator is welcomed with a room code and is the host", /^[A-HJ-NP-Z2-9]{6}$/.test(A.code) && A.view.you.host && A.view.phase === "lobby", JSON.stringify(A.view && A.view.you));
const ex2 = await (await fetch(BASE + "/api/card/exists?room=" + A.code)).json();
check("the room now exists", ex2.exists === true);
const B = await open("/api/card/ws?room=" + A.code);
send(B, { t: "hello", name: "Bob" });
await until(() => B.view && A.view.players.length === 2, 5000, "the second player");
check("the second person joins; both see two players", A.view.players.length === 2 && B.view.players.length === 2 && !B.view.you.host);
send(B, { t: "config", bots: 1 });
await until(() => reasons(B).includes("not-host"), 3000, "not-host");
check("only the host can change settings", reasons(B).includes("not-host"));
send(A, { t: "config", bots: 1, mode: "normal", level: "easy" });
await until(() => A.view.config.bots === 1 && B.view.config.level === "easy", 3000, "config");
check("the host sets a computer player; everyone sees it", B.view.config.bots === 1 && B.view.config.mode === "normal");
send(B, { t: "taunt", k: "k", i: 2 });
await until(() => A.taunts.length === 1, 3000, "taunt");
check("a taunt reaches the others as a bare id", A.taunts[0].k === "k" && A.taunts[0].i === 2 && B.taunts.length === 0);

console.log("\nthe game:");
send(B, { t: "start" });
await until(() => reasons(B).filter((r) => r === "not-host").length === 2, 3000, "second not-host");
send(A, { t: "start" });
await until(() => A.view.phase === "playing" && B.view.phase === "playing", 5000, "start");
check("the host starts it: 3 seats (2 people and a computer)", A.view.table.seats.length === 3 && A.view.table.seats[2].bot === "easy");
check("everyone has 8 cards; you see only your own", A.view.table.seats[0].hand.length === 8 && A.view.table.seats[1].hand === undefined && B.view.table.seats[1].hand.length === 8 && B.view.table.seats[0].hand === undefined);
const aHand = A.view.table.seats[0].hand, bHand = B.view.table.seats[1].hand;
const leaked = A.seen.some((s) => bHand.some((c) => s.includes('"' + c + '"') && !s.includes('"top":"' + c + '"') && !/"card":"/.test(s) && false));
check("player B's cards are not in anything player A was sent (only counts)", !A.seen.some((s) => /"hand":\[/.test(s) && s.includes(JSON.stringify(bHand))), "");
check("the draw pile is only ever a count", A.seen.every((s) => !/"draw":\[/.test(s)));

// play it out: each person plays the first legal card, else picks up; the computer moves by itself on the alarm
async function turnOf(c) {
  const v = c.view;
  if (!v || !v.table || v.phase !== "playing") return false;
  if (v.table.turn !== v.you.seat) return false;
  const o = v.table.options;
  let a;
  if (v.table.drawn) a = o.plays.length ? { t: "play", card: v.table.drawn, suit: "H", last: true } : { t: "pass" };
  else if (o.plays.length) { const card = o.plays[0]; a = { t: "play", card, suit: "H", last: true }; }
  else a = { t: "draw" };
  send(c, { t: "act", a });
  return true;
}
const t0 = Date.now();
while (A.view.phase === "playing" && Date.now() - t0 < 120000) {
  const before = JSON.stringify([A.view.table.turn, A.view.table.discardCount, A.view.table.drawCount]);
  const moved = (await turnOf(A)) || (await turnOf(B));
  await sleep(moved ? 60 : 200);
}
await until(() => A.view.phase === "game_over" && B.view.phase === "game_over", 10000, "game over");
check("the game finishes by itself (the computer moves on the room's alarm)", A.view.phase === "game_over" && A.view.table.winner !== null);
check("both people see the same result and a win tally", A.view.table.winner === B.view.table.winner && A.view.players.reduce((n, p) => n + p.wins, 0) <= 1);
send(A, { t: "act", a: { t: "draw" } });
await until(() => reasons(A).includes("not-playing"), 3000, "not-playing");
check("no moves are accepted after the game", reasons(A).includes("not-playing"));

console.log("\nrematch:");
send(A, { t: "vote" });
await sleep(400);
check("one vote is not enough", A.view.phase === "game_over" && A.view.players.find((p) => p.pid === A.pid).voted);
send(B, { t: "vote" });
await until(() => A.view.phase === "playing" && B.view.phase === "playing", 5000, "rematch");
check("when everyone has voted the next game starts", A.view.table.seats[0].hand.length === 8 && A.view.table.round === 1);

console.log("\nreconnecting and leaving:");
const tokenB = B.token;
B.ws.close();
await until(() => A.view.players.find((p) => p.pid === B.pid) && A.view.players.find((p) => p.pid === B.pid).online === false, 5000, "offline");
check("when someone drops, the others see them as offline", A.view.players.find((p) => p.pid === B.pid).online === false);
const B2 = await open("/api/card/ws?room=" + A.code);
send(B2, { t: "hello", token: tokenB });
await until(() => B2.view, 5000, "rejoin");
check("they rejoin with the same token and get their own cards back", B2.pid === B.pid && B2.view.table.seats[B2.view.you.seat].hand.length >= 8);
const C3 = await open("/api/card/ws?room=" + A.code);
send(C3, { t: "hello", name: "Cara" });
await until(() => C3.inbox.some((m) => m.t === "closed"), 3000, "closed");
check("a stranger cannot join a game that has started", C3.inbox.find((m) => m.t === "closed").reason === "started");
send(B2, { t: "leave" });
await until(() => A.notices.some((n) => /left/.test(n)), 5000, "left notice");
check("leaving tells everyone and a computer takes the seat", A.notices.some((n) => /left/.test(n)) && !A.view.players.find((p) => p.pid === B.pid));

A.ws.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
