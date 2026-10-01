# How it works

Every moving part of the tracking setup, where it runs, what starts it, and what it needs. Adding a project is [RUNBOOK.md](RUNBOOK.md); this page is for understanding the setup and fixing it.

## The pieces

```
                    agents (any: Claude, Codex, Cursor…) follow AGENTS.md → Work tracking
                                        │ open, label, comment, close
                                        ▼
                               GitHub issues (the source of truth)
                     ┌──────────────────┴───────────────────┐
         issue event │                                      │ read
                     ▼                                      │
        tracking-jira-sync.yml                    tracking-digest.yml ◄── workflow_dispatch ◄── devbox timer, 08:00 Kyiv
        → jira-sync action                        → digest action
                     │                                      │
                     ▼                                      ▼
            Jira (one project per repo,           Telegram (one message per repo,
            read-only for the team)               to the user's private chat)
```

| Piece | Lives in | Started by | Needs |
| --- | --- | --- | --- |
| Rules for agents | each repo's `AGENTS.md`, between the `agent-tracking` markers, plus its own "Work tracking in this repo" section | read by every agent at session start | nothing |
| Jira mirror | `jira-sync/` here; `.github/workflows/tracking-jira-sync.yml` in each repo | every issue event (opened, edited, labeled, closed…), or by hand for `discover` / `backfill` | secrets `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`; variable `JIRA_PROJECT_KEY` (unset = off) |
| Daily digest | `digest/` here; `.github/workflows/tracking-digest.yml` in each repo | `workflow_dispatch` only: the devbox timer, or by hand | secret `TELEGRAM_BOT_TOKEN`; variable `TELEGRAM_CHAT_ID` (unset = off); optional `DIGEST_TITLE` |
| Digest timer | `scheduler/` here, installed as systemd user units on the devbox | systemd, every day at 08:00 Europe/Kyiv | `~/.gh-token.txt` (classic token, `repo` + `workflow`); `~/.config/agent-tracking/repos` |
| PR ↔ issue check | `.github/workflows/tracking-issue-link.yml` in each repo | every PR | nothing; it only warns, never fails |
| Labels | `labels.tsv` here, plus each repo's `.github/tracking-labels.tsv` | `labels.sh`, by hand | `gh` |

The scripts run from the moving `v1` tag of this repo, so a fix here reaches every project once the tag moves. Templates (workflows, the AGENTS.md block) are copied into each repo by `install.mjs` and need a re-install and a PR per repo.

## The daily digest

The devbox timer runs `scheduler/dispatch-digests.sh`, which asks GitHub to start `tracking-digest.yml` in every repo listed in `~/.config/agent-tracking/repos`. Each run reads its repo's issues and sends one Telegram message.

**Why not GitHub's own cron.** The workflows used `schedule:` at first. Within two days GitHub started the runs for two repos six hours late, and on the third day not at all, while the third repo ran on time. GitHub documents scheduled runs as best-effort under load. A dispatched run starts within seconds, and the timer has `Persistent=true`, so if the devbox was off at 08:00 it sends as soon as the devbox is back.

**The devbox is the dependency.** If it is off for a day, the digest comes when it is back on, not at 08:00.

## When the digest doesn't arrive

1. **Did the timer fire?**
   - `systemctl --user list-timers agent-tracking-digest.timer` shows the last and next run.
   - `journalctl --user -u agent-tracking-digest.service --since today` shows one line per repo, either "digest started" or the HTTP error.
2. **Did the runs succeed?** `gh run list --repo <repo> --workflow tracking-digest.yml --limit 3`, then `gh run view <id> --log` for a failure. The log prints the digest before sending it, so a Telegram error is easy to tell apart from a GitHub one.
3. **The usual causes:**
   - **HTTP 401 from the dispatch:** the token in `~/.gh-token.txt` expired or was revoked.
   - **`Telegram sendMessage → 403`:** `TELEGRAM_CHAT_ID` is wrong. The bot's own id, which is the number before the `:` in its token, is not a chat id.
   - **The run is "skipped":** the repo has no `TELEGRAM_CHAT_ID` variable.
   - **One repo never gets one:** it isn't listed in `~/.config/agent-tracking/repos`.
4. **To send one now:** `scheduler/dispatch-digests.sh owner/name`, or `gh workflow run tracking-digest.yml --repo owner/name`.

To see a digest without sending it: `node digest/digest.mjs --print --repo owner/name`.

## When Jira looks wrong

- **Nothing syncs:** `JIRA_PROJECT_KEY` is unset on the repo, or the run failed. Check `gh run list --workflow tracking-jira-sync.yml`.
- **A Jira edit disappeared:** that is by design. The mirror is one way, and the next GitHub event overwrites the Jira issue. Only a Jira assignee is kept.
- **A duplicate Jira issue:** someone deleted the `Mirrored to Jira as KEY` comment on the GitHub issue. Restore it, or delete the newer Jira issue.
- **Project settings:** run `discover` (RUNBOOK step 4). It lists exactly what the Jira project is missing.

## Rules worth knowing

- **GitHub is the source of truth.** The team reads Jira; nobody edits it.
- **State is a label:** `now`, `next`, `blocked`, or none. A shipped fix that needs proof closes anyway, with the `verify` label and a `**Verify:** … · **On:** date` line, and the digest raises it on that date.
- **Docs hold no status.** Anything with a date or a "next step" is an issue.

## This installation

| Project | Repo | Local checkout | Jira |
| --- | --- | --- | --- |
| Cargo Finance | `CargoETL/cargo-finance` | `~/projects/cargo-finance` | `CFL20` |
| CargoHub | `BohdanMoroz11/shipper-portal` | `~/projects/shipper-portal` | `CSP` |
| ClaraHR | `AltekLLC/hr-ai` | `~/projects/hr-ai` | `CHA` |

- **All three repos** carry the same Jira credentials and Telegram bot. Each has its own `JIRA_PROJECT_KEY`. CargoHub sets `DIGEST_TITLE=CargoHub`.
- **The digest timer** runs on the user's devbox, not on any deployment server.
- **Each repo's `TELEGRAM_CHAT_ID` variable** holds the chat id.
