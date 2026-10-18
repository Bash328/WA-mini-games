/* fun.js — the header pieces of the chunky look (see fun.css). Load after gamekit.js.
   Only acts on <body class="fun">:
     data-fun-vs       builds the "P1 0 VS P2 0" bar from #score ("...: 3 ... : 5"), with the
                       mode name on its tab, and keeps it in step as the score changes
     data-fun-reset    adds the round restart button to the header; it presses the page's
                       own "new game" button */
(function () {
  "use strict";
  const body = document.body;
  if (!body.classList.contains("fun")) return;
  const top = document.querySelector(".topbar");
  if (!top) return;
  const mk = (tag, cls, html) => { const e = document.createElement(tag); e.className = cls; if (html != null) e.innerHTML = html; return e; };

  if ("funVs" in body.dataset) {
    const score = document.getElementById("score");
    const mode = document.getElementById("mode");
    const names = (body.dataset.funVs || "P1,P2").split(",");
    const bar = mk("div", "fun-vs", '<span class="tab"></span><b class="l">' + names[0] + "<i>0</i></b><em>VS</em><b class=\"r\">" + names[1] + "<i>0</i></b>");
    top.appendChild(bar);
    const nums = bar.querySelectorAll("i"), tab = bar.querySelector(".tab");
    const sync = () => {
      const m = /:\s*(\d+)[^:]*:\s*(\d+)/.exec(score ? score.textContent : "");
      if (m) { nums[0].textContent = m[1]; nums[1].textContent = m[2]; }
      if (score && score.dataset.l) { bar.querySelector(".l").firstChild.nodeValue = score.dataset.l; bar.querySelector(".r").firstChild.nodeValue = score.dataset.r; }
      if (mode) {
        const o = mode.options[mode.selectedIndex];
        tab.textContent = o ? o.dataset.short || o.textContent : "";
      }
      tab.hidden = !tab.textContent;
    };
    if (score) new MutationObserver(sync).observe(score, { childList: true, subtree: true, characterData: true, attributes: true });
    if (mode) mode.addEventListener("change", sync);
    sync();
  }

  if ("funReset" in body.dataset) {
    const right = top.querySelector(".gk-top-r") || top.appendChild(mk("div", "gk-top-r"));
    const b = mk("button", "fun-restart");
    b.type = "button"; b.setAttribute("aria-label", "New game");
    b.addEventListener("click", () => {
      const n = document.querySelector(".gk-new, #reset-btn, #new-btn, #reset");
      if (n) n.click();
    });
    right.insertBefore(b, right.firstChild);
  }
})();
