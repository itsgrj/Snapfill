// Snapfill popup: site controls and the profile editor.
(function () {
  "use strict";
  var data, tabId = null, host = "", tab = "about", saveTimer = null;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var ABOUT = [["fullName"], ["firstName", "lastName"], ["dob"], ["address1"], ["address2"], ["city", "state"], ["postal", "country"], ["linkedin"], ["website", "github"]];
  var OWN = [["email"], ["phone"], ["company"], ["title"], ["department"]];
  var PLACEHOLDER = { email: "name@example.com", phone: "+91 98765 43210", linkedin: "linkedin.com/in/yourname", website: "yoursite.com", github: "github.com/yourname" };

  function persist() {
    SF.save(data).then(function () { $("saved").textContent = "Saved"; clearTimeout(saveTimer); saveTimer = setTimeout(function () { $("saved").textContent = ""; }, 1500); });
  }
  function isEmpty() {
    return !Object.keys(data.shared).some(function (k) { return data.shared[k]; }) &&
      !Object.keys(data.profiles.work).some(function (k) { return data.profiles.work[k]; }) && !Object.keys(data.custom).length;
  }

  /* site section */
  function renderSite() {
    var by = host ? SF.ignoredBy(data, host) : null, paused = !!by, cur = data.sites[host] || data.def;
    $("host").textContent = host || "This page";
    $("pause").setAttribute("aria-checked", String(!paused));
    $("site-on").hidden = paused; $("site-off").hidden = !paused;
    $("site-off").textContent = by && SF.siteKey(by) !== SF.siteKey(host) ? "Ignored, along with every " + SF.siteKey(by) + " site. Fields here stay empty." : "Ignored. Fields on this site stay empty.";
    $("site-prof").innerHTML = SF.PROFILES.map(function (p) { return '<button type="button" data-p="' + p + '" aria-pressed="' + (p === cur) + '">' + SF.PNAME[p] + "</button>"; }).join("");
    $("def").value = data.def;
    $("setup").hidden = !isEmpty();
    if (!host) $("site-sec").hidden = true;
  }

  /* editor */
  function input(key, scope) {
    var f = SF.FIELD[key], id = "in-" + scope + "-" + key;
    var v = scope === "shared" ? data.shared[key] : (data.profiles[scope] || {})[key];
    var type = key === "dob" ? "date" : (key === "email" ? "email" : (key === "phone" ? "tel" : "text"));
    return '<div class="f"><label for="' + id + '">' + f.label + '</label><input id="' + id + '" type="' + type + '" data-key="' + key + '" data-scope="' + scope + '" value="' + esc(v || "") +
      '" placeholder="' + esc(PLACEHOLDER[key] || "") + '" autocomplete="off"></div>';
  }
  function rows(list, scope) {
    return list.map(function (r) { return r.length === 2 ? '<div class="pair">' + input(r[0], scope) + input(r[1], scope) + "</div>" : input(r[0], scope); }).join("");
  }
  function renderPanel() {
    document.querySelectorAll(".tabs button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === tab)); });
    var h = "";
    if (tab === "about") h = '<p class="hint">Used by both Work and Personal.</p>' + rows(ABOUT, "shared");
    else if (tab === "work" || tab === "personal") h = '<p class="hint">Only used when filling as ' + SF.PNAME[tab] + ".</p>" + rows(OWN, tab);
    else if (tab === "ignored") h = ignoredPanel();
    else {
      var ids = Object.keys(data.custom);
      if (!ids.length) h = '<p class="hint">Nothing learned yet. When you type something on a form that is not saved here, it shows up in this list.</p>';
      else h = ids.sort(function (a, b) { return (data.custom[b].at || "").localeCompare(data.custom[a].at || ""); }).map(function (id) {
        var c = data.custom[id], scope = c.scope === "shared" ? "Work and Personal" : SF.PNAME[c.scope] + " only";
        var when = c.at ? new Date(c.at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
        return '<div class="lr"><span class="l">' + esc(c.label) + ' <span class="badge' + (c.scope === "shared" ? "" : " gray") + '">' + scope + '</span></span><button class="x" type="button" data-del="' + id + '" aria-label="Forget ' + esc(c.label) + '">&#215;</button>' +
          '<input type="text" data-custom="' + id + '" value="' + esc(c.value) + '" aria-label="' + esc(c.label) + '">' + (c.from ? '<span class="src">From ' + esc(c.from) + (when ? ", " + when : "") + "</span>" : "") + "</div>";
      }).join("");
    }
    $("panel").innerHTML = h;
  }

  function ignoredPanel() {
    var keys = Object.keys(data.paused).filter(function (k) { return data.paused[k]; }).sort(function (a, b) {
      var ea = data.paused[a], eb = data.paused[b];
      return ((eb && eb.at) || "").localeCompare((ea && ea.at) || "") || a.localeCompare(b);
    });
    var list = keys.length ? keys.map(function (k) {
      var e = data.paused[k] === true ? {} : data.paused[k], d = SF.siteKey(k);
      var note = (e.sub ? "And every subdomain. " : "") + (e.how === "added" ? "Added by you" : "Turned off from this site");
      return '<div class="site"><span class="fav">' + esc(d.charAt(0)) + '</span><div class="t"><span class="d">' + esc(d) + '</span><span class="muted small">' + esc(note) + '</span></div>' +
        '<button class="x" type="button" data-unignore="' + esc(k) + '" aria-label="Stop ignoring ' + esc(d) + '">&#215;</button></div>';
    }).join("") : '<p class="hint">No ignored sites. Snapfill fills everywhere you click.</p>';
    return '<form class="row" id="ig-form" novalidate><input class="ig-in grow" id="ig-in" placeholder="Add a site, like mybank.com" aria-label="Site to ignore" aria-describedby="ig-err" autocomplete="off" spellcheck="false">' +
      '<button class="btn primary" type="submit">Ignore</button></form>' +
      '<p class="err" id="ig-err" hidden>Type a site like mybank.com</p>' +
      '<label class="chk"><input type="checkbox" id="ig-sub"' + (subPref ? " checked" : "") + '> Include every subdomain, like mail. and app.</label>' +
      '<div class="sites">' + list + "</div>" +
      (keys.length ? '<p class="muted small count">' + keys.length + " site" + (keys.length === 1 ? "" : "s") + " ignored</p>" : "");
  }
  var subPref = true;

  /* events */
  document.querySelector(".tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; tab = b.getAttribute("data-tab"); renderPanel(); });
  $("panel").addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "ig-in") { $("ig-err").hidden = true; t.removeAttribute("aria-invalid"); return; }
    if (t.hasAttribute("data-key")) {
      var k = t.getAttribute("data-key"), s = t.getAttribute("data-scope"), v = t.value.trim();
      if (s === "shared") { if (v) data.shared[k] = v; else delete data.shared[k]; }
      else { if (v) data.profiles[s][k] = v; else delete data.profiles[s][k]; }
    } else if (t.hasAttribute("data-custom")) {
      var c = data.custom[t.getAttribute("data-custom")]; if (c) c.value = t.value;
    }
    persist(); $("setup").hidden = !isEmpty();
  });
  $("panel").addEventListener("submit", function (e) {
    if (e.target.id !== "ig-form") return;
    e.preventDefault();
    var d = SF.cleanSite($("ig-in").value);
    if (!SF.validSite(d)) { $("ig-err").hidden = false; $("ig-in").setAttribute("aria-invalid", "true"); $("ig-in").focus(); return; }
    var old = Object.keys(data.paused).filter(function (k) { return SF.siteKey(k) === d; });
    old.forEach(function (k) { delete data.paused[k]; });
    data.paused[d] = { sub: $("ig-sub").checked, how: "added", at: new Date().toISOString() };
    persist(); renderPanel(); renderSite(); $("ig-in").focus();
  });
  $("panel").addEventListener("change", function (e) { if (e.target.id === "ig-sub") subPref = e.target.checked; });
  $("panel").addEventListener("click", function (e) {
    var u = e.target.closest("[data-unignore]");
    if (u) { delete data.paused[u.getAttribute("data-unignore")]; persist(); renderPanel(); renderSite(); return; }
    var b = e.target.closest("[data-del]"); if (!b) return;
    delete data.custom[b.getAttribute("data-del")]; persist(); renderPanel();
  });
  $("pause").addEventListener("click", function () {
    var by = SF.ignoredBy(data, host);
    if (by) delete data.paused[by]; else data.paused[SF.siteKey(host)] = { sub: false, how: "switch", at: new Date().toISOString() };
    persist(); renderSite(); if (tab === "ignored") renderPanel();
  });
  $("site-prof").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var p = b.getAttribute("data-p");
    data.sites[host] = p; persist(); renderSite();
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: "sf-switch", profile: p }).catch(function () {});
  });
  $("fill").addEventListener("click", function () {
    if (tabId == null) return;
    chrome.tabs.sendMessage(tabId, { type: "sf-fill" }).catch(function () {});
    window.close();
  });
  $("def").addEventListener("change", function () { data.def = this.value; persist(); renderSite(); });

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var t = tabs && tabs[0];
    if (t) { tabId = t.id; try { var u = new URL(t.url); if (/^https?:|^file:/.test(u.protocol)) host = u.hostname || "this file"; } catch (e) {} }
    SF.load().then(function (d) { data = d; renderSite(); renderPanel(); });
  });
})();
