// Regression checks for the layout / look problems that have already been found and fixed on the
// redesigned ("fun") game pages. Every fixed issue gets a check here, so it cannot quietly come back.
//
//   node tests/regression.mjs                 run everything
//   node tests/regression.mjs --only overflow run the checks whose id contains "overflow"
//   node tests/regression.mjs --page chess    only look at one game
//
// Needs Playwright and Chrome:  npm i --no-save playwright   (node_modules is git-ignored)
// Chrome is found at the usual Windows / macOS / Linux paths, or set CHROME=/path/to/chrome.
// The script serves the repo root itself; nothing else has to be running.
//
// ADDING A CHECK: when you fix an issue, add a check() below that fails on the old behaviour and passes
// on the fix, with the issue written in `issue`. Pages that are new to the fun look go in the lists.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('only'), PAGE = opt('page');

/* ---------- pages ---------- */
// pages with the steady layout (data-fun-zone): message zone, Options popover, board in a fixed place
const ZONE = ['chess', 'checkers', 'tic-tac-toe', 'reversi', 'connect-four', 'backgammon', 'dots-and-boxes', 'mancala', '2048', 'minesweeper', 'memory', 'water-sort', 'hangman'];
const FUN = [...ZONE, 'crazy-8', 'word-guess'];
// what to measure as "the board" on each page (default #board)
// pages whose first thing is a form (hangman: set the secret word) may start lower
const MAXTOP = { hangman: 520 };
const BOARD = { 'water-sort': '#tubes', hangman: '#gallows' };
// put a page into the state a player sees mid-game
const SOLO = { chess: "var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'))" };
// make a page show its end-of-game text the way the game itself writes it
const END = {
  chess: "document.getElementById('status').textContent='Checkmate. You win! '+Gamekit.taunt('win')",
  checkers: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'tic-tac-toe': "document.getElementById('status').textContent='Draw. '+Gamekit.taunt('draw')",
  reversi: "document.getElementById('status').textContent='Black wins. '+Gamekit.taunt('loss')",
  'connect-four': "document.getElementById('status').textContent='Computer wins. '+Gamekit.taunt('loss')",
  backgammon: "document.getElementById('status').textContent='Computer wins. '+Gamekit.taunt('loss')",
  'dots-and-boxes': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  mancala: "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  2048: "document.getElementById('over-msg').textContent='· Game over. '+Gamekit.taunt('over-normal')",
  minesweeper: "document.getElementById('status').textContent='Boom. '+Gamekit.taunt('boom')",
  memory: "document.getElementById('status').textContent='You won! Done in 14 moves, 12s. '+Gamekit.taunt('win')",
  'water-sort': "document.getElementById('status').textContent='You won! Sorted in 20 moves. '+Gamekit.taunt('win')",
  hangman: "document.getElementById('status').textContent='Player 1 wins. The word was not guessed in time. '+Gamekit.taunt('loss')",
};

/* ---------- harness ---------- */
const results = [];
const checks = [];
function check(id, issue, fn, pages) { checks.push({ id, issue, fn, pages }); }
const wantPage = (g) => !PAGE || PAGE === g;

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r(srv)));
}
function chromePath() {
  const c = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
  return c.find((x) => fs.existsSync(x));
}

const srv = await serve();
const base = 'http://localhost:' + srv.address().port + '/';
const browser = await chromium.launch({ executablePath: chromePath() });

async function open(game, width = 390, setup) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push(e.message));
  await page.goto(base + game + '/');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');            // the how-to window opens by itself the first time
  if (setup) { await page.evaluate(setup); await page.waitForTimeout(400); }
  return page;
}
const top = (page, game) => page.evaluate((s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : -1; }, BOARD[game] || '#board');

/* ---------- the checks ---------- */

check('no-sideways-scroll', 'a page that is wider than the phone lets you drag it sideways (waiting page pill, check pill, header at 320px)', async (g) => {
  const bad = [];
  for (const w of [320, 360, 375, 390, 430]) {
    const p = await open(g, w);
    // the longest things the pill ever says
    await p.evaluate(() => { try { Gamekit.turn(2, 'Waiting for your opponent', true); } catch (e) {} });
    await p.waitForTimeout(150);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw > w) bad.push(w + 'px page is ' + sw + 'px wide');
    await p.close();
  }
  return bad;
}, FUN);

check('board-steady', 'the board jumped down when Options opened, or sat far down on pages with nothing above it', async (g) => {
  const p = await open(g);
  const bad = [];
  const t0 = await top(p, g);
  if (await p.locator('.gk-optbtn').count()) {
    await p.locator('.gk-optbtn').click(); await p.waitForTimeout(250);
    const open_ = await top(p, g);
    await p.locator('.gk-optbtn').click(); await p.waitForTimeout(250);
    const closed = await top(p, g);
    if (open_ !== t0) bad.push('board moved ' + (open_ - t0) + 'px when Options opened');
    if (closed !== t0) bad.push('board did not come back after Options closed');
  } else bad.push('no Options button');
  if (t0 > (MAXTOP[g] || 360)) bad.push('board starts ' + t0 + 'px down: too much empty space above it');
  const modes = await p.evaluate(() => [...document.querySelectorAll('#mode option')].map((o) => o.value).filter((v) => v !== 'live'));
  for (const m of modes) {
    await p.evaluate((v) => { const s = document.querySelector('#mode'); s.value = v; s.dispatchEvent(new Event('change')); }, m);
    await p.waitForTimeout(400);
    const t = await top(p, g);
    if (t !== t0) bad.push('board is ' + t + 'px in "' + m + '" mode but ' + t0 + 'px at start');
  }
  await p.close();
  return bad;
}, ZONE);

check('options-toggle', 'pressing Options while the menus are showing did not hide them', async (g) => {
  const p = await open(g);
  const vis = () => p.evaluate(() => !document.body.classList.contains('gk-play'));
  const a = await vis();
  await p.locator('.gk-optbtn').click(); const b = await vis();
  await p.locator('.gk-optbtn').click(); const c = await vis();
  await p.close();
  return b === a || c !== a ? ['Options does not toggle (start ' + a + ', after one press ' + b + ', after two ' + c + ')'] : [];
}, ZONE);

check('game-over-card', 'a result and its taunt showed in a small strip that overlapped Options; the card replaces it', async (g) => {
  const p = await open(g, 390, SOLO[g]);
  await p.evaluate(END[g]); await p.waitForTimeout(800);
  const bad = [];
  if (!(await p.locator('.gk-over').count())) bad.push('no game over card after the result text');
  else {
    const h2 = (await p.locator('.gk-over h2').textContent()).trim().toLowerCase();
    const big = (await p.locator('.gk-over .big').count()) ? (await p.locator('.gk-over .big').textContent()).trim().toLowerCase().replace(/[^a-z ]/g, '') : '';
    if (big && big === h2.replace(/[^a-z ]/g, '')) bad.push('headline repeated twice');
    if (!(await p.locator('.gk-over .again').count()) || !(await p.locator('.gk-over .home').count())) bad.push('missing Play again / Home');
    if (await p.locator('.gk-over').evaluate((e) => /[\u{1F300}-\u{1FAFF}]/u.test(e.textContent))) bad.push('emoji on the card');
    await p.locator('.gk-over .view').click();
    if (await p.locator('.gk-over').count()) bad.push('View board did not close the card');
  }
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) bad.push('card made the page wider');
  await p.close();
  return bad;
}, ZONE.filter((g) => END[g]));

check('taunt-strip-clear-of-options', 'a mid-game taunt strip overlapped the Options button', async (g) => {
  const p = await open(g, 390, SOLO[g]);
  await p.evaluate(() => { const l = Gamekit.taunt('confidence'); const s = document.getElementById('status'); if (s) s.textContent = 'Your turn. ' + l; });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const o = document.querySelector('.gk-optbtn'), m = document.querySelector('.gk-msg'); if (!o || !m || m.hidden) return null; const a = o.getBoundingClientRect(), b = m.getBoundingClientRect(); return { optBottom: a.bottom, msgTop: b.top }; });
  await p.close();
  return r && r.msgTop < r.optBottom ? ['taunt strip (top ' + Math.round(r.msgTop) + ') starts above the bottom of Options (' + Math.round(r.optBottom) + ')'] : [];
}, ['connect-four', 'tic-tac-toe', 'checkers']);

check('status-matches-pill', 'a status line that repeated the pill in other words appeared and vanished, so the board bounced', async (g) => {
  const p = await open(g, 390, 'var m=document.querySelector("#mode");m.value="ai";m.dispatchEvent(new Event("change"))');
  const seen = new Set();
  const act = { 'connect-four': () => p.locator('.c4-col-btn').nth(3).click(), 'tic-tac-toe': () => p.locator('.cell').nth(4).click(), chess: async () => { await p.locator('#board .sq').nth(52).click(); await p.locator('#board .sq').nth(36).click(); } }[g];
  for (let i = 0; i < 3; i++) { seen.add(await top(p, g)); await p.waitForTimeout(100); }
  await act();
  for (let i = 0; i < 40; i++) { seen.add(await top(p, g)); await p.waitForTimeout(100); }
  await p.close();
  return seen.size > 1 ? ['board top changed during a computer move: ' + [...seen].join(', ')] : [];
}, ['connect-four', 'tic-tac-toe', 'chess']);

check('chess-pawn-is-text', 'iPhones draw the bare pawn symbol as a black emoji for both sides', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'chess/game.js'), 'utf8');
  const m = /const GLYPH = \{([^;]*)\};/.exec(src);
  return m && (m[1].match(/︎|\\uFE0E/g) || []).length >= 12 ? [] : ['every chess piece symbol must end in U+FE0E'];
}, ['chess']);

check('bots-pause', 'computer opponents answered so fast the page-colour change never showed', async (g) => {
  const need = { chess: [/\}, (\d+)\);\r?\n\}\r?\n\r?\nfunction checkEnd/, 1000], checkers: [/\}, (\d+)\);\r?\n  \}\r?\n\r?\n  const chips/, 800], 'tic-tac-toe': [/setTimeout\(aiMove, (\d+)\)/, 800], 'connect-four': [/\}, (\d+)\);\r?\n    \}\r?\n  \}\r?\n\r?\n  function applyMode/, 800] }[g];
  const src = fs.readFileSync(path.join(ROOT, g + '/game.js'), 'utf8');
  const m = need[0].exec(src);
  if (!m) return ['could not find the bot delay (the code moved: update this check)'];
  return Number(m[1]) >= need[1] ? [] : ['bot waits ' + m[1] + 'ms, wanted at least ' + need[1]];
}, ['chess', 'checkers', 'tic-tac-toe', 'connect-four']);

check('check-pill-fits', 'the long "check" message in the chess pill ran off the screen', async () => {
  const p = await open('chess', 320, SOLO.chess);
  await p.evaluate(() => Gamekit.turn(1, 'Check! Your move', false));
  const r = await p.evaluate(() => { const t = document.querySelector('.turn-text'); return [t.scrollWidth, t.clientWidth, document.documentElement.scrollWidth]; });
  await p.close();
  return r[0] > r[1] || r[2] > 320 ? ['"Check! Your move" does not fit one line at 320px'] : [];
}, ['chess']);

check('how-to-card', 'the how-to window kept its terminal look; it should be the rounded dark card with a round X', async (g) => {
  const p = await open(g);
  if (!(await p.locator('.man-window').count())) { await p.locator('.man-trigger').first().click(); await p.waitForTimeout(400); }
  const r = await p.evaluate(() => { const w = document.querySelector('.man-window'); if (!w) return null; const t = document.querySelector('.man-titlebar > span'); return { radius: parseFloat(getComputedStyle(w).borderTopLeftRadius), title: getComputedStyle(t, '::before').content, footer: getComputedStyle(document.querySelector('.man-footer')).display, close: parseFloat(getComputedStyle(document.querySelector('.man-close')).borderTopLeftRadius) }; });
  await p.close();
  if (!r) return ['how-to window did not open'];
  const bad = [];
  if (r.radius < 24) bad.push('window is not a rounded card');
  if (!/How to play/i.test(r.title)) bad.push('title is not "How to play"');
  if (r.footer !== 'none') bad.push('terminal footer still showing');
  if (r.close < 20) bad.push('close button is not round');
  return bad;
}, ['chess', '2048', 'crazy-8']);

check('cache-versions', 'phones kept an old fun.css/gamekit.js for a while after a deploy; pages must link them with ?v=', async (g) => {
  const html = fs.readFileSync(path.join(ROOT, g, 'index.html'), 'utf8');
  const bad = [];
  for (const f of ['fun.css', 'shared.css', 'gamekit.js']) if (new RegExp('\\.\\./' + f.replace('.', '\\.') + '"').test(html)) bad.push(f + ' is linked without ?v=');
  const vs = new Set([...html.matchAll(/\.\.\/(?:fun\.css|shared\.css|gamekit\.js|fun\.js)\?v=(\d+)/g)].map((m) => m[1]));
  if (vs.size > 1) bad.push('mixed ?v= numbers: ' + [...vs].join(','));
  return bad;
}, FUN);

check('no-red-in-checkers', 'checkers pieces are black and white now; "Red" must not come back in the page or the game', async () => {
  const s = fs.readFileSync(path.join(ROOT, 'checkers/game.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'checkers/index.html'), 'utf8');
  return /\bRed\b/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')) ? ['"Red" appears in checkers'] : [];
}, ['checkers']);

check('no-js-errors', 'a page threw an error while loading', async (g) => {
  const p = await open(g);
  const e = p.errs.slice(); await p.close();
  return e;
}, FUN);

/* ---------- run ---------- */
let failed = 0;
for (const c of checks) {
  if (ONLY && !c.id.includes(ONLY)) continue;
  for (const g of c.pages) {
    if (!wantPage(g)) continue;
    let bad;
    try { bad = await c.fn(g); } catch (e) { bad = ['threw: ' + e.message.split('\n')[0]]; }
    if (bad.length) { failed++; console.log('FAIL  ' + c.id + ' · ' + g + '\n      ' + bad.join('\n      ') + '\n      (' + c.issue + ')'); }
    else console.log('pass  ' + c.id + ' · ' + g);
    results.push({ id: c.id, g, ok: !bad.length });
  }
}
await browser.close(); srv.close();
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
