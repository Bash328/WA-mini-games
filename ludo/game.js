(function () {
  "use strict";

  const L = globalThis.Ludo;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), playersSel = $("players"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), root = $("ld"), boardEl = $("ld-board"), cellsEl = $("ld-cells"), tokensEl = $("ld-tokens");
  const playersEl = $("ld-players"), dieEl = $("ld-die"), rollBtn = $("ld-roll"), noteEl = $("ld-note"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("ludo:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;
  playersSel.value = store.get("players", "4");
  if (!["2", "3", "4"].includes(playersSel.value)) playersSel.value = "4";

  // M = { kind: "local" | "online", phase, table: engine view | null, ... } (see multiseat.js)
  let M = null;
  let Lc = null;                                  // the game against the computer: { st, cfg, events, timer }
  let tokenEls = [];                              // [seat][token] buttons, kept so a move glides
  let tokenRel = [];                              // [seat][token] last board index, for step-by-step moves
  let lastDie = null, faceShown = null, dieTimer = null, rollTimer = null, busy = false, statusKey = "";

  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const colorOf = (yard) => ({ red: "#e0524c", yellow: "#f2c14e", blue: "#4a86e8", green: "#2fb44a" })[L.YARDS[yard].key];
  const seatName = (i) => (M && M.table && M.table.seats[i] ? M.table.seats[i].name : "Player " + (i + 1));
  const nameOf = (i) => (M && M.table && i === M.table.you ? "You" : seatName(i));

  // ---------- the board, built once ----------
  const CELL_AT = new Map();
  L.CELLS.forEach(([r, c], i) => CELL_AT.set(r + "," + c, i));
  const HOME_AT = new Map();
  L.YARDS.forEach((y, yard) => y.home.forEach(([r, c]) => HOME_AT.set(r + "," + c, yard)));
  const YARD_ORIGIN = { red: [9, 0], yellow: [0, 0], blue: [0, 9], green: [9, 9] };

  function buildBoard() {
    const frag = document.createDocumentFragment();
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const d = el("div", "ld-cell"), k = r + "," + c;
        if (CELL_AT.has(k)) {
          const idx = CELL_AT.get(k);
          d.classList.add("track");
          const entry = L.YARDS.findIndex((y) => y.entry === idx);
          if (entry >= 0) d.classList.add("entry-" + L.YARDS[entry].key);
          else {
            const safe = L.safeOwner(idx);
            if (safe) d.classList.add("safe");
          }
          d.dataset.cell = idx;
        } else if (HOME_AT.has(k)) d.classList.add("home-" + L.YARDS[HOME_AT.get(k)].key);
        frag.append(d);
      }
    }
    cellsEl.append(frag);

    // the four yards and the home in the middle sit over the grid
    L.YARDS.forEach((y, yardIndex) => {
      const origin = YARD_ORIGIN[y.key];
      const box = el("div", "ld-yard yard-" + y.key);
      box.style.left = (origin[1] / 15) * 100 + "%";
      box.style.top = (origin[0] / 15) * 100 + "%";
      box.append(el("div", "ld-yard-in"));
      y.spots.forEach((_, k) => {
        const spot = el("div", "ld-spot"), at = yardSpot(yardIndex, k);
        spot.style.left = ((at.x - origin[1]) / 6) * 100 + "%";
        spot.style.top = ((at.y - origin[0]) / 6) * 100 + "%";
        box.append(spot);
      });
      boardEl.insertBefore(box, tokensEl);
    });
    boardEl.insertBefore(el("div", "ld-home"), tokensEl);
  }

  function ensureTokens(n) {
    if (tokenEls.length === n) return;
    tokensEl.innerHTML = "";
    tokenEls = [];
    tokenRel = [];
    for (let seat = 0; seat < n; seat++) {
      const row = [];
      for (let i = 0; i < 4; i++) {
        const b = el("button", "ld-token");
        b.type = "button"; b.dataset.seat = seat; b.dataset.token = i;
        b.addEventListener("click", () => onToken(seat, i));
        tokensEl.append(b);
        row.push(b);
      }
      tokenEls.push(row);
      tokenRel.push([null, null, null, null]);
    }
  }

  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieSvg(n) {
    let pips = "";
    (PIPS[n] || []).forEach((k) => { pips += '<circle cx="' + (26 + (k % 3) * 24) + '" cy="' + (26 + Math.floor(k / 3) * 24) + '" r="7.5"/>'; });
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><rect x="4" y="4" width="92" height="92" rx="18" fill="#fff" stroke="#d8d0bf" stroke-width="3"/>' + pips + "</svg>";
  }

  // The four yard slots sit close to the middle of the yard, as in the reference (half the cell spacing of the rules).
  const SPOT_PULL = 0.5;
  function yardSpot(yard, i) {
    const o = YARD_ORIGIN[L.YARDS[yard].key], [r, c] = L.YARDS[yard].spots[i];
    return { x: o[1] + 3 + (c + 0.5 - o[1] - 3) * SPOT_PULL, y: o[0] + 3 + (r + 0.5 - o[0] - 3) * SPOT_PULL };
  }

  // ---------- a token's place on the board ----------
  function basePos(yard, rel, i) {
    const y = L.YARDS[yard];
    if (rel === -1) return yardSpot(yard, i);
    if (rel <= 50) { const [r, c] = L.CELLS[(y.entry + rel) % 52]; return { x: c + 0.5, y: r + 0.5 }; }
    if (rel <= 55) { const [r, c] = y.home[rel - 51]; return { x: c + 0.5, y: r + 0.5 }; }
    return ({ red: { x: 7.5, y: 8.35 }, yellow: { x: 6.65, y: 7.5 }, blue: { x: 7.5, y: 6.65 }, green: { x: 8.35, y: 7.5 } })[y.key];
  }

  function tokenPercent(p, dx, dy) {
    return {
      left: ((p.x + dx) / 15) * 100 + "%",
      top: ((p.y + dy) / 15) * 100 + "%",
    };
  }

  function moveFrames(yard, i, from, to) {
    const frames = [];
    if (from === to) return frames;
    if (to < from) {
      const p = basePos(yard, to, i);
      frames.push(tokenPercent(p, 0, 0));
      return frames;
    }
    for (let rel = from + 1; rel <= to; rel++) {
      const p = basePos(yard, rel, i);
      frames.push(tokenPercent(p, 0, 0));
    }
    return frames;
  }

  // A one-square move glides; a longer move visits every square in turn.
  function animateToken(b, yard, i, from, to, end) {
    const frames = moveFrames(yard, i, from, to);
    if (!frames.length) {
      b.style.left = end.left; b.style.top = end.top; b.style.zIndex = end.z;
      return;
    }
    if (b.__moveAnim) b.__moveAnim.cancel();
    b.style.transition = "none";
    b.style.zIndex = "9";
    const steps = to > from ? to - from : 1;
    const motion = b.animate(frames, {
      duration: steps === 1 ? 210 : Math.min(760, steps * 95),
      easing: steps === 1 ? "ease-out" : "linear",
      fill: "none",
    });
    b.__moveAnim = motion;
    const settle = () => {
      if (b.__moveAnim !== motion) return;
      b.__moveAnim = null;
      b.style.left = end.left; b.style.top = end.top; b.style.zIndex = end.z;
      b.style.transition = "";
    };
    motion.addEventListener("finish", settle);
    motion.addEventListener("cancel", settle);
  }

  function renderTokens() {
    const t = M.table;
    ensureTokens(t.seats.length);
    if (!t.moves) {
      tokenRel.forEach((row) => row.fill(null));
    }
    const groups = new Map();
    t.seats.forEach((s, seat) => {
      s.tokens.forEach((rel, i) => {
        const p = basePos(s.yard, rel, i);
        const k = p.x.toFixed(2) + "," + p.y.toFixed(2);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ seat, i, p, rel });
      });
    });
    groups.forEach((list) => {
      const n = list.length, rows = Math.ceil(n / 2);
      list.forEach((o, k) => {
        let dx = 0, dy = 0;
        if (n > 1) {
          dx = ((k % 2) - 0.5) * 0.22;
          dy = (Math.floor(k / 2) - (rows - 1) / 2) * 0.22;
        }
        const s = t.seats[o.seat], yard = L.YARDS[s.yard].key;
        const b = tokenEls[o.seat][o.i];
        const end = tokenPercent(o.p, dx, dy);
        const prev = tokenRel[o.seat] ? tokenRel[o.seat][o.i] : null;
        b.style.zIndex = String(2 + k);
        b.className = "ld-token tok-" + yard + (o.rel === 56 ? " done" : "");
        const movable = t.phase === "play" && t.turn === t.you && o.seat === t.you && (t.options.moves || []).includes(o.i);
        if (movable) b.classList.add("movable");
        const where = o.rel === -1 ? "in the yard" : o.rel === 56 ? "home" : "on the board";
        b.setAttribute("aria-label", s.name + " token " + (o.i + 1) + ", " + where + (movable ? ", can move" : ""));
        b.title = s.name + " token " + (o.i + 1);
        if (prev !== null && prev !== o.rel) {
          animateToken(b, s.yard, o.i, prev, o.rel, { left: end.left, top: end.top, z: String(2 + k) });
        } else if (!b.__moveAnim) {
          b.style.left = end.left; b.style.top = end.top;
        }
      });
    });
    t.seats.forEach((s, seat) => s.tokens.forEach((rel, i) => { if (tokenRel[seat]) tokenRel[seat][i] = rel; }));
  }

  // ---------- the screen ----------
  function idleLeft() {
    if (!M || M.kind !== "online" || !M.table || !M.turnSince) return null;
    const p = M.players && M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - ms.nowMs()) / 1000));
  }

  function renderPlayers() {
    const t = M.table;
    playersEl.innerHTML = "";
    t.seats.forEach((s, i) => {
      const p = el("div", "ld-player" + (i === t.you ? " you" : "") + (t.phase === "play" && t.turn === i ? " now" : "") + (t.phase === "game_over" && t.winner === i ? " win" : ""));
      p.style.setProperty("--pc", colorOf(s.yard));
      p.append(el("span", "dot"), el("span", "nm", i === t.you ? "You" : s.name), el("span", "hm", s.done + "/4"));
      const who = M.players && M.players.find((x) => x.seat === i);
      if (who && !s.bot && !who.online && !who.autoBot) p.title = s.name + " is offline";
      playersEl.append(p);
    });
    const you = t.seats[t.you] || t.seats[0];
    const bot = t.seats.find((_, i) => i !== t.you) || you;
    const youEl = document.getElementById("ld-you"), botEl = document.getElementById("ld-bot"), tabEl = document.getElementById("ld-tab");
    if (youEl) youEl.textContent = String(you ? you.done : 0);
    if (botEl) botEl.textContent = String(bot ? bot.done : 0);
    if (tabEl) tabEl.textContent = diff.toUpperCase();
  }

  function renderDie() {
    if (M.table.moves === 0 && !M.table.die) faceShown = null;   // a fresh race starts with an empty die
    let face = M.table.die;
    if (!face && faceShown) face = faceShown;      // keep the last roll up until the next one
    if (!face) {
      dieEl.innerHTML = '<span class="ld-q">?</span>';
      dieEl.setAttribute("aria-label", "Die");
      lastDie = null;
      return;
    }
    faceShown = face;
    dieEl.innerHTML = dieSvg(face);
    dieEl.setAttribute("aria-label", "Die showing " + face);
    if (face !== lastDie && !reduceMotion) {
      dieEl.classList.remove("rolling");
      void dieEl.offsetWidth;
      dieEl.classList.add("rolling");
      clearTimeout(dieTimer);
      dieTimer = setTimeout(() => dieEl.classList.remove("rolling"), 480);
    }
    lastDie = face;
  }

  function renderRoll() {
    const t = M.table;
    const mine = t.phase === "play" && t.turn === t.you;
    const can = mine && t.options.roll && !busy;
    rollBtn.disabled = !can;
    rollBtn.textContent = t.phase === "game_over" ? "GAME OVER" : busy ? "ROLLING" : can ? "ROLL" : mine && t.rolled ? "TAP A TOKEN" : "WAITING";
  }

  function renderStatus() {
    const t = M.table;
    if (t.phase === "game_over") {
      const key = "over:" + t.winner + ":" + t.you;
      if (key !== statusKey) {
        statusKey = key;
        statusEl.textContent = t.winner === t.you ? "You win! " + Gamekit.taunt("win") : seatName(t.winner) + " wins. " + Gamekit.taunt("loss");
      }
      return;
    }
    statusKey = "";
    if (t.turn === t.you) {
      statusEl.textContent = t.rolled ? (t.options.moves || []).length ? "Your move: tap a highlighted token." : "No move with that roll." : "Your roll.";
      return;
    }
    let text = "Waiting for " + seatName(t.turn) + ".";
    const p = M.players && M.players.find((x) => x.seat === t.turn);
    if (p && p.autoBot && !p.online) text += " A bot is playing.";
    else {
      const left = idleLeft();
      if (left !== null) text += " (" + left + "s)";
    }
    statusEl.textContent = text;
  }

  function renderNote() {
    const events = M.lastEvents || [];
    const pick = (type) => { let found = null; events.forEach((e) => { if (e.e === type) found = e; }); return found; };
    const win = pick("win"), cap = pick("capture"), home = pick("home"), four = pick("forfeit"), stuck = pick("stuck"), move = pick("move"), roll = pick("roll");
    let text = "";
    if (win) text = win.seat === M.table.you ? "You win!" : nameOf(win.seat) + " wins!";
    else if (cap) text = nameOf(cap.seat) + " sent " + (cap.victim === M.table.you ? "you" : nameOf(cap.victim)) + " home.";
    else if (home) text = nameOf(home.seat) + " brought a token home.";
    else if (four) text = nameOf(four.seat) + " rolled three 6s and lost the turn.";
    else if (stuck) text = nameOf(stuck.seat) + " couldn't move.";
    else if (move) text = nameOf(move.seat) + " moved " + move.die + ".";
    else if (roll) text = nameOf(roll.seat) + " rolled " + roll.die + ".";
    else if (M.table.phase === "play" && M.table.die) text = "Rolled " + M.table.die + ".";
    else if (M.table.phase === "play") text = "Roll a 6 to leave the yard.";
    noteEl.textContent = text;
  }

  function renderAll() {
    if (!M || !M.table || M.phase === "landing" || M.phase === "lobby" || M.phase === "closed") {
      root.classList.remove("on");
      statusEl.textContent = "";
      return;
    }
    root.classList.add("on");
    renderPlayers(); renderTokens(); renderDie(); renderRoll(); renderStatus(); renderNote();
  }

  // ---------- playing ----------
  function onRoll() {
    const t = M && M.table;
    if (!t || busy || t.phase !== "play" || t.turn !== t.you || !t.options.roll) return;
    send({ t: "roll" });
  }
  function onToken(seat, i) {
    const t = M && M.table;
    if (!t || busy || t.phase !== "play") return;
    if (seat !== t.you) return;
    if (t.turn !== t.you) { noteEl.textContent = "It's not your turn yet."; return; }
    if (!(t.options.moves || []).includes(i)) { noteEl.textContent = "That token can't move with a " + (t.die || "roll") + "."; return; }
    send({ t: "move", token: i });
  }
  function send(action) {
    if (!M) return;
    if (M.kind === "local") return localAct(action);
    ms.send(action);
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  function localModel() {
    const st = Lc.st;
    const table = L.view(st, 0);
    table.you = 0;
    return { kind: "local", phase: st.phase, table, players: null, you: { seat: 0, host: true }, lastEvents: Lc.events, config: Lc.cfg };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    clearTimeout(rollTimer);
    const n = Math.max(2, Math.min(4, Number(playersSel.value) || 4));
    const names = ["You"], bots = [null];
    for (let i = 1; i < n; i++) { names.push("Bot " + i); bots.push(diff); }
    Lc = { st: L.create({ names, bots }, Math.random), cfg: { players: n, level: diff }, events: [], timer: null };
    busy = false; lastDie = null; faceShown = null;
    localRender(); localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
  }
  function localAct(action) {
    const res = L.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { noteEl.textContent = "That can't be done right now."; return; }
    Lc.events = res.events;
    if (action.t === "roll" && !reduceMotion) {
      busy = true; localRender();
      clearTimeout(rollTimer);
      rollTimer = setTimeout(() => { busy = false; localRender(); localSchedule(); }, 500);
    } else {
      localRender(); localSchedule();
    }
  }
  function localSchedule() {
    clearTimeout(Lc.timer);
    const st = Lc.st;
    if (st.phase !== "play" || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      const seat = st.turn;
      let res = L.act(st, seat, L.botAct(st, seat, st.seats[seat].bot, Math.random), Math.random);
      if (!res.ok) res = L.act(st, seat, L.fallback(st, seat), Math.random);
      if (res.ok) Lc.events = res.events;
      localRender(); localSchedule();
    }, 900 + Math.random() * 400);
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own board
     ============================================================ */
  const ms = MultiSeat.create({
    game: "ludo", title: "Ludo", roomEl, tauntsEl, store,
    onModel: (m) => { M = m; renderAll(); },
    onTick: () => { if (M && M.table && M.kind === "online" && M.phase === "playing") { renderPlayers(); renderStatus(); } },
  });

  /* ---------- modes and controls ---------- */
  function applyMode() {
    const local = mode === "computer";
    chipsEl.hidden = !local;
    playersSel.hidden = !local;
    resetBtn.hidden = !local;
    if (local) {
      if (ms.active()) ms.stop();
      localStart();
    } else {
      clearTimeout(Lc && Lc.timer);
      clearTimeout(rollTimer);
      Lc = null; M = null; busy = false; lastDie = null; faceShown = null;
      root.classList.remove("on");
      const c = (params.get("live") || "").toUpperCase();
      if (invited && /^[A-HJ-NP-Z2-9]{6}$/.test(c) && !ms.active()) ms.enter(c);
      else if (!ms.active()) ms.landing();
      else renderAll();
    }
  }
  const chips = Gamekit.wireDifficultyChips({
    el: chipsEl, difficulties: ["easy", "medium", "hard"], initial: diff, storage: store, storageKey: "diff",
    onChange: (d) => { diff = d; if (mode === "computer") localStart(); },
  });
  diff = chips.get();
  modeSel.addEventListener("change", () => { mode = modeSel.value; if (mode !== "live") store.set("mode", mode); applyMode(); });
  playersSel.addEventListener("change", () => { store.set("players", playersSel.value); if (mode === "computer") localStart(); });
  resetBtn.addEventListener("click", () => { if (mode === "computer") localStart(); });
  rollBtn.addEventListener("click", onRoll);

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "ludo", invited);
  buildBoard();
  applyMode();

  // A refresh keeps a game against the computer.
  const resumer = Gamekit.resume("ludo", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s.st;
    if (!st || st.v !== 1 || st.game !== "ludo" || st.phase !== "play") return false;
    if (!Array.isArray(st.seats) || st.seats.length < 2 || st.seats.length > 4) return false;
    if (!st.seats.every((x) => Number.isInteger(x.yard) && x.yard >= 0 && x.yard < 4 && Array.isArray(x.tokens) && x.tokens.length === 4 && x.tokens.every((r) => Number.isInteger(r) && r >= -1 && r <= 56))) return false;
    if (!Number.isInteger(st.turn) || st.turn < 0 || st.turn >= st.seats.length) return false;
    if (!(st.die === null || (Number.isInteger(st.die) && st.die >= 1 && st.die <= 6))) return false;
    if (typeof st.rolled !== "boolean" || !Number.isInteger(st.sixes) || !Number.isInteger(st.moves)) return false;
    mode = "computer"; modeSel.value = "computer"; chipsEl.hidden = false; playersSel.hidden = false; resetBtn.hidden = false;
    playersSel.value = String(st.seats.length);
    const lv = s.cfg && s.cfg.level;
    if (["easy", "medium", "hard"].includes(lv)) chips.show(lv);
    if (ms.active()) ms.stop();
    Lc = { st, cfg: s.cfg || { players: st.seats.length, level: diff }, events: [], timer: null };
    busy = false; lastDie = null; faceShown = null;
    localRender(); localSchedule();
    return true;
  });
  if (!invited && mode === "computer") resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("ludo"));
})();
