/* ============================================================
   async-share.js — play-by-link for two-player games.

   There is no server: the whole game state rides in the URL as
   ?s=<lz-string>. After a move the player sends the new link on
   WhatsApp; the opponent opens it, moves, and sends one back.

   State envelope (every game):
     { game, version, id, turn, board, status, winner, moveCount, last }
     id        random, only used by this device to spot old links
     turn      player who moves next (after the game ends: the player
               who did NOT make the final move)
     status    "in_progress" | "won" | "draw"
     winner    null unless status is "won"
     last      game-specific index of the last move, for highlighting

   Exposes `window.AsyncShare`. Needs gamekit.js and
   vendor/lz-string.min.js loaded first.
   ============================================================ */
(function (global) {
  "use strict";

  const PARAM = "s";
  const STATUSES = ["in_progress", "won", "draw"];
  const MAX_REMEMBERED = 40;

  /* ---------- Encoding ---------- */

  // lz-string's URI alphabet is [A-Za-z0-9+-]. A "+" in a query string
  // decodes to a space and some apps mangle it, so swap it for "_" and
  // keep links to unreserved characters. decode() accepts all spellings.
  function encode(state) {
    return LZString.compressToEncodedURIComponent(JSON.stringify(state)).replace(/\+/g, "_");
  }

  function decode(str) {
    if (typeof str !== "string" || !str) return null;
    try {
      const json = LZString.decompressFromEncodedURIComponent(str.replace(/[_ ]/g, "+"));
      return json ? JSON.parse(json) : null;
    } catch (e) {
      return null;
    }
  }

  // Envelope checks shared by every game; opts.validateBoard covers the rest.
  function validate(s, opts) {
    if (!s || typeof s !== "object" || Array.isArray(s)) return false;
    if (s.game !== opts.game || s.version !== opts.version) return false;
    if (typeof s.id !== "string" || !/^[a-z0-9]{4,16}$/.test(s.id)) return false;
    if (STATUSES.indexOf(s.status) === -1) return false;
    if (opts.players.indexOf(s.turn) === -1) return false;
    if (!Number.isInteger(s.moveCount) || s.moveCount < 1) return false;
    if (s.status === "won" ? opts.players.indexOf(s.winner) === -1 : s.winner !== null) return false;
    try { return !!opts.validateBoard(s); } catch (e) { return false; }
  }

  /* ---------- What this device has seen ----------
     Links carry no identity, so each browser remembers the newest move
     it has seen per game id. That is how a re-opened old link is spotted,
     and how a refresh after moving shows "send it" instead of letting the
     same player move twice. */
  const store = Gamekit.storage("async:");

  function seenAll() {
    const all = store.getJSON("seen", {});
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  }

  function recall(s) {
    const rec = seenAll()[s.game + ":" + s.id];
    return rec && Number.isInteger(rec.n) && typeof rec.s === "string" ? rec : null;
  }

  function remember(s, enc, sent) {
    const all = seenAll();
    all[s.game + ":" + s.id] = { n: s.moveCount, s: enc, sent: sent, t: Date.now() };
    Object.keys(all)
      .sort((a, b) => (all[b].t || 0) - (all[a].t || 0))
      .slice(MAX_REMEMBERED)
      .forEach(k => delete all[k]);
    store.setJSON("seen", all);
  }

  function newId() {
    let id = "";
    while (id.length < 8) id += Gamekit.randomSeed().toString(36);
    return id.slice(0, 8);
  }

  /* ---------- Links + clipboard ---------- */

  function pageUrl() { return location.href.split(/[?#]/)[0]; }
  function linkFor(enc) { return pageUrl() + "?" + PARAM + "=" + enc; }

  function setParam(enc) {
    try { history.replaceState(null, "", enc ? "?" + PARAM + "=" + enc : location.pathname); } catch (e) {}
  }

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && global.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  /* ---------- Controller ----------
     opts = {
       game, version, title,       identifiers + name used in the message
       players: [first, second],   values stored in turn / winner
       label(player),              display name, e.g. "X" or "Red"
       validateBoard(state),       game-specific shape check
       onState(state, canMove),    render the board (state null = new game)
       detail(state, viewer),      optional extra line on the game-over screen
       ui, statusEl                containers for the share panel + status line
     } */
  function start(opts) {
    const ui = opts.ui;
    const statusEl = opts.statusEl;
    const label = opts.label || String;
    let view = null;   // { kind, state, enc, viewer, latest }

    function other(p) { return p === opts.players[0] ? opts.players[1] : opts.players[0]; }

    function classify(raw) {
      if (raw === null) return { kind: "new", state: null, viewer: opts.players[0] };
      raw = raw.replace(/[+ ]/g, "_");
      const state = decode(raw);
      if (!validate(state, opts)) return { kind: "invalid", state: null };
      const rec = recall(state);
      if (rec && state.moveCount < rec.n) return { kind: "stale", state: state, latest: rec };
      if (rec && state.moveCount === rec.n && rec.sent) {
        return { kind: "sent", state: state, enc: raw, viewer: other(state.turn) };
      }
      remember(state, raw, false);
      return { kind: "received", state: state, enc: raw, viewer: state.turn };
    }

    function canMove() {
      return !!view && (view.kind === "new" || view.kind === "received") &&
        (!view.state || view.state.status === "in_progress");
    }

    // move = { board, status, winner, last } for the player whose turn it is.
    function commit(move) {
      if (!canMove()) return;
      const prev = view.state;
      const mover = view.viewer;
      const enc = encode({
        game: opts.game,
        version: opts.version,
        id: prev ? prev.id : newId(),
        turn: other(mover),
        board: move.board,
        status: move.status,
        winner: move.winner === undefined ? null : move.winner,
        moveCount: (prev ? prev.moveCount : 0) + 1,
        last: move.last === undefined ? null : move.last,
      });
      // Render from the decoded link so the sender sees exactly what the opponent will.
      const state = decode(enc);
      remember(state, enc, true);
      setParam(enc);
      view = { kind: "sent", state: state, enc: enc, viewer: mover };
      paint();
    }

    function go(enc) {
      setParam(enc);
      view = classify(enc);
      paint();
    }

    function newGame() {
      setParam(null);
      view = classify(null);
      paint();
    }

    /* ----- DOM helpers ----- */
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    }
    function banner(cls, text) { ui.appendChild(el("div", "banner" + (cls ? " " + cls : ""), text)); }
    function note(text) { ui.appendChild(el("p", "wa-note", text)); }
    function actions(...buttons) {
      const row = el("div", "wa-actions");
      buttons.forEach(b => row.appendChild(b));
      ui.appendChild(row);
    }
    function button(text, cls, onClick) {
      const b = el("button", "btn " + cls, text);
      b.type = "button";
      b.addEventListener("click", onClick);
      return b;
    }
    function setStatus(bold, rest) {
      statusEl.replaceChildren(el("strong", "", bold));
      if (rest) statusEl.appendChild(document.createTextNode(" · " + rest));
    }

    function sendButton(enc, finished) {
      const msg = (finished ? "Game over in " : "Your move in ") + opts.title + "! " + linkFor(enc);
      const a = el("a", "btn wa-send", finished ? "Send result on WhatsApp" : "Send on WhatsApp");
      a.href = "https://wa.me/?text=" + encodeURIComponent(msg);
      a.target = "_blank";
      a.rel = "noopener";
      return a;
    }

    function copyButton(enc) {
      const b = button("Copy link", "ghost", () => {
        copyText(linkFor(enc)).then(ok => {
          b.textContent = ok ? "Copied!" : "Copy failed — use the address bar";
          setTimeout(() => { b.textContent = "Copy link"; }, 1800);
        });
      });
      return b;
    }

    function result(s, viewer) {
      if (s.status === "draw") return { cls: "", text: "It's a draw." };
      return s.winner === viewer
        ? { cls: "win", text: "You won! 🎉" }
        : { cls: "bad", text: "You lost." };
    }

    function paint() {
      const v = view;
      const s = v.state;
      opts.onState(s, canMove());
      ui.hidden = false;
      ui.replaceChildren();

      if (v.kind === "invalid") {
        setStatus("Invalid link");
        banner("bad", "This link looks invalid or from an older version of the game — start a new game?");
        actions(button("Start new game", "primary", newGame));
        return;
      }

      if (v.kind === "stale") {
        setStatus("Old link");
        banner("bad", "This is an old link — the game has already moved on to move " + v.latest.n + ".");
        note("You're looking at move " + s.moveCount + ".");
        actions(
          button("Open latest move", "primary", () => go(v.latest.s)),
          button("New game", "ghost", newGame)
        );
        return;
      }

      if (v.kind === "new") {
        setStatus("Your move", "you're " + label(v.viewer));
        note("Make the first move, then send the link to a friend on WhatsApp.");
        return;
      }

      if (s.status === "in_progress") {
        if (v.kind === "received") {
          setStatus("Your move", "you're " + label(v.viewer));
          note("Make your move, then send the new link back.");
          return;
        }
        setStatus("Waiting for " + label(s.turn));
        banner("", "Move made — now send the link. It's " + label(s.turn) + "'s turn.");
        actions(sendButton(v.enc, false), copyButton(v.enc));
        actions(button("Opponent on this device? Play " + label(s.turn) + " here", "ghost wa-small", () => {
          view = { kind: "received", state: s, enc: v.enc, viewer: s.turn };
          paint();
        }));
        return;
      }

      const r = result(s, v.viewer);
      setStatus("Game over");
      banner(r.cls, r.text);
      const extra = opts.detail ? opts.detail(s, v.viewer) : "";
      if (extra) note(extra);
      if (v.kind === "sent") {
        note("Send the final board so your opponent sees how it ended.");
        actions(sendButton(v.enc, true), copyButton(v.enc));
      }
      actions(button("New game", v.kind === "sent" ? "ghost" : "primary", newGame));
    }

    return {
      show() {
        view = classify(new URLSearchParams(location.search).get(PARAM));
        paint();
      },
      hide() {
        ui.hidden = true;
        ui.replaceChildren();
      },
      canMove: canMove,
      commit: commit,
      newGame: newGame,
    };
  }

  global.AsyncShare = { start: start, encode: encode, decode: decode, validate: validate };
})(window);
