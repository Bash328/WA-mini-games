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
const ZONE = ['tango', 'queens', 'zip', 'patches', 'nonogram', 'lights-out', 'sudoku', 'mini-sudoku', 'blokus-duo', 'onitama', 'gomoku', 'hex', 'quoridor', 'pentago', 'ultimate-tic-tac-toe', 'battleship', 'yatzy', 'dominoes', 'pig', 'liars-dice', 'chess', 'checkers', 'tic-tac-toe', 'reversi', 'connect-four', 'backgammon', 'dots-and-boxes', 'mancala', '2048', 'minesweeper', 'memory', 'water-sort', 'hangman'];
const FUN = [...ZONE, 'crazy-8', 'word-guess'];
// what to measure as "the board" on each page (default #board)
// pages whose first thing is a form (hangman: set the secret word) may start lower
const MAXTOP = { hangman: 520, battleship: 470, onitama: 470 };
const BOARD = { 'water-sort': '#tubes', hangman: '#gallows', yatzy: '#dice', battleship: '#bs-main', dominoes: '#dm-line', 'liars-dice': '#ld-bid' };
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
  const ghost = await p.evaluate(() => { const g = document.getElementById('ghost'), b = document.getElementById('bubble'), gr = g.getBoundingClientRect(), br = b.getBoundingClientRect(), ga = document.getElementById('gallows').getBoundingClientRect(); return { shown: !g.hasAttribute('hidden') && gr.width > 0, bubbleGhost: b.classList.contains('ghost'), nextToBubble: gr.right <= br.left + 4 && Math.abs((gr.top + gr.bottom) / 2 - (br.top + br.bottom) / 2) < 70, besideMan: gr.left > ga.left + ga.width * 0.5, inside: gr.right <= 390 }; });
  if (!ghost.shown) bad.push('no ghost appears when he runs out of chances');
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
  if (!/133, 124, 110/.test(info.back)) bad.push('the bot tile backs should be the grey-brown tiles');
  if (!/143, 46, 46/.test(info.hand)) bad.push('your hand should sit on the red floor');
  if (info.boxed !== 'rgba(0, 0, 0, 0)') bad.push('hand tiles are boxed in a button background (' + info.boxed + ')');
  if (info.line < 230) bad.push('the table is too short (' + Math.round(info.line) + 'px)');
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

check('hub-look', 'the game hub should be the dark page with a top bar (menu, your name, invite) and big rounded game tiles in two columns, every tile leading to a real page, nothing wider than the phone, and its scripts and styles stamped', async () => {
  const bad = [];
  for (const w of [320, 390]) {
    const p = await browser.newPage({ viewport: { width: w, height: 844 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(700);
    const r = await p.evaluate(() => { const cards = [...document.querySelectorAll('a.card')]; const first = cards[0].getBoundingClientRect(), second = cards[1].getBoundingClientRect(); return { n: cards.length, hrefs: cards.map((c) => c.getAttribute('href')), bg: getComputedStyle(document.body).backgroundColor, sw: document.documentElement.scrollWidth, sameRow: Math.abs(first.top - second.top) < 4, topbar: !!document.getElementById('menu-btn') && !!document.getElementById('name-btn') && !!document.getElementById('invite-btn'), radius: parseFloat(getComputedStyle(cards[0]).borderTopLeftRadius), title: !!cards[0].querySelector('h3') }; });
    if (r.n < 40) bad.push(w + 'px: only ' + r.n + ' game tiles');
    if (!/23, 23, 25/.test(r.bg)) bad.push(w + 'px: page is not the dark background (' + r.bg + ')');
    if (r.sw > w) bad.push(w + 'px: page is ' + r.sw + 'px wide');
    if (!r.sameRow) bad.push(w + 'px: tiles are not in two columns');
    if (!r.topbar) bad.push('top bar is missing the menu, name or invite button');
    if (r.radius < 20) bad.push('tiles are not rounded');
    if (w === 390) {
      for (const h of r.hrefs) if (!fs.existsSync(path.join(ROOT, h.replace(/\/$/, ''), 'index.html'))) bad.push('tile links to a missing page: ' + h);
      await p.locator('#menu-btn').click(); await p.waitForTimeout(150);
      if (await p.locator('#menu').isHidden()) bad.push('the menu does not open');
      await p.locator('body').click({ position: { x: 380, y: 600 } }); await p.waitForTimeout(150);
      if (!(await p.locator('#menu').isHidden())) bad.push('tapping outside does not close the menu');
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

check('battleship-look', 'battleship should look like the redesign: the enemy waters blue, your fleet orange with the ships shown in red on it, hits red, no glyph symbols on the placement buttons', async () => {
  const p = await open('battleship', 390, "var m=document.querySelector('#mode');m.value='computer';m.dispatchEvent(new Event('change'));document.body.classList.add('gk-play')");
  await p.waitForTimeout(400);
  const bad = [];
  await p.locator('#bs-random').click(); await p.waitForTimeout(150);
  const place = await p.evaluate(() => ({ frame: getComputedStyle(document.getElementById('bs-main')).backgroundColor, ship: [...document.querySelectorAll('#bs-main .bs-cell.ship')].length, shipBg: getComputedStyle(document.querySelector('#bs-main .bs-cell.ship')).backgroundColor, btns: ['bs-rotate', 'bs-random', 'bs-clear'].map((i) => document.getElementById(i).textContent), sw: document.documentElement.scrollWidth }));
  if (!/224, 138, 104/.test(place.frame)) bad.push('your fleet grid is not the orange frame (' + place.frame + ')');
  if (place.ship < 14) bad.push('ships should show on your grid after Random (saw ' + place.ship + ' cells)');
  if (!/25\d, 11\d, 9\d/.test(place.shipBg)) bad.push('ship cells are not the flat red (' + place.shipBg + ')');
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

check('app-icon-and-launch-images', 'the app icon, the launch images and the link banner must be the redesigned art (four chunky tiles on a dark page), every launch image the exact size its file name says, the manifest dark, and no emoji in the favicon', async () => {
  const bad = [];
  const sizes = { 'icon-192.png': [192, 192], 'icon-512.png': [512, 512], 'icon-maskable-512.png': [512, 512], 'apple-touch-icon.png': [180, 180], 'og-image.png': [1200, 300] };
  const png = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
  for (const [f, [w, h]] of Object.entries(sizes)) { const i = png(f); if (i.w !== w || i.h !== h) bad.push(f + ' is ' + i.w + 'x' + i.h + ', wanted ' + w + 'x' + h); }
  for (const f of fs.readdirSync(path.join(ROOT, 'splash'))) { const m = /^(\d+)x(\d+)\.png$/.exec(f); if (!m) continue; const i = png('splash/' + f); if (i.w !== Number(m[1]) || i.h !== Number(m[2])) bad.push('splash/' + f + ' is ' + i.w + 'x' + i.h); }
  // the art itself: sample the icon in the browser (the four tile colours are all present)
  const p = await browser.newPage({ viewport: { width: 600, height: 600 } });
  await p.goto(base + 'icon-512.png');
  const c = await p.evaluate(async () => { const img = document.images[0]; await img.decode(); const cv = document.createElement('canvas'); cv.width = cv.height = 512; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); const px = (a, b) => [...x.getImageData(a, b, 1, 1).data]; return { tiles: [px(130, 105), px(333, 105), px(130, 288), px(333, 288)] }; });
  await p.close();
  const near = (a, b) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) < 40);
  if (!c.tiles.every((t, i) => near(t, [[255, 122, 122], [63, 208, 192], [255, 191, 46], [167, 139, 250]][i]))) bad.push('the icon does not show the four tile colours: ' + JSON.stringify(c.tiles));
  const svg = fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(svg) || /<text/.test(svg)) bad.push('the favicon still uses an emoji or text');
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  if (man.background_color !== '#171719' || man.theme_color !== '#171719') bad.push('manifest colours should be #171719');
  return bad;
}, ['icons']);

check('strategy-boards-look', 'gomoku, hex, quoridor, pentago and ultimate tic-tac-toe should share the redesign: the dark purple page, the board edge to edge with a heavy frame (or a light card for ultimate), flat pieces', async (g) => {
  const p = await open(g);
  const r = await p.evaluate(() => { const b = document.getElementById('board'); const cs = getComputedStyle(b); const rect = b.getBoundingClientRect(); const ch = b.firstElementChild ? b.firstElementChild.getBoundingClientRect() : null; return { page: getComputedStyle(document.body).backgroundColor, border: parseFloat(cs.borderTopWidth), bg: cs.backgroundColor, left: rect.left, right: rect.right, sw: document.documentElement.scrollWidth, wrapped: !!b.closest('[class$="-wrap"]') }; });
  const bad = [];
  if (!/47, 53, 85/.test(r.page)) bad.push('page is not the dark purple (' + r.page + ')');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (r.right - r.left < 360) bad.push('the board is not edge to edge (' + Math.round(r.right - r.left) + 'px wide)');
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
}, ['ultimate-tic-tac-toe']);

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
  const r = await p.evaluate(() => { const b = document.getElementById('board'), rect = b.getBoundingClientRect(), cs = getComputedStyle(b); return { page: getComputedStyle(document.body).backgroundColor, width: rect.width, frame: parseFloat(cs.borderTopWidth), square: Math.abs(rect.width - rect.height) < 6, pills: document.querySelectorAll('.fun-pills b').length, hint: (document.getElementById('hint-btn') || {}).textContent || '', sw: document.documentElement.scrollWidth }; });
  const want = { tango: /58, 43, 92/, queens: /74, 44, 61/, zip: /31, 59, 77/, patches: /47, 74, 58/ }[g];
  if (!want.test(r.page)) bad.push('page colour is ' + r.page);
  if (r.width < 360) bad.push('the grid is not edge to edge (' + Math.round(r.width) + 'px)');
  if (r.frame < 5) bad.push('no heavy frame');
  if (!r.square) bad.push('the grid is not square any more (a cell is taller than its share)');
  if (r.pills !== 2) bad.push('Time and Best belong in the header');
  if (/[\u{1F300}-\u{1FAFF}]/u.test(r.hint)) bad.push('emoji on the hint button');
  if (r.sw > 390) bad.push('page is wider than the phone');
  if (p.errs.length) bad.push('errors: ' + p.errs.join(';'));
  await p.close();
  return bad;
}, ['tango', 'queens', 'zip', 'patches']);

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
