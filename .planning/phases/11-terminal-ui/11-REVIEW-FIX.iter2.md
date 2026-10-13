---
phase: 11-terminal-ui
fixed_at: 2026-10-13T11:20:00Z
review_path: .planning/phases/11-terminal-ui/11-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report

**Fixed at:** 2026-10-13T11:20:00Z
**Source review:** .planning/phases/11-terminal-ui/11-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (2 critical, 6 warning)
- Fixed: 8. WR-06 is only partly applied; see its entry.
- Skipped: 0
- Also fixed: IN-04 (Info). It touched the same handler lines.

Every fix comes with a test. Each new test was run against the code without the fix and failed, then passed with the fix. Tests were run one file at a time, never the full suite: `ui-statusline`, `ui-chrome`, `ui-wire-check`, `docs-policy`, `ui-prompt-surface-lint` and `ui-prompt-stability`. `npx tsc --noEmit` exits 0.

## Fixed Issues

### CR-01: The subagent count includes management calls, double-counts async launches, and can get stuck

**Files modified:** `.pi/extensions/ui/agents.ts`, `.pi/extensions/ui/index.ts`, `tests/unit/ui-statusline.test.ts`, `tests/integration/ui-chrome.test.ts`
**Commit:** 9500032
**Status:** fixed: requires human verification (logic)
**Applied fix:**
- `onToolStart` now receives `event.args`. It skips any call with an `action` (management) or with `async: true`.
- `subagent:process-terminal` was added to `SUBAGENT_BUS_TOPICS`. It removes the run by its `runId`, so an undelivered completion no longer leaves a run counted.
- I checked the payload fields against the `pi-subagents@0.76.1` tarball: `async-started` carries `id`, and the process-terminal proof carries `runId`.

**Known residuals:**
- An agent with `defaultAsync` and no explicit `async` is still briefly counted twice, until its launch tool call returns.
- A parallel `tasks:[...]` foreground call still counts as 1.

### CR-02: `ui-wire-check` reports PASS when it extracted no system text

**Files modified:** `scripts/ui-wire-check-core.ts`, `scripts/ui-wire-check.mjs`, `tests/unit/ui-wire-check.test.ts`
**Commit:** 465c64d
**Status:** fixed: requires human verification (logic)
**Applied fix:**
- `analyseWire` now counts `missing` requests: those with no system text, or whose system text is only `[redacted:truncated]`. It no longer hashes `""` for them.
- `verdict` still returns FAIL when there is real failing evidence. Otherwise, if any request is missing, it returns INSUFFICIENT and never PASS.
- The script prints the missing count.

### WR-01: RB-11-03's branch-name probe gives a false FAIL on `main` and silently probes nothing on a detached HEAD

**Files modified:** `docs/RUNBOOK.md`, `scripts/ui-wire-check.mjs`, `tests/unit/docs-policy.test.ts`, `tests/unit/ui-wire-check.test.ts`
**Commit:** 69236ca
**Applied fix:**
- RB-11-03 now creates a uniquely named throwaway branch and file, `probe="ky-probe-$(date +%s)"`, before the session starts. It probes with `--probe "$probe"` and cleans up afterwards.
- `--probe ""` now exits 64.
- The pinned runbook commands in `docs-policy.test.ts` were updated to match.

### WR-02: The git probe spawns `git status` in sessions with no UI

**Files modified:** `.pi/extensions/ui/index.ts`, `tests/integration/ui-chrome.test.ts`
**Commit:** 4a46d81
**Applied fix:**
- The probe is created only when `ctx.hasUI`, and every trigger is `probe?.trigger()`.
- A new test harness loads the `ui` extension behind a `pi` proxy that records `exec` calls. It asserts there is no `git` spawn in print mode, and at least one in tui mode.
- This test replaces the empty print-mode smoke test, which also covers part of IN-09.

### WR-03: The statusline duplicates the provider that Pi's footer already shows

**Files modified:** `.pi/extensions/ui/statusline.ts`, `.pi/extensions/ui/index.ts`, `docs/UI.md`, `tests/unit/ui-statusline.test.ts`
**Commit:** fe004d6
**Applied fix:**
- Removed the provider segment and the `provider` field from `StatuslineState`.
- `model_select` now only triggers a refresh, because the context window can change with the model.
- Corrected the `index.ts` header comment and the UI.md table, and added a note that Pi's footer owns the provider.
- A test asserts that a stray `provider` is never rendered.

### WR-04: The live wire check ignores the tool list

**Files modified:** `scripts/ui-wire-check-core.ts`, `scripts/ui-wire-check.mjs`, `docs/UI.md`, `tests/unit/ui-wire-check.test.ts`
**Commit:** e63a8bf
**Applied fix:**
- Added `extractToolText`, which serialises `payload.tools ?? payload.toolConfig ?? null`. `analyseWire` records `toolHashes` and `toolsStable`, and probes search both the system text and the tools.
- `verdict` FAILs with "tool list differs between requests".
- The script prints the distinct tool-list hashes, and UI.md now describes both checks.
- I confirmed that `main.request` logs the full redacted payload (`diagnostics/wire.ts`).

### WR-05: The "outside a git checkout" test races and does not exercise the exit-128 path

**Files modified:** `tests/integration/ui-chrome.test.ts`
**Commit:** 69a34c2
**Applied fix:**
- The test uses the `exec` spy. It waits for the first `git` call to resolve with code 128, sends a second prompt, then waits 3 s, which is past the probe's 2 s minimum interval.
- It asserts exactly one `git` spawn and no "changed" segment.
- I checked both mutations named in the review. Disabling the 128 branch fails the test (2 spawns). `changed ?? 0` also fails it (a "changed" segment appears).

### WR-06: The statusline goes stale after compaction and `/tree` navigation

**Files modified:** `.pi/extensions/ui/index.ts`, `tests/integration/ui-chrome.test.ts`
**Commit:** 7bc40f9
**Status:** fixed (compaction only): requires human verification
**Applied fix:**
- Added a `session_compact` handler that refreshes the statusline.
- The test runs a real faux-session compaction. It asserts that `getContextUsage().tokens` is null afterwards and that the "left" segment is gone.

**Not applied: the `session_tree` half.** The routing extension restores `ky:mode` only on `session_start` (`routing/index.ts:311-314`). It has no `session_tree` handler. If the UI re-read `ky:mode` on tree navigation, the header and statusline would show a mode the router is not actually using. That is worse than the current state, where the UI mirrors the router's in-memory mode. The correct fix is for the router to restore on `session_tree` and emit `ky.routing.mode_changed`, which the UI already follows. That is a routing change and outside this review's scope.

### IN-04: Comments that only repeat "Swallowed deliberately." (out of scope, fixed because it touched the same lines)

**Files modified:** `.pi/extensions/ui/index.ts`
**Commit:** fb8e11c
**Applied fix:**
- Added one `guard(fn)` helper that carries the single reason errors are swallowed. Every handler and `refresh()` now run through it.
- The repeated comments are gone. The `keyText` fallback keeps its own one-line reason.

## Not addressed (Info, out of scope)

IN-01, IN-02, IN-03, IN-05, IN-06, IN-07 and IN-08 were not attempted. IN-09 is partly covered: WR-02 replaced the empty print-mode test. The redundant `bindExtensions` branch in `tests/helpers/harness-session.ts` is unchanged.

---

_Fixed: 2026-10-13T11:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
