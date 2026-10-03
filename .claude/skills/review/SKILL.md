---
name: review
description: Production-grade review of the user's code, drip-fed 2 important issues at a time with a persistent queue.
argument-hint: "[optional: files/feature | next | all | fresh]"
disable-model-invocation: true
---

Review the user's code for production-grade quality. Argument: $ARGUMENTS

# Modes

- **(empty or files/feature)**: new review of the given scope. Without a
  scope, review `git diff main...HEAD` plus uncommitted changes.
- **next**: don't re-review. Show the next 2 open important issues from
  `docs/REVIEW_QUEUE.md`.
- **all**: show every open item in the queue, ranked.
- **fresh**: delegate the review to the `reviewer` subagent (independent
  eyes), then present its findings using the rules below.

# Before reviewing

1. Read `docs/decisions/README.md`, `docs/progress/README.md` + the current phase file, and `docs/REVIEW_QUEUE.md`.
2. Re-check open queue items against the current code. Mark the ones the user
   fixed as done. If a fix is wrong or introduced a new problem, that goes to
   the top of the queue.
3. Read beyond the diff where it matters (callers, schema, middleware).

# Review

Pick lenses with `.claude/review-rubric.md`: section 1 by what the code does,
section 2 for the current phase's focus and "don't flag" list. If the current
phase has no entry in section 2, stop and tell the user to draft it first
(via `/problem`) rather than guessing.

Verify every finding in the code. Point to `file:line` and a concrete failure,
or drop it. Skip anything lint/format/typecheck catches. Stay within the
current roadmap phase.

Split findings into **important issues** and **small fixes** (status codes,
naming, minor cleanup).

# Update the queue

Write ALL findings to `docs/REVIEW_QUEUE.md` (create it if missing) in this
format, keeping done items at the bottom:

```
## Open
1. [important] file:line — summary — failure it causes
2. [small] file:line — summary

## Done
- [x] file:line — summary (fixed YYYY-MM-DD)
```

# Present to the user

- Start with the one-line "Checked / Skipped" lens summary (rubric §3).
- Then confirm queue items they fixed, in one line.
- Then at most **2 important issues**, most severe first. For each: what's
  wrong, the concrete failure, why it matters. For a new concept or a design
  issue, end with one guiding question instead of the fix. For something the
  user clearly knows, just state the fix.
- Then **all small fixes**, one line each.
- End with how many important issues remain and the topic of the next one.
  Don't list them.

Never write the fix into the source. The user writes it.

A clean result is a valid result. If nothing meets the bar, say "no important
issues" plainly (plus any real small fixes). Never pad the review with
style preferences, hypotheticals, or later-phase concerns to have something
to report.
