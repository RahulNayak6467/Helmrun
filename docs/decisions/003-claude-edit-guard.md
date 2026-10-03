# 003: Claude edits source only in folders the user unlocks (2026-10-03)

Phase: 0
Status: Accepted

## Decision
A PreToolUse hook (`.claude/hooks/guard-edits.sh`) blocks Claude's file edits
except:
- tests (`*.test.ts`, `*.spec.ts`, `test/` folders), `docs/`, `CLAUDE.md`
- `package.json`, `tsconfig*.json`, `pnpm-workspace.yaml` at any level
- Claude's own config under `.claude/`, except the guard, the hook settings,
  and the unlock list
- any path prefix the user lists in `.claude/unlocked-paths`

To get boilerplate written, the user adds a folder to `.claude/unlocked-paths`
and removes it afterwards.

## Why
The user writes the core code; that is the point of the project. Hooks enforce
this regardless of how long a session runs. What counts as boilerplate changes
per phase, so an explicit per-request unlock keeps the user in control.

## Alternatives considered
- Permanently open boilerplate folders (`**/routes/`, `**/schemas/`): less
  friction, but route handlers easily accumulate core logic.
- Instructions only: no guarantee in long sessions.

## Known gap
The guard covers the Edit/Write tools, not shell commands. Not writing source
through Bash is a rule in `CLAUDE.md`.
