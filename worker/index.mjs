/* ============================================================
   index.mjs — Cloudflare Worker that gives each move-link its own
   WhatsApp preview.

   Everything else about the site is unchanged: the Worker streams the
   static asset through HTMLRewriter and swaps two meta tags when the URL
   carries a valid ?s= state. No state is stored anywhere; the link is
   still the whole game.

   Serving model: Workers Static Assets with run_worker_first = true, so
   this runs ahead of asset serving and can transform the HTML. If you
   instead keep GitHub Pages as the origin and put this on a route, swap
   the env.ASSETS.fetch(request) line for a fetch() of the origin — the
   rewriting below is identical either way.
   ============================================================ */

import { ogFor, ogForLive } from "./og-text.mjs";
import { liveGame, LIVE_SLUGS } from "./live-games.mjs";
import { LiveRoom } from "./live-room.mjs";
import { UserRegistry } from "./user-registry.mjs";
import { CardRoom } from "./card-room.mjs";
import { CARD_GAMES } from "./card-protocol.mjs";
import { pushConfigured } from "./webpush.mjs";

// Cloudflare finds the Durable Object class by its export from the main module.
export { LiveRoom, UserRegistry, CardRoom };

/* ---------- live rooms (/api/live/*) ----------
   status  GET  -> { enabled, games }
   create  POST {game} -> { room }
   ws      GET  ?room=CODE, WebSocket upgrade -> the room's Durable Object

   Room codes avoid look-alike characters (no 0/O, 1/I). Browsers always
   send Origin on WebSocket and POST requests, so requiring it to match
   the request's own origin is what stops another site from driving this
   API from a visitor's browser. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function newCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/* Room options a game accepts at creation (RPS: best-of). Returns the clean
   config (possibly null), or false if the options are not acceptable. */
function roomConfig(game, raw) {
  const G = liveGame(game);
  if (!G || typeof G.rules.normalizeConfig !== "function") return null;
  const cfg = G.rules.normalizeConfig(raw);
  return cfg || false;
}

/* Picks a free code in a room namespace (env.ROOMS or env.CARDS) and initialises
   that room with `init` plus the code. Returns { code, stub } or null. */
async function makeRoom(ns, init) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const stub = ns.get(ns.idFromName(code));
    const res = await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ ...init, code: code }) });
    if (res.status === 200) return { code: code, stub: stub };
    if (res.status !== 409) break;          // 409 = code taken, try another
  }
  return null;
}

/* Is this IP under one of the per-minute limits (CREATE_LIMITER, LOOKUP_LIMITER...)? No binding: no limit. */
async function underLimit(limiter, request) {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
  return success;
}

/* Browsers always send Origin on WebSocket and POST requests, so requiring it to match the site is what stops
   another site driving the API from a visitor's browser. Local scripts may opt out with LIVE_ALLOW_NO_ORIGIN. */
function sameOrigin(request, env, url) {
  const origin = request.headers.get("Origin");
  return origin === url.origin || (origin === null && env.LIVE_ALLOW_NO_ORIGIN === "1");
}

/* A body is refused before it is read when it says it is bigger than the endpoint takes (all bodies here are tiny). */
const tooBig = (request, max) => Number(request.headers.get("Content-Length") || 0) > max;

/* GET exists?room=CODE for a room namespace. Read-only and secret-free, so no Origin check (browsers do not send
   Origin on same-origin GETs), but rate limited: every lookup wakes a room object. */
async function roomExists(ns, request, env, url) {
  const code = url.searchParams.get("room") || "";
  if (!CODE_RE.test(code)) return json({ exists: false });
  if (!(await underLimit(env.LOOKUP_LIMITER, request))) return json({ error: "rate-limit" }, 429);
  const res = await ns.get(ns.idFromName(code)).fetch("https://room/exists");
  return json({ exists: res.status === 200 });
}

async function handleLive(request, env, url) {
  const enabled = env.LIVE_ENABLED !== "0";
  const sub = url.pathname.slice("/api/live/".length);

  if (sub === "status" && request.method === "GET") {
    return json({ enabled: enabled, games: enabled ? LIVE_SLUGS.concat(CARD_GAMES) : [] });
  }
  if (!enabled) return json({ error: "disabled" }, 503);

  if (sub === "exists" && request.method === "GET") return roomExists(env.ROOMS, request, env, url);
  if (!sameOrigin(request, env, url)) return json({ error: "forbidden" }, 403);

  if (sub === "create" && request.method === "POST") {
    if (tooBig(request, 2048)) return json({ error: "too-big" }, 413);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "bad-request" }, 400); }
    if (!body || !liveGame(body.game)) return json({ error: "unknown-game" }, 400);

    const cfg = roomConfig(body.game, body);
    if (cfg === false) return json({ error: "bad-options" }, 400);
    if (!(await underLimit(env.CREATE_LIMITER, request))) return json({ error: "rate-limit" }, 429);
    const made = await makeRoom(env.ROOMS, { game: body.game, config: cfg || null });
    return made ? json({ room: made.code }) : json({ error: "unavailable" }, 503);
  }

  // Create a room AND open its socket in one request: the creator's first
  // connection makes the room, so there is no separate POST round trip (a
  // new TLS connection plus a Durable Object cold start) before connecting.
  // The room code comes back in the "welcome" message.
  if (sub === "new" && request.method === "GET") {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade-required" }, 426);
    const game = url.searchParams.get("game") || "";
    if (!liveGame(game)) return json({ error: "unknown-game" }, 400);
    const cfg = roomConfig(game, { bestOf: url.searchParams.get("bestof") || undefined });
    if (cfg === false) return json({ error: "bad-options" }, 400);
    if (!(await underLimit(env.CREATE_LIMITER, request))) return json({ error: "rate-limit" }, 429);
    const made = await makeRoom(env.ROOMS, { game: game, config: cfg || null });
    if (!made) return json({ error: "unavailable" }, 503);
    return made.stub.fetch(new Request("https://room/ws", request));
  }

  if (sub === "ws" && request.method === "GET") {
    const code = url.searchParams.get("room") || "";
    if (!CODE_RE.test(code)) return json({ error: "bad-room" }, 400);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(new Request("https://room/ws", request));
  }

  return json({ error: "not-found" }, 404);
}

/* ---------- Crazy 8, Liar's Dice, Dominoes, Ludo, Hearts, Farkle and Lost Cities rooms (/api/card/*) ----------
   A different kind of room (3-6 seats for Skull, 2-4 for the others; hidden hands, computer players), so a
   different Durable Object (card-room.mjs); the same rules for the Origin
   check, the kill switch and the new-room rate limit as live rooms.
   new   GET  ?game=SLUG (default crazy-8), WebSocket upgrade: makes a room AND connects, like /api/live/new
   ws    GET  ?room=CODE, WebSocket upgrade
   exists GET ?room=CODE */
async function handleCard(request, env, url) {
  if (env.LIVE_ENABLED === "0") return json({ error: "disabled" }, 503);
  const sub = url.pathname.slice("/api/card/".length);
  if (sub === "exists" && request.method === "GET") return roomExists(env.CARDS, request, env, url);
  if (!sameOrigin(request, env, url)) return json({ error: "forbidden" }, 403);
  if (sub === "new" && request.method === "GET") {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade-required" }, 426);
    if (!(await underLimit(env.CREATE_LIMITER, request))) return json({ error: "rate-limit" }, 429);
    const game = url.searchParams.get("game") || "crazy-8";
    if (!CARD_GAMES.includes(game)) return json({ error: "bad-game" }, 400);
    const made = await makeRoom(env.CARDS, { game: game });
    if (!made) return json({ error: "unavailable" }, 503);
    return made.stub.fetch(new Request("https://room/ws", request));
  }
  if (sub === "ws" && request.method === "GET") {
    const code = url.searchParams.get("room") || "";
    if (!CODE_RE.test(code)) return json({ error: "bad-room" }, 400);
    return env.CARDS.get(env.CARDS.idFromName(code)).fetch(new Request("https://room/ws", request));
  }
  return json({ error: "not-found" }, 404);
}

/* ---------- usernames and pokes (/api/user/*) ----------
   status   GET   -> { push, vapid }       is Web Push set up, and its public key
   check    POST  { name }                  is a name free?
   claim    POST  { name }                  -> { name, token }; the token IS the name
   ping     POST  { name, token }           -> the player's own settings
   push     POST  { name, token, subscription | null }
   settings POST  { name, token, muted?, block?, unblock? }
   release  POST  { name, token }           give the name back
   poke     POST  { name, token, to, game, room }   ask a friend into a live room

   Everything is same-origin only (the same rule as live rooms) and the
   registry (user-registry.mjs) checks the token on anything that acts for a
   player. Bodies are tiny, so anything bigger is refused unread. */
const USER_ACTIONS = new Set(["check", "claim", "ping", "push", "settings", "release", "poke"]);

async function handleUser(request, env, url) {
  const sub = url.pathname.slice("/api/user/".length);
  if (sub === "status" && request.method === "GET") {
    return json({ push: pushConfigured(env), vapid: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null });
  }
  if (!USER_ACTIONS.has(sub)) return json({ error: "not-found" }, 404);
  if (request.method !== "POST") return json({ error: "method" }, 405);

  if (!sameOrigin(request, env, url)) return json({ error: "forbidden" }, 403);
  if (tooBig(request, 2048)) return json({ error: "too-big" }, 413);
  const text = await request.text();
  if (text.length > 2048) return json({ error: "too-big" }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ error: "bad-request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "bad-request" }, 400);

  if ((sub === "claim" || sub === "check") && !(await underLimit(env.CLAIM_LIMITER, request))) return json({ error: "rate-limit" }, 429);

  if (sub === "poke") {
    // The room has to be a real, open one for a game that can be played live,
    // so a poke can't be used to push an arbitrary link at someone.
    const cards = CARD_GAMES.includes(body.game);
    if ((!cards && !liveGame(body.game)) || !CODE_RE.test(String(body.room || ""))) return json({ error: "bad-room" }, 400);
    const room = cards ? env.CARDS.get(env.CARDS.idFromName(body.room)) : env.ROOMS.get(env.ROOMS.idFromName(body.room));
    if ((await room.fetch("https://room/exists")).status !== 200) return json({ error: "bad-room" }, 400);
  }

  const reg = env.USERS.get(env.USERS.idFromName("registry"));
  const res = await reg.fetch("https://users/" + sub, { method: "POST", body: JSON.stringify(body) });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

class MetaRewriter {
  constructor(og) { this.og = og; }
  element(el) {
    const prop = el.getAttribute("property");
    if (prop === "og:title") el.setAttribute("content", this.og.title);
    else if (prop === "og:description") el.setAttribute("content", this.og.description);
  }
}

class TitleRewriter {
  constructor(og) { this.og = og; }
  element(el) { el.setInnerContent(this.og.title); }
}

/* Link-preview crawlers only read the <head>. Hand them just that: no
   scripts, styles or body, so a whole game page (or the hub with its
   inline art) shrinks to the few hundred bytes a preview card needs. */
const PREVIEW_BOT = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|SkypeUriPreview|Signal/i;

class Drop {
  element(el) { el.remove(); }
}

// Marks a response the Worker handled. Scripts, styles and pictures never reach the Worker (wrangler.toml), so they must
// NOT carry it: the regression check "static-files-skip-worker" looks for exactly that.
function viaWorker(res) {
  const out = new Response(res.body, res);
  out.headers.set("x-worker", "1");
  return out;
}

export default {
  async fetch(request, env) {
    // Before anything else, and before touching the assets: www and the
    // apex were each serving their own indexable copy of every page.
    // Rebuilt from a parsed URL so the path and ?s= (the game) survive.
    const u = new URL(request.url);
    if (u.hostname.startsWith("www.")) {
      u.hostname = u.hostname.slice(4);
      return Response.redirect(u.toString(), 301);
    }

    if (u.pathname.startsWith("/api/live/")) return handleLive(request, env, u);
    if (u.pathname.startsWith("/api/card/")) return handleCard(request, env, u);
    if (u.pathname.startsWith("/api/user/")) return handleUser(request, env, u);

    // The service worker has to be revalidated every time (so an update reaches
    // people) and may control the whole site.
    if (u.pathname === "/sw.js") {
      const sw = await env.ASSETS.fetch(request);
      const out = new Response(sw.body, sw);
      out.headers.set("Cache-Control", "no-cache");
      out.headers.set("Content-Type", "text/javascript; charset=utf-8");
      out.headers.set("Service-Worker-Allowed", "/");
      out.headers.set("x-worker", "1");
      return out;
    }

    const res = await env.ASSETS.fetch(request);

    // Only HTML is worth rewriting, and only when the link carries state.
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return viaWorker(res);

    const url = new URL(request.url);
    const live = url.searchParams.get("live");
    const og = live !== null
      ? ogForLive(url.pathname, live)
      : ogFor(url.pathname, url.searchParams.get("s"));
    const bot = PREVIEW_BOT.test(request.headers.get("User-Agent") || "");
    if (!og && !bot) return viaWorker(res);

    // A preview varies with ?s= / ?live= (and with who is asking), so a cache
    // keyed on the path alone would hand every player the first player's preview.
    const out = new Response(res.body, res);
    out.headers.append("Vary", "Accept");
    out.headers.append("Vary", "User-Agent");
    out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    out.headers.set("x-worker", "1");
    if (live !== null) out.headers.set("X-Robots-Tag", "noindex");

    let rw = new HTMLRewriter();
    if (og) {
      rw = rw
        .on('meta[property="og:title"]', new MetaRewriter(og))
        .on('meta[property="og:description"]', new MetaRewriter(og))
        .on("title", new TitleRewriter(og));
    }
    if (bot) {
      rw = rw.on("script", new Drop()).on("style", new Drop())
        .on('link[rel="stylesheet"]', new Drop()).on("body", new Drop())
        .onDocument({ comments(c) { c.remove(); } });
    }
    return rw.transform(out);
  },
};
