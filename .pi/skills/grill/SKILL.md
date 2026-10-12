---
name: grill
description: Interrogates a change into a gated SPEC.md -- verify the codebase before proposing, ask exactly one question per turn, and refuse to let requirements be authored on unverified facts.
---

# grill -- the interrogation procedure

The spec-schema.ts and scorecard.ts modules under .pi/extensions/grill/ are AUTHORITATIVE. If this table disagrees with that code, this table is the bug.

## Procedure

1. Read and grep the codebase for every claim you are about to make. Record each finding as a §2 Verified Codebase Facts row (`claim | file:line or command output | how verified`) BEFORE proposing anything -- an unverified claim cannot become a requirement (FLOW-03).
2. Ask exactly ONE question per turn. Never batch questions.
3. Take the perspective the harness assigns for that question number (table below) -- rotate, never repeat one lens twice in a row.
4. Stop after 5 questions (`HARD_QUESTION_BUDGET`), whatever the scorecard says. The harness tells you each turn's slot; when it says the budget is spent, write SPEC.md and ask nothing more.
5. Score the four dimensions below honestly and write the §8 scorecard as a table of `| <dimension-id> | <score> |` rows plus an `Overall: <score>` line.
6. Write SPEC.md with the write tool. At the end of every turn the harness runs the full gate on it; a refusal comes back to you on the next turn.

## Ambiguity dimensions (floor 0.7, higher is better; overall gate <= 0.20, lower is better, and gated as the stricter of your Overall and 1 - the mean dimension score -- two separate scales, see scorecard.ts)

| id | meaning | a low score means |
| --- | --- | --- |
| factual-grounding | every §2 claim is actually backed by evidence | you are about to build on something false about the codebase |
| requirement-precision | every requirement carries a runnable acceptance criterion | the user only finds the mismatch when they see wrong output |
| failure-coverage | §4 names the REAL failure paths, not filler | the happy path works but edge cases were invented or missing |
| scope-definiteness | §5's in/out-of-scope lists are closed | the change builds more or less than asked |

## Interview perspectives (rotate in this order; 5 perspectives, 5-question budget)

| id | surfaces |
| --- | --- |
| researcher | does the codebase already do this, and does the SPEC's own claim about it actually hold? |
| simplifier | is there a smaller version of this that still satisfies the goal? |
| boundary-keeper | what is explicitly NOT part of this change? |
| failure-analyst | what's the worst thing that could go wrong, and what does a broken version look like? |
| seed-closer | of everything asked so far, what is the single highest-impact question still unanswered? |

## SPEC.md outline (§1-§8, in this order)

| § | section | required content | consumer |
| --- | --- | --- | --- |
| 1 | Goal | one falsifiable sentence | every downstream reader (plan, execute, review) |
| 2 | Verified Codebase Facts | `claim \| evidence \| how verified` table, every row evidenced; prefix a claim with `[R#]` to hand it to that requirement's executor | this skill's own evidence gate (FLOW-03) |
| 3 | Requirements | one entry per id, each opening its own line (`R1: ...`): statement, current state, target state, acceptance criterion | /plan, /review |
| 4 | Error and Edge Behaviour | >= 3 entries, each `IF <condition> THEN THE SYSTEM SHALL <response>` | /plan, /review |
| 5 | Scope Pin | In scope / Out of scope (non-empty, each with a reason) / Expected files | /review's drift detector |
| 6 | Clarifications Log | `- Q: <question> -> A: <answer>` | a future human or agent re-reading this SPEC |
| 7 | Assumptions | anything not verified in §2, plus `⚠ ASSUMPTION` overrides | /review |
| 8 | Ambiguity Scorecard | the four dimension scores + overall + gate result | the ambiguity gate itself |

§4's required form, quoted once: `IF <condition> THEN THE SYSTEM SHALL <response>` -- exact case. Lower case wording, or `SHOULD` in place of `SHALL`, is rejected by code, not by this sentence.

## What will refuse you (structural, not negotiable)

- Not on `main`/`master`, or `/grill --resume` with nothing to resume: the command's own git pre-flight (`classifyGitInvocation`).
- §3 authored before §2 is evidenced: `gateRequirementsAuthorship`.
- §1/§4/§5 malformed or incomplete: `validateSpec`.
- Ambiguity score over gate, or any dimension below its floor (no override): `gateAmbiguity`.
- §3 with no `R<n>` id, or an empty §6/§7: `validateGatedSpec`, which /plan, /execute and /review re-run too.
