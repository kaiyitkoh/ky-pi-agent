---
name: plan-ceremony
description: Turns a gated SPEC.md into a PLAN.md task list and coverage matrix that code -- not prose -- validates before it is ever written to disk.
---

# plan-ceremony -- the task-form and coverage-matrix procedure

.pi/extensions/plan-ceremony/plan-schema.ts is AUTHORITATIVE. If this table disagrees with that code, this table is the bug.

## Task-line grammar (one line per task)

| element | required/optional | example | what code rejects |
| --- | --- | --- | --- |
| `T###` id | required, exactly 3 digits | `T003` | `T1`, `T0001`, no id at all |
| `[P]` parallel marker | optional | `[P]` | nothing -- it is genuinely optional |
| `[R#,R#,...]` requirement group | required, >= 1 id | `[R2,R5]` | an absent group, or an empty `[]` |
| verb + explicit path | required; the path is the LAST token before the separator | `Add rotation to src/auth/session.ts` | no token matches a legal repo-relative path |
| ` \| verify:<command>` (the named `VERIFICATION_SEPARATOR`) | required | `\| verify: npm test` | the separator absent, or nothing non-empty follows it |

Full form: `- [ ] T### [P] [R#,R#,...] <verb> <path> | verify:<command>`.

## Coverage matrix -- both directions, both required

- Every requirement id the SPEC declares must be cited by at least one task -- an uncited requirement was never planned for.
- Every requirement id a task cites must be one the SPEC actually declares -- an invented id is rejected too, never silently accepted.

## The three PLAN.md parts, each with a named consumer

| part | consumer |
| --- | --- |
| Task list | `/execute` -- its per-task self-contained handoff |
| Coverage matrix | `/review` -- read into its requirement verdict table |
| Files-touched union | `/review` -- the drift baseline, alongside SPEC §5 |

A part with no consumer does not ship.

A path declared here becomes `/execute`'s write allowance -- it is a PERMISSION, not a description, so a glob is rejected the same way an absolute path or a `..` segment is.

## What will refuse you (structural, not negotiable)

- Not on `main`/`master`: the command's own git pre-flight (`classifyGitInvocation`).
- No gated SPEC.md on disk, or one that fails its own gate: `validateGatedSpec`, re-run every invocation, never trusted from a prior turn.
- Zero task lines, any malformed line, a duplicate id, a pathless or commandless task, or coverage broken in either direction: `validatePlan`, run on PLAN.md at the end of every turn; a refusal comes back to you on the next turn.
