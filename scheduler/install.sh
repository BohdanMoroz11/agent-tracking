#!/usr/bin/env bash
# Install (or update) the digest timer as a systemd user unit on this machine.
#
#   scheduler/install.sh
#
# Needs: systemd with user lingering on (`loginctl enable-linger $USER`), so the
# timer runs without a login session; the token file (see dispatch-digests.sh).
# Creates ~/.config/agent-tracking/repos if missing; add a repo to it when a
# project joins (RUNBOOK.md, step 5).
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNITS="$HOME/.config/systemd/user"
REPOS="${AGENT_TRACKING_REPOS:-$HOME/.config/agent-tracking/repos}"

mkdir -p "$UNITS" "$(dirname "$REPOS")"
sed "s#%KIT%#$KIT#" "$KIT/scheduler/agent-tracking-digest.service" > "$UNITS/agent-tracking-digest.service"
cp "$KIT/scheduler/agent-tracking-digest.timer" "$UNITS/agent-tracking-digest.timer"
if [[ ! -e "$REPOS" ]]; then
  printf '# Repos whose daily digest the timer starts: owner/name, one per line.\n' > "$REPOS"
  echo "created $REPOS — add owner/name lines to it"
fi

[[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == yes ]] ||
  echo "warning: lingering is off, so the timer only runs while you are logged in (loginctl enable-linger $USER)"
systemctl --user daemon-reload
systemctl --user enable --now agent-tracking-digest.timer
systemctl --user list-timers agent-tracking-digest.timer --no-pager
