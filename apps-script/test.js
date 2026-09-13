/**
 * Code.gs under node, against an in-memory sheet.
 *
 *   node apps-script/test.js        (from the repo root)
 *
 * Apps Script has no test runner and the real backend needs a Google account,
 * so the handful of globals Code.gs touches are stubbed below and the file is
 * eval'd. The fixtures are the shapes that actually went wrong in the class
 * sheet: one problem written twice, a row the offline queue left with no
 * points, and a solve the platform confirmed after the student un-ticked it.
 */
const fs = require("fs");
const FIXTURE = JSON.parse(fs.readFileSync(__dirname + "/../data/roadmap.json", "utf8"));
const P = Object.fromEntries(FIXTURE.problems.map(p => [p.id, p]));

function FakeSheet() { this.v = []; }
FakeSheet.prototype.appendRow = function (r) { this.v.push(r.slice()); };
FakeSheet.prototype.setFrozenRows = function () {};
FakeSheet.prototype.getLastRow = function () { return this.v.length; };
FakeSheet.prototype.getDataRange = function () {
  const s = this; return { getValues: () => s.v.map(r => r.slice()) };
};
FakeSheet.prototype.getRange = function (row, col, nR, nC) {
  const s = this; nR = nR || 1; nC = nC || 1;
  return {
    setValues(vals) {
      for (let i = 0; i < nR; i++) { while (s.v.length < row + i) s.v.push([]);
        for (let j = 0; j < nC; j++) s.v[row + i - 1][col + j - 1] = vals[i][j]; }
    },
    setValue(v) { s.v[row - 1][col - 1] = v; },
    setFontWeight() {},
    clearContent() {
      for (let i = 0; i < nR; i++) if (s.v[row + i - 1])
        for (let j = 0; j < nC; j++) s.v[row + i - 1][col + j - 1] = "";
      while (s.v.length > 1 && s.v[s.v.length - 1].every(c => c === "")) s.v.pop();
    }
  };
};

const SHEETS = {};
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({
  getSheetByName: n => SHEETS[n] || null,
  insertSheet: n => (SHEETS[n] = new FakeSheet()),
  getUrl: () => "fake://sheet" }) };
global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
let FIXTURE_FETCHES = 0;
global.UrlFetchApp = { fetch: () => { FIXTURE_FETCHES++; return {
  getResponseCode: () => 200, getContentText: () => JSON.stringify(FIXTURE) }; } };
let LOCKED = 0, MAXLOCK = 0;
global.LockService = { getScriptLock: () => ({
  waitLock() { LOCKED++; MAXLOCK = Math.max(MAXLOCK, LOCKED); if (LOCKED > 1) throw new Error("lock re-entered!"); },
  releaseLock() { LOCKED--; } }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty() { return this; } }) };
global.ScriptApp = { getProjectTriggers: () => [] };
global.Utilities = { formatDate: () => "2026-W38", sleep: () => {} };
global.Session = { getScriptTimeZone: () => "Asia/Kolkata" };
global.ContentService = { MimeType: { JSON: "json" }, createTextOutput: t => ({ setMimeType: () => t }) };

eval(fs.readFileSync(__dirname + "/Code.gs", "utf8"));

/* ------------------------------------------------------------------ tests */
let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else { fails++; console.log("  FAIL " + name + (extra ? "  -> " + extra : "")); }
}

setup();
const S = SHEETS.Students, PR = SHEETS.Progress;
const now = new Date("2026-09-14T10:00:00Z");
S.appendRow(["Ritammishra2007", "Ritam Mishra", 2501010610, "Lab 2",
             "Ritammishra2007", "Ritammishra2007", "", now, now]);
S.appendRow(["someone", "Some One", 1, "Lab 1", "x", "y", "", now, now]);

const d = iso => new Date(iso);
// Exactly the shape that produced the live bug: one problem, two rows, because
// a sweep and a student's own check both appended it.
PR.appendRow(["Ritammishra2007", "lc595", "Big Countries", "Basic Select", "LeetCode", "Easy", 10,
              d("2026-09-08T19:18:04Z"), true, true, now, "leetcode"]);
PR.appendRow(["Ritammishra2007", "lc595", "Big Countries", "Basic Select", "LeetCode", "Easy", 10,
              d("2026-09-08T19:18:04Z"), true, true, now, "leetcode"]);
// A row the offline queue wrote: no title, no points.
PR.appendRow(["Ritammishra2007", "lc1683", "", "", "", "", 0,
              d("2026-09-10T05:00:00Z"), true, "", "", ""]);
// Verified by the platform, then un-ticked in the browser.
PR.appendRow(["Ritammishra2007", "hr7e153b3c", "Revising the Select Query I", "Basic Select",
              "HackerRank", "", 10, d("2026-09-04T10:36:22Z"), false, true, now, "hackerrank"]);
// The other student, on the same score, to check the tie rule.
PR.appendRow(["someone", "lc595", "Big Countries", "Basic Select", "LeetCode", "Easy", 10,
              d("2026-09-08T19:18:04Z"), true, true, now, "leetcode"]);

console.log("\nleaderboard()");
const lb = leaderboard();
const ritam = lb.rows.filter(r => key(r.github) === "ritammishra2007")[0];
const other = lb.rows.filter(r => key(r.github) === "someone")[0];
ok("duplicate row counted once (solved)", ritam.solved === 3, "got " + ritam.solved);
ok("points not doubled, zero-point row scored from the roadmap",
   ritam.points === 30, "got " + ritam.points + " (want 10+10+10)");
ok("a verified solve counts even when the box was un-ticked",
   ritam.verifiedSolved === 2, "got " + ritam.verifiedSolved);
ok("equal all-time scores share a rank",
   ritam.rankAll === 1 && other.rankAll !== null, "ritam " + ritam.rankAll + ", other " + other.rankAll);

console.log("\nsolve() — a hand-tick over a verified row");
solve({ github: "Ritammishra2007", problemId: "lc595", title: "Big Countries", chapter: "Basic Select",
        platform: "LeetCode", difficulty: "Easy", points: 10, solved: true,
        at: "2026-09-14T09:00:00Z" });
const row595 = PR.v.filter(r => r[0] === "Ritammishra2007" && r[1] === "lc595").pop();
ok("keeps the platform's timestamp, not the tick's",
   +asDate(row595[7]) === +d("2026-09-08T19:18:04Z"), String(row595[7]));
ok("keeps the verification", row595[9] === true);

console.log("\nsync() — the offline queue");
sync({ github: "Ritammishra2007", solved: { lc1148: "2026-09-08T19:12:13Z" } });
const row1148 = PR.v.filter(r => r[1] === "lc1148").pop();
ok("new row carries the roadmap's points", Number(row1148[6]) === P.lc1148.pts, "got " + row1148[6]);
ok("new row carries the title", row1148[2] === P.lc1148.n, "got " + row1148[2]);
sync({ github: "Ritammishra2007", solved: { lc1683: "2026-09-14T09:00:00Z" } });
const row1683 = PR.v.filter(r => r[1] === "lc1683").pop();
ok("repairs a zero-point row it wrote earlier", Number(row1683[6]) === P.lc1683.pts, "got " + row1683[6]);

console.log("\nverifyStudent() — the platforms decide");
leetcodeRecentAccepted = () => ([
  { slug: "big-countries", at: d("2026-09-01T00:00:00Z") },      // earlier than the sheet
  { slug: "article-views-i", at: d("2026-09-08T19:12:13Z") },
  { slug: "article-views-i", at: d("2026-09-09T19:12:13Z") },    // same problem twice
  { slug: "invalid-tweets", at: d("2026-09-08T10:02:23Z") }
]);
hackerrankSolved = () => ([{ slug: "revising-the-select-query", at: d("2026-09-04T10:36:22Z") }]);
leetcodeProfile = () => ({ username: "Ritammishra2007", solved: { All: 51 } });
const before = PR.v.length;
const v1 = verifyStudent("Ritammishra2007");
ok("no duplicate row for a problem listed twice",
   PR.v.filter(r => r[0] === "Ritammishra2007" && r[1] === "lc1148").length === 1);
ok("un-ticked but platform-confirmed is marked solved again",
   PR.v.filter(r => r[1] === "hr7e153b3c").pop()[8] === true);
const mine595 = PR.v.filter(r => r[0] === "Ritammishra2007" && r[1] === "lc595").pop();
ok("the earlier timestamp wins",
   +asDate(mine595[7]) === +d("2026-09-01T00:00:00Z"), String(mine595[7]));
ok("a row with no points gets them", Number(PR.v.filter(r => r[1] === "lc1683").pop()[6]) === 10);
ok("solved map has every confirmed problem", Object.keys(v1.solved).length === 4,
   Object.keys(v1.solved).join(","));

const writesBefore = JSON.stringify(PR.v);
const v2 = verifyStudent("Ritammishra2007");
ok("a second sweep changes nothing", JSON.stringify(PR.v) === writesBefore);
ok("and claims nothing new", v2.newlySolved === 0 && v2.newlyVerified === 0,
   v2.newlySolved + "/" + v2.newlyVerified);

console.log("\nleaderboard() after verification");
const lb2 = leaderboard();
const r2 = lb2.rows.filter(r => key(r.github) === "ritammishra2007")[0];
const want = ["lc595", "lc1148", "lc1683", "hr7e153b3c"].reduce((a, id) => a + P[id].pts, 0);
ok("points equal the sum of the problems actually solved", r2.points === want,
   "got " + r2.points + ", want " + want);
ok("every point is verified", r2.verifiedPoints === r2.points,
   r2.verifiedPoints + " of " + r2.points);

console.log("\ndedupeProgress()");
const msg = dedupeProgress();
console.log("  " + msg);
const keys = PR.v.slice(1).map(r => key(r[0]) + "|" + r[1]);
ok("one row per student per problem", new Set(keys).size === keys.length);
ok("nothing lost", new Set(keys).size === 5, keys.join(" "));
ok("second run is a no-op", /Nothing to clean/.test(dedupeProgress()));
ok("leaderboard unchanged by the cleanup",
   leaderboard().rows.filter(r => key(r.github) === "ritammishra2007")[0].points === want);
ok("lock never re-entered within one execution", MAXLOCK === 1, "max depth " + MAXLOCK);

console.log("\nranking is on confirmed solves, not points");
S.appendRow(["tickerbob", "Ticker Bob", 3, "Lab 1", "tb", "tb", "", now, now]);
// Four hard problems ticked by hand and confirmed by nobody: 120 points, and
// it must not put him above a student with two confirmed easy ones.
["lc1194", "lc1341", "lc185", "lc262"].forEach(function (id, i) {
  PR.v.push(["tickerbob", id, P[id].n, P[id].ch, P[id].p, P[id].d, P[id].pts,
             d("2026-09-1" + (4 + i) + "T08:00:00Z"), true, "", "", ""]);
});
const lb3 = leaderboard();
const bob = lb3.rows.filter(r => key(r.github) === "tickerbob")[0];
const rit = lb3.rows.filter(r => key(r.github) === "ritammishra2007")[0];
ok("unverified ticks still show as points", bob.points > rit.points,
   bob.points + " vs " + rit.points);
ok("but earn no rank", bob.rankAll === null, String(bob.rankAll));
ok("and sort below a student with confirmed solves",
   lb3.rows.indexOf(rit) < lb3.rows.indexOf(bob));
ok("the confirmed student is first", rit.rankAll === 1, String(rit.rankAll));
ok("weekly confirmed count is reported", typeof rit.weekVerified === "number");
ok("internal buckets are not leaked to the page",
   !("priorPoints" in rit) && !("priorVerified" in rit));

console.log("\nroadmap lookups stay lazy");
FIXTURE_FETCHES = 0; ROADMAP = null;
leaderboard();
ok("a sheet with points on every row never fetches the roadmap", FIXTURE_FETCHES === 0,
   FIXTURE_FETCHES + " fetches");
solve({ github: "someone", problemId: "lc595", title: "Big Countries", chapter: "Basic Select",
        platform: "LeetCode", difficulty: "Easy", points: 10, solved: true, at: "2026-09-14T09:00:00Z" });
ok("nor does a tick that carries its own points", FIXTURE_FETCHES === 0,
   FIXTURE_FETCHES + " fetches");
sync({ github: "someone", solved: { lc1757: "2026-09-14T09:00:00Z" } });
ok("but the offline queue does, because ids are all it has", FIXTURE_FETCHES === 1,
   FIXTURE_FETCHES + " fetches");
ok("and the row it wrote scores",
   Number(PR.v.filter(r => r[0] === "someone" && r[1] === "lc1757").pop()[6]) === P.lc1757.pts);

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
