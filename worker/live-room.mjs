/* ============================================================
   live-room.mjs — the Durable Object behind one live game room.

   Deliberately thin: every decision is made by live-protocol.mjs (pure,
   unit-tested). This file only does what needs Cloudflare — accept
   WebSockets with the hibernation API, persist the room, schedule the
   expiry alarm, and fan messages out to the two seats.

   Hibernation matters for cost: while both players sit and think, the
   object is evicted from memory and nothing is billed. Keep-alive pings
   ("ping" -> "pong") are answered by the runtime itself without waking
   the object.
   ============================================================ */

import { DurableObject } from "cloudflare:workers";
import * as P from "./live-protocol.mjs";

const ROOM = "room";

function mintToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class LiveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /* ---------- HTTP entry points (called by worker/index.mjs) ---------- */

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      if (await this.ctx.storage.get(ROOM)) return new Response("exists", { status: 409 });
      let body;
      try { body = await request.json(); } catch (e) { return new Response("bad", { status: 400 }); }
      const room = P.newRoom(body.game, body.code, Date.now(), Math.random, body.config || null);
      if (!room) return new Response("unknown game", { status: 400 });
      await this.ctx.storage.put(ROOM, room);
      await this.ctx.storage.setAlarm(P.expiresAt(room));
      return new Response("ok");
    }

    if (url.pathname === "/exists") {
      return new Response(null, { status: (await this.ctx.storage.get(ROOM)) ? 200 : 404 });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("upgrade required", { status: 426 });
      if (!(await this.ctx.storage.get(ROOM))) return new Response("no such room", { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ seat: 0, bucket: null });
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  /* ---------- WebSocket events ---------- */

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return this.reject(ws, "bad-message");
    if (message.length > P.MAX_MESSAGE_CHARS) { ws.close(1009, "too big"); return; }

    const att = ws.deserializeAttachment() || { seat: 0, bucket: null };
    const now = Date.now();
    const rl = P.takeToken(att.bucket, now);
    att.bucket = rl.bucket;
    ws.serializeAttachment(att);
    if (!rl.allowed) return this.reject(ws, "rate-limit");

    let msg;
    try { msg = JSON.parse(message); } catch (e) { return this.reject(ws, "bad-json"); }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return this.reject(ws, "bad-message");

    if (this.env.LIVE_ENABLED === "0") {
      this.send(ws, { t: "closed", reason: "disabled" });
      ws.close(1000, "disabled");
      return;
    }

    const room = await this.ctx.storage.get(ROOM);
    if (!room) {
      this.send(ws, { t: "closed", reason: "expired" });
      ws.close(1000, "expired");
      return;
    }

    if (msg.t === "hello") return this.onHello(ws, att, room, msg, now);
    if (!att.seat) return this.reject(ws, "no-hello");

    if (msg.t === "move") {
      const res = P.applyMove(room, att.seat, msg, now);
      if (!res.ok) {
        this.send(ws, { t: "reject", reason: res.reason, state: room.state });
        return;
      }
      await this.persist(room);
      this.broadcast({ t: "state", s: res.state, by: att.seat });
      return;
    }

    if (msg.t === "pick") {
      const res = P.applyPick(room, att.seat, msg, now);
      if (!res.ok) {
        this.send(ws, { t: "reject", reason: res.reason, state: room.state });
        return;
      }
      await this.persist(room);
      if (res.state) {
        this.broadcast({ t: "state", s: res.state, by: att.seat });
      } else {
        // flags only: the other side learns THAT a pick is in, never WHAT
        this.broadcast({ t: "picked", picked: P.pickedFlags(room) });
      }
      return;
    }

    if (msg.t === "rematch") {
      const res = P.requestRematch(room, att.seat, now);
      if (!res.ok) return this.reject(ws, res.reason);
      await this.persist(room);
      if (res.started) {
        this.broadcast({ t: "rematch-start", id: room.id, order: room.order, state: null, picked: P.pickedFlags(room) });
      } else {
        this.broadcast({ t: "rematch", rematch: room.rematch });
      }
      return;
    }

    this.reject(ws, "unknown-type");
  }

  async webSocketClose(ws, code) {
    try { ws.close(code && code !== 1005 ? code : 1000, "bye"); } catch (e) { /* already closed */ }
    this.broadcastPresence(ws);
  }

  async webSocketError(ws) {
    try { ws.close(1011, "error"); } catch (e) { /* already closed */ }
    this.broadcastPresence(ws);
  }

  /* ---------- expiry ---------- */

  async alarm() {
    const room = await this.ctx.storage.get(ROOM);
    if (!room) return;
    if (Date.now() < P.expiresAt(room)) {
      await this.ctx.storage.setAlarm(P.expiresAt(room));
      return;
    }
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: "closed", reason: "expired" });
      try { ws.close(1000, "expired"); } catch (e) { /* ignore */ }
    }
    await this.ctx.storage.deleteAll();
  }

  /* ---------- helpers ---------- */

  async onHello(ws, att, room, msg, now) {
    const j = P.join(room, typeof msg.token === "string" ? msg.token : null, mintToken, now);
    if (!j.ok) {
      this.send(ws, { t: "closed", reason: "full" });
      ws.close(1000, "full");
      return;
    }
    // One live socket per seat: a second tab / a reconnect replaces the old one.
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment();
      if (a && a.seat === j.seat) {
        this.send(other, { t: "closed", reason: "taken-over" });
        a.seat = 0;
        other.serializeAttachment(a);
        try { other.close(1000, "taken over"); } catch (e) { /* ignore */ }
      }
    }
    att.seat = j.seat;
    ws.serializeAttachment(att);
    if (j.fresh) await this.persist(room);
    this.send(ws, { ...P.welcomePayload(room, j.seat, j.token), online: this.online(), });
    this.broadcastPresence();
  }

  async persist(room) {
    await this.ctx.storage.put(ROOM, room);
    // Only move the expiry alarm when it has drifted noticeably: one storage
    // write per move instead of two. alarm() re-checks the real expiry, so a
    // slightly early alarm just reschedules itself.
    const want = P.expiresAt(room);
    const cur = await this.ctx.storage.getAlarm();
    if (cur === null || Math.abs(want - cur) > 30 * 60 * 1000) await this.ctx.storage.setAlarm(want);
  }

  online(except) {
    const o = { 1: false, 2: false };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment();
      if (a && a.seat) o[a.seat] = true;
    }
    return o;
  }

  async broadcastPresence(except) {
    const room = await this.ctx.storage.get(ROOM);
    const msg = {
      t: "presence",
      online: this.online(except),
      seated: room ? { 1: !!room.seats[1], 2: !!room.seats[2] } : { 1: false, 2: false },
    };
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment();
      if (a && a.seat) this.send(ws, msg);
    }
  }

  broadcast(msg) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.seat) this.send(ws, msg);
    }
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* socket already gone */ }
  }

  reject(ws, reason) {
    this.send(ws, { t: "reject", reason: reason });
  }
}
