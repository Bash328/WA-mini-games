/* ============================================================
   user-registry.mjs — the Durable Object that holds every username.

   One object for the whole site (worker/index.mjs always asks for
   idFromName("registry")), so a name can only ever be claimed once: the
   object handles one request at a time, which is exactly the guarantee a
   unique-name check needs. It is the "database" for usernames, push
   subscriptions and blocks.

   ponytail: a single object serialises every request. Fine for a casual
   games site (it can serve hundreds of requests a second); if it ever
   isn't, shard by the first letter of the name (idFromName("registry-a")…)
   and keep list-wide work in the alarm.

   The Worker has already checked the Origin and any IP rate limit. This
   object checks the token on every call that acts for a player.
   ============================================================ */

import { DurableObject } from "cloudflare:workers";
import * as U from "./users.mjs";
import { sendPush, cleanSubscription, pushConfigured } from "./webpush.mjs";

const PREFIX = "u:";
const DAY = 24 * 60 * 60 * 1000;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export class UserRegistry extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname.slice(1);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "bad-request" }, 400); }
    if (!body || typeof body !== "object") return json({ error: "bad-request" }, 400);
    const now = Date.now();

    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(now + DAY);

    switch (path) {
      case "check": return this.check(body);
      case "claim": return this.claim(body, now);
      case "ping": return this.withUser(body, now, (rec) => json({ ok: true, ...U.profile(rec) }));
      case "release": return this.release(body, now);
      case "push": return this.setPush(body, now);
      case "settings": return this.settings(body, now);
      case "poke": return this.poke(body, now);
      default: return json({ error: "not-found" }, 404);
    }
  }

  /* ---------- helpers ---------- */

  async load(key) { return this.ctx.storage.get(PREFIX + key); }
  async save(rec) { await this.ctx.storage.put(PREFIX + rec.key, rec); }

  /* The record for body.name when body.token proves ownership; the stale
     check frees a name nobody has used for 90 days. */
  async authed(body, now) {
    const c = U.checkName(body.name);
    if (!c.ok || typeof body.token !== "string") return null;
    const rec = await this.load(c.key);
    if (!rec) return null;
    if (U.isStale(rec, now)) { await this.ctx.storage.delete(PREFIX + rec.key); return null; }
    if (!U.sameHash(rec.th, await U.hashToken(body.token))) return null;
    return rec;
  }
  async withUser(body, now, fn) {
    const rec = await this.authed(body, now);
    if (!rec) return json({ error: "unauthorized" }, 401);
    rec.seen = now;
    await this.save(rec);
    return fn(rec);
  }

  /* ---------- names ---------- */

  async check(body) {
    const c = U.checkName(body.name);
    if (!c.ok) return json({ available: false, reason: c.reason });
    const rec = await this.load(c.key);
    if (rec && !U.isStale(rec, Date.now())) return json({ available: false, reason: "taken" });
    return json({ available: true });
  }

  async claim(body, now) {
    const c = U.checkName(body.name);
    if (!c.ok) return json({ error: "bad-name", reason: c.reason }, 400);
    const existing = await this.load(c.key);
    if (existing && !U.isStale(existing, now)) return json({ error: "taken", reason: "taken" }, 409);
    const token = U.newToken();
    await this.save(U.newRecord(c.name, await U.hashToken(token), now));
    return json({ ok: true, name: c.name, token });
  }

  async release(body, now) {
    const rec = await this.authed(body, now);
    if (!rec) return json({ error: "unauthorized" }, 401);
    await this.ctx.storage.delete(PREFIX + rec.key);
    return json({ ok: true });
  }

  /* ---------- push subscription and settings ---------- */

  async setPush(body, now) {
    return this.withUser(body, now, async (rec) => {
      if (body.subscription === null) rec.sub = null;
      else {
        const sub = cleanSubscription(body.subscription, this.env);
        if (!sub) return json({ error: "bad-subscription" }, 400);
        rec.sub = sub;
      }
      await this.save(rec);
      return json({ ok: true, ...U.profile(rec) });
    });
  }

  async settings(body, now) {
    return this.withUser(body, now, async (rec) => {
      if (typeof body.muted === "boolean") rec.muted = body.muted;
      if (typeof body.block === "string" && !U.block(rec, body.block)) return json({ error: "cannot-block" }, 400);
      if (typeof body.unblock === "string") U.unblock(rec, body.unblock);
      await this.save(rec);
      return json({ ok: true, ...U.profile(rec) });
    });
  }

  /* ---------- poke ----------
     body: { name, token, to, game, room }. The Worker has already checked
     that game is a live game and that the room exists. Blocked and muted
     targets are told nothing: to the sender it looks the same as a poke
     that was delivered. */
  async poke(body, now) {
    return this.withUser(body, now, async (me) => {
      const t = U.checkName(body.to);
      if (!t.ok) return json({ error: "unknown-user" }, 404);
      const target = await this.load(t.key);
      if (!target || U.isStale(target, now)) return json({ error: "unknown-user" }, 404);
      const ok = U.pokeAllowed(me, target, now);
      if (!ok.ok) { await this.save(me); return json({ error: ok.reason }, ok.reason === "self" ? 400 : 429); }
      U.notePoke(me, target, now);

      let delivered = true;
      if (!target.muted && !target.blocked.includes(me.key)) {
        if (!target.sub || !pushConfigured(this.env)) delivered = false;
        else {
          const res = await sendPush(target.sub, {
            t: "poke", from: me.name, game: body.game,
            title: me.name + " wants to play " + U.POKE_GAMES_TITLE(body.game),
            body: "Tap to join their live room.",
            url: "/" + body.game + "/?live=" + body.room,
          }, this.env, this.fetchPush);
          if (res.gone) target.sub = null;
          if (!res.ok) delivered = false;
        }
      }
      await this.save(me);
      await this.save(target);
      return json({ ok: true, delivered });
    });
  }

  // overridable in tests; the real thing is the global fetch
  get fetchPush() { return (...a) => fetch(...a); }

  /* ---------- housekeeping ---------- */

  async alarm() {
    const now = Date.now();
    const all = await this.ctx.storage.list({ prefix: PREFIX });
    for (const [k, rec] of all) if (U.isStale(rec, now)) await this.ctx.storage.delete(k);
    await this.ctx.storage.setAlarm(now + DAY);
  }
}
