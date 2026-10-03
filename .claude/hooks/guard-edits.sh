#!/usr/bin/env bash
# PreToolUse guard: the user writes the application code. Claude may only edit
# tests, docs, scaffolding config, its own config, and folders the user has
# listed in .claude/unlocked-paths.
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')

[[ -z "$path" ]] && exit 0

# Files outside the project (scratchpad, Claude memory) aren't guarded.
case "$path" in
  "$root"/*) rel="${path#"$root"/}" ;;
  *) exit 0 ;;
esac

# Paths the user explicitly unlocked (one relative prefix per line).
unlock="$root/.claude/unlocked-paths"
if [[ -f "$unlock" ]]; then
  while IFS= read -r prefix || [[ -n "$prefix" ]]; do
    prefix="${prefix%%#*}"; prefix="${prefix//[[:space:]]/}"
    [[ -z "$prefix" ]] && continue
    [[ "$rel" == "$prefix"* ]] && exit 0
  done < "$unlock"
fi

# The guard itself, its settings, and the unlock list stay under user control.
case "$rel" in
  .claude/unlocked-paths | .claude/hooks/* | .claude/settings.json)
    echo "Blocked: '$rel' controls the edit guard. Only the user changes it (or unlocks '.claude/' in .claude/unlocked-paths)." >&2
    exit 2 ;;
esac

case "$rel" in
*.test.ts | *.spec.ts | test/* | */test/* | tests/* | docs/* | .claude/* | CLAUDE.md | \
  package.json | */package.json | tsconfig*.json | */tsconfig*.json | pnpm-workspace.yaml)
    exit 0 ;;
esac

echo "Blocked: '$rel' is application code — the user writes it. Explain the change or pattern instead, or ask the user to add the folder to .claude/unlocked-paths." >&2
exit 2
