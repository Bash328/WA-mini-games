/* ============================================================
   users.mjs — the rules for usernames and pokes, as pure functions.

   There are no accounts, no passwords and no email. A player picks a name;
   the server keeps one record per name and gives back a secret token, which
   the browser keeps (like a room's seat token). Whoever holds the token owns
   the name. Lose the token and the name is simply gone: that is the price of
   having nothing to recover it with, and it is what keeps this "accounts-lite".

   user-registry.mjs (the Durable Object) is a thin shell around this file,
   exactly as live-room.mjs is around live-protocol.mjs.

   A record:
     { name, key, th: sha256(token), created, seen,
       sub: push subscription | null, muted: bool, blocked: [key...],
       out: [timestamps of pokes this user sent, last hour],
       to:  { key: timestamp of the last poke sent to that user },
       inn: [timestamps of pokes this user received, last hour] }
   ============================================================ */

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const STALE_MS = 90 * 24 * 60 * 60 * 1000;     // a name unused this long is freed
export const POKES_OUT_PER_HOUR = 10;                 // one person can only send so many
export const POKES_IN_PER_HOUR = 20;                  // and receive so many
export const POKE_PAIR_GAP_MS = 2 * 60 * 1000;        // the same two people: one poke every 2 minutes
export const MAX_BLOCKED = 100;
const HOUR = 60 * 60 * 1000;

const RESERVED = new Set([
  "admin", "administrator", "support", "moderator", "mod", "staff", "official", "system", "root",
  "claude", "anthropic", "wagames", "minigames", "null", "undefined", "everyone", "anonymous", "guest", "nobody",
]);
// Matched as substrings after lower-casing, dropping underscores and undoing
// common look-alike digits, so "F_u_c_k" and "sh1t" are caught too.
const OFFENSIVE = [
  "fuck", "shit", "cunt", "nigg", "fagg", "rape", "rapist", "nazi", "hitler", "porn", "dick", "cock", "pussy",
  "slut", "whore", "bitch", "asshole", "penis", "vagina", "kkk", "retard", "tranny", "jihad", "genocide",
];

export const nameKey = (name) => String(name).toLowerCase();

const unleet = (s) => s.toLowerCase().replace(/_/g, "").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e")
  .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/8/g, "b");

/* Is this an acceptable name? { ok, name, key } or { ok:false, reason } where
   reason is one of: type, length, chars, reserved, offensive. */
export function checkName(raw) {
  if (typeof raw !== "string") return { ok: false, reason: "type" };
  const name = raw.trim();
  if (name.length < 3 || name.length > 16) return { ok: false, reason: "length" };
  if (!NAME_RE.test(name)) return { ok: false, reason: "chars" };
  if (!/[A-Za-z]/.test(name)) return { ok: false, reason: "chars" };       // at least one letter
  const key = nameKey(name);
  if (RESERVED.has(key.replace(/_/g, ""))) return { ok: false, reason: "reserved" };
  const plain = unleet(name);
  if (OFFENSIVE.some((w) => plain.includes(w))) return { ok: false, reason: "offensive" };
  return { ok: true, name, key };
}

export const REASON_TEXT = {
  type: "Pick a name.",
  length: "Names are 3 to 16 characters.",
  chars: "Use letters, numbers and _ only, with at least one letter.",
  reserved: "That name is reserved. Pick another.",
  offensive: "That name isn't allowed. Pick another.",
  taken: "That name is taken. Pick another.",
};

/* ---------- tokens ---------- */

export function newToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function hashToken(token) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}
// Hashes are the same length, so a plain loop that never exits early is constant-time enough.
export function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- records ---------- */

export function newRecord(name, tokenHash, now) {
  return { name, key: nameKey(name), th: tokenHash, created: now, seen: now, sub: null, muted: false, blocked: [], out: [], to: {}, inn: [] };
}
export const isStale = (rec, now) => now - rec.seen > STALE_MS;

/* What a player may see of their own record. */
export function profile(rec) {
  return { name: rec.name, push: !!rec.sub, muted: rec.muted, blocked: rec.blocked };
}

/* ---------- blocking ---------- */

export function block(rec, otherName) {
  const c = checkName(otherName);
  const key = c.ok ? c.key : nameKey(String(otherName || "").trim());
  if (!key || key === rec.key) return false;
  if (rec.blocked.includes(key)) return true;
  if (rec.blocked.length >= MAX_BLOCKED) return false;
  rec.blocked.push(key);
  return true;
}
export function unblock(rec, otherName) {
  const key = nameKey(String(otherName || "").trim());
  rec.blocked = rec.blocked.filter((k) => k !== key);
}

/* ---------- pokes ----------
   Can `from` poke `target` right now? The limits protect people from being
   spammed: a cap on what one person sends, a cap on what one person gets,
   and a gap between pokes from the same sender to the same person.
   Returns { ok: true } or { ok: false, reason } with reason:
     self | rate-limit | pair-gap | target-busy
   Being blocked or muted is NOT a reason here: the sender is never told
   (see canDeliver), so nobody can probe who blocked them. */
export function pokeAllowed(from, target, now) {
  if (from.key === target.key) return { ok: false, reason: "self" };
  from.out = from.out.filter((t) => now - t < HOUR);
  target.inn = target.inn.filter((t) => now - t < HOUR);
  if (from.out.length >= POKES_OUT_PER_HOUR) return { ok: false, reason: "rate-limit" };
  const last = from.to[target.key] || 0;
  if (now - last < POKE_PAIR_GAP_MS) return { ok: false, reason: "pair-gap" };
  if (target.inn.length >= POKES_IN_PER_HOUR) return { ok: false, reason: "target-busy" };
  return { ok: true };
}
/* Record that a poke was attempted (counts against the limits either way). */
export function notePoke(from, target, now) {
  from.out.push(now);
  from.to[target.key] = now;
  // forget old pair entries so the record stays small
  for (const k of Object.keys(from.to)) if (now - from.to[k] > HOUR) delete from.to[k];
  target.inn.push(now);
}
/* Will the poke actually be pushed? A muted or blocking target silently
   doesn't get it. */
export function canDeliver(from, target) {
  return !target.muted && !target.blocked.includes(from.key) && !!target.sub;
}

export const POKE_GAMES_TITLE = (slug) => String(slug).replace(/-/g, " ");
