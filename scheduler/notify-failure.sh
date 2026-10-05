#!/usr/bin/env bash
# Tell the user on Telegram that the digest timer failed, with the log lines
# that say why. systemd runs this through OnFailure= on the digest service, so
# a broken timer is noticed the same morning rather than days later.
#
# Needs ~/.config/agent-tracking/telegram.env (mode 600):
#   TELEGRAM_BOT_TOKEN=...
#   TELEGRAM_CHAT_ID=...
# Without it there is nothing to send with: it logs that and exits.
set -uo pipefail

ENV_FILE="${AGENT_TRACKING_TELEGRAM_ENV:-$HOME/.config/agent-tracking/telegram.env}"
if [[ ! -r "$ENV_FILE" ]]; then
  echo "digest timer failed, and $ENV_FILE is missing, so no alert was sent" >&2
  exit 0
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

log=$(journalctl --user -u agent-tracking-digest.service --since "-15min" -o cat --no-pager 2>/dev/null | tail -8)
text="⚠️ agent-tracking: the daily digest timer failed on $(hostname), so today's digests were not started.

${log:-no log lines found}

Check: journalctl --user -u agent-tracking-digest.service
Retry: systemctl --user start agent-tracking-digest.service"

curl -sS -o /dev/null -w '%{http_code}\n' "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${text}"
