#!/usr/bin/env bash
# SessionStart: inject current progress, the decision index, and the review
# queue so every session (including after /compact or /clear) starts from the
# recorded state.
set -uo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

show() {
  local file="$root/$1"
  if [[ -f "$file" && -s "$file" ]]; then
    printf '\n===== %s =====\n' "$1"
    cat "$file"
  else
    printf '\n===== %s: (empty or missing) =====\n' "$1"
  fi
}

echo "Helmrun project state (from docs/). Treat recorded decisions as the baseline."
show docs/progress/README.md

phase=$(grep -m1 -oE '^Current phase: *[0-9]+' "$root/docs/progress/README.md" 2>/dev/null | grep -oE '[0-9]+$')
[[ -n "$phase" ]] && show "docs/progress/phase-$phase.md"

show docs/decisions/README.md

queue="$root/docs/REVIEW_QUEUE.md"
if [[ -f "$queue" && -s "$queue" ]]; then
  open=$(sed -n '/^## Open/,/^## Done/p' "$queue" | grep -c '^[0-9]\+\.' || true)
  printf '\n===== docs/REVIEW_QUEUE.md: %s open item(s) (use /review next) =====\n' "$open"
fi

unlock="$root/.claude/unlocked-paths"
if [[ -f "$unlock" ]] && grep -qvE '^\s*(#|$)' "$unlock"; then
  printf '\n===== Unlocked for Claude edits (.claude/unlocked-paths) =====\n'
  grep -vE '^\s*(#|$)' "$unlock"
fi
exit 0
