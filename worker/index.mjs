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

import { ogFor } from "./og-text.mjs";
import { canonicalRedirect } from "./canonical.mjs";

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

export default {
  async fetch(request, env) {
    // Before anything else, and before touching the assets: www and the
    // apex were each serving their own indexable copy of every page.
    const canonical = canonicalRedirect(request.url);
    if (canonical) return Response.redirect(canonical, 301);

    const res = await env.ASSETS.fetch(request);

    // Only HTML is worth rewriting, and only when the link carries state.
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return res;

    const url = new URL(request.url);
    const og = ogFor(url.pathname, url.searchParams.get("s"));
    if (!og) return res;

    // A preview varies with ?s=, so a cache keyed on the path alone would
    // hand every player the first player's preview.
    const out = new Response(res.body, res);
    out.headers.append("Vary", "Accept");
    out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");

    return new HTMLRewriter()
      .on('meta[property="og:title"]', new MetaRewriter(og))
      .on('meta[property="og:description"]', new MetaRewriter(og))
      .on("title", new TitleRewriter(og))
      .transform(out);
  },
};
