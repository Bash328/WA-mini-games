/* Integration test for live rooms against a running Worker.
   Needs Node 22+ (global WebSocket); no dependencies.

     npx wrangler dev --persist-to ../.wrangler-state      # in one terminal
     node worker/live.integration.mjs                      # in another

   BASE defaults to http://localhost:8787. Pass BASE=https://... to run it
   against a deployed Worker (it creates and abandons a few rooms; they
   expire on their own). */

const BASE = process.env.BASE || "http://localhost:8787";
const ORIGIN = new URL(BASE).origin;
const WS_BASE = BASE.replace(/^http/, "ws");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}

async function api(path, init = {}, origin = ORIGIN) {
  const headers = { ...(init.headers || {}) };
  if (origin) headers.Origin = origin;
  return fetch(BASE + path, { ...init, headers });
}

function open(code, origin = ORIGIN) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/api/live/ws?room=${code}`, { headers: origin ? { Origin: origin } : {} });
    const c = { ws, inbox: [], waiters: [], closed: false };
    ws.addEventListener("message", (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      const i = c.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) c.waiters.splice(i, 1)[0].resolve(m); else c.inbox.push(m);
    });
    ws.addEventListener("close", () => { c.closed = true; });
    ws.addEventListener("open", () => resolve(c));
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
}
function next(c, pred, ms = 3000) {
  const i = c.inbox.findIndex(pred);
  if (i >= 0) return Promise.resolve(c.inbox.splice(i, 1)[0]);
  return new Promise((resolve, reject) => {
    const w = { pred, resolve };
    c.waiters.push(w);
    setTimeout(() => { const j = c.waiters.indexOf(w); if (j >= 0) { c.waiters.splice(j, 1); reject(new Error("timeout")); } }, ms);
  });
}
const ofType = (t) => (m) => m.t === t;
const send = (c, m) => c.ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const E = (id, count, board, last, over = {}) => ({
  game: "tic-tac-toe", version: 2, id, turn: "O", board, status: "in_progress", winner: null, moveCount: count, last, ...over,
});

console.log("status + create:");
const st = await (await api("/api/live/status")).json();
check("status enabled, lists tic-tac-toe", st.enabled === true && st.games.includes("tic-tac-toe"), JSON.stringify(st));
const noOrigin = await api("/api/live/create", { method: "POST", body: JSON.stringify({ game: "tic-tac-toe" }) }, null);
check("create without Origin is refused", noOrigin.status === 403, noOrigin.status);
const evil = await api("/api/live/create", { method: "POST", body: JSON.stringify({ game: "tic-tac-toe" }) }, "https://evil.example");
check("create from another origin is refused", evil.status === 403, evil.status);
const unknown = await api("/api/live/create", { method: "POST", body: JSON.stringify({ game: "chess" }) });
check("unknown / not-live game is refused", unknown.status === 400, unknown.status);
const made = await api("/api/live/create", { method: "POST", body: JSON.stringify({ game: "tic-tac-toe" }) });
const { room: code } = await made.json();
check("room code is 6 safe characters", /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);

// Browsers send no Origin on a same-origin GET, so this must work without one.
const ex1 = await (await api("/api/live/exists?room=" + code, {}, null)).json();
const ex2 = await (await api("/api/live/exists?room=AAAAAA", {}, null)).json();
check("exists reports a live room and a missing one", ex1.exists === true && ex2.exists === false, JSON.stringify([ex1, ex2]));

console.log("\njoining:");
let noRoom = false;
try { await open("AAAAAA"); } catch (e) { noRoom = true; }
check("unknown room cannot be joined", noRoom);
const A = await open(code);
send(A, { t: "hello" });
const wa = await next(A, ofType("welcome"));
check("first client is seat 1 / X", wa.seat === 1 && wa.order["1"] === "X", JSON.stringify(wa));
check("welcome carries a seat token and no state", typeof wa.token === "string" && wa.token.length >= 16 && wa.state === null);
check("only one seat taken so far", wa.seated["1"] === true && wa.seated["2"] === false);
const B = await open(code);
send(B, { t: "hello" });
const wb = await next(B, ofType("welcome"));
check("second client is seat 2 / O", wb.seat === 2 && wb.order["2"] === "O");
const pa = await next(A, (m) => m.t === "presence" && m.seated["2"] === true);
check("seat 1 is told the opponent arrived", pa.online["2"] === true);
const C = await open(code);
send(C, { t: "hello" });
const wc = await next(C, ofType("closed"));
check("third client is refused", wc.reason === "full");

console.log("\nplaying:");
const id = wa.id;
send(B, { t: "move", n: 0, s: E(id, 1, "O........", 0) });
check("O cannot open", (await next(B, ofType("reject"))).reason === "not-your-turn");
send(A, { t: "move", n: 0, s: E(id, 1, "X........", 0) });
const sa = await next(A, ofType("state")), sb = await next(B, ofType("state"));
check("both seats see the move", sa.s.board === "X........" && sb.s.board === "X........" && sb.s.turn === "O" && sa.by === 1);
send(A, { t: "move", n: 1, s: E(id, 2, "XX.......", 1) });
check("X cannot move twice", (await next(A, ofType("reject"))).reason === "not-your-turn");
send(B, { t: "move", n: 0, s: E(id, 1, "XO.......", 1) });
check("stale move count is rejected", (await next(B, ofType("reject"))).reason === "stale");
send(B, { t: "move", n: 1, s: E(id, 2, "O........", 0) });
check("overwriting a cell is illegal", (await next(B, ofType("reject"))).reason === "illegal");

const seq = [[B, "XO.......", 1], [A, "XOX......", 2], [B, "XOXO.....", 3], [A, "XOXOX....", 4], [B, "XOXOXO...", 5]];
let count = 1;
for (const [who, board, last] of seq) {
  count++;
  send(who, { t: "move", n: count - 1, s: E(id, count, board, last) });
  await next(A, ofType("state")); await next(B, ofType("state"));
}
send(A, { t: "move", n: 6, s: E(id, 7, "XOXOXOX..", 6, { status: "won", winner: "X" }) });
const fin = await next(B, ofType("state"));
await next(A, ofType("state"));
check("X wins, server stores status", fin.s.status === "won" && fin.s.winner === "X" && fin.s.moveCount === 7);
send(B, { t: "move", n: 7, s: E(id, 8, "XOXOXOXO.", 7) });
check("no moves after the game", (await next(B, ofType("reject"))).reason === "over");

console.log("\nreconnect:");
A.ws.close();
const pb = await next(B, (m) => m.t === "presence" && m.online["1"] === false);
check("opponent is told the other side left", pb.online["1"] === false);
const A2 = await open(code);
send(A2, { t: "hello", token: wa.token });
const wa2 = await next(A2, ofType("welcome"));
check("same token returns to seat 1", wa2.seat === 1 && wa2.token === wa.token);
check("full state is replayed", wa2.state && wa2.state.status === "won" && wa2.state.board === "XOXOXOX..");
const stranger = await open(code);
send(stranger, { t: "hello", token: "0000000000000000" });
check("a guessed token gets nothing", (await next(stranger, ofType("closed"))).reason === "full");

console.log("\nrematch:");
send(B, { t: "rematch" });
const r1 = await next(A2, ofType("rematch"));
check("first request is relayed", r1.rematch["2"] === true);
send(A2, { t: "rematch" });
const rs = await next(B, ofType("rematch-start"));
check("both asked: seats swap players", rs.order["1"] === "O" && rs.order["2"] === "X" && rs.state === null && rs.id !== id);
send(A2, { t: "move", n: 0, s: E(rs.id, 1, "O........", 0) });
check("seat 1 (now O) cannot open", (await next(A2, ofType("reject"))).reason === "not-your-turn");
send(B, { t: "move", n: 0, s: E(rs.id, 1, "X........", 0) });
check("seat 2 (now X) opens", (await next(B, ofType("state"))).s.board === "X........");

console.log("\nabuse:");
send(B, { t: "ping-not-valid" });
check("unknown message type is rejected", (await next(B, ofType("reject"))).reason === "unknown-type");
B.ws.send("{not json");
check("malformed JSON is rejected", (await next(B, ofType("reject"))).reason === "bad-json");
const D = await open(code);
D.ws.send("x".repeat(3000));
for (let i = 0; i < 40 && !D.closed; i++) await sleep(100);   // allow for network latency
check("oversized message closes the socket", D.closed === true);
let bad = false;
try { await open(code, "https://evil.example"); } catch (e) { bad = true; }
check("WebSocket from another origin is refused", bad);
const burst = await open((await (await api("/api/live/create", { method: "POST", body: JSON.stringify({ game: "tic-tac-toe" }) })).json()).room);
let limited = false;
for (let i = 0; i < 60; i++) burst.ws.send(JSON.stringify({ t: "wat" }));
for (let i = 0; i < 40 && !limited; i++) { await sleep(100); limited = burst.inbox.some((m) => m.reason === "rate-limit"); }
check("a flood is rate limited", limited);

console.log("\ncreate-by-socket (one round trip):");
function openNew(game) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/api/live/new?game=${game}`, { headers: { Origin: ORIGIN } });
    const c = { ws, inbox: [], waiters: [], closed: false };
    ws.addEventListener("message", (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      const i = c.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) c.waiters.splice(i, 1)[0].resolve(m); else c.inbox.push(m);
    });
    ws.addEventListener("close", () => { c.closed = true; });
    ws.addEventListener("open", () => resolve(c));
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
}
const N1 = await openNew("tic-tac-toe");
send(N1, { t: "hello" });
const wn = await next(N1, ofType("welcome"));
check("a socket to /new makes a room and welcomes the creator", wn.seat === 1 && /^[A-HJ-NP-Z2-9]{6}$/.test(wn.code), JSON.stringify(wn).slice(0, 120));
const N2 = await open(wn.code);
send(N2, { t: "hello" });
check("the code from welcome can be joined", (await next(N2, ofType("welcome"))).seat === 2);
let refused = false;
try { await openNew("chess"); } catch (e) { refused = true; }
check("/new refuses a game without live mode", refused);

console.log("\nkeep-alive:");
const pong = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 2000);
  B.ws.addEventListener("message", (e) => { if (e.data === "pong") { clearTimeout(t); resolve(true); } });
  B.ws.send("ping");
});
check('"ping" is answered with "pong"', pong);

for (const c of [A2, B, C, D, stranger, burst, N1, N2]) { try { c.ws.close(); } catch (e) { /* ignore */ } }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
