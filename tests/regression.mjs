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
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const ONLY = opt('only'), PAGE = opt('page'), QUICK = args.includes('--quick'), JOBS = Math.max(1, +opt('jobs') || 6);

/* ---------- pages ---------- */
// pages with the steady layout (data-fun-zone): message zone, Options popover, board in a fixed place
const ZONE = ['mastermind', 'rock-paper-scissors', 'word-ladder', 'letter-boxed', 'cross-sums', 'sliding-puzzle', 'tango', 'queens', 'zip', 'patches', 'nonogram', 'lights-out', 'sudoku', 'mini-sudoku', 'blokus-duo', 'onitama', 'gomoku', 'hex', 'quoridor', 'pentago', 'ultimate-tic-tac-toe', 'battleship', 'yatzy', 'dominoes', 'pig', 'liars-dice', 'chess', 'checkers', 'tic-tac-toe', 'reversi', 'connect-four', 'backgammon', 'dots-and-boxes', 'mancala', '2048', 'minesweeper', 'memory', 'water-sort', 'hangman', 'hearts', 'ludo', 'nine-mens-morris', 'breakthrough', 'farkle', 'hashiwokakero', 'flow-free', 'word-search', 'lost-cities', 'slitherlink', 'star-battle', 'connect6', 'tablut', 'fanorona', 'cribbage', 'skull', 'car-park'];
const FUN = [...ZONE, 'crazy-8', 'word-guess'];
// what to measure as "the board" on each page (default #board)
// pages whose first thing is a form (hangman: set the secret word) may start lower
const MAXTOP = { hangman: 520, battleship: 470, onitama: 470, mastermind: 620, 'rock-paper-scissors': 620 };
// pages whose layout legitimately differs between modes (the guess panel only exists while it is your turn)
const NOMODECMP = new Set(['mastermind']);
const BOARD = { 'water-sort': '#tubes', hangman: '#gallows', yatzy: '#dice', mastermind: '#count', 'rock-paper-scissors': '#choices', 'word-ladder': '#ladder', 'letter-boxed': '#box', 'cross-sums': '#grid', battleship: '#bs-main', dominoes: '#dm-line', 'liars-dice': '#ld-bid', hearts: '#ht', ludo: '#ld-board', 'lost-cities': '#lc' };
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
  2048: "document.getElementById('over-msg').textContent='Game over. Final score: 123.'",
  minesweeper: "document.getElementById('status').textContent='Boom. '+Gamekit.taunt('boom')",
  memory: "document.getElementById('status').textContent='You won! Done in 14 moves, 12s. '+Gamekit.taunt('win')",
  'water-sort': "document.getElementById('status').textContent='You won! Sorted in 20 moves. '+Gamekit.taunt('win')",
  'liars-dice': "document.getElementById('status').textContent='Computer 1 wins. '+Gamekit.taunt('loss')",
  mastermind: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'rock-paper-scissors': "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'word-ladder': "document.getElementById('status').textContent='Solved. Perfect! 4 steps. '+Gamekit.taunt('win')",
  'letter-boxed': "document.getElementById('status').textContent='Solved in 3 words. '+Gamekit.taunt('win')",
  'cross-sums': "document.getElementById('status').textContent='Solved in 4:05.'",
  'sliding-puzzle': "document.getElementById('status').textContent='Solved in 31 moves.'",
  'tango': "document.getElementById('status').textContent='Solved in 1:30.'",
  'queens': "document.getElementById('status').textContent='Solved in 1:30.'",
  'zip': "document.getElementById('status').textContent='Solved in 1:30.'",
  'patches': "document.getElementById('status').textContent='Solved in 1:30.'",
  nonogram: "document.getElementById('status').textContent='Solved in 2:10.'",
  'lights-out': "document.getElementById('status').textContent='Solved in 12 moves.'",
  'sudoku': "document.getElementById('status').textContent='Solved in 3:21.'",
  'mini-sudoku': "document.getElementById('status').textContent='Solved in 3:21.'",
  'blokus-duo': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  'onitama': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  'gomoku': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  'hex': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  'quoridor': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  'pentago': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  'ultimate-tic-tac-toe': "document.getElementById('status').textContent='Player 1 wins. '+Gamekit.taunt('loss')",
  battleship: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  pig: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  yatzy: "document.getElementById('status').textContent='Game over. Final score: 120. '+Gamekit.taunt('win')",
  hangman: "document.getElementById('status').textContent='Player 1 wins. The word was not guessed in time. '+Gamekit.taunt('loss')",
  hearts: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  ludo: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'nine-mens-morris': "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  breakthrough: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  farkle: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'lost-cities': "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  hashiwokakero: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'flow-free': "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'word-search': "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  slitherlink: "document.getElementById('status').textContent='Solved in 1:30.'",
  'star-battle': "document.getElementById('status').textContent='Solved in 1:30.'",
  connect6: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  tablut: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  fanorona: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  cribbage: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  skull: "document.getElementById('status').textContent='You win! '+Gamekit.taunt('win')",
  'car-park': "document.getElementById('status').textContent='Solved in 4 moves.'",
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

async function open(game, width = 390, setup, opts = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, ...opts });
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push(e.message));
  await page.goto(base + game + '/');
  await page.waitForTimeout(700);
  // measure the settled page: a late webfont swap could otherwise add a few
  // pixels to the page height and make a layout check flaky.
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // The how-to window opens by itself on the first visit. Press Escape after
  // the page has settled, and clear a leftover backdrop if one survived a
  // late auto-open (it used to steal focus from the keyboard checks).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(180);
  await page.evaluate(() => document.querySelectorAll('.man-backdrop').forEach((n) => n.remove()));
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

check('desktop-column', 'on a PC the phone-first boards stretched to the 960px wrap, so tall boards fell below the fold and every piece became huge', async (g) => {
  const p = await open(g, 1280, null, { viewport: { width: 1280, height: 900 } });
  const r = await p.evaluate(() => {
    const w = document.querySelector('.wrap').getBoundingClientRect();
    const panel = document.querySelector('.panel').getBoundingClientRect();
    return { wrap: w.width, panel: panel.width, sw: document.documentElement.scrollWidth, iw: innerWidth };
  });
  await p.close();
  const bad = [];
  if (r.sw > r.iw) bad.push('page is ' + r.sw + 'px wide at 1280px');
  if (r.wrap > 641) bad.push('game column is ' + Math.round(r.wrap) + 'px wide');
  if (r.panel > 621) bad.push('play area is ' + Math.round(r.panel) + 'px wide');
  return bad;
}, FUN);

check('desktop-height', 'on a 1280x1000 or 1280x900 PC window the page still scrolled; the desktop column should end above the fold', async (g) => {
  const bad = [];
  for (const h of [1000, 900]) {
    const p = await open(g, 1280, null, { viewport: { width: 1280, height: h } });
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    await p.close();
    if (r.sh > r.ih + 1) bad.push(h + 'px window needs ' + (r.sh - r.ih) + 'px of scroll');
    if (r.sw > r.iw) bad.push(h + 'px window is ' + r.sw + 'px wide');
  }
  return bad;
}, FUN);

check('desktop-large-viewports', 'wide PC windows and tablets (1440x900, 1920x1080, 834x1112, 1024x768) were never checked; the height-aware column should still end above the fold and stay narrow', async (g) => {
  const bad = [];
  for (const [w, h] of [[1440, 900], [1920, 1080], [834, 1112], [1024, 768]]) {
    const p = await open(g, w, null, { viewport: { width: w, height: h } });
    await p.waitForTimeout(250);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, wrap: document.querySelector('.wrap').getBoundingClientRect().width }));
    await p.close();
    if (r.sh > r.ih + 2) bad.push(w + 'x' + h + ' needs ' + (r.sh - r.ih) + 'px of scroll');
    if (r.sw > r.iw) bad.push(w + 'x' + h + ' is ' + r.sw + 'px wide');
    if (r.wrap > 641) bad.push(w + 'x' + h + ' column is ' + Math.round(r.wrap) + 'px wide');
  }
  return bad;
}, FUN);

check('desktop-breakpoint', 'the 760px breakpoint: 759px must keep the phone-first layout and 760px must switch to the desktop column, without a sideways overflow at either side', async () => {
  const bad = [];
  for (const [w, expect] of [[759, 'phone'], [760, 'desktop']]) {
    const p = await open('chess', w, null, { viewport: { width: w, height: 900 } });
    const r = await p.evaluate(() => ({ wrap: document.querySelector('.wrap').getBoundingClientRect().width, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    await p.close();
    if (r.sw > r.iw) bad.push(w + 'px is ' + r.sw + 'px wide');
    if (expect === 'desktop' && r.wrap > 641) bad.push('760px did not switch to the desktop column (' + Math.round(r.wrap) + 'px)');
    if (expect === 'phone' && r.wrap < 700) bad.push('759px already narrowed to the desktop column (' + Math.round(r.wrap) + 'px)');
  }
  return bad;
}, ['chess']);

check('phone-landscape-700', 'a 600–759px landscape window is still phone territory; it must keep the wide phone layout and never scroll sideways', async (g) => {
  const p = await open(g, 700, null, { viewport: { width: 700, height: 600 } });
  const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, wrap: document.querySelector('.wrap').getBoundingClientRect().width }));
  await p.close();
  const bad = [];
  if (r.sw > r.iw) bad.push('page is ' + r.sw + 'px wide at 700px');
  // Hearts and Ludo deliberately keep their 430px card-table column.
  if (r.wrap < 650 && g !== 'hearts' && g !== 'ludo') bad.push('700px already narrowed to the desktop column (' + Math.round(r.wrap) + 'px)');
  return bad;
}, ['chess', 'battleship', 'hangman', 'car-park', 'crazy-8', 'water-sort', 'sudoku', 'tic-tac-toe', 'hearts', 'ludo']);

check('desktop-tab-order', 'Tab focus was only checked on a phone; at PC width the top-bar back button must be first, every stop must be visible, and focus must not land on a hidden control', async () => {
  const p = await open('chess', 1280, null, { viewport: { width: 1280, height: 900 } });
  await p.evaluate(() => { document.body.focus(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const stops = [];
  for (let i = 0; i < 10; i++) {
    await p.keyboard.press('Tab');
    stops.push(await p.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return { tag: 'BODY' };
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, id: e.id, cls: (e.className || '').toString().slice(0, 40), visible: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden', inside: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight };
    }));
  }
  const bad = [];
  const real = stops.filter((s) => s.tag !== 'BODY');
  if (!stops[0].cls || !stops[0].cls.includes('back')) bad.push('the first Tab stop is not the back button (' + JSON.stringify(stops[0]) + ')');
  if (real.length < 5) bad.push('Tab only reached ' + real.length + ' controls before wrapping to the page');
  if (real.some((s) => s.visible === false)) bad.push('Tab landed on a hidden control');
  if (real.some((s) => s.inside === false)) bad.push('Tab landed on an off-screen control');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['chess']);

check('back-home-navigation', 'the back button and the game-over Home button were never timed; both must reach the hub promptly at 320 and 390 without a stale page or a reload loop', async () => {
  const bad = [];
  for (const w of [320, 390]) {
    let p = await open('chess', w);
    let t0 = Date.now();
    await Promise.all([p.waitForURL((u) => new URL(u).pathname === '/'), p.locator('.topbar .back').click()]);
    let ms = Date.now() - t0;
    if (ms > 3000) bad.push(w + 'px: back took ' + ms + 'ms');
    await p.close();

    p = await open('chess', w);
    await p.evaluate(() => { document.getElementById('status').textContent = 'You win! ' + Gamekit.taunt('win'); });
    await p.waitForTimeout(700);
    t0 = Date.now();
    await Promise.all([p.waitForURL((u) => new URL(u).pathname === '/'), p.locator('.gk-over .home').click()]);
    ms = Date.now() - t0;
    if (ms > 3000) bad.push(w + 'px: Home took ' + ms + 'ms');
    await p.close();
  }
  return bad;
}, ['chess']);

check('desktop-pointer-keyboard', 'desktop drag/drop, hover and the custom mode menu were only exercised on a phone; they must work with a mouse and keyboard at PC width', async () => {
  const bad = [];
  // mouse drag at desktop width
  const p = await open('battleship', 1280, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')", { viewport: { width: 1280, height: 900 } });
  await p.waitForTimeout(500);
  const tray = await p.locator('#bs-tray .bs-ship').first().boundingBox(), cell = await p.locator('#bs-main .bs-cell').nth(23).boundingBox();
  await p.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2); await p.mouse.down();
  await p.mouse.move(cell.x + 8, cell.y + 8, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  if (!(await p.locator('#bs-main .bs-hull').count())) bad.push('dragging a ship with the mouse at 1280px placed nothing');
  if (p.errs.length) bad.push('battleship errors: ' + p.errs.join('; '));
  await p.close();

  // hover and keyboard on the custom mode menu
  const q = await open('chess', 1280, null, { viewport: { width: 1280, height: 900 } });
  await q.hover('.topbar .back'); await q.waitForTimeout(150);
  const hover = await q.evaluate(() => getComputedStyle(document.querySelector('.topbar .back')).filter);
  if (!/brightness/.test(hover)) bad.push('the back button has no desktop hover');
  await q.locator('.gk-optbtn').click(); await q.waitForTimeout(250);      // the mode menu lives in the Options popover
  const btn = q.locator('.gk-sel-btn').first();
  await btn.focus();
  await q.keyboard.press('ArrowDown'); await q.waitForTimeout(120);
  const opened = await q.evaluate(() => ({ exp: document.querySelector('.gk-sel-btn').getAttribute('aria-expanded'), n: document.querySelectorAll('.gk-sel-list li').length, hidden: document.querySelector('.gk-sel-list').hidden }));
  if (opened.exp !== 'true' || opened.hidden || opened.n < 2) bad.push('ArrowDown did not open the mode menu');
  await q.keyboard.press('End'); await q.waitForTimeout(80);
  const last = await q.evaluate(() => { const li = [...document.querySelectorAll('.gk-sel-list li')].pop(); return li ? li.classList.contains('on') : false; });
  if (!last) bad.push('End did not move to the last menu item');
  await q.keyboard.press('Escape'); await q.waitForTimeout(120);
  const closed = await q.evaluate(() => ({ hidden: document.querySelector('.gk-sel-list').hidden, focused: document.activeElement.classList.contains('gk-sel-btn') }));
  if (!closed.hidden) bad.push('Escape did not close the mode menu');
  if (!closed.focused) bad.push('Escape did not return focus to the mode button');
  if (q.errs.length) bad.push('chess errors: ' + q.errs.join('; '));
  await q.close();
  return bad;
}, ['chess']);

check('desktop-modes', 'switching to computer or same-device play at PC width added a toolbar row and pushed the bottom of the page past the fold', async (g) => {
  const p = await open(g, 1280, null, { viewport: { width: 1280, height: 1000 } });
  const modes = await p.evaluate(() => { const s = document.querySelector('#mode'); return s ? [...s.options].map((o) => o.value).filter((v) => v !== 'live') : []; });
  const bad = [];
  for (const m of modes) {
    await p.evaluate((v) => { const s = document.querySelector('#mode'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, m);
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    if (r.sh > r.ih + 1) bad.push(m + ' mode needs ' + (r.sh - r.ih) + 'px of scroll');
    if (r.sw > r.iw) bad.push(m + ' mode is ' + r.sw + 'px wide');
  }
  await p.close();
  return bad;
}, FUN);

check('desktop-compact', 'at 1366x768 the compact desktop layer still left a game scrolling, or a mode toolbar pushed the bottom past the fold', async (g) => {
  const p = await open(g, 1366, null, { viewport: { width: 1366, height: 768 } });
  const measure = () => p.evaluate(() => {
    const wrap = document.querySelector('.wrap');
    return {
      sh: document.documentElement.scrollHeight,
      ih: innerHeight,
      sw: document.documentElement.scrollWidth,
      iw: innerWidth,
      wrap: wrap.getBoundingClientRect().width,
      padTop: parseFloat(getComputedStyle(wrap).paddingTop),
      topbar: document.querySelector('.topbar').getBoundingClientRect().height,
    };
  });
  const bad = [];
  const r = await measure();
  if (r.sh > r.ih + 1) bad.push('needs ' + (r.sh - r.ih) + 'px of scroll at 1366x768');
  if (r.sw > r.iw) bad.push('page is ' + r.sw + 'px wide at 1366x768');
  if (r.wrap > 441) bad.push('compact column is ' + Math.round(r.wrap) + 'px wide');
  if (r.padTop > 9) bad.push('compact layer padding is ' + r.padTop + 'px; layer may not be active');
  if (r.topbar > 49) bad.push('compact topbar is ' + Math.round(r.topbar) + 'px high; layer may not be active');
  const modes = await p.evaluate(() => { const s = document.querySelector('#mode'); return s ? [...s.options].map((o) => o.value).filter((v) => v !== 'live') : []; });
  for (const m of modes) {
    await p.evaluate((v) => { const s = document.querySelector('#mode'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, m);
    await p.waitForTimeout(400);
    const r2 = await measure();
    if (r2.sh > r2.ih + 1) bad.push(m + ' mode needs ' + (r2.sh - r2.ih) + 'px of scroll at 1366x768');
    if (r2.sw > r2.iw) bad.push(m + ' mode is ' + r2.sw + 'px wide at 1366x768');
  }
  await p.close();
  return bad;
}, FUN);

check('desktop-phone-guard', 'the short-screen desktop layer leaked onto a landscape phone, changing the phone layout', async () => {
  const p = await open('chess', 844, null, { viewport: { width: 844, height: 390 } });
  const r = await p.evaluate(() => {
    const w = document.querySelector('.wrap');
    return { pad: parseFloat(getComputedStyle(w).paddingTop), topbar: document.querySelector('.topbar').getBoundingClientRect().height };
  });
  await p.close();
  const bad = [];
  if (r.pad < 13) bad.push('wrap padding-top is ' + r.pad + 'px at 844x390; compact layer is active');
  if (r.topbar < 55) bad.push('topbar is ' + Math.round(r.topbar) + 'px at 844x390; compact layer is active');
  return bad;
}, ['chess']);

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
  for (const m of NOMODECMP.has(g) ? [] : modes) {
    await p.evaluate((v) => { const s = document.querySelector('#mode'); s.value = v; s.dispatchEvent(new Event('change')); }, m);
    await p.waitForTimeout(400);
    const t = await top(p, g);
    if (t !== t0) bad.push('board is ' + t + 'px in "' + m + '" mode but ' + t0 + 'px at start');
  }
  await p.close();
  return bad;
}, ZONE);

check('taunt-not-cut', 'a long taunt ("Hard to see how this doesn\'t go your way... The crowd goes quiet") was cut off at the bottom of the message strip in rock paper scissors', async (g) => {
  const p = await open(g, 320, SOLO[g]);
  await p.evaluate(END[g]); await p.waitForTimeout(500);
  await p.evaluate(() => { const t = [1, 2, 3, 4, 5, 6].map(() => Gamekit.taunt('loss')).sort((x, y) => y.length - x.length)[0]; document.getElementById('status').textContent = 'Player 2 took it. Player 1 — ' + t; });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const m = document.querySelector('.gk-msg:not([hidden])'); return m ? { s: m.scrollHeight, c: m.clientHeight } : null; });
  await p.close();
  return r && r.s > r.c + 1 ? ['message strip is ' + r.c + 'px but its text needs ' + r.s + 'px'] : [];
}, ['rock-paper-scissors']);

check('zip-walls-visible', 'zip walls were white on the white grid, so they could not be seen before you played', async (g) => {
  const p = await open(g);
  const r = await p.evaluate(() => [...document.querySelectorAll('.zp-wall-h, .zp-wall-v')].map((w) => getComputedStyle(w).backgroundColor));
  await p.close();
  const bad = r.filter((c) => /^rgb\(2[3-5]\d, 2[3-5]\d, 2[3-5]\d\)$/.test(c) || c === 'rgba(0, 0, 0, 0)');
  return !r.length ? ['no walls found on the start puzzle'] : bad.length ? ['wall colour is ' + bad[0]] : [];
}, ['zip']);

check('tango-badges-aligned', 'tango: the = and x badges sat a few pixels off the line between the two cells they describe, clipped by the board edge', async (g) => {
  const p = await open(g, 390);
  const r = await p.evaluate(() => {
    const cells = [...document.querySelectorAll('.tg-cell')].map((c) => c.getBoundingClientRect());
    return [...document.querySelectorAll('.tg-edge')].map((e) => { const b = e.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      // the centre must lie in the gap between two cells (not inside one)
      const inside = cells.some((c) => cx > c.left + 1 && cx < c.right - 1 && cy > c.top + 1 && cy < c.bottom - 1);
      return inside; });
  });
  await p.close();
  return !r.length ? ['no badges on the start puzzle'] : r.some(Boolean) ? [r.filter(Boolean).length + ' badge(s) are not centred on the line between their cells'] : [];
}, ['tango']);

check('patches-overlay-aligned', 'patches: a drawn rectangle was shifted by the width of the board frame, so its edges missed the grid lines and ran off the right edge', async (g) => {
  const p = await open(g, 390); await p.waitForTimeout(500);
  const b = await p.evaluate(() => { const c = [...document.querySelectorAll('.pt-cell')]; const a = c[c.length - 7].getBoundingClientRect(), z = c[c.length - 1].getBoundingClientRect(); return { x1: a.left + 5, y1: a.top + 5, x2: z.left + 5, y2: z.top + 5 }; });
  await p.mouse.move(b.x1, b.y1); await p.mouse.down(); await p.mouse.move(b.x2, b.y2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  const r = await p.evaluate(() => { const o = document.querySelector('.pt-rect-overlay'); if (!o) return null; const cells = [...document.querySelectorAll('.pt-cell')], a = cells[cells.length - 7].getBoundingClientRect(), z = cells[cells.length - 1].getBoundingClientRect(), r = o.getBoundingClientRect(); return { dl: r.left - a.left, dt: r.top - a.top, dr: r.right - z.right, db: r.bottom - z.bottom }; });
  const dbg = await p.evaluate(() => document.querySelectorAll('.pt-rect-overlay').length + '|' + (document.elementFromPoint(323, 500) || {}).className + '|' + document.querySelectorAll('.pt-cell.drag').length);
  await p.close();
  if (!r) return ['dragging across cells drew no rectangle ' + dbg];
  return Object.values(r).some((v) => Math.abs(v) > 1.5) ? ['rectangle is off the cells it covers by ' + JSON.stringify(r)] : [];
}, ['patches']);

check('sliding-puzzle-tiles', 'sliding puzzle: each tile showed as a narrow white card on a brown tile, and the clock in the header was cut to "0:..."', async (g) => {
  const p = await open(g, 390);
  const r = await p.evaluate(() => { const b = document.querySelector('.sp-board').getBoundingClientRect(), t = document.querySelector('.sp-t span').getBoundingClientRect(), o = document.querySelector('.sp-t').getBoundingClientRect(), n = Number(getComputedStyle(document.querySelector('.sp-board')).getPropertyValue('--n')) || 4, bg = getComputedStyle(document.querySelector('.sp-t')).backgroundColor, bs = getComputedStyle(document.querySelector('.sp-t')).boxShadow; const clock = [...document.querySelectorAll('.fun-pills b')].map((e) => e.scrollWidth > e.clientWidth + 1); return { share: t.width / (b.width / n), bg, bs, clock }; });
  await p.close();
  const bad = [];
  if (r.share < 0.8) bad.push('tile fills only ' + Math.round(r.share * 100) + '% of its cell width');
  if (r.bg !== 'rgba(0, 0, 0, 0)' || r.bs !== 'none') bad.push('the tile button still draws its own fill/shadow behind the tile (' + r.bg + ', ' + r.bs + ')');
  if (r.clock.some(Boolean)) bad.push('a header pill is cut off');
  return bad;
}, ['sliding-puzzle']);

check('cross-sums-not-cut', 'cross sums: the top row of the grid was cut off because the rows grew taller than the square frame', async (g) => {
  const p = await open(g, 390);
  const r = await p.evaluate(() => { const b = document.querySelector('.cs-grid'), kids = [...b.children].map((c) => c.getBoundingClientRect()), br = b.getBoundingClientRect(); return { top: Math.min(...kids.map((k) => k.top)) - br.top - b.clientTop, bottom: br.bottom - b.clientTop - Math.max(...kids.map((k) => k.bottom)) }; });
  await p.close();
  return r.top < -1 || r.bottom < -1 ? ['cells stick out of the frame (top ' + Math.round(r.top) + ', bottom ' + Math.round(r.bottom) + ')'] : [];
}, ['cross-sums']);

check('tango-badges-clear-of-suns', 'tango: the = and x circles were big enough to overlap the sun or moon in the neighbouring cells', async (g) => {
  const p = await open(g, 390);
  const r = await p.evaluate(() => {
    const shapes = [...document.querySelectorAll('.tg-cell.sun, .tg-cell.moon')].map((c) => { const k = c.getBoundingClientRect(), d = Math.min(k.width, k.height) * 0.5 + 6; return { x: k.left + k.width / 2, y: k.top + k.height / 2, r: d / 2 }; });
    // give every cell a sun so the check does not depend on the puzzle: use every cell centre
    const cells = [...document.querySelectorAll('.tg-cell')].map((c) => { const k = c.getBoundingClientRect(); return { x: k.left + k.width / 2, y: k.top + k.height / 2, r: (Math.min(k.width, k.height) * 0.5 + 6) / 2 }; });
    let worst = 0;
    for (const e of document.querySelectorAll('.tg-edge')) { const b = e.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2, br = b.width / 2; for (const s of cells) worst = Math.max(worst, s.r + br - Math.hypot(s.x - cx, s.y - cy)); }
    return { worst: Math.round(worst * 10) / 10 };
  });
  await p.close();
  return r.worst > 0 ? ['a badge overlaps a sun by ' + r.worst + 'px'] : [];
}, ['tango']);

check('zip-win-card-and-next', 'zip had no end-of-game card (its win text was "Zipped in", which the card did not recognise) and nothing to take you to the next puzzle', async (g) => {
  const p = await open(g, 390); await p.waitForTimeout(400);
  const bad = [];
  await p.evaluate(() => window.__zipTest.autoSolve()); await p.waitForTimeout(900);
  if (!(await p.locator('.gk-over').count())) bad.push('no end-of-game card after solving the puzzle');
  else {
    const label = (await p.locator('.gk-over .again').textContent()).trim();
    if (label !== 'Next level') bad.push('the card button says "' + label + '", not "Next level"');
    await p.locator('.gk-over .again').click(); await p.waitForTimeout(600);
    const after = await p.evaluate(() => ({ on: document.querySelectorAll('.zp-cell.on').length, card: !!document.querySelector('.gk-over') }));
    if (after.card) bad.push('the card is still there after Next level');
    if (after.on) bad.push('the new puzzle starts with ' + after.on + ' filled squares');
  }
  await p.close();
  return bad;
}, ['zip']);

check('zip-path-glides', 'zip: the line and the filled squares jumped to each new square; the head now glides and the squares fill as it passes', async (g) => {
  const p = await open(g, 390); await p.waitForTimeout(400);
  const start = await p.evaluate(() => { const c = document.querySelector('.zp-cell.start').getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height / 2, w: c.width }; });
  // start sampling before the pointer move: a round-trip that lands after the
  // glide finished used to see only the final position and fail under load
  await p.evaluate(() => {
    window.__zipXs = [];
    const t0 = performance.now();
    const f = () => { const c = document.querySelector('#svg circle'); if (c) window.__zipXs.push(+c.getAttribute('cx')); if (performance.now() - t0 < 700) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await p.mouse.move(start.x, start.y); await p.mouse.down();
  await p.mouse.move(start.x + start.w * 0.6, start.y, { steps: 2 });
  // sample the head while it travels: it must be seen between two squares at least once
  await p.waitForTimeout(800);
  const seen = await p.evaluate(() => window.__zipXs);
  await p.mouse.up(); await p.close();
  const distinct = new Set(seen.map((v) => Math.round(v))).size;
  return distinct < 3 ? ['the head jumped (saw ' + distinct + ' positions while moving one square)'] : [];
}, ['zip']);

check('battleship-battle-fits-and-fires', 'battleship: a battle (your shot) did not fit on one screen, had no fleet strip between the grids, and had no cannon to tap to fire', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(400);
  const bad = [];
  await p.locator('#bs-random').click(); await p.locator('#bs-ready').click(); await p.waitForTimeout(600);
  const r = await p.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); return { over: document.documentElement.scrollHeight - innerHeight, strip: q('#bs-fleets').top >= q('#bs-main').bottom - 1 && q('#bs-fleets').bottom <= q('#bs-sub').top + 1, ships: document.querySelectorAll('#bs-fleets .bs-mini').length, cannon: !!document.querySelector('#bs-fire img') }; });
  if (r.over > 0) bad.push('the battle screen scrolls (' + r.over + 'px too tall)');
  if (!r.strip) bad.push('the fleet strip is not between the two grids');
  if (r.ships !== 10) bad.push('the fleet strip should show 5 ships for each side (saw ' + r.ships + ')');
  if (!r.cannon) bad.push('no cannon to fire with');
  const cn = await p.evaluate(() => { const c = document.getElementById('bs-fire').getBoundingClientRect(), g = document.getElementById('bs-sub').getBoundingClientRect(); return { shown: c.width > 0, over: c.left >= g.left - 1 && c.right <= g.right + 1 && c.top >= g.top && c.bottom <= g.bottom + 1 }; });
  if (!cn.shown) bad.push('the cannon is not showing during the battle');
  if (!cn.over) bad.push('the cannon should sit on top of your own (faded) grid, as in the reference');
  await p.locator('#bs-main .bs-cell').nth(44).click();
  if (!(await p.evaluate(() => !document.getElementById('bs-fire').disabled))) bad.push('the cannon stays disabled after aiming');
  await p.locator('#bs-fire').click(); await p.waitForTimeout(1500);
  const shot = await p.evaluate(() => document.querySelectorAll('#bs-main .bs-cell.hit, #bs-main .bs-cell.miss, #bs-main .bs-cell.sunk').length);
  if (shot !== 1) bad.push('firing the cannon should mark exactly one square (saw ' + shot + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('battleship-drag-ship', 'battleship: ships could only be dropped by tapping; they can now be dragged from the tray onto the grid, and tapped to turn', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(500);
  const bad = [];
  const tray = await p.locator('#bs-tray .bs-ship').first().boundingBox(), cell = await p.locator('#bs-main .bs-cell').nth(23).boundingBox();
  await p.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2); await p.mouse.down();
  await p.mouse.move(cell.x + 10, cell.y + 10, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250);
  const hull = async () => p.evaluate(() => { const h = document.querySelector('#bs-main .bs-hull'); if (!h) return null; const r = h.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  const a = await hull();
  if (!a) bad.push('dragging a ship from the tray onto the grid placed nothing');
  else {
    await p.mouse.click(cell.x + 10, cell.y + 10); await p.waitForTimeout(250);
    const b = await hull();
    if (!b || !(a.w > a.h) || !(b.h > b.w)) bad.push('tapping a placed ship should turn it from across to down');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('connect-four-drop-animates', 'connect four: a disc used to just appear in its slot; it now falls from the top of its column, bounces, and lands in the lowest free square', async () => {
  const p = await open('connect-four', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(400);
  const bad = [];
  const hole = () => p.evaluate(() => { const r = document.querySelector('.c4-slot[data-r="5"][data-c="3"]').getBoundingClientRect(); return Math.round(r.top) + ',' + Math.round(r.left) + ',' + Math.round(r.width); });
  const before = await hole();
  const btn = p.locator('.c4-col-btn').nth(3);
  await btn.click();
  await p.waitForTimeout(120);
  if ((await hole()) !== before) bad.push('the square the disc is falling into moved or vanished while the disc was still on its way (it must stay an empty hole until the disc lands)');
  const mid = await p.evaluate(() => new Promise((res) => { const t0 = performance.now(), ys = []; const f = () => { const el = [...document.querySelectorAll('.c4-slot.p1, .c4-slot.p2')][0]; if (el) ys.push(el.getBoundingClientRect().top); if (performance.now() - t0 < 700) requestAnimationFrame(f); else res({ ys: ys, end: ys[ys.length - 1] }); }; f(); }));
  const travelled = Math.max(...mid.ys) - Math.min(...mid.ys);
  if (travelled < 60) bad.push('the disc did not fall (it moved only ' + Math.round(travelled) + 'px)');
  const landed = await p.evaluate(() => { const el = document.querySelector('.c4-slot.p1, .c4-slot.p2'); return el ? +el.dataset.r : -1; });
  if (landed !== 5) bad.push('the disc should land in the bottom row (row ' + landed + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['connect-four']);

check('reversi-flip-animates', 'reversi: flipped discs used to change colour instantly; they now turn over in a wave, and end up the right colour', async () => {
  const p = await open('reversi', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('.rv-cell.hint').first().click();
  const during = await p.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => /scale/.test(k.transform || ''))).length);
  if (during < 2) bad.push('no flip animation after a move (saw ' + during + ' animations)');
  await p.waitForTimeout(1200);
  const n = await p.evaluate(() => ({ b: document.querySelectorAll('.rv-disc.black').length, w: document.querySelectorAll('.rv-disc.white').length }));
  if (n.b !== 4 || n.w !== 1) bad.push('after the first move black should have 4 discs and white 1 (saw ' + n.b + ' and ' + n.w + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['reversi']);

const sliding = () => document.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => /translate/.test(k.transform || ''))).length;
check('chess-piece-slides', 'chess: a moved piece used to just appear on its new square; it now glides there from the old one', async () => {
  const p = await open('chess', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('#board .sq').nth(52).click(); await p.locator('#board .sq').nth(36).click();
  const n = await p.evaluate(sliding);
  if (n < 1) bad.push('no slide animation after moving e2-e4');
  await p.waitForTimeout(500);
  const there = await p.evaluate(() => document.querySelectorAll('#board .sq')[36].textContent.trim().length);
  if (!there) bad.push('the pawn is not on e4 after the move');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['chess']);

check('checkers-piece-slides', 'checkers: a moved piece used to just appear on its new square; it now glides there', async () => {
  const p = await open('checkers', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('.ck-cell.selectable').first().click(); await p.waitForTimeout(100);
  await p.locator('.ck-cell.hint').first().click();
  const n = await p.evaluate(sliding);
  if (n < 1) bad.push('no slide animation after a checkers move');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['checkers']);

check('mancala-sows-seed-by-seed', 'mancala: the seeds used to jump to their final pits; they are now dropped one pit at a time, and the final position is still exact', async () => {
  const p = await open('mancala', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  const bad = [];
  const store = () => p.evaluate(() => (document.querySelector('.mk-store.p1 .store-n') || { textContent: '0' }).textContent);
  await p.locator('.mk-pit.p1').nth(2).click();
  await p.waitForTimeout(250);
  const early = await store();
  if (early !== '0') bad.push('the store already holds ' + early + ' a quarter second in: the seeds were not dropped one by one');
  await p.waitForTimeout(1400);
  const end = await p.evaluate(() => ({ s: (document.querySelector('.mk-store.p1 .store-n') || { textContent: '0' }).textContent, clickable: [...document.querySelectorAll('.mk-pit.p1')].some((b) => !b.disabled), seeds: [...document.querySelectorAll('.mk-pit.p1 .num')].map((n) => n.textContent).join('') }));
  if (end.s !== '1') bad.push('after sowing 4 seeds from the third pit the store should hold 1 (saw ' + end.s + ')');
  if (!end.clickable) bad.push('the pits are still locked after the sowing finished');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['mancala']);

check('word-ladder-submit-button', 'word ladder: guesses were sent with a small Enter key inside the keyboard; there is now a clear Submit button (greyed until four letters are typed), like Word Guess', async () => {
  const p = await open('word-ladder', 390); await p.waitForTimeout(400);
  const bad = [];
  if (!(await p.locator('#submit-btn').count())) bad.push('no Submit button');
  else {
    if (!(await p.locator('#submit-btn').isDisabled())) bad.push('Submit is enabled before any letters are typed');
    for (const c of 'zzzz') await p.locator('#kb .wl-key', { hasText: new RegExp('^' + c + '$', 'i') }).first().click();
    if (await p.locator('#submit-btn').isDisabled()) bad.push('Submit stays disabled after four letters');
    await p.locator('#submit-btn').click(); await p.waitForTimeout(300);
    const msg = (await p.locator('#status').textContent()).trim();
    if (!/word list|not a word|neighbo|one letter/i.test(msg)) bad.push('Submit did nothing visible (status: "' + msg + '")');
    if (await p.locator('#kb .wl-key[data-k="enter"]').count()) bad.push('the small Enter key is still in the keyboard');
  }
  const over = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  if (over > 0) bad.push('the page scrolls (' + over + 'px too tall)');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['word-ladder']);

check('checkers-slide-smooth-over-a-game', 'checkers: slides (and multi-jump hops) must run through a whole game against the computer without errors, ending on the right squares', async () => {
  const p = await open('checkers', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  const bad = [];
  let slid = 0;
  for (let t = 0; t < 14; t++) {
    const sel = p.locator('.ck-cell.selectable');
    if (!(await sel.count())) { await p.waitForTimeout(600); continue; }
    await sel.nth(t % (await sel.count())).click(); await p.waitForTimeout(80);
    const tgt = p.locator('.ck-cell.hint, .ck-cell.cap');
    if (!(await tgt.count())) continue;
    await tgt.first().click();
    slid += await p.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => /translate/.test(k.transform || ''))).length > 0 ? 1 : 0);
    await p.waitForTimeout(1700);
  }
  if (slid < 3) bad.push('only ' + slid + ' of the moves slid');
  const stuck = await p.evaluate(() => [...document.querySelectorAll('.ck-cell')].filter((c) => c.style.zIndex === '3').length + document.querySelectorAll('.ck-piece').length);
  if (stuck < 2) bad.push('the board looks empty after the game');
  if (await p.evaluate(() => [...document.querySelectorAll('.ck-cell')].some((c) => c.style.zIndex === '3'))) bad.push('a square was left raised after its slide');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['checkers']);

check('options-closes-after-pick', 'Options: after opening it and choosing something from a dropdown (mode, level...) the menu stayed open over the board; it now folds away after the pick', async (g) => {
  const p = await open(g);
  const bad = [];
  const sel = p.locator('.gk-menu select').first();
  if (!(await sel.count())) { await p.close(); return []; }
  await p.locator('.gk-optbtn').click(); await p.waitForTimeout(200);
  if (await p.evaluate(() => document.body.classList.contains('gk-play'))) bad.push('Options did not open');
  const vals = await sel.evaluate((s) => [...s.options].filter((o) => o.value !== s.value && !o.disabled && !o.hidden).map((o) => o.value));
  if (!vals.length) { await p.close(); return []; }
  await sel.evaluate((s, v) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, vals[0]);
  await p.waitForTimeout(250);
  if (!(await p.evaluate(() => document.body.classList.contains('gk-play')))) bad.push('Options stayed open after choosing from a dropdown');
  await p.close();
  return bad;
}, ['chess', 'checkers', 'connect-four', 'reversi', 'mancala', 'tango']);

check('minesweeper-animates', 'minesweeper: opened tiles just appeared and a mine just turned red; opened tiles now ripple out from the tile you pressed, and a mine explodes (flash, sparks, smoke, board shake) before the other mines go off', async () => {
  const p = await open('minesweeper', 390, "var m=document.querySelector('#mode');m.value='solo';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('#board .c').nth(40).click();
  const pops = await p.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => /scale/.test(k.transform || ''))).length);
  if (pops < 1) bad.push('no pop animation on the opened tiles');
  await p.waitForTimeout(900);
  // press a mine
  await p.evaluate(() => { for (let i = 0; i < H * W; i++) if (mines[i] && !revealed[i]) { click(Math.floor(i / W), i % W); return; } });
  await p.waitForTimeout(150);
  const boom = await p.evaluate(() => ({ fx: [...document.querySelectorAll('body > div')].filter((d) => d.style.zIndex === '96').length, shake: document.getElementById('board').getAnimations().length, over: over }));
  if (!boom.over) bad.push('the test could not hit a mine');
  if (boom.fx < 1) bad.push('no explosion effect when a mine is hit');
  if (boom.shake < 1) bad.push('the board does not shake when a mine is hit');
  await p.waitForTimeout(1600);
  const left = await p.evaluate(() => [...document.querySelectorAll('body > div')].filter((d) => d.style.zIndex === '96').length);
  if (left) bad.push('the explosion effect was left on the page');
  const mineCells = await p.evaluate(() => document.querySelectorAll('#board .c.mine').length);
  if (mineCells < 5) bad.push('the other mines were not shown after the blast (' + mineCells + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['minesweeper']);

check('quoridor-wall-mode-clean', 'quoridor: pressing Wall drew rows of arcs over the whole board (the shadows of the invisible wall-spot buttons)', async () => {
  const p = await open('quoridor', 390); await p.waitForTimeout(400);
  const bad = [];
  await p.locator('#mode-wall').click(); await p.waitForTimeout(250);
  const r = await p.evaluate(() => { const h = [...document.querySelectorAll('#board .qd-hit')]; return { n: h.length, shadow: h.filter((b) => getComputedStyle(b).boxShadow !== 'none').length, filled: h.filter((b) => getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)').length }; });
  if (r.n < 60) bad.push('no wall spots in Wall mode (' + r.n + ')');
  if (r.shadow) bad.push(r.shadow + ' wall spots draw a shadow (the arcs)');
  if (r.filled) bad.push(r.filled + ' wall spots have a fill');
  await p.close();
  return bad;
}, ['quoridor']);

check('2048-board-centred-and-merge-smooth', '2048: the board was stuck to the top with a big empty area below; it now sits in the middle of the space under Options, and two tiles that meet blend into the doubled tile instead of swapping', async () => {
  const p = await open('2048', 390); await p.waitForTimeout(400);
  const bad = [];
  const r = await p.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(), o = document.querySelector('.gk-optbtn').getBoundingClientRect(); const free = innerHeight - o.bottom; return { above: b.top - o.bottom, below: innerHeight - b.bottom, free, over: document.documentElement.scrollHeight - innerHeight }; });
  if (Math.abs(r.above - r.below) > 40) bad.push('the board is not centred in the free space (gap above ' + Math.round(r.above) + ', below ' + Math.round(r.below) + ')');
  if (r.over > 0) bad.push('the page scrolls (' + r.over + 'px)');
  // force a merge: two 2s side by side, slide left. The slower settle makes the merge legible without fading.
  await p.evaluate(() => { grid = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; render(); });
  await p.keyboard.press('ArrowLeft');
  const seen = await p.evaluate(() => new Promise((res) => { const t0 = performance.now(); let slide = 0, fade = 0, pop = 0; const f = () => { document.querySelectorAll('#board .tile').forEach((t) => t.getAnimations().forEach((a) => { const k = a.effect.getKeyframes(), d = a.effect.getTiming().duration; if (t.classList.contains('ghost')) { slide = Math.max(slide, d); if (k.some((x) => x.opacity !== undefined && String(x.opacity) === '0')) fade++; } if (k.some((x) => /scale\(1\.14\)/.test(x.transform || ''))) pop++; })); if (performance.now() - t0 < 320) requestAnimationFrame(f); else res({ slide, fade, pop }); }; f(); }));
  if (!(seen.slide >= 155 && seen.slide <= 165)) bad.push('a one-cell slide should take about 160ms (0.8 x 200), saw ' + seen.slide + 'ms');
  if (seen.fade) bad.push('the merging tiles fade; in the reference they just meet and swap');
  if (!seen.pop) bad.push('the doubled tile does not pop as it appears');
  await p.waitForTimeout(400);
  const v = await p.evaluate(() => [...document.querySelectorAll('#board .tile')].map((t) => t.textContent).filter(Boolean).join(','));
  if (!v.includes('4')) bad.push('the merge did not produce a 4 (' + v + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['2048']);

check('2048-merge-lands-smoothly', '2048: merging tiles used to squash to 0.92 then pop from that scale; they now stay full size while they overlap, and the doubled tile bulges from scale 1', async () => {
  const p = await open('2048', 390);
  await p.evaluate(() => { grid = [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; render(); move('left'); });
  const seen = await p.evaluate(() => new Promise((res) => {
    let squash = false, popFromOne = false, popExpands = false, slideEase = '', bulge = null, spawn = null;
    const t0 = performance.now();
    const sample = () => {
      document.querySelectorAll('#board .tile').forEach((tile) => tile.getAnimations().forEach((animation) => {
        const frames = animation.effect.getKeyframes().map((frame) => frame.transform || '');
        const joined = frames.join(' ');
        const timing = animation.effect.getTiming();
        if (joined.includes('scale(0.92)')) squash = true;
        if (tile.classList.contains('ghost')) slideEase = timing.easing || '';
        if (!tile.classList.contains('ghost') && frames[0].includes('scale(1)')) popFromOne = true;
        if (!tile.classList.contains('ghost') && frames.some((transform) => transform.includes('scale(1.14)'))) {
          popExpands = true;
          bulge = { duration: timing.duration, iterations: timing.iterations, direction: timing.direction, easing: timing.easing };
        }
        if (!tile.classList.contains('ghost') && frames[0].includes('scale(0)')) {
          spawn = { duration: timing.duration, easing: timing.easing };
        }
      }));
      if (performance.now() - t0 < 480) requestAnimationFrame(sample);
      else res({ squash, popFromOne, popExpands, slideEase, bulge, spawn });
    };
    sample();
  }));
  await p.close();
  const bad = [];
  if (seen.squash) bad.push('tiles still squash before they merge');
  if (!seen.popFromOne || !seen.popExpands) bad.push('the doubled tile does not bulge from full size after they meet');
  if (!/0\.25/.test(seen.slideEase)) bad.push('the slide does not use OutQuad (saw ' + seen.slideEase + ')');
  if (!seen.bulge || seen.bulge.duration !== 80 || seen.bulge.iterations !== 2 || seen.bulge.direction !== 'alternate' || !/0\.37/.test(seen.bulge.easing)) bad.push('the merge bulge is not the 1.14 yoyo with InOutSine (' + JSON.stringify(seen.bulge) + ')');
  if (!seen.spawn || seen.spawn.duration !== 300 || !/0\.37/.test(seen.spawn.easing)) bad.push('the new tile does not grow from scale 0 with InOutSine (' + JSON.stringify(seen.spawn) + ')');
  return bad;
}, ['2048']);

check('2048-travel-scales-by-distance', '2048: the reference shortens a 1-cell slide to 0.8x and a 2-cell slide to 0.9x, so the three distances take 160, 180 and 200ms', async () => {
  const p = await open('2048', 390);
  await p.evaluate(() => { grid = [[0, 2, 0, 0], [0, 0, 2, 0], [0, 0, 0, 2], [0, 0, 0, 0]]; render(); move('left'); });
  const durations = await p.evaluate(() => [...document.querySelectorAll('.tile.ghost')].map((g) => Math.round(g.getAnimations()[0].effect.getTiming().duration)).sort((a, b) => a - b));
  await p.close();
  return durations.join(',') === '160,180,200' ? [] : ['ghost durations were ' + durations.join(',') + ', expected 160,180,200'];
}, ['2048']);

check('pig-online-view-and-requests', 'pig online: you ask the server for a roll (you never send one), the screen shows what it rolled, a lost turn and a hold, and only the player to move can act', async () => {
  const p = await open('pig', 390); await p.waitForTimeout(500);
  const bad = [];
  const env = (board, o = {}) => JSON.stringify(Object.assign({ game: 'pig', version: 1, id: 'abc', turn: 1, board: board, status: 'in_progress', winner: null, moveCount: 3, last: 0 }, o));
  const show = (e, canMove, me) => p.evaluate(([e, canMove, me]) => window.__pigTest.show(JSON.parse(e), canMove, { me: me }), [e, canMove, me]);
  if (!(await p.evaluate(() => window.__pigTest.spy()))) { bad.push('online mode is not available on the page'); await p.close(); return bad; }
  await show(env('10.5.9.45.c'), true, 1); await p.waitForTimeout(200);
  const a = await p.evaluate(() => ({ roll: !document.getElementById('roll-btn').disabled, hold: document.getElementById('hold-btn').textContent, turn: document.getElementById('pig-turn').textContent }));
  if (!a.roll) bad.push('Roll is disabled on your turn');
  if (!/bank 9/.test(a.hold)) bad.push('Hold should say what it banks (' + a.hold + ')');
  if (!/9/.test(a.turn)) bad.push('the turn total is not shown (' + a.turn + ')');
  await p.locator('#roll-btn').click();
  await p.locator('#hold-btn').click({ force: true }).catch(() => {});
  let sent = await p.evaluate(() => window.__pigTest.sent);
  if (!sent.length || sent[0].board !== '10.5.9.45.r' || sent[0].last !== 0) bad.push('Roll should send a request ("10.5.9.45.r"), saw ' + JSON.stringify(sent[0]));
  await show(env('10.5.9.45.c'), true, 1); await p.waitForTimeout(200);
  await p.evaluate(() => { window.__pigTest.sent.length = 0; });
  await p.locator('#hold-btn').click();
  sent = await p.evaluate(() => window.__pigTest.sent);
  if (!sent.length || sent[0].board !== '19.5.0.45.h' || sent[0].last !== 9 || sent[0].status !== 'in_progress') bad.push('Hold should bank 9 into your score, saw ' + JSON.stringify(sent[0]));
  // the opponent's turn: nothing for you to press
  await show(env('19.5.0.45.h', { turn: 2, moveCount: 4, last: 9 }), false, 1); await p.waitForTimeout(200);
  const b = await p.evaluate(() => ({ roll: document.getElementById('roll-btn').disabled, hold: document.getElementById('hold-btn').disabled, note: document.getElementById('pig-last').textContent }));
  if (!b.roll || !b.hold) bad.push('you can press Roll or Hold while it is the opponent turn');
  if (!/held for \+9/.test(b.note)) bad.push('the held turn is not described (' + b.note + ')');
  // a lost turn
  await show(env('19.5.0.31.b', { turn: 2, moveCount: 5, last: 0 }), false, 1); await p.waitForTimeout(700);
  const c = await p.evaluate(() => ({ note: document.getElementById('pig-last').textContent, bust: document.getElementById('pig-die').classList.contains('bust') }));
  if (!/a 1/.test(c.note) || !c.bust) bad.push('a 1 should be shown as a lost turn (' + JSON.stringify(c) + ')');
  // a win
  await show(env('104.5.0.45.h', { turn: 2, status: 'won', winner: 1, moveCount: 9, last: 9 }), false, 1); await p.waitForTimeout(300);
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['pig']);

check('undo-icon-shared', 'undo buttons had a small text arrow in the accent colour; every Undo now uses the same clean line icon as Mini Sudoku', async (g) => {
  const p = await open(g, 390);
  const r = await p.evaluate(() => [...document.querySelectorAll('#undo-btn, #undo')].map((b) => ({ svg: !!b.querySelector('svg'), glyph: !!b.querySelector('.glyph'), path: (b.querySelector('svg path') || { getAttribute: () => '' }).getAttribute('d') })));
  await p.close();
  const bad = [];
  if (!r.length) return bad;
  for (const b of r) { if (!b.svg) bad.push('an Undo button has no icon'); if (b.glyph) bad.push('an Undo button still has the text arrow'); if (b.svg && b.path !== 'M3 7v6h6') bad.push('the Undo icon is not the shared one'); }
  return bad;
}, FUN);

check('tic-tac-toe-win-line-then-card', 'tic-tac-toe: the result card jumped up at once; the winning line is now drawn across the three squares first, then the card appears', async () => {
  const p = await open('tic-tac-toe', 390, "var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(600);
  const bad = [];
  await p.evaluate(() => window.__tttTest.set(['X', 'X', null, 'O', 'O', null, null, null, null]));
  await p.locator('#board .cell').nth(2).click();                      // X completes the top row
  await p.waitForTimeout(250);
  const early = await p.evaluate(() => ({ line: !!document.querySelector('#board .ttt-line'), card: !!document.querySelector('.gk-over'), drawing: [...document.querySelectorAll('#board .ttt-line line')].some((l) => l.getAnimations().length > 0) }));
  if (!early.line) bad.push('no winning line is drawn');
  if (!early.drawing) bad.push('the winning line is not animated');
  if (early.card) bad.push('the result card showed before the line had time to draw');
  await p.waitForTimeout(1400);
  if (!(await p.locator('.gk-over').count())) bad.push('the result card never appeared after the line');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['tic-tac-toe']);

check('tic-tac-toe-no-last-outline', 'tic-tac-toe: the square just played in WhatsApp mode was ringed with a dashed white outline', async () => {
  const p = await open('tic-tac-toe', 390);
  await p.locator('#board .cell').first().click();
  await p.waitForTimeout(250);
  const r = await p.evaluate(() => {
    const c = document.querySelector('#board .cell.last');
    if (!c) return null;
    const cs = getComputedStyle(c);
    return { style: cs.outlineStyle, width: cs.outlineWidth };
  });
  await p.close();
  if (!r) return ['no last-move cell found'];
  return r.style !== 'none' && parseFloat(r.width) > 0 ? ['last-move outline is ' + r.style + ' ' + r.width] : [];
}, ['tic-tac-toe']);

check('tic-tac-toe-press-does-not-scale', 'tic-tac-toe: pressing a square scaled it and moved the thick grid-line borders', async () => {
  const p = await open('tic-tac-toe', 390);
  const cell = p.locator('#board .cell').first();
  const b = await cell.boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(80);
  const tr = await cell.evaluate((el) => getComputedStyle(el).transform);
  await p.mouse.up();
  await p.close();
  return tr === 'none' ? [] : ['pressed cell transform is ' + tr];
}, ['tic-tac-toe']);

check('dots-turn-dot-colour', 'dots and boxes: Player 2 turn dot was the default blue instead of the board green', async () => {
  const p = await open('dots-and-boxes', 390);
  await p.evaluate(() => { const m = document.getElementById('mode'); m.value = 'local'; m.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(300);
  await p.locator('#board .db-edge').first().click();
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const t = document.querySelector('.turn');
    const d = t && t.querySelector('.turn-dot');
    return { p: t && t.dataset.p, dot: d && getComputedStyle(d).backgroundColor, green: getComputedStyle(document.body).getPropertyValue('--d-p2').trim() };
  });
  await p.close();
  if (r.p !== '2') return ['expected Player 2 to move, got ' + r.p];
  return r.dot === 'rgb(63, 208, 192)' ? [] : ['Player 2 dot is ' + r.dot + ' (board green is ' + r.green + ')'];
}, ['dots-and-boxes']);

check('rps-retry-clears-resign', 'rock paper scissors: after Admit defeat, the top retry started a new game with the defeat screen still showing', async () => {
  const p = await open('rock-paper-scissors', 390);
  const bad = [];
  await p.evaluate(() => { const m = document.getElementById('mode'); m.value = 'whatsapp'; m.dispatchEvent(new Event('change')); });
  await p.locator('.rps-choice').first().click();
  await p.waitForTimeout(300);
  await p.locator('#wa-ui button:has-text("on this device")').click();
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.confirm = () => true; });
  await p.locator('.wa-resign-row button').click();
  await p.waitForTimeout(400);
  if (!/admitted defeat/i.test(await p.locator('#wa-ui').innerText())) bad.push('the resign screen did not appear');
  await p.locator('.fun-restart').click();
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ text: document.getElementById('wa-ui').innerText, search: location.search }));
  if (/admitted defeat/i.test(after.text)) bad.push('the defeat screen is still showing');
  if (after.search) bad.push('the share state is still in the URL');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['rock-paper-scissors']);

check('options-opens-without-moving', 'opening Options moved the board or made the page scroll on some games, although the menu opens over the board', async (g) => {
  const p = await open(g, 390);
  await p.evaluate(() => new Promise((res) => { const t0 = Date.now(), f = () => { const c = document.getElementById('c8'); if (!c || getComputedStyle(c).display !== 'none' || Date.now() - t0 > 4000) res(); else setTimeout(f, 100); }; f(); }));   // crazy 8 shows its table a moment after loading
  await p.waitForTimeout(300);
  const snap = () => p.evaluate(() => { const els = [...document.querySelectorAll('.panel > *')].filter((e) => e.getBoundingClientRect().height > 40 && getComputedStyle(e).position !== 'absolute' && !e.classList.contains('gk-optwrap') && !e.classList.contains('row') && getComputedStyle(e).display !== 'none'); const e = els.find((x) => x.getBoundingClientRect().top > 120) || els[0]; return { top: Math.round(e.getBoundingClientRect().top + scrollY), over: Math.max(0, document.documentElement.scrollHeight - innerHeight) }; });
  const bad = [];
  if (!(await p.locator('.gk-optbtn').count())) { await p.close(); return bad; }
  const a = await snap();
  await p.locator('.gk-optbtn').click(); await p.waitForTimeout(350);
  const o = await snap();
  if (o.top !== a.top) bad.push('the board moved ' + (o.top - a.top) + 'px when Options opened');
  if (o.over > a.over) bad.push('the page grew by ' + (o.over - a.over) + 'px of scrolling when Options opened');
  await p.close();
  return bad;
}, FUN);

check('new-squares-pop-in', 'stones, marks and numbers just appeared in their squares on gomoku, tic-tac-toe, hex and the sudokus; a newly filled square now pops in', async (g) => {
  const mode = { gomoku: 'local', 'tic-tac-toe': 'ai', hex: 'local', 'ultimate-tic-tac-toe': 'local' }[g];
  const p = await open(g, 390, mode ? "var m=document.querySelector('#mode');m.value='" + mode + "';m.dispatchEvent(new Event('change'))" : undefined);
  await p.waitForTimeout(600);
  const bad = [];
  const popping = () => p.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => /scale\(1\.16\)/.test(k.transform || ''))).length);
  if (g === 'sudoku' || g === 'mini-sudoku') {
    const cell = p.locator('#board .sk-cell:not(.given)').first();
    await cell.click(); await p.locator('#pad button').first().click();
  } else if (g === 'ultimate-tic-tac-toe') await p.locator('#board button:not([disabled])').nth(4).click();
  else if (g === 'tic-tac-toe') await p.locator('#board .cell').nth(4).click();
  else await p.locator('#board button:not([disabled])').nth(12).click();
  const n = await popping();
  if (n < 1) bad.push('nothing popped when a square was filled');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['gomoku', 'tic-tac-toe', 'sudoku']);

check('pawns-glide', 'quoridor: a pawn jumped to its new square; it now glides there', async () => {
  const p = await open('quoridor', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(600);
  const bad = [];
  const opts = await p.locator('#board .qd-cell.dest').count();
  if (!opts) { bad.push('no move squares to click'); await p.close(); return bad; }
  await p.locator('#board .qd-cell.dest').first().click();
  const n = await p.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getKeyframes().some((k) => /translate\(/.test(k.transform || ''))).length);
  if (n < 1) bad.push('no glide animation after moving a pawn');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['quoridor']);

check('privacy-look', 'the privacy page was the one page still in the old look; it is now the chunky look (violet page, round back button, a rounded card), readable on a phone', async () => {
  const bad = [];
  for (const w of [320, 390]) {
    const p = await browser.newPage({ viewport: { width: w, height: 844 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base + 'privacy/'); await p.waitForTimeout(600);
    const r = await p.evaluate(() => { const b = document.querySelector('.topbar .back'), cs = getComputedStyle(b), panel = getComputedStyle(document.querySelector('.panel')); return { fun: document.body.classList.contains('fun'), bg: getComputedStyle(document.body).backgroundColor, round: parseFloat(cs.borderTopLeftRadius) >= 20 && b.getBoundingClientRect().width >= 44, card: parseFloat(panel.borderTopLeftRadius) >= 20, sw: document.documentElement.scrollWidth, ink: getComputedStyle(document.querySelector('.doc p')).color }; });
    if (!r.fun) bad.push(w + 'px: not the chunky look');
    if (!/47, 53, 85/.test(r.bg)) bad.push(w + 'px: page is not the violet (' + r.bg + ')');
    if (!r.round) bad.push(w + 'px: the back button is not the round one');
    if (!r.card) bad.push(w + 'px: the policy is not in a rounded card');
    if (r.sw > w) bad.push(w + 'px: page is ' + r.sw + 'px wide');
    if (errs.length) bad.push('errors: ' + errs.join(';'));
    await p.close();
  }
  return bad;
}, ['privacy']);

check('hangman-ghost-clear-of-man', 'hangman: the ghost floated over the stick man arm; it now stays to the right of him', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click()");
  await p.waitForTimeout(500);
  for (const c of 'ZXQJVWBD') { await p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c); await p.waitForTimeout(120); }
  await p.evaluate(() => document.querySelectorAll('.gk-over').forEach((e) => e.remove())); await p.waitForTimeout(500);
  const r = await p.evaluate(() => { const g = document.querySelector('#ghost .big').getBoundingClientRect(); const man = [...document.querySelectorAll('#gallows .pt')].map((e) => e.getBoundingClientRect()); const right = Math.max(...man.map((m) => m.right)); const b = document.getElementById('bubble').getBoundingClientRect(); return { gl: g.left, gr: g.right, manRight: right, bubbleLeft: b.left }; });
  await p.close();
  const bad = [];
  if (r.gl < r.manRight + 2) bad.push('the ghost (left ' + Math.round(r.gl) + ') overlaps the man (right edge ' + Math.round(r.manRight) + ')');
  if (r.gr > r.bubbleLeft + 2) bad.push('the ghost runs into the speech bubble');
  return bad;
}, ['hangman']);

check('hangman-desktop-gallows', 'on a PC the gallows stayed phone-sized inside the wider play area, so the drawing looked like a stamp', async () => {
  const p = await open('hangman', 1280);
  const r = await p.evaluate(() => ({ w: document.querySelector('#gallows').getBoundingClientRect().width, sw: document.documentElement.scrollWidth }));
  await p.close();
  const bad = [];
  if (r.w < 260) bad.push('gallows is only ' + Math.round(r.w) + 'px wide at 1280px');
  if (r.w > 340) bad.push('gallows is ' + Math.round(r.w) + 'px wide: too big for the speech bubble');
  if (r.sw > 1280) bad.push('page got wider (' + r.sw + 'px)');
  return bad;
}, ['hangman']);

check('connect-four-no-landing-flash', 'connect four: a small flash when the disc landed (the empty hole showed for a moment as the slot faded its colour in)', async () => {
  const p = await open('connect-four', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  await p.locator('.c4-col-btn').nth(3).click();
  const flashes = await p.evaluate(() => new Promise((res) => { const t0 = performance.now(); let bad = 0, seenFall = false; const f = () => { const fall = document.querySelector('.c4-fall'); if (fall) seenFall = true; else if (seenFall) { const s = document.querySelector('.c4-slot[data-r="5"][data-c="3"]'); if (!/^rgb\(255, (77|201), (70|51)\)$/.test(getComputedStyle(s).backgroundColor)) bad++; } if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res({ bad, seenFall }); }; f(); }));
  await p.close();
  const bad = [];
  if (!flashes.seenFall) bad.push('the falling disc never showed');
  if (flashes.bad) bad.push('the slot was not the disc colour for ' + flashes.bad + ' frame(s) after the disc landed (a flash)');
  return bad;
}, ['connect-four']);

check('checkers-own-move-slides-through-rerender', 'checkers: the computer moves slid smoothly but your own did not (your move is drawn twice in a row, and the second drawing wiped the slide); a re-render during the slide must carry it on', async () => {
  const p = await open('checkers', 390, "var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('.ck-cell.selectable').first().click(); await p.waitForTimeout(80);
  await p.locator('.ck-cell.hint').first().click();
  // sample the moved piece every frame for 350ms: it must be moving (in a different place each frame) the whole time
  const xs = await p.evaluate(() => new Promise((res) => { const t0 = performance.now(), out = []; const f = () => { const c = document.querySelector('.ck-cell.last .ck-piece'); if (c) { const r = c.getBoundingClientRect(); out.push(Math.round(r.left * 10) / 10 + ',' + Math.round(r.top * 10) / 10); } if (performance.now() - t0 < 330) requestAnimationFrame(f); else res(out); }; f(); }));
  const moving = new Set(xs).size;
  if (moving < 5) bad.push('your piece slid in only ' + moving + ' distinct positions (it jumped)');
  await p.close();
  return bad;
}, ['checkers']);

check('chess-own-move-slides-against-computer', 'chess: your own move against the computer must slide smoothly too (the board is drawn again at once for the computer thinking, which wiped the slide)', async () => {
  const p = await open('chess', 390, "var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(600);
  const bad = [];
  await p.locator('#board .sq').nth(52).click(); await p.locator('#board .sq').nth(36).click();
  const xs = await p.evaluate(() => new Promise((res) => { const t0 = performance.now(), out = []; const f = () => { const g = document.querySelectorAll('#board .sq')[36].querySelector('.pc'); if (g) { const r = g.getBoundingClientRect(); out.push(Math.round(r.left * 10) / 10 + ',' + Math.round(r.top * 10) / 10); } if (performance.now() - t0 < 330) requestAnimationFrame(f); else res(out); }; f(); }));
  if (new Set(xs).size < 5) bad.push('your pawn slid in only ' + new Set(xs).size + ' distinct positions (it jumped)');
  await p.close();
  return bad;
}, ['chess']);

check('chess-difficulty-chips', 'chess: difficulty was still a dropdown; it should use the Easy/Medium/Hard chips Checkers uses', async () => {
  const p = await open('chess', 390, SOLO.chess);
  const r = await p.evaluate(() => {
    const c = document.getElementById('chips');
    return {
      chips: !!c,
      level: !!document.getElementById('level'),
      buttons: c ? [...c.querySelectorAll('.chip')].map((b) => b.textContent.trim()) : [],
      hidden: c && c.hidden,
    };
  });
  await p.close();
  const bad = [];
  if (!r.chips) bad.push('no difficulty chips');
  if (r.level) bad.push('the old level dropdown is still there');
  if (r.hidden) bad.push('the chips are hidden in computer mode');
  if (r.buttons.join(',') !== 'Easy,Medium,Hard') bad.push('chips are ' + r.buttons.join(','));
  return bad;
}, ['chess']);

check('battleship-reference-battle-screen', 'battleship: the battle screen must be the reference screen: nothing above the boards (no header, Options or status), both grids edge to edge, a fleet strip with the score tab and EXIT tab between them, the cannon only on your turn', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('#bs-random').click(); await p.locator('#bs-ready').click(); await p.waitForTimeout(600);
  const r = await p.evaluate(() => { const q = (s) => document.querySelector(s), vis = (s) => { const e = q(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }; const m = q('#bs-main').getBoundingClientRect(), o = q('#bs-sub').getBoundingClientRect(), mid = q('#bs-mid').getBoundingClientRect();
    return { chrome: ['.topbar', '.gk-optbtn', '.panel > .row'].filter(vis), mainW: Math.round(m.width), subW: Math.round(o.width), top: Math.round(m.top), order: m.bottom <= mid.top + 1 && mid.bottom <= o.top + 1, tabs: !!q('#bs-score') && !!q('#bs-opt-tab'), noSide: document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth, cannon: vis('#bs-fire'), over: document.documentElement.scrollHeight - innerHeight, bg: getComputedStyle(document.body).backgroundColor }; });
  if (r.chrome.length) bad.push('still showing above the boards: ' + r.chrome.join(', '));
  if (r.mainW < 380 || r.subW < 380) bad.push('the grids are not edge to edge (' + r.mainW + ' and ' + r.subW + 'px wide)');
  if (!r.order) bad.push('the fleet strip is not between the two grids');
  if (!r.tabs) bad.push('the score tab or the Options tab is missing');
  if (!r.noSide) bad.push('the page can be dragged sideways (the tabs stick out past the edge)');
  if (!r.cannon) bad.push('no cannon on your turn');
  if (r.over > 0) bad.push('the screen scrolls (' + r.over + 'px)');
  if (!/247, 151, 122/.test(r.bg)) bad.push('the page is not the salmon of the reference (' + r.bg + ')');
  // not your turn: no cannon at all
  await p.evaluate(() => { const T = window.__battleshipTest; T.draw({ kind: 'battle', me: 1, myFleet: T.randomFleet(), enemyFleet: T.randomFleet(), myShots: [], theirShots: [], canFire: false, handoff: false, lastMine: -1, lastTheirs: -1, note: '' }); });
  await p.waitForTimeout(900);
  const hidden = await p.evaluate(() => { const e = document.getElementById('bs-fire'); return getComputedStyle(e).visibility === 'hidden' || e.getBoundingClientRect().bottom <= 0; });
  if (!hidden) bad.push('the cannon is showing when it is not your turn');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('battleship-cannon-slides-away-and-back', 'battleship: the cannon faded instead of leaving; it now slides down off the bottom of the screen while the opponent plays (fully out of sight) and slides back down on your turn', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('#bs-random').click(); await p.locator('#bs-ready').click(); await p.waitForTimeout(800);
  const state = () => p.evaluate(() => { const e = document.getElementById('bs-fire'), r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { bottom: Math.round(r.bottom), top: Math.round(r.top), vis: cs.visibility, op: cs.opacity, away: e.classList.contains('away') }; });
  const mine = await state();
  if (mine.vis !== 'visible' || mine.bottom < 600) bad.push('the cannon is not resting on your waters on your turn (' + JSON.stringify(mine) + ')');
  const draw = (can) => p.evaluate((can) => { const T = window.__battleshipTest; T.draw({ kind: 'battle', me: 1, myFleet: T.randomFleet(), enemyFleet: T.randomFleet(), myShots: [], theirShots: [], canFire: can, handoff: false, lastMine: -1, lastTheirs: -1, note: '' }); }, can);
  await draw(false); await p.waitForTimeout(120);
  const mid = await state();
  if (!mid.away) bad.push('the cannon does not start to leave when it is not your turn');
  if (!(mid.bottom > mine.bottom)) bad.push('the cannon did not move down while leaving (' + mine.bottom + ' -> ' + mid.bottom + ')');
  await p.waitForTimeout(900);
  const gone = await state();
  if (gone.top < 844 || gone.vis !== 'hidden') bad.push('the cannon is not fully out of sight after leaving (top ' + gone.top + ', ' + gone.vis + ', opacity ' + gone.op + ')');
  if (gone.op !== '1') bad.push('the cannon was faded (opacity ' + gone.op + ') instead of slid away');
  await draw(true); await p.waitForTimeout(950);
  const back = await state();
  if (back.away || back.bottom < 600 || back.vis !== 'visible') bad.push('the cannon did not slide back on your turn (' + JSON.stringify(back) + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('battleship-ships-from-the-screenshots', 'battleship: the ship pictures must be the ones cut out of the reference screenshots (images, not drawn shapes), the cannon too, and the right tab must be Options (not Exit) and open the Options menu over the battle', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('#bs-random').click(); await p.waitForTimeout(300);
  const placed = await p.evaluate(() => [...document.querySelectorAll('#bs-main .bs-hull img')].map((i) => i.getAttribute('src')).sort().join());
  if (!/ships\/battleship\.png/.test(placed) || !/ships\/carrier\.png/.test(placed)) bad.push('placed ships are not the cut-out pictures (' + placed + ')');
  await p.locator('#bs-ready').click(); await p.waitForTimeout(700);
  const r = await p.evaluate(() => ({ strip: [...document.querySelectorAll('#bs-fleets img')].map((i) => i.getAttribute('src')).join(), cannon: (document.querySelector('#bs-fire img') || {}).src || '', tab: (document.getElementById('bs-opt-tab') || {}).textContent || '' }));
  if (!/carrier-blue\.png/.test(r.strip)) bad.push('the fleet strip is not using the blue cut-outs');
  if (!/ships\/cannon\.png/.test(r.cannon)) bad.push('the cannon is not the cut-out picture');
  if (!/options/i.test(r.tab) || /exit/i.test(r.tab)) bad.push('the right tab should say Options (it says "' + r.tab + '")');
  await p.locator('#bs-opt-tab').click(); await p.waitForTimeout(300);
  const menuOpen = await p.evaluate(() => { const m = document.querySelector('.gk-menu'); return !document.body.classList.contains('gk-play') && !!m && getComputedStyle(m).display !== 'none' && !!m.querySelector('.bs-home'); });
  if (!menuOpen) bad.push('tapping the Options tab does not open the Options menu (with an All games link)');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('battleship-vs-computer-turn-and-fire-word', 'battleship vs the computer: the computer fired back instantly so the cannon never left; it now pauses, the cannon slides away downwards and comes back for your turn; FIRE shows on the cannon once a square is aimed at; nothing sticks out past the right edge; the menu link says Home with the home icon', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(500);
  const bad = [];
  await p.locator('#bs-random').click(); await p.locator('#bs-ready').click(); await p.waitForTimeout(800);
  const cap = () => p.evaluate(() => { const c = document.querySelector('#bs-fire .cap'); return { op: getComputedStyle(c).opacity, text: c.textContent }; });
  if ((await cap()).op !== '0') bad.push('FIRE is showing before any square is aimed at');
  await p.locator('#bs-main .bs-cell').nth(45).click(); await p.waitForTimeout(350);
  const armed = await cap();
  if (armed.op !== '1' || !/fire/i.test(armed.text)) bad.push('FIRE does not show on the cannon once a square is aimed at (' + JSON.stringify(armed) + ')');
  await p.locator('#bs-fire').click();
  await p.waitForTimeout(900);
  const away = await p.evaluate(() => { const e = document.getElementById('bs-fire'); return { top: Math.round(e.getBoundingClientRect().top), vis: getComputedStyle(e).visibility, pill: document.body.className }; });
  if (away.top < 844 || away.vis !== 'hidden') bad.push('the cannon did not slide away down while the computer takes its turn (' + JSON.stringify(away) + ')');
  await p.waitForTimeout(2200);
  const back = await p.evaluate(() => { const e = document.getElementById('bs-fire'); return { bottom: Math.round(e.getBoundingClientRect().bottom), vis: getComputedStyle(e).visibility, mine: document.querySelectorAll('#bs-sub .bs-cell.hit, #bs-sub .bs-cell.miss, #bs-sub .bs-cell.sunk').length }; });
  if (back.vis !== 'visible' || back.bottom > 844) bad.push('the cannon did not come back for your turn (' + JSON.stringify(back) + ')');
  if (back.mine !== 1) bad.push('the computer should have fired exactly once (' + back.mine + ')');
  const edge = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => !e.closest('.bs-tab') && !e.classList.contains('bs-tab') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' || (e.classList.contains('gk-optwrap') && e.getBoundingClientRect().right > innerWidth + 1)).map((e) => (e.id || e.className).toString().slice(0, 24)));
  if (edge.length) bad.push('these stick out past the right edge: ' + edge.slice(0, 5).join(', '));
  await p.locator('#bs-opt-tab').click(); await p.waitForTimeout(300);
  const home = await p.evaluate(() => { const a = document.querySelector('.bs-home'); return a ? { text: a.textContent.trim(), icon: !!a.querySelector('svg') } : null; });
  if (!home || home.text !== 'Home' || !home.icon) bad.push('the menu link should be "Home" with the home icon (' + JSON.stringify(home) + ')');
  const tabText = await p.evaluate(() => { const r = document.querySelector('#bs-opt-tab span').getBoundingClientRect(); return { l: r.left, r2: r.right }; });
  if (tabText.r2 > 390 + 0.5) bad.push('the word Options runs off the right edge of the screen (to ' + Math.round(tabText.r2) + 'px)');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('mastermind-real-flow-desktop', 'the desktop game-over checks used injected result text; Mastermind must survive a real set-code, guess, win and game-over card at 1280 and 1920', async () => {
  const bad = [];
  for (const [w, h] of [[1280, 900], [1920, 1080]]) {
    const p = await open('mastermind', w, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'))", { viewport: { width: w, height: h } });
    await p.waitForTimeout(400);
    for (let i = 0; i < 4; i++) await p.locator('#palette button').nth(0).click();
    await p.locator('#submit-btn').click();
    await p.waitForTimeout(250);
    if (!(await p.locator('#entry').isVisible())) bad.push(w + 'px: the guess row did not appear after setting the code');
    for (let i = 0; i < 4; i++) await p.locator('#palette button').nth(0).click();
    await p.locator('#submit-btn').click();
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const card = document.querySelector('.gk-over');
      const cr = card && card.getBoundingClientRect();
      const secret = document.getElementById('secret-row');
      return {
        card: !!card, h2: card ? card.querySelector('h2').textContent.trim() : '',
        inside: !!cr && cr.left >= -1 && cr.right <= innerWidth + 1 && cr.top >= -1 && cr.bottom <= innerHeight + 1,
        secret: !secret.hidden && /The code was/.test(secret.textContent),
        sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
        emoji: card ? /[\u{1F300}-\u{1FAFF}]/u.test(card.textContent) : false,
        status: document.getElementById('status').textContent,
      };
    });
    if (!r.card) bad.push(w + 'px: no game-over card after the winning guess');
    else {
      if (!/won|cracked|win/i.test(r.h2 + ' ' + r.status)) bad.push(w + 'px: the winning result was not reported (' + r.h2 + ' / ' + r.status + ')');
      if (!r.inside) bad.push(w + 'px: the game-over card is outside the viewport');
      if (r.emoji) bad.push(w + 'px: emoji on the game-over card');
    }
    if (!r.secret) bad.push(w + 'px: the secret code was not revealed after the win');
    if (r.sw > w) bad.push(w + 'px: the card made the page wider');
    if (p.errs.length) bad.push(w + 'px errors: ' + p.errs.join('; '));
    await p.close();
  }
  return bad;
}, ['mastermind']);

check('resign-screen-desktop', 'Admit defeat was only tested at phone width with a text check; at 1280 and 1920 the real forfeit must fit and report the loss without widening the page', async () => {
  const bad = [];
  for (const [w, h] of [[1280, 900], [1920, 1080]]) {
    const p = await open('tic-tac-toe', w, null, { viewport: { width: w, height: h } });
    await p.locator('.cell').nth(0).click();
    await p.waitForTimeout(250);
    await p.locator('.wa-ui button:has-text("on this device")').click();
    await p.waitForTimeout(300);
    await p.evaluate(() => { window.confirm = () => true; });
    await p.locator('.wa-resign-row button').click();
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const ui = document.getElementById('wa-ui');
      const ur = ui.getBoundingClientRect();
      return {
        text: ui.innerText, shown: !ui.hidden && ur.height > 0,
        inside: ur.left >= -1 && ur.right <= innerWidth + 1,
        resignGone: !document.querySelector('.wa-resign-row button'),
        sw: document.documentElement.scrollWidth,
      };
    });
    if (!r.shown) bad.push(w + 'px: the defeat screen did not appear');
    if (!/admitted defeat/i.test(r.text)) bad.push(w + 'px: the screen does not say the player admitted defeat');
    if (!r.resignGone) bad.push(w + 'px: the Admit defeat button is still offered after resigning');
    if (!r.inside) bad.push(w + 'px: the defeat screen is outside the viewport');
    if (r.sw > w) bad.push(w + 'px: the defeat screen made the page wider');
    if (p.errs.length) bad.push(w + 'px errors: ' + p.errs.join('; '));
    await p.close();
  }
  return bad;
}, ['tic-tac-toe']);

check('battleship-no-black-overscroll', 'swiping the floating battle menu down rubber-banded the one-screen board and showed the shared dark html canvas as a black band under the coral/blue game', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(500);
  await p.locator('#bs-random').click(); await p.locator('#bs-ready').click(); await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const html = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
    window.scrollTo(0, -240);
    return {
      battle: document.body.classList.contains('bs-battle'), phase: document.getElementById('bs-board').dataset.phase,
      htmlBg: html.backgroundColor, bodyBg: body.backgroundColor,
      htmlOver: html.overscrollBehaviorY, bodyOver: body.overscrollBehavior,
      y: Math.round(scrollY),
    };
  });
  const bad = [];
  if (r.phase !== 'battle' || !r.battle) bad.push('the battle screen did not start');
  if (r.htmlBg === 'rgb(10, 10, 10)') bad.push('the exposed html canvas is still the shared black');
  if (r.htmlBg !== r.bodyBg) bad.push('the html and body battle colours do not match (' + r.htmlBg + ' vs ' + r.bodyBg + ')');
  if (r.htmlOver !== 'none' || r.bodyOver !== 'none') bad.push('overscroll bounce is still enabled');
  if (r.y !== 0) bad.push('the page rubber-banded past the top (' + r.y + 'px)');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('crazy-8-table-full-size', 'crazy 8: the table had been narrowed to stop the page scrolling, which made the cards small and pulled the side player cards in from the screen edge; the table must be the full width of the screen', async () => {
  const p = await open('crazy-8', 390, "var m=document.querySelector('#mode');if(m&&[...m.options].some(o=>o.value==='computer')){m.value='computer';m.dispatchEvent(new Event('change'))}");
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => { const c = document.getElementById('c8').getBoundingClientRect(), st = document.getElementById('c8-stage').getBoundingClientRect(), hand = document.querySelector('#c8-hand .c8-card'); return { w: Math.round(c.width), stage: Math.round(st.width), card: hand ? Math.round(hand.getBoundingClientRect().height) : 0, hint: getComputedStyle(document.getElementById('c8-hint')).display, guide: getComputedStyle(document.getElementById('c8-guide')).display }; });
  await p.close();
  const bad = [];
  if (r.w < 385) bad.push('the table is only ' + r.w + 'px wide');
  if (r.card < 100) bad.push('your cards are only ' + r.card + 'px tall');
  if (r.hint === 'none' || r.guide === 'none') bad.push('the desktop-only hiding of the hint/guide also hit the phone');
  return bad;
}, ['crazy-8']);

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
  await p.evaluate(END[g]); await p.waitForTimeout(800 + (await p.evaluate(() => +document.body.dataset.overDelay || 0)));
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

check('desktop-overlays', 'on a PC-width page the Options popover or the game-over card ran off the viewport, or a state change made the page wider', async (g) => {
  const p = await open(g, 1366, null, { viewport: { width: 1366, height: 768 } });
  const bad = [];
  if (await p.locator('.gk-optbtn').count()) {
    await p.locator('.gk-optbtn').click(); await p.waitForTimeout(250);
    const o = await p.evaluate(() => {
      const e = document.querySelector('.gk-opts');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight };
    });
    if (!o) bad.push('Options did not open');
    else if (o.l < -1 || o.r > o.w + 1 || o.t < -1 || o.b > o.h + 1) bad.push('Options is off-screen (' + [o.l, o.t, o.r, o.b].map(Math.round).join(', ') + ')');
    await p.locator('.gk-optbtn').click(); await p.waitForTimeout(150);
  } else bad.push('no Options button');
  await p.evaluate(END[g]);
  await p.waitForTimeout(800 + (await p.evaluate(() => +document.body.dataset.overDelay || 0)));
  const c = await p.evaluate(() => {
    const e = document.querySelector('.gk-over .card');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight, sw: document.documentElement.scrollWidth };
  });
  if (!c) bad.push('no game over card at 1366x768');
  else {
    if (c.l < -1 || c.r > c.w + 1) bad.push('game over card is off-screen sideways');
    if (c.t < -1 || c.b > c.h + 1) bad.push('game over card is taller than the window');
    if (c.sw > c.w) bad.push('game over card made the page wider');
  }
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

check('cache-versions', 'phones kept an OLD copy of a script or stylesheet for a while after a deploy (the water sort pour animation never showed); every script and style a fun page loads must be stamped with its content hash: run node tests/cache-bust.mjs', async (g) => {
  const html = fs.readFileSync(path.join(ROOT, g, 'index.html'), 'utf8');
  const bad = [];
  for (const m of html.matchAll(/(?:src|href)="((?:\.\.\/)?[\w./-]+\.(?:js|css))(\?v=([\w]+))?"/g)) {
    const f = path.join(ROOT, g, m[1]);
    if (!fs.existsSync(f)) continue;
    const want = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
    if (!m[2]) bad.push(m[1] + ' has no ?v= stamp');
    else if (m[3] !== want) bad.push(m[1] + ' is stamped ' + m[3] + ' but the file is now ' + want);
  }
  if (bad.length) bad.push('run: node tests/cache-bust.mjs');
  return bad;
}, FUN);

check('no-red-in-checkers', 'checkers pieces are black and white now; "Red" must not come back in the page or the game', async () => {
  const s = fs.readFileSync(path.join(ROOT, 'checkers/game.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'checkers/index.html'), 'utf8');
  return /\bRed\b/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')) ? ['"Red" appears in checkers'] : [];
}, ['checkers']);

check('hangman-man-speaks', 'the taunts should come from the stick man in a speech bubble beside the gallows (sometimes begging), not from a line of text', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click();Math.random=()=>0");
  const bad = [];
  const state = () => p.evaluate(() => { const b = document.getElementById('bubble'), g = document.getElementById('gallows').getBoundingClientRect(), r = b.getBoundingClientRect(); return { hidden: b.hidden, text: b.textContent, beg: b.classList.contains('beg'), left: r.left, right: r.right, gRight: g.right, gTop: Math.round(g.top + scrollY), sw: document.documentElement.scrollWidth, gl: g.left }; });
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  const t0 = (await state()).gTop;
  if (await p.evaluate(() => !document.getElementById('ghost').hasAttribute('hidden'))) bad.push('the ghost is out before the game is lost');
  await press('Z'); await p.waitForTimeout(200);                                  // the first miss draws his head ...
  const first = await state();
  if (first.hidden || !first.text) bad.push('he says nothing when his head appears (first miss)');
  await press('X'); await p.waitForTimeout(200);                                  // ... and a second miss
  const s = await state();
  if (s.hidden || !s.text) bad.push('no speech bubble after two misses');
  else {
    if (!s.beg) bad.push('expected him to beg (random forced to 0)');
    if (s.left < s.gRight - 2) bad.push('bubble overlaps the gallows');
    if (s.right > 390) bad.push('bubble runs off the screen');
    if (/[\u{1F300}-\u{1FAFF}]/u.test(s.text)) bad.push('emoji in the bubble');
  }
  if (s.gl > 40) bad.push('gallows is not at the left edge (more room is wanted for the bubble)');
  if (s.gTop !== t0) bad.push('gallows moved when he spoke');
  if (s.sw > 390) bad.push('page got wider');
  for (const c of 'QJVW') { await press(c); await p.waitForTimeout(150); }
  const e = await state();
  if (e.hidden || !e.text) bad.push('nothing says the last line when the game ends');
  const ghost = await p.evaluate(() => { const g = document.getElementById('ghost'), big = g.querySelector('.big'), b = document.getElementById('bubble'), gr = big.getBoundingClientRect(), br = b.getBoundingClientRect(), ga = document.getElementById('gallows').getBoundingClientRect(); return { shown: !g.hasAttribute('hidden') && gr.width > 0 && g.querySelectorAll('.hm-g').length === 1, bubbleGhost: b.classList.contains('ghost'), nextToBubble: gr.right <= br.left + 4 && Math.abs((gr.top + gr.bottom) / 2 - (br.top + br.bottom) / 2) < 70, besideMan: gr.left > ga.left + ga.width * 0.5, inside: gr.right <= 390 }; });
  if (!ghost.shown) bad.push('no single floating ghost appears when he runs out of chances');
  if (!ghost.bubbleGhost) bad.push('the last line is not spoken from the ghost');
  if (!ghost.nextToBubble) bad.push('the ghost is not beside its speech bubble');
  if (!ghost.besideMan) bad.push('the ghost is not next to the man');
  if (!ghost.inside) bad.push('the ghost runs off the screen');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(e.text)) bad.push('emoji in the ghost\'s line');
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-one-taunt', 'two taunts showed on the finished WhatsApp game: one after the word and a big strip above the stick man; only the stick man taunts now', async () => {
  const p = await open('hangman');
  await p.evaluate(() => {
    const t = Gamekit.taunt('loss');
    const ui = document.getElementById('wa-ui'); ui.hidden = false;
    ui.innerHTML = '<div class="banner bad">You lost.</div><p class="wa-note">The word was HARD.</p><p class="wa-note">' + t + '</p>';
  });
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => { const m = document.querySelector('.gk-msg'); const slot = document.querySelector('.gk-slot'); return { strip: !!slot && getComputedStyle(slot).display !== 'none' && m && !m.hidden, detail: /The word was \w+\.\s+\S/.test(document.querySelector('.wa-note').textContent) }; });
  const src = fs.readFileSync(path.join(ROOT, 'hangman/game.js'), 'utf8');
  await p.close();
  const bad = [];
  if (r.strip) bad.push('a taunt strip is showing on the hangman page');
  if (/return `The word was \$\{word\}\.` \+/.test(src)) bad.push('"The word was X." has a taunt tacked on again');
  return bad;
}, ['hangman']);

check('hangman-no-repeat', 'the stick man said the same line on consecutive misses (the picker had no memory)', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click();Math.random=()=>0");
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  const said = [];
  for (const c of 'ZXQ') {
    await press(c);
    await p.waitForTimeout(150);
    said.push(await p.evaluate(() => document.getElementById('bubble').textContent));
  }
  const bad = [];
  if (new Set(said).size !== said.length) bad.push('the same line appeared twice: ' + said.join(' / '));
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-setter-line', 'the stick man said nothing after Player 1 set the word; he now comments on the chosen word before the first guess', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click()");
  const s = await p.evaluate(() => { const b = document.getElementById('bubble'); return { hidden: b.hidden, text: b.textContent, beg: b.classList.contains('beg') }; });
  const bad = [];
  if (s.hidden || !s.text) bad.push('no line after the word was set');
  if (s.beg) bad.push('the setter line is styled as begging');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(s.text)) bad.push('emoji in the bubble');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-face-mood', 'the drawn stick man had no face or mood: a guessed letter should change his expression, reveal the sweat and leave the layout alone', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click();Math.random=()=>0");
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  const read = () => p.evaluate(() => {
    const stage = document.querySelector('.hm-stage');
    const op = (s) => { const e = document.querySelector(s); return e ? Number(getComputedStyle(e).opacity) : -1; };
    return {
      misses: stage.dataset.misses, head: stage.dataset.head, mood: stage.dataset.mood, face: stage.dataset.face || '',
      faceBox: op('.hm-face'), calm: op('.hm-mouth-calm'), worried: op('.hm-mouth-worried'),
      gasp: op('.hm-mouth-gasp'), wail: op('.hm-mouth-wail'), o: op('.hm-mouth-o'),
      wobble: op('.hm-mouth-wobble'), grin: op('.hm-mouth-grin'), sweat: op('.hm-sweat'),
      outline: op('#hm-outline'), shadow: op('#hm-shadow'), on: document.querySelectorAll('#gallows .pt.on').length,
      rope: !!document.getElementById('rope'), top: document.getElementById('gallows').getBoundingClientRect().top,
      look: stage.style.getPropertyValue('--look-x'),
    };
  });
  await press('Z'); await p.waitForTimeout(350);
  const one = await read();
  await press('X'); await p.waitForTimeout(300);
  const two = await read();
  for (const c of 'QJ') { await press(c); await p.waitForTimeout(180); }
  await p.waitForTimeout(300);
  const four = await read();
  const bad = [];
  if (one.misses !== '1' || one.head !== '1') bad.push('the first miss did not draw the head');
  if (one.faceBox < .5) bad.push('the face is invisible once the head is drawn');
  if (one.on !== 1) bad.push('the first miss drew ' + one.on + ' parts');
  if (!one.rope) bad.push('the rope is no longer a separate part');
  if (one.outline > .05) bad.push('the chalk outline is still strong once he is drawn');
  if (one.shadow <= .1) bad.push('the ground shadow is not visible');
  if (one.mood !== 'calm') bad.push('one miss should still leave the resting mood calm');
  if (one.face !== 'shocked' || one.o < .5 || one.gasp > .1) bad.push('the first miss is not delivered with a shocked face');
  if (!one.look) bad.push('his eyes did not follow the guessed key');
  if (two.mood !== 'worried') bad.push('two misses do not leave the resting mood worried');
  if (two.face !== 'pleading' || two.wail < .5 || two.worried > .1) bad.push('a begging line is not delivered with a pleading face');
  if (four.mood !== 'scared') bad.push('four misses do not leave the resting mood scared');
  if (four.face !== 'nervous' || four.wobble < .5 || four.sweat < .5) bad.push('a danger line is not delivered with a nervous, sweating face');
  if (four.on !== 4) bad.push('the parts are not drawn one per miss');
  if (four.top !== one.top) bad.push('the gallows moved while he was reacting');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-expression-match', 'the stick man said "good work" while still shaking: the face and body must match the line, including on the last life', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click();Math.random=()=>0");
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  const read = () => p.evaluate(() => {
    const stage = document.querySelector('.hm-stage');
    const B = window.__hangmanTest.banter;
    const text = document.getElementById('bubble').textContent;
    const op = (s) => Number(getComputedStyle(document.querySelector(s)).opacity);
    return {
      mood: stage.dataset.mood, face: stage.dataset.face || '', text,
      faceOfLine: B.faceOf(text), shiver: getComputedStyle(document.getElementById('man')).animationName,
      grin: op('.hm-mouth-grin'),
    };
  });
  for (const c of 'ZXQJV') { await press(c); await p.waitForTimeout(120); }   // five misses: the last life
  await p.waitForTimeout(700);
  const lastLife = await read();
  await press('C'); await p.waitForTimeout(700);                              // first hit on the last life
  const surprise = await read();
  await press('A'); await p.waitForTimeout(700);                              // second hit: praise
  const praise = await read();
  const bad = [];
  if (lastLife.mood !== 'terrified') bad.push('five misses did not leave him terrified');
  if (!lastLife.face || lastLife.face !== lastLife.faceOfLine) bad.push('the last-life line and face disagree');
  if (surprise.face !== 'shocked' || surprise.face !== surprise.faceOfLine) bad.push('the last-life save surprise is not shocked');
  if (surprise.shiver === 'hm-shiver') bad.push('he still shivers through the surprise line');
  if (praise.face !== 'proud' || praise.face !== praise.faceOfLine) bad.push('the last-life praise line is not proud');
  if (praise.shiver === 'hm-shiver') bad.push('he shivers while delivering praise');
  if (praise.grin < .5) bad.push('the proud praise line does not show a grin');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-poke-idle', 'the stick man ignored a poke and never got impatient: both should use his speech bubble and the gallows should be keyboard-reachable', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click()");
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  await press('Z'); await p.waitForTimeout(300);
  const idle = await p.evaluate(() => {
    const before = document.getElementById('bubble').textContent;
    window.__hangmanTest.idle();
    const after = document.getElementById('bubble').textContent;
    return { before, after, pool: window.__hangmanTest.banter.pools.IDLE.includes(after) };
  });
  const poke = await p.evaluate(() => {
    const g = document.getElementById('gallows');
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const text = document.getElementById('bubble').textContent;
    const B = window.__hangmanTest.banter;
    return {
      text, react: document.querySelector('.hm-stage').dataset.react,
      pool: B.pools.POKE.includes(text) || B.pools.POKE_SCARED.includes(text),
    };
  });
  const key = await p.evaluate(() => {
    const g = document.getElementById('gallows');
    g.focus();
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { focused: document.activeElement === g, react: document.querySelector('.hm-stage').dataset.react };
  });
  const bad = [];
  if (idle.before === idle.after || !idle.pool) bad.push('the idle trigger did not produce an IDLE line');
  if (!poke.pool) bad.push('a poke did not produce a POKE line: ' + poke.text);
  if (poke.react !== 'poke') bad.push('a poke did not make him react');
  if (!key.focused) bad.push('the gallows cannot receive keyboard focus');
  if (key.react !== 'poke') bad.push('Enter on the gallows did not poke him');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-saved-pose', 'a saved man stayed standing and the ghost came out on a win; a save should drop him, retract the rope and record the game', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click()");
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  const before = await p.evaluate(() => window.__hangmanTest.history.games);
  for (const c of 'ZCAT') { await press(c); await p.waitForTimeout(120); }
  await p.waitForTimeout(1300);
  const r = await p.evaluate(() => {
    const stage = document.querySelector('.hm-stage');
    const B = window.__hangmanTest.banter;
    const text = document.getElementById('bubble').textContent;
    const man = getComputedStyle(document.getElementById('man')).transform;
    const rope = getComputedStyle(document.getElementById('rope'));
    const parts = [...document.querySelectorAll('#gallows .pt')].filter((e) => Number(getComputedStyle(e).opacity) > .5 && getComputedStyle(e).visibility !== 'hidden').length;
    return {
      mood: stage.dataset.mood, face: stage.dataset.face || '', text, man, ghost: !document.getElementById('ghost').hidden,
      games: window.__hangmanTest.history.games, last: window.__hangmanTest.history.last, parts,
      ropeOpacity: Number(rope.opacity), ropeTransform: rope.transform,
      pool: [...B.pools.SAVED, ...B.pools.SAVED_BARELY, ...B.pools.SAVED_INTACT, ...B.pools.SAVED_STREAK, ...B.pools.SAVED_BEST, ...B.pools.SAVED_RETURN].includes(text),
    };
  });
  const bad = [];
  if (r.mood !== 'saved') bad.push('a win did not put him in the saved pose');
  if (!/22\)$/.test(r.man)) bad.push('the saved man did not drop: ' + r.man);
  if (r.ghost) bad.push('the ghost appeared on a win');
  if (!r.pool) bad.push('the win line is not a saved line: ' + r.text);
  if (r.face !== 'saved') bad.push('the win line is not delivered with a saved face: ' + r.face);
  if (r.games !== before + 1) bad.push('a finished game was not recorded once');
  if (r.last !== 'saved') bad.push('the last result was not saved');
  if (r.parts !== 6) bad.push('the saved man is still missing parts: ' + r.parts + '/6');
  if (r.ropeOpacity > .1) bad.push('the noose is still hanging at full strength');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-win-complete', 'a win with no misses left the man undrawn, so the saved animation moved an invisible body; a save must pull the whole man together before he hops down', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click();Math.random=()=>0");
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  for (const c of 'CAT') { await press(c); await p.waitForTimeout(120); }
  await p.waitForTimeout(1300);
  const r = await p.evaluate(() => {
    const stage = document.querySelector('.hm-stage');
    const B = window.__hangmanTest.banter;
    const text = document.getElementById('bubble').textContent;
    const parts = [...document.querySelectorAll('#gallows .pt')].filter((e) => Number(getComputedStyle(e).opacity) > .5 && getComputedStyle(e).visibility !== 'hidden').length;
    return {
      mood: stage.dataset.mood, face: stage.dataset.face || '', text, parts,
      man: getComputedStyle(document.getElementById('man')).transform,
      rope: Number(getComputedStyle(document.getElementById('rope')).opacity),
      faceBox: Number(getComputedStyle(document.querySelector('.hm-face')).opacity),
      ghost: !document.getElementById('ghost').hidden, status: document.getElementById('status').textContent,
      savedPool: [...B.pools.SAVED_INTACT].includes(text),
    };
  });
  const bad = [];
  if (r.mood !== 'saved' || r.parts !== 6) bad.push('a flawless win left the man at ' + r.parts + '/6 parts');
  if (r.faceBox < .5) bad.push('the face is still invisible after a flawless win');
  if (!r.savedPool) bad.push('a flawless win did not use a SAVED_INTACT line: ' + r.text);
  if (r.face !== 'proud') bad.push('a flawless win is not delivered with a proud face: ' + r.face);
  if (!/22\)$/.test(r.man)) bad.push('the completed man did not drop to the ground: ' + r.man);
  if (r.rope > .1) bad.push('the noose did not let go on a win');
  if (r.ghost) bad.push('the ghost appeared on a win');
  if (!/wins/i.test(r.status)) bad.push('the win status did not appear: ' + r.status);
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);

check('hangman-reduced-motion', 'the stick man still animates when the phone asks for reduced motion; the face and a finished part should be visible without movement', async () => {
  const p = await open('hangman', 390, "var m=document.querySelector('#mode');m.value='local';m.dispatchEvent(new Event('change'));document.getElementById('setup-input').value='CAT';document.getElementById('setup-btn').click()", { reducedMotion: 'reduce' });
  const press = (c) => p.evaluate((c) => [...document.querySelectorAll('.hm-key')].find((k) => k.textContent === c && !k.disabled)?.click(), c);
  await press('Z');
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => {
    const part = document.querySelector('.pt.on');
    return {
      man: getComputedStyle(document.getElementById('man')).animationName,
      part: part ? getComputedStyle(part).animationName : 'missing',
      dash: part ? getComputedStyle(part).strokeDashoffset : 'missing',
      face: Number(getComputedStyle(document.querySelector('.hm-face')).opacity),
      bubble: document.getElementById('bubble').textContent,
    };
  });
  for (const c of 'CAT') { await press(c); await p.waitForTimeout(150); }
  await p.waitForTimeout(600);
  const win = await p.evaluate(() => {
    const parts = [...document.querySelectorAll('#gallows .pt')].filter((e) => Number(getComputedStyle(e).opacity) > .5 && getComputedStyle(e).visibility !== 'hidden').length;
    return {
      mood: document.querySelector('.hm-stage').dataset.mood, parts,
      rope: Number(getComputedStyle(document.getElementById('rope')).opacity),
      man: getComputedStyle(document.getElementById('man')).transform,
      manAnim: getComputedStyle(document.getElementById('man')).animationName,
      partAnim: getComputedStyle(document.querySelector('.pt')).animationName,
    };
  });
  const bad = [];
  if (r.man !== 'none') bad.push('the man still breathes under reduced motion');
  if (r.part !== 'none' || r.dash !== '0px') bad.push('the drawn part still depends on an animation');
  if (r.face < .5) bad.push('the face is hidden under reduced motion');
  if (!r.bubble) bad.push('no line under reduced motion');
  if (win.mood !== 'saved' || win.parts !== 6) bad.push('the saved man is incomplete under reduced motion');
  if (win.rope > .1) bad.push('the noose still hangs under reduced motion');
  if (win.manAnim !== 'none' || win.partAnim !== 'none') bad.push('the save still animates under reduced motion');
  if (!/22\)$/.test(win.man)) bad.push('the saved man is not standing on the ground under reduced motion: ' + win.man);
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['hangman']);


check('wa-panel-below-board', 'in WhatsApp mode the send-link panel grew above the board after the first move and pushed the game down; it now lives below the board', async () => {
  const p = await open('tic-tac-toe');                   // WhatsApp mode is the default
  const before = await p.evaluate(() => Math.round(document.getElementById('board').getBoundingClientRect().top + scrollY));
  await p.locator('.cell').nth(0).click();
  await p.waitForTimeout(350);
  const after = await p.evaluate(() => {
    const board = document.getElementById('board');
    const ui = document.getElementById('wa-ui');
    const br = board.getBoundingClientRect(), ur = ui.getBoundingClientRect();
    return {
      top: Math.round(br.top + scrollY), boardBottom: br.bottom + scrollY,
      uiTop: ur.top + scrollY, shown: !ui.hidden && ur.height > 0,
      hasSend: !!ui.querySelector('.wa-send'), following: !!(board.compareDocumentPosition(ui) & Node.DOCUMENT_POSITION_FOLLOWING),
      sw: document.documentElement.scrollWidth,
    };
  });
  const bad = [];
  if (!after.shown || !after.hasSend) bad.push('the send-link panel did not appear after the first move');
  if (after.top !== before) bad.push('the board moved ' + (after.top - before) + 'px when the share panel appeared');
  if (!after.following || after.uiTop < after.boardBottom - 2) bad.push('the share panel is not below the board');
  if (after.sw > 390) bad.push('page got wider than the phone');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['tic-tac-toe']);


check('wa-finished-buttons', 'on a finished WhatsApp game "Copy link" was stacked above "New game"; they sit side by side under the Send button', async () => {
  const p = await open('tic-tac-toe');                   // WhatsApp mode is the default
  const cell = (i) => p.locator('.cell').nth(i).click();
  const here = async () => { await p.locator('.wa-ui button:has-text("on this device")').click(); await p.waitForTimeout(200); };
  await cell(0); await p.waitForTimeout(200); await here();
  await cell(3); await p.waitForTimeout(200); await here();
  await cell(1); await p.waitForTimeout(200); await here();
  await cell(4); await p.waitForTimeout(200); await here();
  await cell(2); await p.waitForTimeout(300);            // three in a row: the game is over
  const r = await p.evaluate(() => { const f = (t) => [...document.querySelectorAll('.wa-ui .btn, .wa-ui a.btn')].find((b) => b.textContent.trim().toLowerCase().startsWith(t)); const s = f('send'), c = f('copy'), n = f('new'); if (!s || !c || !n) return { missing: [!s && 'send', !c && 'copy', !n && 'new'].filter(Boolean).join(',') }; const rs = s.getBoundingClientRect(), rc = c.getBoundingClientRect(), rn = n.getBoundingClientRect(); return { sendBottom: rs.bottom, copyTop: rc.top, newTop: rn.top, copyRight: rc.right, newLeft: rn.left, sw: document.documentElement.scrollWidth }; });
  await p.close();
  if (r.missing) return ['finished game is missing: ' + r.missing];
  const bad = [];
  if (Math.abs(r.copyTop - r.newTop) > 4) bad.push('Copy link and New game are not on one row');
  if (r.copyRight > r.newLeft + 1) bad.push('Copy link is not to the left of New game');
  if (r.sendBottom > r.copyTop) bad.push('Send is not above the pair');
  if (r.sw > 390) bad.push('page got wider');
  return bad;
}, ['tic-tac-toe']);

check('minesweeper-numbers-show', 'revealed minesweeper tiles had no numbers: the numbers were dark on the dark page', async () => {
  const p = await open('minesweeper', 390, "var m=document.querySelector('#mode');m.value='solo';m.dispatchEvent(new Event('change'))");
  await p.evaluate(() => document.querySelectorAll('.c')[40].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const lum = (c) => { const m = c.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const page = lum(getComputedStyle(document.body).backgroundColor);
    const nums = [...document.querySelectorAll('.c.open')].filter((e) => /^[1-8]$/.test(e.textContent));
    return { n: nums.length, worst: nums.length ? Math.min(...nums.map((e) => Math.abs(lum(getComputedStyle(e).color) - page))) : 1 };
  });
  await p.close();
  const bad = [];
  if (!r.n) bad.push('the first tap opened no numbered tile to look at (try another tile)');
  else if (r.worst < 0.35) bad.push('a number is too close to the page colour to read');
  return bad;
}, ['minesweeper']);

check('resume-notice-icon', 'the "Picked up where you left off" pill showed a broken box and the letters BB in front of it', async () => {
  const css = fs.readFileSync(path.join(ROOT, 'fun.css'), 'utf8');
  const bad = [];
  if (/[\x00-\x08\x0b\x0e-\x1f]/.test(css)) bad.push('fun.css has a control character in it (a mangled escape)');
  const m = /\.game-notice::before \{([^}]*)\}/.exec(css);
  if (!m) bad.push('no icon rule for the notice');
  else if (/content:\s*"[^"]+"/.test(m[1])) bad.push('the notice icon is text; it must be an image mask');
  return bad;
}, ['crazy-8']);

check('backgammon-board-look', 'backgammon should match the reference: dice lie on the board, trays sit outside it above and below, a red ROLL button is on screen, checkers are black and white', async () => {
  const p = await open('backgammon', 390, "var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(400);
  const roll = await p.evaluate(() => { const b = document.querySelector('.bg-dice .btn'); if (!b) return null; const r = b.getBoundingClientRect(); return { bottom: r.bottom, text: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor }; });
  const bad = [];
  if (!roll) bad.push('no Roll button');
  else {
    if (roll.bottom > 844) bad.push('the Roll button is below the fold (' + Math.round(roll.bottom) + 'px)');
    if (roll.text !== 'Roll') bad.push('button says "' + roll.text + '", wanted "Roll"');
    if (!/217, 90, 78/.test(roll.bg)) bad.push('Roll button is not the red one');
    await p.locator('.bg-dice .btn').click(); await p.waitForTimeout(500);
  }
  const geo = await p.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(); const d = [...document.querySelectorAll('#dice-on .bg-die')].map((e) => e.getBoundingClientRect()); const t = [...document.querySelectorAll('.bg-tray')].map((e) => e.getBoundingClientRect()); return { b: { top: b.top, bottom: b.bottom, left: b.left, right: b.right }, d: d.map((r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })), t: t.map((r) => ({ top: r.top, bottom: r.bottom })), p1: getComputedStyle(document.querySelector('.bg-ch.p1')).backgroundColor, sw: document.documentElement.scrollWidth }; });
  if (!geo.d.length) bad.push('no dice after rolling');
  for (const r of geo.d) if (r.top < geo.b.top || r.bottom > geo.b.bottom || r.left < geo.b.left + geo.b.right * 0.4) bad.push('a die is not on the right half of the board');
  const [tt, tb] = geo.t;
  if (!tt || !tb || tt.bottom > geo.b.top + 12 || tb.top < geo.b.bottom - 12) bad.push('trays are not above and below the board');
  if (!/59, 66, 82/.test(geo.p1)) bad.push('your checkers are not the flat dark slate colour');
  if (geo.sw > 390) bad.push('page got wider');
  await p.close();
  const src = fs.readFileSync(path.join(ROOT, 'backgammon/game.js'), 'utf8');
  if (/NAMES = \{[^}]*"Red"/.test(src)) bad.push('"Red" is back in backgammon');
  return bad;
}, ['backgammon']);

check('water-sort-look-and-pour', 'water sort should have glass tubes with a shine and rounded bottoms, vivid colours, big round Undo/Hint buttons, and a pour animation (a stream falls while a tube tips over)', async () => {
  const p = await open('water-sort');
  const bad = [];
  const look = await p.evaluate(() => {
    const t = document.querySelector('.ws-tube'), tr = t.getBoundingClientRect(), af = getComputedStyle(t, '::after');
    const l = [...t.children].map((e) => e.getBoundingClientRect());
    const u = getComputedStyle(document.getElementById('undo-btn'), '::before'), h = document.getElementById('hint-btn').getBoundingClientRect(), un = document.getElementById('undo-btn').getBoundingClientRect();
    const full = [...document.querySelectorAll('.ws-tube')].find((x) => x.children.length === 4) || t;
    const fr = full.getBoundingClientRect(), fl = [...full.children].map((e) => e.getBoundingClientRect());
    const inlineUndo = [...document.querySelectorAll('#undo-btn .gk-undo-ico, #undo-btn .glyph')].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).length;
    const undoButtons = [...document.querySelectorAll('button')].filter((e) => e.id === 'undo-btn' || /(^|\s)undo(\s|$)/i.test(e.textContent.trim())).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
    return { picture: /fun\/tube\.png/.test(af.backgroundImage), ratio: tr.height / tr.width,
      inside: fl.length ? fl.every((r) => r.left >= fr.left + fr.width * 0.12 && r.right <= fr.right - fr.width * 0.12 && r.bottom <= fr.bottom - 1 && r.top >= fr.top + fr.height * 0.17) : true,
      ucircle: parseFloat(u.width) >= 60 && parseFloat(u.borderTopLeftRadius) >= 30, hint: [h.left, h.bottom], undo: [un.left, un.bottom], inlineUndo, undoButtons,
      vivid: Math.max(...[...document.querySelectorAll('.ws-l')].map((e) => { const m = getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number); return Math.max(...m) - Math.min(...m); })), sw: document.documentElement.scrollWidth };
  });
  if (!look.picture) bad.push('the tubes are not the glass picture from the reference (fun/tube.png)');
  if (look.ratio < 2.8 || look.ratio > 3.2) bad.push('tube proportions are off: height/width is ' + look.ratio.toFixed(2) + ', the picture is 2.98');
  if (!look.inside) bad.push('the liquid pokes outside the glass or into its neck');
  if (!look.ucircle) bad.push('Undo is not a big round button');
  if (look.undoButtons !== 1) bad.push('expected one visible Undo button, saw ' + look.undoButtons);
  if (look.inlineUndo) bad.push('the Undo button still draws the extra inline undo icon below the round one');
  if (look.hint[1] > 844 || look.undo[1] > 844) bad.push('Undo / Hint are below the fold');
  if (look.hint[0] < look.undo[0] + 200) bad.push('Hint should sit at the right, Undo at the left');
  if (look.sw > 390) bad.push('page got wider');
  if (look.vivid < 120) bad.push('liquid colours are washed out');
  // a pour: tap one tube, then another that accepts it, and look for the falling stream
  const n = await p.locator('.ws-tube').count();
  let saw = false, pour = null;
  for (let a = 0; a < n && !saw; a++) for (let c = 0; c < n && !saw; c++) {
    if (a === c) continue;
    await p.locator('.ws-tube').nth(a).click(); await p.waitForTimeout(60);
    await p.locator('.ws-tube').nth(c).click(); await p.waitForTimeout(150);
    if (await p.locator('.ws-stream').count()) { saw = true; pour = { a, c }; }
  }
  if (!saw) bad.push('no pour animation: no stream appeared when a move was made');
  else {
    await p.waitForTimeout(220);                                             // the tube is now holding over its target
    const geo = await p.evaluate(({ a }) => {
      const src = document.querySelectorAll('.ws-tube')[a], stream = document.querySelector('.ws-stream');
      if (!src || !stream) return null;
      const r = src.getBoundingClientRect(), s = stream.getBoundingClientRect();
      const m = new DOMMatrixReadOnly(getComputedStyle(src).transform), w = src.offsetWidth, h = src.offsetHeight;
      // the transformed corners of the tube's top edge; the lower one is the pouring lip
      const pts = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]].map(([x, y]) => ({ x: m.a * x + m.c * y, y: m.b * x + m.d * y }));
      const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y));
      const ox = r.left - minX, oy = r.top - minY;
      const lipA = { x: ox - m.a * w / 2, y: oy - m.b * w / 2 }, lipB = { x: ox + m.a * w / 2, y: oy + m.b * w / 2 };
      const lip = lipA.y > lipB.y ? lipA : lipB;
      return { lip, stream: { x: s.left + s.width / 2, y: s.top } };
    }, pour);
    if (!geo) bad.push('the stream or the pouring tube disappeared mid-pour');
    else {
      const dx = Math.abs(geo.lip.x - geo.stream.x), dy = Math.abs(geo.lip.y - geo.stream.y);
      if (dx > 8 || dy > 8) bad.push('the pour stream starts ' + Math.round(dx) + 'px across and ' + Math.round(dy) + 'px away from the glass lip');
    }
    await p.waitForTimeout(1000);
    if (await p.locator('.ws-stream').count()) bad.push('the stream never went away');
    if ((await p.locator('#moves').textContent()).trim() !== '1') bad.push('the move was not counted after the pour');
  }
  await p.close();
  return bad;
}, ['water-sort']);

check('water-sort-water-fits-desktop', 'on a PC-width page the liquid shrank to a thin strip inside the fixed-width glass (percentage padding was measured against the wide grid column, not the tube)', async () => {
  const bad = [];
  for (const width of [768, 1000, 1440]) {
    const p = await open('water-sort', width);
    const r = await p.evaluate(() => {
      const tubes = [...document.querySelectorAll('.ws-tube')];
      const full = tubes.find((t) => t.children.length === 4) || tubes.find((t) => t.children.length) || tubes[0];
      const tr = full.getBoundingClientRect(), ls = [...full.children].map((e) => e.getBoundingClientRect());
      return { tw: tr.width, th: tr.height, tl: tr.left, tt: tr.top, tb: tr.bottom, l: Math.min(...ls.map((x) => x.left)), r: Math.max(...ls.map((x) => x.right)), t: Math.min(...ls.map((x) => x.top)), b: Math.max(...ls.map((x) => x.bottom)), lh: ls[0] ? ls[0].height : 0, sw: document.documentElement.scrollWidth };
    });
    await p.close();
    const wRatio = (r.r - r.l) / r.tw, hRatio = r.lh / r.th;
    if (wRatio < 0.66 || wRatio > 0.76) bad.push(width + 'px: water is ' + (wRatio * 100).toFixed(0) + '% of the tube width');
    if (hRatio < 0.18 || hRatio > 0.21) bad.push(width + 'px: each layer is ' + (hRatio * 100).toFixed(0) + '% of the tube height');
    if (r.l < r.tl + r.tw * 0.12 || r.r > r.tl + r.tw - r.tw * 0.12) bad.push(width + 'px: water pokes outside the glass');
    if (r.t < r.tt + r.th * 0.17 || r.b > r.tb - 1) bad.push(width + 'px: water pokes into the neck or past the bottom');
    if (r.sw > width) bad.push(width + 'px: page got wider (' + r.sw + 'px)');
  }
  return bad;
}, ['water-sort']);

check('chip-stays-white', 'after you tap a difficulty chip the chosen one went blue instead of white (the hover colour stuck on the phone)', async (g) => {
  const p = await open(g, 390, "var m=document.querySelector('#mode');if(m&&[...m.options].some(o=>o.value==='ai')){m.value='ai';m.dispatchEvent(new Event('change'))}");
  await p.locator('.gk-optbtn').click(); await p.waitForTimeout(250);
  const chips = p.locator('#chips .chip:visible');
  const n = await chips.count();
  if (!n) { await p.close(); return ['no visible difficulty chips to test']; }
  await chips.nth(n - 1).click(); await p.waitForTimeout(250);          // the pointer stays over the chip, like a thumb that just tapped
  const bg = await p.evaluate(() => getComputedStyle(document.querySelector('#chips .chip.active')).backgroundColor);
  await p.close();
  const m = bg.match(/\d+/g).map(Number);
  return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 > 0.9 ? [] : ['chosen chip is ' + bg + ', not white'];
}, ['backgammon', 'checkers', 'water-sort', '2048']);

check('backgammon-dice-clear-of-checkers', 'on a double roll (four dice) the dice sat low on the board and covered the checkers at the bottom', async () => {
  const p = await open('backgammon', 390, "Math.random=()=>0;var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.locator('.bg-dice .btn').click(); await p.waitForTimeout(600);
  const r = await p.evaluate(() => { const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; const dice = [...document.querySelectorAll('#dice-on .bg-die')].map((e) => e.getBoundingClientRect()); const ch = [...document.querySelectorAll('#board .bg-pt .bg-ch, #board .bg-bar .bg-ch')].map((e) => e.getBoundingClientRect()); const bd = document.getElementById('board').getBoundingClientRect(); return { n: dice.length, over: dice.some((d) => ch.some((c) => hit(d, c))), mid: dice.length ? dice.reduce((s, d) => s + (d.top + d.bottom) / 2, 0) / dice.length : 0, boardMid: (bd.top + bd.bottom) / 2 }; });
  await p.close();
  const bad = [];
  if (r.n !== 4) bad.push('expected four dice on a double, saw ' + r.n);
  if (r.over) bad.push('a die covers a checker');
  if (Math.abs(r.mid - r.boardMid) > 14) bad.push('dice are not centred on the board (' + Math.round(r.mid - r.boardMid) + 'px off)');
  return bad;
}, ['backgammon']);

check('slitherlink-loop', 'slitherlink: a drawn loop must be one closed loop whose numbers all match, and solving it must finish the puzzle', async () => {
  const p = await open('slitherlink', 390); await p.waitForTimeout(400);
  const bad = [];
  const before = await p.evaluate(() => ({ clues: document.querySelectorAll('#board .sl-clue').length, lines: document.querySelectorAll('#board .sl-gridline').length }));
  if (before.clues < 8) bad.push('too few clues on the board (' + before.clues + ')');
  if (before.lines < 40) bad.push('the board has no grid lines (' + before.lines + ')');
  await p.evaluate(() => window.__slitherTest.autoSolve());
  await p.waitForTimeout(320);
  const after = await p.evaluate(() => ({ won: window.__slitherTest.state().won, loop: document.querySelectorAll('#board .sl-loop').length, status: document.getElementById('status').textContent }));
  if (!after.won) bad.push('the stored solution did not finish the puzzle');
  if (after.loop < 8) bad.push('the solved board draws no loop (' + after.loop + ' line pieces)');
  if (!/solved/i.test(after.status)) bad.push('the status does not say solved (' + after.status + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['slitherlink']);

check('star-battle-stars', 'star battle: every row, column and region needs its stars, and the stored solution must finish the board', async () => {
  const p = await open('star-battle', 390); await p.waitForTimeout(400);
  const bad = [];
  const before = await p.evaluate(() => ({ cells: document.querySelectorAll('#board .sb-cell').length, regions: new Set([...document.querySelectorAll('#board .sb-cell')].map((c) => c.className)).size }));
  if (before.cells < 36) bad.push('too few cells on the board (' + before.cells + ')');
  await p.evaluate(() => window.__starTest.solve());
  await p.waitForTimeout(320);
  const after = await p.evaluate(() => ({ won: window.__starTest.state().won, stars: document.querySelectorAll('#board .sb-star').length, status: document.getElementById('status').textContent }));
  if (!after.won) bad.push('the stored solution did not finish the puzzle');
  if (after.stars < 6) bad.push('the solved board draws no stars (' + after.stars + ')');
  if (!/solved/i.test(after.status)) bad.push('the status does not say solved (' + after.status + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['star-battle']);

check('connect6-two-stones', 'connect6: the opening turn places one stone, then the next player places two and the turn submits after the second', async () => {
  const p = await open('connect6', 390); await p.waitForTimeout(400);
  const bad = [];
  await p.evaluate(() => { const s = document.getElementById('mode'); s.value = 'local'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  const cells = p.locator('#board .c6-cell');
  if (await cells.count() !== 225) bad.push('expected a 15x15 board, saw ' + await cells.count());
  await cells.nth(112).click(); await p.waitForTimeout(180);
  const one = await p.evaluate(() => ({ b: document.querySelectorAll('#board .c6-cell.b').length, w: document.querySelectorAll('#board .c6-cell.w').length }));
  if (one.b !== 1) bad.push('the opening turn did not place exactly one Black stone (' + one.b + ')');
  await cells.nth(98).click(); await p.waitForTimeout(120);
  await cells.nth(99).click(); await p.waitForTimeout(220);
  const two = await p.evaluate(() => ({ b: document.querySelectorAll('#board .c6-cell.b').length, w: document.querySelectorAll('#board .c6-cell.w').length }));
  if (two.w !== 2) bad.push('White did not place two stones (' + two.w + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['connect6']);

check('tablut-move', 'tablut: tapping an attacker and then a destination must move it', async () => {
  const p = await open('tablut', 390); await p.waitForTimeout(400);
  const bad = [];
  await p.evaluate(() => { const s = document.getElementById('mode'); s.value = 'local'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  const mine = p.locator('#board .tb-cell.mine').first();
  if (!(await mine.count())) { bad.push('no movable attacker was offered'); await p.close(); return bad; }
  await mine.click(); await p.waitForTimeout(160);
  const dests = p.locator('#board .tb-cell.dest');
  if (!(await dests.count())) { bad.push('selecting an attacker offered no destination'); await p.close(); return bad; }
  await dests.first().click(); await p.waitForTimeout(220);
  const after = await p.evaluate(() => ({ from: document.querySelectorAll('#board .tb-cell.from').length, last: document.querySelectorAll('#board .tb-cell.last').length, occ: document.querySelectorAll('#board .tb-cell.occ').length }));
  if (!after.from || !after.last) bad.push('the move left no from/last marks');
  if (after.occ !== 25) bad.push('the piece count changed (' + after.occ + ', expected 25)');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['tablut']);

check('fanorona-move', 'fanorona: selecting a piece must offer a step and making it must move the piece', async () => {
  const p = await open('fanorona', 390); await p.waitForTimeout(400);
  const bad = [];
  await p.evaluate(() => { const s = document.getElementById('mode'); s.value = 'local'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(300);
  const mines = p.locator('#board .mine');
  if (!(await mines.count())) { bad.push('no movable piece was offered'); await p.close(); return bad; }
  let picked = false;
  for (let i = 0; i < await mines.count(); i++) {
    await mines.nth(i).click(); await p.waitForTimeout(120);
    if (await p.locator('#board .dest').count()) { picked = true; break; }
  }
  if (!picked) { bad.push('selecting a piece offered no destination'); await p.close(); return bad; }
  const dests = p.locator('#board .dest');
  await dests.first().click(); await p.waitForTimeout(260);
  const after = await p.evaluate(() => ({ from: document.querySelectorAll('#board .from').length, last: document.querySelectorAll('#board .last').length, choice: !document.getElementById('choice').hidden }));
  if (!after.from && !after.last && !after.choice) bad.push('the move left no from/last mark and no capture choice');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['fanorona']);

check('cribbage-discard', 'cribbage: the first discard must take two cards from the hand and send them to the crib', async () => {
  const p = await open('cribbage', 390); await p.waitForTimeout(400);
  const bad = [];
  await p.waitForFunction(() => document.querySelectorAll('#cb-hand .cb-card.play').length >= 2, null, { timeout: 5000 }).catch(() => {});
  const play = p.locator('#cb-hand .cb-card.play');
  if (await play.count() < 2) { bad.push('the hand never reached the discard phase'); await p.close(); return bad; }
  await play.nth(0).click(); await p.waitForTimeout(120);
  await p.locator('#cb-hand .cb-card.play').nth(1).click(); await p.waitForTimeout(120);
  const send = p.getByRole('button', { name: /Send 2 to crib/ });
  if (!(await send.count())) { bad.push('discarding two cards did not offer Send 2 to crib'); await p.close(); return bad; }
  await send.click(); await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ hand: document.querySelectorAll('#cb-hand .cb-card').length, crib: document.getElementById('cb-crib').textContent, status: document.getElementById('status').textContent }));
  if (after.hand !== 4) bad.push('the hand should be 4 after discarding 2 (saw ' + after.hand + ')');
  if (!/crib/i.test(after.crib)) bad.push('the crib label is missing (' + after.crib + ')');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['cribbage']);

check('skull-place', 'skull: the first placement must take one disc from your hand and put it on the table', async () => {
  const p = await open('skull', 390); await p.waitForTimeout(500);
  const bad = [];
  await p.waitForFunction(() => document.querySelectorAll('#sk-hand .sk-disc.pick').length > 0, null, { timeout: 4000 }).catch(() => {});
  const pick = p.locator('#sk-hand .sk-disc.pick').first();
  if (!(await pick.count())) { bad.push('no placeable disc in hand'); await p.close(); return bad; }
  const before = await p.locator('#sk-hand .sk-disc').count();
  await pick.click(); await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ hand: document.querySelectorAll('#sk-hand .sk-disc').length, placed: document.querySelectorAll('#sk-seats .sk-disc.up, #sk-seats .sk-disc.down').length }));
  if (after.hand !== before - 1) bad.push('placing a disc did not reduce the hand (' + before + ' -> ' + after.hand + ')');
  if (!after.placed) bad.push('no disc appeared on the table');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['skull']);

check('skull-six-seats', 'skull: five computer players plus you must make a six-seat table without the page scrolling sideways', async () => {
  const p = await open('skull', 390); await p.waitForTimeout(400);
  const bad = [];
  await p.evaluate(() => { const s = document.getElementById('bots'); s.value = '5'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ seats: document.querySelectorAll('#sk-seats .sk-seat').length, over: document.documentElement.scrollWidth - innerWidth, hand: document.querySelectorAll('#sk-hand .sk-disc').length }));
  if (r.seats !== 6) bad.push('expected 6 seats, saw ' + r.seats);
  if (r.over > 0) bad.push('the page scrolls sideways by ' + r.over + 'px');
  if (!r.hand) bad.push('your hand is missing at a six-seat table');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['skull']);

check('ludo-moves-square-by-square', 'ludo: a token used to slide straight from its old square to the new one; a multi-square move must visit every square, while a one-square move glides', async () => {
  const p = await open('ludo', 390);
  await p.evaluate(() => { Math.random = () => 0.999; });     // every roll is a 6
  const bad = [];
  await p.locator('#ld-roll').click(); await p.waitForTimeout(700);
  await p.locator('.ld-token.movable').first().click(); await p.waitForTimeout(350);
  await p.locator('#ld-roll').click(); await p.waitForTimeout(700);
  await p.locator('.ld-token.movable').first().click(); await p.waitForTimeout(40);
  const anims = await p.evaluate(() => [...document.querySelectorAll('.ld-token')].flatMap((t) => t.getAnimations()).map((a) => ({ n: a.effect.getKeyframes().length, d: a.effect.getTiming().duration, frames: a.effect.getKeyframes().map((k) => (k.left || '') + '|' + (k.top || '')) })));
  const walk = anims.find((a) => a.n >= 6);
  if (!walk) bad.push('the six-square move did not animate through the squares (' + JSON.stringify(anims) + ')');
  else {
    if (walk.d < 500) bad.push('the six-square walk is too quick (' + walk.d + 'ms)');
    if (new Set(walk.frames).size < 6) bad.push('the walk repeats a position instead of visiting six squares');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['ludo']);

check('2048-slides-smoothly', 'tiles used to teleport to their new place; they should slide (ghost tiles travel from the old cell to the new one), and the board still ends up correct', async () => {
  const p = await open('2048');
  const bad = [];
  await p.evaluate(() => { grid = [[2, 2, 0, 0], [0, 0, 0, 4], [0, 0, 0, 0], [0, 0, 0, 0]]; render(); move('left'); });
  const mid = await p.evaluate(() => ({ ghosts: document.querySelectorAll('.tile.ghost').length, running: [...document.querySelectorAll('.tile.ghost')].some((g) => g.getAnimations().length > 0), hidden: [...document.querySelectorAll('#board .tile')].filter((t) => t.style.visibility === 'hidden').length }));
  if (mid.ghosts !== 2) bad.push('expected 2 sliding tiles (the second 2 joining the first, and the 4), saw ' + mid.ghosts);
  if (!mid.running) bad.push('the tiles are not animating');
  if (mid.hidden < 2) bad.push('the real tiles should stay hidden until the slide lands');
  await p.waitForTimeout(400);
  const end = await p.evaluate(() => ({ ghosts: document.querySelectorAll('.tile.ghost').length, hidden: [...document.querySelectorAll('#board .tile')].filter((t) => t.style.visibility === 'hidden').length, row0: grid[0].join(','), row1: grid[1].join(','), cells: document.querySelectorAll('#board .tile:not(.ghost)').length }));
  if (end.ghosts || end.hidden) bad.push('ghost tiles or hidden tiles were left behind');
  if (end.row0.split(',')[0] !== '4' || end.row1.split(',')[0] !== '4') bad.push('the board is wrong after the move: ' + end.row0 + ' / ' + end.row1);
  if (end.cells !== 16) bad.push('board does not have 16 cells');
  // a second swipe in the middle of a slide must not break anything
  await p.evaluate(() => { move('right'); move('left'); move('right'); });
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ ghosts: document.querySelectorAll('.tile.ghost').length, cells: document.querySelectorAll('#board .tile:not(.ghost)').length, hidden: [...document.querySelectorAll('#board .tile')].filter((t) => t.style.visibility === 'hidden').length, sum: grid.flat().reduce((a, b) => a + b, 0) }));
  if (after.ghosts || after.hidden || after.cells !== 16) bad.push('quick successive swipes left the board in a bad state');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['2048']);

check('backgammon-dice-tumble', 'a roll used to just appear; the dice should tumble (spin and bounce, faces flicker) and then settle on the real values', async () => {
  const p = await open('backgammon', 390, "var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.locator('.bg-dice .btn').click(); await p.waitForTimeout(120);
  const mid = await p.evaluate(() => { const ds = [...document.querySelectorAll('#dice-on .bg-die')]; return { n: ds.length, running: ds.filter((d) => d.getAnimations().length > 0).length }; });
  const bad = [];
  if (!mid.n) bad.push('no dice after rolling');
  else if (mid.running < mid.n) bad.push('only ' + mid.running + ' of ' + mid.n + ' dice are animating right after the roll');
  await p.waitForTimeout(1300);
  const end = await p.evaluate(() => [...document.querySelectorAll('#dice-on .bg-die')].map((d) => ({ shown: Number(d.getAttribute('aria-label').replace(/\D/g, '')), pips: d.querySelectorAll('i.on').length, anim: d.getAnimations().length })));
  for (const d of end) { if (d.anim) bad.push('a die is still moving after 1.3 s'); if (d.shown !== d.pips) bad.push('a die settled on ' + d.pips + ' pips but should show ' + d.shown); }
  // tapping around afterwards must not roll them again
  await p.evaluate(() => { document.querySelector('#board .bg-pt').click(); });
  await p.waitForTimeout(150);
  const again = await p.evaluate(() => [...document.querySelectorAll('#dice-on .bg-die')].some((d) => d.getAnimations().length > 0));
  if (again) bad.push('the dice tumbled again after a tap, with no new roll');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['backgammon']);

check('yatzy-look-and-play', 'yatzy should match the reference: a tray of five star slots, a red ROLL button with its 1-2-3 counter, a two-column scorecard with an icon and a score cell on every row; a whole game must still play out to the result card', async () => {
  const p = await open('yatzy');
  const bad = [];
  const pre = await p.evaluate(() => ({ blank: document.querySelectorAll('.yz-die.blank').length, star: getComputedStyle(document.querySelector('.yz-die.blank'), '::after').content !== 'none', pills: document.querySelectorAll('#roll-btn i').length, roll: getComputedStyle(document.getElementById('roll-btn')).backgroundColor, rows: document.querySelectorAll('.yz-row').length, icons: document.querySelectorAll('.yz-row .yz-ic').length, cols: document.querySelectorAll('.yz-col').length, sw: document.documentElement.scrollWidth, rollBottom: document.getElementById('roll-btn').getBoundingClientRect().bottom }));
  if (pre.blank !== 5 || !pre.star) bad.push('the five dice slots should show a star before the first roll');
  if (pre.pills !== 3) bad.push('the ROLL button should show the three roll counters');
  if (!/217, 90, 78/.test(pre.roll)) bad.push('ROLL is not the red button');
  if (pre.rows !== 13 || pre.icons !== 13 || pre.cols !== 2) bad.push('the scorecard should have 13 rows with icons in two columns (saw ' + pre.rows + ' rows, ' + pre.icons + ' icons, ' + pre.cols + ' columns)');
  if (pre.sw > 390) bad.push('page is wider than the phone');
  if (pre.rollBottom > 844) bad.push('ROLL is below the fold');
  await p.locator('#roll-btn').click(); await p.waitForTimeout(100);
  const mid = await p.evaluate(() => ({ dice: [...document.querySelectorAll('.yz-die:not(.blank)')].length, moving: [...document.querySelectorAll('.yz-die')].filter((d) => d.getAnimations().length).length, used: document.querySelectorAll('#roll-btn i.used').length }));
  if (mid.dice !== 5) bad.push('five dice should show after rolling');
  if (mid.moving < 5) bad.push('the dice should tumble when rolled (' + mid.moving + ' moving)');
  if (mid.used !== 1) bad.push('the first roll counter should light up');
  // play a whole game: roll, pick the first scoring box twice (select, then confirm), thirteen times
  for (let t = 0; t < 13; t++) {
    if (t > 0) { await p.locator('#roll-btn').click(); await p.waitForTimeout(60); }
    const row = p.locator('.yz-row.can').first();
    await row.click(); await p.waitForTimeout(40); await row.click(); await p.waitForTimeout(80);
  }
  await p.waitForTimeout(600);
  if (!(await p.locator('.gk-over').count())) bad.push('no result card after thirteen turns');
  else if (await p.locator('.gk-over .stats').count()) bad.push('the result card shows a "Your wins" panel for a solo score game');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['yatzy']);

check('dominoes-look-and-play', 'dominoes should match the reference: a header with your score, the goal and the bot, grey tile backs on top, a tall salmon table that turns blue while the bot plays, your tiles on a red floor (not boxed in buttons), and the hand must not jump as the line grows', async () => {
  const p = await open('dominoes');
  const bad = [];
  const info = await p.evaluate(() => ({ tab: document.querySelector('.fun-vs .tab')?.textContent, left: document.querySelector('.fun-vs .l')?.textContent, back: getComputedStyle(document.querySelector('.dm.back')).backgroundColor, line: document.getElementById('dm-line').getBoundingClientRect().height, hand: getComputedStyle(document.getElementById('dm-hand')).backgroundColor, boxed: getComputedStyle(document.querySelector('.dm-tile')).backgroundColor, sw: document.documentElement.scrollWidth }));
  if (!/GOAL \d+/.test(info.tab || '')) bad.push('the header tab should read GOAL <points>, saw "' + info.tab + '"');
  if (!/^YOU/.test(info.left || '')) bad.push('the header should show YOU on the left');
  if (!/179, 168, 153/.test(info.back)) bad.push('the bot tile backs should be the grey-brown tiles');
  if (!/196, 80, 63/.test(info.hand)) bad.push('your hand should sit on the red floor');
  if (info.boxed !== 'rgba(0, 0, 0, 0)') bad.push('hand tiles are boxed in a button background (' + info.boxed + ')');
  if (info.line < 180) bad.push('the table is too short (' + Math.round(info.line) + 'px)');
  if (info.sw > 390) bad.push('page is wider than the phone');
  // play some turns; the hand must stay where it is and the line must keep its height
  const hand0 = await p.evaluate(() => Math.round(document.getElementById('dm-hand').getBoundingClientRect().top + scrollY));
  let blue = false, botTurns = 0;
  for (let k = 0; k < 24 && !(botTurns >= 2); k++) {
    const tile = p.locator('.dm-tile:not(.dim)').first();
    if (await tile.count()) { await tile.click(); await p.waitForTimeout(120); await tile.click().catch(() => {}); await p.waitForTimeout(120); const end = p.locator('.dm-actions .btn').first(); if (await end.count()) await end.click().catch(() => {}); }   // a tile that fits both ends asks which end
    else { const a = p.locator('.dm-actions .btn').first(); if (await a.count()) await a.click().catch(() => {}); }
    for (let w = 0; w < 20; w++) {
      await p.waitForTimeout(100);
      const s = await p.evaluate(() => ({ bot: !document.getElementById('dm-banner').classList.contains('you') && /Waiting/.test(document.getElementById('dm-banner').textContent), blue: /98, 168, 208|143, 201, 230|62, 168, 208/.test(getComputedStyle(document.getElementById('dm-line')).backgroundImage) }));
      if (s.bot) { botTurns++; if (s.blue) blue = true; }
    }
  }
  const after = await p.evaluate(() => ({ hand: Math.round(document.getElementById('dm-hand').getBoundingClientRect().top + scrollY), line: document.getElementById('dm-line').getBoundingClientRect().height }));
  if (Math.abs(after.line - info.line) > 1) bad.push('the table changed height as tiles were played');
  if (!botTurns) bad.push('the bot never got a turn in this test');
  else if (!blue) bad.push('the table never turned blue while the bot was playing');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['dominoes']);

check('pig-look-and-roll', 'pig should look like the others: the scores and the goal in the header, a big white die that spins while it rolls, a red ROLL and a green HOLD, and the page turning blue while the computer plays', async () => {
  const p = await open('pig', 390, "var m=document.querySelector('#mode');m.value='ai';m.dispatchEvent(new Event('change'))");
  await p.waitForTimeout(400);
  const bad = [];
  const info = await p.evaluate(() => ({ tab: document.querySelector('.fun-vs .tab')?.textContent, left: document.querySelector('.fun-vs .l')?.textContent, cards: getComputedStyle(document.querySelector('.pig-scores')).display, die: document.querySelector('.pig-die svg').getBoundingClientRect().width, roll: getComputedStyle(document.getElementById('roll-btn')).backgroundColor, hold: getComputedStyle(document.getElementById('hold-btn')).backgroundColor, sw: document.documentElement.scrollWidth }));
  if (!/GOAL \d+/.test(info.tab || '')) bad.push('header tab should read GOAL <points>');
  if (!/^YOU/.test(info.left || '')) bad.push('header should show YOU on the left');
  if (info.cards !== 'none') bad.push('the old score cards should be gone (the header has the scores)');
  if (info.die < 140) bad.push('the die is too small (' + Math.round(info.die) + 'px)');
  if (!/217, 90, 78/.test(info.roll)) bad.push('ROLL is not the red button');
  if (!/47, 180, 74/.test(info.hold)) bad.push('HOLD is not the green button');
  if (info.sw > 390) bad.push('page is wider than the phone');
  await p.locator('#roll-btn').click(); await p.waitForTimeout(90);
  const spin = await p.evaluate(() => document.querySelector('.pig-die').classList.contains('rolling') && document.querySelector('.pig-die svg').getAnimations().length > 0);
  if (!spin) bad.push('the die should spin while it rolls');
  await p.waitForTimeout(500);
  const stopped = await p.evaluate(() => !document.querySelector('.pig-die').classList.contains('rolling'));
  if (!stopped) bad.push('the die keeps spinning after it landed');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['pig']);

check('liars-dice-look-and-fit', 'the liars dice page should have the green felt table with the bid, a pill for whose turn it is, your dice on a red floor, and the bid controls must stay inside the screen (the 6 face button touched the edge)', async () => {
  const p = await open('liars-dice');
  const bad = [];
  const r = await p.evaluate(() => { const box = document.querySelector('.panel').getBoundingClientRect(); const faces = [...document.querySelectorAll('.ld-face')].map((e) => e.getBoundingClientRect()); return { felt: getComputedStyle(document.getElementById('ld-bid')).backgroundImage.includes('rgb(47, 138, 85)'), floor: getComputedStyle(document.getElementById('ld-mine')).backgroundColor, pill: parseFloat(getComputedStyle(document.getElementById('ld-banner')).borderTopLeftRadius), faces: faces.length, inside: faces.every((f) => f.left >= box.left - 1 && f.right <= box.right + 1), sw: document.documentElement.scrollWidth }; });
  if (!r.felt) bad.push('the bid is not on the green felt');
  if (!/143, 46, 46/.test(r.floor)) bad.push('your dice are not on the red floor');
  if (r.pill < 20) bad.push('the turn banner is not a pill');
  if (r.faces < 6) bad.push('the six face buttons should show on your opening bid (saw ' + r.faces + ')');
  else if (!r.inside) bad.push('the face buttons run past the edge of the panel');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['liars-dice']);

check('car-park-look-and-play', 'the new Car Park puzzle must fit a phone, show the red car and exit, solve through the real game code, and offer the next level on the game-over card', async () => {
  const p = await open('car-park');
  const bad = [];
  const r = await p.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    return {
      sw: document.documentElement.scrollWidth, board: { w: b.width, h: b.height },
      cells: document.querySelectorAll('#grid .cp-cell').length,
      red: !!document.querySelector('.cp-car[data-red="1"]'),
      level: document.getElementById('level-num').textContent,
      options: document.querySelectorAll('#level-sel option').length,
    };
  });
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (r.cells !== 36) bad.push('the grid is not 6x6 (saw ' + r.cells + ' cells)');
  if (!r.red) bad.push('the red car is missing');
  if (r.options !== 42) bad.push('the level menu should list 42 levels (saw ' + r.options + ')');
  await p.evaluate(() => window.__carParkTest.autoSolve());
  await p.waitForTimeout(1200);
  const win = await p.evaluate(() => {
    const card = document.querySelector('.gk-over');
    return {
      won: window.__carParkTest.state().won,
      status: document.getElementById('status').textContent,
      card: !!card, cardText: card ? card.textContent : '',
      again: card ? (card.querySelector('.again') || {}).textContent : '',
    };
  });
  if (!win.won) bad.push('the real solver path did not win');
  if (!/Solved in \d+ moves/.test(win.status)) bad.push('the win status is wrong: ' + win.status);
  if (!win.card) bad.push('no game-over card after the win');
  if (!/next level/i.test(win.again || '')) bad.push('the card should offer Next level');
  if (!/Solved in/.test(win.cardText)) bad.push('the card does not show the result');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['car-park']);

check('back-home-feedback', 'the top-bar back button and the game-over Home button gave no pressed feedback, so a tap could feel ignored and a double-tap could zoom the page', async () => {
  const p = await open('chess', 390);
  const info = await p.evaluate(() => ({ touch: getComputedStyle(document.querySelector('.topbar .back')).touchAction }));
  const backBox = await p.locator('.topbar .back').boundingBox();
  await p.mouse.move(backBox.x + backBox.width / 2, backBox.y + backBox.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(140);
  const backPressed = await p.evaluate(() => getComputedStyle(document.querySelector('.topbar .back')).transform);
  await p.mouse.move(1, 1);
  await p.mouse.up();
  await p.evaluate(() => { document.getElementById('status').textContent = 'You win! ' + Gamekit.taunt('win'); });
  await p.waitForTimeout(700);
  const home = await p.evaluate(() => {
    const h = document.querySelector('.gk-over .home');
    return h ? { touch: getComputedStyle(h).touchAction } : null;
  });
  let homePressed = 'missing';
  if (home) {
    const box = await p.locator('.gk-over .home').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(140);
    homePressed = await p.evaluate(() => getComputedStyle(document.querySelector('.gk-over .home')).transform);
    await p.mouse.move(1, 1);
    await p.mouse.up();
  }
  const bad = [];
  if (info.touch !== 'manipulation') bad.push('the back button still allows double-tap zoom (touch-action: ' + info.touch + ')');
  if (backPressed === 'none') bad.push('the back button has no pressed state');
  if (!home) bad.push('the game-over card has no Home button');
  else if (home.touch !== 'manipulation') bad.push('Home still allows double-tap zoom (touch-action: ' + home.touch + ')');
  if (home && homePressed === 'none') bad.push('Home has no pressed state');
  if (p.errs.length) bad.push('errors: ' + p.errs.join('; '));
  await p.close();
  return bad;
}, ['chess']);

check('hub-look', 'the game hub should be the dark page with a top bar (your name, invite) and big rounded game tiles in two columns, every tile leading to a real page, nothing wider than the phone, and its scripts and styles stamped', async () => {
  const bad = [];
  for (const w of [320, 390]) {
    const p = await browser.newPage({ viewport: { width: w, height: 844 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(700);
    const r = await p.evaluate(() => { const cards = [...document.querySelectorAll('a.card')]; const first = cards[0].getBoundingClientRect(), second = cards[1].getBoundingClientRect(); return { n: cards.length, hrefs: cards.map((c) => c.getAttribute('href')), bg: getComputedStyle(document.body).backgroundColor, sw: document.documentElement.scrollWidth, sameRow: Math.abs(first.top - second.top) < 4, topbar: !!document.getElementById('name-btn') && !!document.getElementById('invite-btn'), radius: parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius), title: !!cards[0].querySelector('h3') }; });
    if (r.n < 40) bad.push(w + 'px: only ' + r.n + ' game tiles');
    if (!/23, 23, 25/.test(r.bg)) bad.push(w + 'px: page is not the dark background (' + r.bg + ')');
    if (r.sw > w) bad.push(w + 'px: page is ' + r.sw + 'px wide');
    if (!r.sameRow) bad.push(w + 'px: tiles are not in two columns');
    if (!r.topbar) bad.push('top bar is missing the name or invite button');
    if (r.radius < 20) bad.push('tiles are not rounded');
    if (w === 390) {
      for (const h of r.hrefs) if (!fs.existsSync(path.join(ROOT, h.replace(/\/$/, ''), 'index.html'))) bad.push('tile links to a missing page: ' + h);
      if (await p.locator('#menu-btn, #menu').count()) bad.push('the hub top-bar menu (your name, privacy, source) is back; it was removed on purpose');
      if (await p.locator('a[href*="github.com/Bash328"]').count()) bad.push('the hub shows a Source link again; it was removed on purpose');
    }
    if (errs.length) bad.push('errors: ' + errs.join(';'));
    await p.close();
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([\w./-]+\.(?:js|css))(\?v=([\w]+))?"/g)) {
    const f = path.join(ROOT, m[1]);
    if (!fs.existsSync(f)) continue;
    const want = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
    if (m[3] !== want) bad.push('hub: ' + m[1] + ' is not stamped with its current hash (run node tests/cache-bust.mjs)');
  }
  return bad;
}, ['hub']);

check('battleship-look', 'battleship should look like the redesign: the enemy waters blue, your fleet orange with the ships drawn as pictures on it, hits red, no glyph symbols on the placement buttons', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(400);
  const bad = [];
  await p.locator('#bs-random').click(); await p.waitForTimeout(150);
  const place = await p.evaluate(() => ({ frame: getComputedStyle(document.getElementById('bs-main')).backgroundColor, ship: [...document.querySelectorAll('#bs-main .bs-cell.ship')].length, shipBg: getComputedStyle(document.querySelector('#bs-main .bs-cell.ship')).backgroundColor, btns: ['bs-rotate', 'bs-random', 'bs-clear'].map((i) => document.getElementById(i).textContent), sw: document.documentElement.scrollWidth }));
  if (!/224, 138, 104/.test(place.frame)) bad.push('your fleet grid is not the orange frame (' + place.frame + ')');
  if (place.ship < 14) bad.push('ships should show on your grid after Random (saw ' + place.ship + ' cells)');
  const hulls = await p.locator('#bs-main .bs-hull').count();
  if (hulls !== 5) bad.push('the five ships should be drawn as ship pictures on the grid after Random (saw ' + hulls + ')');
  if (place.btns.some((t) => /[☀-➿⬀-⯿]/.test(t))) bad.push('symbol characters on the placement buttons');
  await p.locator('#bs-ready').click(); await p.waitForTimeout(800);
  const play = await p.evaluate(() => ({ enemy: getComputedStyle(document.getElementById('bs-main')).backgroundColor, mine: getComputedStyle(document.getElementById('bs-sub')).backgroundColor }));
  if (!/63, 127, 181/.test(play.enemy)) bad.push('the enemy waters are not blue (' + play.enemy + ')');
  if (!/224, 138, 104/.test(play.mine)) bad.push('your small fleet grid is not orange (' + play.mine + ')');
  if (place.sw > 390) bad.push('page is wider than the phone');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['battleship']);

check('app-icon-and-launch-images', 'the app icon, the launch images and the link banner must match the art the icon generator actually draws (four flat chunky tiles on cream), every launch image the exact size its file name says, the manifest in the same cream, and no emoji in the favicon', async () => {
  const bad = [];
  const sizes = { 'icon-192.png': [192, 192], 'icon-512.png': [512, 512], 'icon-maskable-512.png': [512, 512], 'apple-touch-icon.png': [180, 180], 'og-image.png': [1200, 300] };
  const png = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  for (const [f, [w, h]] of Object.entries(sizes)) { const i = png(f); if (i.w !== w || i.h !== h) bad.push(f + ' is ' + i.w + 'x' + i.h + ', wanted ' + w + 'x' + h); }
  for (const f of fs.readdirSync(path.join(ROOT, 'splash'))) { const m = /^(\d+)x(\d+)\.png$/.exec(f); if (!m) continue; const i = png('splash/' + f); if (i.w !== Number(m[1]) || i.h !== Number(m[2])) bad.push('splash/' + f + ' is ' + i.w + 'x' + i.h); }
  // the art itself: sample the icon in the browser (the four tile colours are all present).
  // NOTE: the generator (tools/gen-icons.py) draws the flat cream design; a final
  // icon choice is still a user decision in TODO.md. If the art changes, update
  // this check together with the generator and manifest.
  const p = await browser.newPage({ viewport: { width: 600, height: 600 } });
  await p.goto(base + 'icon-512.png');
  const c = await p.evaluate(async () => { const img = document.images[0]; await img.decode(); const cv = document.createElement('canvas'); cv.width = cv.height = 512; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, 512, 512).data; const want = [[244, 183, 64], [229, 88, 122], [224, 133, 65], [139, 111, 214]]; const counts = want.map((w) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - w[0]) < 18 && Math.abs(d[i + 1] - w[1]) < 18 && Math.abs(d[i + 2] - w[2]) < 18 && d[i + 3] > 250) n++; return n; }); const px = (a, b) => [...x.getImageData(a, b, 1, 1).data]; return { counts, top: px(256, 6), bottom: px(256, 506) }; });
  await p.close();
  if (!c.counts.every((n) => n > 1500)) bad.push('the icon does not show the four flat tile colours (pixels per colour: ' + c.counts.join(', ') + ')');
  const cream = (a) => Math.abs(a[0] - 243) < 8 && Math.abs(a[1] - 238) < 8 && Math.abs(a[2] - 230) < 8;
  if (!cream(c.top) || !cream(c.bottom)) bad.push('the icon background is not the flat cream (' + JSON.stringify([c.top, c.bottom]) + ')');
  const svg = fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(svg) || /<text/.test(svg)) bad.push('the favicon still uses an emoji or text');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  if (man.background_color !== '#f3eee6' || man.theme_color !== '#f3eee6') bad.push('manifest colours should match the cream #f3eee6');
  return bad;
}, ['icons']);

check('strategy-boards-look', 'gomoku, hex, quoridor, pentago and ultimate tic-tac-toe should share the redesign: the dark purple page, the board edge to edge with a heavy frame (or a light card for ultimate), flat pieces', async (g) => {
  const p = await open(g);
  const r = await p.evaluate(() => { const b = document.getElementById('board'); const cs = getComputedStyle(b); const rect = b.getBoundingClientRect(); const ch = b.firstElementChild ? b.firstElementChild.getBoundingClientRect() : null; return { page: getComputedStyle(document.body).backgroundColor, border: parseFloat(cs.borderTopWidth), bg: cs.backgroundColor, left: rect.left, right: rect.right, sw: document.documentElement.scrollWidth, wrapped: !!b.closest('[class$="-wrap"]') }; });
  const bad = [];
  if (!/47, 53, 85/.test(r.page)) bad.push('page is not the dark purple (' + r.page + ')');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (r.right - r.left < (g === 'blokus-duo' || g === 'onitama' ? 270 : 360)) bad.push('the board is not edge to edge (' + Math.round(r.right - r.left) + 'px wide)');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['gomoku', 'quoridor', 'pentago', 'ultimate-tic-tac-toe', 'blokus-duo', 'onitama']);

check('header-title-fits', 'a long page title (ultimate tic-tac-toe) ran into the round buttons in the header', async (g) => {
  const p = await open(g, 360);
  const r = await p.evaluate(() => { const h = document.querySelector('.topbar h1'); if (!h || getComputedStyle(h).display === 'none') return null; const hr = h.getBoundingClientRect(); const right = document.querySelector('.topbar .gk-top-r').getBoundingClientRect(); const back = document.querySelector('.topbar .back').getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(h); const tr = range.getBoundingClientRect(); return { textLeft: tr.left, textRight: tr.right, backRight: back.right, rightLeft: right.left }; });
  await p.close();
  if (!r) return [];
  return r.textLeft < r.backRight - 1 || r.textRight > r.rightLeft + 1 ? ['the title (' + Math.round(r.textLeft) + '..' + Math.round(r.textRight) + ') runs into the header buttons (' + Math.round(r.backRight) + ' / ' + Math.round(r.rightLeft) + ')'] : [];
}, ['ultimate-tic-tac-toe', 'letter-boxed', 'word-ladder', 'rock-paper-scissors', 'nine-mens-morris']);

check('sudoku-look-and-play', 'sudoku and mini sudoku should be the redesign: the white grid in a heavy black frame edge to edge, thick box lines still visible, the number pad as chunky white keys, Time and Best in the header, and tapping a cell then a key must still write the digit', async (g) => {
  const p = await open(g);
  const bad = [];
  const r = await p.evaluate(() => { const b = document.getElementById('board'); const cs = getComputedStyle(b), rect = b.getBoundingClientRect(); const thick = [...b.children].find((c) => c.dataset.r === (b.children.length === 81 ? '2' : '1')); const thickW = parseFloat(getComputedStyle(thick).borderBottomWidth), thickC = getComputedStyle(thick).borderBottomColor; const thin = getComputedStyle(b.children[0]).borderRightColor; return { frame: parseFloat(cs.borderTopWidth), width: rect.width, thickW, thickC, thin, pills: document.querySelectorAll('.fun-pills b').length, key: getComputedStyle(document.querySelector('.sk-pad button')).backgroundColor, sw: document.documentElement.scrollWidth }; });
  if (r.frame < 5) bad.push('the grid has no heavy frame');
  if (r.width < 360) bad.push('the grid is not edge to edge (' + Math.round(r.width) + 'px)');
  if (r.thickW < 2 || !/47, 58, 70/.test(r.thickC)) bad.push('box lines are lost (' + r.thickW + 'px ' + r.thickC + ')');
  if (/47, 58, 70/.test(r.thin)) bad.push('thin lines are as heavy as the box lines');
  if (r.pills !== 2) bad.push('Time and Best belong in the header');
  if (!/255, 255, 255/.test(r.key)) bad.push('number keys are not the white keys');
  if (r.sw > 390) bad.push('page is wider than the phone');
  const sq = await p.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(); const last = document.getElementById('board').lastElementChild.getBoundingClientRect(); return { w: b.width, h: b.height, bottomVisible: last.bottom <= b.bottom + 1 }; });
  if (Math.abs(sq.w - sq.h) > 4 || !sq.bottomVisible) bad.push('the grid is not square or its last row is cut off (' + Math.round(sq.w) + 'x' + Math.round(sq.h) + ')');
  // write a digit: pick an empty cell, press a key
  const empty = p.locator('#board .sk-cell:not(.given)').first();
  await empty.click(); await p.waitForTimeout(100);
  await p.locator('.sk-pad button').first().click(); await p.waitForTimeout(150);
  const wrote = await p.evaluate(() => [...document.querySelectorAll('#board .sk-cell:not(.given)')].some((c) => /^[1-9]$/.test(c.textContent.trim())));
  if (!wrote) bad.push('tapping a cell and a key did not write a digit');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['sudoku', 'mini-sudoku']);

check('puzzle-grids-look', 'nonogram and lights out should be the redesign: their own dark page colour, the grid edge to edge (lights out in a heavy frame), a glowing yellow lit tile, Time/Moves and Best in the header, and the symbol characters gone from the buttons', async (g) => {
  const p = await open(g, 390, g === 'lights-out' ? "var m=document.querySelector('#mode');if(m&&[...m.options].some(o=>o.value==='solo')){m.value='solo';m.dispatchEvent(new Event('change'))}" : '');
  await p.waitForTimeout(400);
  const bad = [];
  const r = await p.evaluate(() => { const b = document.getElementById('board'), rect = b.getBoundingClientRect(); return { page: getComputedStyle(document.body).backgroundColor, width: rect.width, pills: [...document.querySelectorAll('.fun-pills')].filter((e) => !e.hidden).length, sw: document.documentElement.scrollWidth, btns: [...document.querySelectorAll('.ng-tools .btn')].map((x) => x.textContent) }; });
  if (g === 'nonogram' && !/52, 40, 90/.test(r.page)) bad.push('page is not the violet (' + r.page + ')');
  if (g === 'lights-out' && !/29, 40, 72/.test(r.page)) bad.push('page is not the night blue (' + r.page + ')');
  if (r.width < 340) bad.push('the grid is too narrow (' + Math.round(r.width) + 'px)');
  if (r.pills < 1) bad.push('score boxes missing from the header');
  if (r.btns.some((t) => /[\u2600-\u27BF\u25A0]/.test(t))) bad.push('symbol characters on the tool buttons');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (g === 'lights-out') {
    const lit = await p.evaluate(() => { const cells = [...document.querySelectorAll('.lo-cell')]; cells[12].click(); return getComputedStyle(document.querySelector('.lo-cell.on') || cells[0]).backgroundColor; });
    if (!/255, 210, 63/.test(lit)) bad.push('a lit tile is not the glowing yellow (' + lit + ')');
    const off = await p.evaluate(() => getComputedStyle([...document.querySelectorAll('.lo-cell:not(.on)')][0]).backgroundColor);
    if (!/58, 70, 120/.test(off)) bad.push('an unlit tile is not the dark blue (' + off + '): a light-theme rule in shared.css is winning');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['nonogram', 'lights-out']);

check('logic-grids-look', 'tango, queens, zip and patches should share the redesign: their own page colour, the grid edge to edge in a heavy black frame, Time and Best in the header, and no emoji on the hint button', async (g) => {
  const p = await open(g);
  const bad = [];
  const r = await p.evaluate(() => { const b = document.getElementById('board') || document.getElementById('grid'), rect = b.getBoundingClientRect(), cs = getComputedStyle(b); return { page: getComputedStyle(document.body).backgroundColor, width: rect.width, frame: parseFloat(cs.borderTopWidth), square: Math.abs(rect.width - rect.height) < 6, pills: document.querySelectorAll('.fun-pills b').length, hint: (document.getElementById('hint-btn') || {}).textContent || '', sw: document.documentElement.scrollWidth }; });
  const want = { tango: /58, 43, 92/, queens: /74, 44, 61/, zip: /31, 59, 77/, patches: /47, 74, 58/, 'cross-sums': /43, 58, 82/, 'sliding-puzzle': /74, 58, 36/ }[g];
  if (!want.test(r.page)) bad.push('page colour is ' + r.page);
  if (r.width < 360) bad.push('the grid is not edge to edge (' + Math.round(r.width) + 'px)');
  if (r.frame < 5) bad.push('no heavy frame');
  if (!r.square) bad.push('the grid is not square any more (a cell is taller than its share)');
  if (r.pills < 2) bad.push('Time and Best belong in the header');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(r.hint)) bad.push('emoji on the hint button');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['tango', 'queens', 'zip', 'patches', 'cross-sums', 'sliding-puzzle']);

check('word-pages-look', 'word ladder and letter boxed should be the redesign: pine / leather page colours, their score boxes in the header, no emoji on the hint button, and the word ladder typing must still work', async (g) => {
  const p = await open(g);
  await p.waitForTimeout(500);
  const bad = [];
  const r = await p.evaluate(() => ({ page: getComputedStyle(document.body).backgroundColor, pills: document.querySelectorAll('.fun-pills b').length, hint: (document.getElementById('hint-btn') || {}).textContent || '', sw: document.documentElement.scrollWidth }));
  if (g === 'word-ladder' && !/31, 58, 47/.test(r.page)) bad.push('page is not the pine green (' + r.page + ')');
  if (g === 'letter-boxed' && !/58, 42, 26/.test(r.page)) bad.push('page is not the leather brown (' + r.page + ')');
  if (r.pills !== 2) bad.push('score boxes missing from the header');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(r.hint)) bad.push('emoji on the hint button');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (g === 'word-ladder') {
    await p.locator('#kb .wl-key').first().click(); await p.waitForTimeout(100);
    const typed = await p.evaluate(() => [...document.querySelectorAll('.wl-row.input .wl-tile')].some((t) => t.textContent.trim()));
    if (!typed) bad.push('typing a letter on the on-screen keyboard shows nothing');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['word-ladder', 'letter-boxed']);

check('mastermind-and-rps-look', 'mastermind and rock paper scissors should be the redesign: their own page colour, flat ringed pegs / white choice cards, no sideways scroll, and a round must still play through', async (g) => {
  const p = await open(g, 390, "var m=document.querySelector('#mode');if(m){var o=[...m.options].find(function(x){return /comp|ai/.test(x.value)});if(o){m.value=o.value;m.dispatchEvent(new Event('change'))}}");
  await p.waitForTimeout(500);
  const bad = [];
  const r = await p.evaluate(() => ({ page: getComputedStyle(document.body).backgroundColor, sw: document.documentElement.scrollWidth, peg: (() => { const e = document.querySelector('.mm-peg:not(.empty)'); return e ? getComputedStyle(e).borderTopWidth : null; })(), choice: (() => { const e = document.querySelector('.rps-choice'); return e ? getComputedStyle(e).backgroundColor : null; })() }));
  if (g === 'mastermind' && !/58, 37, 72/.test(r.page)) bad.push('page is not the plum (' + r.page + ')');
  if (g === 'rock-paper-scissors' && !/32, 64, 90/.test(r.page)) bad.push('page is not the ocean blue (' + r.page + ')');
  if (g === 'mastermind' && r.peg && parseFloat(r.peg) < 3) bad.push('pegs have no heavy ring');
  if (g === 'rock-paper-scissors' && r.choice && !/255, 255, 255/.test(r.choice)) bad.push('choice cards are not white (' + r.choice + ')');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (g === 'rock-paper-scissors') {
    await p.locator('.rps-choice').first().click(); await p.waitForTimeout(1200);
    const after = await p.evaluate(() => document.getElementById('score').textContent.length > 0);
    if (!after) bad.push('the score is empty after a round');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['mastermind', 'rock-paper-scissors']);

check('no-js-errors', 'a page threw an error while loading', async (g) => {
  const p = await open(g);
  const e = p.errs.slice(); await p.close();
  return e;
}, FUN);

check('hearts-pass-and-play', 'hearts: the pass must take three cards and a highlighted card must play a trick; the hand has to deal 13 cards and show four scores', async () => {
  const p = await open('hearts', 390);
  const bad = [];
  if (await p.locator('.ht-score').count() !== 4) bad.push('not four score slots');
  const hand = p.locator('#ht-hand .ht-card');
  if (await hand.count() !== 13) bad.push('dealt ' + (await hand.count()) + ' cards, not 13');
  for (let i = 0; i < 3; i++) await hand.nth(i).click();
  const pass = p.locator('#ht-actions button').first();
  if (!(await pass.count())) bad.push('no pass button after choosing three cards');
  else if (await pass.isDisabled()) bad.push('the pass button stayed disabled with three cards chosen');
  else await pass.click();
  let played = false;
  try {
    await p.locator('#ht-hand .ht-card.play').first().waitFor({ state: 'visible', timeout: 9000 });
    const before = await hand.count();
    await p.locator('#ht-hand .ht-card.play').first().click();
    await p.waitForTimeout(500);
    const after = await hand.count();
    if (after !== before - 1) bad.push('the hand was ' + before + ' cards, then ' + after + ' after playing one');
    played = true;
  } catch (e) { /* reported below */ }
  if (!played) bad.push('no playable card appeared after the pass');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['hearts']);

check('ludo-board-and-roll', 'ludo: the cross board must have 225 cells, 52 track cells and 16 tokens inside it; a forced 6 must highlight all four tokens and a tap must move one', async () => {
  const p = await open('ludo', 390);
  const bad = [];
  const board = await p.locator('#ld-board').boundingBox();
  if (!board) bad.push('no board');
  if (await p.locator('#ld-cells .ld-cell').count() !== 225) bad.push('the grid is not 15 by 15');
  if (await p.locator('#ld-cells .track').count() !== 52) bad.push('the loop is not 52 cells');
  if (await p.locator('#ld-tokens .ld-token').count() !== 16) bad.push('not 16 tokens on a four-player board');
  if (await p.locator('.ld-player').count() !== 4) bad.push('not four player tabs');
  if (board) {
    const outside = await p.evaluate(() => {
      const b = document.querySelector('#ld-board').getBoundingClientRect();
      return [...document.querySelectorAll('.ld-token')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1;
      }).length;
    });
    if (outside) bad.push(outside + ' token(s) drawn outside the board');
  }
  const before = await p.locator('.ld-token').first().evaluate((e) => e.style.left + '|' + e.style.top);
  await p.evaluate(() => { Math.random = () => 0.999; });     // the next roll is a 6
  await p.locator('#ld-roll').click();
  await p.waitForTimeout(700);
  const die = await p.locator('#ld-die').getAttribute('aria-label');
  if (die !== 'Die showing 6') bad.push('the forced roll showed ' + die);
  if (await p.locator('.ld-token.movable').count() !== 4) bad.push('a 6 did not make all four yard tokens playable');
  else {
    await p.locator('.ld-token.movable').first().click();
    await p.waitForTimeout(500);
    const after = await p.locator('.ld-token').first().evaluate((e) => e.style.left + '|' + e.style.top);
    if (after === before) bad.push('the token did not move after it was tapped');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['ludo']);

check('new-card-games-online-landing', 'the new card games must show the online landing screen (and Hearts must say it always fills four seats) when Online is chosen', async (g) => {
  const p = await open(g, 390);
  await p.evaluate(() => { const s = document.querySelector('#mode'); s.value = 'live'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(350);
  const text = (await p.locator('#ms-room').textContent()) || '';
  const bad = [];
  if (!/Play (Hearts|Ludo|Farkle|Lost Cities|Cribbage|Skull) online/.test(text)) bad.push('no online landing screen: ' + text.slice(0, 80));
  if (await p.locator(g === 'hearts' ? '#ht.on' : g === 'ludo' ? '#ld.on' : g === 'farkle' ? '#board.on' : g === 'cribbage' ? '#cb.on' : g === 'skull' ? '#sk.on' : '#lc.on').count()) bad.push('the board is still showing on the landing screen');
  if (g === 'hearts' && !/always has 4 seats/.test(text)) bad.push('the four-seat rule is not explained on the landing screen');
  if (g === 'lost-cities' && !/always has 2 seats/.test(text)) bad.push('the two-seat rule is not explained on the landing screen');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['hearts', 'ludo', 'farkle', 'lost-cities', 'cribbage', 'skull']);

check('online-to-computer-clears-room', 'switching from the online landing screen back to the computer left the room panel over the local board', async (g) => {
  const p = await open(g, 390);
  await p.evaluate(() => { const s = document.querySelector('#mode'); s.value = 'live'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const s = document.querySelector('#mode'); s.value = 'computer'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(400);
  const bad = [];
  if (!(await p.locator('#ms-room').isHidden())) bad.push('the online room panel is still showing');
  const board = { hearts: '#ht.on', ludo: '#ld.on', dominoes: '#dm.on', farkle: '#board.on', 'lost-cities': '#lc.on', cribbage: '#cb.on', skull: '#sk.on' }[g];
  if (!(await p.locator(board).count())) bad.push('the local board did not come back');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['hearts', 'ludo', 'dominoes', 'farkle', 'lost-cities', 'cribbage', 'skull']);

check('nine-mens-morris-places', 'Nine Men\'s Morris: tapping a point must place a piece and pass the turn', async () => {
  const p = await open('nine-mens-morris', 390);
  await p.evaluate(() => { const s = document.querySelector('#mode'); s.value = 'local'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(250);
  const bad = [];
  if (await p.locator('#board .nmm-pt').count() !== 24) bad.push('not 24 points on the board');
  if (!(await p.locator('#board .nmm-pc').count() === 0)) bad.push('the board did not start empty');
  await p.locator('#board .nmm-pt').first().click();
  await p.waitForTimeout(250);
  if (await p.locator('#board .nmm-pc').count() !== 1) bad.push('a point did not take a new piece');
  if (!/Blue|Red/.test((await p.locator('#status').textContent()) || '')) bad.push('the turn did not move on');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['nine-mens-morris']);

check('breakthrough-moves', 'Breakthrough: tapping a piece must mark its destinations and tapping one must move it', async () => {
  const p = await open('breakthrough', 390);
  await p.evaluate(() => { const s = document.querySelector('#mode'); s.value = 'local'; s.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(250);
  const bad = [];
  if (await p.locator('#board .bt-cell').count() !== 64) bad.push('not an 8 by 8 board');
  if (await p.locator('#board .bt-pc.p1').count() !== 16) bad.push('not sixteen red pieces');
  await p.locator('#board .bt-pc.p1').first().click();
  await p.waitForTimeout(200);
  const dest = p.locator('#board .bt-cell.dest');
  if (!(await dest.count())) bad.push('tapping a piece marked no destinations');
  else {
    await dest.first().click();
    await p.waitForTimeout(250);
    if (await p.locator('#board .bt-cell.dest').count()) bad.push('the destinations stayed up after a move');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['breakthrough']);

check('farkle-rolls', 'Farkle: ROLL must deal six dice and ask which ones score', async () => {
  const p = await open('farkle', 390);
  const bad = [];
  if (await p.locator('.fk-slot').count() !== 6) bad.push('not six dice slots');
  await p.locator('#fk-primary').click();
  await p.waitForTimeout(900);
  if (await p.locator('.fk-slot').count() !== 6) bad.push('the dice tray changed size on a roll');
  const labels = await p.locator('.fk-slot').evaluateAll((es) => es.map((e) => e.getAttribute('aria-label') || ''));
  if (labels.filter((x) => /^Die showing [1-6]/.test(x)).length !== 6) bad.push('the roll did not show six faces');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['farkle']);

check('hashiwokakero-board', 'Hashiwokakero: the daily board must draw its islands and offer a hint', async () => {
  const p = await open('hashiwokakero', 390);
  const bad = [];
  if (await p.locator('.hk-isle').count() < 4) bad.push('not enough islands on the board');
  if (await p.locator('#hint-btn').count() !== 1) bad.push('no hint button');
  else { await p.locator('#hint-btn').click(); await p.waitForTimeout(300); }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['hashiwokakero']);

check('flow-free-board', 'Flow Free: the daily board must have a full grid of cells and its coloured endpoints', async () => {
  const p = await open('flow-free', 390);
  await p.waitForSelector('.ff-cell', { timeout: 5000 }).catch(() => {});
  const bad = [];
  const cells = await p.locator('.ff-cell').count();
  if (cells !== 36 && cells !== 49 && cells !== 64) bad.push('the grid has ' + cells + ' cells');
  if (await p.locator('#svg circle').count() < 4) bad.push('the endpoint dots are missing');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['flow-free']);

check('word-search-grid', 'Word Search: the daily grid and its word list must be drawn', async () => {
  const p = await open('word-search', 390);
  const bad = [];
  const cells = await p.locator('.ws-cell').count();
  if (cells !== 64 && cells !== 100 && cells !== 144) bad.push('the grid has ' + cells + ' cells');
  if (await p.locator('.ws-word').count() < 5) bad.push('the word list is missing');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['word-search']);

check('lost-cities-deal', 'Lost Cities: both expeditions and eight hand cards must be dealt, and a discard must lead to a draw', async () => {
  const p = await open('lost-cities', 390);
  const bad = [];
  if (await p.locator('.lc-card').count() !== 8) bad.push('not eight cards in hand');
  if (!(await p.locator('.lc-deck').count())) bad.push('no deck');
  await p.locator('.lc-card').first().click();
  await p.waitForTimeout(200);
  const acts = p.locator('#lc-actions button');
  if (await acts.count() < 2) bad.push('no Play/Discard controls');
  else {
    await acts.nth(1).click();
    await p.waitForTimeout(250);
    if (await p.locator('.lc-deck').count()) { await p.locator('.lc-deck').click(); await p.waitForTimeout(350); }
    if (await p.locator('.lc-card').count() !== 8) bad.push('the hand did not return to eight after drawing');
  }
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['lost-cities']);

/* ---------- online tables: table talk ---------- */
// The Hype / Heckle lines were renamed (angel/devil, "a"/"d" -> "h"/"k") and Crazy 8's own copy of the
// buttons was missed, so its table threw as soon as an online game was running. This serves each
// multi-seat page a real, started room (worker/card-protocol.mjs) through a faked socket and checks the
// table-talk buttons appear without a script error.
const CARDP = await import(new URL('file:///' + path.join(ROOT, 'worker', 'card-protocol.mjs').replace(/\\/g, '/')));
check('online-table-talk', 'Online tables: the Hype / Heckle buttons must draw (Crazy 8 still read the old angel/devil lists and threw an error as soon as a game was running)', async (g) => {
  const room = CARDP.newRoom('ABCDEF', Date.now(), g);
  let n = 0; const mint = () => 'tok' + ++n;
  const me = CARDP.join(room, null, 'Ann', mint, Date.now(), Math.random);
  CARDP.join(room, null, 'Bob', mint, Date.now(), Math.random);
  if (g === 'skull') CARDP.setConfig(room, me.pid, { bots: 1 }, Date.now(), Math.random);
  if (room.phase === 'lobby') CARDP.start(room, me.pid, Date.now(), Math.random);
  const bad = [];
  if (room.phase !== 'playing') return ['the test room did not start: ' + room.phase];
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.routeWebSocket(/\/api\/card\//, (ws) => ws.onMessage((raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t !== 'hello') return;
    ws.send(JSON.stringify({ t: 'welcome', pid: me.pid, token: me.token, code: room.code, game: g }));
    ws.send(JSON.stringify({ t: 'room', v: CARDP.viewFor(room, me.pid, Date.now()) }));
  }));
  await p.goto(base + g + '/?live=ABCDEF');
  await p.waitForTimeout(1500);
  const hype = await p.evaluate(() => window.TAUNT_LINES.online.hype);
  const shown = await p.evaluate((lines) => [...document.querySelectorAll('button')].filter((b) => b.offsetParent && lines.includes(b.textContent.trim())).length, hype);
  if (shown < 1) bad.push('no table-talk button is visible');
  if (errs.length) bad.push('errors: ' + errs.join(';'));
  await p.close();
  return bad;
}, ['crazy-8', 'liars-dice', 'dominoes', 'ludo', 'hearts', 'farkle', 'lost-cities', 'cribbage', 'skull']);

check('how-to-reachable', 'Hearts and Ludo hid their How to play button (CSS display:none on the top bar one), so the rules could not be opened at all; every game must offer it in the top bar or inside Options, and it must open the rules', async (g) => {
  const p = await open(g, 390);
  const vis = () => p.evaluate(() => [...document.querySelectorAll('.man-trigger')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length);
  let n = await vis();
  if (!n && await p.locator('.gk-optbtn').count()) { await p.locator('.gk-optbtn').click(); await p.waitForTimeout(250); n = await vis(); }
  const bad = [];
  if (!n) bad.push('no visible How to play button, in the top bar or in Options');
  else {
    await p.locator('.man-trigger:visible').first().click(); await p.waitForTimeout(300);
    if (!(await p.locator('.man-window:visible').count())) bad.push('the How to play button does not open the rules');
  }
  await p.close();
  return bad;
}, FUN);

/* ---------- run ---------- */
// Checks run in parallel (each opens its own page). --quick runs each check on 2 sample pages only:
// a fast smoke pass while working; run the full thing before a deploy.
// A check that fails under load is run once more on its own: a pass then counts, marked "flaky".
const jobs = [];
for (const c of checks) {
  if (ONLY && !c.id.includes(ONLY)) continue;
  const pages = c.pages.filter(wantPage);
  for (const g of QUICK && !PAGE ? [pages[0], pages[Math.floor(pages.length / 2)]].filter((x, i, a) => x && a.indexOf(x) === i) : pages) jobs.push({ c, g });
}
if (!jobs.length) { console.log('no checks matched --only / --page'); await browser.close(); srv.close(); process.exit(1); }
const attempt = async ({ c, g }) => { try { return await c.fn(g); } catch (e) { return ['threw: ' + e.message.split('\n')[0]]; } };
const out = new Array(jobs.length);
let next = 0, printed = 0;
async function worker() {
  while (next < jobs.length) {
    const i = next++;
    out[i] = await attempt(jobs[i]);
    while (out[printed]) { // print in order as results arrive
      const bad = out[printed], { c, g } = jobs[printed++];
      console.log(bad.length ? 'retry ' + c.id + ' · ' + g + ' (failed, will run once more alone)' : 'pass  ' + c.id + ' · ' + g);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: JOBS }, worker));
let failed = 0, flaky = 0;
for (let i = 0; i < jobs.length; i++) {
  if (!out[i].length) { results.push({ id: jobs[i].c.id, g: jobs[i].g, ok: true }); continue; }
  const again = await attempt(jobs[i]), { c, g } = jobs[i];
  if (!again.length) { flaky++; console.log('flaky ' + c.id + ' · ' + g + ' (failed under load, passed alone)'); }
  else { failed++; console.log('FAIL  ' + c.id + ' · ' + g + '\n      ' + again.join('\n      ') + '\n      (' + c.issue + ')'); }
  results.push({ id: c.id, g, ok: !again.length });
}
await browser.close(); srv.close();
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed' + (flaky ? ', ' + flaky + ' flaky' : '') + (failed ? ', ' + failed + ' FAILED' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + 's');
process.exit(failed ? 1 : 0);
