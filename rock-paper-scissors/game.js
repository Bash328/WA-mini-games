(function () {
  "use strict";

  const P1 = 1, P2 = 2;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const CHOICE_NAME = { 1: "Rock", 2: "Paper", 3: "Scissors" };
  const CHOICE_EMOJI = { 1: "🪨", 2: "📄", 3: "✂️" };

  const statusEl = document.getElementById("status");
  const scoreEl = document.getElementById("score");
  const lastEl = document.getElementById("last-round");
  const choicesEl = document.getElementById("choices");
  const bestofSel = document.getElementById("bestof");
  const modeSel = document.getElementById("mode");
  const resetBtn = document.getElementById("reset-btn");

  const beats = (a, b) => (a === 1 && b === 3) || (a === 2 && b === 1) || (a === 3 && b === 2);
  const roundsToWin = (n) => Math.ceil(n / 2);
  const other = (p) => p === P1 ? P2 : P1;

  function boardToStr(o) { return "" + o.n + o.p1Wins + o.p2Wins + o.pending + o.lastP1 + o.lastP2; }
  function strToBoard(s) { return { n: +s[0], p1Wins: +s[1], p2Wins: +s[2], pending: +s[3], lastP1: +s[4], lastP2: +s[5] }; }

  function updateScore(p1, p2, n) { scoreEl.textContent = `Player 1: ${p1} · Player 2: ${p2} (best of ${n})`; }
  function updateLast(lp1, lp2) {
    lastEl.textContent = (lp1 && lp2)
      ? `Last round: Player 1 ${CHOICE_EMOJI[lp1]} ${CHOICE_NAME[lp1]} · Player 2 ${CHOICE_EMOJI[lp2]} ${CHOICE_NAME[lp2]}`
      : "";
  }
  function renderChoiceButtons(show, onPick) {
    choicesEl.hidden = !show;
    choicesEl.innerHTML = "";
    if (!show) return;
    [1, 2, 3].forEach(c => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rps-choice";
      b.innerHTML = `<span class="rps-emoji">${CHOICE_EMOJI[c]}</span><span>${CHOICE_NAME[c]}</span>`;
      b.addEventListener("click", () => onPick(c));
      choicesEl.appendChild(b);
    });
  }

  // ---------- 2 players over WhatsApp ----------
  // board: a 6-digit string "n p1Wins p2Wins pending lastP1 lastP2" — one
  // char each. `pending` is Player 1's hidden pick for the round in
  // progress (0 = no pending pick). The value genuinely does ride along in
  // the link (same tradeoff as Minesweeper's mine positions): a motivated
  // player could read it in devtools, but the UI never displays it, which
  // is enough to make blind link-passing actually work for real play.
  // Player 1 always makes the hidden pick that opens a round; Player 2
  // always makes the pick that resolves it — turn alternates normally
  // (no nextTurn override needed), a tie just replays the same round.
  const link = AsyncShare.start({
    game: "rock-paper-scissors",
    version: 1,
    title: "rock paper scissors",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: (s) => {
      const b = s.board;
      if (typeof b !== "string" || b.length !== 6 || !/^[0-9]{6}$/.test(b)) return false;
      const o = strToBoard(b);
      if (![3, 5, 7].includes(o.n)) return false;
      const rtw = roundsToWin(o.n);
      if (o.p1Wins < 0 || o.p1Wins > rtw || o.p2Wins < 0 || o.p2Wins > rtw) return false;
      if (o.pending < 0 || o.pending > 3) return false;
      if (o.lastP1 < 0 || o.lastP1 > 3 || o.lastP2 < 0 || o.lastP2 > 3) return false;
      return Number.isInteger(s.last) && s.last >= 1 && s.last <= 3;
    },
    onState: loadLink,
    detail: (s) => {
      const o = strToBoard(s.board);
      return `Final score: Player 1 ${o.p1Wins} · Player 2 ${o.p2Wins} (best of ${o.n}).`;
    },
  });

  let wa = null, waCanMove = false, waInGame = false;

  function loadLink(s, canMove) {
    waInGame = !!s;
    waCanMove = canMove;
    wa = s ? strToBoard(s.board) : { n: +bestofSel.value, p1Wins: 0, p2Wins: 0, pending: 0, lastP1: 0, lastP2: 0 };
    bestofSel.disabled = waInGame;
    updateScore(wa.p1Wins, wa.p2Wins, wa.n);
    // If this viewer just sent a hidden pick and is waiting, it's safe (and
    // helpful) to remind them what THEY picked — that's their own info, not
    // a leak to the opponent, who sees their own pending flag as 0 instead.
    if (!canMove && wa.pending !== 0 && s && s.status === "in_progress") {
      lastEl.textContent = `You picked ${CHOICE_EMOJI[wa.pending]} ${CHOICE_NAME[wa.pending]} — waiting for Player 2.`;
    } else {
      updateLast(wa.lastP1, wa.lastP2);
    }
    renderChoiceButtons(waCanMove, pickWA);
  }

  function pickWA(choice) {
    if (!waCanMove) return;
    if (wa.pending === 0) {
      link.commit({
        board: boardToStr({ ...wa, pending: choice }),
        status: "in_progress", winner: null, last: choice,
      });
      return;
    }
    const p1c = wa.pending, p2c = choice;
    let { p1Wins, p2Wins } = wa;
    let status = "in_progress", winner = null;
    if (p1c !== p2c) {
      if (beats(p1c, p2c)) p1Wins++; else p2Wins++;
      const rtw = roundsToWin(wa.n);
      if (p1Wins >= rtw) { status = "won"; winner = P1; }
      else if (p2Wins >= rtw) { status = "won"; winner = P2; }
    }
    link.commit({
      board: boardToStr({ n: wa.n, p1Wins, p2Wins, pending: 0, lastP1: p1c, lastP2: p2c }),
      status, winner, last: choice,
    });
  }

  // ---------- 2 players, same device ----------
  let lo = null, loOver = false;

  function resetLocal() {
    lo = { n: +bestofSel.value, p1Wins: 0, p2Wins: 0, pending: 0, lastP1: 0, lastP2: 0 };
    loOver = false;
    renderLocal();
  }

  function renderLocal() {
    updateScore(lo.p1Wins, lo.p2Wins, lo.n);
    bestofSel.disabled = lo.p1Wins + lo.p2Wins + lo.pending > 0;
    if (loOver) {
      updateLast(lo.lastP1, lo.lastP2);
      renderChoiceButtons(false, null);
      return;
    }
    statusEl.textContent = lo.pending === 0
      ? "Player 1: pick secretly, then hand the device to Player 2."
      : "Player 2: make your pick.";
    updateLast(lo.pending === 0 ? lo.lastP1 : 0, lo.pending === 0 ? lo.lastP2 : 0);
    renderChoiceButtons(true, pickLocal);
  }

  function pickLocal(choice) {
    if (loOver) return;
    if (lo.pending === 0) { lo.pending = choice; renderLocal(); return; }
    const p1c = lo.pending, p2c = choice;
    lo.pending = 0;
    if (p1c === p2c) { lo.lastP1 = p1c; lo.lastP2 = p2c; renderLocal(); return; }
    if (beats(p1c, p2c)) lo.p1Wins++; else lo.p2Wins++;
    lo.lastP1 = p1c; lo.lastP2 = p2c;
    const rtw = roundsToWin(lo.n);
    if (lo.p1Wins >= rtw || lo.p2Wins >= rtw) {
      loOver = true;
      statusEl.textContent = `${NAMES[lo.p1Wins > lo.p2Wins ? P1 : P2]} wins the match!`;
    }
    renderLocal();
  }

  function applyMode() {
    const isWA = modeSel.value === "whatsapp";
    resetBtn.hidden = isWA;
    if (isWA) { link.show(); return; }
    link.hide();
    resetLocal();
  }

  resetBtn.addEventListener("click", resetLocal);
  modeSel.addEventListener("change", applyMode);
  bestofSel.addEventListener("change", () => { if (modeSel.value === "local") resetLocal(); });
  applyMode();
  window.addEventListener("load", () => Manpage.autoOpen("rock-paper-scissors"));

  window.__rpsTest = { beats, roundsToWin, boardToStr, strToBoard };
})();
