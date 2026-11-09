// Snapfill shared logic: data model, field matching, dummy data. Used by the content script and the popup.
var SF = (function () {
  "use strict";
  var STORE_KEY = "sf";

  // key, label, scope. "shared" fields belong to both Work and Personal; "own" fields are per profile.
  var FIELDS = [
    ["fullName", "Full name", "shared"],
    ["firstName", "First name", "shared"],
    ["lastName", "Last name", "shared"],
    ["dob", "Date of birth", "shared"],
    ["address1", "Address line 1", "shared"],
    ["address2", "Address line 2", "shared"],
    ["city", "City", "shared"],
    ["state", "State", "shared"],
    ["postal", "PIN or ZIP code", "shared"],
    ["country", "Country", "shared"],
    ["linkedin", "LinkedIn", "shared"],
    ["website", "Website", "shared"],
    ["github", "GitHub", "shared"],
    ["email", "Email", "own"],
    ["phone", "Phone", "own"],
    ["company", "Company", "own"],
    ["title", "Job title", "own"],
    ["department", "Department", "own"]
  ];
  var FIELD = {};
  FIELDS.forEach(function (f) { FIELD[f[0]] = { key: f[0], label: f[1], scope: f[2] }; });
  var PROFILES = ["work", "personal", "dummy"];
  var PNAME = { work: "Work", personal: "Personal", dummy: "Dummy" };

  function defaults() {
    return { v: 1, shared: {}, profiles: { work: {}, personal: {} }, custom: {}, def: "work", sites: {}, paused: {} };
  }
  function normalize(d) {
    var base = defaults();
    d = d && typeof d === "object" ? d : {};
    Object.keys(base).forEach(function (k) { if (d[k] === undefined) d[k] = base[k]; });
    if (!d.profiles.work) d.profiles.work = {};
    if (!d.profiles.personal) d.profiles.personal = {};
    return d;
  }
  function load() {
    return new Promise(function (res) { chrome.storage.local.get(STORE_KEY, function (r) { res(normalize(r && r[STORE_KEY])); }); });
  }
  function save(d) {
    return new Promise(function (res) { var o = {}; o[STORE_KEY] = d; chrome.storage.local.set(o, res); });
  }

  /* ---------- text helpers ---------- */
  function clean(t) {
    return String(t || "").replace(/[*:]+/g, " ").replace(/\(required\)|\brequired\b|\boptional\b/gi, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  }
  var STOP = { the: 1, your: 1, you: 1, a: 1, an: 1, of: 1, and: 1, or: 1, please: 1, enter: 1, our: 1, is: 1, to: 1, in: 1, for: 1, e: 1, g: 1, eg: 1 };
  function tokens(t) {
    return String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (w) { return w && !STOP[w]; });
  }
  function similarity(a, b) {
    if (!a.length || !b.length) return 0;
    var A = {}, n = 0; a.forEach(function (w) { A[w] = 1; });
    var B = {}; b.forEach(function (w) { B[w] = 1; });
    Object.keys(B).forEach(function (w) { if (A[w]) n++; });
    var u = Object.keys(A).length + Object.keys(B).length - n;
    return u ? n / u : 0;
  }

  /* ---------- field matching ---------- */
  var AUTOCOMPLETE = {
    "name": "fullName", "given-name": "firstName", "family-name": "lastName", "email": "email", "tel": "phone", "tel-national": "phone",
    "organization": "company", "organization-title": "title", "address-line1": "address1", "street-address": "address1", "address-line2": "address2",
    "address-level2": "city", "address-level1": "state", "postal-code": "postal", "country": "country", "country-name": "country", "bday": "dob", "url": "website"
  };
  var RULES = [
    ["email", /e-?mail/],
    ["linkedin", /linked\s?in/],
    ["github", /git\s?hub/],
    ["website", /web\s?site|portfolio|home\s?page|personal (site|url)|\bblog\b/],
    ["firstName", /first\s?name|given\s?name|\bfname\b|forename/],
    ["lastName", /last\s?name|sur\s?name|family\s?name|\blname\b/],
    ["dob", /birth|\bdob\b|b\s?day/],
    ["phone", /phone|mobile|\btel\b|telephone|\bcell\b|contact (no|num)|whats\s?app/],
    ["company", /company|organi[sz]ation|employer|business name|\bfirm\b|\borg\b|institution/],
    ["department", /department|\bdept\b/],
    ["title", /job\s?title|designation|position|job\s?role|\brole\b|\btitle\b/],
    ["address2", /address\s?(line)?\s?2|apartment|\bapt\b|suite|\bflat\b|\bunit\b/],
    ["address1", /address|street/],
    ["city", /\bcity\b|\btown\b/],
    ["state", /\bstate\b|province|county/],
    ["postal", /\bzip\b|postal|pin\s?code|post\s?code|\bpin\b/],
    ["country", /country/],
    ["fullName", /full\s?name|your name|^name$|\bname\b/]
  ];
  var NOT_PERSON_NAME = /user\s?name|company|organi|business|card|account|nick|file|domain|project|event|school|college|team|brand|store|shop|product|pet/;
  var SENSITIVE = /pass\s?(word|code)|\bpwd\b|\botp\b|one\s?time|captcha|\bcvv\b|\bcvc\b|card\s?(number|no)|credit|debit|\biban\b|\bssn\b|social security|\bpan\b|aadhaar|aadhar|passport|verification code|security code|\bpin number\b/;
  var IGNORE = /search|coupon|promo|voucher|gift|quantity|\bqty\b|amount|price|message|comment|subject|feedback|question|answer|description|\bnote|reason|captcha|referral code/;
  var TYPES = { "": 1, text: 1, email: 1, tel: 1, url: 1, number: 1, date: 1, month: 1 };

  function attrText(el) {
    return [el.getAttribute("name"), el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("data-testid")]
      .filter(Boolean).join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-\[\].]+/g, " ").toLowerCase();
  }
  function labelText(el) {
    var t = "";
    try { if (el.labels && el.labels.length) t = Array.prototype.map.call(el.labels, function (l) { return l.innerText || l.textContent; }).join(" "); } catch (e) {}
    if (!t && el.getAttribute("aria-labelledby")) {
      t = el.getAttribute("aria-labelledby").split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? n.textContent : ""; }).join(" ");
    }
    if (!t) t = el.getAttribute("aria-label") || "";
    if (!t) t = el.getAttribute("placeholder") || "";
    if (!t) {
      var p = el.parentElement;
      for (var i = 0; i < 3 && p && !t; i++) {
        var fields = p.querySelectorAll("input, select, textarea").length;
        var txt = (p.innerText || "").trim();
        if (fields === 1 && txt && txt.length <= 60) t = txt;
        p = p.parentElement;
      }
    }
    return clean(t);
  }
  function isSensitive(el) {
    var ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (/cc-|one-time-code|password/.test(ac)) return true;
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password") return true;
    return SENSITIVE.test((labelText(el) + " " + attrText(el)).toLowerCase());
  }
  function eligible(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName;
    if (tag === "INPUT") {
      var type = (el.getAttribute("type") || "").toLowerCase();
      if (!TYPES[type]) return false;
    } else if (tag !== "SELECT") return false;
    if (el.disabled || el.readOnly) return false;
    if (!el.getClientRects().length) return false;
    if (isSensitive(el)) return false;
    return true;
  }
  function classify(el) {
    var ac = (el.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/).pop();
    if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac];
    var lab = labelText(el).toLowerCase(), attrs = attrText(el);
    var hays = [lab, attrs];
    for (var h = 0; h < hays.length; h++) {
      var hay = hays[h]; if (!hay) continue;
      for (var i = 0; i < RULES.length; i++) {
        if (!RULES[i][1].test(hay)) continue;
        if (RULES[i][0] === "fullName" && NOT_PERSON_NAME.test(hay)) continue;
        return RULES[i][0];
      }
    }
    return null;
  }
  function learnable(el) {
    var lab = labelText(el);
    if (!lab || lab.length < 2) return false;
    return !IGNORE.test((lab + " " + attrText(el)).toLowerCase());
  }
  function findCustom(d, label) {
    var tk = tokens(label), best = null, score = 0;
    Object.keys(d.custom).forEach(function (id) {
      var c = d.custom[id], s = similarity(tk, c.tokens);
      if (clean(c.label).toLowerCase() === clean(label).toLowerCase()) s = 1;
      if (s > score) { score = s; best = id; }
    });
    return score >= 0.6 ? best : null;
  }

  /* ---------- values ---------- */
  function rawValue(d, key, p) {
    if (FIELD[key] && FIELD[key].scope === "own") return (d.profiles[p] || {})[key] || "";
    return d.shared[key] || "";
  }
  function value(d, key, p, dummy) {
    if (p === "dummy") return (dummy || {})[key] || "";
    var v = rawValue(d, key, p);
    if (v) return v;
    var ids = Object.keys(d.custom || {});
    for (var i = 0; i < ids.length; i++) {
      var c = d.custom[ids[i]];
      if (c.key === key && (c.scope === "shared" || c.scope === p)) return c.value;
    }
    var full = rawValue(d, "fullName", p);
    if (key === "firstName" && full) return full.split(/\s+/)[0];
    if (key === "lastName" && full && full.indexOf(" ") > 0) return full.split(/\s+/).slice(1).join(" ");
    if (key === "fullName") return [rawValue(d, "firstName", p), rawValue(d, "lastName", p)].filter(Boolean).join(" ");
    return "";
  }
  function customValue(d, id, p) {
    var c = d.custom[id]; if (!c) return "";
    if (p === "dummy") return "";
    if (c.scope === "shared" || c.scope === p) return c.value;
    return "";
  }

  /* ---------- dummy data ---------- */
  var FIRST = ["Alex", "Riya", "Sam", "Neha", "Jordan", "Arjun", "Maya", "Kiran", "Leo", "Tara"];
  var LAST = ["Morgan", "Kapoor", "Fernandes", "Iyer", "Lee", "Menon", "Shah", "Rao", "Dsouza", "Nair"];
  var COMPANIES = ["Acme Labs", "Bluebird Co", "Northpeak", "Lumen Works", "Cobalt Systems"];
  var TITLES = ["Analyst", "Coordinator", "Associate", "Consultant", "Specialist"];
  var PLACES = [["Pune", "Maharashtra", "411001"], ["Kochi", "Kerala", "682001"], ["Jaipur", "Rajasthan", "302001"], ["Mysuru", "Karnataka", "570001"]];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function makeDummy() {
    var f = pick(FIRST), l = pick(LAST), place = pick(PLACES), n = 1000 + Math.floor(Math.random() * 9000);
    return {
      fullName: f + " " + l, firstName: f, lastName: l, email: f.toLowerCase() + "." + l.toLowerCase() + "." + n + "@example.com",
      phone: "+91 90000 " + String(10000 + n).slice(-5), company: pick(COMPANIES), title: pick(TITLES), department: "Operations",
      dob: "1990-01-01", address1: n + " Main Road", address2: "", city: place[0], state: place[1], postal: place[2], country: "India",
      linkedin: "linkedin.com/in/" + f.toLowerCase() + "-demo-" + n, website: "example.com", github: "github.com/" + f.toLowerCase() + "-demo"
    };
  }

  /* ---------- dates ---------- */
  function formatDate(iso, el) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso;
    var type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "date") return iso;
    var hint = (labelText(el) + " " + attrText(el)).toLowerCase();
    if (/yyyy.?mm.?dd/.test(hint)) return iso;
    if (/mm.?dd/.test(hint)) return m[2] + "/" + m[3] + "/" + m[1];
    return m[3] + "/" + m[2] + "/" + m[1];
  }

  return {
    STORE_KEY: STORE_KEY, FIELDS: FIELDS, FIELD: FIELD, PROFILES: PROFILES, PNAME: PNAME,
    load: load, save: save, normalize: normalize, defaults: defaults,
    clean: clean, tokens: tokens, labelText: labelText, eligible: eligible, isSensitive: isSensitive, classify: classify, learnable: learnable,
    findCustom: findCustom, value: value, customValue: customValue, makeDummy: makeDummy, formatDate: formatDate
  };
})();
