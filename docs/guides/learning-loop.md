# Learning loop

How to build a feature so you come out understanding it, not just holding
working code. Sits on top of the mechanical workflow in
`workflow-walkthrough.md` (`/problem` → design check → build → `/review` →
tests → `/wrap`).

## Two modes

- **Learn mode**: anything that could break under concurrency, leak data, or
  come up in an interview (auth, tenant isolation, versions, the run
  transaction, quotas, the error boundary). You write it, full loop.
- **Ship mode**: patterns you've already built (more CRUD, OpenAPI entries,
  config, docs). Understand it; delegate or go fast.

Handing a learn-mode piece to Claude costs a "handover tax": predict the code
in 2 lines first, get a 5-line walkthrough, answer 2 questions, and log
"handed over: X, revisit" in the phase file.

## The five questions

Ask them of every design and every first version of the code:

| Question | Ask | Typical fix |
|---|---|---|
| **Evil** | What if someone sends something nasty on purpose? | Zod at the boundary; identity from the key, never the body |
| **Twice** | What if it runs twice, or two requests at once? | Unique constraint, row lock, idempotency key |
| **Halfway** | What if it crashes in the middle? | One transaction: all or nothing |
| **Down** | What if Postgres or Redis isn't there? | Error boundary; decide fail open or closed on purpose |
| **Later** | In a month, or with 100× the data? | Explicit response mapping, indexes, keyset pagination, pinning |

Answer each as a short story ("two requests both read 49 and both insert"),
not a term. If you can't tell the story, you don't understand the problem yet.

## The loop, per feature

1. **Orient (15 min).** Read only the spec section. Write 3 lines in your own
   words: what it is, who calls it, what breaks without it.
2. **Guess first, then `/problem` (30 min).** Write your naive design in 5
   bullets before reading anything. Then `/problem` and its targeted reading.
3. **Break it (30–60 min).** Reproduce the failure in miniature: two `psql`
   terminals, parallel curl, stop a dependency, `EXPLAIN` before and after.
   Write a prediction before each run.
4. **Teach-back (10 min).** Explain the design in 5 sentences. If you can't,
   go back to step 2, not to code.
5. **Design check + ADR draft (45 min).** Bullets: data, flow, failure modes,
   security. Draft the ADR yourself, including "alternatives considered".
6. **Build thin, then harden.**
   - Turn the design bullets into comments in the function.
   - Replace one comment at a time; run after each step (try SQL in `psql`
     first).
   - Every "→" branch in the comments gets code and a test.
   - Happy path end to end first, then the five questions.
7. **`/review`.** Before fixing each important finding, write a "missed
   because" line: why you missed it and the principle.
8. **Tests.** You list cases in plain English (normal → concurrency →
   failure); `tester` implements them. Read what it writes.
9. **Re-break it (15 min).** Rerun the step 3 experiment against the finished
   code. It should now fail safely.
10. **`/wrap` + mini-drill + interview story.** Three questions answered
    without notes; a 4-line story: problem, naive approach, what you built,
    tradeoff.

Done means: you could rebuild it from a blank file in about 30 minutes,
explaining every line.

## Notes

One file per phase (`docs/notes/phase-N.md`), one section per feature,
written in your own words while you work:

```markdown
## <Feature>
**In my words**:          3 lines, before /problem
**My naive guess**:       5 bullets
**Predicted → happened**: mark wrong predictions ✘ and say why
**Why not the other way**: each alternative and why not
**Missed because**:       from /review, one line each
**Interview story**:      problem / naive / built / tradeoff
**Q&A for later**:        questions only; answer from memory later
**Still unclear**:        your next reading
```

Concept notes (theory modules) swap "Missed because" for **Mental model**
(a picture), **When it helps / when it doesn't**, and **Where it shows up in
Helmrun**.

## Pattern cards

Every review finding becomes a card in `docs/notes/practices.md`. The
**smell** line is what lets you spot it yourself next time:

```markdown
### Check-then-act
- Smell:     I read something, decide, then write, and two requests can do this at once
- Story:     two creates both count 49, both insert → 51 agents
- Fix:       unique constraint, or lock the shared parent row (FOR UPDATE) in a transaction
- Cost:      creates for one tenant take turns
- Elsewhere: seat booking, wallet balance, stock, idempotency keys
```

After each finding: write the card, fix it from memory, grep your code for
the same smell, add one Q&A line.

## Reviewing what you learned

- Before designing a feature: skim the smell lines as a checklist (30 s).
- After 2 days, after a week, and again in exam weeks: answer the Q&A from
  memory.
- A "2nd time: <pattern>" in a review means that card needs another look; it
  goes to `/drill`.

## Signs it's working

- Your predictions get more accurate feature by feature.
- You catch the wrong-tenant or check-then-act bug before `/review` does.
- Review findings shift from important to small.

Signs it isn't: skipping predictions to save time, not being able to rebuild
last week's code, the same pattern recurring, reaching for "you do" on
learn-mode pieces. Two of those in a week means slow down.
