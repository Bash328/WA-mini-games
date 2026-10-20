/* Make the key pair Web Push needs. Run once:

     node worker/vapid-keys.mjs

   It prints two values. Put the PUBLIC one in wrangler.toml (VAPID_PUBLIC_KEY)
   and give the PRIVATE one to Cloudflare as a secret, never in a file:

     npx wrangler secret put VAPID_PRIVATE_KEY

   Keep the private key: replacing it later makes every saved subscription stop
   working until each person turns notifications on again. */
import { bytesToB64u } from "./webpush.mjs";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
console.log("VAPID_PUBLIC_KEY  (wrangler.toml):  " + bytesToB64u(pub));
console.log("VAPID_PRIVATE_KEY (secret):         " + jwk.d);
