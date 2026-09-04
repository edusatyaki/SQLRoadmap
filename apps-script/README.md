# Apps Script backend

Paste `Code.gs` into the Apps Script editor of the Google Sheet that will hold the data
(**Extensions ▸ Apps Script**), run `setup()` once, then deploy as a web app
(*Execute as: Me*, *Who has access: Anyone*).

## API

The site talks to the `/exec` URL. POSTs are sent as `text/plain` on purpose — Apps Script
web apps cannot answer the CORS preflight that a JSON content-type would trigger.

| Method | Action | Payload / query | Returns |
| --- | --- | --- | --- |
| GET | `ping` | — | `{ok, service, time}` |
| GET | `leaderboard` | — | `{ok, week, rows:[…]}` |
| GET | `student` | `github` | `{ok, solved:{problemId: iso}, verified:{problemId: source}}` |
| GET | `verify` | `github` | `{ok, newlySolved, newlyVerified, solved, verified}` — reads the student's LeetCode and HackerRank profiles |
| POST | `register` | `{student:{name,enrollment,section,leetcode,github,hackerrank,codeforces}}` — rejects an unknown LeetCode or HackerRank handle with `leetcodeUnknown` / `hackerrankUnknown` | `{ok, returning, student:{solved}}` |
| POST | `solve` | `{github, problemId, chapter, title, platform, difficulty, points, solved, at}` | `{ok}` |
| POST | `sync` | `{github, student, solved:{id: iso}}` | `{ok, written}` |

Each leaderboard row carries `enrollment`, `section`, `verifiedPoints`, `verifiedSolved`, `points`, `weekPoints`, `lastWeekPoints`, `solved`,
`weekSolved`, `lastSolve`, and four ranks: `rankAll`, `prevRankAll`, `rankWeek`,
`prevRankWeek`.

## Sheets

**Students** — `github | name | enrollment | section | leetcode | hackerrank | codeforces | joined | lastSeen`

`section` is `Lab 1` or `Lab 2`. If you created the sheets before these two columns
existed, delete the `Students` tab and run `setup()` again. The same applies to `Progress`
and its `verified` / `verifiedAt` / `source` columns.

After deploying, run `installVerifyTrigger()` once so `verifyAll()` polls the batch every 30
minutes, and set `ROADMAP_URL` at the top of `Code.gs` if the site is not at
`edusatyaki.github.io/SQLRoadmap`.
**Progress** — `github | problemId | title | chapter | platform | difficulty | points | solvedAt | solved | verified | verifiedAt | source`

One Progress row per student per problem, upserted. Un-ticking sets `solved` to `FALSE`
rather than deleting the row, so you keep the history.

## Redeploying

After editing `Code.gs`, use **Deploy ▸ Manage deployments ▸ edit ▸ Version: New version**.
Creating a brand new deployment gives a different URL and would need a `config.js` change.
