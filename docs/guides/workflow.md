# Helmrun workflow

How every phase, feature, and session runs. Agreed with the user on
2026-10-07, starting with phase 1. `CLAUDE.md` points here; the Mentor style
covers how Claude talks.

## 1. Two modes, labelled at `/problem`

Claude proposes a label for every step; the user confirms. A label never
changes mid-build.

- **Learn**: anything that can break under concurrency, leak data, or come up
  in an interview (auth, tenant isolation, versions, transactions, quotas,
  error and lifecycle code). The user writes every line.
- **Ship**: a pattern already built once, config, docs, scaffolding. Claude
  writes it after the **handover tax**: the user predicts it in 2 lines,
  Claude gives a 5-line walkthrough, the user answers 2 questions.

## 2. The feature loop (learn mode)

1. **Understand.** Write 3 lines in your own words (what, who uses it, what
   breaks without it) and your naive guess. Then `/problem`. Theory is read
   just before the step that needs it.
2. **Break.** Predict, then reproduce the failure in miniature (two `psql`
   terminals, parallel curl, stop a service, `EXPLAIN`).
3. **Design.** Send bullets (data, flow, failure modes, security). Claude
   replies with the three-level table (child / target / enterprise / in
   scope?) and a build checklist of what the target must handle. **No target
   code.** A real decision becomes an ADR the user drafts.
4. **Build.** Comments first, then one small step at a time, running after
   each. Stuck → `stuck: <what>` → a nudge, then a pattern, then at most a
   small snippet.
5. **Self-spar, then `/spar`.** Check your own code against your smell cards
   first and note what you find. Then `/spar <files>` walks the edge cases one
   at a time; you propose each fix, it pushes back, you implement the agreed
   checklist.
6. **`/review`.** The final check. For each important finding write a "missed
   because" line, then fix it yourself. Claude may do small fixes.
7. **Test.** You list cases in plain English (normal → concurrency →
   failure); `tester` implements them and proposes extras.
8. **Own.** Rerun the step 2 experiment (it should now fail safely). Compare
   your code with Claude's target version and its 1–10 score. Answer 3 drill
   questions without notes. Write a 4-line interview story (problem, naive,
   built, tradeoff). **Only now is the feature done.**

Done means: you could rebuild it from a blank file in about 30 minutes,
explaining every line.

## 3. Sessions

**Start.** The user gives the session length. Claude replies with:
- the budget line, e.g. `Phase 1: 18.0 / 52.5 h used · 16.5 h of tasks done · on track (need ≥ 0.9, at 0.92)`
- a 5-minute warm-up recall question (not counted)
- the minimum tasks for the session, each with mode, estimate, and a
  "done when" check that can be verified
- one stretch task

**Theory.** Each phase has a concept map (`docs/study/phase-N-concepts.md`,
drafted at the phase's `/problem`). Session plans add each concept as a
task right before the step that needs it. Don't read ahead.

**Types.** Theory, build, and review sessions are separate. A build session
only builds.

**During.** The budget is not mentioned. If a step takes twice its estimate,
stop and say so: the step is too big or the design is unclear.

**End.** `/wrap` records tasks done, their estimates, actual time, and the
budget line.

## 4. Time budget

- **Phase budget = the middle of the spec's estimate + 5 h.**

  | Phase | Spec | Budget |
  |---|---|---|
  | 1 | 40–55 | 52.5 h |
  | 2 | 45–60 | 57.5 h |
  | 3 | 50–65 | 62.5 h |
  | 4 | 65–85 | 80 h |
  | 5 | 45–60 | 57.5 h |
  | 6 | 40–55 | 52.5 h |
  | 7 | 55–70 | 67.5 h |
  | 8 | 50–65 | 62.5 h |

- At `/problem` for a phase, its steps are split into tasks whose estimates
  add up to the middle estimate.
- **Per session: finish at least session length × (middle ÷ budget)** in
  planned tasks (phase 1: 0.9, so 1.8 h in a 2 h session). A shortfall
  carries over.
- Estimates are recalibrated weekly from actual times.
- A compass, not a whip: understanding time is never rushed. If the phase
  is projected over budget, cut **ship-mode scope**, never learn steps.
- Leave room for curiosity: a "what happens if…" detour of up to 15 minutes
  is welcome.

## 5. Code level: robust but plain (target ≈ 8.5/10)

- **Robust:** validated input, tenant checks in every query, transactions and
  locks where state is shared, errors through the boundary, safe logs, tests
  on what can actually break.
- **Plain:** readable top to bottom. A layer, helper, or package appears only
  when there's a real reason: a second user, or a rule that needs a home.
  Duplicate twice, abstract on the third use.
- **Enterprise parts:** only those that close a real gap at Helmrun's scale.
  The test: *what breaks today if I don't build this?* Real → build it.
  Imaginary → write it down as "later, when measured".

## 6. Retention

- **Notes:** `docs/notes/phase-N.md`, one section per feature, in your own
  words, written while working:

  ```markdown
  ## <Feature>
  **In my words**: 3 lines, before /problem
  **My naive guess**: 5 bullets
  **Predicted → happened**: wrong predictions marked ✘ with why
  **Why not the other way**: each alternative and why not
  **Missed because**: one line per /spar or /review finding
  **Found by me / by /spar**: X / Y
  **Interview story**: problem / naive / built / tradeoff
  **Q&A for later**: questions only
  **Still unclear**: your next reading
  ```

- **Pattern cards:** `docs/notes/practices.md`, one per pattern (not per
  bug). The smell is what you're learning:

  ```markdown
  ### Check-then-act
  - Smell:     I read, decide, then write, and two requests can do this at once
  - Story:     two creates both count 49, both insert → 51 agents
  - Fix:       unique constraint, or lock the shared parent row in a transaction
  - Elsewhere: seat booking, wallet balance, stock, idempotency keys
  ```

- **Spaced recall:** session warm-ups pull from Q&A and cards 2–3 days and a
  week after a feature.
- **Drill:** 3 questions per feature at step 8; `/drill` per phase. A
  pattern that shows up twice ("2nd time: …") goes to the drill.

## 7. Guardrails (standing permission from the user)

- If the user asks Claude to write learn-mode code, Claude declines once,
  kindly, and offers a nudge. The user can override explicitly; the handover
  is then logged in the phase file as "handed over: X, revisit".
- Learn-mode folders are not added to `.claude/unlocked-paths` for Claude.

## 8. Standing rules

- No comments in code or tests.
- No Claude watermark in commit messages.
- One branch per feature, merged into `main` (from phase 1).
- Behind schedule: cut ship scope, never learn steps.
