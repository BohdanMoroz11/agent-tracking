# Runbook: adding a project

Adds a repo to the pipeline: GitHub issues as the tracker, rules the agents follow, a one-way Jira mirror, and the morning brief on Telegram. About an hour, most of it reviewing the migration.

Each step is safe on its own. The workflows do nothing until their repo variable is set, so a project can be installed today and connected to Jira next week.

## Once, for all projects

You only do this the first time.

1. **Jira API token.** Create one at <https://id.atlassian.com/manage-profile/security/api-tokens>. Note your Jira site URL (`https://<site>.atlassian.net`) and the email you log in with.
2. **Telegram bot.**
   1. In Telegram, message [@BotFather](https://t.me/BotFather): `/newbot`, pick a name. It replies with the bot token.
   2. Open a chat with your new bot and send it `/start`. (To post to a group instead, add the bot to the group and send `/start@<botname>` there.)
   3. Find the chat id. The token is read without echoing, so it stays out of your shell history. Each line shows a chat that has messaged the bot, with its name, so you can tell which is yours:

      ```bash
      read -rsp "bot token: " TG; echo; curl -s "https://api.telegram.org/bot$TG/getUpdates" | grep -o '"chat":{"id":-\?[0-9]*,[^}]*'; unset TG
      ```

      A private chat id is a positive number; a group id is negative. **The number before the `:` in the bot token is the bot's own id, not a chat id**: using it fails with "the bot can't send messages to the bot". If nothing prints, send the bot `/start` first.
3. **This kit** cloned locally: `git clone git@github.com:BohdanMoroz11/agent-tracking.git ~/projects/agent-tracking`, with `gh` logged in and Node 22+.
4. **The brief timer** on the devbox, which sends the morning brief at 08:00 Kyiv ([how it works](HOW-IT-WORKS.md#the-morning-brief)):
   1. `claude` installed and logged in, with the same settings you work with (it runs in auto mode and reads production the way your sessions do), and `gh` logged in.
   2. `~/.config/agent-tracking/telegram.env`, mode 600, with `TELEGRAM_BOT_TOKEN=…` and `TELEGRAM_CHAT_ID=…`. The brief and the failure alert are sent with it.
   3. `~/projects/agent-tracking/scheduler/install.sh`. It installs a systemd user timer, and creates `~/.config/agent-tracking/repos`, the list of repos the brief covers. Then test it **through systemd**, as the script prints. A run from your own shell can pass while the timer fails, as [HOW-IT-WORKS](HOW-IT-WORKS.md#the-morning-brief) explains.

## Per project

Below, `REPO=owner/name` and `DIR=~/projects/name`.

### 1. Jira project

Create a new project. **Team-managed, Kanban** is simplest. Then:

- **Statuses:** the workflow needs `To Do`, `In Progress`, `Blocked` and `Done`. Team-managed projects have no `Blocked` by default: board → ⋯ → *Manage workflow* (or *Columns and statuses*) → add `Blocked`, and allow transitions to and from any status.
- **Issue types:** `Bug`, `Story` and `Task`. These are the defaults.
- **Priority field:** it must be on each issue type's layout. In a team-managed project: *Project settings* → *Issue types* → each type → add *Priority*.

Step 4 checks all of this for you (`discover`), so a miss here is caught before anything is written.

### 2. Install

```bash
node ~/projects/agent-tracking/install.mjs $DIR
~/projects/agent-tracking/labels.sh $REPO --prune-defaults     # add a .tsv of extra labels if the project has any
```

`install` writes three workflows (`tracking-jira-sync.yml`, `tracking-on-close.yml`, which clears an issue's state when it closes, and `tracking-issue-link.yml`, a non-blocking warning on a PR that references no issue), removes the ones the kit no longer ships, and puts the shared rules into `AGENTS.md`. Give the repo a PR template with a `Fixes #` line if it has none. Then, by hand or with an agent:

- **Fill in "Work tracking in this repo"** in `AGENTS.md`: the Jira key, and what `p1` and `p2` mean for *this* product. `p1` is "someone is harmed right now" in its terms: money, data, a customer, a lost lead.
- **Other agent entry points:** if the repo has `.cursor/rules/`, add a one-line rule that points to AGENTS.md → Work tracking. A `CLAUDE.md` or `.github/copilot-instructions.md` that symlinks to `AGENTS.md` needs nothing.
- **Remove the old tracking rules** from `AGENTS.md`, if it has any: a STATUS file to read first, check-in rituals, backlog docs to update.

Commit on a branch and open a PR. Merging it changes nothing yet, because the workflows are still off.

Extra labels file format (tab-separated, `#` comments allowed):

```
tenant:acme	0e8a16	Tenant: Acme
```

### 3. Migrate tracking out of the docs

Give any agent the prompt in [`templates/migration-prompt.md`](templates/migration-prompt.md). It finds every doc that tracks work, checks each item against the code and git history, and **stops with a proposal**. Review and edit that proposal; this is the step that needs you. After you approve, the agent creates the issues and trims the docs in its own commit.

Also tell the agent what is only in your head for this project, in any form. It files that too.

Do this **before** step 4, so the Jira backfill picks up the whole set at once.

### 4. Jira sync

Set the secrets. `gh secret set` prompts for the value, so nothing lands in your shell history:

```bash
gh secret set JIRA_BASE_URL  --repo $REPO     # https://<site>.atlassian.net
gh secret set JIRA_EMAIL     --repo $REPO
gh secret set JIRA_API_TOKEN --repo $REPO
```

Check the project and preview the backfill. Issue events are still ignored at this point, because the `JIRA_PROJECT_KEY` variable is not set yet; manual runs name the project themselves:

```bash
gh workflow run tracking-jira-sync.yml --repo $REPO -f mode=discover -f project_key=KEY
gh run watch --repo $REPO $(gh run list --repo $REPO --workflow tracking-jira-sync.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

The log ends with `ready` or a list of `PROBLEMS`. Fix those in Jira and run it again. Then preview the backfill, and read its log:

```bash
gh workflow run tracking-jira-sync.yml --repo $REPO -f mode=backfill -f dry_run=true -f project_key=KEY
```

Switch the sync on and run the real backfill:

```bash
gh variable set JIRA_PROJECT_KEY --repo $REPO --body KEY
gh workflow run tracking-jira-sync.yml --repo $REPO -f mode=backfill -f dry_run=false
```

From now on, every issue change syncs on its own. New Jira issues are assigned to the token's owner; set the `JIRA_ASSIGNEE_ACCOUNT_ID` variable to assign them to someone else.

### 5. Morning brief

Have a checkout of the repo on the devbox (the brief's session runs in it), then add it to the list:

```bash
echo "$REPO" >> ~/.config/agent-tracking/repos      # or: owner/name ~/path/to/checkout Title
node ~/projects/agent-tracking/brief/brief.mjs --repo $REPO --force     # one brief now, printed, not sent
```

The printed run already does the due checks, so it may comment on issues. From now on the repo is in the 08:00 brief whenever something happened or came due.

### Done when

- The PR from step 2 is merged.
- `discover` says `ready`, the backfill has run, and a test issue edit shows up in Jira within a minute.
- The repo is in `~/.config/agent-tracking/repos`, and a printed brief for it reads right.
- The repo's docs no longer hold any status.

## Changing the kit

- **The brief** (`brief/`, `scheduler/`) runs from this checkout on the devbox: a change lands with `git pull`; re-run `scheduler/install.sh` when a unit changes.
- **Scripts** (`jira-sync/`): every project runs them from the `v1` tag, so a change reaches all projects once the tag moves:

  ```bash
  node --test && git push && git tag -f v1 && git push -f origin v1
  ```

  A breaking change (new required inputs, renamed secrets) goes to `v2`, and each project moves when it re-installs.
- **Templates** (the workflows, the AGENTS.md block): re-run `node install.mjs $DIR` in each project and commit the result. The project's own "Work tracking in this repo" section is never overwritten.

## Troubleshooting

- **Issue events don't sync:** `JIRA_PROJECT_KEY` is not set on the repo.
- **`no transition to "Blocked"`:** the Jira workflow lacks the status, or has no transition to it. See step 1.
- **`Jira refused the priority field`:** Priority is not on that issue type's layout. The sync carries on without it.
- **A duplicate Jira issue:** each GitHub issue gets a `Mirrored to Jira as KEY` comment, and the sync follows it. Deleting that comment makes the next event create a second issue.
- **No brief one day:** see [HOW-IT-WORKS.md → When the brief doesn't arrive](HOW-IT-WORKS.md#when-the-brief-doesnt-arrive).
- **An org blocks the action:** the org's Actions settings must allow actions from `BohdanMoroz11/agent-tracking`, or all actions.
