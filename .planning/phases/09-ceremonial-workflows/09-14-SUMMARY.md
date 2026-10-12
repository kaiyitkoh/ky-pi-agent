---
phase: 09-ceremonial-workflows
plan: 14
subsystem: workflows
tags: [review, scope-drift, review-schema]
requires: ["09-13"]
provides:
  - "compareScope / changedFilesSince: scope drift computed from git, both directions"
  - "REVIEW.md Scope Drift section; model-supplied drift rejected"
affects: ["09-15"]
tech-stack:
  added: []
  patterns: ["structural type redeclaration across subsystem boundary", "reuse of execute/progress.ts git diff and normaliser"]
key-files:
  created:
    - .pi/extensions/review/scope-drift.ts
    - tests/unit/scope-drift.test.ts
    - tests/integration/scope-drift.test.ts
    - tests/unit/review-render.test.ts
  modified:
    - .pi/extensions/execute/progress.ts
    - .pi/extensions/quality/review-schema.ts
    - tests/unit/workflow-budgets.test.ts
decisions:
  - "Drift reads the committed diff base..HEAD only; uncommitted and untracked work is not covered"
  - "An empty declaration makes every change drift (same fail-closed posture as driftAbort)"
requirements-completed: [FLOW-05]
requirements-advanced: [FLOW-08]
duration: ~15 min
completed: 2026-10-13
---

# Phase 9 Plan 14: Scope Drift Summary

Scope drift is now computed from `git diff --name-only <sha>..HEAD` against SPEC expected files union PLAN files-touched, in both directions (drifted and undelivered), and REVIEW.md renders it as a third section the model cannot supply.

## Commits

- e56acf7 feat(09-14): scope-drift comparison over git's own diff (Task 1)
- 519a856 feat(09-14): Scope Drift section and rejection of model-supplied drift (Task 2)
- 7ebc1d7 test(09-14): scope drift from a real diff and the renderer section (Task 3)

## Measurements

- `.pi/extensions/review` DIRECTORY_BUDGETS: new row, 50 (47 measured).
- `.pi/extensions/quality` DIRECTORY_BUDGETS: 2200 -> 2250 (2242 measured; review-schema.ts 392 -> 443).

## Observed behaviour

`git diff --name-only base..HEAD` over a pure rename (`git mv`, unchanged content) reports the new path only. A rename therefore shows as the new path changed and the old path, if declared, as undelivered. The integration test encodes this.

## Falsifications (recorded RED, all restored)

- (a) `drifted: changed`: 8 cases RED, e.g. `AssertionError: expected [ 'a.ts' ] to deeply equal []`.
- (b) `undelivered: []`: 4 cases RED, e.g. `AssertionError: expected [] to deeply equal [ 'src/b.ts' ]`.
- (c) `changedFilesSince` returns `[]` on failure: `AssertionError: expected [Function] to throw an error`.
- (d) drift property added to `submitReviewParameters` and the rejection branch disabled: `AssertionError: expected true to be false` (validateReview) and `AssertionError: expected [ 'scopeDrift' ] to deeply equal []` (schema keys).

## Deviations from Plan

**Post-08.1/08.2 corrections applied**
- AGENTS.md comment rules replaced the plan's long headers and doc-comment requirements: short WHY-only comments, no plan or requirement IDs. Each task verify added `tests/unit/comment-discipline.test.ts`; runs used `--maxWorkers=2`; the full suite was not run (CPU budget).

**1. [Rule 3 - Design] changedFilesSince reuses progress.ts changedFiles; commandFor not used**
`changedFilesSince` validates the base as a hex SHA (so it cannot be read as a git option) and delegates to the existing `changedFiles(cwd, base, "HEAD")` rather than duplicating git-diff code. That function already spawns `git` with an argv array and `shell: false`, and throws on non-zero exit; `commandFor` exists to fold `.cmd` shim invocations into a shell string, which would make this path less safe, not more. The plan's `grep commandFor` acceptance is therefore not met; the injection threat (T-09-14-02) is mitigated by no-shell argv plus SHA validation. As a result scope-drift.ts itself has no subprocess code; its single impure function is a thin wrapper.

**2. [Rule 3 - Design] Shared normaliser**
`normalisePathForDrift` is now exported from `progress.ts` and imported by scope-drift.ts: one declaration site.

**3. [Rule 3 - Design] ScopeDriftReport declared structurally in review-schema.ts**
quality/ does not import review/, keeping the git-reading dependency chain out of its import graph and `importedSubsystemDirs`. The comment states the reason.

**4. [Rule 3 - Design] New test file tests/unit/review-render.test.ts**
No existing renderer test covered `renderReviewMarkdown`, so a new file was created instead of extending one.

**5. Rejection matches any key containing "drift" (case-insensitive)** so `scope_drift` and `scopeDrift` are both refused. The full suite and the dirty-tracked-file tripwire were not run.

## Known Stubs

None. Nothing yet threads a `compareScope` result into a `ReviewArtifact`; the caller (the /review command) is a later plan, and an absent value renders "NOT COMPUTED".

## Threat Flags

None. No new network or auth surface.

## Self-Check: PASSED

Files exist; commits e56acf7, 519a856, 7ebc1d7 present; targeted tests and `tsc --noEmit` clean.
