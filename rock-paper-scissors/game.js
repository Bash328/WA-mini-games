(function () {
  "use strict";

  const P1 = 1, P2 = 2;
  const NAMES = { [P1]: "Player 1", [P2]: "Player 2" };
  const CHOICE_NAME = { 1: "Rock", 2: "Paper", 3: "Scissors" };
  const HAND_SVG = {
    1: '<svg viewBox="-32 -40 64 90" aria-hidden="true"><g><path d="M-11 14L-13 46L13 46L11 14Z" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><rect x="-15" y="-12" width="30" height="30" rx="11" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><circle cx="-10.5" cy="-10" r="6.3" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><circle cx="-3.5" cy="-10" r="6.3" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><circle cx="3.5" cy="-10" r="6.3" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><circle cx="10.5" cy="-10" r="6.3" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><line x1="-7" y1="-7" x2="-7" y2="5" stroke="#d9784f" stroke-width="1.3" stroke-linecap="round" /><line x1="0" y1="-7" x2="0" y2="5" stroke="#d9784f" stroke-width="1.3" stroke-linecap="round" /><line x1="7" y1="-7" x2="7" y2="5" stroke="#d9784f" stroke-width="1.3" stroke-linecap="round" /><ellipse cx="-3" cy="9.5" rx="13" ry="6" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round" transform="rotate(-10 -3 9.5)"/></g></svg>',
    2: '<svg viewBox="-32 -40 64 90" aria-hidden="true"><g><path d="M-11 14L-13 46L13 46L11 14Z" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><rect x="-13.5" y="-4" width="27" height="28" rx="10" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><rect x="-12.899999999999999" y="-29" width="6.6" height="35" rx="3.3" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><rect x="-6.5" y="-35" width="6.6" height="41" rx="3.3" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><rect x="-0.09999999999999964" y="-33" width="6.6" height="39" rx="3.3" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><rect x="6.3" y="-26" width="6.6" height="32" rx="3.3" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><g transform="rotate(-38 -13 12)"><rect x="-27" y="4" width="9" height="20" rx="4.5" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/></g><rect x="-13.5" y="8" width="27" height="16" rx="8" fill="#f4a27a" /></g></svg>',
    3: '<svg viewBox="-32 -40 64 90" aria-hidden="true"><g><path d="M-11 14L-13 46L13 46L11 14Z" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><g transform="rotate(-15 -4 4)"><rect x="-8" y="-32" width="7.4" height="40" rx="3.7" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/></g><g transform="rotate(13 5 4)"><rect x="1.5" y="-36" width="7.4" height="44" rx="3.7" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/></g><rect x="-13" y="2" width="26" height="22" rx="9" fill="#f4a27a" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><circle cx="5.5" cy="4" r="5" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><circle cx="11" cy="7" r="4.4" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round"/><ellipse cx="-2" cy="13" rx="9.5" ry="5.2" fill="#fbc7a4" stroke="#d9784f" stroke-width="1.2" stroke-linejoin="round" transform="rotate(-22 -2 13)"/></g></svg>',
  };

  // The same hand drawings as the hub card, in place of emoji.
  const hand = (c, cls) => '<span class="rps-hand' + (cls ? " " + cls : "") + '">' + HAND_SVG[c] + "</span>";
  const esc = (t) => String(t).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));

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

  // The score: one big number per side, with how many wins the match needs.
  function setScore(aName, a, bName, b, n) {
    scoreEl.innerHTML =
      '<div class="rps-side"><span class="rps-name">' + esc(aName) + '</span><span class="rps-num">' + a + "</span></div>" +
      '<div class="rps-mid">first to ' + roundsToWin(n) + "<small>best of " + n + "</small></div>" +
      '<div class="rps-side"><span class="rps-name">' + esc(bName) + '</span><span class="rps-num">' + b + "</span></div>";
  }
  function updateScore(p1, p2, n) { setScore("Player 1", p1, "Player 2", p2, n); }

  // The last round: both hands face to face, with who took it.
  function faceoff(aName, a, bName, b, verdict, note) {
    return (note ? '<p class="rps-note">' + esc(note) + "</p>" : "") + (a && b
      ? '<div class="rps-faceoff"><div class="rps-fighter">' + hand(a) + "<span>" + esc(aName) + " · " + CHOICE_NAME[a] + "</span></div>" +
        '<div class="rps-vs">vs</div><div class="rps-fighter">' + hand(b, "flip") + "<span>" + esc(bName) + " · " + CHOICE_NAME[b] + "</span></div></div>" +
        '<p class="rps-verdict">' + esc(verdict) + "</p>"
      : "");
  }
  function updateLast(lp1, lp2, note) {
    const verdict = lp1 === lp2 ? "A tie. Go again." : beats(lp1, lp2) ? "Player 1 took it." : "Player 2 took it.";
    lastEl.innerHTML = faceoff("Player 1", lp1, "Player 2", lp2, verdict, note);
  }
  function renderChoiceButtons(show, onPick) {
    choicesEl.hidden = !show;
    choicesEl.innerHTML = "";
    if (!show) return;
    [1, 2, 3].forEach(c => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rps-choice";
      b.innerHTML = hand(c) + `<span>${CHOICE_NAME[c]}</span>`;
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
  function validateRps(s) {
    const b = s.board;
    if (typeof b !== "string" || b.length !== 6 || !/^[0-9]{6}$/.test(b)) return false;
    const o = strToBoard(b);
    if (![3, 5, 7].includes(o.n)) return false;
    const rtw = roundsToWin(o.n);
    if (o.p1Wins < 0 || o.p1Wins > rtw || o.p2Wins < 0 || o.p2Wins > rtw) return false;
    if (o.pending < 0 || o.pending > 3) return false;
    if (o.lastP1 < 0 || o.lastP1 > 3 || o.lastP2 < 0 || o.lastP2 > 3) return false;
    return Number.isInteger(s.last) && s.last >= 1 && s.last <= 3;
  }
  function finalScore(s) {
    const o = strToBoard(s.board);
    return `Final score: Player 1 ${o.p1Wins} · Player 2 ${o.p2Wins} (best of ${o.n}).`;
  }

  const link = AsyncShare.start({
    game: "rock-paper-scissors",
    version: 1,
    title: "rock paper scissors",
    players: [P1, P2],
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateRps,
    onState: loadLink,
    detail: finalScore,
  });

  // Live online play. Unlike link play, both players pick at the same time:
  // each locks a secret pick and the server reveals them together, so
  // nothing about a pick is ever sent to the opponent early.
  const live = typeof LiveShare === "undefined" ? null : LiveShare.start({
    game: "rock-paper-scissors",
    version: 1,
    players: [P1, P2],
    simultaneous: true,
    roomOptions: () => ({ bestOf: bestofSel.value }),
    label: (p) => NAMES[p],
    ui: document.getElementById("wa-ui"),
    statusEl: statusEl,
    validateBoard: validateRps,
    onState: loadLive,
    detail: finalScore,
  });

  function loadLive(s, canPick, info) {
    const inRoom = info.phase === "room";
    const me = info.me === P2 ? P2 : P1;
    const b = s ? strToBoard(s.board)
      : { n: Number(info.config ? info.config.bestOf : bestofSel.value) || 3, p1Wins: 0, p2Wins: 0, pending: 0, lastP1: 0, lastP2: 0 };
    if (info.config && inRoom) bestofSel.value = String(info.config.bestOf);   // a joiner sees the host's choice
    bestofSel.disabled = inRoom;
    const mine = me === P2 ? b.p2Wins : b.p1Wins, theirs = me === P2 ? b.p1Wins : b.p2Wins;
    setScore("You", mine, "Opponent", theirs, b.n);

    const myLast = me === P2 ? b.lastP2 : b.lastP1, theirLast = me === P2 ? b.lastP1 : b.lastP2;
    const oppSeat = info.seat === 1 ? 2 : 1;
    const over = !!s && s.status !== "in_progress";
    let note = "";
    if (inRoom && !over && info.myPick) note = `You picked ${CHOICE_NAME[info.myPick]}. Waiting for your opponent…`;
    else if (inRoom && !over && info.picked && info.picked[oppSeat] && !info.myPick) note = "Your opponent has picked. Your move!";
    const verdict = myLast === theirLast ? "A tie. Go again." : beats(myLast, theirLast) ? "You took it." : "They took it.";
    lastEl.innerHTML = faceoff("You", inRoom ? myLast : 0, "Opponent", inRoom ? theirLast : 0, verdict, note);
    renderChoiceButtons(inRoom && canPick, (c) => live.pick(c));
  }

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
      lastEl.innerHTML = '<p class="rps-note">' + esc(`You picked ${CHOICE_NAME[wa.pending]} — waiting for Player 2.`) + "</p>";
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

  // "You've got this in the bag" / "spoke too soon" - see checkers for the
  // same pattern. A best-of-N match is short, so the natural lead moment
  // is "one win from a clean sweep" (2-0 in a best of 3, 3-0 in a best of
  // 5, ...) rather than a raw score difference.
  let confidenceGivenTo = null;
  let confidenceNote = "";

  function checkConfidence() {
    if (confidenceGivenTo !== null || loOver) return;
    const rtw = roundsToWin(lo.n);
    if (lo.p1Wins === rtw - 1 && lo.p2Wins === 0) confidenceGivenTo = P1;
    else if (lo.p2Wins === rtw - 1 && lo.p1Wins === 0) confidenceGivenTo = P2;
    else return;
    const trailing = confidenceGivenTo === P1 ? P2 : P1;
    confidenceNote = `${NAMES[confidenceGivenTo]} — ${Gamekit.taunt("confidence")} ${NAMES[trailing]} — ${Gamekit.taunt("lastChance")}`;
  }

  function resetLocal() {
    lo = { n: +bestofSel.value, p1Wins: 0, p2Wins: 0, pending: 0, lastP1: 0, lastP2: 0 };
    loOver = false;
    confidenceGivenTo = null; confidenceNote = "";
    renderLocal();
  }

  function renderLocal() {
    updateScore(lo.p1Wins, lo.p2Wins, lo.n);
    bestofSel.disabled = lo.p1Wins + lo.p2Wins + lo.pending > 0;
    if (loOver) {
      Gamekit.turn(null);
      updateLast(lo.lastP1, lo.lastP2);
      renderChoiceButtons(false, null);
      return;
    }
    Gamekit.turn(lo.pending === 0 ? P1 : P2, lo.pending === 0 ? "Player 1 · pick secretly" : "Player 2 · your pick");
    const note = confidenceNote; confidenceNote = "";
    statusEl.textContent = (lo.pending === 0
      ? "Player 1: pick secretly, then hand the device to Player 2."
      : "Player 2: make your pick.") + (note ? " " + note : "");
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
      const winnerColor = lo.p1Wins > lo.p2Wins ? P1 : P2;
      const loserColor = winnerColor === P1 ? P2 : P1;
      const reversed = confidenceGivenTo === loserColor;
      statusEl.textContent = `${NAMES[winnerColor]} wins the match! ${NAMES[loserColor]} — ${Gamekit.taunt(reversed ? "reversal" : "loss")}`;
    } else {
      checkConfidence();
    }
    renderLocal();
  }

  function applyMode() {
    const m = modeSel.value;
    resetBtn.hidden = m === "whatsapp" || m === "live";
    if (m === "live" && live) { link.hide(); live.show(); return; }
    if (m === "whatsapp") { if (live) live.hide(); bestofSel.disabled = false; link.show(); return; }
    link.hide();
    if (live) live.hide();
    bestofSel.disabled = false;
    resetLocal();
  }

  resetBtn.addEventListener("click", resetLocal);
  modeSel.addEventListener("change", applyMode);
  // A refresh keeps a same-device match: the score, the last round and a pick already made.
  // (Link and online games are not saved here.)
  const resumer = Gamekit.resume("rock-paper-scissors", () => (modeSel.value !== "local" || loOver || !lo ||
      (lo.p1Wins + lo.p2Wins + lo.pending + lo.lastP1) === 0) ? null : { lo: lo }, (s) => {
    const o = s.lo;
    if (!o || ![3, 5, 7].includes(o.n)) return false;
    const rtw = roundsToWin(o.n);
    const ok = [o.p1Wins, o.p2Wins].every(v => Number.isInteger(v) && v >= 0 && v < rtw) &&
      [o.pending, o.lastP1, o.lastP2].every(v => Number.isInteger(v) && v >= 0 && v <= 3);
    if (!ok) return false;
    modeSel.value = "local"; bestofSel.value = String(o.n);
    applyMode();
    lo = { n: o.n, p1Wins: o.p1Wins, p2Wins: o.p2Wins, pending: o.pending, lastP1: o.lastP1, lastP2: o.lastP2 };
    loOver = false;
    renderLocal();
    return true;
  });

  bestofSel.addEventListener("change", () => {
    if (modeSel.value === "local") resetLocal();
    if (modeSel.value === "live" && live) live.rewarm();   // the spare room has the old best-of
  });

  // The live option stays hidden until the server says live play is on for
  // this game. A ?live=CODE invite link opens straight into live mode (the
  // way ?s= does for WhatsApp mode); LiveShare explains if it's switched off.
  const liveOpt = modeSel.querySelector('option[value="live"]');
  const invited = new URLSearchParams(location.search).has("live");
  if (live && invited) {
    liveOpt.hidden = false;
    modeSel.value = "live";
  } else if (live) {
    LiveShare.enable(modeSel, "rock-paper-scissors");
  }
  applyMode();
  if (!new URLSearchParams(location.search).has("s") && !invited) resumer.restore();
  window.addEventListener("load", () => Manpage.autoOpen("rock-paper-scissors"));

})();
