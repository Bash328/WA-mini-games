/* ============================================================
   webpush.mjs — send a Web Push message from a Worker, with no library.

   Two standards, both done with the platform's WebCrypto:
     RFC 8291  message encryption (aes128gcm): the payload is encrypted so
               only the subscribed browser can read it, even though it travels
               through Google's / Mozilla's / Apple's push service.
     RFC 8292  VAPID: a signed token proving the message comes from this site,
               made with a key pair that belongs to the site (see README).

   webpush.test.mjs checks the encryption against the worked example in
   RFC 8291 appendix A, and round-trips it through an independent decrypt.
   ============================================================ */

const enc = new TextEncoder();

export function b64uToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function bytesToB64u(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// HKDF (extract + expand in one step), SHA-256.
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/* An ECDH / ECDSA key pair from raw bytes: the 65-byte public point and the
   32-byte private scalar. Used by the tests, and for the VAPID key. */
export async function importPair(pub65, d32, name, usages) {
  const jwk = { kty: "EC", crv: "P-256", x: bytesToB64u(pub65.slice(1, 33)), y: bytesToB64u(pub65.slice(33, 65)), d: bytesToB64u(d32) };
  const alg = { name, namedCurve: "P-256" };
  return crypto.subtle.importKey("jwk", jwk, alg, false, usages);
}

/* Encrypt `plaintext` (bytes) for a browser's push subscription
   { endpoint, keys: { p256dh, auth } }. Returns the request body.
   opts.asKeyPair / opts.salt are only for the test vector. */
export async function encryptPayload(sub, plaintext, opts = {}) {
  const uaPub = b64uToBytes(sub.keys.p256dh);
  const auth = b64uToBytes(sub.keys.auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || auth.length !== 16) throw new Error("bad subscription keys");

  const as = opts.asKeyPair || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = opts.asPublicRaw || new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));

  const ikm = await hkdf(auth, shared, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // One record: the data, then 0x02 (the "last record" delimiter), then the AEAD tag.
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  // header: salt(16) | record size 4096 (4 bytes) | key id length (1) | our public key (65)
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([65]), asPub, sealed);
}

/* The VAPID token for a push service origin, signed with the site's key.
   env: VAPID_PUBLIC_KEY (base64url, 65 bytes), VAPID_PRIVATE_KEY (base64url,
   32 bytes), VAPID_SUBJECT ("mailto:you@example.com" or the site URL). */
export async function vapidJwt(audience, env, now = Date.now()) {
  const key = await importPair(b64uToBytes(env.VAPID_PUBLIC_KEY), b64uToBytes(env.VAPID_PRIVATE_KEY), "ECDSA", ["sign"]);
  const head = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({
    aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:admin@example.com",
  })));
  // WebCrypto returns r||s, which is exactly the JWT (ES256) signature form.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims)));
  return head + "." + claims + "." + bytesToB64u(sig);
}

export const pushConfigured = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/* Only the real push services. The endpoint comes from a browser (so from
   anyone), and this server will POST to it, so it must not be able to point
   at an internal address. PUSH_ALLOW_LOCAL=1 (local dev only) also allows
   http://localhost for the tests. */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
export function allowedEndpoint(endpoint, env = {}) {
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  if (env.PUSH_ALLOW_LOCAL === "1" && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
  return u.protocol === "https:" && !u.port && PUSH_HOSTS.test(u.hostname);
}

/* A push subscription as the browser gives it, or null if it isn't one. */
export function cleanSubscription(raw, env = {}) {
  if (!raw || typeof raw !== "object") return null;
  const { endpoint, keys } = raw;
  if (typeof endpoint !== "string" || endpoint.length > 600 || !allowedEndpoint(endpoint, env)) return null;
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  try {
    if (b64uToBytes(keys.p256dh).length !== 65 || b64uToBytes(keys.auth).length !== 16) return null;
  } catch (e) { return null; }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/* Send one message (a small JSON-able object). Returns
   { ok, gone, status }: gone means the browser has unsubscribed, so the
   caller should forget the subscription. */
export async function sendPush(sub, payload, env, fetchImpl = fetch) {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
  const jwt = await vapidJwt(new URL(sub.endpoint).origin, env);
  const res = await fetchImpl(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC_KEY,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "600",
      Urgency: "high",
    },
    body: body,
  });
  return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
}
