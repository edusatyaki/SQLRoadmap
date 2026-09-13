/**
 * SQL Roadmap — Google Apps Script backend
 * ----------------------------------------
 * Deploy as: Web app · Execute as "Me" · Who has access "Anyone".
 * Copy the /exec URL into assets/config.js of the website.
 *
 * Sheets used (run setup() once and they are created for you):
 *   Students  github | name | enrollment | section | leetcode | hackerrank | codeforces |
 *             joined | lastSeen
 *   Progress  github | problemId | title | chapter | platform | difficulty | points |
 *             solvedAt | solved | verified | verifiedAt | source
 */

// Leave blank when this script lives inside the spreadsheet (Extensions ▸ Apps Script).
// Otherwise paste the spreadsheet ID from its URL.
var SHEET_ID = "";

var STUDENTS = "Students";
var PROGRESS = "Progress";
var STUDENT_COLS = ["github", "name", "enrollment", "section", "leetcode", "hackerrank",
                    "codeforces", "joined", "lastSeen"];
var PROGRESS_COLS = ["github", "problemId", "title", "chapter", "platform", "difficulty",
                     "points", "solvedAt", "solved", "verified", "verifiedAt", "source"];

/* ------------------------------------------------------------------ setup */

function book() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet(name, cols) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(cols);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, cols.length).setFontWeight("bold");
  }
  return sh;
}

/** Run this once from the editor to create the sheets. */
function setup() {
  sheet(STUDENTS, STUDENT_COLS);
  sheet(PROGRESS, PROGRESS_COLS);
  return "Sheets ready in: " + book().getUrl();
}

/* ----------------------------------------------------------------- routing */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "ping";
  try {
    if (action === "leaderboard") return json(leaderboard());
    if (action === "student") return json(studentProgress(e.parameter.github));
    if (action === "verify") return json(verifyStudent(e.parameter.github));
    if (action === "status") return json(status());
    return json({ ok: true, service: "SQL Roadmap", time: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, error: "Body was not valid JSON." }); }

  try {
    return withLock(function () {
      if (body.action === "register") return json(register(body.student));
      if (body.action === "solve") return json(solve(body));
      if (body.action === "sync") return json(sync(body));
      return json({ ok: false, error: "Unknown action: " + body.action });
    });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* -------------------------------------------------------------- utilities */

function rows(sh) {
  var values = sh.getDataRange().getValues();
  values.shift();                       // header
  return values;
}

function key(github) {
  return String(github || "").trim().toLowerCase();
}

/**
 * Every write to Progress is a read-modify-write: look the row up, then set or
 * append it. Two that overlap both decide the row is missing and both append
 * it, and one problem ends up as two rows worth double the points. The
 * half-hourly sweep and a student pressing "Check my submissions" overlap
 * exactly like that, which is where the duplicates in the sheet came from.
 * Nested calls reuse the lock this execution already holds.
 */
var HELD_LOCK = null;
function withLock(fn) {
  if (HELD_LOCK) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  HELD_LOCK = lock;
  try { return fn(); }
  finally { HELD_LOCK = null; try { lock.releaseLock(); } catch (ignore) {} }
}

/** Monday 00:00 of the week containing `d`, in the script's timezone. */
function weekStart(d) {
  var x = new Date(d);
  var day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function asDate(v) {
  if (!v) return null;
  var d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------- registration */

function register(student) {
  if (!student || !key(student.github)) return { ok: false, error: "A GitHub username is required." };
  if (!student.leetcode) return { ok: false, error: "A LeetCode username is required." };
  if (!student.hackerrank) return { ok: false, error: "A HackerRank username is required." };
  if (leetcodeProfile(student.leetcode) === null) {
    return { ok: false, leetcodeUnknown: true,
             error: "LeetCode has no profile called " + student.leetcode + "." };
  }
  if (hackerrankProfile(student.hackerrank) === null) {
    return { ok: false, hackerrankUnknown: true,
             error: "HackerRank has no profile called " + student.hackerrank + "." };
  }
  var sh = sheet(STUDENTS, STUDENT_COLS);
  var data = rows(sh);
  var gh = key(student.github);
  var now = new Date();

  for (var i = 0; i < data.length; i++) {
    if (key(data[i][0]) === gh) {                       // returning student
      sh.getRange(i + 2, 2, 1, 6).setValues([[
        student.name || data[i][1],
        student.enrollment || data[i][2],
        student.section || data[i][3],
        student.leetcode || data[i][4],
        student.hackerrank || data[i][5],
        student.codeforces || data[i][6]
      ]]);
      sh.getRange(i + 2, 9).setValue(now);
      return { ok: true, returning: true, student: { solved: solvedMap(gh) } };
    }
  }

  sh.appendRow([student.github, student.name || "", student.enrollment || "",
                student.section || "", student.leetcode || "", student.hackerrank || "",
                student.codeforces || "", now, now]);
  return { ok: true, returning: false, student: { solved: {} } };
}

/* ------------------------------------------------------------------ solves */

function progressIndex() {
  var sh = sheet(PROGRESS, PROGRESS_COLS);
  var data = rows(sh);
  var idx = {};
  for (var i = 0; i < data.length; i++) {
    idx[key(data[i][0]) + "|" + data[i][1]] = i + 2;    // sheet row number
  }
  return { sh: sh, data: data, idx: idx };
}

function solve(b) {
  var gh = key(b.github);
  if (!gh || !b.problemId) return { ok: false, error: "github and problemId are required." };
  var p = progressIndex();
  var at = asDate(b.at) || new Date();
  var existing = p.idx[gh + "|" + b.problemId];
  var prev = existing ? p.data[existing - 2] : null;
  // A hand-tick must never clear a verification the platform already granted,
  // nor move the date the platform recorded — that date decides which week the
  // solve counts in, and the tick can come days later.
  if (prev && prev[9] === true && asDate(prev[7])) at = asDate(prev[7]);
  // Reading the roadmap costs a fetch, and a tick from the site already carries
  // everything, so only look when the caller actually left something out.
  var meta, looked = false;
  function fromRoadmap(field) {
    if (!looked) { looked = true; meta = roadmapById()[b.problemId] || null; }
    return meta ? (meta[field] || "") : "";
  }
  function keepOr(sent, col, field) {
    return sent || (prev ? prev[col] : "") || fromRoadmap(field);
  }
  var pts = Number(b.points) || 0;
  if (!pts) pts = Number(fromRoadmap("pts")) || 0;
  var row = [b.github, b.problemId,
             keepOr(b.title, 2, "n"),
             keepOr(b.chapter, 3, "ch"),
             keepOr(b.platform, 4, "p"),
             keepOr(b.difficulty, 5, "d"),
             pts, at, b.solved !== false,
             prev ? prev[9] : "", prev ? prev[10] : "", prev ? prev[11] : ""];
  if (existing) p.sh.getRange(existing, 1, 1, PROGRESS_COLS.length).setValues([row]);
  else p.sh.appendRow(row);
  touch(gh);
  return { ok: true };
}

function sync(b) {
  var gh = key(b.github);
  if (!gh) return { ok: false, error: "github is required." };
  if (b.student) register(b.student);
  var solved = b.solved || {};
  var p = progressIndex();
  var byId = roadmapById();
  var appends = [];
  Object.keys(solved).forEach(function (id) {
    var at = asDate(solved[id]) || new Date();
    var existing = p.idx[gh + "|" + id];
    // The queue only carries problem ids, so take the title and — the part that
    // decides the score — the points from the roadmap. Rows written without
    // them counted as zero on the leaderboard.
    var meta = byId[id] || null;
    if (existing) {
      var prev = p.data[existing - 2];
      if (prev && prev[9] === true && asDate(prev[7])) at = asDate(prev[7]);
      p.sh.getRange(existing, 8, 1, 2).setValues([[at, true]]);
      if (meta && prev && !(Number(prev[6]) || 0)) {
        p.sh.getRange(existing, 3, 1, 5)
            .setValues([[meta.n, meta.ch, meta.p, meta.d || "", Number(meta.pts) || 0]]);
      }
    } else {
      appends.push([b.github, id,
                    meta ? meta.n : "", meta ? meta.ch : "", meta ? meta.p : "",
                    meta ? (meta.d || "") : "", meta ? Number(meta.pts) || 0 : 0,
                    at, true, "", "", ""]);
    }
  });
  if (appends.length) {
    p.sh.getRange(p.sh.getLastRow() + 1, 1, appends.length, PROGRESS_COLS.length).setValues(appends);
  }
  touch(gh);
  return { ok: true, written: Object.keys(solved).length };
}

function touch(gh) {
  var sh = sheet(STUDENTS, STUDENT_COLS);
  var data = rows(sh);
  for (var i = 0; i < data.length; i++) {
    if (key(data[i][0]) === gh) { sh.getRange(i + 2, 9).setValue(new Date()); return; }
  }
}

function solvedMap(gh) {
  var data = rows(sheet(PROGRESS, PROGRESS_COLS));
  var out = {};
  for (var i = 0; i < data.length; i++) {
    if (key(data[i][0]) !== gh || data[i][8] === false) continue;
    var d = asDate(data[i][7]);
    out[data[i][1]] = d ? d.toISOString() : new Date().toISOString();
  }
  return out;
}

function studentProgress(github) {
  var gh = key(github);
  if (!gh) return { ok: false, error: "github is required." };
  return { ok: true, solved: solvedMap(gh), verified: verifiedMap(gh) };
}

/**
 * Merges a duplicate pair into the row to keep. `b` is the later of the two,
 * and so the one progressIndex() addresses and every later write has been
 * landing on; it wins unless the earlier row knows something it does not.
 */
function mergeRows(a, b) {
  var out = b.slice();
  if (a[9] === true && out[9] !== true) {          // only a platform grants one
    out[9] = a[9]; out[10] = a[10]; out[11] = a[11];
  }
  if (!(Number(out[6]) || 0)) out[6] = Number(a[6]) || 0;
  [2, 3, 4, 5].forEach(function (i) { if (!out[i] && a[i]) out[i] = a[i]; });
  var da = asDate(a[7]), db = asDate(out[7]);
  if (da && (!db || da < db)) out[7] = a[7];       // the earlier date is when
  return out;                                     // the work was actually done
}

/**
 * Progress is meant to hold one row per student per problem. Duplicates got in
 * before the writes were locked, and counting both inflates a student's total,
 * so fold them together before anything adds points up. Also fills in what the
 * roadmap knows about rows that were written without it — sync() wrote rows
 * carrying no points at all, and those score zero.
 *
 * Returns the kept rows in sheet order and how many were duplicates.
 */
function collapse(progress) {
  var keep = {}, order = [], dupes = 0;
  progress.forEach(function (r) {
    var gh = key(r[0]);
    if (!gh || !r[1]) return;
    var k = gh + "|" + r[1];
    if (keep[k]) { dupes++; keep[k] = mergeRows(keep[k], r); }
    else { keep[k] = r.slice(); order.push(k); }
  });

  // Same again: a healthy sheet needs no roadmap lookup at all, and this runs
  // on every leaderboard load.
  var byId = null;
  var out = order.map(function (k) {
    var r = keep[k];
    // What a platform confirmed is solved, whatever the checkbox says.
    if (r[9] === true) r[8] = true;
    if (!(Number(r[6]) || 0)) {
      if (!byId) byId = roadmapById();
      var p = byId[r[1]];
      if (!p) return r;
      r[6] = Number(p.pts) || 0;
      if (!r[2]) r[2] = p.n;
      if (!r[3]) r[3] = p.ch;
      if (!r[4]) r[4] = p.p;
      if (!r[5]) r[5] = p.d || "";
    }
    return r;
  });
  return { rows: out, duplicates: dupes };
}

/* ------------------------------------------------------------- leaderboard */

function leaderboard() {
  var students = rows(sheet(STUDENTS, STUDENT_COLS));
  var progress = collapse(rows(sheet(PROGRESS, PROGRESS_COLS))).rows;
  var thisWeek = weekStart(new Date());
  var lastWeek = new Date(thisWeek); lastWeek.setDate(lastWeek.getDate() - 7);

  var acc = {};
  students.forEach(function (s) {
    if (!key(s[0])) return;
    acc[key(s[0])] = {
      name: s[1] || s[0], github: s[0], enrollment: s[2] || "", section: s[3] || "",
      leetcode: s[4] || "", hackerrank: s[5] || "", codeforces: s[6] || "",
      points: 0, weekPoints: 0, lastWeekPoints: 0, priorPoints: 0,
      verifiedPoints: 0, verifiedSolved: 0,
      weekVerified: 0, lastWeekVerified: 0, priorVerified: 0,
      solved: 0, weekSolved: 0, lastSolve: null
    };
  });

  progress.forEach(function (r) {
    var a = acc[key(r[0])];
    if (!a || r[8] === false) return;
    var at = asDate(r[7]);
    var pts = Number(r[6]) || 0;
    var confirmed = r[9] === true;
    a.points += pts;
    a.solved += 1;
    if (confirmed) { a.verifiedPoints += pts; a.verifiedSolved += 1; }
    // Ranking is on confirmed solves, so every bucket the ranks are drawn from
    // needs its own confirmed count, not just its points.
    if (!at) {
      a.priorPoints += pts;
      if (confirmed) a.priorVerified += 1;
      return;
    }
    if (at >= thisWeek) {
      a.weekPoints += pts;
      a.weekSolved += 1;
      if (confirmed) a.weekVerified += 1;
    } else {
      a.priorPoints += pts;
      if (confirmed) a.priorVerified += 1;
      if (at >= lastWeek) {
        a.lastWeekPoints += pts;
        if (confirmed) a.lastWeekVerified += 1;
      }
    }
    var iso = at.toISOString();
    if (!a.lastSolve || iso > a.lastSolve) a.lastSolve = iso;
  });

  var list = Object.keys(acc).map(function (k) { return acc[k]; });

  // Rank each student on four scales so the site can draw ▲ / ▼ for either view:
  //   all-time now vs all-time at the end of last week,
  //   this week vs last week.
  // The key is confirmed solves, not points: a tick nobody checked should not
  // move anyone up the board, and Easy/Medium/Hard weighting does not decide
  // the order.
  // Equal scores share a rank. Handing them 4th and 5th instead would draw a
  // ▲ or a ▼ next week for two students who never moved past each other.
  function rankBy(field, target) {
    var rank = 0, prev = null;
    list.slice()
      .sort(function (a, b) { return b[field] - a[field]; })
      .forEach(function (r, i) {
        if (prev === null || r[field] !== prev) { rank = i + 1; prev = r[field]; }
        r[target] = r[field] > 0 ? rank : null;
      });
  }
  rankBy("verifiedSolved", "rankAll");
  rankBy("priorVerified", "prevRankAll");
  rankBy("weekVerified", "rankWeek");
  rankBy("lastWeekVerified", "prevRankWeek");

  // Level on confirmed solves, the harder set breaks the tie, then whoever got
  // there first.
  list.sort(function (a, b) {
    return (b.verifiedSolved - a.verifiedSolved) || (b.verifiedPoints - a.verifiedPoints) ||
           String(a.lastSolve || "").localeCompare(String(b.lastSolve || ""));
  });
  list.forEach(function (r) { delete r.priorPoints; delete r.priorVerified; });

  return {
    ok: true,
    week: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "YYYY-'W'ww"),
    weekStart: thisWeek.toISOString(),
    lastWeekStart: lastWeek.toISOString(),
    rows: list
  };
}

/* ============================================================================
   Submission verification
   ----------------------------------------------------------------------------
   Students tick problems by hand, which is trust-based. These functions read
   what each platform publicly reports the student actually solved, and stamp
   the matching Progress rows as verified. Anything a platform confirms is also
   marked solved, so a student who never ticks anything still gets credit.

   This has to run here rather than in the browser: neither leetcode.com nor
   hackerrank.com sends CORS headers, so a page on github.io cannot call them.
   ========================================================================== */

// Where the site's problem list lives; used to map a platform slug to a problem.
var ROADMAP_URL = "https://edusatyaki.github.io/SQLRoadmap/data/roadmap.json";

var ROADMAP = null;                       // built once per execution

/** The problem list, from the script cache when it is warm (6h). */
function roadmap() {
  if (ROADMAP) return ROADMAP;
  var cache = CacheService.getScriptCache();
  var hit = cache.get("roadmap");
  var data;
  if (hit) {
    data = JSON.parse(hit);
  } else {
    var res = UrlFetchApp.fetch(ROADMAP_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error("Could not read roadmap.json (HTTP " + res.getResponseCode() + ").");
    data = JSON.parse(res.getContentText());
    try { cache.put("roadmap", JSON.stringify(data), 21600); } catch (e) {}   // >100KB: skip cache
  }
  var bySlug = {}, byId = {};
  data.problems.forEach(function (p) {
    byId[p.id] = p;
    if (p.s) bySlug[p.p.toLowerCase() + ":" + p.s.toLowerCase()] = p;
  });
  ROADMAP = { bySlug: bySlug, byId: byId };
  return ROADMAP;
}

/** platform:slug -> problem. Throws if the roadmap cannot be read. */
function roadmapIndex() {
  return roadmap().bySlug;
}

/**
 * problemId -> problem, and {} rather than an exception when github.io cannot
 * be reached: this one only fills in missing detail, and a write or a
 * leaderboard must not fail because a lookup table was unavailable.
 */
function roadmapById() {
  try { return roadmap().byId; } catch (e) { return {}; }
}

/* ------------------------------------------------------------------ LeetCode */

function leetcodeGraphQL(query, variables) {
  var res = UrlFetchApp.fetch("https://leetcode.com/graphql", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ query: query, variables: variables }),
    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://leetcode.com" },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return null;
  var body = JSON.parse(res.getContentText());
  return body && body.data ? body.data : null;
}

/** null when the username does not exist, otherwise {solved:{All,Easy,Medium,Hard}}. */
function leetcodeProfile(username) {
  var d = leetcodeGraphQL(
    "query p($u:String!){matchedUser(username:$u){username submitStats{acSubmissionNum{difficulty count}}}}",
    { u: username });
  if (!d) return undefined;                 // network trouble — do not judge the user
  if (!d.matchedUser) return null;          // definitively no such profile
  var solved = {};
  d.matchedUser.submitStats.acSubmissionNum.forEach(function (r) { solved[r.difficulty] = r.count; });
  return { username: d.matchedUser.username, solved: solved };
}

/** The 20 most recent accepted submissions: [{titleSlug, at:Date}]. */
function leetcodeRecentAccepted(username) {
  var d = leetcodeGraphQL(
    "query r($u:String!,$n:Int!){recentAcSubmissionList(username:$u,limit:$n){titleSlug timestamp}}",
    { u: username, n: 20 });
  if (!d || !d.recentAcSubmissionList) return [];
  return d.recentAcSubmissionList.map(function (r) {
    return { slug: r.titleSlug, at: new Date(Number(r.timestamp) * 1000) };
  });
}

/* ---------------------------------------------------------------- HackerRank */

/**
 * Challenges the student has solved, newest first. Undocumented profile
 * endpoint — it needs no login today, but HackerRank could change or close it,
 * in which case verification quietly returns nothing rather than failing.
 */
function hackerrankSolved(username, maxPages) {
  var out = [], cursor = null, pages = maxPages || 5;
  for (var i = 0; i < pages; i++) {
    var url = "https://www.hackerrank.com/rest/hackers/" + encodeURIComponent(username) +
              "/recent_challenges?limit=50" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    var res = UrlFetchApp.fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) break;
    var body;
    try { body = JSON.parse(res.getContentText()); } catch (e) { break; }
    (body.models || []).forEach(function (m) {
      if (m.ch_slug) out.push({ slug: m.ch_slug, at: new Date(m.created_at) });
    });
    if (body.last_page || !body.cursor) break;
    cursor = body.cursor;
  }
  return out;
}

/**
 * null when the username does not exist, undefined when the check itself failed,
 * otherwise the profile. Same 404-vs-200 contract as the LeetCode check.
 */
function hackerrankProfile(username) {
  var res = UrlFetchApp.fetch(
    "https://www.hackerrank.com/rest/contests/master/hackers/" +
      encodeURIComponent(username) + "/profile",
    { headers: { "User-Agent": "Mozilla/5.0" }, muteHttpExceptions: true });
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) return undefined;            // rate limited or down — do not judge
  try {
    var b = JSON.parse(res.getContentText());
    return (b && b.model) ? { username: b.model.username, name: b.model.name || "" } : null;
  } catch (e) { return undefined; }
}

/* -------------------------------------------------------------- verification */

/**
 * Reads one student's public solve history and stamps the Progress sheet.
 * Returns what changed so the page can tell the student.
 */
function verifyStudent(github) {
  var gh = key(github);
  if (!gh) return { ok: false, error: "github is required." };

  var students = rows(sheet(STUDENTS, STUDENT_COLS));
  var me = null;
  for (var i = 0; i < students.length; i++) {
    if (key(students[i][0]) === gh) { me = students[i]; break; }
  }
  if (!me) return { ok: false, error: "That student is not registered." };

  var idx = roadmapIndex();
  var hits = [];

  if (me[4]) {
    leetcodeRecentAccepted(me[4]).forEach(function (s) {
      var p = idx["leetcode:" + s.slug.toLowerCase()];
      if (p) hits.push({ p: p, at: s.at, source: "leetcode" });
    });
  }
  if (me[5]) {
    hackerrankSolved(me[5]).forEach(function (s) {
      var p = idx["hackerrank:" + s.slug.toLowerCase()];
      if (p) hits.push({ p: p, at: s.at, source: "hackerrank" });
    });
  }

  // One hit per problem: a platform can list the same challenge more than once,
  // and two hits for one problem used to append two rows. Keep the earliest,
  // which is when the student first got it accepted.
  var best = {};
  hits.forEach(function (h) {
    var cur = best[h.p.id];
    if (!cur || h.at < cur.at) best[h.p.id] = h;
  });
  hits = Object.keys(best).map(function (k) { return best[k]; });

  var added = 0, confirmed = 0;

  // The platform reads above are slow and need no lock; the sheet writes below
  // must not interleave with a student ticking a box or with another sweep.
  withLock(function () {
    var pr = progressIndex();
    var now = new Date();

    hits.forEach(function (h) {
      var row = pr.idx[gh + "|" + h.p.id];
      var pts = Number(h.p.pts) || 0;
      if (row) {
        var prev = pr.data[row - 2];
        var wasVerified = prev ? prev[9] === true : true;
        // keep the earlier of the two timestamps: whichever it is, the solve
        // belongs in the week it was actually done
        var had = prev ? asDate(prev[7]) : null;
        var at = (had && had < h.at) ? had : h.at;
        // The platform says this is solved, so the sheet says so too — and the
        // title and points go in with it, or a row that sync() wrote scores
        // nothing on the leaderboard. Untouched rows are left alone: the
        // HackerRank feed returns a student's whole history every half hour.
        var same = prev && prev[9] === true && prev[8] !== false &&
                   String(prev[2]) === String(h.p.n) &&
                   String(prev[3]) === String(h.p.ch) &&
                   String(prev[4]) === String(h.p.p) &&
                   String(prev[5]) === String(h.p.d || "") &&
                   (Number(prev[6]) || 0) === pts &&
                   +asDate(prev[7]) === +at &&
                   String(prev[11]) === h.source;
        if (!same) {
          pr.sh.getRange(row, 3, 1, 10).setValues([[h.p.n, h.p.ch, h.p.p, h.p.d || "",
                                                    pts, at, true, true, now, h.source]]);
        }
        if (!wasVerified) confirmed++;
      } else {
        // solved on the platform but never ticked here — credit it anyway
        pr.sh.appendRow([me[0], h.p.id, h.p.n, h.p.ch, h.p.p, h.p.d || "",
                         pts, h.at, true, true, now, h.source]);
        pr.idx[gh + "|" + h.p.id] = pr.sh.getLastRow();
        added++;
      }
    });

    touch(gh);
  });

  return {
    ok: true, checked: hits.length, newlySolved: added, newlyVerified: confirmed,
    leetcodeProfile: me[4] ? leetcodeProfile(me[4]) : null,
    solved: solvedMap(gh), verified: verifiedMap(gh)
  };
}

/** problemId -> source, for everything a platform has confirmed. */
function verifiedMap(gh) {
  var data = rows(sheet(PROGRESS, PROGRESS_COLS));
  var out = {};
  for (var i = 0; i < data.length; i++) {
    if (key(data[i][0]) !== gh || data[i][9] !== true || data[i][8] === false) continue;
    out[data[i][1]] = data[i][11] || "platform";
  }
  return out;
}

/**
 * Sweeps the whole batch. Install installVerifyTrigger() once and this runs on
 * its own; LeetCode only exposes the last 20 accepted submissions per profile,
 * so polling often is what keeps the record complete.
 */
function verifyAll() {
  var students = rows(sheet(STUDENTS, STUDENT_COLS));
  var report = [];
  students.forEach(function (s) {
    if (!key(s[0])) return;
    try {
      var r = verifyStudent(s[0]);
      report.push(s[0] + ": +" + r.newlySolved + " solved, +" + r.newlyVerified + " verified");
    } catch (e) {
      report.push(s[0] + ": " + e.message);
    }
    Utilities.sleep(1200);            // be gentle with both platforms
  });
  var out = report.join("\n");
  PropertiesService.getScriptProperties()
    .setProperty("lastSweep", new Date().toISOString())
    .setProperty("lastSweepReport", out.slice(0, 8000));
  return out;
}

/**
 * Is the automatic sweep actually set up? A missing trigger is otherwise silent:
 * nothing errors, verification simply never runs.
 */
function status() {
  var installed = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === "verifyAll";
  });
  var props = PropertiesService.getScriptProperties();
  var roadmapOk = true, roadmapErr = null;
  try { roadmapIndex(); } catch (e) { roadmapOk = false; roadmapErr = e.message; }
  var progress = rows(sheet(PROGRESS, PROGRESS_COLS));
  var dupes = collapse(progress).duplicates;
  return {
    ok: true,
    verifyTriggerInstalled: installed,
    lastSweep: props.getProperty("lastSweep") || null,
    lastSweepReport: props.getProperty("lastSweepReport") || null,
    roadmapReachable: roadmapOk,
    roadmapError: roadmapErr,
    students: rows(sheet(STUDENTS, STUDENT_COLS)).length,
    progressRows: progress.length,
    duplicateRows: dupes,
    hint: dupes ? dupes + " duplicate rows are in Progress — the leaderboard ignores them, " +
                  "run dedupeProgress() from the editor to clear them out."
        : installed ? "Automatic verification is running."
                    : "Run installVerifyTrigger() once — nothing is polling the platforms."
  };
}

/**
 * One-off cleanup for a sheet that already has duplicates in it. The leaderboard
 * folds them together as it reads, so this is tidiness rather than a fix — but
 * anyone reading the sheet itself should see one row per student per problem.
 * Run it from the editor; it is deliberately not reachable over the web app.
 */
function dedupeProgress() {
  return withLock(function () {
    var sh = sheet(PROGRESS, PROGRESS_COLS);
    var before = rows(sh);
    var kept = collapse(before).rows;
    if (kept.length === before.length) {
      return "Nothing to clean: " + before.length + " rows, one per student per problem.";
    }
    var width = PROGRESS_COLS.length;
    var body = kept.map(function (r) {
      var out = r.slice(0, width);
      while (out.length < width) out.push("");
      return out;
    });
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, width).clearContent();
    if (body.length) sh.getRange(2, 1, body.length, width).setValues(body);
    return "Kept " + body.length + " rows, removed " + (before.length - body.length) + " duplicates.";
  });
}

/** Run once from the editor to poll every 30 minutes. */
function installVerifyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "verifyAll") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("verifyAll").timeBased().everyMinutes(30).create();
  return "verifyAll now runs every 30 minutes.";
}
