/* Integration test for usernames, push and pokes against a running Worker.
   Needs Node 22+; no dependencies.

   Start the Worker with a push key pair and the two local-only switches:

     node worker/vapid-keys.mjs
     npx wrangler dev --persist-to ../.wrangler-state --port 8788 \
       --var VAPID_PUBLIC_KEY:<public> --var VAPID_PRIVATE_KEY:<private> \
       --var PUSH_ALLOW_LOCAL:1 --var LIVE_ALLOW_NO_ORIGIN:1
     BASE=http://localhost:8788 node worker/users.integration.mjs

   A tiny fake "push service" on localhost receives the notifications, so the
   whole path is exercised: the message is encrypted for a browser key pair
   made here, and this test decrypts it exactly as a browser would. */
import http from "node:http";
import { b64uToBytes, bytesToB64u } from "./webpush.mjs";

const BASE = process.env.BASE || "http://localhost:8787";
const ORIGIN = new URL(BASE).origin;
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); } else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? " — " + detail : "")); }
}
async function post(path, body, origin = ORIGIN) {
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  const res = await fetch(BASE + "/api/user/" + path, { method: "POST", headers, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, ...json };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder(), dec = new TextDecoder();
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

/* ---- the fake push service ---- */
const received = [];
let nextStatus = 201;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => { received.push({ url: req.url, headers: req.headers, body: new Uint8Array(Buffer.concat(chunks)) }); res.statusCode = nextStatus; res.end(); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PUSH_URL = "http://127.0.0.1:" + server.address().port;

/* ---- a "browser": a key pair and an auth secret, and the decrypt side ---- */
async function browser(path) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const subscription = { endpoint: PUSH_URL + path, keys: { p256dh: bytesToB64u(pub), auth: bytesToB64u(auth) } };
  async function hk(salt, ikm, info, n) {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, n * 8));
  }
  async function decrypt(body) {
    const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, pair.privateKey, 256));
    const ikm = await hk(auth, shared, concat(enc.encode("WebPush: info\0"), pub, asPub), 32);
    const key = await crypto.subtle.importKey("raw", await hk(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16), "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: await hk(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12) }, key, ct));
    return JSON.parse(dec.decode(plain.slice(0, plain.length - 1)));
  }
  return { subscription, decrypt };
}

const run = Math.random().toString(36).slice(2, 7);
const nm = (s) => (s + run).slice(0, 16);

console.log("status:");
const st = await (await fetch(BASE + "/api/user/status")).json();
check("push is configured and the public key is shared", st.push === true && typeof st.vapid === "string" && st.vapid.length > 60, JSON.stringify(st));

console.log("\nclaiming names:");
const noOrigin = await post("claim", { name: nm("Noorigin") }, null);
check("a call without the site's Origin is refused (when the dev switch is off it is 403; with it, allowed)", [200, 403].includes(noOrigin.status), noOrigin.status);
const evil = await post("claim", { name: nm("Evil") }, "https://evil.example");
check("a call from another site is refused", evil.status === 403, evil.status);
check("a bad name is refused with a reason", (await post("claim", { name: "no" })).reason === "length");
check("an offensive name is refused", (await post("claim", { name: "sh1thead" })).reason === "offensive");
const aliceName = nm("Alice");
const chk1 = await post("check", { name: aliceName });
check("an unused name is available", chk1.available === true, JSON.stringify(chk1));
const alice = await post("claim", { name: aliceName });
check("claiming gives a name and a secret token", alice.status === 200 && alice.name === aliceName && /^[0-9a-f]{32}$/.test(alice.token), JSON.stringify(alice));
const dup = await post("claim", { name: aliceName.toUpperCase() });
check("the same name again, in any case, is taken", dup.status === 409 && dup.reason === "taken", JSON.stringify(dup));
check("check now says taken", (await post("check", { name: aliceName.toLowerCase() })).available === false);

console.log("\nthe token owns the name:");
check("ping with the token works", (await post("ping", { name: aliceName, token: alice.token })).ok === true);
check("ping with a wrong token is refused", (await post("ping", { name: aliceName, token: "0".repeat(32) })).status === 401);
check("a wrong token cannot release it", (await post("release", { name: aliceName, token: "f".repeat(32) })).status === 401);
const tmpName = nm("Temp");
const tmp = await post("claim", { name: tmpName });
check("releasing with the token frees the name", (await post("release", { name: tmpName, token: tmp.token })).ok === true && (await post("check", { name: tmpName })).available === true);

console.log("\npush subscriptions:");
const bobName = nm("Bobby");
const bob = await post("claim", { name: bobName });
const bobBrowser = await browser("/bob");
check("a subscription pointing at an internal address is refused", (await post("push", { name: bobName, token: bob.token, subscription: { endpoint: "https://169.254.169.254/x", keys: bobBrowser.subscription.keys } })).status === 400);
check("a subscription for a real push service host that isn't one is refused", (await post("push", { name: bobName, token: bob.token, subscription: { endpoint: "https://evil.example/x", keys: bobBrowser.subscription.keys } })).status === 400);
const sub1 = await post("push", { name: bobName, token: bob.token, subscription: bobBrowser.subscription });
check("a good subscription is stored", sub1.ok === true && sub1.push === true, JSON.stringify(sub1));

console.log("\npoking:");
const room = await (await fetch(BASE + "/api/live/create", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ game: "tic-tac-toe" }) })).json();
check("(a live room to poke into)", /^[A-HJ-NP-Z2-9]{6}$/.test(room.room), JSON.stringify(room));
const poke = (over = {}) => post("poke", { name: aliceName, token: alice.token, to: bobName, game: "tic-tac-toe", room: room.room, ...over });
check("poking with a wrong token is refused", (await post("poke", { name: aliceName, token: "0".repeat(32), to: bobName, game: "tic-tac-toe", room: room.room })).status === 401);
check("poking someone who doesn't exist says so", (await poke({ to: nm("Nobody") })).status === 404);
check("poking into a room that doesn't exist is refused", (await poke({ room: "AAAAAA" })).status === 400);
check("poking into a game that can't be played live is refused", (await poke({ game: "chess" })).status === 400);
check("you cannot poke yourself", (await post("poke", { name: aliceName, token: alice.token, to: aliceName, game: "tic-tac-toe", room: room.room })).status === 400);
received.length = 0;
const p1 = await poke();
check("a poke is accepted and reported delivered", p1.ok === true && p1.delivered === true, JSON.stringify(p1));
await sleep(300);
check("the push service got exactly one message", received.length === 1, received.length);
const msg = received[0];
check("it is addressed to the stored subscription", msg && msg.url === "/bob");
check("it carries a VAPID authorization and aes128gcm encoding", msg && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(msg.headers.authorization) && msg.headers["content-encoding"] === "aes128gcm", msg && msg.headers.authorization);
const payload = msg ? await bobBrowser.decrypt(msg.body) : null;
check("only Bob's browser key can read it, and it says who and where", payload && payload.from === aliceName && payload.game === "tic-tac-toe" && payload.url === "/tic-tac-toe/?live=" + room.room, JSON.stringify(payload));
check("the same two people again straight away: rate limited", (await poke()).status === 429);

console.log("\nblocks and mutes are silent:");
received.length = 0;
const carolName = nm("Carol");
const carol = await post("claim", { name: carolName });
const carolB = await browser("/carol");
await post("push", { name: carolName, token: carol.token, subscription: carolB.subscription });
await post("settings", { name: carolName, token: carol.token, block: aliceName });
const pc = await post("poke", { name: aliceName, token: alice.token, to: carolName, game: "tic-tac-toe", room: room.room });
await sleep(300);
check("a blocked sender is told it was delivered", pc.ok === true && pc.delivered === true, JSON.stringify(pc));
check("but nothing was pushed", received.length === 0);
await post("settings", { name: carolName, token: carol.token, unblock: aliceName, muted: true });
check("a muted person gets nothing either", (await post("poke", { name: aliceName, token: alice.token, to: carolName, game: "tic-tac-toe", room: room.room })).status === 429 || received.length === 0);
const daveName = nm("Dave");
const dave = await post("claim", { name: daveName });
const pd = await post("poke", { name: aliceName, token: alice.token, to: daveName, game: "tic-tac-toe", room: room.room });
check("someone with no notifications set up is reported as not delivered", pd.ok === true && pd.delivered === false, JSON.stringify(pd));

console.log("\nunsubscribed browsers are forgotten:");
const eveName = nm("Evey");
const eve = await post("claim", { name: eveName });
const eveB = await browser("/eve");
await post("push", { name: eveName, token: eve.token, subscription: eveB.subscription });
nextStatus = 410;
const pe = await post("poke", { name: aliceName, token: alice.token, to: eveName, game: "tic-tac-toe", room: room.room });
nextStatus = 201;
check("a 410 from the push service reports not delivered", pe.ok === true && pe.delivered === false, JSON.stringify(pe));
check("and the dead subscription is dropped", (await post("ping", { name: eveName, token: eve.token })).push === false);

console.log("\nsettings:");
const s = await post("settings", { name: bobName, token: bob.token, muted: true, block: "someone" });
check("mute and block are stored and reported back", s.muted === true && s.blocked.includes("someone"), JSON.stringify(s));
check("a push of null removes the subscription", (await post("push", { name: bobName, token: bob.token, subscription: null })).push === false);

server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
