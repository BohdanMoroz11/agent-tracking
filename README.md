# agent-tracking

Work tracking for repos where AI agents do most of the work and one person maintains them.

- **GitHub issues are the only tracker.** Every kind of work, not just bugs, with a small label set: a type, a priority (`p1`–`p3`), and at most one state (`now`, `blocked`). An issue that waits on someone starts with `**Waiting on:** … · **Recheck:** YYYY-MM-DD`.
- **Agents keep it up,** following rules installed into each repo's `AGENTS.md`, which works with any agent. They open an issue for what they can't finish or find along the way, and get the issues they start closed: they take the next step themselves, or say what it needs and from whom. Closing clears an issue's state on its own.
- **Jira mirrors GitHub one way,** so the team can see the work. One Jira project per repo.
- **A morning brief** on Telegram, 08:00 Kyiv, from a timer on the devbox. A Claude session per active repo runs the checks that came due (verifies, rechecks) against production, then writes what matters today: what waits on you, what is stuck or forgotten, and questions. Each section ends with the session id, so `claude --resume` picks up the conversation. Quiet repos are skipped.
- **Docs hold no status.** Nothing depends on anyone remembering to update a file.

How the pieces fit, and what to check when something breaks: [HOW-IT-WORKS.md](HOW-IT-WORKS.md). Adding a project: [RUNBOOK.md](RUNBOOK.md).

| Path | What |
| --- | --- |
| `jira-sync/` | Composite action: the Jira mirror (`event`, `backfill`, `discover`) |
| `brief/` | The morning brief: gathers each repo's material, runs a Claude session on it, sends one Telegram message (`prompt.md` is what the session is told) |
| `digest/` | The label-and-date summary the brief uses for its facts and as its fallback; `--print` locally for a quick overview |
| `scheduler/` | The devbox timer that runs the brief at 08:00 Kyiv (`install.sh`) |
| `templates/workflows/` | The workflows `install.mjs` copies into a project: Jira sync, cleanup on close, and a non-blocking PR issue-link check |
| `templates/agents-block.md` | The shared rules, kept between markers in each project's `AGENTS.md` |
| `templates/agents-project.md` | Stub for the project's own section: Jira key, priority wording, extra labels |
| `templates/migration-prompt.md` | Prompt for moving a repo's doc-based tracking into issues |
| `install.mjs`, `labels.sh`, `labels.tsv` | Install or update a project; create its labels |

Tests: `node --test`.
