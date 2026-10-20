/* sw.js — the service worker. It does two things and nothing else:
   shows a notification when a friend pokes you (Web Push), and opens the live
   room when you tap it. It caches nothing and answers no fetches, so the site
   always loads fresh from the network exactly as before.

   Served from the site root (see worker/index.mjs) so its scope covers every
   game page. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
