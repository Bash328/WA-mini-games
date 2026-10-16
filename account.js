/* ============================================================
   account.js — the player's username, notifications and "install app".
   Exposes `window.Account`.

   There are no accounts: a player picks a name, the server (worker/users.mjs)
   keeps one record per name and hands back a secret token. The browser keeps
   that token (localStorage) and sends it with every call; whoever holds it
   owns the name. Nothing here needs gamekit.js.
   ============================================================ */
(function (global) {
  "use strict";

  const API = "/api/user/";
  const K_NAME = "user:name", K_TOKEN = "user:token";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  const REASONS = {
    type: "Pick a name.",
    length: "Names are 3 to 16 characters.",
    chars: "Use letters, numbers and _ only, with at least one letter.",
    reserved: "That name is reserved. Pick another.",
    offensive: "That name isn't allowed. Pick another.",
    taken: "That name is taken. Pick another.",
    "rate-limit": "Too many tries. Wait a minute.",
  };

  function me() {
    const name = lsGet(K_NAME), token = lsGet(K_TOKEN);
    return name && token ? { name: name, token: token } : null;
  }

  // POST to the user API. Always resolves: { status, ...body }, status 0 when offline.
  async function call(path, body) {
    try {
      const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let json = {};
      try { json = await res.json(); } catch (e) { /* empty body */ }
      return Object.assign({ status: res.status }, json);
    } catch (e) {
      return { status: 0, error: "offline" };
    }
  }
  const authed = (path, extra) => {
    const m = me();
    return m ? call(path, Object.assign({ name: m.name, token: m.token }, extra || {})) : Promise.resolve({ status: 401, error: "no-name" });
  };

  let serverStatus = null;
  async function status() {
    if (serverStatus) return serverStatus;
    try { serverStatus = await (await fetch(API + "status")).json(); } catch (e) { serverStatus = { push: false, vapid: null }; }
    return serverStatus;
  }

  /* ---------- names ---------- */
  const check = (name) => call("check", { name: name });
  async function claim(name) {
    const r = await call("claim", { name: name });
    if (r.status === 200 && r.token) { lsSet(K_NAME, r.name); lsSet(K_TOKEN, r.token); }
    return r;
  }
  async function release() {
    const r = await authed("release");
    if (r.status === 200 || r.status === 401) { lsDel(K_NAME); lsDel(K_TOKEN); }   // 401: the name is already gone
    return r;
  }
  // Keeps the name from being freed for inactivity; also returns the settings.
  const ping = () => authed("ping");
  const settings = (s) => authed("settings", s);

  /* ---------- notifications ---------- */
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in global && "Notification" in global;
  const b64uToBytes = (s) => {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
  function registerWorker() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register("/sw.js").catch(() => null);
  }

  // Ask for permission, subscribe this browser, and tell the server.
  // Resolves { ok } or { ok: false, reason: "unsupported"|"denied"|"unavailable"|"failed"|"no-name" }.
  async function enableNotifications() {
    const st = await status();
    if (!st.push || !st.vapid) return { ok: false, reason: "unavailable" };
    if (!pushSupported()) return { ok: false, reason: "unsupported" };
    if (!me()) return { ok: false, reason: "no-name" };
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "denied" };
    try {
      await registerWorker();
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(st.vapid) });
      const r = await authed("push", { subscription: sub.toJSON() });
      return r.status === 200 ? { ok: true } : { ok: false, reason: "failed" };
    } catch (e) {
      return { ok: false, reason: "failed" };
    }
  }
  async function disableNotifications() {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) { /* the server forgetting it is what matters */ }
    return authed("push", { subscription: null });
  }

  /* ---------- poke a friend ---------- */
  const POKE_TEXT = {
    ok: (n) => "Poked " + n + ". They'll get a notification.",
    quiet: (n) => n + " hasn't turned on notifications. Send them the link instead.",
    "unknown-user": () => "No one has that name.",
    "pair-gap": () => "You just poked them. Give it a couple of minutes.",
    "rate-limit": () => "That's a lot of pokes. Try again later.",
    "target-busy": () => "They're getting a lot of pokes right now. Send them the link instead.",
    self: () => "That's your own name.",
    "bad-room": () => "That room isn't open any more.",
    unauthorized: () => "Your name isn't signed in on this device. Pick it again on the home page.",
    offline: () => "Couldn't reach the server.",
  };
  async function poke(to, game, room) {
    const r = await authed("poke", { to: String(to || "").trim(), game: game, room: room });
    if (r.status === 200) return { ok: true, delivered: r.delivered !== false, text: (r.delivered === false ? POKE_TEXT.quiet : POKE_TEXT.ok)(String(to).trim()) };
    const f = POKE_TEXT[r.error] || (() => "That didn't work. Try again.");
    return { ok: false, text: f(String(to).trim()) };
  }

  /* ---------- install ---------- */
  let installEvent = null;
  const installListeners = [];
  global.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    installListeners.forEach((f) => f());
  });
  global.addEventListener("appinstalled", () => { installEvent = null; installListeners.forEach((f) => f()); });
  const standalone = () => (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) || global.navigator.standalone === true;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  async function install() {
    if (!installEvent) return false;
    installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    installEvent = null;
    installListeners.forEach((f) => f());
    return !!choice && choice.outcome === "accepted";
  }

  global.Account = {
    me, check, claim, release, ping, settings, status, poke,
    REASONS, pushSupported, enableNotifications, disableNotifications, registerWorker,
    canInstall: () => !!installEvent && !standalone(),
    needsIOSHint: () => isIOS() && !standalone(),
    onInstallChange: (f) => installListeners.push(f),
    install, standalone,
  };
})(window);
