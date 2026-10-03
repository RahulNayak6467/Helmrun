---
name: drill
description: Interview drill on a finished phase or topic — questions one at a time, push back on vague answers, record weak spots.
argument-hint: "[optional: phase number or topic]"
disable-model-invocation: true
---

Run a short mock-interview drill. Topic: $ARGUMENTS
(If empty, use the most recently finished phase in `docs/progress/README.md`.)

# Prepare (silently)

Read the phase spec in `docs/phases/`, its progress file in `docs/progress/`,
the relevant decisions in `docs/decisions/`, and the code that implements the
phase. Questions must be about what the user actually built and decided, not
generic trivia.

# Run the drill

Act as a backend / AI-platform interviewer. Ask 3–5 questions, **one at a
time**, waiting for each answer:

1. Start with an open "walk me through how X works in Helmrun" (2–3 min answer).
2. Then dig: "what happens if…" failure questions (crash mid-step, duplicate
   message, two requests at once, dependency down).
3. At least one "why this and not that?" tradeoff question tied to a recorded
   decision (e.g. SQS vs Kafka, leases vs locks).
4. Optionally one "how would you change it at 100x scale?" question.

After each answer, respond like an interviewer would:
- If it's vague, hand-wavy, or skips the failure case, push back with one
  follow-up ("and if the worker dies right after that write?").
- If it's solid, say so in one line and move on.
- Don't lecture mid-drill. Save corrections for the debrief.

# Debrief

After the last question:
- **Strong**: 1–2 lines on what was clear and precise.
- **Weak spots**: each gap in one line, plus what a strong answer would have
  included (the key idea, not a script).
- **Delivery**: one note on structure or clarity (rambling, no summary first,
  missing the "why"), if relevant.

Append the weak spots to the "Interview weak spots" section of the phase's
`docs/progress/phase-N.md` (create the section if missing), dated. Revisit
these before internship drives.
