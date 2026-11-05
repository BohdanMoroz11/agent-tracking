#!/usr/bin/env bash
# Install (or update) the morning brief timer as a systemd user unit on this machine.
#
#   scheduler/install.sh
#
# Needs: systemd with user lingering on (`loginctl enable-linger $USER`), so the
# timer runs without a login session; node and claude installed for this user;
# ~/.config/agent-tracking/telegram.env (TELEGRAM_BOT_TOKEN=…, TELEGRAM_CHAT_ID=…).
# Creates ~/.config/agent-tracking/repos if missing; add a repo to it when a
# project joins (RUNBOOK.md). Removes the old digest timer, which it replaces.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNITS="$HOME/.config/systemd/user"
CONF="$HOME/.config/agent-tracking"
REPOS="${AGENT_TRACKING_REPOS:-$CONF/repos}"

# A stable node: fnm's per-shell path disappears with the shell, so prefer its
# default alias, else the resolved binary.
NODE="$HOME/.local/share/fnm/aliases/default/bin/node"
[[ -x "$NODE" ]] || NODE="$(readlink -f "$(command -v node)")"
CLAUDE="$(command -v claude || true)"
[[ -x "$NODE" ]] || { echo "node not found" >&2; exit 1; }
[[ -n "$CLAUDE" ]] || { echo "claude not found on PATH" >&2; exit 1; }
RUN_PATH="$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/local/bin:/usr/bin:/bin"

mkdir -p "$UNITS" "$(dirname "$REPOS")"
if systemctl --user list-unit-files agent-tracking-digest.timer --no-legend 2>/dev/null | grep -q .; then
  systemctl --user disable --now agent-tracking-digest.timer || true
  rm -f "$UNITS"/agent-tracking-digest{.timer,.service,-failed.service}
  echo "removed the old digest timer"
fi
for unit in agent-tracking-brief.service agent-tracking-brief-failed.service; do
  sed -e "s#%KIT%#$KIT#g" -e "s#%NODE%#$NODE#g" -e "s#%PATH%#$RUN_PATH#g" "$KIT/scheduler/$unit" > "$UNITS/$unit"
done
cp "$KIT/scheduler/agent-tracking-brief.timer" "$UNITS/agent-tracking-brief.timer"
if [[ ! -e "$REPOS" ]]; then
  printf '# Repos the morning brief covers: owner/name [checkout] [title], one per line.\n' > "$REPOS"
  echo "created $REPOS — add owner/name lines to it"
fi
[[ -r "$CONF/telegram.env" ]] || echo "warning: no $CONF/telegram.env, so the brief cannot be sent and a failure sends no alert"

[[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == yes ]] ||
  echo "warning: lingering is off, so the timer only runs while you are logged in (loginctl enable-linger $USER)"
systemctl --user daemon-reload
systemctl --user enable --now agent-tracking-brief.timer
systemctl --user list-timers agent-tracking-brief.timer --no-pager
echo "Test it the way the timer runs it (this runs the agents and sends the brief):"
echo "  systemctl --user start agent-tracking-brief.service && journalctl --user -u agent-tracking-brief.service -n 20 -o cat"
