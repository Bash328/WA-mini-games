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

// Cloudflare finds the Durable Object class by its export from the main module.
export { LiveRoom };

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

/* Picks a free code and initialises its room. Returns { code, stub } or null. */
async function createRoom(env, game, config) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch("https://room/init", {
      method: "POST",
      body: JSON.stringify({ game: game, code: code, config: config || null }),
    });
    if (res.status === 200) return { code: code, stub: stub };
    if (res.status !== 409) break;          // 409 = code taken, try another
  }
  return null;
}

async function underCreateLimit(request, env) {
  if (!env.CREATE_LIMITER) return true;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.CREATE_LIMITER.limit({ key: ip });
  return success;
}

async function handleLive(request, env, url) {
  const enabled = env.LIVE_ENABLED !== "0";
  const sub = url.pathname.slice("/api/live/".length);

  if (sub === "status" && request.method === "GET") {
    return json({ enabled: enabled, games: enabled ? LIVE_SLUGS : [] });
  }
  if (!enabled) return json({ error: "disabled" }, 503);

  // Read-only and carries no secrets, so it needs no Origin check: browsers
  // do not send Origin on same-origin GET requests, so requiring it would
  // make every legitimate lookup fail.
  if (sub === "exists" && request.method === "GET") {
    const code = url.searchParams.get("room") || "";
    if (!CODE_RE.test(code)) return json({ exists: false });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch("https://room/exists");
    return json({ exists: res.status === 200 });
  }

  // Same-origin only. (Local scripts without a browser can opt out with
  // LIVE_ALLOW_NO_ORIGIN, set only in local dev.)
  const origin = request.headers.get("Origin");
  if (origin !== url.origin && !(origin === null && env.LIVE_ALLOW_NO_ORIGIN === "1")) {
    return json({ error: "forbidden" }, 403);
  }

  if (sub === "create" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "bad-request" }, 400); }
    if (!body || !liveGame(body.game)) return json({ error: "unknown-game" }, 400);

    const cfg = roomConfig(body.game, body);
    if (cfg === false) return json({ error: "bad-options" }, 400);
    if (!(await underCreateLimit(request, env))) return json({ error: "rate-limit" }, 429);
    const made = await createRoom(env, body.game, cfg);
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
    if (!(await underCreateLimit(request, env))) return json({ error: "rate-limit" }, 429);
    const made = await createRoom(env, game, cfg);
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

    const res = await env.ASSETS.fetch(request);

    // Only HTML is worth rewriting, and only when the link carries state.
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return res;

    const url = new URL(request.url);
    const live = url.searchParams.get("live");
    const og = live !== null
      ? ogForLive(url.pathname, live)
      : ogFor(url.pathname, url.searchParams.get("s"));
    const bot = PREVIEW_BOT.test(request.headers.get("User-Agent") || "");
    if (!og && !bot) return res;

    // A preview varies with ?s= / ?live= (and with who is asking), so a cache
    // keyed on the path alone would hand every player the first player's preview.
    const out = new Response(res.body, res);
    out.headers.append("Vary", "Accept");
    out.headers.append("Vary", "User-Agent");
    out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
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
