/* account-ui.js — the "Your name" panel on the home page (needs account.js).
   Pick a username, turn on notifications, mute or block, install the app. */
(function () {
  "use strict";
  const root = document.getElementById("acct-box");
  if (!root || typeof Account === "undefined") return;

  const h = Account.h;

  let profile = null;          // { name, push, muted, blocked } once the server has answered
  let pushAvailable = false;
  let msg = "";

  /* ---------- pieces ---------- */

  function pickName() {
    const input = h("input", {
      type: "text", id: "acct-name", maxlength: "16", placeholder: "username", autocomplete: "off",
      autocapitalize: "off", spellcheck: "false", "aria-label": "Username",
    });
    const note = h("p", { class: "acct-msg", "aria-live": "polite" });
    const btn = h("button", { type: "submit", class: "acct-primary" }, "Pick name");
    let timer = null, seq = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const v = input.value.trim();
      note.className = "acct-msg";
      if (!v) { note.textContent = ""; return; }
      timer = setTimeout(async () => {
        const mine = ++seq;
        const r = await Account.check(v);
        if (mine !== seq) return;
        if (r.available) { note.textContent = "✓ " + v + " is free."; note.className = "acct-msg ok"; }
        else { note.textContent = Account.REASONS[r.reason] || "Can't use that name."; note.className = "acct-msg bad"; }
      }, 350);
    });
    const form = h("form", { class: "acct-row", onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const r = await Account.claim(input.value);
      btn.disabled = false;
      if (r.status === 200) { msg = ""; await load(); return; }
      note.textContent = Account.REASONS[r.reason] || (r.status === 0 ? "Couldn't reach the server." : "That didn't work.");
      note.className = "acct-msg bad";
    } }, input, btn);
    return [
      h("p", { class: "acct-note" }, "Pick a username so friends can poke you into a live game. No password, no email: the name lives in this browser."),
      form, note,
    ];
  }

  function signedIn() {
    const out = [h("p", { class: "acct-who" }, "Playing as ", h("b", {}, profile.name))];

    if (pushAvailable && Account.pushSupported()) {
      const on = profile.push;
      out.push(h("div", { class: "acct-row" },
        h("button", { type: "button", class: on ? "" : "acct-primary", onclick: async (e) => {
          e.target.disabled = true;
          if (on) { await Account.disableNotifications(); msg = ""; }
          else {
            const r = await Account.enableNotifications();
            msg = r.ok ? "" : r.reason === "denied" ? "Notifications are blocked for this site in your browser settings."
              : r.reason === "unsupported" ? "This browser can't do notifications." : "Couldn't turn notifications on. Try again.";
          }
          await load();
        } }, on ? "Turn off notifications" : "Turn on notifications"),
        h("span", { class: "acct-hint" }, on ? "A friend's poke shows up as a notification." : "So friends can poke you into a game."),
      ));
      out.push(h("label", { class: "acct-check" },
        h("input", { type: "checkbox", checked: profile.muted, onchange: async (e) => { await Account.settings({ muted: e.target.checked }); await load(); } }),
        " Mute pokes (don't notify me)"));
    } else if (!pushAvailable) {
      out.push(h("p", { class: "acct-hint" }, "Poke notifications aren't switched on for this site yet."));
    } else {
      out.push(h("p", { class: "acct-hint" }, Account.needsIOSHint()
        ? "On iPhone, notifications work from the installed app: tap Share, then Add to Home Screen, and open it from there."
        : "This browser can't do notifications."));
    }

    const blockInput = h("input", { type: "text", maxlength: "16", placeholder: "block a name", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Name to block" });
    out.push(h("form", { class: "acct-row", onsubmit: async (e) => {
      e.preventDefault();
      if (!blockInput.value.trim()) return;
      await Account.settings({ block: blockInput.value });
      await load();
    } }, blockInput, h("button", { type: "submit" }, "Block")));
    if (profile.blocked.length) {
      out.push(h("p", { class: "acct-blocked" }, "Blocked: ", profile.blocked.map((n) =>
        h("button", { type: "button", class: "acct-chip", title: "Unblock " + n, onclick: async () => { await Account.settings({ unblock: n }); await load(); } }, n + " ✕"))));
    }

    out.push(h("p", { class: "acct-hint" }, "Your name is tied to this browser. If you clear its site data you lose the name."));
    out.push(h("button", { type: "button", class: "acct-link", onclick: async () => {
      if (!confirm("Release the name " + profile.name + "? Anyone can take it after that.")) return;
      await Account.release();
      profile = null; msg = "";
      render();
    } }, "Release this name"));
    return out;
  }

  function installRow() {
    if (Account.standalone()) return null;
    if (Account.canInstall()) {
      return h("div", { class: "acct-install" },
        h("button", { type: "button", class: "acct-primary", onclick: () => Account.install() }, "Install the app"),
        h("span", { class: "acct-hint" }, "Add it to your home screen. It opens full screen, like an app."));
    }
    if (Account.needsIOSHint()) {
      return h("p", { class: "acct-hint acct-install" }, "Install it: tap the Share button, then “Add to Home Screen”.");
    }
    return null;
  }

  function render() {
    root.replaceChildren(...(Account.me() && profile ? signedIn() : pickName()));
    if (msg) root.appendChild(h("p", { class: "acct-msg bad", role: "alert" }, msg));
    const inst = installRow();
    if (inst) root.appendChild(inst);
  }

  async function load() {
    const st = await Account.status();
    pushAvailable = !!st.push;
    if (Account.me()) {
      const r = await Account.ping();
      if (r.status === 200) profile = r;
      else if (r.status === 401) { profile = null; msg = "Your name isn't registered any more (it may have expired). Pick it again."; localStorage.removeItem("user:name"); localStorage.removeItem("user:token"); }
      else profile = { name: Account.me().name, push: false, muted: false, blocked: [] };   // offline: show what we know
    } else profile = null;
    render();
  }

  Account.onInstallChange(render);
  Account.registerWorker();
  load();
})();
