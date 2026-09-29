<!-- agent-tracking:start — managed by https://github.com/BohdanMoroz11/agent-tracking; change it there and re-run install -->

## Work tracking

Work is tracked as GitHub issues in this repo. Keep them right without being asked: the user should never have to remind you. The labels feed a Jira mirror the team reads and a daily Telegram digest the user reads, so a wrong label shows up in both.

**Labels.** Every open issue has:

- **one type:** `bug`, `feature`, `refactor`, `ops` (config, accounts, customer requests, infrastructure) or `investigation` (find out why; it ends in a finding or a new issue);
- **one priority,** set when it is opened: `p1`, `p2` or `p3`, as defined for this repo in **Work tracking in this repo** below. It says how much the issue matters, not when it gets done;
- **at most one state:**
  - `now`: being worked on, including chasing someone outside the team (add the Waiting line);
  - `next`: queued, taken in priority order;
  - `blocked`: parked until someone outside acts or time passes (a fix that needs a week of data to confirm), and nobody is chasing it;
  - no state: later. A `p3` with no state is the backlog: written down so it is not only remembered.

A `p1` always has a state.

**Waiting.** An issue that waits on someone or on time, whether `now` or `blocked`, starts its body with `**Waiting on:** <who or what> · **Recheck:** YYYY-MM-DD`. The digest flags it when the date comes.

**Open an issue** for:

- work that will not finish in this session;
- anything you find outside the current task. Do not fix it silently, and do not leave it only in chat;
- anything waiting on someone else, or on time;
- anything the user asks you to note, in whatever form they give it;
- a change a teammate would notice (a feature, a fix, a customer request, an ops action), even when it starts and ships in this session: open it, and let the PR close it. Chores, docs, CI and refactors with no visible effect need no issue.

Before opening one, search the open and closed issues (`gh issue list --search`), and comment on or reopen a match instead of duplicating it. An issue body says what, gives the evidence (numbers, ids, the query, the customer's words) and says when it is done. Reasoning too long for an issue goes in a design doc, linked from the issue.

**While working:** set `now` on the issue you start, replacing any other state. A PR body says `Fixes #N` when it completes the issue and `Refs #N` when it is partial. New facts that change an issue go in a comment on it.

**A fix that needs time or data to prove** (a week of traffic, a few nightly runs) still closes when it ships. Label the closed issue `verify` and start its body with `**Verify:** <what to measure and the expected result> · **On:** <date, counted from the deploy>`. The digest raises it on that date. Then measure: if it held, remove `verify` and comment the numbers; if not, reopen the issue with the numbers. A check that should hold forever belongs in the monitoring, not in an issue.

**Before handing back,** at the end of every task and not only the end of the session: comment on each issue you touched with what changed and what is left, correct its labels, and tell the user which issues you opened, closed or moved.

**Closing.** An issue closes when its work ships, or as not planned with a comment `not now: <why>`. Closed issues stay searchable; reopen one if it comes back.

**No status in the repo.** No to-do lists, backlogs, status tables or "next steps" in docs or anywhere else in the repo: that is what issues are for. Docs describe how things are and why; a design doc links its issue instead of tracking its own progress.

**Overview.** When the user asks what is going on, read the issues (`gh issue list --label now`, `--label next`, `--label blocked`) rather than any doc.

**Jira mirrors GitHub** one way (`.github/workflows/tracking-jira-sync.yml`). Work only in GitHub; edits made in Jira are overwritten.

<!-- agent-tracking:end -->
