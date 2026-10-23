// Every local src / href / url() in a page or stylesheet must point at a file that exists.
// (Moving or renaming a shared file is the usual way to break 58 pages at once; this takes a second.)
//   node tests/links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'docs', 'tests', 'tools', 'worker', '.git', '.wrangler']);
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(html|css)$/.test(e.name)) files.push(p);
  }
})(ROOT);

let checked = 0; const broken = [];
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  const refs = [...s.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).concat([...s.matchAll(/url\((["']?)([^)"']+)\1\)/g)].map((m) => m[2]));
  for (let r of refs) {
    if (/^(https?:|data:|mailto:|tel:|javascript:|\/\/|\?)/.test(r)) continue;
    r = r.split('?')[0].split('#')[0];
    if (!r) continue;
    const target = r.startsWith('/') ? path.join(ROOT, r) : path.join(path.dirname(f), r);
    checked++;
    if (!fs.existsSync(target)) broken.push(path.relative(ROOT, f) + ' -> ' + r);
  }
}
for (const b of broken.slice(0, 30)) console.log('BROKEN  ' + b);
console.log(checked + ' local references in ' + files.length + ' files, ' + broken.length + ' broken');
process.exit(broken.length ? 1 : 0);
