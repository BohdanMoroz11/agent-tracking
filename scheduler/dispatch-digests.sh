#!/usr/bin/env bash
# Start the tracking digest in every listed repo, now.
#
# GitHub's own cron is not used for the digest: scheduled runs were delayed by
# six hours or skipped outright. A workflow_dispatch starts within seconds, so a
# systemd timer on the devbox calls this at 08:00 Kyiv (see HOW-IT-WORKS.md).
#
#   scheduler/dispatch-digests.sh            # every repo in the repos file
#   scheduler/dispatch-digests.sh owner/name # just one
#
# Env:
#   AGENT_TRACKING_TOKEN_FILE  default ~/.gh-token.txt — a GitHub token that can
#                              run workflows in every listed repo (classic: repo +
#                              workflow scopes). Never printed.
#   AGENT_TRACKING_REPOS       default ~/.config/agent-tracking/repos — one
#                              owner/name per line, # comments allowed.
set -euo pipefail

TOKEN_FILE="${AGENT_TRACKING_TOKEN_FILE:-$HOME/.gh-token.txt}"
REPOS_FILE="${AGENT_TRACKING_REPOS:-$HOME/.config/agent-tracking/repos}"
WORKFLOW=tracking-digest.yml

[[ -r "$TOKEN_FILE" ]] || { echo "no token at $TOKEN_FILE" >&2; exit 1; }
TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"

if (($#)); then
  repos=("$@")
else
  [[ -r "$REPOS_FILE" ]] || { echo "no repos file at $REPOS_FILE" >&2; exit 1; }
  mapfile -t repos < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$REPOS_FILE" | grep -v '^$')
fi

api() {
  curl -sS -o /tmp/agent-tracking-dispatch.$$ -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' "$@"
}
trap 'rm -f /tmp/agent-tracking-dispatch.$$' EXIT

failed=0
for repo in "${repos[@]}"; do
  code=$(api "https://api.github.com/repos/$repo")
  if [[ "$code" != 200 ]]; then
    echo "$repo: cannot read the repo (HTTP $code)" >&2; failed=1; continue
  fi
  branch=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).default_branch)' /tmp/agent-tracking-dispatch.$$)
  code=$(api -X POST "https://api.github.com/repos/$repo/actions/workflows/$WORKFLOW/dispatches" -d "{\"ref\":\"$branch\"}")
  if [[ "$code" == 204 ]]; then
    echo "$repo: digest started"
  else
    echo "$repo: dispatch failed (HTTP $code): $(head -c 300 /tmp/agent-tracking-dispatch.$$)" >&2; failed=1
  fi
done
exit "$failed"
