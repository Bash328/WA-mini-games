// Serve the site from this folder, to try the games by hand before a deploy.
//
//   node tools/serve.mjs                 http://localhost:8080/   (this computer only)
//   node tools/serve.mjs --phone         also opens a window the size of an iPhone 14 (390x844) with touch and a phone user agent
//   node tools/serve.mjs --lan           also reachable from a phone on the same Wi-Fi (prints the address)
//   node tools/serve.mjs --port 9000
//
// It is a plain static server: pages, taps, drags, saved progress and the computer opponents all work, but the live online
// rooms and link previews need the Cloudflare Worker, so they do not run here. Stop it with Ctrl+C (or close the phone window).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (n) => args.includes('--' + n);
const PORT = Number(args[args.indexOf('--port') + 1]) || 8080;
const HOST = has('lan') ? '0.0.0.0' : '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || /(^|[\\/])(\.git|node_modules|\.wrangler)([\\/]|$)/.test(f) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });   // always fresh: you are testing edits
  fs.createReadStream(f).pipe(res);
});
srv.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is already in use: try --port ' + (PORT + 1) : e.message); process.exit(1); });
srv.listen(PORT, HOST, async () => {
  console.log('Serving ' + ROOT + '\n  on this computer:  http://localhost:' + PORT + '/');
  if (has('lan')) for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log('  on your Wi-Fi:     http://' + i.address + ':' + PORT + '/   (anyone on the network can open it while this runs)');
  if (!has('phone')) return;
  const { chromium, devices } = await import('playwright');
  const exe = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((x) => x && fs.existsSync(x));
  const browser = await chromium.launch({ headless: false, executablePath: exe });
  const ctx = await browser.newContext({ ...devices['iPhone 14'], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:' + PORT + '/');
  console.log('  phone window open (390x844, touch). Close it to stop the server.');
  browser.on('disconnected', () => { srv.close(); process.exit(0); });
});
