# agent-tracking

Work tracking for repos where AI agents do most of the work and one person maintains them.

- **GitHub issues are the only tracker.** Every kind of work, not just bugs, with a small label set: a type, a priority (`p1`–`p3`), and at most one state (`now`, `next`, `blocked`). An issue that waits on someone starts with `**Waiting on:** … · **Recheck:** YYYY-MM-DD`.
- **Agents keep it up,** following rules installed into each repo's `AGENTS.md`, which works with any agent. They open an issue for what they can't finish or find along the way, keep its labels right, and report what they changed.
- **Jira mirrors GitHub one way,** so the team can see the work. One Jira project per repo.
- **A daily Telegram digest**, started at 08:00 Kyiv by a timer on the devbox, reads the issues and says what needs you: rechecks that are due, idle `p1`s, `now` items that have gone quiet, broken labels. Then what's in flight, and the last 24 hours.
- **Docs hold no status.** Nothing depends on anyone remembering to update a file.

How the pieces fit, and what to check when something breaks: [HOW-IT-WORKS.md](HOW-IT-WORKS.md). Adding a project: [RUNBOOK.md](RUNBOOK.md).

| Path | What |
| --- | --- |
| `jira-sync/` | Composite action: the Jira mirror (`event`, `backfill`, `discover`) |
| `digest/` | Composite action: the Telegram digest; `--print` locally for an on-demand overview |
| `scheduler/` | The devbox timer that starts every project's digest at 08:00 Kyiv (`install.sh`, `dispatch-digests.sh`) |
| `templates/workflows/` | The workflows `install.mjs` copies into a project: Jira sync, digest, and a non-blocking PR issue-link check |
| `templates/agents-block.md` | The shared rules, kept between markers in each project's `AGENTS.md` |
| `templates/agents-project.md` | Stub for the project's own section: Jira key, priority wording, extra labels |
| `templates/migration-prompt.md` | Prompt for moving a repo's doc-based tracking into issues |
| `install.mjs`, `labels.sh`, `labels.tsv` | Install or update a project; create its labels |

Tests: `node --test`.
