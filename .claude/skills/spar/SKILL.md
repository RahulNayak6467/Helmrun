---
name: spar
description: Walk the user's own code through its edge cases one at a time, Socratically, so the user finds and fixes them. Never writes code.
argument-hint: "<files or feature>"
disable-model-invocation: true
---

Spar with the user over the edge cases of their code. Scope: $ARGUMENTS
(if empty, the user's uncommitted changes plus `git diff main...HEAD`).

This is step 5 of the feature loop in `docs/guides/workflow.md`: the happy
path works, and `/review` comes after. The goal is that the **user** finds
and fixes the edge cases. You never write or edit their code, and you never
show the target code (that comes at step 8, after `/review` passes).

# Prepare (silently)

1. Read the code in scope, plus what it calls and what calls it.
2. Read the feature's design notes, the decisions it touches
   (`docs/decisions/`), and the user's pattern cards (`docs/notes/practices.md`).
3. If the user's notes have a self-spar list for this feature, read it.
4. Run the five questions over the code: **evil** (hostile input), **twice**
   (repeats, concurrency), **halfway** (crash or failure mid-way), **down**
   (a dependency unavailable or slow), **later** (time, growth, scale).
   Verify each candidate against the code; drop anything you can't tie to a
   concrete line and sequence.

# Open

Show one table, no code:

| # | Question | Edge case (one plain line) | Your code today |
|---|---|---|---|

"Your code today" is `?` unless the user's self-spar already covered it
(then ✔, and say so: it counts as found by them). Order by severity. Keep it
to the cases that matter, usually 4–7.

Say: "One at a time. Start with #1."

# Each round

1. Ask the user to walk through what their code does in that situation.
   Use a small concrete story ("Redis is down. Walk me through your function
   line by line.").
2. Let them find it. If stuck, give the next rung only: a sharper question →
   a hint at the principle → a pattern in words. No code.
3. When they propose a fix, push on it with the next edge case it creates
   (e.g. "you delete on revoke — what if a lookup writes after your delete?").
   Agree when it's sound; say clearly when it's good.
4. If a concept is new, explain it in plain words with an everyday picture,
   then the term (Mentor style). Suggest a one-minute experiment when that
   would show it faster than words.
5. If the edge case matches one of their pattern cards, name the card. If the
   same pattern shows up a second time across features, say
   "2nd time: <pattern>" — it goes to `/drill`.
6. The user may decide to defer a case ("skip until measured"). Accept it if
   the risk is bounded and say what the bound is.

Move to the next round only when the current one has an agreed approach.

# Close

Show the agreed checklist:

```
✔ #1 <agreed fix, one line>
✔ #2 …
○ #6 deferred: <why, and the bound>
```

Then remind the user to:
- write one pattern card per new pattern in `docs/notes/practices.md`
  (smell, story, fix, elsewhere),
- record "found by me / by /spar" in the feature notes,
- implement the checklist, then run `/review`.

Don't add findings to `docs/REVIEW_QUEUE.md`; that's `/review`'s job.
