/* SQL Roadmap — shared client logic (no build step, no dependencies) */
(function () {
  "use strict";
  var CFG = window.SQL_ROADMAP || {};
  var API = (CFG.apiUrl || "").trim();
  var LS = { student: "sqlr.student", solved: "sqlr.solved", queue: "sqlr.queue" };

  /* ---------- storage (never throws: private mode / blocked cookies) ------ */
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  var store = {
    student: function () { return read(LS.student, null); },
    setStudent: function (s) { write(LS.student, s); },
    signOut: function () { try { localStorage.removeItem(LS.student); localStorage.removeItem(LS.solved); } catch (e) {} },
    solved: function () { return read(LS.solved, {}); },
    setSolved: function (map) { write(LS.solved, map); },
    queue: function () { return read(LS.queue, []); },
    setQueue: function (q) { write(LS.queue, q); }
  };

  /* ---------- api -------------------------------------------------------- */
  var online = !!API;

  // POST as text/plain so the browser sends no CORS preflight — Apps Script
  // web apps cannot answer an OPTIONS request.
  function post(action, payload) {
    if (!online) return Promise.resolve({ ok: false, offline: true });
    var body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body,
      redirect: "follow"
    }).then(function (r) { return r.json(); });
  }

  function get(action, params) {
    if (!online) return Promise.resolve({ ok: false, offline: true });
    var q = new URLSearchParams(Object.assign({ action: action }, params || {}));
    return fetch(API + "?" + q.toString(), { redirect: "follow" })
      .then(function (r) { return r.json(); });
  }

  /* ---------- offline write queue ---------------------------------------- */
  function enqueue(action, payload) {
    var q = store.queue();
    q.push({ action: action, payload: payload, at: Date.now() });
    if (q.length > 600) q = q.slice(-600);
    store.setQueue(q);
  }

  function flushQueue() {
    var q = store.queue();
    if (!online || !q.length) return Promise.resolve(0);
    var s = store.student();
    if (!s) return Promise.resolve(0);
    return post("sync", { github: s.github, solved: store.solved(), student: s })
      .then(function (res) {
        if (res && res.ok) { store.setQueue([]); return q.length; }
        return 0;
      })
      .catch(function () { return 0; });
  }

  /* ---------- data ------------------------------------------------------- */
  var roadmapPromise = null;
  function roadmap() {
    if (!roadmapPromise) {
      roadmapPromise = fetch("data/roadmap.json").then(function (r) {
        if (!r.ok) throw new Error("Could not load the roadmap data file.");
        return r.json();
      });
    }
    return roadmapPromise;
  }

  /* ---------- helpers ---------------------------------------------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + "-W" + (week < 10 ? "0" + week : week);
  }

  function points(p) {
    var table = CFG.points || { Easy: 10, Medium: 20, Hard: 30 };
    return table[p.d] || table.Easy || 10;
  }

  function nav(current) {
    var s = store.student();
    var links = [["index.html", "Home"], ["roadmap.html", "Roadmap"], ["leaderboard.html", "Leaderboard"]];
    return '<a class="skip" href="#main">Skip to content</a>' +
      '<nav class="nav"><div class="nav-in">' +
      '<a class="brand" href="index.html"><span class="mark">SQL</span> Roadmap</a>' +
      '<div class="nav-links">' +
      links.map(function (l) {
        return '<a href="' + l[0] + '"' + (l[0] === current ? ' aria-current="page"' : "") + ">" + l[1] + "</a>";
      }).join("") +
      (s ? '<span class="whoami" title="Signed in on this device">@' + esc(s.github) + "</span>" : "") +
      "</div></div></nav>";
  }

  function mountNav(current) {
    var el = document.getElementById("nav");
    if (el) el.outerHTML = nav(current);
  }

  window.SQLR = {
    cfg: CFG, online: online, store: store, post: post, get: get,
    enqueue: enqueue, flushQueue: flushQueue, roadmap: roadmap,
    esc: esc, isoWeek: isoWeek, points: points, mountNav: mountNav
  };
})();
