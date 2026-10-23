// Play-test sweep for one game page: cold load on Slow 4G, console/404s, three device profiles (desktop 1366x768,
// iPhone 15 on WebKit, small Android 360px), overflow / tap targets / dark / landscape / reduced motion, and link abuse
// (tampered, truncated, replayed, double-tapped links). Prints a JSON report; screenshots go to --shots <dir>.
//   node tools/playtest.mjs chess [--shots dir] [--move "sel1,sel2"]   (needs: npm i --no-save playwright)
// --move gives CSS selectors to click in order for the first move when a plain tap on one cell is not enough
// (an item starting with js: is run as a page expression instead; items are split on commas, so keep them comma-free).
import { chromium, webkit, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const game = args[0];
const opt = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const SHOTS = opt("shots");
const MOVE = opt("move") ? opt("move").split(",") : null;
if (!game) { console.error("usage: node tools/playtest.mjs <game-folder>"); process.exit(2); }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
});
await new Promise((r) => srv.listen(0, r));
const base = `http://localhost:${srv.address().port}/`;
const url = base + game + "/";
const report = { game, notes: [] };
const note = (s) => report.notes.push(s);

const PROFILES = {
  desktop: { engine: chromium, opts: { viewport: { width: 1366, height: 768 } } },
  iphone15: { engine: webkit, opts: { ...devices["iPhone 15"] } },
  android360: { engine: chromium, opts: { viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36" } },
};
const browsers = {};
async function newPage(profile, extra = {}) {
  const P = PROFILES[profile];
  browsers[P.engine.name()] ||= await (P.engine === chromium ? chromium.launch({ channel: "chrome" }) : webkit.launch());
  const ctx = await browsers[P.engine.name()].newContext({ ...P.opts, ...extra });
  await ctx.route((u) => /^https?:$/.test(u.protocol) && !u.href.startsWith(base), (r) => r.abort());
  const page = await ctx.newPage();
  page.errs = []; page.warns = []; page.bad = [];
  page.on("pageerror", (e) => page.errs.push(e.message));
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" && !/Failed to load resource|WebSocket/.test(t)) page.errs.push(t.slice(0, 160)); if (m.type() === "warning") page.warns.push(t.slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(base)) page.bad.push(r.status() + " " + r.url().replace(base, "")); });
  return page;
}
async function dismiss(page) {
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => document.querySelectorAll(".man-backdrop").forEach((n) => n.remove())).catch(() => {});
}
async function openGame(profile, query = "", extra) {
  const page = await newPage(profile, extra);
  await page.goto(url + query, { waitUntil: "load" });
  await dismiss(page);
  return page;
}

const step = (m) => console.error('[' + new Date().toISOString().slice(11, 19) + '] ' + m);
// 1. cold load, Slow 4G (1.6 Mbps down, 150 ms RTT) and a 4x slower CPU
{
  const page = await newPage("android360");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let raw = 0, gz = 0, n = 0;
  const jobs = [];
  page.on("response", (r) => { if (r.url().startsWith(base)) jobs.push(r.body().then((b) => { raw += b.length; gz += zlib.gzipSync(b).length; n++; }, () => {})); });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load" });
  const loadMs = Date.now() - t0;
  await Promise.all(jobs);
  const perf = await page.evaluate(() => ({ fcp: Math.round((performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint") || {}).startTime || 0) }));
  report.load = { slow4gMs: loadMs, fcpMs: perf.fcp, files: n, rawKB: Math.round(raw / 1024), gzKB: Math.round(gz / 1024), consoleErrors: page.errs, warnings: page.warns, http404s: page.bad };
  await page.context().close();
}

// 2. per-profile layout checks
async function layout(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden]") && !e.closest("template") && !e.disabled; };
    const small = [...document.querySelectorAll("button,a[href],select,input,[role=button]")].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { el: (e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/)[0] : "")) + (e.textContent.trim() ? ` "${e.textContent.trim().slice(0, 18)}"` : ""), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44);
    const tiny = [...document.querySelectorAll("body *")].filter((e) => vis(e) && [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim().length > 3) && parseFloat(getComputedStyle(e).fontSize) < 11).length;
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return { overflowPx: over, smallTargets: small.slice(0, 12), smallCount: small.length, tinyTextNodes: tiny, scrollH: document.documentElement.scrollHeight, innerH: innerHeight };
  });
}
step('load done'); report.profiles = {};
for (const profile of Object.keys(PROFILES)) {
  const out = (report.profiles[profile] = {});
  const page = await openGame(profile);
  out.errors = page.errs;
  out.portrait = await layout(page);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${game}-${profile}.png`) });
  const wh = page.viewportSize();
  await page.setViewportSize({ width: wh.height, height: wh.width });
  await page.waitForTimeout(300);
  out.landscape = await layout(page);
  if (SHOTS && profile !== "desktop") await page.screenshot({ path: path.join(SHOTS, `${game}-${profile}-landscape.png`) });
  await page.setViewportSize(wh);
  await page.context().close();
  for (const scheme of ["dark", "light"]) {
    const p2 = await openGame(profile, "", { colorScheme: scheme });
    out[scheme] = { overflowPx: (await layout(p2)).overflowPx, errors: p2.errs };
    if (SHOTS && profile === "android360") await p2.screenshot({ path: path.join(SHOTS, `${game}-${scheme}.png`) });
    await p2.context().close();
  }
}

step('profiles done');
// 3. link abuse (Android profile, Chrome)
async function tapMove(page) {
  const before = await page.evaluate(() => location.search);
  const seq = MOVE || null;
  if (seq) {
    for (const s of seq) { if (s.startsWith('js:')) await page.evaluate(s.slice(3)).catch(() => {}); else await page.locator(s).first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(150); }
  } else {
    for (const s of ["#board > *", ".board > *", "#grid > *", "[id$=board] > *", ".cell", "#board button"]) {
      const loc = page.locator(s);
      const c = await loc.count().catch(() => 0);
      for (let i = 0; i < Math.min(c, 150); i++) {
        await loc.nth(i).click({ timeout: 400, force: true }).catch(() => {});
        await page.waitForTimeout(90);
        if ((await page.evaluate(() => location.search)) !== before) return true;
      }
    }
  }
  return (await page.evaluate(() => location.search)) !== before;
}
const ab = (report.abuse = { variants: {} });
{
  const page = await openGame("android360");
  ab.firstMove = await tapMove(page);
  const link = await page.evaluate(() => location.search);
  ab.link = link;
  ab.linkLen = link.length;
  if (!ab.firstMove) note("could not find a first move by tapping; pass --move");
  else {
    ab.wire = await page.evaluate((l) => { try { return AsyncShare.decode(new URLSearchParams(l).get("s")); } catch (e) { return null; } }, link);
    // double-tap / spam on the SAME device after the move: the board must stay locked
    await page.evaluate(() => { window.__before = location.search; });
    const loc = page.locator("#board > *, .board > *, #grid > *, [id$=board] > *");
    const c = await loc.count();
    for (let i = 0; i < Math.min(c, 60); i++) await loc.nth(i).click({ timeout: 300, force: true, clickCount: 2 }).catch(() => {});
    ab.spamChangedUrlAfterMove = await page.evaluate(() => location.search !== window.__before);
    ab.spamErrors = page.errs.slice();
    // refresh mid-game keeps the state
    await page.reload(); await dismiss(page);
    ab.afterReload = await page.evaluate(() => ({ url: location.search === "" ? "(cleared)" : "kept", panel: (document.getElementById("wa-ui") || {}).innerText || "" }));
    // back button
    await page.goBack().catch(() => {}); await page.waitForTimeout(300);
    ab.afterBack = await page.evaluate(() => location.pathname + location.search.slice(0, 12));
    await page.context().close();
    step('first move + spam done');
    // tampered variants, each in a clean browser (empty "seen" store)
    const mut = (w, f) => { const c = JSON.parse(JSON.stringify(w)); f(c); return c; };
    const W = ab.wire && Object.fromEntries(Object.entries({ g: "game", v: "version", i: "id", t: "turn", b: "board", s: "status", w: "winner", n: "moveCount", l: "last", r: "resigned" }).map(([k, f]) => [k, ab.wire[f]]));
    const variants = {
      "truncated-half": () => link.slice(0, 3 + Math.floor((link.length - 3) / 2)),
      "truncated-last-char": () => link.slice(0, -1),
      "garbage": () => "?s=zzzzzzzz",
      "empty-param": () => "?s=",
      "huge-5000": () => "?s=" + "A".repeat(5000),
      "binary": () => "?s=%00%FF%FE",
    };
    if (W) {
      Object.assign(variants, {
        "board-null": mut(W, (c) => (c.b = null)),
        "board-string": mut(W, (c) => (c.b = "xxxxxxxxx")),
        "board-empty-array": mut(W, (c) => (c.b = [])),
        "board-numbers": mut(W, (c) => (c.b = JSON.parse(JSON.stringify(c.b, (k, v) => (typeof v === "string" || typeof v === "number" ? 9 : v))))),
        "board-reversed": mut(W, (c) => { if (Array.isArray(c.b)) c.b = c.b.slice().reverse(); }),
        "board-10000": mut(W, (c) => (c.b = new Array(10000).fill(1))),
        "turn-bogus": mut(W, (c) => (c.t = "Z")),
        "turn-flipped": mut(W, (c) => { c.t = c.t === ab.wire.turn ? ({ X: "O", O: "X", red: "yellow", yellow: "red", w: "b", b: "w", white: "black", black: "white" }[c.t] || c.t) : c.t; }),
        "moveCount-0": mut(W, (c) => (c.n = 0)),
        "moveCount-neg": mut(W, (c) => (c.n = -5)),
        "moveCount-huge": mut(W, (c) => (c.n = 1e9)),
        "moveCount-string": mut(W, (c) => (c.n = "7")),
        "won-no-winner": mut(W, (c) => { c.s = "w"; c.w = null; }),
        "winner-while-playing": mut(W, (c) => { c.s = "p"; c.w = c.t; }),
        "status-bogus": mut(W, (c) => (c.s = "x")),
        "wrong-game": mut(W, (c) => (c.g = "chess2")),
        "wrong-version": mut(W, (c) => (c.v = 999)),
        "id-bad": mut(W, (c) => (c.i = "<img src=x onerror=alert(1)>")),
        "last-html": mut(W, (c) => (c.l = "<img src=x onerror=window.__xss=1>")),
        "extra-keys": mut(W, (c) => { c.zz = 1; c.__proto__ = { a: 1 }; }),
        "resigned-in-progress": mut(W, (c) => (c.r = true)),
      });
    }
    // encode in the browser with the page's own library
    const helper = await openGame("android360");
    for (const [name, v] of Object.entries(variants)) {
      const q = typeof v === "function" ? v() : "?s=" + (await helper.evaluate((w) => LZString.compressToEncodedURIComponent(JSON.stringify(w)).replace(/\+/g, "_"), v));
      const p = await openGame("android360", q);
      const r = await p.evaluate(() => ({ panel: ((document.getElementById("wa-ui") || {}).innerText || "").replace(/\s+/g, " ").slice(0, 110), status: ((document.getElementById("status") || {}).innerText || "").slice(0, 40), blank: document.body.innerText.trim().length < 20, xss: !!window.__xss, urlKept: location.search.length > 3 }));
      ab.variants[name] = { ...r, errors: p.errs };
      await p.context().close();
    }
    await helper.context().close();

    step('variants done');
    // replay: phone A moves (L1), phone B opens L1 and answers (L2), A opens L2 and answers (L3). Then old links.
    const A = await openGame("android360");
    await tapMove(A); const L1 = await A.evaluate(() => location.search);
    const B = await openGame("android360", L1, undefined);
    ab.replay = {};
    // B is a different "device": give it its own context, it already is. B moves.
    const moved = await tapMove(B); const L2 = await B.evaluate(() => location.search);
    ab.replay.bMoved = moved && L2 !== L1;
    if (ab.replay.bMoved) {
      await A.goto(url + L2); await dismiss(A);
      ab.replay.aSeesL2 = await A.evaluate(() => (document.getElementById("wa-ui") || {}).innerText);
      const movedA = await tapMove(A); const L3 = await A.evaluate(() => location.search);
      ab.replay.aMoved = movedA && L3 !== L2;
      await A.goto(url + L1); await dismiss(A);
      ab.replay.aReopensL1 = (await A.evaluate(() => (document.getElementById("wa-ui") || {}).innerText)).replace(/\s+/g, " ").slice(0, 120);
      ab.replay.aReopensL1CanMove = await tapMove(A);
      await B.goto(url + L1); await dismiss(B);
      ab.replay.bReopensL1 = (await B.evaluate(() => (document.getElementById("wa-ui") || {}).innerText)).replace(/\s+/g, " ").slice(0, 120);
      ab.replay.bReopensL1CanMove = await tapMove(B);
      // same link twice, in two tabs of one fresh browser
      const t1 = await openGame("android360", L1);
      const t2 = await t1.context().newPage(); await t2.goto(url + L1); await dismiss(t2);
      const m1 = await tapMove(t1); const m2 = await tapMove(t2);
      ab.replay.sameLinkTwoTabsBothMoved = m1 && m2;
      await t1.context().close();
    }
    await A.context().close(); await B.context().close();
  }
}

step('replay done');
// 4. reduced motion: after the first move, how many animations still run, and what are the board transition times
{
  const page = await openGame("android360", "", { reducedMotion: "reduce" });
  await tapMove(page);
  report.reducedMotion = await page.evaluate(() => {
    const anim = document.getAnimations().filter((a) => a.playState === "running" && a.effect && a.effect.getComputedTiming().duration > 50);
    return { runningAnimations: anim.length, names: anim.slice(0, 5).map((a) => a.animationName || a.transitionProperty || "?") };
  });
  await page.context().close();
  const p2 = await openGame("android360");
  const t0 = Date.now();
  await tapMove(p2);
  report.moveAnim = await p2.evaluate(() => { const a = document.getAnimations(); return { count: a.length, maxEndMs: Math.round(Math.max(0, ...a.map((x) => x.effect ? x.effect.getComputedTiming().endTime : 0))) }; });
  await p2.context().close();
}

// 5. OG tags in the page and the image they point at
{
  const html = fs.readFileSync(path.join(ROOT, game, "index.html"), "utf8");
  const og = (p) => (html.match(new RegExp(`property="og:${p}" content="([^"]*)"`)) || [])[1];
  const img = og("image") || "";
  const local = img.replace(/^https:\/\/wa-minigames\.online\//, "");
  report.og = { title: og("title"), description: og("description"), image: img, imageExists: fs.existsSync(path.join(ROOT, local)) };
}

for (const b of Object.values(browsers)) await b.close();
srv.close();
// compact: the abuse variants collapse to rejected / accepted / crashed
const v = report.abuse.variants || {};
report.abuse.rejected = Object.keys(v).filter((k) => /invalid|old link/i.test(v[k].panel + v[k].status));
report.abuse.accepted = Object.keys(v).filter((k) => !report.abuse.rejected.includes(k));
report.abuse.crashed = Object.keys(v).filter((k) => v[k].errors.length || v[k].blank || v[k].xss);
delete report.abuse.variants; delete report.abuse.wire;
for (const p of Object.values(report.profiles)) { if (p.portrait) for (const o of [p.portrait, p.landscape]) { if (o.smallTargets) o.smallTargets = o.smallTargets.map((x) => x.el + ' ' + x.w + 'x' + x.h); } }
report.load.http404s = report.load.http404s.filter((x) => !x.includes(" api/"));
console.log(JSON.stringify(report));
