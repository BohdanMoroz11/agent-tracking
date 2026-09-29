#!/usr/bin/env bash
# Create or update the tracking labels on a GitHub repo.
#
#   ./labels.sh owner/repo                       # the common set (labels.tsv)
#   ./labels.sh owner/repo extra.tsv             # plus project labels, same format
#   ./labels.sh owner/repo [extra.tsv] --prune-defaults
#       also deletes GitHub's default labels that overlap ours (enhancement,
#       good first issue, …), but only those no issue or PR uses
#
# Existing labels with the same name are updated in place (colour, description),
# so issues keep them. Needs `gh` logged in with write access to the repo.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${1:?usage: labels.sh owner/repo [extra.tsv] [--prune-defaults]}"
EXTRA=/dev/null
PRUNE=false
for arg in "${@:2}"; do
  case "$arg" in
    --prune-defaults) PRUNE=true ;;
    *) EXTRA="$arg" ;;
  esac
done

cat "$HERE/labels.tsv" "$EXTRA" | while IFS=$'\t' read -r name color desc; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null
  echo "label: $name"
done

if $PRUNE; then
  for name in enhancement documentation 'good first issue' 'help wanted' invalid question wontfix duplicate; do
    used=$(gh issue list --repo "$REPO" --state all --label "$name" --limit 1 --json number --jq length 2>/dev/null || echo 0)
    prs=$(gh pr list --repo "$REPO" --state all --label "$name" --limit 1 --json number --jq length 2>/dev/null || echo 0)
    if [[ "$used" == 0 && "$prs" == 0 ]]; then
      gh label delete "$name" --repo "$REPO" --yes >/dev/null 2>&1 && echo "deleted unused default: $name" || true
    else
      echo "kept default (in use): $name"
    fi
  done
fi
