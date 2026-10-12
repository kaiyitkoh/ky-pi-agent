---
phase: 09-ceremonial-workflows
plan: 13
subsystem: workflows
tags: [execute, evidence-gate, drift-abort, progress]
requires: ["09-11", "09-12"]
provides:
  - "/execute command (evidence-gated, depth-dialled, honestly degrading)"
  - "PROGRESS.md append format and fail-closed driftAbort"
affects: ["09-15"]
tech-stack:
  added: []
  patterns: ["reuse workflows/evidence.ts unmodified", "globalThis run slot for output text"]
key-files:
  created:
    - .pi/extensions/execute/progress.ts
    - .pi/extensions/execute/index.ts
    - tests/integration/execute-workflow.test.ts
  modified:
    - tests/unit/workflow-budgets.test.ts
decisions:
  - "PROGRESS.md is appended only on the evidence accept arm and only after driftAbort allows the git-read changed paths"
  - "If the workflows settle handler consumes the run first, /execute finds no verdict and writes nothing (fail closed)"
requirements-completed: [FLOW-07, QUAL-08]
requirements-advanced: [FLOW-09]
duration: ~25 min
completed: 2026-10-13
---

# Phase 9 Plan 13: /execute Summary

`/execute` runs the next unfinished PLAN task and appends real captured output to PROGRESS.md bound to a harness-read commit SHA, only after the unmodified `gateCompletion` accepts and `driftAbort` allows every path git reports as changed.

## Commits

- c7a174d feat(09-13): PROGRESS append format and fail-closed drift abort (Task 1)
- 5952e3c feat(09-13): the /execute command (Task 2)
- 0e03752 test(09-13): real temp-repo integration test (Task 3)

## Measurements

- `/execute` text total (WORKFLOW_TEXT_BUDGETS `execute`, no skill body): 142 raw lines of 250 (ceiling unmoved).
- `.pi/extensions/execute` DIRECTORY_BUDGETS: 170 -> 370 (progress.ts, 367 measured) -> 510 (index.ts added, 509 measured).
- `index.ts` WORKFLOW_BUDGETS row: 150.
- No tool registered; tool allowlist unchanged.

## Falsifications (recorded RED, all restored)

- (a) PROGRESS append moved before `endRun`: 5 cases RED (fabrication, empty-commit, isError, drift, workflows-first), e.g. `AssertionError: expected 160 to be 11 // Object.is equality`.
- (b) `driftAbort` returns allow on an empty union: the empty-allowance case RED (`expected true to be false`). The drift case stays green because its allowance is non-empty; it is falsified by (a) and by the out-of-union path check, not by this mutation (plan expected both).
- (c) degraded path labelled "delegated": degraded-dispatch case RED (`expected '# Progress\n## T001 @ ...' to contain 'degraded (ordinary prompt loop)'`).

## Deviations from Plan

**Post-08.1/08.2 corrections applied**
- AGENTS.md comment rules replaced the plan's long header/doc-comment requirements (same-discipline header, "WHAT THIS DOES NOT PROVE", branch-by-branch docs). Comments are short WHY-only, no plan or requirement IDs; the draft's `union_` alias and 0.84.1 citation were removed.
- Pi API verified against installed 1.1.0 (`ToolExecutionEndEvent.result/isError`); pi-subagents stays at 0.76.1 and uninstalled.
- Each task's verify added `tests/unit/comment-discipline.test.ts`; runs used `--maxWorkers=2`; the full suite and the audit-concurrency test were not run (CPU budget).

**1. [Rule 3 - Design] progress.ts carries more than one impure function**
The reviewed draft's behaviour was kept: `appendProgress`, `changedFiles` (git diff read, so drift is checked against the tree, not a model claim) and the `globalThis` run-output slot (evidence.ts deliberately keeps no output). The plan's "exactly one impure function" acceptance is not met literally; the header names them.

**2. [Rule 3 - Design] Integration test uses a Pi stand-in, not a faux-provider session**
The test loads the real `execute` and `workflows` factories into a minimal stand-in (commands, handlers, `sendUserMessage` spy) over a real temp git repo. "Zero provider requests" is asserted as zero hand-offs to the model. Chosen to stay inside the CPU budget; the live session path remains covered by RB-09-03.

**3. [Rule 3 - Design] Empty-allowance refusal tested at the predicate**
`validateSpec` and `validatePlan` make an empty allowance unreachable through the command, so that case asserts `driftAbort` halts directly; the command's own empty-allowance refusal remains as defence in depth.

**4. Revision gate is advisory**
`REVISION_CAP`/`stallDetected` drive the rejection notice (retry, or escalate); the command does not auto-retry because retry needs a user turn.

## Known Stubs

None. Delegated dispatch builds the real packet but cannot run until pi-subagents is installed (RB-07-02); FLOW-09 stays `[~]` with RB-09-03.

## Threat Flags

None. No new network or auth surface.

## Self-Check: PASSED

Files exist; commits c7a174d, 5952e3c, 0e03752 present; targeted tests and `tsc --noEmit` clean.
