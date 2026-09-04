/**
 * SQL Roadmap — Google Apps Script backend
 * ----------------------------------------
 * Deploy as: Web app · Execute as "Me" · Who has access "Anyone".
 * Copy the /exec URL into assets/config.js of the website.
 *
 * Sheets used (run setup() once and they are created for you):
 *   Students  github | name | hackerrank | codeforces | joined | lastSeen
 *   Progress  github | problemId | title | chapter | platform | difficulty | points | solvedAt | solved
 */

// Leave blank when this script lives inside the spreadsheet (Extensions ▸ Apps Script).
// Otherwise paste the spreadsheet ID from its URL.
var SHEET_ID = "";

var STUDENTS = "Students";
var PROGRESS = "Progress";
var STUDENT_COLS = ["github", "name", "hackerrank", "codeforces", "joined", "lastSeen"];
var PROGRESS_COLS = ["github", "problemId", "title", "chapter", "platform", "difficulty",
                     "points", "solvedAt", "solved"];

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
  var sh = sheet(STUDENTS, STUDENT_COLS);
  var data = rows(sh);
  var gh = key(student.github);
  var now = new Date();

  for (var i = 0; i < data.length; i++) {
    if (key(data[i][0]) === gh) {                       // returning student
      sh.getRange(i + 2, 2, 1, 3).setValues([[
        student.name || data[i][1],
        student.hackerrank || data[i][2],
        student.codeforces || data[i][3]
      ]]);
      sh.getRange(i + 2, 6).setValue(now);
      return { ok: true, returning: true, student: { solved: solvedMap(gh) } };
    }
  }

  sh.appendRow([student.github, student.name || "", student.hackerrank || "",
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
  var row = [b.github, b.problemId, b.title || "", b.chapter || "", b.platform || "",
             b.difficulty || "", Number(b.points) || 0, at, b.solved !== false];
  var existing = p.idx[gh + "|" + b.problemId];
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
      appends.push([b.github, id, "", "", "", "", 0, at, true]);
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
    if (key(data[i][0]) === gh) { sh.getRange(i + 2, 6).setValue(new Date()); return; }
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
  return { ok: true, solved: solvedMap(gh) };
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
      name: s[1] || s[0], github: s[0], hackerrank: s[2] || "", codeforces: s[3] || "",
      points: 0, weekPoints: 0, lastWeekPoints: 0, priorPoints: 0,
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
