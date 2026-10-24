/* sw.js — the service worker. It does three things:
   1. shows a notification when a friend pokes you (Web Push) and opens the live room when you tap it;
   2. keeps a copy of every page you open and every script, style, picture and font they load, so the games
      open from the phone's own storage and the single-player ones keep working with no signal;
   3. never touches the API, other sites, or this file.

   How each kind of request is answered (the Worker serves pages and the API, the assets store serves the rest):
     page (navigation)     network first, so a deploy shows up at once; if the network fails or takes more than
                           4 seconds, the copy from the last visit (or, for a ?s= link, the same game's page);
     script / style / font file.js?v=<hash>, /assets/fonts/*: cache first. The address changes whenever the file
                           does (tests/cache-bust.mjs), so a stored copy is never stale. Older versions of the same
                           file are deleted when a new one is stored.
     pictures and the rest same-origin GET: show the stored copy and refresh it in the background.
   Anything else (POST, Range, /api/, cross-origin such as analytics, this file) is left to the browser.

   KILL SWITCH, in case the storing ever goes wrong. A phone only gets a corrected sw.js on its next visit, so there
   are two ways to stop it, fastest first:
     1. Set SW_KILL = "1" in wrangler.toml [vars] and deploy. The Worker then marks every page with the header
        x-sw-kill: 1; the next time any phone loads a page ONLINE this worker deletes everything it stored and
        stops answering requests (it stays installed but inert). Set SW_KILL back to "0" and deploy: the next page
        load without the header makes it resume. No change to this file is needed.
     2. Set CACHING = false below and deploy. Phones that update to that version delete everything on install and
        never store anything again.
   Served from the site root (see worker/index.mjs) so its scope covers every game page. Bump CACHE when the rules
   above change in a way old copies must not survive. */

const CACHING = true;                                // kill switch 2: false = store nothing, wipe everything
const CACHE = "wa-v1";
const PAGES = CACHE + "-pages";
const FILES = CACHE + "-files";
const PAUSED = CACHE + "-paused";                    // an empty store whose existence means "kill switch 1 is on"
const NETWORK_WAIT_MS = 4000;

let paused = null;                                   // null = not read yet; true while the server says SW_KILL

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  if (!CACHING) {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.clients.claim();
    return;
  }
  // start fetching a page while this worker wakes up, and drop the stores of an older version
  if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (err) { /* not supported: fine */ } }
  for (const k of await caches.keys()) if (k !== PAGES && k !== FILES && k !== PAUSED) await caches.delete(k);
  await self.clients.claim();
})()));

/* ---------- caching ---------- */

const isStamped = (u) => u.searchParams.has("v") || u.pathname.startsWith("/assets/fonts/") || u.pathname.startsWith("/assets/vendor/");
const pageKey = (u) => new Request(u.origin + u.pathname);                       // the page, without ?s= / ?live=
const cacheable = (res) => res && res.status === 200 && res.type === "basic";
const killed = (res) => !!res && res.headers.get("x-sw-kill") === "1";

async function pause() {                                                          // the server asked: forget everything, stay out of the way
  paused = true;
  for (const k of await caches.keys()) await caches.delete(k);
  await caches.open(PAUSED);
}
async function resume() { paused = false; await caches.delete(PAUSED); }

async function putFile(req, res) {
  const cache = await caches.open(FILES);
  await cache.put(req, res);
  // a new ?v= of a file makes the old copies useless: keep only the newest per path
  const u = new URL(req.url);
  if (!u.searchParams.has("v")) return;
  for (const k of await cache.keys()) {
    const ku = new URL(k.url);
    if (ku.pathname === u.pathname && ku.search !== u.search) await cache.delete(k);
  }
}

async function answerFile(req, u) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(req);
  if (hit && isStamped(u)) return hit;                                              // never stale at this address
  const fresh = fetch(req).then((res) => { if (cacheable(res)) putFile(req, res.clone()).catch(() => {}); return res; });
  if (hit) { fresh.catch(() => {}); return hit; }                                   // stale-while-revalidate
  return fresh;
}

async function answerPage(e, req, u) {
  if (paused === null) paused = await caches.has(PAUSED);
  const network = (e.preloadResponse ? e.preloadResponse.then((r) => r || fetch(req)) : fetch(req))
    .then((res) => {
      if (killed(res)) { e.waitUntil(pause()); return res; }
      if (paused) e.waitUntil(resume());                                            // the page came without the marker: kill switch is off again
      if (res && res.ok && /text\/html/.test(res.headers.get("content-type") || "")) {
        const copy = res.clone();
        caches.open(PAGES).then((c) => c.put(pageKey(u), copy)).catch(() => {});
      }
      return res;
    });
  if (paused) return network;                                                       // paused: plain network, no fallback copies
  const first = await Promise.race([network.catch(() => null), new Promise((r) => setTimeout(() => r(null), NETWORK_WAIT_MS))]);
  if (first) return first;
  const cache = await caches.open(PAGES);
  const hit = (await cache.match(pageKey(u))) || (await cache.match(new Request(u.origin + "/")));
  return hit || network;                                                            // no copy: keep waiting for the real answer
}

if (CACHING) self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || u.pathname === "/sw.js" || u.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") e.respondWith(answerPage(e, req, u));
  else if (paused !== true) e.respondWith(answerFile(req, u));
});

/* ---------- pokes ---------- */

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { /* not JSON: show the generic line */ }
  // Only this site's own paths: a notification can never open a foreign address.
  const url = typeof d.url === "string" && d.url.charAt(0) === "/" && d.url.charAt(1) !== "/" ? d.url : "/";
  e.waitUntil(self.registration.showNotification(String(d.title || "WA mini-games").slice(0, 80), {
    body: String(d.body || "").slice(0, 120),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "poke-" + String(d.from || ""),     // a second poke from the same person replaces the first
    renotify: true,
    data: { url: url },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url === target && "focus" in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
