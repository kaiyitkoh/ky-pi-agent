---
phase: 09-ceremonial-workflows
plan: 16
subsystem: testing
tags: [artifacts, budgets, flow-10]
requires: ["09-15"]
provides: ["FLOW-10 artifact cap as a filesystem assertion", "WORKFLOW_TEXT_BUDGETS completeness gate"]
affects: [tests/unit/artifact-count.test.ts, tests/unit/workflow-budgets.test.ts]
key-files:
  created: [tests/unit/artifact-count.test.ts]
  modified: [tests/unit/workflow-budgets.test.ts]
requirements-completed: [FLOW-10]
duration: ~20 min
completed: 2026-10-13
---

# Phase 9 Plan 16: Artifact cap and workflow text budget closure Summary

The four real write paths (writeSpecIfGated, writePlanIfGated, appendProgress, the REVIEW.md render) are driven in a temp dir and the result must equal `ARTIFACT_FILES` exactly; all five workflows now have a completeness-checked, measured `WORKFLOW_TEXT_BUDGETS` row. No production change.

## Commits

- a882af2 test(09-16): artifact-count.test.ts (Task 1)
- 112a84a test(09-16): WORKFLOW_TEXT_BUDGETS completeness and recorded-sum assertions (Task 2)

## Measurements (countRawLines, 2026-10-13)

| Workflow | Measured | Ceiling |
|---|---|---|
| grill | 110 + 58 = 168 | 250 |
| plan | 113 + 44 = 157 | 200 |
| execute | 142 | 250 |
| review | 123 + 50 = 173 | 250 |
| quick | 84 (`workflows/index.ts`) | 100 |

Phase total: 724 raw lines against the 1,050 ceiling total. `/quick` is 84, so it did not grow; its independent `toBeLessThanOrEqual(100)` still exists (now near line 903, not :642) and I added a second explicit one in the text-budget block.

## Falsifications (recorded verbatim)

- Equality vs containment: the planted `scorecard.json` case is a live expected-failure test (`artifact set is [..., scorecard.json, ...], expected exactly [...]`); a nested `notes/handoff-packet.json` fails with `unexpected subdirectory`.
- (a) execute row deleted: `FEATURES_CEILINGS declares 'execute' but WORKFLOW_TEXT_BUDGETS has 0 rows for it -- add its row (exactly one)`.
- (b) `deploy` row added: `WORKFLOW_TEXT_BUDGETS row 'deploy' is not in FEATURES_CEILINGS -- delete the row, or add the ceiling from FEATURES.md Part 2`.
- Both mutations were made on uncommitted working copies and reverted with `git checkout -- <file>`.

## Deviations from Plan

**1. [Design] Plan and review section consumers live in the test.** Production has no section data for PLAN.md or REVIEW.md, and adding it would move DIRECTORY_BUDGETS ceilings, which may not move. The test tables are cross-checked for equality against the headings the real renderers emit, so a new or removed section turns it red. This is weaker than production-owned data (T-09-16-03 only partly met for these two files). SPEC_SECTIONS and ARTIFACT_FILES are asserted from production data.

**2. [Fact] REVIEW.md has five sections, not four.** `renderReviewMarkdown` also emits Classification.

**3. [Rule 1] Stale `why` figures corrected.** grill (193), plan (184) and quick (99) no longer matched the files; updated to the measured figures so the new why-states-the-sum assertion holds.

**4. [Design] Consumer resolution.** Slash commands named in each `ARTIFACT_FILES` consumer are checked against `registerCommand("...")` literals scanned from `.pi/extensions/*/index.ts`; non-command consumers (the human reviewer, the MR) are checked only for non-emptiness.

**5. Post-08.1/08.2 corrections applied.** Only tests touched; the stale 09-16 hand-off comment in workflow-budgets was replaced by a short WHY comment (no plan IDs). Verified with targeted vitest runs (`--maxWorkers=2`: artifact-count, workflow-budgets, comment-discipline) and one `npx tsc --noEmit` (clean). The full suite was not run (CPU budget).

## Known Stubs

None.

## Self-Check: PASSED

tests/unit/artifact-count.test.ts exists; commits a882af2 and 112a84a exist.
