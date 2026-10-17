/* ============================================================
   card-room.mjs — the Durable Object behind one multi-seat room (Crazy 8, Liar's Dice, Dominoes).

   Deliberately thin, like live-room.mjs: every decision is made by
   card-protocol.mjs (pure, unit-tested with a fake clock). This file only does
   what needs Cloudflare: accept WebSockets with the hibernation API, persist
   the room, run the alarm that drives computer players and timeouts, and send
   each person THEIR view of the table (their own hand, everyone else's card
   count: the deck and the other hands never leave this object).
   ============================================================ */

import { DurableObject } from "cloudflare:workers";
import * as P from "./card-protocol.mjs";
import { takeToken, checkTaunt } from "./live-protocol.mjs";

const ROOM = "room";

function mintToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class CardRoom extends DurableObject {
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
      const room = P.newRoom(String(body.code), Date.now(), body.game === undefined ? "crazy-8" : String(body.game));
      if (!room) return new Response("bad", { status: 400 });
      await this.save(room);
      return new Response("ok");
    }
    if (url.pathname === "/exists") return new Response(null, { status: (await this.ctx.storage.get(ROOM)) ? 200 : 404 });

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("upgrade required", { status: 426 });
      if (!(await this.ctx.storage.get(ROOM))) return new Response("no such room", { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ pid: null, bucket: null, tauntAt: 0 });
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  /* ---------- WebSocket events ---------- */

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return this.reject(ws, "bad-message");
    if (message.length > P.MAX_MESSAGE_CHARS) { ws.close(1009, "too big"); return; }

    const att = ws.deserializeAttachment() || { pid: null, bucket: null, tauntAt: 0 };
    const now = Date.now();
    const rl = takeToken(att.bucket, now);
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
    if (!room) { this.send(ws, { t: "closed", reason: "expired" }); ws.close(1000, "expired"); return; }

    // anything that is due (a computer's turn, a timeout) happens before this message is handled
    const due = P.tick(room, now, Math.random);

    if (msg.t === "hello") return this.onHello(ws, att, room, msg, now, due.notices);
    if (att.pid === null) return this.refuse(ws, "no-hello", room, now, due.notices);
    const pid = att.pid;
    let notices = due.notices.slice();

    if (msg.t === "config") {
      const res = P.setConfig(room, pid, { mode: msg.mode, bots: msg.bots, level: msg.level }, now, Math.random);
      if (!res.ok) return this.refuse(ws, res.reason, room, now, notices);
    } else if (msg.t === "start") {
      const res = P.start(room, pid, now, Math.random);
      if (!res.ok) return this.refuse(ws, res.reason, room, now, notices);
    } else if (msg.t === "act") {
      const res = P.act(room, pid, msg.a, now, Math.random);
      if (!res.ok) { this.reject(ws, res.reason); return this.commit(room, now, notices); }   // refresh their view too
    } else if (msg.t === "vote") {
      const res = P.vote(room, pid, now, Math.random);
      if (!res.ok) return this.refuse(ws, res.reason, room, now, notices);
    } else if (msg.t === "leave") {
      notices = notices.concat(P.leave(room, pid, now, Math.random));
      att.pid = null; ws.serializeAttachment(att);
      this.send(ws, { t: "left" });
      try { ws.close(1000, "left"); } catch (e) { /* already closed */ }
    } else if (msg.t === "taunt") {
      const res = checkTaunt(msg, att.tauntAt, now);
      if (!res.ok) return this.refuse(ws, res.reason, room, now, notices);
      att.tauntAt = now; ws.serializeAttachment(att);
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        const a = other.deserializeAttachment();
        if (a && a.pid !== null) this.send(other, { t: "taunt", k: res.k, i: res.i, from: pid });
      }
      return this.commit(room, now, notices);
    } else return this.refuse(ws, "unknown-type", room, now, notices);

    await this.commit(room, now, notices);
  }

  async webSocketClose(ws, code) {
    try { ws.close(code && code !== 1005 ? code : 1000, "bye"); } catch (e) { /* already closed */ }
    await this.dropped(ws);
  }
  async webSocketError(ws) {
    try { ws.close(1011, "error"); } catch (e) { /* already closed */ }
    await this.dropped(ws);
  }

  /* ---------- the alarm: computers move, timeouts fire, rooms expire ---------- */

  async alarm() {
    const room = await this.ctx.storage.get(ROOM);
    if (!room) return;
    const now = Date.now();
    if (now >= P.expiresAt(room)) {
      for (const ws of this.ctx.getWebSockets()) {
        this.send(ws, { t: "closed", reason: "expired" });
        try { ws.close(1000, "expired"); } catch (e) { /* ignore */ }
      }
      await this.ctx.storage.deleteAll();
      return;
    }
    const due = P.tick(room, now, Math.random);
    await this.commit(room, now, due.notices);
  }

  /* ---------- helpers ---------- */

  async onHello(ws, att, room, msg, now, notices) {
    const j = P.join(room, typeof msg.token === "string" ? msg.token : null, msg.name, mintToken, now, Math.random);
    if (!j.ok) {
      this.send(ws, { t: "closed", reason: j.reason });
      ws.close(1000, j.reason);
      return;
    }
    // one live socket per person: a second tab / a reconnect replaces the old one
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment();
      if (a && a.pid === j.pid) {
        this.send(other, { t: "closed", reason: "taken-over" });
        a.pid = null; other.serializeAttachment(a);
        try { other.close(1000, "taken over"); } catch (e) { /* ignore */ }
      }
    }
    att.pid = j.pid; ws.serializeAttachment(att);
    P.setOnline(room, j.pid, true, now);
    this.send(ws, { t: "welcome", pid: j.pid, token: j.token, code: room.code, game: room.game });
    await this.commit(room, now, notices);
  }

  async dropped(ws) {
    const att = ws.deserializeAttachment();
    if (!att || att.pid === null) return;
    // still connected somewhere else (a second tab)? then they are not gone
    const others = this.ctx.getWebSockets().filter((w) => w !== ws && (w.deserializeAttachment() || {}).pid === att.pid);
    if (others.length) return;
    const room = await this.ctx.storage.get(ROOM);
    if (!room) return;
    const now = Date.now();
    P.setOnline(room, att.pid, false, now);
    await this.commit(room, now, []);
  }

  // save, tell everyone what they should now see, and set the alarm for whatever happens next
  async commit(room, now, notices) {
    await this.save(room);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || a.pid === null) continue;
      for (const text of notices) this.send(ws, { t: "notice", text });
      this.send(ws, { t: "room", v: P.viewFor(room, a.pid, now) });
    }
  }
  async save(room) {
    await this.ctx.storage.put(ROOM, room);
    await this.ctx.storage.setAlarm(P.nextWake(room, Date.now()));
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (e) { /* socket already gone */ }
  }
  reject(ws, reason) { this.send(ws, { t: "reject", reason }); }
  // Refuse a message, but still save and send whatever P.tick() just changed (a computer's move, a takeover):
  // it ran before the message was handled, so dropping it here would lose it and its notices.
  async refuse(ws, reason, room, now, notices) { this.reject(ws, reason); await this.commit(room, now, notices); }
}
