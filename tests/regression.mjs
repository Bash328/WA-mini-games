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
const ONLY = opt('only'), PAGE = opt('page');

/* ---------- pages ---------- */
// pages with the steady layout (data-fun-zone): message zone, Options popover, board in a fixed place
const ZONE = ['mastermind', 'rock-paper-scissors', 'word-ladder', 'letter-boxed', 'cross-sums', 'sliding-puzzle', 'tango', 'queens', 'zip', 'patches', 'nonogram', 'lights-out', 'sudoku', 'mini-sudoku', 'blokus-duo', 'onitama', 'gomoku', 'hex', 'quoridor', 'pentago', 'ultimate-tic-tac-toe', 'battleship', 'yatzy', 'dominoes', 'pig', 'liars-dice', 'chess', 'checkers', 'tic-tac-toe', 'reversi', 'connect-four', 'backgammon', 'dots-and-boxes', 'mancala', '2048', 'minesweeper', 'memory', 'water-sort', 'hangman'];
const FUN = [...ZONE, 'crazy-8', 'word-guess'];
// what to measure as "the board" on each page (default #board)
// pages whose first thing is a form (hangman: set the secret word) may start lower
const MAXTOP = { hangman: 520, battleship: 470, onitama: 470, mastermind: 620, 'rock-paper-scissors': 620 };
// pages whose layout legitimately differs between modes (the guess panel only exists while it is your turn)
const NOMODECMP = new Set(['mastermind']);
const BOARD = { 'water-sort': '#tubes', hangman: '#gallows', yatzy: '#dice', mastermind: '#count', 'rock-paper-scissors': '#choices', 'word-ladder': '#ladder', 'letter-boxed': '#box', 'cross-sums': '#grid', battleship: '#bs-main', dominoes: '#dm-line', 'liars-dice': '#ld-bid' };
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
  await p.mouse.move(start.x, start.y); await p.mouse.down();
  await p.mouse.move(start.x + start.w * 0.6, start.y, { steps: 2 });
  // sample the head while it travels: it must be seen between two squares at least once
  const seen = await p.evaluate(() => new Promise((res) => { const xs = []; const t0 = performance.now(); const f = () => { const c = document.querySelector('#svg circle'); if (c) xs.push(+c.getAttribute('cx')); if (performance.now() - t0 < 260) requestAnimationFrame(f); else res(xs); }; f(); }));
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
  const seen = await p.evaluate(() => new Promise((res) => { const t0 = performance.now(); let slide = 0, fade = 0, pop = 0; const f = () => { document.querySelectorAll('#board .tile').forEach((t) => t.getAnimations().forEach((a) => { const k = a.effect.getKeyframes(), d = a.effect.getTiming().duration; if (t.classList.contains('ghost')) { slide = Math.max(slide, d); if (k.some((x) => x.opacity !== undefined && String(x.opacity) === '0')) fade++; } if (k.some((x) => /scale\(1\.12\)/.test(x.transform || ''))) pop++; })); if (performance.now() - t0 < 320) requestAnimationFrame(f); else res({ slide, fade, pop }); }; f(); }));
  if (!(seen.slide >= 170 && seen.slide <= 220)) bad.push('the slide should take about 190ms for a smooth swipe (saw ' + seen.slide + 'ms)');
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
    let squash = false, popFromOne = false, popExpands = false, slideEase = '';
    const t0 = performance.now();
    const sample = () => {
      document.querySelectorAll('#board .tile').forEach((tile) => tile.getAnimations().forEach((animation) => {
        const frames = animation.effect.getKeyframes().map((frame) => frame.transform || '');
        const joined = frames.join(' ');
        if (joined.includes('scale(0.92)')) squash = true;
        if (tile.classList.contains('ghost')) slideEase = animation.effect.getTiming().easing || '';
        if (!tile.classList.contains('ghost') && frames[0].includes('scale(1)')) popFromOne = true;
        if (!tile.classList.contains('ghost') && frames.some((transform) => transform.includes('scale(1.12)'))) popExpands = true;
      }));
      if (performance.now() - t0 < 480) requestAnimationFrame(sample);
      else res({ squash, popFromOne, popExpands, slideEase });
    };
    sample();
  }));
  await p.close();
  const bad = [];
  if (seen.squash) bad.push('tiles still squash before they merge');
  if (!seen.popFromOne || !seen.popExpands) bad.push('the doubled tile does not bulge from full size after they meet');
  if (!/0\.215/.test(seen.slideEase)) bad.push('the slide does not ease-out (saw ' + seen.slideEase + ')');
  return bad;
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

check('crazy-8-table-full-size', 'crazy 8: the table had been narrowed to stop the page scrolling, which made the cards small and pulled the side player cards in from the screen edge; the table must be the full width of the screen', async () => {
  const p = await open('crazy-8', 390, "var m=document.querySelector('#mode');if(m&&[...m.options].some(o=>o.value==='computer')){m.value='computer';m.dispatchEvent(new Event('change'))}");
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => { const c = document.getElementById('c8').getBoundingClientRect(), st = document.getElementById('c8-stage').getBoundingClientRect(), hand = document.querySelector('#c8-hand .c8-card'); return { w: Math.round(c.width), stage: Math.round(st.width), card: hand ? Math.round(hand.getBoundingClientRect().height) : 0 }; });
  await p.close();
  const bad = [];
  if (r.w < 385) bad.push('the table is only ' + r.w + 'px wide');
  if (r.card < 100) bad.push('your cards are only ' + r.card + 'px tall');
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
    return { picture: /fun\/tube\.png/.test(af.backgroundImage), ratio: tr.height / tr.width,
      inside: fl.length ? fl.every((r) => r.left >= fr.left + fr.width * 0.12 && r.right <= fr.right - fr.width * 0.12 && r.bottom <= fr.bottom - 1 && r.top >= fr.top + fr.height * 0.17) : true,
      ucircle: parseFloat(u.width) >= 60 && parseFloat(u.borderTopLeftRadius) >= 30, hint: [h.left, h.bottom], undo: [un.left, un.bottom], vivid: Math.max(...[...document.querySelectorAll('.ws-l')].map((e) => { const m = getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number); return Math.max(...m) - Math.min(...m); })), sw: document.documentElement.scrollWidth };
  });
  if (!look.picture) bad.push('the tubes are not the glass picture from the reference (fun/tube.png)');
  if (look.ratio < 2.8 || look.ratio > 3.2) bad.push('tube proportions are off: height/width is ' + look.ratio.toFixed(2) + ', the picture is 2.98');
  if (!look.inside) bad.push('the liquid pokes outside the glass or into its neck');
  if (!look.ucircle) bad.push('Undo is not a big round button');
  if (look.hint[1] > 844 || look.undo[1] > 844) bad.push('Undo / Hint are below the fold');
  if (look.hint[0] < look.undo[0] + 200) bad.push('Hint should sit at the right, Undo at the left');
  if (look.sw > 390) bad.push('page got wider');
  if (look.vivid < 120) bad.push('liquid colours are washed out');
  // a pour: tap one tube, then another that accepts it, and look for the falling stream
  const n = await p.locator('.ws-tube').count();
  let saw = false;
  for (let a = 0; a < n && !saw; a++) for (let c = 0; c < n && !saw; c++) {
    if (a === c) continue;
    await p.locator('.ws-tube').nth(a).click(); await p.waitForTimeout(60);
    await p.locator('.ws-tube').nth(c).click(); await p.waitForTimeout(150);
    if (await p.locator('.ws-stream').count()) saw = true;
  }
  if (!saw) bad.push('no pour animation: no stream appeared when a move was made');
  else {
    await p.waitForTimeout(1200);
    if (await p.locator('.ws-stream').count()) bad.push('the stream never went away');
    if ((await p.locator('#moves').textContent()).trim() !== '1') bad.push('the move was not counted after the pour');
  }
  await p.close();
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

check('app-icon-and-launch-images', 'the app icon, the launch images and the link banner must be the redesigned art (four tilted chunky tiles on the Sunset gradient), every launch image the exact size its file name says, the manifest in the Sunset colour, and no emoji in the favicon', async () => {
  const bad = [];
  const sizes = { 'icon-192.png': [192, 192], 'icon-512.png': [512, 512], 'icon-maskable-512.png': [512, 512], 'apple-touch-icon.png': [180, 180], 'og-image.png': [1200, 300] };
  const png = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  for (const [f, [w, h]] of Object.entries(sizes)) { const i = png(f); if (i.w !== w || i.h !== h) bad.push(f + ' is ' + i.w + 'x' + i.h + ', wanted ' + w + 'x' + h); }
  for (const f of fs.readdirSync(path.join(ROOT, 'splash'))) { const m = /^(\d+)x(\d+)\.png$/.exec(f); if (!m) continue; const i = png('splash/' + f); if (i.w !== Number(m[1]) || i.h !== Number(m[2])) bad.push('splash/' + f + ' is ' + i.w + 'x' + i.h); }
  // the art itself: sample the icon in the browser (the four tile colours are all present)
  const p = await browser.newPage({ viewport: { width: 600, height: 600 } });
  await p.goto(base + 'icon-512.png');
  // the art itself: count the pixels of each Sunset tile colour (the tiles are tilted, so a fixed spot would miss) and check the coral-to-plum gradient behind them
  const c = await p.evaluate(async () => { const img = document.images[0]; await img.decode(); const cv = document.createElement('canvas'); cv.width = cv.height = 512; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, 512, 512).data; const want = [[255, 200, 60], [255, 110, 170], [255, 150, 60], [150, 100, 230]]; const counts = want.map((w) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - w[0]) < 18 && Math.abs(d[i + 1] - w[1]) < 18 && Math.abs(d[i + 2] - w[2]) < 18 && d[i + 3] > 250) n++; return n; }); const px = (a, b) => [...x.getImageData(a, b, 1, 1).data]; return { counts, top: px(256, 40), bottom: px(256, 470) }; });
  await p.close();
  if (!c.counts.every((n) => n > 1500)) bad.push('the icon does not show the four Sunset tile colours (pixels per colour: ' + c.counts.join(', ') + ')');
  const warm = (a) => a[0] > 200 && a[1] > 90 && a[2] < 150, plum = (a) => a[0] > 110 && a[0] < 190 && a[1] < 90 && a[2] > 90;
  if (!warm(c.top) || !plum(c.bottom)) bad.push('the icon background is not the coral-to-plum Sunset gradient (' + JSON.stringify([c.top, c.bottom]) + ')');
  const svg = fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(svg) || /<text/.test(svg)) bad.push('the favicon still uses an emoji or text');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  if (man.background_color !== '#c6566e' || man.theme_color !== '#c6566e') bad.push('manifest colours should be the Sunset #c6566e');
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
}, ['ultimate-tic-tac-toe', 'letter-boxed', 'word-ladder', 'rock-paper-scissors']);

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
