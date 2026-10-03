---
name: wrap
description: Save session progress and decisions to docs so the next session starts with full context.
argument-hint: "[optional: notes to include]"
disable-model-invocation: true
---

Wrap up the session (or a checkpoint in a long one) so nothing depends on
chat history. Extra notes from the user: $ARGUMENTS

Base everything on what actually happened: code written, reviews, decisions.
Check `git status` / `git diff` rather than relying on memory.

# 1. Update the current phase file: `docs/progress/phase-N.md`

N is the `Current phase:` line in `docs/progress/README.md`. Create the file
if missing. Keep it short and current: rewrite it, don't append a diary.

```
# Phase N — Title

Spec: `docs/phases/phase-N-….md`

## Status
One or two lines.

## Done
- … (YYYY-MM-DD)

## Next step
The single next concrete action.

## Open questions
- …

## Interview weak spots
- (filled by /drill)
```

Keep any existing "Interview weak spots" entries.

# 2. Update `docs/progress/README.md`

- Update the phase's row in the status table.
- If the phase is finished (its exit criteria in the spec are met and the
  user agrees), mark it Done and bump `Current phase:`. When bumping, list any
  Deferred items for the new phase in the report so they aren't forgotten.
- Compare progress against the checkpoints. If a checkpoint is at risk, say so
  in the report. Don't edit the schedule without the user.

# 3. Record decisions in `docs/decisions/`

For each architecture or design decision the user agreed to this session:
- Create `docs/decisions/NNN-short-title.md` (next number):

```
# NNN: Title (YYYY-MM-DD)

Phase: N
Status: Accepted

## Decision
…

## Why
…

## Alternatives considered
- … (and why not)
```

- Add a row to the index table in `docs/decisions/README.md`.
- If it replaces an earlier decision, set the old file's status to
  "Superseded by NNN" and update its index row.

Only record decisions the user actually agreed to. Discussed-but-unsettled
items go under Open questions in the phase file instead.

# 4. Tidy `docs/REVIEW_QUEUE.md`

Mark items fixed this session as done. Don't add new findings. That's
`/review`'s job.

# 5. Commit safety check

Before proposing a commit message, check what would be committed. Use
`git status --porcelain`, `git diff`, `git diff --cached`, and
`git ls-files --others --exclude-standard` (untracked, not ignored).

**a. Files that should be ignored.** Flag any staged, modified, or untracked
file that must never be committed:
- env files other than `.env.example` / `.env.test.example`
- keys and certs (`*.pem`, `*.key`, `*.p12`, `*.crt`), `secrets/`
- Terraform state, plans, `*.tfvars`, `.terraformrc`
- build/test/cache output (`node_modules/`, `dist/`, `coverage/`, `.next/`,
  `*.tsbuildinfo`, `.eslintcache`), logs, local data dirs
- `.claude/settings.local.json`, `.claude/unlocked-paths`

Also run `git ls-files -ci --exclude-standard` to catch files that are
already tracked even though `.gitignore` now ignores them (they need
`git rm --cached`).

If this session introduced a new tool that produces local artifacts (cache,
reports, data dir) and `.gitignore` doesn't cover it, propose the exact lines.
You can't edit `.gitignore`; the user adds them.

**b. Secrets in content.** Scan the diff and untracked files for:
- private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- provider keys: AWS (`AKIA`/`ASIA` + 16 chars), OpenAI (`sk-`), Anthropic
  (`sk-ant-`), Google (`AIza`), GitHub (`ghp_`, `github_pat_`), Helmrun API
  keys (`hr_live_`)
- connection strings or `password=` / `token=` / `secret=` with real-looking
  values (test-only values from `.env.test.example` are fine)
- real values in `.env.example` files (they should hold placeholders)
- hardcoded credentials in source, tests, docs, or compose files

Never print a found secret in full. Show file:line and a masked value
(`sk-ant-…a1b2`).

**c. Result.**
- Something found → put it at the top of the report as **blocking**, with
  the fix (unstage, add to `.gitignore`, move to env, rotate if it was ever
  committed or pushed). Don't propose a commit message until it's resolved.
- Nothing found → one line: "Commit check: clean."

This is a best-effort check, not a full secret scanner.

# 6. Commit message

Propose a short commit message: one imperative subject line, under ~60
characters. No body unless the change genuinely needs a "why" that the
subject can't carry, and then at most 2 lines. Do NOT commit. The user
commits.

# 7. Report

In 3–5 lines: commit check result first if anything was found, then what
you updated, the next step, checkpoint status, and the proposed commit
message. If anything was ambiguous (e.g. whether a decision was final), ask.
