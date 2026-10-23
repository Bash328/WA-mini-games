// Writes sitemap.xml from the hub page's game cards.
//
// The hub (index.html) is the one place that says which games are published,
// so the sitemap is generated from it rather than kept by hand — a new card
// is in the sitemap as soon as it is on the hub, and a removed game leaves
// with it.
//
//   node tools/gen-sitemap.mjs           rewrite sitemap.xml
//   node tools/gen-sitemap.mjs --check   exit 1 if sitemap.xml is out of date
//
// Pages carrying <meta name="robots" content="noindex"> (privacy) are left
// out: a sitemap may only list pages that are allowed to be indexed.
// lastmod comes from git (the committed date of the page), so a fresh clone
// does not claim every page changed at checkout time.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = process.env.SITE_URL || 'https://wa-minigames.online';
const OUT = path.join(ROOT, 'sitemap.xml');
const check = process.argv.includes('--check');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function gitDate(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const hub = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Every <a class="card" href="game/"> on the hub, in the order the hub shows them.
const games = [];
for (const tag of hub.match(/<a\b[^>]*>/g) || []) {
  if (!/\bclass="[^"]*\bcard\b/.test(tag)) continue;
  const href = (tag.match(/\bhref="([^"]+)"/) || [])[1];
  if (!href || /^https?:/.test(href) || href.startsWith('#') || href === '/') continue;
  const slug = href.replace(/^\.?\//, '').replace(/\/$/, '');
  if (!games.includes(slug)) games.push(slug);
}

const urls = [{ slug: '', loc: ORIGIN + '/', file: 'index.html' }];
for (const slug of games) {
  const file = path.join(slug, 'index.html');
  if (!fs.existsSync(path.join(ROOT, file))) {
    console.warn(`hub links ${slug}/ but ${file} is missing — skipped`);
    continue;
  }
  if (/<meta\s+name="robots"[^>]*content="[^"]*noindex/i.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
    console.warn(`${slug}/ is noindex — left out of the sitemap`);
    continue;
  }
  urls.push({ slug, loc: `${ORIGIN}/${slug}/`, file });
}

const body = urls
  .map((u) => {
    const lastmod = gitDate(u.file);
    return `  <url>\n    <loc>${esc(u.loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`;
  })
  .join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (check) {
  if (old !== xml) {
    console.error('sitemap.xml is out of date: run node tools/gen-sitemap.mjs');
    process.exit(1);
  }
  console.log(`sitemap.xml up to date (${urls.length} URLs)`);
} else if (old === xml) {
  console.log(`sitemap.xml already up to date (${urls.length} URLs)`);
} else {
  fs.writeFileSync(OUT, xml);
  console.log(`wrote sitemap.xml (${urls.length} URLs)`);
}
