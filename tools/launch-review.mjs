// Launch review for one game page: load speed (CPU slowed 4x like a mid phone), back-button speed, console errors,
// sideways overflow at phone/desktop widths, and a burst of random taps in every mode the page offers.
// Usage: node tools/launch-review.mjs hangman        (needs: npm i --no-save playwright)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const game = process.argv[2];
if (!game) { console.error("usage: node tools/launch-review.mjs <game-folder>"); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
});
await new Promise((r) => srv.listen(0, r));
const base = `http://localhost:${srv.address().port}/`;
const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const out = [];
const note = (ok, what) => { out.push((ok ? "ok    " : "FAIL  ") + what); };

async function page(w, h, { slow = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 });
  const p = await ctx.newPage();
  p.errs = [];
  p.on("pageerror", (e) => p.errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|WebSocket connection/.test(m.text())) p.errs.push(m.text().slice(0, 140)); });
  await p.route("**/api/live/status", (r) => r.fulfill({ json: { enabled: true, games: [game] } }));
  if (slow) { const c = await ctx.newCDPSession(p); await c.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  return p;
}

// 1. load speed, slowed CPU
{
  const times = [];
  for (let i = 0; i < 3; i++) {
    const p = await page(390, 844, { slow: true });
    const t0 = Date.now();
    await p.goto(base + game + "/", { waitUntil: "load" });
    await p.waitForSelector("body.fun, body");
    const paint = await p.evaluate(() => (performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint") || {}).startTime || 0);
    times.push({ load: Date.now() - t0, fcp: Math.round(paint) });
    await p.context().close();
  }
  const best = times.reduce((a, b) => (b.load < a.load ? b : a));
  note(best.load < 2500 && best.fcp < 1800, `load at 4x slower CPU: ${best.load} ms (first paint ${best.fcp} ms)`);
}

// 2. back button: time from tap to the hub being usable
{
  const p = await page(390, 844);
  await p.goto(base + game + "/", { waitUntil: "load" });
  await p.waitForTimeout(500);
  await p.keyboard.press("Escape");                 // the first-visit how-to covers the page
  await p.evaluate(() => document.querySelectorAll(".man-backdrop").forEach((n) => n.remove()));
  const back = p.locator(".topbar .back, a.back").first();
  if (await back.count()) {
    const t0 = Date.now();
    await Promise.all([p.waitForURL((u) => !u.pathname.includes("/" + game + "/"), { timeout: 8000 }), back.click()]);
    await p.waitForSelector(".card");
    const ms = Date.now() - t0;
    note(ms < 1200, `back button to the hub: ${ms} ms`);
  } else note(false, "no back button found");
  await p.context().close();
}

// 3. every mode: errors, overflow, random taps
{
  const p0 = await page(390, 844);
  await p0.goto(base + game + "/", { waitUntil: "load" });
  const modes = await p0.evaluate(() => { const s = document.getElementById("mode"); return s ? [...s.options].map((o) => o.value) : [""]; });
  await p0.context().close();
  for (const mode of modes) {
    for (const [w, h] of [[320, 640], [390, 844], [430, 932], [1280, 800]]) {
      const p = await page(w, h);
      await p.goto(base + game + "/" + (mode === "live" ? "?live=ABCDEF" : ""), { waitUntil: "load" });
      await p.waitForTimeout(500);
      if (mode) await p.evaluate((m) => { const s = document.getElementById("mode"); if (s && s.value !== m) { s.value = m; s.dispatchEvent(new Event("change", { bubbles: true })); } }, mode);
      await p.waitForTimeout(400);
      await p.keyboard.press("Escape");
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      note(over <= 1, `${mode || "page"} @${w}px: no sideways scroll (${over}px)`);
      if (w === 390) {
        // 80 random taps on whatever is on screen; nothing may throw
        for (let i = 0; i < 80; i++) {
          const x = 10 + Math.random() * (w - 20), y = 60 + Math.random() * (h - 80);
          await p.mouse.click(x, y).catch(() => {});
          if (i % 9 === 0) await p.keyboard.press("abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).catch(() => {});
        }
        await p.waitForTimeout(300);
        await p.screenshot({ path: path.join(process.env.REVIEW_SHOTS || ".", `review-${game}-${mode || "page"}.png`) }).catch(() => {});
      }
      note(p.errs.length === 0, `${mode || "page"} @${w}px: no console errors${p.errs.length ? " (" + p.errs[0] + ")" : ""}`);
      await p.context().close();
    }
  }
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(failed ? `\n${failed} problem(s)` : "\nall good");
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
