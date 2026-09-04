# SQL Roadmap

A static site for the XShare SQL batch: **379 practice problems** (323 LeetCode Database +
56 HackerRank) grouped into 14 chapters, with per-student progress tracking and a weekly
class leaderboard.

Students register with their name, enrollment number, lab section (Lab 1 / Lab 2), LeetCode
username and their GitHub / HackerRank / Codeforces handles, tick
problems off as they solve them, and their progress is written to a Google Sheet through an
Apps Script web app. No server, no database, no build step.

```
index.html         register / sign in
roadmap.html       the 14 chapters, checkboxes, filters, progress
leaderboard.html   weekly + all-time ranking with ▲ ▼ movement
assets/config.js   ← the one file you edit after deploying the backend
data/roadmap.json  the problem set
apps-script/       the Google Apps Script backend
```

## Setup

### 1. Create the sheet and deploy the backend

1. Create a new Google Sheet (name it anything, e.g. *SQL Roadmap — Batch 1*).
2. In that sheet: **Extensions ▸ Apps Script**.
3. Delete the placeholder code, paste all of [`apps-script/Code.gs`](apps-script/Code.gs), save.
4. Run the `setup` function once and approve the permissions prompt. It creates the
   `Students` and `Progress` tabs.
5. **Deploy ▸ New deployment ▸ Web app** with:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
6. Copy the deployment URL. It ends in `/exec`.

### 2. Point the site at it

Open `assets/config.js` and paste the URL:

```js
window.SQL_ROADMAP = {
  apiUrl: "https://script.google.com/macros/s/AKfy…/exec",
  ...
};
```

Commit and push. Until this is filled in the site still works, but progress stays in each
student's browser and the leaderboard shows only that student.

### 3. Turn on GitHub Pages

**Settings ▸ Pages ▸ Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
The site appears at `https://edusatyaki.github.io/SQLRoadmap/` a minute later.

## How scoring works

| Difficulty | Points |
| --- | --- |
| Easy (and all HackerRank problems) | 10 |
| Medium | 20 |
| Hard | 30 |

The full roadmap is worth **6,550 points**. Rank movement compares like with like — in the
weekly view, this week's rank against last week's; in the all-time view, the standing now
against the standing at the end of last week. Someone with no points in the comparison
period shows as **new**.

## Chapters

Ordered as a teaching sequence, not by problem number. Free problems come first in each
chapter; LeetCode premium problems are grouped at the bottom of the chapter behind a
"Premium" divider.

1. Basic Select · 2. Basic Aggregate Functions · 3. Advanced Select · 4. Basic Joins ·
5. Advanced Join · 6. Advanced Select and Joins · 7. Alternative Queries ·
8. Sorting and Grouping · 9. Subqueries · 10. Advanced String Functions/Regex/Clause ·
11. Window Functions and Ranking · 12. Date and Time Analysis ·
13. Pivoting and Conditional Aggregation · 14. Recursive Queries and Hierarchies

## Submission verification

Ticking a box is trust-based, so the backend independently reads what each platform publicly
reports the student solved and stamps those rows as **verified**. Anything a platform confirms
is also marked solved, so a student who never ticks anything still gets credit for real work.

| Platform | Verified? | How |
| --- | --- | --- |
| LeetCode | Yes, going forward | `recentAcSubmissionList` — the **last 20 accepted submissions only** |
| HackerRank | Yes, full history | the profile's `recent_challenges` endpoint, paginated |
| Codeforces | N/A | the handle is checked at signup, but this roadmap contains no Codeforces problems |

Run `installVerifyTrigger()` once in the Apps Script editor. `verifyAll()` then sweeps the
batch every 30 minutes. Students can also press **Check my submissions** on the roadmap page
to run it for themselves immediately.

This has to live in Apps Script: neither leetcode.com nor hackerrank.com sends CORS headers,
so a page on github.io cannot call them from the browser.

### Limits worth knowing before you rely on it

- **LeetCode backfill is impossible.** The public API exposes only the last 20 accepted
  submissions, so problems solved before a student registers are not picked up. Verification
  is forward-looking; frequent polling is what keeps it complete. A student who solves 25
  problems between two sweeps will have some go unverified.
- **The HackerRank endpoint is undocumented.** It needs no login today; HackerRank could
  change or close it without notice, at which point verification returns nothing rather than
  failing loudly.
- **Both need public profiles.** A private profile cannot be read.
- **Verification confirms a solve, not authorship.** It proves the account solved the problem,
  not that the student wrote the SQL themselves.
- The leaderboard still ranks on total points; the **Verified** column shows how much of each
  student's total is platform-confirmed. Rank on verified points instead by sorting on
  `verifiedPoints` in `leaderboard.html`.

## Theme

The site is set in Arial throughout and pinned to the light palette: every page carries `data-theme="light"` on its
`<html>` element, which switches off both dark blocks in `assets/styles.css`. The dark
palette is still there — delete that attribute from the three pages to follow the viewer's
OS setting again.

## Updating the problem set

`data/roadmap.json` is generated from the roadmap CSV. Each entry is
`{id, ch, p, n, u, d, prem, pts, day}` — id, chapter, platform, name, url, difficulty,
premium flag, points, original day number. Edit or regenerate the file and the site picks it
up; a student's ticked problems are keyed by `id`, so keep ids stable.

## What this is not

Sign-in is by GitHub username with no password — it identifies students, it does not
authenticate them. Anyone who knows a classmate's username could claim their row. That is
fine for a class tracker; do not extend it to anything that needs real accounts.
