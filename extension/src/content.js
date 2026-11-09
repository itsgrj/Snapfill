// Snapfill content script: fills a form on the first click, remembers what you type, shows a small message.
(function () {
  "use strict";
  if (window.__snapfill) return;
  window.__snapfill = true;

  var data = SF.normalize(null);
  var ready = SF.load().then(function (d) { data = d; });
  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area === "local" && ch[SF.STORE_KEY]) data = SF.normalize(ch[SF.STORE_KEY].newValue);
  });

  var host = location.hostname || "this page";
  var sessions = new Map();   // form root -> { p, items: [{ el, prev, val }], dummy }
  var handled = new WeakSet(); // roots already filled on first click
  var mine = new WeakMap();    // element -> value we set

  function paused() { return !!data.paused[host]; }
  function siteProfile() { return data.sites[host] || data.def || "work"; }
  function persist() { return SF.save(data); }

  /* ---------- form roots and fields ---------- */
  function rootOf(el) {
    if (el.form) return el.form;
    var p = el.parentElement;
    for (var i = 0; i < 8 && p && p !== document.body; i++) {
      if (p.querySelectorAll("input, select").length >= 3) return p;
      p = p.parentElement;
    }
    return document.body;
  }
  function fieldsIn(root) {
    return Array.prototype.filter.call(root.querySelectorAll("input, select"), function (el) { return SF.eligible(el) && !inOwnUi(el); });
  }
  function inOwnUi(el) { return el.closest && el.closest("#snapfill-host"); }
  function plan(root, p, dummy) {
    return fieldsIn(root).map(function (el) {
      var key = SF.classify(el), v = "", label = SF.labelText(el) || (SF.FIELD[key] ? SF.FIELD[key].label : "This field"), custom = null;
      if (key) v = SF.value(data, key, p, dummy);
      if (!v && !key) { custom = SF.findCustom(data, label); if (custom) v = SF.customValue(data, custom, p); }
      if (v && key === "dob") v = SF.formatDate(v, el);
      return { el: el, key: key, custom: custom, label: label, val: v };
    });
  }
  function knownCount(root, p) {
    var dummy = p === "dummy" ? SF.makeDummy() : null;
    return plan(root, p, dummy).filter(function (x) { return x.val; }).length;
  }

  /* ---------- writing values the way sites expect ---------- */
  function setNative(el, v) {
    var proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function setSelect(el, v) {
    var want = String(v).toLowerCase().trim(), hit = null;
    Array.prototype.some.call(el.options, function (o) {
      var t = (o.text || "").toLowerCase().trim(), val = (o.value || "").toLowerCase().trim();
      if (t === want || val === want) { hit = o; return true; }
      return false;
    });
    if (!hit) Array.prototype.some.call(el.options, function (o) { var t = (o.text || "").toLowerCase().trim(); if (t && want && (t.indexOf(want) === 0 || want.indexOf(t) === 0) && t.length > 2) { hit = o; return true; } return false; });
    if (!hit) return false;
    setNative(el, hit.value);
    return true;
  }
  function glow(el, color) {
    var prev = el.style.boxShadow, prevT = el.style.transition;
    el.style.transition = "box-shadow .3s ease";
    el.style.boxShadow = "inset 0 0 0 2px " + color;
    setTimeout(function () { el.style.boxShadow = prev; setTimeout(function () { el.style.transition = prevT; }, 320); }, 1400);
  }

  /* ---------- fill ---------- */
  function fill(root, p, focusEl) {
    var dummy = p === "dummy" ? SF.makeDummy() : null;
    var items = plan(root, p, dummy), done = [];
    items.forEach(function (x) {
      if (!x.val) return;
      var cur = x.el.value;
      if (x.el.tagName === "SELECT") {
        if (x.el.selectedIndex > 0) return;
        if (setSelect(x.el, x.val)) { done.push({ el: x.el, prev: cur, val: x.el.value }); mine.set(x.el, x.el.value); glow(x.el, p === "dummy" ? "#b98900" : "#29845a"); }
        return;
      }
      if (cur && cur.trim()) return;
      setNative(x.el, x.val);
      done.push({ el: x.el, prev: cur, val: x.val });
      mine.set(x.el, x.val);
      glow(x.el, p === "dummy" ? "#b98900" : "#29845a");
    });
    sessions.set(root, { p: p, items: done });
    var empty = items.filter(function (x) { return !x.el.value || (x.el.tagName === "SELECT" && x.el.selectedIndex <= 0); });
    var typable = empty.filter(function (x) { return x.el.tagName === "INPUT"; });
    if (done.length) {
      var target = typable[0];
      setTimeout(function () {
        if (target) { try { target.el.focus({ preventScroll: false }); } catch (e) {} }
      }, 0);
    }
    var names = empty.map(function (x) { return x.label; }).filter(Boolean);
    var sub = names.length ? "Still empty: " + listText(names.slice(0, 4)) + (names.length > 4 ? ", and " + (names.length - 4) + " more." : ".") :
      (p === "dummy" ? "All made up. Nothing here is saved." : "Every field is filled.");
    if (hasPassword(root)) sub += " Passwords are left to you.";
    toast.show({ kind: "ok", title: done.length ? "Filled " + plural(done.length, "field") + " as " + SF.PNAME[p] : "Nothing to fill as " + SF.PNAME[p], sub: sub, seg: p, root: root,
      actions: done.length ? [{ label: "Undo", act: "undo" }] : [] });
    return done.length;
  }
  function undo(root, quiet) {
    var s = sessions.get(root); if (!s) return;
    s.items.forEach(function (it) { if (it.el.value === it.val) { setNative(it.el, it.prev || ""); mine.delete(it.el); } });
    sessions.delete(root);
    if (!quiet) toast.show({ kind: "muted", icon: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 5H9.5a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M7 2.25 4 5l3 2.75" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', title: "Fill undone", sub: "Press Alt+Shift+F or use the Snapfill button to fill again.", root: root, timeout: 6000 });
  }
  function switchTo(root, p) {
    data.sites[host] = p; persist();
    undo(root, true);
    fill(root, p);
  }
  function hasPassword(root) { return !!root.querySelector('input[type="password"]'); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function listText(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }

  /* ---------- first click ---------- */
  // Only a click on a field Snapfill recognises starts a fill, so search boxes and comment fields never do.
  function triggers(el, p) {
    if (/search/i.test(SF.labelText(el) + " " + (el.getAttribute("name") || "") + " " + (el.getAttribute("role") || ""))) return false;
    if (SF.classify(el)) return true;
    if (p !== "dummy" && SF.findCustom(data, SF.labelText(el))) return true;
    return !!el.form;
  }
  document.addEventListener("focusin", function (e) {
    var el = e.target;
    if (!e.isTrusted || !SF.eligible(el) || inOwnUi(el)) return;
    ready.then(function () {
      if (paused()) return;
      var root = rootOf(el);
      if (handled.has(root)) return;
      var p = siteProfile();
      if (!triggers(el, p)) return;
      var n = knownCount(root, p);
      if (!n) return;
      if (n < 2 && hasPassword(root)) return; // a sign in box: leave it to the password manager
      handled.add(root);
      fill(root, p, el);
    });
  }, true);

  /* ---------- learning ---------- */
  var learnTimer = null, learnBatch = null;
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (!e.isTrusted || el.tagName !== "INPUT" || !SF.eligible(el) || inOwnUi(el)) return;
    var v = (el.value || "").trim();
    if (!v || v.length > 120) return;
    if (mine.has(el)) return; // a value we filled, or one you edited after we filled it: stays on this form
    ready.then(function () {
      if (paused()) return;
      var root = rootOf(el);
      if (fieldsIn(root).length < 2) return;
      var p = (sessions.get(root) || {}).p || siteProfile();
      if (p === "dummy") return;
      var key = SF.classify(el), label = SF.labelText(el), saved = null;
      if (key) {
        if (SF.value(data, key, p)) return;
        if (SF.FIELD[key].scope === "own") { data.profiles[p][key] = v; saved = { kind: "own", key: key, p: p, label: SF.FIELD[key].label }; }
        else { data.shared[key] = v; saved = { kind: "shared", key: key, label: SF.FIELD[key].label }; }
      } else {
        if (!SF.learnable(el)) return;
        var hit = SF.findCustom(data, label);
        if (hit && SF.customValue(data, hit, p)) return;
        var id = hit || "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        data.custom[id] = { label: label, tokens: SF.tokens(label), value: v, scope: "shared", from: host, at: new Date().toISOString() };
        saved = { kind: "custom", id: id, label: label };
      }
      persist();
      mine.set(el, v);
      queueLearned(saved, p, root);
    });
  }, true);
  function queueLearned(s, p, root) {
    if (!learnBatch) learnBatch = { p: p, root: root, items: [] };
    learnBatch.items.push(s);
    clearTimeout(learnTimer);
    learnTimer = setTimeout(function () { showLearned(learnBatch); learnBatch = null; }, 250);
  }
  function scopeText(b) {
    var allShared = b.items.every(function (s) { return s.kind !== "own"; });
    if (allShared) return "Saved to Work and Personal";
    return "Saved to " + SF.PNAME[b.p];
  }
  function showLearned(b) {
    var names = b.items.map(function (s) { return s.label; });
    var canNarrow = b.items.some(function (s) { return s.kind !== "own"; });
    var acts = [];
    if (canNarrow) acts.push({ label: "Only " + SF.PNAME[b.p], act: "narrow" });
    acts.push({ label: "Undo", act: "unlearn" });
    toast.show({ kind: "learned", title: "Remembered " + listText(names), sub: scopeText(b) + ". Any form that asks for it gets it.", actions: acts, batch: b, root: b.root, timeout: 9000 });
  }
  function unlearn(b) {
    b.items.forEach(function (s) {
      if (s.kind === "own") delete data.profiles[s.p][s.key];
      else if (s.kind === "shared") delete data.shared[s.key];
      else delete data.custom[s.id];
    });
    persist();
    toast.show({ kind: "muted", icon: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4.5 5H9.5a3.5 3.5 0 0 1 0 7H6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><path d="M7 2.25 4 5l3 2.75" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', title: "Not saved", sub: "It stays on this form only.", timeout: 4000 });
  }
  function narrow(b) {
    var p = b.p;
    b.items.forEach(function (s) {
      if (s.kind === "shared") {
        var v = data.shared[s.key]; delete data.shared[s.key];
        // A shared field kept to one profile is stored as a custom item with that scope.
        data.custom["k" + s.key] = { label: s.label, tokens: SF.tokens(s.label), value: v, scope: p, key: s.key, from: host, at: new Date().toISOString() };
      } else if (s.kind === "custom" && data.custom[s.id]) data.custom[s.id].scope = p;
    });
    persist();
    toast.show({ kind: "learned", title: "Kept to " + SF.PNAME[p], sub: SF.PNAME[p === "work" ? "personal" : "work"] + " will leave it empty.", timeout: 4000 });
  }

  /* ---------- messages from the popup and the shortcut ---------- */
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || !msg.type) return;
    ready.then(function () {
      if (msg.type === "sf-fill") {
        if (paused()) return;
        var a = document.activeElement, root = null;
        if (a && SF.eligible(a)) root = rootOf(a);
        if (!root) {
          var all = Array.prototype.slice.call(document.querySelectorAll("form"));
          all.push(document.body);
          root = all.filter(function (r) { return knownCount(r, siteProfile()); })[0] || null;
        }
        if (!root) return;
        handled.add(root);
        if (sessions.has(root)) undo(root, true);
        fill(root, msg.profile || siteProfile());
      } else if (msg.type === "sf-switch") {
        var last = Array.from(sessions.keys()).pop();
        if (last) switchTo(last, msg.profile);
      }
    });
  });

  /* ---------- the message box ---------- */
  var toast = (function () {
    var hostEl = null, root = null, box = null, state = null, timer = null, hovering = false;
    function fontLoad() {
      try {
        fetch(chrome.runtime.getURL("fonts/GeistPixel-Square.woff2")).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
          var f = new FontFace("Snapfill Pixel", buf); return f.load().then(function () { document.fonts.add(f); });
        }).catch(function () {});
      } catch (e) {}
    }
    function ensure() {
      if (hostEl && document.documentElement.contains(hostEl)) return;
      hostEl = document.createElement("div");
      hostEl.id = "snapfill-host";
      root = hostEl.attachShadow({ mode: "open" });
      root.innerHTML = "<style>" + CSS + "</style><div class=\"wrap\"></div>";
      box = root.querySelector(".wrap");
      document.documentElement.appendChild(hostEl);
      box.addEventListener("mouseenter", function () { hovering = true; clearTimeout(timer); });
      box.addEventListener("mouseleave", function () { hovering = false; arm(); });
      box.addEventListener("click", onClick);
      fontLoad();
    }
    function arm() {
      clearTimeout(timer);
      if (!state || hovering) return;
      timer = setTimeout(hide, state.timeout || 10000);
    }
    function hide() { if (box) box.innerHTML = ""; state = null; }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function show(s) {
      ensure(); state = s;
      var mark = s.icon || (s.kind === "learned" ? "&#931;" : (s.kind === "muted" ? "i" : "&#10003;"));
      var seg = s.seg ? '<div class="seg" role="group" aria-label="Fill as">' + SF.PROFILES.map(function (p) {
        return '<button type="button" data-act="switch" data-p="' + p + '" aria-pressed="' + (p === s.seg) + '">' + SF.PNAME[p] + "</button>";
      }).join("") + "</div>" : "";
      var acts = (s.actions || []).map(function (a) { return '<button type="button" class="ghost" data-act="' + a.act + '">' + esc(a.label) + "</button>"; }).join("");
      box.innerHTML = '<div class="toast ' + s.kind + '" role="status"><span class="ic">' + mark + '</span><div class="msg"><b>' + esc(s.title) + "</b>" + (s.sub ? "<span>" + esc(s.sub) + "</span>" : "") + "</div>" +
        seg + acts + '<button type="button" class="x" data-act="close" aria-label="Dismiss">&#215;</button></div>';
      arm();
    }
    function onClick(e) {
      var b = e.target.closest("[data-act]"); if (!b || !state) return;
      var act = b.getAttribute("data-act"), s = state;
      if (act === "close") hide();
      else if (act === "undo" && s.root) undo(s.root);
      else if (act === "switch" && s.root) switchTo(s.root, b.getAttribute("data-p"));
      else if (act === "unlearn" && s.batch) unlearn(s.batch);
      else if (act === "narrow" && s.batch) narrow(s.batch);
    }
    var CSS = [
      ":host{all:initial}",
      ".wrap{position:fixed;right:24px;bottom:24px;z-index:2147483647;font-family:'Snapfill Pixel',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:20px;color:#fff;-webkit-font-smoothing:antialiased}",
      ".toast{display:flex;align-items:center;gap:12px;max-width:min(640px,calc(100vw - 48px));padding:10px 8px 10px 12px;border-radius:12px;background:#303030;box-shadow:0 4px 6px -2px rgba(26,26,26,.2),0 0 0 1px rgba(0,0,0,.08),0 12px 24px rgba(0,0,0,.18);animation:up .22s ease-out;box-sizing:border-box}",
      ".ic,.msg{align-self:flex-start}",
      ".ic{margin-top:2px;width:20px;height:20px;flex:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#29845a;font-size:12px;line-height:1}",
      ".learned .ic{background:#8051ff}.muted .ic{background:#8a8a8a}",
      ".msg{display:flex;flex-direction:column;min-width:0;flex:1}",
      ".msg b{font-weight:400}",
      ".msg span{color:#b5b5b5;font-size:12px;line-height:16px}",
      ".seg{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:#4a4a4a;flex:none}",
      ".seg button{all:unset;cursor:pointer;height:24px;padding:0 10px;border-radius:6px;color:#e3e3e3;font-size:12px;line-height:24px}",
      ".seg button[aria-pressed=true]{background:#fff;color:#303030}",
      ".seg button:hover:not([aria-pressed=true]){background:#616161}",
      ".ghost{all:unset;cursor:pointer;flex:none;height:28px;padding:0 8px;border-radius:8px;color:#e3e3e3;font-size:12px;line-height:28px}",
      ".ghost:hover{background:#4a4a4a;color:#fff}",
      ".x{all:unset;cursor:pointer;flex:none;width:28px;height:28px;border-radius:8px;text-align:center;line-height:28px;color:#b5b5b5}",
      ".x:hover{background:#4a4a4a;color:#fff}",
      "button:focus-visible{outline:2px solid #4b9bff;outline-offset:1px}",
      "@keyframes up{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}",
      "@media (prefers-reduced-motion:reduce){.toast{animation:none}}",
      "@media (max-width:640px){.toast{flex-wrap:wrap}}"
    ].join("");
    return { show: show, hide: hide };
  })();
})();
