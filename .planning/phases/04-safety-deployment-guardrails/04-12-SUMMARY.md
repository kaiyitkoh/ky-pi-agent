---
phase: 04-safety-deployment-guardrails
plan: 12
subsystem: safety
tags: [gitlab, runbook, requirements-traceability, docs-policy, unbash]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: docs/RUNBOOK.md (Phases 1-3 sections), tests/unit/docs-policy.test.ts's RB-<phase>-<n> guard, .pi/extensions/safety/git.ts's classifyGitInvocation
provides:
  - "tests/integration/gitlab-push-protection.test.ts — SAFE-01's offline proxy: a real bare repo with a POSIX-sh pre-receive hook, a real push rejected server-side, a paired non-protected-branch success control, and a real non-fast-forward rejection for the classifier's negative direction"
  - "classifyPushFailure() in .pi/extensions/safety/git.ts — a pure reader that distinguishes a protected-branch push rejection from any other push failure"
  - "docs/RUNBOOK.md's Phase 4 section — RB-04-01 (SAFE-01), OUTSTANDING in both the summary table and the detail subsection"
  - "tests/unit/docs-policy.test.ts governs RB-04-01 via PHASE_FOUR_IDS folded into ALL_IDS, with an ENTRY_COMMANDS pin for all four whole-line commands"
  - "REQUIREMENTS.md traceability for all sixteen non-SAFE-16 SAFE requirements, with delivering plan numbers"
affects: [phase-05-routing-capability-guards, phase-08-quality-gates, phase-10-context-budget]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SAFE-01's offline proxy composes tests/helpers/git.ts's spawn discipline (shell:false, windowsHide:true) and tests/helpers/stub-bin.ts's disposable-directory shape against a real bare repo and a real pre-receive hook subprocess, mirroring git-head-main.test.ts's disposable-checkout pattern but for a disposable SERVER"
    - "A push-failure classifier reads stderr TEXT rather than exit code, because every push rejection reason shares the same non-zero exit code"
    - "The Phase 4 runbook entry uses <work-repo> and <WorkspaceId>-style placeholders for account-identifying information, following the RB-03-01/RB-03-03 precedent, rather than the file's own 'no placeholder to guess at' ideal, because the real GitLab remote URL is company-identifying information in a public repo"

key-files:
  created:
    - tests/integration/gitlab-push-protection.test.ts
  modified:
    - .pi/extensions/safety/git.ts
    - docs/RUNBOOK.md
    - tests/unit/docs-policy.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "SAFE-01 stays [~] partial, never [x] — the offline proxy exercises a real server-side pre-receive hook and proves the harness reads and classifies a rejection correctly, but proves nothing about whether GitLab is actually configured on the work laptop; RB-04-01 is named inline and stays OUTSTANDING"
  - "The non-fast-forward negative control for classifyPushFailure() is produced by genuinely diverging two clones (real git, no hook involved), not by handing the classifier a synthetic string — the classifier's negative direction is proven against a REAL ordinary failure"
  - "RB-04-01's exact-command contract uses a <work-repo> placeholder rather than the real GitLab remote URL, following the RB-03-01/RB-03-03 precedent for account-identifying information in a public repo"

patterns-established:
  - "A push-failure classifier is a pure TEXT reader (stderr in, classification out), never a wrapper around git push itself — kept symmetric with git.ts's existing classifyGitInvocation/classifyGlabInvocation pure-classifier shape"

requirements-completed: [SAFE-01]

# Metrics
duration: ~25min
completed: 2026-08-14
---

# Phase 4 Plan 12: SAFE-01's Offline Proxy and Phase Close Summary

**Real local bare-repo pre-receive hook proves the harness reads and classifies a GitLab-style protected-branch rejection; RB-04-01 records the live GitLab check as honestly OUTSTANDING in both places the docs-policy guard reads it.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Built SAFE-01's offline proxy: a real disposable bare git repository carrying a POSIX-`sh` `pre-receive` hook that rejects pushes to `refs/heads/main` with GitLab's real (reproduced) wording, exercised by four cases — the protected-branch rejection with the rejection text on stderr, a paired non-protected-branch push that succeeds against the identical hook, and a genuinely diverged non-fast-forward push used as the classifier's negative-direction control
- Added `classifyPushFailure()` to `.pi/extensions/safety/git.ts`, a pure reader of `git push` stderr text that distinguishes `"protected-branch-rejection"` from `"other"`, driven both directions in the test
- Appended a `## Phase 4 — Safety & Deployment Guardrails` section to `docs/RUNBOOK.md` with `RB-04-01` (SAFE-01), status `OUTSTANDING` identically in the summary-table row and the `**Status:**` line, naming the offline proxy and stating plainly that server-side branch protection is the one control in the whole stack that is not theatre
- Extended `tests/unit/docs-policy.test.ts` with `PHASE_FOUR_IDS`, folded into `ALL_IDS`, and an `ENTRY_COMMANDS["RB-04-01"]` pin for all four whole one-line commands (each verified to occur exactly once in the runbook)
- Updated `.planning/REQUIREMENTS.md`: SAFE-01 marked `[~]` partial with `RB-04-01` named inline; SAFE-02 through SAFE-15 and SAFE-17 marked `[x]` complete with their delivering plan numbers added to the traceability table; SAFE-16 untouched
- Full suite (1083 tests across 64 files) and `tsc --noEmit` both green — the Phase 4 exit gate

## Task Commits

Each task was committed atomically:

1. **Task 1: SAFE-01's offline proxy — a local bare repo with a rejecting pre-receive hook** - `86f0208` (test)
2. **Task 2: Append RB-04-01 to docs/RUNBOOK.md and extend the status guard** - `5d83918` (docs)
3. **Task 3: Requirements traceability for all sixteen SAFE requirements** - `09a47df` (docs)

## Files Created/Modified

- `tests/integration/gitlab-push-protection.test.ts` - New: real bare repo + `pre-receive` hook fixture, four cases (protected rejection, paired non-protected success control, classifier positive, classifier negative via a real non-fast-forward)
- `.pi/extensions/safety/git.ts` - Added `classifyPushFailure()` and `PushFailureClassification`, a pure reader distinguishing a protected-branch rejection from any other push failure
- `docs/RUNBOOK.md` - Appended the Phase 4 section: intro, summary table, `RB-04-01` detail subsection with all four contract parts
- `tests/unit/docs-policy.test.ts` - Added `PHASE_FOUR_IDS`, folded into `ALL_IDS`; added `ENTRY_COMMANDS["RB-04-01"]`
- `.planning/REQUIREMENTS.md` - SAFE-01 to `[~]` partial with `RB-04-01` inline; SAFE-02..15, SAFE-17 traceability rows now name their delivering plan(s)

## Decisions Made

- SAFE-01 is recorded as `[~]` partial, never `[x]` — Trap T12 forbids inferring a `[RUNBOOK]` requirement's completion from a green offline proxy, and this phase follows the same house form Phase 3 set for five PROV requirements.
- The classifier's negative-direction control is a REAL non-fast-forward rejection (two clones genuinely diverged and pushed without fetching), not a fabricated string, so the assertion that it classifies differently from the protected-branch case is measuring the classifier's actual behaviour against real git output rather than agreeing with a fixture the same file wrote.
- `RB-04-01`'s procedure names the work repo as `<work-repo>` rather than a real URL — the same placeholder discipline `RB-03-01` (workspace id) and `RB-03-03` (AWS profile name) already established for account-identifying information in a public repo.

## Deviations from Plan

None - plan executed exactly as written. `.pi/extensions/safety/git.ts` was the file the plan itself named as the fallback location for the classifier ("If Phase 4 shipped no such classifier, add a small exported predicate alongside the test's subject (e.g. in `.pi/extensions/safety/git.ts`)"), and no such classifier existed prior to this plan, so adding it there was the plan's own contingency, not an unplanned addition.

## Falsification Record (Task 2)

All three falsifications were run against the COMMITTED file (per the Phase 3 lesson that a `git checkout --` restore silently deletes uncommitted edits), each restored via `git checkout --` before the next:

| Falsification | Mutation | Result |
|---|---|---|
| (a) table-only flip | `docs/RUNBOOK.md`'s `RB-04-01` table row → `PASSED` (subsection left `OUTSTANDING`) | 2 tests failed: `RB-04-01 is recorded as INCONSISTENT` |
| (b) both flipped | table row → `PASSED — 2026-08-14`, subsection `**Status:**` → `PASSED — 2026-08-14` | 2 tests failed: `RB-04-01 is recorded as PASSED`, still-OUTSTANDING assertion fails |
| (c) ids removed from guard | `...PHASE_FOUR_IDS` removed from `ALL_IDS` in `tests/unit/docs-policy.test.ts` | 1 test failed (of 67, down from 70): "governs every entry the runbook declares — an id outside ALL_IDS is an unguarded status" — the Rule 2 case from plan 03-11 |

Each mutation was reverted before the next, and the suite returned to 70/70 passing after the final restore.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. `RB-04-01`'s procedure is for the work laptop and is documented in `docs/RUNBOOK.md`; it is not run by this plan.

## Next Phase Readiness

Phase 4 (Safety & Deployment Guardrails) is now complete: all seventeen SAFE requirements are accounted for — sixteen `[x]` complete (SAFE-02 through SAFE-15, SAFE-17), SAFE-01 `[~]` partial with `RB-04-01` OUTSTANDING, and SAFE-16 untouched (Phase 1's, via `RB-01-01`). `docs/RUNBOOK.md` now carries four phase sections (twelve entries total: three Phase 1, three Phase 2, five Phase 3, one Phase 4), all machine-enforced OUTSTANDING by `tests/unit/docs-policy.test.ts`. Full suite (1083 tests, 64 files) and `tsc --noEmit` are green — the phase gate this plan's own verification block required. Phase 5 (Routing & Capability Guards) can proceed; it depends on Phase 1 only, same as Phase 4 did, and imports nothing from `safety/` per CONTEXT.md decision 7's isolation rule.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

All created/modified files confirmed present on disk (`tests/integration/gitlab-push-protection.test.ts`, `docs/RUNBOOK.md`, `.pi/extensions/safety/git.ts`, `tests/unit/docs-policy.test.ts`, `.planning/REQUIREMENTS.md`). All three task commit hashes (`86f0208`, `5d83918`, `09a47df`) confirmed present in `git log --oneline --all`.
