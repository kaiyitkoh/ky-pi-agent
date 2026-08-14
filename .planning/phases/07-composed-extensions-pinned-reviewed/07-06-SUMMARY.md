---
phase: 07-composed-extensions-pinned-reviewed
plan: 06
subsystem: infra
tags: [vendoring, supply-chain, license-audit, loop-detection, EXT-05, EXT-10]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    plan: 01
    provides: "docs/EXTENSIONS.md's live re-verified pin table and license-file audit; the D-07-D flat-placement decision"
provides:
  - ".pi/extensions/loop-police/ -- vendored, source-form, reviewed loop detection (EXT-05), auto-discovered at .pi/extensions/loop-police/index.ts"
  - "tests/unit/vendor-license-audit.test.ts -- EXT-10 enforced as a mutual exclusion between vendoring and depending, both directions, with a registry later plans in this wave append to"
  - "The registry pattern (MUST_BE_VENDORED) other Phase 7 vendoring plans (plan-mode/, todo.ts, questionnaire.ts, git-checkpoint.ts) append rows to"
affects: [07-07, 07-08, 07-09, 07-10, 07-11, 07-12, 07-13]

tech-stack:
  added: []
  patterns:
    - "npm pack --ignore-scripts + tar -tf as the sanctioned tarball-inspection technique (never npm install), re-confirmed with a fresh execution rather than trusting 07-01's prior run"
    - "A vendored file's own export shape must match this repo's BOOT-05 structural rule (only index.ts may carry a top-level `export default` in a nested-index directory) -- upstream code is not exempt from the repo's own hot-reload precondition"

key-files:
  created:
    - .pi/extensions/loop-police/index.ts
    - .pi/extensions/loop-police/loop-police.ts
    - .pi/extensions/loop-police/PROVENANCE.md
    - tests/unit/vendor-license-audit.test.ts
  modified:
    - tests/unit/workflow-budgets.test.ts
    - .gitignore

key-decisions:
  - "pi-loop-police@1.14.1's no-LICENSE-file finding is re-verified a THIRD time (after research and 07-01), independently, this session: gh api repos/sebaxzero/pi-loop-police reports license:null, and npm pack + tar -tf ships no LICENSE/LICENCE entry among the 11 files"
  - "Model-facing tool count of this vendored extension: 0 -- grep for registerTool over both vendored files returns no matches; it registers exactly one command (/loop-police) and one message renderer, both zero-schema-cost surfaces. Recorded in PROVENANCE.md for Phase 10's baseline per this plan's own instruction"
  - "Two mechanical, non-behavioral deviations from a byte-for-byte copy, both forced by this repo's own pinned type and structural rules rather than by taste: (1) registerCommand's handler made async to satisfy Pi 0.84.1's Promise<void> handler type (tsc TS2322 on the unmodified form); (2) the extension function's export default moved from loop-police.ts to a named export re-exported as default from index.ts, to satisfy BOOT-05's rule that only the auto-discovered entry point may carry a top-level default export"
  - "loop-police.ts writes a local loop-police.json config file next to itself at MODULE-EVALUATE time (not extension-invocation time), discovered when the full suite ran and left an untracked artifact; gitignored as per-machine runtime state rather than committed"
  - "The two skills (loop-police-help, loop-police-postmortem) and both examples/ files in the upstream tarball were deliberately NOT vendored -- a skill's name+description is a per-turn cost even unused, and Phase 10, not Phase 7, owns that budget"

requirements-completed: [EXT-05, EXT-10]

duration: ~55min
completed: 2026-08-15
---

# Phase 07 Plan 06: Vendor pi-loop-police, EXT-10 Audit Summary

**Vendored pi-loop-police@1.14.1's two source files flat under `.pi/extensions/loop-police/` with full provenance (tarball SHA-256, review findings, zero model-facing tools), then built `tests/unit/vendor-license-audit.test.ts` to make EXT-10 mechanically true in both directions -- falsified three ways.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-08-15
- **Tasks:** 2
- **Files:** 4 created, 2 modified

## Accomplishments

- Re-ran the tarball audit live rather than trusting 07-01's prior result: `npm pack pi-loop-police@1.14.1 --ignore-scripts` (download only, no lifecycle scripts) into this session's scratchpad, `tar -tf | grep -i licen` returned nothing, `sha256sum` recorded (`b906cbb0016f2554b26af6e734e27dca75ffda1c783fb95729a5f2707e336cff`), and `gh api repos/sebaxzero/pi-loop-police --jq .license` independently re-confirmed `null`.
- Read both upstream files in full (`extensions/index.ts`, `extensions/loop-police.ts`, ~1,220 lines) before copying a byte. Findings recorded in `PROVENANCE.md`: six events hooked (`agent_start`, `turn_start`, `message_update`, `message_end`, `context`, `tool_call`); zero network calls by default (the one egress path, `HOOK_CMD`, is opt-in, defaults to `""`, runs with no shell); zero `process.env` reads; zero `registerTool` calls anywhere.
- Copied the two files flat to `.pi/extensions/loop-police/`, verified byte-identical to the tarball with `diff` before any edit, then wrote `PROVENANCE.md` with the full record and what was deliberately not vendored (both skills, both examples).
- Two forced, minimal, non-behavioral edits were required to satisfy this repo's own pinned type and structural gates (`npx tsc --noEmit`, `tests/unit/extension-layout.test.ts` BOOT-05) -- see Deviations. Both are called out inline in the code and in `PROVENANCE.md`.
- The pre-existing `tests/unit/workflow-budgets.test.ts` (FLOW-11/WR-03) discovered the newly-vendored `loop-police.ts` as a command source (it spells `registerCommand(`) and its own completeness check would have failed without a registry entry -- added both a per-file and a directory-level budget entry at upstream's own measured size, explicitly noted as not reviewed for tightness (matching this file's own precedent for `routing/`, `harness/`, `diagnostics/`).
- Built `tests/unit/vendor-license-audit.test.ts`: a `MUST_BE_VENDORED` registry (`{vendorPath, npmPackageName, why}`), a vacuity guard, and four directions -- (1) the vendored copy is tracked with a tracked `PROVENANCE.md`, (2) the package name never appears in `.pi/settings.json` `packages[]` (read defensively, correct before and after plan 07-09), (3) `PROVENANCE.md` names the package, a version and an integrity hash, (4) the converse -- every tracked `PROVENANCE.md` under `.pi/extensions/` has a matching registry row.
- All three plan-specified falsifications executed and reverted -- see Falsification Results below.
- Full suite (`npx vitest run`, 88 files, 1,469 tests) and `npx tsc --noEmit` both exit 0 after every change in this plan.

## Task Commits

1. **Task 1: Vendor pi-loop-police, flat, with provenance** -- `6e2ee02` (feat), follow-up structural fix `554d622` (fix)
2. **Task 2: tests/unit/vendor-license-audit.test.ts -- EXT-10, both directions** -- `5ff9747` (test)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `.pi/extensions/loop-police/index.ts` -- the auto-discovered nested-index entry point; re-exports the named `loopPolice` function from `loop-police.ts` as `default`.
- `.pi/extensions/loop-police/loop-police.ts` -- the vendored detection logic, byte-identical to the tarball apart from two mechanical declaration-line changes (see Deviations).
- `.pi/extensions/loop-police/PROVENANCE.md` -- upstream identity, tarball provenance (SHA-256, listing, command/date), full review findings, both deviations, the gitignored runtime artifact, and what was not vendored.
- `tests/unit/vendor-license-audit.test.ts` -- the EXT-10 audit, both directions, plus the converse and a vacuity guard.
- `tests/unit/workflow-budgets.test.ts` -- two new registry entries (`WORKFLOW_BUDGETS`, `DIRECTORY_BUDGETS`) for the newly-vendored command directory, required by this repo's own pre-existing FLOW-11/WR-03 gate.
- `.gitignore` -- one new rule for `.pi/extensions/loop-police/loop-police.json`, the extension's own per-machine runtime config file.

## Decisions Made

- Model-facing tool count of `.pi/extensions/loop-police/`: **0**. Recorded in `PROVENANCE.md` for Phase 10's baseline, per this plan's own instruction. The extension registers exactly one command (`/loop-police`) and one message renderer -- both zero-schema-cost surfaces per `tests/unit/contributing-boundary.test.ts`'s own citations -- and calls `pi.registerTool` nowhere.
- EXT-10 vendoring stands, re-verified a third time independently this session (research pass, 07-01, and now this plan all agree: `license:null` on GitHub, no LICENSE file in the tarball).
- Both deviations from a byte-for-byte copy are documented as forced, not stylistic: the async handler fix is required by Pi 0.84.1's own pinned `registerCommand` type; the named-export fix is required by this repo's BOOT-05 structural precondition for `/reload`. Neither changes any line of the detection logic itself.
- `loop-police.json` (a runtime artifact the extension writes to disk on module import) is gitignored rather than committed -- it is per-machine tuned-threshold state, not source.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking issue] `registerCommand` handler type mismatch**
- **Found during:** Task 1's own verification (`npx tsc --noEmit`)
- **Issue:** upstream's `handler: (args, ctx) => { ... }` is synchronous; Pi 0.84.1's `registerCommand` handler type is `(args, ctx) => Promise<void>`, producing `TS2322` on the unmodified copy.
- **Fix:** changed the declaration to `handler: async (args, ctx) => {` -- the body returns no value on any path (bare `return;` only), so this is behaviorally identical.
- **Files modified:** `.pi/extensions/loop-police/loop-police.ts`
- **Commit:** `6e2ee02`

**2. [Rule 3 - blocking issue] BOOT-05 nested-index entry-point shape**
- **Found during:** running the plan's own Task 1 `<verify>` block against the FULL suite (it passed in isolation but failed once run alongside the rest of the repo's tests, which discovered the file via `tests/unit/extension-layout.test.ts`'s discovery over `.pi/extensions/`)
- **Issue:** upstream's `extensions/loop-police.ts` declares its own `export default function (pi) {...}`. `tests/unit/extension-layout.test.ts` (BOOT-05) requires that in a nested-index directory, only `index.ts` -- the path Pi actually auto-discovers -- may carry a top-level default export; any other file with one is treated as an ambiguous, non-auto-discoverable second entry point and rejected.
- **Fix:** renamed the function to the named export `loopPolice` in `loop-police.ts`; `index.ts` now does `export { loopPolice as default } from "./loop-police.ts";`. No line of the function body changed.
- **Files modified:** `.pi/extensions/loop-police/index.ts`, `.pi/extensions/loop-police/loop-police.ts`
- **Commit:** `554d622`

**3. [Rule 3 - blocking issue] FLOW-11/WR-03 registry completeness**
- **Found during:** the same full-suite run that surfaced deviation 2
- **Issue:** `tests/unit/workflow-budgets.test.ts`'s pre-existing, repo-wide command-directory ratchet (`WORKFLOW_BUDGETS` / `DIRECTORY_BUDGETS`) discovers any `.ts`/`.js` file under `.pi/extensions/` that spells `registerCommand(`, and its own completeness check fails on a discovered file with no registry entry. `loop-police.ts` (1,237 raw lines after the vendoring-fix comments) tripped this.
- **Fix:** added one `WORKFLOW_BUDGETS` entry (`.pi/extensions/loop-police/loop-police.ts`, budget 1240) and one `DIRECTORY_BUDGETS` entry (`.pi/extensions/loop-police`, budget 1270), both at upstream's own measured size plus this plan's short vendoring comments, explicitly noted in the `why` field as not reviewed for tightness -- matching this file's own stated precedent for `routing/`, `harness/` and `diagnostics/`.
- **Files modified:** `tests/unit/workflow-budgets.test.ts`
- **Commit:** `554d622`

**4. [Rule 2 - missing critical functionality] gitignore the extension's runtime artifact**
- **Found during:** the same full-suite run; `git status --short` showed an untracked `.pi/extensions/loop-police/loop-police.json` after `npx vitest run` completed
- **Issue:** `loop-police.ts`'s config-merge logic runs at module-evaluate time (a top-level IIFE, not inside the exported extension function), so merely importing the module -- which some test in the full suite does, transitively -- writes a local JSON config file to disk. Left untracked, this file would appear as noise in every future `git status` on any machine that runs the suite, and could be accidentally `git add -A`'d.
- **Fix:** added a scoped `.gitignore` rule for `.pi/extensions/loop-police/loop-police.json` with an explanatory comment.
- **Files modified:** `.gitignore`
- **Commit:** `554d622`

## Falsification Results

All three plan-specified falsifications were run against the real files and reverted before the Task 2 commit:

1. **(i)** Added `"npm:pi-loop-police@1.14.1"` to `.pi/settings.json`'s `packages` array. `Direction 2 — and it is NOT also an npm dependency` turned red (`'pi-loop-police' does not appear in .pi/settings.json packages[]`). Reverted; `git diff .pi/settings.json` confirmed clean afterward.
2. **(ii)** Removed `.pi/extensions/loop-police/PROVENANCE.md` from git's index via `git rm` (a plain disk delete alone does not move `trackedFiles`, which reads the index -- so `git rm` was used to falsify correctly). Three directions turned red: `Direction 1` (`... has tracked .ts source and a tracked PROVENANCE.md`), `Direction 3` (`... names the package, a version and a hash`, an uncaught `ENOENT` on the missing file), and `Direction 4` (`no tracked PROVENANCE.md found anywhere under .pi/extensions/`, since it was the only one in the tree). Restored with `git checkout --`, confirmed byte-identical to the committed version with `diff`.
3. **(iii)** Emptied `MUST_BE_VENDORED` to `[]`. The vacuity guard turned red (`MUST_BE_VENDORED is empty`), and Direction 4's converse check also turned red as a bonus (`these directories carry a PROVENANCE.md ... but have no row in MUST_BE_VENDORED`). Restored to the one-row registry.

## Issues Encountered

None beyond the four Rule 1-3 auto-fixes documented above, all resolved inline within Task 1/2's own scope.

## User Setup Required

None. This plan performed only read-only registry/tarball inspection (`npm pack --ignore-scripts`, `tar -tf`, `gh api`) and local file writes inside this repository.

## Next Phase Readiness

`.pi/extensions/loop-police/` is committed, auto-discovered, hot-reload-shape-correct, and carries recoverable provenance. `tests/unit/vendor-license-audit.test.ts`'s `MUST_BE_VENDORED` registry is the authoritative vendoring list the remaining plans in this wave (`plan-mode/`, `todo.ts`, `questionnaire.ts`, `git-checkpoint.ts`, per `docs/EXTENSIONS.md`'s "Vendored, not depended on" table) append rows to -- each new vendored directory must also add a `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` entry if it registers a command, per this plan's own discovery. No blockers.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

All created files verified present on disk; all three task commits (`6e2ee02`, `554d622`, `5ff9747`) verified present in `git log`.
