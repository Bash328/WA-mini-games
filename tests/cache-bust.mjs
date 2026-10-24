// Stamps every script and stylesheet a redesigned ("fun") page loads with ?v=<hash of the file>.
//
// Why: the host lets a phone show the OLD copy of a script or stylesheet once after a deploy (it caches them
// for 10 minutes and revalidates in the background). The HTML itself is never cached, so a changed ?v= in the
// HTML makes the phone fetch the new file straight away. A hash means you cannot forget to bump it:
//
//   node tests/cache-bust.mjs        rewrite the ?v= on every fun page   (run before every deploy)
//   node tests/cache-bust.mjs --check   only report pages that are out of date (the regression test does this)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
// scripts and styles, plus the hub's art sprite (assets/hub-art.svg?v=<hash>#art-<game>, so a #fragment may follow)
const REF = /((?:src|href)=")((?:\.\.\/)?[\w./-]+?(?:\.(?:js|css)|hub-art\.svg))(\?v=[\w]+)?(#[\w-]+)?(")/g;

let stale = 0;
// the redesigned game pages, and the hub (the root index.html)
const pages = [{ name: '', dir: ROOT }, ...fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ name: d.name, dir: path.join(ROOT, d.name) }))];
for (const dir of pages) {
  const page = path.join(dir.dir, 'index.html');
  if (!fs.existsSync(page)) continue;
  const html = fs.readFileSync(page, 'utf8');
  if (!html.includes('fun.css')) continue;                       // only the redesigned pages
  const out = html.replace(REF, (m, a, p, v, frag, z) => {
    const file = path.join(dir.dir, p);
    if (!fs.existsSync(file) || /^https?:/.test(p)) return m;
    return a + p + '?v=' + hash(file) + (frag || '') + z;
  });
  if (out !== html) {
    stale++;
    if (check) console.log('out of date: ' + (dir.name || '(hub)') + '/index.html');
    else { fs.writeFileSync(page, out); console.log('stamped ' + (dir.name || '(hub)') + '/index.html'); }
  }
}
if (check) process.exit(stale ? 1 : 0);
console.log(stale ? '' : 'all fun pages already up to date');
