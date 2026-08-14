---
phase: 07-composed-extensions-pinned-reviewed
plan: 07
subsystem: infra
tags: [vendoring, supply-chain, plan-mode, EXT-05, EXT-06]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    plan: 01
    provides: "docs/EXTENSIONS.md's live re-verified pin table and the D-07-A decision to vendor plan-mode over @narumitw/pi-plan-mode; the D-07-D flat-placement decision"
  - phase: 07-composed-extensions-pinned-reviewed
    plan: 06
    provides: "the vendoring-header-at-top-of-file convention (tools/registerCommand grep proof recorded in the header), and the FLOW-11/WR-03 WORKFLOW_BUDGETS/DIRECTORY_BUDGETS registry pattern a new vendored command directory must extend"
provides:
  - ".pi/extensions/plan-mode/ -- vendored, source-form Pi bundled example (EXT-06), read-only exploration mode with /plan and /plan-todos, auto-discovered at .pi/extensions/plan-mode/index.ts"
  - "the /todos naming collision between plan-mode and 07-08's vendored todo.ts resolved in this commit (plan-mode's listing renamed to /plan-todos) rather than discovered at runtime"
affects: [07-08]

tech-stack:
  added: []
  patterns:
    - "A vendored Pi bundled example gets the same top-of-file header convention as a vendored npm package (upstream path, Pi version + package-lock integrity hash, the EXT-06/EXT-10 reason, every permitted change, a model-facing-tool-count line) -- no separate PROVENANCE.md was created here because this plan's own frontmatter scopes files_modified to exactly index.ts and utils.ts, and MUST_BE_VENDORED (tests/unit/vendor-license-audit.test.ts) is scoped to EXT-10 license-driven vendoring, not EXT-06 dependency-range vendoring -- this vendor's reason is the latter"
    - "A vendoring header must never spell the literal substring the boundary test greps for (`registerTool`), even inside its own comment proving zero calls exist -- contributing-boundary.test.ts's TOOL_REGISTRATION check is a plain substring match with no comment exemption, discovered live when the first draft's own header tripped it"

key-files:
  created:
    - .pi/extensions/plan-mode/index.ts
    - .pi/extensions/plan-mode/utils.ts
  modified:
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "Model-facing tool count of this vendored extension: 0 -- grep for the tool-registration call over both vendored files returns no matches; it registers exactly two commands (/plan, /plan-todos) and gates ALREADY-REGISTERED built-in tools via pi.setActiveTools, which is not a registration and costs no schema tokens. Recorded in the index.ts header for Phase 10's baseline per this plan's own instruction"
  - "The tool_call guard interaction question (T-07-27) is answered, not UNVERIFIED: plan-mode's pi.setActiveTools gating cannot bypass the Phase 4 safety guard. The guard is bound to the TOOL NAME, not to activation state -- .pi/extensions/safety/index.ts registers wrapped bash/read/write/edit implementations once at extension load (first-registration-wins, safety/index.ts:35-46's own documented citation of runner.js:280-291), and the tool_call hook (safety/index.ts:640-651) fires on event.toolName regardless of which tool set is currently active. plan-mode never calls the tool-registration API anywhere -- it only toggles pi.setActiveTools([...names]), which selects which ALREADY-REGISTERED implementation is callable, never which implementation backs a name. So whichever of bash/read/write/edit the model can call, it is always safety's wrapped version (safety/index.ts:391-425's own execute() re-evaluates policy independent of activation state), and deactivating edit/write in plan mode is a STRICTER restriction than the guard (the model cannot call them at all), never a bypass of it."
  - "/todos renamed to /plan-todos in plan-mode/index.ts (upstream had it at line 146-156) -- resolves the collision with 07-08's not-yet-vendored todo.ts, which also registers /todos over a model-maintained list. Description text changed from \"Show current plan todo list\" to \"Show current plan progress\" per the plan's own instruction so the two commands read distinguishably in the command list."

requirements-completed: [EXT-05, EXT-06]

duration: ~20min
completed: 2026-08-15
---

# Phase 07 Plan 07: Vendor Pi's Bundled plan-mode Example Summary

**Vendored Pi 0.84.1's own `examples/extensions/plan-mode/` (558 upstream lines) flat under `.pi/extensions/plan-mode/`, renamed its `/todos` command to `/plan-todos` to resolve a collision with 07-08's separately-vendored `todo.ts`, and confirmed by source citation that plan-mode's tool-set gating cannot bypass the Phase 4 safety guard.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-15
- **Tasks:** 1
- **Files:** 2 created, 1 modified

## Accomplishments

- Read both upstream files in full (`index.ts` 390 lines, `utils.ts` 168 lines) plus the upstream `README.md`, from Pi 0.84.1's own installed npm tarball (`%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent/examples/extensions/plan-mode/`), before copying a line — confirmed the version matches this repo's pinned `package-lock.json` entry (`sha512-ncAqFrG+iybuPGOhMiZoEHkEzTpJgz3guYD32pD+M7ucc0WeHmauP6wa7qwP8V/KWvsZDVNa5XGsdZ7fkC7w7A==`).
- Copied both files flat to `.pi/extensions/plan-mode/`, one directory level below `.pi/extensions/` (not `.pi/extensions/vendor/**`), matching `tests/unit/extension-layout.test.ts`'s `NESTED_INDEX` regex for `index.ts` and the `NESTED_MODULE` shape for `utils.ts` (which carries no default export, so it is correctly classified as an imported module, not a second entry point).
- Wrote a full vendoring header at the top of `index.ts` (upstream path, Pi version + package-lock integrity hash, the EXT-06 reason over `@narumitw/pi-plan-mode@0.49.3`'s `@narumitw/pi-tui-kit@^0.49.1` caret range, all three permitted changes, and a model-facing-tool-count line) and a shorter one on `utils.ts` naming its upstream path — both preserve the original code and the original file-top docstring completely unchanged otherwise.
- Made the one substantive edit the plan's own `<verified_composition_conflict>` requires: `pi.registerCommand("todos", ...)` renamed to `pi.registerCommand("plan-todos", ...)`, description changed from "Show current plan todo list" to "Show current plan progress" — the general `/todos` name is reserved for 07-08's `todo.ts` (EXT-05's own "todo tracking" capability), per the plan's Standing Rule 8 resolution.
- Verified by grep and recorded here: `registerTool`-call count is **0** across both files; `pi.registerCommand(` names are exactly `"plan"` and `"plan-todos"`, no `"todos"`; `pi.setActiveTools(` appears twice in the executable code (`enablePlanModeTools`, `restoreNormalModeTools`), the mechanism that gates write tools without registering anything.
- Answered T-07-27 (the safety-guard interaction question) with a citation, not `UNVERIFIED` — see Decisions Made below and `.pi/extensions/plan-mode/index.ts`'s own commit message.
- Found and fixed a self-inflicted trap in the first draft: the vendoring header itself spelled the literal substring `registerTool` inside a comment ("grep for `registerTool` over both returns zero matches"), which `tests/unit/contributing-boundary.test.ts`'s plain-substring `TOOL_REGISTRATION` check flags with no comment exemption — exactly the trap that test's own docstring warns about ("an extension may not name the call even in a comment"). Reworded to "the tool-registration call" before the first commit; re-verified the grep returns 0.
- Full suite (`npx vitest run`, 88 files, 1471 tests) and `npx tsc --noEmit` both exit 0.

## Task Commits

1. **Task 1: Vendor plan-mode, flat, preserving upstream shape** -- `6afa3cf` (feat)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `.pi/extensions/plan-mode/index.ts` -- the auto-discovered nested-index entry point; upstream's `planModeExtension` default export, unmodified apart from the vendoring header and the `/todos` -> `/plan-todos` rename.
- `.pi/extensions/plan-mode/utils.ts` -- pure helper functions (`isSafeCommand`, `extractTodoItems`, `markCompletedSteps`, `cleanStepText`, `extractDoneSteps`), byte-for-byte from upstream apart from a short vendoring header.
- `tests/unit/workflow-budgets.test.ts` -- one `WORKFLOW_BUDGETS` entry (`.pi/extensions/plan-mode/index.ts`, budget 470) and one `DIRECTORY_BUDGETS` entry (`.pi/extensions/plan-mode`, budget 640), both measured at this plan's own file sizes and explicitly noted as not reviewed for tightness — required by the pre-existing FLOW-11/WR-03 completeness gate the same way 07-06 needed for `loop-police/`.

## Decisions Made

See `key-decisions` in the frontmatter above for the full text of both substantive decisions (the safety-guard interaction answer, and the `/todos` rename). In addition:

- No separate `PROVENANCE.md` was created for this vendored directory. `07-06-SUMMARY.md`'s pattern and `tests/unit/vendor-license-audit.test.ts`'s `MUST_BE_VENDORED` registry are both scoped to EXT-10 (a package vendored because it fails a license-file check and therefore must never also be an npm dependency). This vendor's reason is EXT-06 (Pi's own bundled example preferred over an npm alternative with an unpinnable transitive caret range) — a different requirement with no "must not also be installed" invariant to enforce, since `@narumitw/pi-plan-mode` was never installed in the first place. `07-07-PLAN.md`'s own frontmatter scopes `files_modified` to exactly `index.ts` and `utils.ts`; the full provenance record (upstream path, Pi version, integrity hash, every permitted change, the tool-count line) lives in `index.ts`'s own header instead, per the plan's explicit Task 1 instruction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] Vendoring header's own comment tripped the BOOT-10 tool-registration substring check**
- **Found during:** Task 1's own verification (`npx vitest run tests/unit/contributing-boundary.test.ts`)
- **Issue:** the first draft's header prose read "grep for `registerTool` over both returns zero matches" — the literal substring `registerTool` inside a comment, which `tests/unit/contributing-boundary.test.ts`'s `TOOL_REGISTRATION` check matches with no comment exemption by design (its own docstring: "the cost is that an extension may not name the call even in a comment").
- **Fix:** reworded both occurrences in `index.ts`'s header to "the tool-registration call" — no code changed, only the prose describing the (correctly zero) grep result.
- **Files modified:** `.pi/extensions/plan-mode/index.ts`
- **Commit:** `6afa3cf`

**2. [Rule 3 - blocking issue] FLOW-11/WR-03 registry completeness**
- **Found during:** the full-suite run (`npx vitest run`) after Task 1's own narrower `<verify>` block already passed
- **Issue:** `tests/unit/workflow-budgets.test.ts`'s pre-existing, repo-wide command-directory ratchet discovers any `.ts`/`.js` file under `.pi/extensions/` that spells `registerCommand(`, and its completeness check fails on a discovered file with no registry entry. `.pi/extensions/plan-mode/index.ts` (registers `/plan` and `/plan-todos`) tripped both the per-file and the directory-level completeness checks.
- **Fix:** added one `WORKFLOW_BUDGETS` entry (`.pi/extensions/plan-mode/index.ts`, budget 470) and one `DIRECTORY_BUDGETS` entry (`.pi/extensions/plan-mode`, budget 640), both measured at this plan's own file sizes (460 + 174 = 634 raw lines) rounded up to the next ten, explicitly noted as not reviewed for tightness — matching 07-06's own precedent for `loop-police/`.
- **Files modified:** `tests/unit/workflow-budgets.test.ts`
- **Commit:** `6afa3cf`

---

**Total deviations:** 2 auto-fixed (both Rule 3 -- blocking, both required for the plan's own stated verification to pass)
**Impact on plan:** No scope creep. Both fixes were required by this repo's own pre-existing gates, not by taste; neither changed the vendored extension's behavior.

## Issues Encountered

None beyond the two Rule 3 auto-fixes documented above, both resolved inline within Task 1's own scope.

## User Setup Required

None. This plan performed only local file reads (Pi's own installed npm tarball, already on disk from `package-lock.json`) and local file writes inside this repository.

## Next Phase Readiness

`.pi/extensions/plan-mode/` is committed, auto-discovered, carries full provenance in its own header, and registers `/plan` + `/plan-todos` with zero model-facing tool cost. The `/todos` name is now reserved and available for plan 07-08's `todo.ts` vendoring with no runtime collision. `07-06-SUMMARY.md`'s `MUST_BE_VENDORED` registry comment names `plan-mode/` as one of the wave's vendored bundled examples still to land in `tests/unit/vendor-license-audit.test.ts` — this plan's own analysis (see Decisions Made) found that registry's Direction 2 ("not also an npm dependency") does not structurally apply to an EXT-06-vendored example with no corresponding npm install ever made, so no row was added there; a future plan revisiting that registry's scope should read this note first rather than assume the omission was accidental. No blockers for 07-08.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

All created files verified present on disk (`.pi/extensions/plan-mode/index.ts`, `.pi/extensions/plan-mode/utils.ts`, `tests/unit/workflow-budgets.test.ts`); the task commit (`6afa3cf`) verified present in `git log`.
