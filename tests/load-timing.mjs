// Per-page navigation-to-board-ready timing and script/style weight.
//
//   node tests/load-timing.mjs             all game pages, 390x844
//   node tests/load-timing.mjs --top 15    show more rows
//
// Serves the repo itself and drives Chrome with Playwright (the same setup as
// regression.mjs). "Board ready" means: load event fired, the shared panel is
// in the DOM, and two animation frames have been painted. The budget is a
// local-server budget: 1200 ms navigation-to-ready and 700 KB of decoded
// script + style. A page over either budget fails this check.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? Number(args[i + 1]) : d; };
const TOP = opt('top', 10);
const READY_BUDGET_MS = 1200;
const BYTES_BUDGET = 700 * 1024;

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, r));
const base = 'http://localhost:' + srv.address().port + '/';

const chrome = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
  '/usr/bin/chromium'].filter(Boolean).find((x) => fs.existsSync(x));
const browser = await chromium.launch({ executablePath: chrome });
const games = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'index.html')) && fs.existsSync(path.join(ROOT, d.name, 'game.js')))
  .map((d) => d.name).sort();

const rows = [];
for (const game of games) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base + game + '/', { waitUntil: 'load' });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const r = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const bytes = res.filter((e) => e.initiatorType === 'script' || e.initiatorType === 'link' || /\.(js|css)(\?|$)/.test(e.name))
      .reduce((n, e) => n + (e.decodedBodySize || 0), 0);
    return { ready: Math.round(performance.now()), load: Math.round(nav ? nav.loadEventEnd : 0), bytes, panel: !!document.querySelector('.panel') };
  });
  rows.push({ game, ...r, errs });
  await page.close();
}
await browser.close();
srv.close();

rows.sort((a, b) => b.ready - a.ready);
console.log('game pages: ' + rows.length + ' (390x844, local server)');
console.log('slowest navigation-to-board-ready:');
for (const r of rows.slice(0, TOP)) {
  console.log('  ' + String(r.ready).padStart(4) + ' ms  ' + (r.bytes / 1024).toFixed(0).padStart(4) + ' KB  ' + r.game + (r.panel ? '' : '  (no .panel)'));
}
const overTime = rows.filter((r) => r.ready > READY_BUDGET_MS);
const overBytes = rows.filter((r) => r.bytes > BYTES_BUDGET);
const errors = rows.filter((r) => r.errs.length || !r.panel);
let bad = 0;
if (overTime.length) { bad += overTime.length; console.log('over ' + READY_BUDGET_MS + ' ms: ' + overTime.map((r) => r.game + ' ' + r.ready + 'ms').join(', ')); }
if (overBytes.length) { bad += overBytes.length; console.log('over ' + (BYTES_BUDGET / 1024) + ' KB: ' + overBytes.map((r) => r.game + ' ' + (r.bytes / 1024).toFixed(0) + 'KB').join(', ')); }
for (const r of errors) console.log('problem: ' + r.game + (r.panel ? '' : ' no .panel') + (r.errs.length ? ' errors: ' + r.errs.join('; ') : ''));
if (bad) process.exit(1);
console.log('all pages within ' + READY_BUDGET_MS + ' ms and ' + (BYTES_BUDGET / 1024) + ' KB');
