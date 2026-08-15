---
phase: 09-ceremonial-workflows
plan: 03
subsystem: workflows
tags: [gitignore, vendoring, plan-mode, artifact-registry, path-confinement]

# Dependency graph
requires:
  - phase: 09-ceremonial-workflows
    provides: "09-02's WORKFLOW_BUDGETS/DIRECTORY_BUDGETS/RESOURCE_EDGES/WORKFLOW_TEXT_BUDGETS registry machinery, extended (not rebuilt) here"
provides:
  - "The command name /plan freed for the ceremonial spec workflow (DEVIATION 6 on the vendored plan-mode example, renamed to /plan-mode)"
  - ".pi/work/ git-ignored, with a two-way asserted rule (MUST_BE_IGNORED gains two nested rows)"
  - ".pi/lib/work-artifacts.ts: ARTIFACT_FILES (the fixed four-file set with named consumers) and workDir() (two-layer confined path builder) -- the single module answering what an artifact is and where it lives"
affects: [09-08-grill, 09-10-plan, 09-13-execute, 09-15-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-layer path confinement for a model-supplied segment: a character allowlist (with a leading-alphanumeric anchor) plus a resolved-path containment assertion, fail-closed on either failure -- .pi/lib/jsonl.ts's proven pattern, reused verbatim in .pi/lib/work-artifacts.ts"
    - "A frozen, consumer-annotated artifact registry as the single source of truth for what a ceremonial workflow's output files are -- same discipline as WORKFLOW_BUDGETS being the single authoritative line-budget registry"

key-files:
  created:
    - .pi/lib/work-artifacts.ts
    - tests/unit/work-artifacts.test.ts
  modified:
    - .pi/extensions/plan-mode/index.ts
    - .pi/extensions/plan-mode/PROVENANCE.md
    - tests/unit/plan-mode-read-only.test.ts
    - docs/EXTENSIONS.md
    - .gitignore
    - tests/unit/gitignore-policy.test.ts
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "The vendored plan-mode example's /plan command renamed to /plan-mode (DEVIATION 6) rather than renaming anything about the ceremonial workflow -- the general name goes to the authored workflow, the vendored example (the more specific capability) takes the more specific name, exactly the precedent DEVIATION 1 already set for the /todos collision"
  - "workDir() throws on an illegal slug rather than defaulting or sanitising -- fail closed, the same posture .pi/extensions/safety/git.ts:462-465 states for an unclassified glab form"
  - "SLUG_PATTERN's leading-alphanumeric anchor makes a leading '.' structurally impossible on its own, independent of the containment assertion -- recorded as an honest falsification finding rather than claiming the containment layer catches something it does not for this specific fixture"
  - "ARTIFACT_FILES' consumer field is mandatory and non-empty on every entry, mirroring FEATURES.md Part 2's own design rule that a section (and by extension a whole file) with no named consumer does not ship"

patterns-established:
  - "Pattern: when a WORKFLOW_BUDGETS/DIRECTORY_BUDGETS why string's own narrative claim goes stale (e.g. 'registers /plan and /plan-todos' after a rename), the CORRECTION is appended to the existing why string with a plan citation rather than silently rewritten -- preserves the audit trail of what was true when written"

requirements-completed: ["FLOW-06", "FLOW-10"]

# Metrics
duration: 15min
completed: 2026-08-15
---

# Phase 9 Plan 3: Free /plan and Fix the Artifact Set as Data Summary

**Renamed the vendored plan-mode example's `/plan` toggle to `/plan-mode` (DEVIATION 6), git-ignored `.pi/work/` with a two-way asserted rule, and added `.pi/lib/work-artifacts.ts` — the single module defining the four-file ceremonial-workflow artifact set (`ARTIFACT_FILES`, each with a named consumer) and its two-layer-confined path builder (`workDir`, `SLUG_PATTERN`).**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 7 modified, 2 created

## Accomplishments
- `/plan` is unregistered by anything in this repo; `/plan-mode` is registered instead, with DEVIATION 6 recorded in both `index.ts`'s own vendoring header and `PROVENANCE.md`'s numbered deviations list.
- `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` for the plan-mode file and directory corrected and raised (540→550, 1230→1240) with the now-false "registers /plan and /plan-todos" narrative explicitly corrected in place rather than silently rewritten.
- `.pi/work/` is git-ignored with its own commented block stating why (public repo, per-feature scratch describing the user's private employer codebase); `MUST_BE_IGNORED` gained two nested-path rows (`SPEC.md`, `PROGRESS.md` under a demo slug) so the assertion covers depth, not just the directory name.
- `.pi/lib/work-artifacts.ts`: `ARTIFACT_FILES` (SPEC.md/PLAN.md/REVIEW.md/PROGRESS.md, each with a named downstream consumer sourced from `.planning/research/FEATURES.md` Part 2), `SLUG_PATTERN` (a bounded lowercase-alphanumeric-and-hyphen regex), and `workDir(cwd, slug)` (two-layer confined, fail-closed).
- `tests/unit/work-artifacts.test.ts`: 30 tests covering the artifact registry's shape/consumers/immutability, `SLUG_PATTERN`'s accept/reject boundary, and `workDir`'s containment, purity (no I/O) and fail-closed behaviour.
- `.pi/lib`'s `DIRECTORY_BUDGETS` row raised 690→840 (839 measured across the now-three files in that directory).

## Task Commits

1. **Task 1: Rename the vendored /plan to /plan-mode as DEVIATION 6** - `bbe0ea5` (feat)
2. **Task 2: Ignore .pi/work/ and define the artifact set as data** - `43e40ff` (feat)

_Both task commits are self-contained; no separate plan-metadata commit was needed beyond this SUMMARY's own commit._

## Files Created/Modified
- `.pi/extensions/plan-mode/index.ts` - `registerCommand("plan")` → `registerCommand("plan-mode")`; DEVIATION 6 appended to the vendoring header
- `.pi/extensions/plan-mode/PROVENANCE.md` - DEVIATION 6 mirrored in the numbered deviations list ("Five" → "Six")
- `tests/unit/plan-mode-read-only.test.ts` - `commands.get("plan-mode")`
- `docs/EXTENSIONS.md` - vendored-item row names the renamed command and the third file (`read-only.ts`)
- `.gitignore` - `.pi/work/` rule, own commented block with the reason
- `tests/unit/gitignore-policy.test.ts` - two nested `MUST_BE_IGNORED` rows under `.pi/work/demo-slug/`
- `.pi/lib/work-artifacts.ts` - `ARTIFACT_FILES`, `SLUG_PATTERN`, `workDir()` (new file)
- `tests/unit/work-artifacts.test.ts` - coverage for the above (new file)
- `tests/unit/workflow-budgets.test.ts` - `WORKFLOW_BUDGETS` (plan-mode/index.ts 540→550) and `DIRECTORY_BUDGETS` (plan-mode 1230→1240, `.pi/lib` 690→840) rows updated

## Decisions Made
See `key-decisions` in frontmatter above. The most consequential: `workDir`'s fail-closed posture on an illegal slug, and the honest falsification finding that `SLUG_PATTERN`'s leading-alphanumeric anchor alone (not the containment assertion) is what makes `..` structurally impossible for this module's specific character set — recorded rather than glossed over, per this plan's "BE SUSPICIOUS OF GREEN" instruction.

## Deviations from Plan

None beyond the plan's own DEVIATION 6 (which the plan itself names as the task's purpose, not an unplanned deviation). No Rule 1/2/3 auto-fixes were needed; both tasks executed as written.

## Issues Encountered

While reverting Task 2's Falsification B (removing the containment assertion in `workDir` via a scripted string edit), a bracket-matching bug in the removal script left a stray `}` in the file. Caught immediately by the next `npx vitest run` (a syntax error), fixed inline with `Edit`, and re-verified before proceeding — the file was fully restored to its original 152-line content by the time Task 2 was committed (confirmed by re-measuring and by the final full-suite green run).

## Falsifications (verbatim RED output, all reverted)

### Task 1 — budget rounding boundary
Reverted only the `WORKFLOW_BUDGETS` budget number for `.pi/extensions/plan-mode/index.ts` (550 → 540), leaving the code edit (547 measured raw lines) in place:
```
AssertionError: .pi/extensions/plan-mode/index.ts is 547 raw lines, over its budget of 540 ...: expected 547 to be less than or equal to 540
AssertionError: .pi/extensions/plan-mode/index.ts is 547 raw lines, so its budget must be 550 ...: expected 540 to be 550
```
Restored to 550; suite returned to 78/78 green. The measured total (534 → 547) DID cross a ten-boundary (530s → 540s), so the raise was real, not cosmetic.

### Task 2 — Falsification A: removed `.pi/work/` from `.gitignore`
```
FAIL tests/unit/gitignore-policy.test.ts > BOOT-09 ... > ignores .pi/work/demo-slug/SPEC.md
AssertionError: .pi/work/demo-slug/SPEC.md MUST be ignored but git says it is committable: expected false to be true
FAIL tests/unit/gitignore-policy.test.ts > BOOT-09 ... > ignores .pi/work/demo-slug/PROGRESS.md
AssertionError: .pi/work/demo-slug/PROGRESS.md MUST be ignored but git says it is committable: expected false to be true
```
Restored; suite returned to 63/63 green.

### Task 2 — Falsification B, half 1: loosened `SLUG_PATTERN` to permit `/`
```
FAIL tests/unit/work-artifacts.test.ts > SLUG_PATTERN ... > rejects "a/b" (a path separator)
AssertionError: expected true to be false
FAIL tests/unit/work-artifacts.test.ts > workDir ... > throws on the illegal slug "a/b" -- fail closed, not defaulted through
AssertionError: expected [Function] to throw an error
```
Confirms the character allowlist, not containment, is what stops `a/b` — `a/b` resolves to a path still nested under the work root (`.pi/work/a/b`), so containment alone would not have caught it; a legal-shaped-but-multi-segment slug is a shape violation the allowlist alone enforces. Restored; suite returned to 30/30 green.

### Task 2 — Falsification B, half 2: removed the containment assertion in `workDir`
Restored `SLUG_PATTERN` first, then removed the containment `if` block entirely (keeping the strict pattern). Result: **suite stayed green (30/30) — no case turned red.** Investigated with a temporary probe (added, run, then deleted): `workDir(cwd, "..")` still threw, because `SLUG_PATTERN`'s leading-character class (`[a-z0-9]`) rejects any slug starting with `.` regardless of what the rest of the pattern permits — even after loosening the pattern's *trailing* characters to allow `.`, the LEADING character requirement alone still rejects `".."`. This differs from the plan's stated expectation ("confirm the `..` case turns RED") and is recorded honestly rather than forced: for this module's specific character set, the leading-alphanumeric anchor makes `..` structurally unconstructable independent of containment. The containment assertion remains defense-in-depth against a differently-shaped future weakening (e.g. a `cwd`-side attack, or a future edit that drops the leading-character restriction specifically), not a condition this fixture demonstrates. Both pattern and containment fully restored; suite returned to 30/30 green; file re-measured at its original 152 lines.

### Task 2 — Falsification C: added a fifth `ARTIFACT_FILES` entry (`EXTRA.md`)
```
FAIL tests/unit/work-artifacts.test.ts > ARTIFACT_FILES ... > has exactly four entries, no fifth
AssertionError: expected 5 to be 4
FAIL tests/unit/work-artifacts.test.ts > ARTIFACT_FILES ... > names SPEC.md, PLAN.md, REVIEW.md and PROGRESS.md, and no other file
AssertionError: expected [ 'EXTRA.md', 'PLAN.md', …(3) ] to deeply equal [ 'PLAN.md', 'PROGRESS.md', …(2) ]
```
Restored; suite returned to 30/30 green.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The command name `/plan` is free for plan 09-10's ceremonial workflow to register.
- `.pi/work/` cannot reach the public remote; plans 09-08/10/13/15 can write real feature scratch under it without a supply-chain review.
- `ARTIFACT_FILES`, `SLUG_PATTERN` and `workDir()` are all in place before any ceremonial command exists — the load-bearing precondition this plan's objective named. Plans 09-08 (`/grill`), 09-10 (`/plan`), 09-13 (`/execute`) and 09-15 (`/review`) each import `workDir()` to resolve their own artifact paths rather than re-deriving the path-confinement logic.
- No blockers.

## Note on the orchestrator's `git grep "registerTool("` success criterion
This plan's own success criteria (`success_criteria` in the executor prompt) include `git grep "registerTool(" must return empty`. This is **not achievable repo-wide** and is unrelated to this plan's scope: 57 pre-existing hits exist across `.pi/extensions/safety/`, `.pi/extensions/quality/`, `docs/EXTENSIONS.md` (prose citations) and elsewhere, none introduced by this plan. Verified directly: none of the seven files this plan created or modified (`work-artifacts.ts`, `plan-mode/index.ts`, `plan-mode/PROVENANCE.md`, `.gitignore`, and the three test files) contain a `registerTool(` call. The correct, narrower mechanism this repo actually enforces is `tests/unit/contributing-boundary.test.ts`'s `TOOL_REGISTRATION_ALLOWLIST` (exactly 5 files may spell `registerTool`), which this plan did not touch and remains unchanged.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `.pi/extensions/plan-mode/index.ts` (registerCommand("plan-mode") at line 286, DEVIATION 6 present)
- FOUND: `.pi/extensions/plan-mode/PROVENANCE.md` (DEVIATION 6 present)
- FOUND: `.pi/lib/work-artifacts.ts` (152 lines, ARTIFACT_FILES/SLUG_PATTERN/workDir exported)
- FOUND: `tests/unit/work-artifacts.test.ts` (30 tests)
- FOUND: commit `bbe0ea5` (Task 1)
- FOUND: commit `43e40ff` (Task 2)
- `npx vitest run tests/unit/plan-mode-read-only.test.ts tests/unit/workflow-budgets.test.ts tests/unit/gitignore-policy.test.ts tests/unit/work-artifacts.test.ts`: 171 tests passed
- `npx vitest run` (full suite): 109 files / 2070 tests passed
- `npx tsc --noEmit`: clean
- `git grep -n 'registerCommand("plan"'` (bare, unhyphenated): 0 matches
