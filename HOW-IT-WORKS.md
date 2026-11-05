# How it works

Every moving part of the tracking setup, where it runs, what starts it, and what it needs. Adding a project is [RUNBOOK.md](RUNBOOK.md); this page is for understanding the setup and fixing it.

## The pieces

```
              agents (any: Claude, Codex, Cursor…) follow AGENTS.md → Work tracking
                                     │ open, label, comment, close
                                     ▼
                            GitHub issues (the source of truth)
                  ┌──────────────────┴────────────────────┐
      issue event │                                       │ read, check, comment
                  ▼                                       │
   tracking-jira-sync.yml, tracking-on-close.yml     morning brief ◄── devbox timer, 08:00 Kyiv
   (GitHub Actions)                                  (devbox: a Claude session per active repo)
                  │                                       │
                  ▼                                       ▼
         Jira (one project per repo,             Telegram (one message, all repos,
         read-only for the team)                 each with a session id to resume)
```

| Piece | Lives in | Started by | Needs |
| --- | --- | --- | --- |
| Rules for agents | each repo's `AGENTS.md`, between the `agent-tracking` markers, plus its own "Work tracking in this repo" section | read by every agent at session start | nothing |
| Jira mirror | `jira-sync/` here; `.github/workflows/tracking-jira-sync.yml` in each repo | every issue event (opened, edited, labeled, closed…), or by hand for `discover` / `backfill` | secrets `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`; variable `JIRA_PROJECT_KEY` (unset = off) |
| Cleanup on close | `.github/workflows/tracking-on-close.yml` in each repo | an issue closing | nothing |
| Morning brief | `brief/` here, run on the devbox | the devbox timer, 08:00 Kyiv, every day | `claude` logged in; `~/.config/agent-tracking/repos`; `~/.config/agent-tracking/telegram.env`; a checkout of each repo |
| PR ↔ issue check | `.github/workflows/tracking-issue-link.yml` in each repo | every PR | nothing; it only warns, never fails |
| Labels | `labels.tsv` here, plus each repo's `.github/tracking-labels.tsv` | `labels.sh`, by hand | `gh` |

The Jira sync runs from the moving `v1` tag of this repo, so a fix to it reaches every project once the tag moves. The brief runs from this checkout on the devbox, so a change to it lands with `git pull`. Templates (workflows, the AGENTS.md block) are copied into each repo by `install.mjs` and need a re-install and a PR per repo.

## The morning brief

The timer runs `brief/brief.mjs --send`. For each repo in `~/.config/agent-tracking/repos` (`owner/name [checkout] [title]`, checkout defaulting to `~/projects/<name>`):

1. **Is there anything to say?** It takes part when something happened since its last brief (issues, PRs, commits), when a recheck or verify date came due since then, or on Monday when anything is overdue. A quiet repo costs nothing and sends nothing, so a side project that sat for a week stays silent until a date comes due.
2. **Material.** A script gathers the issues that moved, are due or are in progress with their comments, one line for every other open issue, the PRs and commits since the last brief, the facts from labels and dates (so nothing due is skipped), and the last three briefs (so it does not repeat itself).
3. **A Claude session** in the repo's checkout (`claude -p`, auto mode, the user's own settings) runs the due checks first: it measures each due `verify` and removes the label or reopens the issue, looks into each due recheck and comments what it found. Then it writes the brief: what matters today, what waits on the user, what is stuck or forgotten, and numbered questions. It never edits the checkout. The prompt is `brief/prompt.md`.
4. **One Telegram message**, every repo's section in it (one message per repo if it is too long), each ending with `cd <checkout> && claude --resume <id>`. Run that to answer the questions: the session still has everything it read.

State, so each brief knows what it said before: `~/.local/state/agent-tracking/brief/<repo>/` holds `last-run` and `briefs/<date>.txt`. Deleting a repo's `last-run` makes its next brief cover the last 24 hours.

**If the agent fails** for a repo, its section carries the plain facts (what is due, what is quiet) and the error, so the brief is never silent. If the whole run fails, `OnFailure=` sends a Telegram alert with the log lines (`scheduler/notify-failure.sh`).

**Cost.** One session per active repo. In the first runs, about $0.20 for a repo on a light day and $1–2 for one with a dozen checks against production.

**Why the devbox, not GitHub Actions.** The digest first ran on GitHub's cron, which started runs six hours late and then skipped them. A session that reads production and that the user can resume has to run where the user's agent setup lives anyway. The devbox is the dependency: if it is off at 08:00, the brief comes when it is back (`Persistent=true`).

**Test it through systemd, never from your shell.** The timer runs with the bare system `PATH`, without anything a shell profile adds. The first digest timer called `node`, worked in every manual test and failed on every timer run. `install.sh` now writes node's and claude's directories into the unit's `PATH`. To run exactly what the timer runs (this runs the agents and sends the brief):

```bash
systemctl --user start agent-tracking-brief.service
journalctl --user -u agent-tracking-brief.service -n 20 -o cat
```

To see a brief without sending it: `node brief/brief.mjs [--repo name] [--force]`. That still runs the checks, which comment on issues. `--dry` only writes each repo's prompt to its state directory.

## When the brief doesn't arrive

1. **Did the timer fire?** `systemctl --user list-timers agent-tracking-brief.timer` shows the last and next run; `journalctl --user -u agent-tracking-brief.service --since today` shows one line per repo (skipped as quiet, briefing, turns and cost) or the error.
2. **The usual causes:**
   - **`command not found` or `spawnSync claude ENOENT`:** something is not on the unit's `PATH`. Re-run `scheduler/install.sh` after node or claude moved.
   - **`claude failed`:** run the same thing by hand in the repo's checkout (`node brief/brief.mjs --repo name --force`); a logged-out claude or an exhausted plan shows there.
   - **`Telegram sendMessage → 403`:** `TELEGRAM_CHAT_ID` is wrong. The bot's own id, which is the number before the `:` in its token, is not a chat id.
   - **Nothing for one repo:** it was quiet (the journal says `skipped`), or it isn't in `~/.config/agent-tracking/repos`.

## When Jira looks wrong

- **Nothing syncs:** `JIRA_PROJECT_KEY` is unset on the repo, or the run failed. Check `gh run list --workflow tracking-jira-sync.yml`.
- **A Jira edit disappeared:** that is by design. The mirror is one way, and the next GitHub event overwrites the Jira issue. Only a Jira assignee is kept.
- **A duplicate Jira issue:** someone deleted the `Mirrored to Jira as KEY` comment on the GitHub issue. Restore it, or delete the newer Jira issue.
- **Project settings:** run `discover` (RUNBOOK step 4). It lists exactly what the Jira project is missing.

## Rules worth knowing

- **GitHub is the source of truth.** The team reads Jira; nobody edits it.
- **State is a label:** `now` (in progress, for as long as the work takes), `blocked`, or none. Closing an issue clears its state and Waiting line on its own. A shipped fix that needs proof closes anyway, with the `verify` label and a `**Verify:** … · **On:** date` line; the brief measures it on that date.
- **Agents finish what they start:** they take the next step themselves when they can, and otherwise say what an issue needs to close and from whom.
- **Docs hold no status.** Anything with a date or a "next step" is an issue.

## This installation

Which projects a devbox tracks, their checkouts and Jira keys, is kept out of this public repo, in a gitignored `INSTALLATION.local.md` next to this file. The list the brief reads is `~/.config/agent-tracking/repos`.
