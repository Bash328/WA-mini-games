(function () {
  "use strict";

  const F = globalThis.Farkle;
  const $ = (id) => document.getElementById(id);
  const statusEl = $("status"), modeSel = $("mode"), playersSel = $("players"), chipsEl = $("chips"), resetBtn = $("reset-btn");
  const roomEl = $("ms-room"), boardEl = $("board"), scoresEl = $("fk-scores"), diceEl = $("fk-dice");
  const turnScoreEl = $("fk-turnscore"), msgEl = $("fk-msg"), primaryBtn = $("fk-primary"), bankBtn = $("fk-bank");
  const hintEl = $("fk-hint"), tauntsEl = $("ms-taunts");
  const store = Gamekit.storage("farkle:");

  let diff = store.get("diff", "medium");
  if (!["easy", "medium", "hard"].includes(diff)) diff = "medium";
  let mode = store.get("mode", "computer");
  const params = new URLSearchParams(location.search);
  const invited = params.has("live");
  if (invited) mode = "live";
  if (mode !== "computer" && mode !== "live") mode = "computer";
  modeSel.value = mode;
  const savedPlayers = Number(store.get("players", "2"));
  playersSel.value = String(savedPlayers >= 2 && savedPlayers <= 4 ? savedPlayers : 2);

  // M = { kind: "local" | "online", phase, table: engine view | null, ... } (see multiseat.js)
  let M = null;
  let Lc = null;                               // the local (vs computer) game
  const sel = new Set();                       // dice tapped for keeping: indices into table.dice
  let overFor = null, overText = "";           // the game-over line, so repeated renders do not re-roll the taunt
  let rolledKey = null;                        // the last throw that was rolled onto the table

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const shortName = (name) => String(name || "").replace(/^Computer (\d+)$/, "Bot $1");
  const PIPS = Gamekit.PIPS;             // the shared pip layout

  function dieFace(v) {
    const d = el("span", "fk-die" + (v === 1 ? " one" : ""));
    const on = new Set(PIPS[v] || []);
    for (let i = 0; i < 9; i++) d.append(el("i", on.has(i) ? "on" : ""));
    return d;
  }
  // redraw a die element as face v (Gamekit.rollDice flicks the faces through this)
  function paintDie(d, v) { const f = dieFace(v); d.className = f.className; d.replaceChildren(...f.childNodes); }
  function nameOf(i) {
    const t = M && M.table;
    if (!t || !t.seats[i]) return "";
    return t.you === i ? "You" : shortName(t.seats[i].name);
  }
  function idleLeft() {
    if (!M || M.kind !== "online" || !M.table || M.phase !== "playing" || !M.turnSince) return null;
    const p = M.players && M.players.find((x) => x.seat === M.table.turn);
    if (!p || p.autoBot || !p.online) return null;
    return Math.max(0, Math.ceil((M.turnSince + M.idleMs - ms.nowMs()) / 1000));
  }
  function resultText(t) {
    if (overFor === t.winner && overText) return overText;
    overFor = t.winner;
    overText = t.winner === t.you
      ? "You win! " + Gamekit.taunt("win")
      : nameOf(t.winner) + " wins. " + Gamekit.taunt("loss");
    return overText;
  }

  /* ---------- the board ---------- */
  function renderScores() {
    const t = M.table;
    scoresEl.replaceChildren();
    scoresEl.style.setProperty("--seats", String(t.seats.length));
    t.seats.forEach((s, i) => {
      const box = el("div", "fk-seat" + (i === t.turn && M.phase === "playing" ? " on" : "") + (i === t.winner && M.phase === "game_over" ? " won" : ""));
      box.title = s.name;
      box.append(el("span", "fk-nm", nameOf(i)));
      box.append(el("span", "fk-sc", String(s.score)));
      const bar = el("span", "fk-bar");
      const fill = el("i");
      fill.style.width = Math.min(100, Math.max(0, (s.score / t.target) * 100)) + "%";
      bar.append(fill);
      box.append(bar);
      scoresEl.append(box);
    });
  }

  function selectedScore(t) {
    if (!sel.size) return 0;
    const vals = [];
    sel.forEach((i) => { if (t.dice[i]) vals.push(t.dice[i].v); });
    return vals.length === sel.size ? F.scoreSelection(vals) : 0;
  }

  function renderDice() {
    const t = M.table;
    const mine = M.phase === "playing" && t.turn === t.you;
    const keeping = mine && t.awaiting === "choose";
    if (!keeping) sel.clear();
    else for (const i of Array.from(sel)) if (!t.dice[i] || t.dice[i].kept) sel.delete(i);

    diceEl.replaceChildren();
    let slots = t.setAside.map((v) => ({ v, kind: "set" }));
    t.dice.forEach((d, i) => slots.push({ v: d.v, kind: d.kept ? "kept" : "live", i }));
    // a farkle empties the table: show the throw that busted until the next roll, so you see what was rolled
    if (!slots.length && M.phase === "playing" && t.last && t.last.t === "farkle") slots = t.last.dice.map((v) => ({ v, kind: "bust" }));
    const thrown = [];
    for (let k = 0; k < F.DICE; k++) {
      const s = slots[k];
      if (!s) { const e = el("span", "fk-slot empty"); e.setAttribute("aria-hidden", "true"); diceEl.append(e); continue; }
      const label = "Die showing " + s.v;
      if (s.kind === "live" && keeping) {
        const picked = sel.has(s.i);
        const b = el("button", "fk-slot" + (picked ? " sel" : ""));
        b.type = "button";
        b.setAttribute("aria-pressed", picked ? "true" : "false");
        b.setAttribute("aria-label", label + (picked ? ", selected" : ", tap to keep"));
        b.append(dieFace(s.v));
        b.addEventListener("click", () => {
          if (sel.has(s.i)) sel.delete(s.i); else sel.add(s.i);
          renderDice(); renderButtons(); renderHint();
        });
        diceEl.append(b);
        thrown.push({ el: b.firstElementChild, v: s.v });
      } else {
        // your own leftovers after a keep are dimmed: they are the dice the next Roll will take
        const loose = s.kind === "live" && t.turn === t.you && t.awaiting === "roll_or_bank";
        const d = el("div", "fk-slot " + (loose ? "loose" : s.kind));
        d.setAttribute("role", "img");
        const state = loose ? ", will be rolled" : s.kind === "kept" || s.kind === "set" ? ", kept" : s.kind === "bust" ? ", farkle" : "";
        d.setAttribute("aria-label", label + state);
        d.append(dieFace(s.v));
        diceEl.append(d);
        if (s.kind === "live" || s.kind === "bust") thrown.push({ el: d.firstElementChild, v: s.v });
      }
    }
    // a fresh throw is rolled onto the table once (a redraw of the same throw, or the same model sent again, is not)
    const roll = (M.lastEvents || []).find((e) => e.e === "roll");
    const key = roll ? t.moves + ":" + roll.seat + ":" + roll.dice.join("") : null;
    if (key && key !== rolledKey) { rolledKey = key; Gamekit.rollDice(thrown, paintDie); }
  }

  function renderMessage() {
    const t = M.table;
    msgEl.className = "fk-msg";
    msgEl.textContent = "";
    if (M.phase !== "playing" || !t.last) return;
    const last = t.last;
    const you = last.seat === t.you;
    const who = nameOf(last.seat) || "Someone";
    if (last.t === "farkle") {
      msgEl.textContent = "Farkle! " + (last.lost ? (you ? "You lose " + last.lost + "." : who + " loses " + last.lost + ".") : "No scoring dice.");
      msgEl.classList.add("bad");
    } else if (last.t === "hot") {
      msgEl.textContent = "Hot dice! " + (you ? "You roll" : who + " rolls") + " all six again.";
      msgEl.classList.add("good");
    } else if (last.t === "bank") {
      msgEl.textContent = who + (you ? " bank " : " banks ") + last.points + ".";
      msgEl.classList.add("good");
    } else if (last.t === "keep") {
      msgEl.textContent = "+" + last.points + " kept" + (last.total ? " · " + last.total + " this turn" : "") + ".";
    }
  }

  function renderButtons() {
    const t = M.table;
    const mine = M.phase === "playing" && t.turn === t.you;
    const keeping = mine && t.awaiting === "choose";
    const pts = keeping ? selectedScore(t) : 0;
    primaryBtn.textContent = keeping ? (pts ? "Keep " + pts : "Keep") : "Roll";
    primaryBtn.disabled = !(mine && (keeping ? pts > 0 : !!t.options.roll));
    bankBtn.disabled = !(mine && !!t.options.bank);
  }

  function renderHint() {
    hintEl.textContent = "";
    if (M.phase !== "playing" || M.table.turn !== M.table.you) return;
    const t = M.table;
    if (t.awaiting === "choose") {
      const pts = selectedScore(t);
      if (!sel.size) hintEl.textContent = "Tap the dice that score, then Keep.";
      else if (!pts) hintEl.textContent = "That set does not score all through.";
      else hintEl.textContent = "Keep " + pts + ", then roll the rest or bank.";
    } else if (t.awaiting === "roll_or_bank") {
      hintEl.textContent = "Bank " + t.turnScore + " or roll the " + t.remaining + " left.";
    } else hintEl.textContent = "Roll all six dice.";
  }

  function renderStatus() {
    if (!M) return;
    if (M.phase !== "game_over") { overFor = null; overText = ""; }
    const t = M.table;
    if (M.phase === "lobby") { statusEl.textContent = "Waiting for players"; return; }
    if (!t || M.phase === "landing" || M.phase === "closed") { statusEl.textContent = M.phase === "closed" ? "Room closed" : ""; return; }
    if (M.phase === "game_over") { statusEl.textContent = resultText(t); return; }
    if (t.turn === t.you) {
      statusEl.textContent = t.awaiting === "choose" ? "Keep the dice that score"
        : t.awaiting === "roll_or_bank" ? "Roll again or bank"
        : "Your turn: roll the dice";
      return;
    }
    const left = idleLeft();
    statusEl.textContent = "Waiting for " + nameOf(t.turn) + (left !== null ? " (" + left + "s)" : "");
  }

  function renderTable() {
    if (!M || !M.table || M.phase === "lobby" || M.phase === "landing" || M.phase === "closed") { boardEl.classList.remove("on"); return; }
    boardEl.classList.add("on");
    renderScores();
    renderDice();
    turnScoreEl.textContent = String(M.table.turnScore);
    renderMessage();
    renderButtons();
    renderHint();
  }

  function renderAll() {
    if (M && M.kind === "local") roomEl.hidden = true;
    renderTable();
    renderStatus();
  }

  /* ---------- what the player at the screen does ---------- */
  function onPrimary() {
    const t = M && M.table;
    if (!t || M.phase !== "playing" || t.turn !== t.you) return;
    if (t.awaiting === "choose") {
      const idx = Array.from(sel).sort((a, b) => a - b);
      if (!idx.length || !F.scoreSelection(idx.map((i) => t.dice[i].v))) return;
      send({ t: "keep", dice: idx });
    } else if (t.awaiting === "roll" || t.awaiting === "roll_or_bank") {
      send({ t: "roll" });
    }
  }
  function send(action) {
    if (!M) return;
    if (M.kind === "local") { localAct(action); return; }
    sel.clear();
    renderDice(); renderButtons();
    ms.send(action);
  }
  function localAct(action) {
    const res = F.act(Lc.st, 0, action, Math.random);
    if (!res.ok) { ms.toast("That can't be done right now."); return; }
    Lc.events = res.events;
    sel.clear();
    localRender();
    localSchedule();
  }

  /* ============================================================
     vs computer: the same engine, running in the page
     ============================================================ */
  function localModel() {
    const st = Lc.st;
    return {
      kind: "local", phase: st.phase === "game_over" ? "game_over" : "playing",
      table: F.view(st, 0), players: null, you: { seat: 0, host: true },
      lastEvents: Lc.events, config: Lc.cfg,
    };
  }
  function localStart() {
    clearTimeout(Lc && Lc.timer);
    const n = Math.max(2, Math.min(4, Number(playersSel.value) || 2));
    playersSel.value = String(n);
    const names = ["You"].concat(Array.from({ length: n - 1 }, (_, i) => "Bot " + (i + 1)));
    const bots = [null].concat(Array(n - 1).fill(diff));
    Lc = { st: F.create({ names, bots, starter: 0 }, Math.random), cfg: { players: n, level: diff }, events: [], timer: null };
    sel.clear(); overFor = null; overText = ""; rolledKey = null;
    localRender();
    localSchedule();
  }
  function localRender() {
    M = localModel();
    renderAll();
  }
  function localSchedule() {
    clearTimeout(Lc && Lc.timer);
    if (!Lc) return;
    const st = Lc.st;
    if (st.phase !== "play" || st.turn === 0) return;
    Lc.timer = setTimeout(() => {
      if (!Lc || Lc.st !== st || st.phase !== "play" || st.turn === 0) return;
      const seat = st.turn;
      let res = F.act(st, seat, F.botAct(st, seat, st.seats[seat].bot || diff, Math.random), Math.random);
      if (!res.ok) res = F.act(st, seat, F.fallback(st, seat), Math.random);
      if (res.ok) Lc.events = res.events;
      localRender();
      localSchedule();
    }, 800 + Math.random() * 500 + ((Lc.events || []).some((e) => e.e === "roll") ? 500 : 0));   // let a roll land before the bot acts on it
  }

  /* ============================================================
     Online rooms: the shared screens (multiseat.js), our own board
     ============================================================ */
  const ms = MultiSeat.create({
    game: "farkle", title: "Farkle", roomEl, tauntsEl, store,
    onModel: (m) => { M = m; sel.clear(); renderAll(); },
    onTick: () => { if (M && M.kind === "online" && M.phase === "playing") renderStatus(); },
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
      Lc = null;
      sel.clear();
      if (M && M.kind === "local") { M = null; boardEl.classList.remove("on"); }
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

  modeSel.addEventListener("change", () => {
    mode = modeSel.value;
    if (mode !== "live") store.set("mode", mode);
    applyMode();
  });
  playersSel.addEventListener("change", () => {
    store.set("players", playersSel.value);
    if (mode === "computer") localStart();
  });
  resetBtn.addEventListener("click", () => { if (mode === "computer") localStart(); });
  primaryBtn.addEventListener("click", onPrimary);
  bankBtn.addEventListener("click", () => send({ t: "bank" }));

  if (typeof LiveShare !== "undefined") LiveShare.enable(modeSel, "farkle", invited);
  applyMode();
  Gamekit.popFilled(diceEl);

  // A refresh keeps a game against the computer.
  const resumer = Gamekit.resume("farkle", () => (mode !== "computer" || !Lc || Lc.st.phase === "game_over" || Lc.st.moves === 0) ? null : { st: Lc.st, cfg: Lc.cfg }, (s) => {
    const st = s && s.st;
    if (!st || st.v !== 1 || st.game !== "farkle" || st.phase !== "play" || st.target !== F.TARGET) return false;
    if (!Array.isArray(st.seats) || st.seats.length < 2 || st.seats.length > 4) return false;
    if (!st.seats.every((x) => x && typeof x.name === "string" && Number.isInteger(x.score) && x.score >= 0 && x.score <= 1000000 &&
      (x.bot === null || F.LEVELS.includes(x.bot)))) return false;
    if (!Number.isInteger(st.turn) || st.turn < 0 || st.turn >= st.seats.length) return false;
    if (!Number.isInteger(st.moves) || st.moves < 1) return false;
    if (!["roll", "choose", "roll_or_bank"].includes(st.awaiting)) return false;
    if (!Array.isArray(st.dice) || st.dice.length > F.DICE || !st.dice.every((d) => d && Number.isInteger(d.v) && d.v >= 1 && d.v <= 6 && typeof d.kept === "boolean")) return false;
    if (!Array.isArray(st.setAside) || st.setAside.length > F.DICE || !st.setAside.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)) return false;
    if (st.setAside.length + st.dice.length > F.DICE) return false;
    if (!Number.isInteger(st.turnScore) || st.turnScore < 0 || st.turnScore > 1000000) return false;
    if (st.winner !== null) return false;
    st.last = null;
    mode = "computer"; modeSel.value = "computer"; applyMode();
    clearTimeout(Lc && Lc.timer);
    Lc = { st, cfg: { players: st.seats.length, level: diff }, events: [], timer: null };
    playersSel.value = String(st.seats.length);
    sel.clear(); overFor = null; overText = ""; rolledKey = null;
    localRender();
    localSchedule();
    return true;
  });
  if (!invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("farkle"));
})();
