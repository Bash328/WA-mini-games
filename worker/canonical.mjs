/* ============================================================
   canonical.mjs — one host, not two.

   The Worker answers on both wa-minigames.online and
   www.wa-minigames.online, and without this each served its own full,
   independently indexable copy of every page. The apex is the canonical
   one: it is what CNAME, the README, and every move-link already sent on
   WhatsApp use, so redirecting www to it breaks nothing in flight.

   No Cloudflare APIs here, so the rules are testable under plain node.
   ============================================================ */

/* Returns the URL to redirect to, or null to serve the request as-is.

   Rebuilding from a parsed URL rather than string-editing keeps the path
   and the query string exactly as they arrived — which matters more here
   than usual, because ?s= IS the game. A www move-link has to land on the
   right board with its state intact. */
export function canonicalRedirect(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch (e) {
    return null;
  }
  if (!url.hostname.startsWith("www.")) return null;
  url.hostname = url.hostname.slice(4);
  return url.toString();
}
