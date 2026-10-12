---
phase: 09-ceremonial-workflows
plan: 17
subsystem: docs
tags: [docs, runbook, requirements, docs-policy]
requires: ["09-16"]
provides:
  - "docs/WORKFLOWS.md extended with five code-derived tables, rationale prose and honest status"
  - "RB-09-01..03 OUTSTANDING, governed from table and subsection"
  - "REQUIREMENTS.md reconciled for all eleven Phase 9 ids"
affects: []
tech-stack:
  added: []
  patterns: ["two-directional doc/code derivation (Group F in docs-policy.test.ts)"]
key-files:
  created: []
  modified:
    - docs/WORKFLOWS.md
    - docs/RUNBOOK.md
    - tests/unit/docs-policy.test.ts
    - .planning/REQUIREMENTS.md
decisions:
  - "FEATURES_CEILINGS and WORKFLOW_TEXT_BUDGETS are not exported, so the doc test reads them from the registry's source text"
  - "FLOW-05 and FLOW-06 are reconciled to Complete because 09-14 and 09-10 delivered their second halves"
requirements-completed: [FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06, FLOW-07, FLOW-10, QUAL-03, QUAL-08]
requirements-advanced: [FLOW-08, FLOW-09]
duration: ~35 min
completed: 2026-10-13
---

# Phase 9 Plan 17: Workflows doc, runbook entries, requirements reconciliation Summary

`docs/WORKFLOWS.md` now documents the four ceremonial workflows from five tables asserted against code in both directions, `RB-09-01..03` are recorded OUTSTANDING and machine-governed, and REQUIREMENTS.md ends with nine `[x]` and FLOW-08/FLOW-09 `[~]`.

## Commits

- bac82d0 docs(09-17): RB-09-01..03 OUTSTANDING and PHASE_NINE_IDS governance (Task 2)
- db2be1f docs(09-17): WORKFLOWS.md extension and Group F derivation tests (Task 1)
- d812bfe docs(09-17): requirements reconciliation (Task 3)

Task 2 was committed before Task 1 so the runbook falsifications ran from a committed baseline.

## Final requirement status (both places agree)

| ID | Status |
|---|---|
| FLOW-02, FLOW-03, FLOW-04, FLOW-05, FLOW-06, FLOW-07, FLOW-10, QUAL-03, QUAL-08 | `[x]` / Complete |
| FLOW-08 | `[~]` Partial, `RB-09-01` and `RB-09-02` inline |
| FLOW-09 | `[~]` Partial, `RB-09-03` inline; offline delta -447 (134 vs 581 estimated tokens), sign reported as measured |

## Falsifications (verbatim, all restored)

- Fake gate-depth row (`deploy`): `doc and code disagree on the set of workflows: expected [ 'deploy', 'execute', 'grill', …(3) ] to deeply equal [ 'execute', 'grill', 'plan', …(2) ]`
- Artifact row deleted: `doc and code disagree on the artifact set: expected [ 'SPEC.md', 'PLAN.md', 'REVIEW.md' ] to deeply equal [ 'SPEC.md', 'PLAN.md', …(2) ]`
- (a) table cell PASSED, status line OUTSTANDING: `RB-09-01 is recorded as INCONSISTENT ... expected 'INCONSISTENT' to be 'OUTSTANDING'` (plus the table-row case)
- (b) both places PASSED: `RB-09-01 is recorded as PASSED ... expected 'PASSED' to be 'OUTSTANDING'`
- (c) `...PHASE_NINE_IDS` removed from `ALL_IDS`: `docs/RUNBOOK.md declares these ids and no phase array in this file lists them ...: expected [ 'RB-09-01', 'RB-09-02', 'RB-09-03' ] to deeply equal []`
- (d) pin changed to the fragment `mr view`, also present in a neighbouring entry: `RB-09-02 pin "mr view" must occur exactly once; a repeat lets another entry satisfy it: expected 2 to be 1`

## Deviations from Plan

**Post-08.1/08.2 corrections applied.** Appended after RB-08-04 and `PHASE_EIGHT_TWO_IDS`; line references located by heading; targeted vitest only (`docs-policy.test.ts`, `--maxWorkers=2`) plus one `npx tsc --noEmit` (clean). No `.pi/**/*.ts` was touched, so comment-discipline was not needed.

**1. [Design] Workflow table derived from the registry's source text.** `FEATURES_CEILINGS` and `WORKFLOW_TEXT_BUDGETS` are unexported constants in a test file; importing the file would re-run its suites. Group F reads and parses that file's text, and asserts the parse is non-empty.

**2. [Design] Exactly-once check added as a new Group B case** (`every Phase 9 pin occurs exactly once`) rather than changing the existing `toContain` loop for earlier phases.

**3. [Design] FLOW-05 and FLOW-06 status table rows moved from Partial to Complete**, and their stale "job of 09-14 / 09-10" tails rewritten, because 09-14 and 09-10 delivered them (their SUMMARYs list them under requirements-completed).

**4. [Not run, CPU budget] The full suite and the 10-consecutive `checkpoint-store` run were not executed**, per the run instructions. `audit-concurrency` was not run.

**5. [Honest limits recorded in docs]** `--description-file` is unverified against real glab (in RB-09-02 and WORKFLOWS.md section 10); `/review`'s diff base is the merge-base with `staging`; `/review` does not run calibration on a live diff though the gate table lists it.

**6. Mid-task tooling slip.** An initial scripted edit inserted a fixture block at the wrong place in `docs-policy.test.ts`; the file was reverted with `git checkout -- <file>` (it had no other uncommitted work) and the edits were redone with the Edit tool.

## Known Stubs

None.

## Threat Flags

None. RB-09-02 names the repository `<work-repo>`; no host or account identifier was added. No package was installed.

## Self-Check: PASSED

docs/WORKFLOWS.md, docs/RUNBOOK.md, tests/unit/docs-policy.test.ts and .planning/REQUIREMENTS.md modified; commits bac82d0, db2be1f, d812bfe exist; docs-policy 122/122 green; tsc clean.
