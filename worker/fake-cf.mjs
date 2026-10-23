/* A fake Cloudflare around the real Durable Object classes, for plain Node: fake sockets, an in-memory store that
   structured-clones like the real one, and a clock the caller moves. Used by room-glue.test.mjs and by the browser tests that
   connect real pages to a real room (tests/regression.mjs). Importing it registers the loader hook for "cloudflare:workers". */
import { register } from "node:module";
register("./cf-stub-hooks.mjs", import.meta.url);

// ---- fake Cloudflare ----
export const clock = { now: 1_800_000_000_000 };
Date.now = () => clock.now;
const RealResponse = globalThis.Response;
globalThis.Response = class extends RealResponse {      // Node refuses status 101 (the WebSocket upgrade)
  constructor(body, init) {
    if (init && init.status === 101) { super(null, { status: 200 }); this.webSocket = init.webSocket; Object.defineProperty(this, "status", { value: 101 }); }
    else super(body, init);
  }
};
export class FakeWS {
  constructor() { this.sent = []; this.closed = null; this.att = null; this.onSend = null; this.onClose = null; }
  send(s) { if (this.closed) throw new Error("closed"); this.sent.push(JSON.parse(s)); if (this.onSend) this.onSend(s); }
  close(code, reason) { this.closed = { code, reason }; if (this.onClose) this.onClose(code, reason); }
  serializeAttachment(a) { this.att = structuredClone(a); }
  deserializeAttachment() { return this.att === null ? null : structuredClone(this.att); }
  ofType(t) { return this.sent.filter((m) => m.t === t); }
  last(t) { const l = this.ofType(t); return l[l.length - 1]; }
}
let lastPair = null;
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWS(); this[1] = new FakeWS(); lastPair = this; } };
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.a = a; this.b = b; } };

export function harness(RoomClass, env = {}) {
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

