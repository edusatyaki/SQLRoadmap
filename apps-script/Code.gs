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
    return json({ ok: true, service: "SQL Roadmap", time: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, error: "Body was not valid JSON." }); }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (body.action === "register") return json(register(body.student));
    if (body.action === "solve") return json(solve(body));
    if (body.action === "sync") return json(sync(body));
    return json({ ok: false, error: "Unknown action: " + body.action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
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
  if (leetcodeProfile(student.leetcode) === null) {
    return { ok: false, leetcodeUnknown: true,
             error: "LeetCode has no profile called " + student.leetcode + "." };
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
  // A hand-tick must never clear a verification the platform already granted.
  var row = [b.github, b.problemId, b.title || "", b.chapter || "", b.platform || "",
             b.difficulty || "", Number(b.points) || 0, at, b.solved !== false,
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
  var appends = [];
  Object.keys(solved).forEach(function (id) {
    var at = asDate(solved[id]) || new Date();
    var existing = p.idx[gh + "|" + id];
    if (existing) {
      p.sh.getRange(existing, 8, 1, 2).setValues([[at, true]]);
    } else {
      appends.push([b.github, id, "", "", "", "", 0, at, true, "", "", ""]);
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

/* ------------------------------------------------------------- leaderboard */

function leaderboard() {
  var students = rows(sheet(STUDENTS, STUDENT_COLS));
  var progress = rows(sheet(PROGRESS, PROGRESS_COLS));
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
      solved: 0, weekSolved: 0, lastSolve: null
    };
  });

  progress.forEach(function (r) {
    var a = acc[key(r[0])];
    if (!a || r[8] === false) return;
    var at = asDate(r[7]);
    var pts = Number(r[6]) || 0;
    a.points += pts;
    a.solved += 1;
    if (r[9] === true) { a.verifiedPoints += pts; a.verifiedSolved += 1; }
    if (!at) { a.priorPoints += pts; return; }
    if (at >= thisWeek) {
      a.weekPoints += pts;
      a.weekSolved += 1;
    } else {
      a.priorPoints += pts;
      if (at >= lastWeek) a.lastWeekPoints += pts;
    }
    var iso = at.toISOString();
    if (!a.lastSolve || iso > a.lastSolve) a.lastSolve = iso;
  });

  var list = Object.keys(acc).map(function (k) { return acc[k]; });

  // Rank each student on four scales so the site can draw ▲ / ▼ for either view:
  //   all-time now vs all-time at the end of last week,
  //   this week's points vs last week's points.
  function rankBy(field, target) {
    list.slice()
      .sort(function (a, b) { return b[field] - a[field]; })
      .forEach(function (r, i) { r[target] = r[field] > 0 ? i + 1 : null; });
  }
  rankBy("points", "rankAll");
  rankBy("priorPoints", "prevRankAll");
  rankBy("weekPoints", "rankWeek");
  rankBy("lastWeekPoints", "prevRankWeek");

  list.sort(function (a, b) {
    return (b.points - a.points) || String(a.lastSolve || "").localeCompare(String(b.lastSolve || ""));
  });
  list.forEach(function (r) { delete r.priorPoints; });

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

/** slug -> {id, title, chapter, platform, difficulty, points}, cached for 6h. */
function roadmapIndex() {
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
  var idx = {};
  data.problems.forEach(function (p) {
    if (p.s) idx[p.p.toLowerCase() + ":" + p.s.toLowerCase()] = p;
  });
  return idx;
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

  var pr = progressIndex();
  var now = new Date();
  var added = 0, confirmed = 0;

  hits.forEach(function (h) {
    var row = pr.idx[gh + "|" + h.p.id];
    if (row) {
      var prev = pr.data[row - 2];
      var wasVerified = prev ? prev[9] === true : true;
      // keep the earlier of the two timestamps: the platform's is the real one
      pr.sh.getRange(row, 8, 1, 5).setValues([[h.at, true, true, now, h.source]]);
      if (!wasVerified) confirmed++;
    } else {
      // solved on the platform but never ticked here — credit it anyway
      pr.sh.appendRow([me[0], h.p.id, h.p.n, h.p.ch, h.p.p, h.p.d || "",
                       Number(h.p.pts) || 0, h.at, true, true, now, h.source]);
      pr.idx[gh + "|" + h.p.id] = pr.sh.getLastRow();
      added++;
    }
  });

  touch(gh);
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
  return report.join("\n");
}

/** Run once from the editor to poll every 30 minutes. */
function installVerifyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "verifyAll") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("verifyAll").timeBased().everyMinutes(30).create();
  return "verifyAll now runs every 30 minutes.";
}
