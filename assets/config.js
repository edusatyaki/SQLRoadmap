/* ---------------------------------------------------------------------------
   SQL Roadmap — configuration
   ---------------------------------------------------------------------------
   Paste the Apps Script Web App URL between the quotes below, commit, push.
   It looks like:  https://script.google.com/macros/s/AKfy..../exec
   Until it is filled in, the site runs in local-only mode: progress is saved
   in the student's browser and the leaderboard shows only that student.
   Setup steps: see apps-script/README.md
--------------------------------------------------------------------------- */
window.SQL_ROADMAP = {
  apiUrl: "",
  batchName: "XShare SQL Roadmap",
  // Points awarded per problem, by LeetCode difficulty.
  // HackerRank problems (no difficulty listed) score the same as Easy.
  points: { Easy: 10, Medium: 20, Hard: 30 }
};
