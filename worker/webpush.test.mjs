/* Run: node worker/webpush.test.mjs
   Checks Web Push encryption against the worked example in RFC 8291
   appendix A, round-trips random messages through an independent decrypt
   (the browser's side of the maths), and checks the VAPID token's signature. */
import {
  encryptPayload, vapidJwt, importPair, b64uToBytes, bytesToB64u, allowedEndpoint, cleanSubscription,
} from "./webpush.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); } else { fail++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}
const enc = new TextEncoder(), dec = new TextDecoder();
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

/* ---- RFC 8291 appendix A ---- */
console.log("RFC 8291 worked example:");
{
  const uaPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
  const authSecret = "BTBZMqHH6r4Tts7J_aSIgg";
  const asPrivate = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
  const asPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const salt = "DGv6ra1nlYgDCS1FRnbzlw";
  const want = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
  const asPubRaw = b64uToBytes(asPublic);
  const asKeyPair = { privateKey: await importPair(asPubRaw, b64uToBytes(asPrivate), "ECDH", ["deriveBits"]), publicKey: null };
  const body = await encryptPayload(
    { endpoint: "https://push.example/x", keys: { p256dh: uaPublic, auth: authSecret } },
    enc.encode("When I grow up, I want to be a watermelon"),
    { asKeyPair, asPublicRaw: asPubRaw, salt: b64uToBytes(salt) },
  );
  const got = bytesToB64u(body);
  // the record-size bytes in the RFC text read AAAQAA / the length byte QQ; compare the whole body
  check("the encrypted body is byte-for-byte the RFC's", got === want, "\n   got  " + got + "\n   want " + want);
}

/* ---- round trip through an independent decrypt (the browser's side) ---- */
console.log("\nround trip:");
{
  async function hk(salt, ikm, info, n) {
    const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, n * 8));
  }
  async function browserDecrypt(uaPair, uaPub, auth, body) {
    const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPair.privateKey, 256));
    const ikm = await hk(auth, shared, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
    const cek = await hk(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hk(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
    const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
    return { text: dec.decode(plain.slice(0, plain.length - 1)), delimiter: plain[plain.length - 1] };
  }
  let allOk = true;
  for (let i = 0; i < 25; i++) {
    const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const msg = JSON.stringify({ t: "poke", from: "someone", n: i, pad: "x".repeat(i * 7) });
    const body = await encryptPayload({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: bytesToB64u(uaPub), auth: bytesToB64u(auth) } }, enc.encode(msg));
    const r = await browserDecrypt(ua, uaPub, auth, body);
    if (r.text !== msg || r.delimiter !== 2) { allOk = false; break; }
  }
  check("25 random messages decrypt to exactly what was sent", allOk);
}

/* ---- VAPID ---- */
console.log("\nVAPID:");
{
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const env = { VAPID_PUBLIC_KEY: bytesToB64u(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:test@example.com" };
  const jwt = await vapidJwt("https://fcm.googleapis.com", env, 1_700_000_000_000);
  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(dec.decode(b64uToBytes(c)));
  check("header says ES256", JSON.parse(dec.decode(b64uToBytes(h))).alg === "ES256");
  check("claims name the push service, the subject and a 12 hour expiry", claims.aud === "https://fcm.googleapis.com" && claims.sub === "mailto:test@example.com" && claims.exp === 1_700_000_000 + 43200, JSON.stringify(claims));
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64uToBytes(s), enc.encode(h + "." + c));
  check("the signature verifies with the public key", ok);
}

/* ---- what the server will post to ---- */
console.log("\nendpoints:");
{
  const yes = ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=x"];
  const no = ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/latest", "https://localhost/x", "https://fcm.googleapis.com:8443/x", "not a url"];
  check("real push services are allowed", yes.every((u) => allowedEndpoint(u)));
  check("anything else is refused", no.every((u) => !allowedEndpoint(u)), no.filter((u) => allowedEndpoint(u)).join(" "));
  check("localhost only with the dev switch", !allowedEndpoint("http://localhost:9999/x") && allowedEndpoint("http://localhost:9999/x", { PUSH_ALLOW_LOCAL: "1" }));
  const k = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  check("a good subscription is kept", cleanSubscription({ endpoint: yes[0], keys: k, extra: 1 }) !== null);
  check("bad keys are refused", cleanSubscription({ endpoint: yes[0], keys: { p256dh: "AAAA", auth: k.auth } }) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
