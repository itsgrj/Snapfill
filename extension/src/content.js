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
      var mark = s.icon || (s.kind === "learned" ? LOGO : (s.kind === "muted" ? "i" : "&#10003;"));
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
    // The Snapfill icon, drawn inline so no page can block it from loading.
    var LOGO = '<svg viewBox="0 0 128 128" width="20" height="20" aria-hidden="true"><defs><linearGradient id="sfi-bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="128"><stop offset="0" stop-color="#ffb21a"/><stop offset="1" stop-color="#ff3b0f"/></linearGradient><clipPath id="sfi-clip"><path d="M124.00,64.00 L123.95,84.16 L123.79,90.57 L123.54,95.21 L123.17,98.94 L122.71,102.11 L122.13,104.86 L121.44,107.29 L120.65,109.47 L119.73,111.43 L118.69,113.20 L117.53,114.79 L116.23,116.23 L114.79,117.53 L113.20,118.69 L111.43,119.73 L109.47,120.65 L107.29,121.44 L104.86,122.13 L102.11,122.71 L98.94,123.17 L95.21,123.54 L90.57,123.79 L84.16,123.95 L64.00,124.00 L43.84,123.95 L37.43,123.79 L32.79,123.54 L29.06,123.17 L25.89,122.71 L23.14,122.13 L20.71,121.44 L18.53,120.65 L16.57,119.73 L14.80,118.69 L13.21,117.53 L11.77,116.23 L10.47,114.79 L9.31,113.20 L8.27,111.43 L7.35,109.47 L6.56,107.29 L5.87,104.86 L5.29,102.11 L4.83,98.94 L4.46,95.21 L4.21,90.57 L4.05,84.16 L4.00,64.00 L4.05,43.84 L4.21,37.43 L4.46,32.79 L4.83,29.06 L5.29,25.89 L5.87,23.14 L6.56,20.71 L7.35,18.53 L8.27,16.57 L9.31,14.80 L10.47,13.21 L11.77,11.77 L13.21,10.47 L14.80,9.31 L16.57,8.27 L18.53,7.35 L20.71,6.56 L23.14,5.87 L25.89,5.29 L29.06,4.83 L32.79,4.46 L37.43,4.21 L43.84,4.05 L64.00,4.00 L84.16,4.05 L90.57,4.21 L95.21,4.46 L98.94,4.83 L102.11,5.29 L104.86,5.87 L107.29,6.56 L109.47,7.35 L111.43,8.27 L113.20,9.31 L114.79,10.47 L116.23,11.77 L117.53,13.21 L118.69,14.80 L119.73,16.57 L120.65,18.53 L121.44,20.71 L122.13,23.14 L122.71,25.89 L123.17,29.06 L123.54,32.79 L123.79,37.43 L123.95,43.84 Z"/></clipPath><filter id="sfi-sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#8a1c00" flood-opacity=".45"/></filter></defs><path d="M124.00,64.00 L123.95,84.16 L123.79,90.57 L123.54,95.21 L123.17,98.94 L122.71,102.11 L122.13,104.86 L121.44,107.29 L120.65,109.47 L119.73,111.43 L118.69,113.20 L117.53,114.79 L116.23,116.23 L114.79,117.53 L113.20,118.69 L111.43,119.73 L109.47,120.65 L107.29,121.44 L104.86,122.13 L102.11,122.71 L98.94,123.17 L95.21,123.54 L90.57,123.79 L84.16,123.95 L64.00,124.00 L43.84,123.95 L37.43,123.79 L32.79,123.54 L29.06,123.17 L25.89,122.71 L23.14,122.13 L20.71,121.44 L18.53,120.65 L16.57,119.73 L14.80,118.69 L13.21,117.53 L11.77,116.23 L10.47,114.79 L9.31,113.20 L8.27,111.43 L7.35,109.47 L6.56,107.29 L5.87,104.86 L5.29,102.11 L4.83,98.94 L4.46,95.21 L4.21,90.57 L4.05,84.16 L4.00,64.00 L4.05,43.84 L4.21,37.43 L4.46,32.79 L4.83,29.06 L5.29,25.89 L5.87,23.14 L6.56,20.71 L7.35,18.53 L8.27,16.57 L9.31,14.80 L10.47,13.21 L11.77,11.77 L13.21,10.47 L14.80,9.31 L16.57,8.27 L18.53,7.35 L20.71,6.56 L23.14,5.87 L25.89,5.29 L29.06,4.83 L32.79,4.46 L37.43,4.21 L43.84,4.05 L64.00,4.00 L84.16,4.05 L90.57,4.21 L95.21,4.46 L98.94,4.83 L102.11,5.29 L104.86,5.87 L107.29,6.56 L109.47,7.35 L111.43,8.27 L113.20,9.31 L114.79,10.47 L116.23,11.77 L117.53,13.21 L118.69,14.80 L119.73,16.57 L120.65,18.53 L121.44,20.71 L122.13,23.14 L122.71,25.89 L123.17,29.06 L123.54,32.79 L123.79,37.43 L123.95,43.84 Z" fill="url(#sfi-bg)"/><g transform="rotate(38 64 64)" filter="url(#sfi-sh)"><path d="M44 34 Q44 20 57 18 L71 18 Q84 20 84 34 L84 58 Q84 82 64 112 Q44 82 44 58 Z" fill="#ffffff"/><polygon points="70,14 36,70 60,70 50,114 94,54 70,54 86,14" fill="url(#sfi-bg)" transform="translate(64 66) scale(.3) translate(-65 -64)"/><rect x="62" y="84" width="4" height="22" rx="2" fill="#ff5a1f"/></g><defs><linearGradient id="sfi-hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="M122.50,64.00 L122.45,83.65 L122.30,89.91 L122.05,94.43 L121.69,98.07 L121.24,101.15 L120.68,103.84 L120.01,106.21 L119.23,108.33 L118.34,110.24 L117.33,111.97 L116.19,113.52 L114.93,114.93 L113.52,116.19 L111.97,117.33 L110.24,118.34 L108.33,119.23 L106.21,120.01 L103.84,120.68 L101.15,121.24 L98.07,121.69 L94.43,122.05 L89.91,122.30 L83.65,122.45 L64.00,122.50 L44.35,122.45 L38.09,122.30 L33.57,122.05 L29.93,121.69 L26.85,121.24 L24.16,120.68 L21.79,120.01 L19.67,119.23 L17.76,118.34 L16.03,117.33 L14.48,116.19 L13.07,114.93 L11.81,113.52 L10.67,111.97 L9.66,110.24 L8.77,108.33 L7.99,106.21 L7.32,103.84 L6.76,101.15 L6.31,98.07 L5.95,94.43 L5.70,89.91 L5.55,83.65 L5.50,64.00 L5.55,44.35 L5.70,38.09 L5.95,33.57 L6.31,29.93 L6.76,26.85 L7.32,24.16 L7.99,21.79 L8.77,19.67 L9.66,17.76 L10.67,16.03 L11.81,14.48 L13.07,13.07 L14.48,11.81 L16.03,10.67 L17.76,9.66 L19.67,8.77 L21.79,7.99 L24.16,7.32 L26.85,6.76 L29.93,6.31 L33.57,5.95 L38.09,5.70 L44.35,5.55 L64.00,5.50 L83.65,5.55 L89.91,5.70 L94.43,5.95 L98.07,6.31 L101.15,6.76 L103.84,7.32 L106.21,7.99 L108.33,8.77 L110.24,9.66 L111.97,10.67 L113.52,11.81 L114.93,13.07 L116.19,14.48 L117.33,16.03 L118.34,17.76 L119.23,19.67 L120.01,21.79 L120.68,24.16 L121.24,26.85 L121.69,29.93 L122.05,33.57 L122.30,38.09 L122.45,44.35 Z" fill="none" stroke="url(#sfi-hl)" stroke-width="3"/></svg>';
    var CSS = [
      ":host{all:initial}",
      ".wrap{position:fixed;right:24px;bottom:24px;z-index:2147483647;font-family:'Snapfill Pixel',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:20px;color:#fff;-webkit-font-smoothing:antialiased}",
      ".toast{display:flex;align-items:center;gap:12px;max-width:min(640px,calc(100vw - 48px));padding:10px 8px 10px 12px;border-radius:12px;background:#303030;box-shadow:0 4px 6px -2px rgba(26,26,26,.2),0 0 0 1px rgba(0,0,0,.08),0 12px 24px rgba(0,0,0,.18);animation:up .22s ease-out;box-sizing:border-box}",
      ".ic,.msg{align-self:flex-start}",
      ".ic{margin-top:2px;width:20px;height:20px;flex:none;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#29845a;font-size:12px;line-height:1}",
      ".learned .ic{background:none;border-radius:0}.learned .ic svg{display:block}.muted .ic{background:#8a8a8a}",
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
