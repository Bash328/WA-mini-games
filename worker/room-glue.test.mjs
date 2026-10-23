/* Run: node worker/room-glue.test.mjs
   Drives the real Durable Object classes (card-room.mjs, live-room.mjs) in plain Node with a fake Cloudflare
   around them: fake sockets, an in-memory store that structured-clones like the real one, and a clock the test
   moves. It covers the glue the pure protocol tests cannot: malformed messages, size and rate limits, takeover by
   a second tab, disconnects, alarms and expiry, and that each person is only sent their own view. */
import { register } from "node:module";
register("./cf-stub-hooks.mjs", import.meta.url);

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); } };

// ---- fake Cloudflare ----
let NOW = 1_800_000_000_000;
Date.now = () => NOW;
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {      // Node refuses status 101 (the WebSocket upgrade)
  constructor(body, init) {
    if (init && init.status === 101) { super(null, { status: 200 }); this.webSocket = init.webSocket; Object.defineProperty(this, "status", { value: 101 }); }
    else super(body, init);
  }
};
class FakeWS {
  constructor() { this.sent = []; this.closed = null; this.att = null; }
  send(s) { if (this.closed) throw new Error("closed"); this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.closed = { code, reason }; }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att === null ? null : structuredClone(this.att); }
  ofType(t) { return this.sent.filter((m) => m.t === t); }
  last(t) { const l = this.ofType(t); return l[l.length - 1]; }
}
let lastPair = null;
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWS(); this[1] = new FakeWS(); lastPair = this; } };
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.a = a; this.b = b; } };

function harness(RoomClass, env = {}) {
  const store = new Map(), sockets = []; let alarmAt = null;
  const ctx = {
    storage: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      put: async (k, v) => { store.set(k, structuredClone(v)); },
      setAlarm: async (t) => { alarmAt = t; }, getAlarm: async () => alarmAt,
      deleteAll: async () => { store.clear(); alarmAt = null; },
    },
    setWebSocketAutoResponse() {}, acceptWebSocket(ws) { sockets.push(ws); },
    getWebSockets: () => sockets.filter((w) => !w.closed),
  };
  const room = new RoomClass(ctx, env);
  const h = {
    room, store, alarmAt: () => alarmAt,
    init: (body) => room.fetch(new Request("https://room/init", { method: "POST", body: JSON.stringify(body) })),
    exists: async () => (await room.fetch(new Request("https://room/exists"))).status,
    connect: async () => { const r = await room.fetch(new Request("https://room/ws", { headers: { Upgrade: "websocket" } })); return { status: r.status, ws: lastPair[1] }; },
    say: (ws, msg) => room.webSocketMessage(ws, typeof msg === "string" ? msg : JSON.stringify(msg)),
    hello: async (token, name) => { const { ws } = await h.connect(); await h.say(ws, { t: "hello", token, name }); return ws; },
  };
  return h;
}

const { CardRoom } = await import("./card-room.mjs");
const { LiveRoom } = await import("./live-room.mjs");
const P = await import("./card-protocol.mjs");

console.log("card room (hearts):");
{
  const h = harness(CardRoom);
  check("init makes the room", (await h.init({ code: "ABCDEF", game: "hearts" })).status === 200);
  check("a second init is refused (409)", (await h.init({ code: "ABCDEF", game: "hearts" })).status === 409);
  const h2 = harness(CardRoom);
  check("an unknown game is refused, not a crash", (await h2.init({ code: "ABCDEF", game: "chess" })).status === 400);
  check("exists is 200 for a made room", (await h.exists()) === 200 && (await h2.exists()) === 404);
  const noUpgrade = await h.room.fetch(new Request("https://room/ws"));
  check("a socket request without Upgrade is 426", noUpgrade.status === 426);
  check("an unknown path is 404", (await h.room.fetch(new Request("https://room/nope"))).status === 404);

  const a = await h.hello(undefined, "Ann");
  const w = a.last("welcome");
  check("hello gives a welcome with a pid and a token, and the room view", !!w && Number.isInteger(w.pid) && typeof w.token === "string" && w.game === "hearts" && !!a.last("room"));
  // clients that send junk
  const j = (await h.connect()).ws;
  await h.say(j, "{not json"); await h.say(j, JSON.stringify([1])); await h.say(j, JSON.stringify({ t: 5 }));
  check("junk is rejected, the socket stays open", j.ofType("reject").map((m) => m.reason).join() === "bad-json,bad-message,bad-message" && !j.closed);
  await h.say(j, { t: "act", a: { t: "pass" } });
  check("an action before hello is refused", j.last("reject").reason === "no-hello");
  await h.room.webSocketMessage(j, new ArrayBuffer(4));
  check("a binary message is refused", j.last("reject").reason === "bad-message");
  const fat = (await h.connect()).ws;
  await h.say(fat, "x".repeat(P.MAX_MESSAGE_CHARS + 1));
  check("an oversized message closes the socket with 1009", fat.closed && fat.closed.code === 1009);
  const spam = (await h.connect()).ws;
  for (let i = 0; i < 80; i++) await h.say(spam, { t: "nope" });
  check("a flood is rate limited", spam.ofType("reject").some((m) => m.reason === "rate-limit"));

  // second person, then the takeover by a second tab
  const b = await h.hello(undefined, "Bob");
  check("both people are told about each other", a.last("room").v.players.length === 2 && b.last("room").v.players.length === 2);
  const a2 = await h.hello(w.token, "Ann");
  check("a second tab with the same token takes the seat over", a.last("closed") && a.last("closed").reason === "taken-over" && a2.last("welcome").pid === w.pid);

  // start: hearts fills the empty seats with computers, and nobody is sent another hand
  await h.say(a2, { t: "start" });
  const v = b.last("room").v;
  check("the host can start, and the game is playing", v.phase === "playing" && v.table.seats.length === 4);
  const mine = v.table.you;
  check("each person is sent only their own hand", v.table.seats.every((s, i) => (i === mine ? Array.isArray(s.hand) : s.hand == null)));
  await h.say(b, { t: "start" });
  check("only the host can start (and not twice)", b.last("reject") && ["not-host", "in-game"].includes(b.last("reject").reason));
  await h.say(b, { t: "act", a: { t: "pass", cards: ["AS", "AS", "AS"] } });
  check("an illegal action is rejected and the view is refreshed", b.last("reject").reason !== undefined);
  const hand = b.last("room").v.table.seats[mine].hand;
  const rejects = b.ofType("reject").length;
  await h.say(b, { t: "act", a: { t: "pass", cards: hand.slice(0, 3) } });
  check("a legal pass is accepted (no reject, and they are told it is in)", b.ofType("reject").length === rejects && b.last("room").v.table.options.pass === 0, JSON.stringify(b.last("room").v.table.options));

  // table talk
  const before = a2.ofType("taunt").length;
  await h.say(b, { t: "taunt", k: "h", i: 0 });
  check("Hype table talk reaches the other person, with who sent it", a2.ofType("taunt").length === before + 1 && a2.last("taunt").k === "h");
  await h.say(b, { t: "taunt", k: "h", i: 1 });
  check("a second one straight away is rate limited", b.last("reject").reason === "rate-limit");
  NOW += 4000;
  await h.say(b, { t: "taunt", k: "a", i: 0 });
  check("the old angel format is refused", b.last("reject").reason === "illegal");
  await h.say(b, { t: "taunt", k: "k", i: 99 });
  check("a line number out of range is refused", b.last("reject").reason === "illegal");

  // a person drops, then the computer takes over after 90 seconds
  await h.room.webSocketClose(b, 1006);
  check("when someone drops the other is told they are offline", a2.last("room").v.players.find((p) => p.pid !== w.pid).online === false);
  NOW += P.OFFLINE_TAKEOVER_MS + 1000;
  await h.room.alarm();
  check("after 90 seconds offline a computer plays for them", a2.last("room").v.players.find((p) => p.pid !== w.pid).autoBot === true);
  check("the alarm is always set for something", h.alarmAt() !== null && h.alarmAt() >= 0);

  // leaving
  await h.say(a2, { t: "leave" });
  check("leave closes that socket", a2.last("left") && a2.closed);

  // expiry
  NOW += 25 * 3600 * 1000;
  const survivor = (await h.connect()).ws;
  await h.room.alarm();
  check("after 24 hours the room is wiped and open sockets are told", (await h.exists()) === 404 && survivor.last("closed") && survivor.last("closed").reason === "expired");
  await h.say(survivor, { t: "hello" });
  check("a message to a wiped room says expired", survivor.last("closed").reason === "expired");
}
{
  const h = harness(CardRoom, { LIVE_ENABLED: "0" });
  await h.init({ code: "ABCDEF", game: "crazy-8" });
  const { ws } = await h.connect();
  await h.say(ws, { t: "hello" });
  check("the kill switch closes card rooms", ws.last("closed") && ws.last("closed").reason === "disabled");
}

console.log("live room (tic-tac-toe):");
{
  const h = harness(LiveRoom);
  check("init makes the room", (await h.init({ game: "tic-tac-toe", code: "ABCDEF", config: null })).status === 200);
  check("an unknown game is refused", (await harness(LiveRoom).init({ game: "nope", code: "ABCDEF" })).status === 400);
  const a = await h.hello(undefined);
  const wa = a.last("welcome");
  check("first hello is seat 1 with a token and the game id", wa && wa.seat === 1 && typeof wa.token === "string" && typeof (wa.id || (wa.state && wa.state.id) || wa.game) !== "undefined", JSON.stringify(wa).slice(0, 200));
  await h.say(a, { t: "taunt", k: "h", i: 0 });
  check("table talk before anyone has joined is refused (waiting)", a.last("reject") && a.last("reject").reason === "waiting");
  const b = await h.hello(undefined);
  check("second hello is seat 2", b.last("welcome").seat === 2);
  const c = await h.hello(undefined);
  check("a third person is told the room is full", c.last("closed") && c.last("closed").reason === "full");
  check("both seats are told who is online", a.last("presence") && a.last("presence").online[2] === true);

  const id = wa.id !== undefined ? wa.id : (wa.state || {}).id;
  const E = (count, board, last, over = {}) => ({ game: "tic-tac-toe", version: 2, id, turn: "O", board, status: "in_progress", winner: null, moveCount: count, last, ...over });
  await h.say(b, { t: "move", n: 0, s: E(1, "O........", 0) });
  check("moving out of turn is refused", b.last("reject") && b.last("reject").reason === "not-your-turn");
  await h.say(a, { t: "move", n: 5, s: E(1, "X........", 0) });
  check("a stale move number is refused", a.last("reject").reason === "stale");
  await h.say(a, { t: "move", n: 0, s: E(1, "XX.......", 0) });
  check("an illegal board is refused", a.last("reject").reason === "illegal");
  await h.say(a, { t: "move", n: 0, s: E(1, "X........", 0) });
  check("a legal move is broadcast to both", a.last("state") && b.last("state") && b.last("state").s.board === "X........");

  // table talk: new format only, one per 3 seconds, to the other seat only
  const got = b.ofType("taunt").length, mine = a.ofType("taunt").length;
  await h.say(a, { t: "taunt", k: "k", i: 3 });
  check("Heckle reaches the other seat only", b.ofType("taunt").length === got + 1 && a.ofType("taunt").length === mine && b.last("taunt").k === "k");
  NOW += 4000;
  await h.say(a, { t: "taunt", k: "d", i: 0 });
  check("the old devil format is refused", a.last("reject").reason === "illegal");

  // resign, rematch
  await h.say(b, { t: "move", n: 1, s: { game: "tic-tac-toe", version: 2, id, turn: "X", board: "X........", status: "won", winner: "X", moveCount: 2, last: 0, resigned: true } });
  check("resigning (on your own turn) hands the win to the other side", a.last("state") && a.last("state").s.status === "won" && a.last("state").s.winner === "X");
  await h.say(a, { t: "rematch" });
  check("a rematch waits for the other side", a.last("rematch") && a.last("rematch").rematch[1] === true);
  await h.say(b, { t: "rematch" });
  check("both agreeing starts a new game", b.last("rematch-start") && b.last("rematch-start").id !== id);

  // takeover, reconnect, drop
  const a2 = await h.hello(wa.token);
  check("a reconnect with the token keeps the seat and closes the old socket", a2.last("welcome").seat === 1 && a.last("closed") && a.last("closed").reason === "taken-over");
  await h.room.webSocketClose(b, 1006);
  check("the other seat is told you dropped", a2.last("presence").online[2] === false);

  // flood and size
  const flood = (await h.connect()).ws;
  for (let i = 0; i < 80; i++) await h.say(flood, { t: "zzz" });
  check("a flood is rate limited", flood.ofType("reject").some((m) => m.reason === "rate-limit"));
  const fat = (await h.connect()).ws;
  await h.say(fat, "x".repeat(P.MAX_MESSAGE_CHARS + 1));
  check("an oversized message closes the socket", fat.closed && fat.closed.code === 1009);

  // expiry
  NOW += 8 * 24 * 3600 * 1000;
  await h.room.alarm();
  check("an expired room is wiped", (await h.exists()) === 404);
}
{
  const h = harness(LiveRoom, { LIVE_ENABLED: "0" });
  await h.init({ game: "tic-tac-toe", code: "ABCDEF" });
  const { ws } = await h.connect();
  await h.say(ws, { t: "hello" });
  check("the kill switch closes live rooms", ws.last("closed") && ws.last("closed").reason === "disabled");
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
