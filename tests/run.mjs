// One command for the whole test suite, fastest check first, stopping nothing early so you see every failure.
//
//   node tests/run.mjs units      static checks + Node unit tests                      (seconds)
//   node tests/run.mjs changed    units + browser checks for the games you changed     (about a minute)
//   node tests/run.mjs quick      units + browser smoke pass, 2 sample pages per check (about 2 minutes)
//   node tests/run.mjs            units + the full browser suite: the gate before a deploy
//
// Anything after the tier goes to tests/regression.mjs (--jobs 8, --only chess, --slow ...).
// Unit tests are every *.test.mjs in the repo; they live next to the code they test.

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const [first, ...rest] = process.argv.slice(2);
const TIERS = ['units', 'changed', 'quick', 'full'];
const tier = TIERS.includes(first) ? first : 'full';
const passThrough = TIERS.includes(first) ? rest : process.argv.slice(2);

const run = (cmd, args) => new Promise((resolve) => {
  const t = Date.now(); let out = '';
  const p = spawn(process.execPath, [...cmd, ...args], { cwd: ROOT });
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out, ms: Date.now() - t }));
});
const tail = (s, n = 12) => s.trim().split('\n').slice(-n).join('\n      ');
let failures = 0;
const report = (name, r, detail) => {
  console.log((r.code ? 'FAIL  ' : 'ok    ') + name.padEnd(34) + (r.ms / 1000).toFixed(1).padStart(6) + 's' + (detail ? '  ' + detail : ''));
  if (r.code) { failures++; console.log('      ' + tail(r.out)); }
};
const t0 = Date.now();

// 1. static checks: instant, no browser
console.log('static checks');
for (const [name, cmd] of [
  ['cache stamps', ['tests/cache-bust.mjs', '--check']],
  ['sitemap', ['tools/gen-sitemap.mjs', '--check']],
  ['local links', ['tests/links.mjs']],
  ['agent memory log', ['tools/memory/append-event.mjs', '--check']],
]) { const r = await run([cmd[0]], cmd.slice(1)); report(name, r, r.out.trim().split('\n').pop().slice(0, 60)); }

// 2. unit tests: every *.test.mjs, in parallel
const tests = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.wrangler') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.test.mjs')) tests.push(path.relative(ROOT, p));
  }
})(ROOT);
console.log('\nunit tests (' + tests.length + ' files)');
const queue = tests.slice(), done = [];
await Promise.all(Array.from({ length: Math.min(8, os.cpus().length) }, async () => {
  while (queue.length) { const f = queue.shift(); done.push({ f, ...(await run([f], [])) }); }
}));
const ut = Date.now();
for (const r of done.filter((d) => d.code)) { failures++; console.log('FAIL  ' + r.f + '\n      ' + tail(r.out)); }
console.log((done.every((d) => !d.code) ? 'ok    ' : 'FAIL  ') + done.filter((d) => !d.code).length + '/' + done.length + ' files pass   slowest: ' +
  done.sort((a, b) => b.ms - a.ms).slice(0, 3).map((d) => path.basename(d.f) + ' ' + (d.ms / 1000).toFixed(1) + 's').join(', '));

// 3. browser checks
if (tier !== 'units') {
  let args = ['tests/regression.mjs'];
  if (tier === 'quick') args.push('--quick');
  if (tier === 'changed') {
    const changed = execSync('git status --porcelain', { encoding: 'utf8' }).split('\n').map((l) => l.slice(3).trim().replace(/^.* -> /, '').replace(/"/g, '')).filter(Boolean);
    const games = new Set(), shared = [];
    for (const f of changed) {
      const top = f.split('/')[0];
      if (fs.existsSync(path.join(top, 'index.html')) && f.includes('/')) games.add(top);
      else if (/^(shared|assets)\//.test(f) || f === 'index.html' || f === 'tests/regression.mjs') shared.push(f);
    }
    if (shared.length) { console.log('\nshared files changed (' + shared.slice(0, 3).join(', ') + (shared.length > 3 ? ', ...' : '') + '): quick pass on every check'); args.push('--quick'); }
    else if (games.size) { console.log('\nchanged games: ' + [...games].join(', ')); args.push('--page', [...games].join(',')); }
    else { console.log('\nno game or shared file changed: browser checks skipped'); args = null; }
  }
  if (args) {
    console.log('\nbrowser checks (' + args.slice(1).join(' ') + ' ' + passThrough.join(' ') + ')');
    const code = await new Promise((resolve) => spawn(process.execPath, [...args, ...passThrough], { cwd: ROOT, stdio: 'inherit' }).on('close', resolve));
    if (code) failures++;
  }
}
console.log('\n' + (failures ? failures + ' step(s) FAILED' : 'all steps passed') + ' in ' + Math.round((Date.now() - t0) / 1000) + 's (' + tier + ')');
process.exit(failures ? 1 : 0);
