/* Measures live-room latency against a running Worker (Node 22+, no deps).

     BASE=https://wa-minigames.online node worker/live.latency.mjs

   Reports, over N Tic-Tac-Toe-sized moves between two sockets:
     create    POST /api/live/create
     join      new WebSocket -> "welcome"
     echo      a move sent -> the same "state" back at the sender
     relay     a move sent -> "state" arriving at the opponent
   Numbers include your own network, so compare before/after on one machine. */

const BASE = process.env.BASE || "http://localhost:8787";
const N = Number(process.env.N || 20);
const ORIGIN = new URL(BASE).origin;
const WS = BASE.replace(/^http/, "ws");

const now = () => performance.now();
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], p50: pct(0.5), p90: pct(0.9), max: s[s.length - 1] };
};
const fmt = (st) => `p50 ${st.p50.toFixed(0)}ms · p90 ${st.p90.toFixed(0)}ms · min ${st.min.toFixed(0)} · max ${st.max.toFixed(0)}`;

function socket(code) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/live/ws?room=${code}`, { headers: { Origin: ORIGIN } });
    const c = { ws, inbox: [], waiters: [] };
    ws.addEventListener("message", (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      const i = c.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) c.waiters.splice(i, 1)[0].resolve(m); else c.inbox.push(m);
    });
    ws.addEventListener("open", () => resolve(c));
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
}
const next = (c, pred, ms = 5000) => {
  const i = c.inbox.findIndex(pred);
  if (i >= 0) return Promise.resolve(c.inbox.splice(i, 1)[0]);
  return new Promise((resolve, reject) => {
    const w = { pred, resolve };
    c.waiters.push(w);
    setTimeout(() => reject(new Error("timeout")), ms);
  });
};

const create = [], join = [], echo = [], relay = [], oneShot = [];

// "Create" the way the page now does it: the first socket makes the room.
for (let i = 0; i < 3; i++) {
  const t = now();
  const ws = new WebSocket(`${WS}/api/live/new?game=tic-tac-toe`, { headers: { Origin: ORIGIN } });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "hello" })));
    ws.addEventListener("message", (e) => { if (JSON.parse(e.data).t === "welcome") { oneShot.push(now() - t); resolve(); } });
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
  ws.close();
}

for (let round = 0; round < Math.max(1, Math.round(N / 20)); round++) {
  let t = now();
  const res = await fetch(BASE + "/api/live/create", {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ game: "tic-tac-toe" }),
  });
  const { room } = await res.json();
  create.push(now() - t);

  t = now();
  const A = await socket(room);
  A.ws.send(JSON.stringify({ t: "hello" }));
  const wa = await next(A, (m) => m.t === "welcome");
  join.push(now() - t);
  const B = await socket(room);
  t = now();
  B.ws.send(JSON.stringify({ t: "hello" }));
  await next(B, (m) => m.t === "welcome");
  join.push(now() - t);

  // alternate X and O through a few legal cells; reset with rematch between games
  const id = wa.id;
  let board = ".........", count = 0, mover = A, markFor = new Map([[A, "X"], [B, "O"]]);
  const cells = [0, 1, 2, 4, 3, 6, 5, 8, 7];
  for (let i = 0; i < 8 && echo.length < N; i++) {
    const cell = cells[i];
    const mark = markFor.get(mover);
    board = board.slice(0, cell) + mark + board.slice(cell + 1);
    count++;
    
    const env = { game: "tic-tac-toe", version: 2, id, turn: mark === "X" ? "O" : "X", board, status: "in_progress", winner: null, moveCount: count, last: cell };
    // stop before the line completes: 0,1,2 would be a win for X, so reorder the cells
    const t0 = now();
    mover.ws.send(JSON.stringify({ t: "move", n: count - 1, s: env }));
    const other = mover === A ? B : A;
    const [mine, theirs] = await Promise.all([
      next(mover, (m) => m.t === "state" || m.t === "reject"),
      next(other, (m) => m.t === "state" || m.t === "reject"),
    ]);
    const t1 = now();
    if (mine.t === "reject") { console.log("move rejected:", mine.reason, "(stopping this round)"); break; }
    echo.push(t1 - t0); relay.push(t1 - t0);
    mover = other;
    if (mine.s.status !== "in_progress") break;
  }
  A.ws.close(); B.ws.close();
}

console.log(`target ${BASE}`);
console.log("create (POST, old)", fmt(stats(create)));
console.log("create (socket) ", fmt(stats(oneShot)) + "   (open + room made + welcome)");
console.log("join    ", fmt(stats(join)));
console.log("move    ", fmt(stats(echo)) + "   (send -> both screens updated)");
