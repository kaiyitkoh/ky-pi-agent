---
phase: 08-quality-gates-engineering-quality
fixed_at: 2026-08-15T07:55:11Z
review_path: .planning/phases/08-quality-gates-engineering-quality/08-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-08-15T07:55:11Z
**Source review:** .planning/phases/08-quality-gates-engineering-quality/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 11 (4 Critical, 7 Warning; Info findings IN-01..IN-03 out of scope per instruction)
- Fixed: 11
- Skipped: 0

All fixes were applied inside an isolated git worktree (`gsd-reviewfix/08-89268`), one commit per finding, then fast-forwarded onto `main`. Every fix was verified with `tsc --noEmit` plus the relevant `vitest` scope, and every fix that could plausibly regress silently was mutation-tested (the fix was temporarily reverted or the exact bug reproduced, the new/updated test was confirmed to fail for the right reason, then the fix was restored and reconfirmed green). Full final verification: `tsc --noEmit` clean, full `vitest run` — **108 test files, 1994 tests, all passing**.

## Fixed Issues

### CR-01: GATE-01's typecheck and lint legs were permanently UNAVAILABLE on Windows

**Files modified:** `.pi/extensions/quality/gates.ts`, `.pi/extensions/quality/index.ts`, `tests/unit/quality-gates.test.ts`, `tests/unit/quality-production-exec.test.ts` (new)
**Commit:** `0f34e2f`
**Applied fix:** `productionExec` now resolves the pinned local binary at `<cwd>/node_modules/.bin/<name>` (branching `shell` on platform for the Windows `.cmd` case) instead of spawning `npx`. Call sites changed from `exec("npx", ["tsc", ...])` to `exec("tsc", [...])` / `exec("vitest", [...])`. Added `tests/unit/quality-production-exec.test.ts`, which installs NO exec override and asserts against the real production runner — proving the typecheck and lint legs are `pass`/`fail`, never `unavailable`, and that this repository's own source genuinely passes both. Executed proof pasted in the commit: `productionExec("tsc", ["--version"], repoRoot())` → exit 0, "Version 5.9.3"; a real `vitest run <12 files>` completes in ~3s with 385 passing tests. Mutation-tested: reverting to the pre-fix `npx`-based shape reproduces the review's exact `spawnSync npx ENOENT` and turns every new test red.

### CR-02: the same runner could download and execute unpinned npm packages

**Files modified:** `.pi/extensions/quality/index.ts`, `tests/unit/quality-production-exec.test.ts`
**Commit:** `1128a11`
**Applied fix:** CR-01's fix already closes the primary concern (no code path names `npx` anymore, so nothing can reach the registry). Additionally fixed the secondary correctness bug: `LINT_GATE_FILES` names this repository's own hardcoded structural test paths, which do not exist in a foreign `cwd`. `productionExec` now checks every `.test.ts` argument against `cwd` before spawning; a missing target degrades the leg to `unavailable`, naming the missing path(s), rather than letting vitest report a false FAIL. Mutation-tested: removing the check made `productionExec` actually run a real `vitest` subprocess against a nonexistent file rather than throwing — exactly the unwanted reach this fix prevents.

### CR-03: `quick-workflow.test.ts` never installed the mandatory exec seam

**Files modified:** `tests/integration/quick-workflow.test.ts`
**Commit:** `a06992d`
**Applied fix:** Installed `setQuickGateExecOverrideForTests(INSTANT_PASS_EXEC)` before, and restored `undefined` after, every one of the nine `command.handler(...)` calls that reach `runQuickGateStage` (case 3–9, WR-01 regression, WR-02 regression PROBE I), mirroring `quality-gate-order.test.ts`'s own pattern exactly, plus a belt-and-braces `afterEach`. Cases that return before the gate stage (case 0–2, the non-routed-model regression, WR-01 iteration 2) correctly received no override. Verified: with CR-01/CR-02 already landed, stripping all nine overrides as a mutation still left the suite green (production exec now degrades fast and honestly) — this fix is therefore documented as defense-in-depth against any future regression to `productionExec`, not one with a currently-visible failure signature on this branch.

### CR-04: the FLOW-11 anti-offloading ratchet did not cover `.pi/extensions/quality/`

**Files modified:** `tests/unit/workflow-budgets.test.ts`
**Commit:** `ac0e427`
**Applied fix:** Added `importedSubsystemDirs(commandFiles)`, which scans every discovered command source's own relative `import ... from` specifiers, resolves each to an absolute path, and adds its subsystem root to `commandDirs` when it lands under `.pi/extensions/`. `commandDirs` is now the union of `isCommandSource`-discovered directories and import-discovered ones. This surfaced a **second** previously-undiscovered directory, `.pi/extensions/safety/` (also imported by `workflows/index.ts`, also registers no command) — added its own `DIRECTORY_BUDGETS` entry too, grandfathered at its current measured total (4,455 raw lines / 9 files), the same precedent already used for `routing/`/`harness/`/`diagnostics/`. Added `.pi/extensions/quality`'s entry at its final measured total for this phase (3,548 raw lines / 8 files, after this phase's own CR-01/CR-02/WR-01/WR-02/WR-03/WR-05 edits). Corrected `workflows/index.ts`'s own budget `why`, which had implied nothing was offloaded. Mutation-tested twice: reverting `commandDirs` to `isCommandSource`-only turns the new CR-04 proof test red while everything else stays green; removing the new entries turns the pre-existing completeness check red, naming both directories.

### WR-01: `validateReview` accepted duplicate, contradictory verdicts for one requirement id

**Files modified:** `.pi/extensions/quality/review-schema.ts`, `tests/unit/quality-schema.test.ts`
**Commit:** `458c10b`
**Applied fix:** Added branch (3b): rejects `verdicts` carrying more than one entry for the same `requirementId`, naming the duplicated id(s). Mutation-tested: removing the branch turns the new duplicate-rejection test red; the paired positive (single verdict per id) stays green.

### WR-02: an unrecognised verdict status was silently coerced to "Missing"

**Files modified:** `.pi/extensions/quality/review-schema.ts`, `tests/unit/quality-schema.test.ts`
**Commit:** `a4f57c4`
**Applied fix:** Added branch (2b), mirroring branch (2)'s hard reject for a malformed `severity`: an unrecognised `status` is now rejected before normalisation, and the now-unreachable fallback-to-`"Missing"` was removed from branch (9)'s normaliser. Mutation-tested: removing branch (2b) turns 3 of the 4 new tests red (the 4th, a genuine `"Missing"` verdict, is indistinguishable from the old coercion by design and is the paired positive proving the fix preserves that legitimate case).

### WR-03: the calibration matcher could be satisfied without detecting any defect

**Files modified:** `.pi/extensions/quality/calibration.ts` (docstring only — the matcher logic itself was already correct; the fixture needles were the bug), `tests/fixtures/seeded-defects/index.ts`, `tests/integration/reviewer-calibration.test.ts`, `docs/QUALITY.md`
**Commit:** `50d85c5`
**Applied fix:** Every `mustMentionAny` needle across the six seeded defects now names the DEFECT's behaviour (e.g. `absent-guard`: `"never calls isGuardedCommand"` / `"not wired in"`, not bare `"isGuardedCommand"`) instead of a bare symbol name trivially derivable from "the file's only function". Added a third calibration control, `SHOTGUN_NAME_DROP_ARGS`, reproducing the review's exact exploit shape and asserting it scores `catchRate === 0`. **Number recorded honestly:** the known-subset catch rate is **unchanged at 3/6 = 0.50** — `KNOWN_SUBSET_ARGS`'s own finding text already described behaviour, not bare symbols, so it satisfied the tightened needles without any change to it. Nothing was tuned toward a flattering number. `docs/QUALITY.md`'s calibration section was corrected to record the third control and its own prior overclaim about "a specific, named mention". Mutation-tested: reverting the six needles to bare-symbol form reproduces the review's exact exploit — the new control's `catchRate` goes from 0 to 1.0 (6/6, having caught nothing).

### WR-04: the qoder "does NOT time out" test didn't actually prove reset-on-progress

**Files modified:** `tests/helpers/qoder-loopback.ts`, `tests/integration/qoder-delegate.test.ts`
**Commit:** `29a4fc1`
**Applied fix:** The prior case set one ~50ms gap against a 2000ms budget, which a single-fixed-deadline implementation would also pass. Extended `qoder-loopback.ts` with `splitStreamAtMultiple` / `chunkWritten[]` / `releaseNextChunk` (event-gated, same discipline as the existing two-chunk primitives — no `res.write()` is ever timed against a duration). Rewrote the test to split the stream into four chunks (three ~150ms real gaps, 450ms sum) against a 300ms budget: reset-on-progress completes normally; a single fixed deadline fires before the fourth chunk. 150ms of headroom per gap against scheduler jitter. Mutation-tested: commenting out `client.ts`'s `lastProgressAt = Date.now()` reset (simulating a fixed deadline) turns exactly this test red with "the event stream produced no bytes for 300ms", while the other 19 cases (including the WR-07 no-progress-at-all negative controls) stay green.

### WR-05: `buildImportGraph` silently dropped `export ... from` re-export edges

**Files modified:** `.pi/extensions/quality/reviewer.ts`, `tests/unit/reviewer-import-graph.test.ts` (new)
**Commit:** `c06d293`
**Applied fix:** `IMPORT_FROM_RE` now matches `\b(?:import|export)\b ... from`, and the rendered heading plus both docstrings state the graph covers `import ... from` AND `export ... from`, still excluding a bare side-effect `import "./x"` and dynamic `import()`. Added `tests/unit/reviewer-import-graph.test.ts` — no dedicated unit test existed for `buildImportGraph` before. Mutation-tested: reverting to `import`-only turns exactly the four new export-related tests red (barrel export, mixed file, the cited `loop-police.ts` shape, and the regression proof), while the paired positive and still-excluded cases stay green.

### WR-06: `/quick`'s blocking branch drained the WHOLE quality ledger

**Files modified:** `.pi/extensions/diagnostics/quality-cost.ts`, `.pi/extensions/workflows/index.ts`, `tests/integration/quality-gate-order.test.ts`, `tests/unit/turn-row.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** `937fb81`
**Applied fix:** Added `refundQualityCost({ms, tokens})`, which subtracts only its own input (floored at zero per field) from whatever the ledger currently holds, leaving any other contributor's own recorded cost untouched; clears to `undefined` only when the result reaches `{0, 0}` for both fields. `workflows/index.ts`'s blocking branch now calls `refundQualityCost({ms: gate.totalMs})` instead of `takeQualityCost()`. Added a session-level regression test that records a prior `{ms:123, tokens:45}` contribution before a blocked `/quick` call and asserts it survives, plus five direct unit tests for `refundQualityCost` itself. Mutation-tested twice: reverting `workflows/index.ts` to `takeQualityCost()` turns only the new regression test red (the pre-existing negative control stays green — it never exercised a multi-contributor turn); reverting `refundQualityCost`'s own body to unconditional `clearSlot()` turns exactly 2 of 5 new unit tests red.

### WR-07: `ERROR_BUDGET_ON_OWN_SOURCE`'s recorded provenance described a stale input set

**Files modified:** `tests/unit/quality-rules.test.ts`
**Commit:** `48d4db5`
**Applied fix:** Re-measured against the current tracked `.pi/extensions/` tree (51 files, including all eight `quality/*.ts` files that landed after the original measurement): still exactly 22, unchanged — the new files contribute zero error-tier findings. The constant is unchanged; only its `why` was stale. Updated the `why` with the current per-rule, per-file breakdown. Also added the `toBe(measured)` discipline `workflow-budgets.test.ts` already uses (WR2-03): a second test asserting the constant equals the measured count exactly, so a future drop also requires a deliberate edit. Mutation-tested: setting the constant to a stale value turns only the new `toBe` test red while the pre-existing `toBeLessThanOrEqual` test stays green, demonstrating the new test catches drift the old one could not.

## Skipped Issues

None — all 11 in-scope findings were fixed and verified.

---

_Fixed: 2026-08-15T07:55:11Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
