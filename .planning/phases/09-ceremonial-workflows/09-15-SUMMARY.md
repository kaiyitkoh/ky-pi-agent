---
phase: 09-ceremonial-workflows
plan: 15
subsystem: workflows
tags: [review, mr, glab, safety]
requires: ["09-14"]
provides:
  - "/review command composing reviewer, refute-or-promote, scope drift, REVIEW.md"
  - "buildMrBody / mrCreateArgv / openMr: evidence-built MR body, classify-then-exec glab"
affects: ["09-16", "09-17"]
tech-stack:
  added: []
  patterns: ["injected executor for classification proofs", "stubbed glab on PATH for the argv proof"]
key-files:
  created:
    - .pi/extensions/review/mr.ts
    - .pi/extensions/review/index.ts
    - .pi/skills/review/SKILL.md
    - tests/integration/review-mr.test.ts
  modified:
    - .pi/extensions/safety/git.ts
    - tests/unit/workflow-budgets.test.ts
decisions:
  - "MR target is the named constant MR_TARGET_BRANCH = staging; the classifier is the sole refuser of absent/protected targets"
  - "Review base is git merge-base HEAD staging"
  - "PROGRESS.md is passed as the reviewer's deterministic gate report instead of re-running the gates"
requirements-completed: [QUAL-08]
requirements-advanced: [FLOW-08]
duration: ~25 min
completed: 2026-10-13
---

# Phase 9 Plan 15: /review and the MR step Summary

`/review` builds the six-part reviewer contract from disk, runs the existing review and refute-or-promote mechanisms, writes REVIEW.md with code-computed scope drift, and opens an MR only through `openMr`, which classifies the glab argv before any execution and always names an explicit `staging` target.

## Commits

- d6fc85d feat(09-15): /review command, mr.ts, skill, budget rows (Tasks 1 and 2)
- e942679 test(09-15): MR step against injected executor and stubbed glab (Task 3), plus a classifier fix

## Measurements

- `review` text total: index.ts 123 + SKILL.md 50 = 173 raw lines against the frozen 250 ceiling.
- `.pi/extensions/review` DIRECTORY_BUDGETS: 50 -> 290 (47 + 123 + 117 = 287).
- New WORKFLOW_BUDGETS rows: index.ts 130, SKILL.md 50. New WORKFLOW_TEXT_BUDGETS row `review` 250.
- `registerTool(` in review/: none; TOOL_REGISTRATION_ALLOWLIST unchanged.

## Falsifications (committed first, mutated, restored)

- (a) exec before classify: 5 RED, e.g. `refuses target "main" and executes nothing` and `a blocked target never reaches the stub`.
- (b) omit `--target-branch` when target is staging: 4 RED, `AssertionError: expected 'refused' to be 'opened'` (the classifier refuses the omitted target).
- (c) classifier case-sensitive compare: 1 RED, `refuses target "MAIN"`: `AssertionError: expected 'opened' to be 'refused'`.
- (d) disclosure removed from the body: 1 RED, `AssertionError: expected '## Why\n\nAdd the a module.\n\n## Wha…' to contain 'Disclosure: this change and this desc…'`.

## Deviations from Plan

**Post-08.1/08.2 corrections applied.** Short WHY-only comments, no plan/requirement IDs in comments; targeted vitest runs with `--maxWorkers=2` (workflow-budgets, comment-discipline, chokepoint-lint, contributing-boundary, extension-layout, tool-count-baseline, git-policy, review-mr); full suite not run (CPU budget).

**1. [Rule 1 - Bug] Empty `--target-branch` value was treated as an explicit target.** Found by the empty-target test: `extractMrCreateTarget` returned `""`, which is not protected, so the classifier allowed it. Fixed in `.pi/extensions/safety/git.ts` (non-blank value required). Commit e942679.

**2. [Rule 3] Tasks 1 and 2 share one commit (d6fc85d).** The budget registry rows for both land together; splitting would leave the budget test red between commits.

**3. [Design] Deterministic gate report.** The plan says to pass already-captured gate output. No capture store exists, so PROGRESS.md (the verified output recorded per task by /execute) is passed as the gate report; `runQuickGateStage` is not re-run.

**4. [Design] Review base.** No base SHA is persisted, so the command uses `git merge-base HEAD staging` and refuses if that fails.

**5. [Design] Body file in OS temp dir.** The MR body is written to a temp directory, removed afterwards, to avoid adding a fifth `.pi/work` artifact.

**6. [Design] Calibration not run.** `gateDepthFor("review")` lists calibration, but it scores seeded-defect fixtures, which have no meaning for a live change; only deterministic (passed), model-review and refute-or-promote run.

**7. [Design] Mr merge proof.** `openMr` can only build `mr create`, so the merge refusal is asserted on `classifyGlabInvocation` directly (the function `openMr` calls).

**8. BLOCKER stop.** Beyond the plan's classification stop, any surviving BLOCKER also stops before the MR (no approval prompt); symptomatic/workaround stops use `ctx.ui.confirm`.

## UNVERIFIED

- The `--description-file` flag name is not confirmed against the installed glab; a body-by-file flag is required by the plan and the real flag must be checked on the work laptop (RB-09-02, OUTSTANDING).
- The stub success path ran on Windows via a shell (`spawnExec` uses `shell: true` with `commandFor`), so the allowed-path argv proof did execute; GitLab acceptance, target existence and server-side protection remain unproven (RB-09-02, RB-04-01).
- `/review` end to end (real provider call, real glab) was not run; no live call was made.

## Known Stubs

None.

## Self-Check: PASSED

mr.ts, index.ts, SKILL.md, review-mr.test.ts exist; commits d6fc85d and e942679 exist.
