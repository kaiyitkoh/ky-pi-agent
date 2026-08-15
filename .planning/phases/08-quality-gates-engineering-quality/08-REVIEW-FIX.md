---
phase: 08-quality-gates-engineering-quality
fixed_at: 2026-08-15T09:08:39Z
review_path: .planning/phases/08-quality-gates-engineering-quality/08-REVIEW.md
iteration: 2
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report — Iteration 2

**Fixed at:** 2026-08-15T09:08:39Z
**Source review:** .planning/phases/08-quality-gates-engineering-quality/08-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 7 (1 Critical/BLOCKER — CR2-01, 6 Warning — WR2-01..WR2-06; the 5 Info findings IN2-01..IN2-05 were out of scope per the workflow instruction)
- Fixed: 7
- Skipped: 0

All fixes were applied inside an isolated git worktree (`gsd-reviewfix/08-928`, from `main`), one commit per finding, then fast-forwarded onto `main`. Every fix was verified with `tsc --noEmit` plus the relevant `vitest` scope, and every fix was mutation-tested (the fix was temporarily reverted or an equivalent regression was reintroduced by hand, the new/updated test was confirmed to fail red for the right reason, then the fix was restored and reconfirmed green). Full final verification: `tsc --noEmit` clean; full `vitest run` — **108 test files, 2013 tests, all passing — run 4 consecutive times**, with zero Node `DeprecationWarning`/`DEP0190` output in any run. No new npm dependency was added; `package.json`/`package-lock.json` are untouched across all seven commits. No provider inference request was issued and no AWS/live credential was touched at any point.

## Fixed Issues

### CR2-01: the CR-01 fix reintroduced CR-01's own failure mode on Windows

**Files modified:** `.pi/lib/win-quote.ts` (new), `tests/helpers/win-quote.ts`, `.pi/extensions/quality/index.ts`, `tests/unit/quality-production-exec.test.ts`
**Commit:** `03a3585`
**Applied fix:** `productionExec` called `spawnSync(bin, args, {shell: process.platform === "win32"})` — `shell: true` alongside a raw args array is unescaped concatenation into `cmd.exe` (Node's own DEP0190 hazard), and `bin` embeds `cwd`, so a cwd containing a space or `&` corrupted the command line and reported a false `fail` full of `cmd.exe` chatter instead of an honest `unavailable`. Reproduced against the real spawn on this machine (win32, Node v24.16.0) before fixing: a spaced cwd produced `'...\space' is not recognized as an internal or external command`; an `&`-containing cwd produced a genuinely split command. Moved the repository's own solved-and-tested quoter (`tests/helpers/win-quote.ts#commandFor`) to `.pi/lib/win-quote.ts` — production code under `.pi/extensions/` does not import from `tests/`, per `calibration.ts`'s and `safety/git.ts`'s own documented rule — and wired it into `productionExec`: every argument is quoted and folded into one command string on Windows (empty args array, the only shape `shell: true` is safe in). `tests/helpers/win-quote.ts` now re-exports from the new location so no existing test import broke. Added a belt-and-braces check: a residual `cmd.exe`-level "is not recognized" spawn failure is now reported as an honest `unavailable`, never allowed to masquerade as a compiler/vitest verdict. Confirmed zero `DEP0190` warnings remain in `vitest run` output. Mutation-tested: bypassing `commandFor` and reverting to the raw `shell:true`+args form made all three new CR2-01 regression cases (spaced cwd, `&`-containing cwd, a genuine FAIL from a spaced cwd) fail red.

### WR2-01: `localBin` did not walk up to an ancestor `node_modules`

**Files modified:** `.pi/extensions/quality/index.ts`, `tests/unit/quality-production-exec.test.ts`
**Commit:** `08be642`
**Applied fix:** `localBin` was a single-level `join(cwd, "node_modules", ".bin", name)` — the `npx` shim it replaced walked ancestors (`cwd/node_modules/.bin`, then each parent); `ctx.cwd` is wherever the user launched Pi, frequently not the package root in a multi-stack repository, so from any subdirectory both gate legs silently degraded to `unavailable`. `localBin` now walks up from `cwd` to each ancestor and returns `undefined` (never a still-missing path) once the filesystem root is reached, so `productionExec` reports an honest, actionable `unavailable` naming both `cwd` and "or any ancestor's". Mutation-tested: reverting the ancestor walk to a single-level lookup made all three new WR2-01 regression cases (binary resolution from a subdirectory of `repoRoot()`, `runQuickGateStage` from that subdirectory, `vitest` resolution from the same subdirectory) fail red.

### WR2-02: WR-06's session-level regression test asserted an exact float equality

**Files modified:** `tests/integration/quality-gate-order.test.ts`
**Commit:** `10b00ed`
**Applied fix:** `expect(peekQualityCost()).toEqual({qualityMs: 123, qualityTokens: 45})` only holds as an IEEE-754 identity while `gate.totalMs < ~5`; measured mismatch rates of 30.7%/33.4% once `t` (the gate's own `hrtime`-measured duration, which also picks up scheduler/GC pauses) reaches the `[0,20]`/`[0,80]` range — a fixed-magnitude bet of exactly the kind 08-05's de-flake work removed, and this phase's own de-flake prohibitions forbid fixing it by widening a tolerance band. Replaced the bit-pattern equality with two property assertions: `qualityTokens` must be exactly `45` (an integer sum, no float hazard); `qualityMs` must be close to `123` to `1e-6`. Mutation-tested: making `refundQualityCost` wipe the whole ledger slot regardless of prior contributors made the test fail red with `qualityTokens: undefined !== 45`, proving it still catches the bug WR-06 exists to catch. The review's *optional* secondary suggestion (rounding `totalMs` to a whole millisecond in production) was deliberately NOT applied — it is a shared ledger used by three other contributors and a production behaviour change with a blast radius beyond this one test's fragility; the test-level fix alone closes WR2-02.

### WR2-03: WR-04's reset-on-progress case used a real 2× timing margin

**Files modified:** `.pi/extensions/qoder/client.ts`, `tests/integration/qoder-delegate.test.ts`
**Commit:** `bccb6cc`
**Applied fix:** WR-04's own case used a real 150ms sleep between releases against a 300ms budget — correct in shape (proves SUM-of-gaps > budget while every individual gap stays under it) but only a 2× safety margin, down from the prior version's ~40×; on a loaded CI runner a scheduler hiccup during any one real sleep could push that single gap's real elapsed time over budget, making `delegateTask` genuinely and correctly reject — a false-failure risk in the test, not a bug in the code under test. Following 08-05's own "root cause eliminated at its source, no wall-clock delay option" discipline: `delegateTask` now accepts two test-only injection seams, `DelegateTaskOptions.now` (a clock, default `Date.now`) and `.onProgress` (fires exactly once per deadline reset, default no-op) — both no-ops for every production caller. `onProgress` is the synchronisation point the test needs: it fires from inside the client's own read loop, immediately after `lastProgressAt` resets, so bumping the injected clock and releasing the next chunk from within this callback guarantees the client's own next remaining-check sees exactly one gap's worth of elapsed time, with zero real wall-clock waiting anywhere in the test. An earlier version of this fix drove the clock bump off the loopback SERVER's own `chunkWritten` event instead (decoupled from the client's actual consumption); mutation-testing caught that this design let a non-resetting client mutation still pass (the test's own loop raced ahead of the client, dumping every bump in before the client processed even the first chunk) — caught during my own verification, before it reached this commit, and replaced with the `onProgress`-synchronised design. Mutation-tested (final design): removing the `lastProgressAt` reset made the test fail red, deterministically, across 4 consecutive runs, with the real "no bytes for 300ms" inactivity error; the real fix was reconfirmed green across 10 consecutive runs of the single test plus the full 20-test file (whole file now completes in well under a second of real wall-clock time).

### WR2-04: `importedSubsystemDirs` closed the offloading hole at depth 1 only, `.pi/extensions/`-only

**Files modified:** `tests/unit/workflow-budgets.test.ts`, `docs/WORKFLOWS.md`
**Commit:** `e52bd3c`
**Applied fix:** Two residuals, both closed. (1) Depth 1 only: `importedSubsystemDirs` scanned only `commandFiles`' own imports, missing a directory reached only through an intermediate file. It is now a fixed-point walk — every file it resolves a local import to is itself enqueued and scanned for its own imports, seeded from every discovered command source, with a visited-files set for cycle safety. Proved concretely: `routing/index.ts -> ./modes.ts -> ../providers/{fallback,schema}.ts` is a real depth-2 chain in this repository today, and `.pi/extensions/providers` had no `DIRECTORY_BUDGETS` entry before this fix. (2) `.pi/extensions/`-only: the filter discarded every local import elsewhere by construction — `.pi/lib/jsonl.ts` (605+ lines, imported by five subsystems) was a live, unbudgeted shared-library target. A hit under `.pi/extensions/` still resolves to its subsystem root; a hit under any other local `.pi/` directory now resolves to its own immediate directory. Added `DIRECTORY_BUDGETS` entries for `.pi/extensions/providers` (1430, grandfathered) and `.pi/lib` (690, grandfathered, includes `win-quote.ts` moved there by CR2-01 this same pass); raised `.pi/extensions/quality`'s own entry 3550 → 3610 in the same commit, reconciling size growth CR2-01/WR2-01 had already landed without updating the ratchet at the time. Rewrote `docs/WORKFLOWS.md`'s stale "a directory aggregate" (singular) prose to state the actual mechanism (per file, per-directory, transitive, general to any local `.pi/` directory) and its actual scope. Mutation-tested: reverting to the pre-fix depth-1/`.pi/extensions/`-only code made all four new WR2-04 proof tests fail red, while the pre-existing "present-but-undeclared" completeness check stayed GREEN throughout — confirming that check alone cannot detect this regression, so the new explicit containment proofs were necessary, not redundant.

### WR2-05: the tightened calibration needles resisted iteration 1's exploit but not a boilerplate one

**Files modified:** `.pi/extensions/quality/calibration.ts`, `tests/integration/reviewer-calibration.test.ts`, `docs/QUALITY.md`
**Commit:** `bb2a67c`
**Applied fix:** `mustMentionAny` is an OR set, and a single crafted sentence — reused verbatim across all six touched files, engineered to contain exactly one matching phrase per defect class ("This code cannot fail; it performs none of the verification it claims, writes into the real home directory, never calls isGuardedCommand, and always returns true regardless of input") — scored `catchRate === 1.0` having identified zero real defects. `findingCatches` now requires `MIN_DISTINCT_NEEDLES` (2) distinct entries from `mustMentionAny`, not merely `>= 1` (`Math.min(2, mustMentionAny.length)` preserves single-needle expectations used by this module's own direct unit tests). Verified by hand this defeats the kitchen-sink sentence across all six classes. The existing `KNOWN_SUBSET_ARGS` positive control's `fabricated-evidence` and `absent-guard` findings already naturally contained two needles each; its `false-label` finding did not, and was extended with one additional, TRUE clause describing the SAME already-identified defect ("meaning the label survived its own mutation") to genuinely clear the new bar rather than being weakened to dodge it — the known-subset reviewer is still scripted to catch exactly 3 of 6, and it still does. Added `SHOTGUN_KITCHEN_SINK_ARGS` as a fourth permanent control, run through the real `runReview -> scoreCalibration` pipeline in both reproducibility runs. **Re-ran the full calibration suite after the fix: the number is UNCHANGED, still 3/6 = 0.50** — recorded honestly, not tuned toward a flattering figure; since the number itself did not move, the other five places it is stated (`RB-08-03` in `docs/RUNBOOK.md` ×3, `08-10-SUMMARY.md`, `08-13-SUMMARY.md`) remain accurate and were not touched. `docs/QUALITY.md` was still overclaiming what `findingCatches` enforces ("a mention of the specific malformed behaviour" implied semantic understanding); corrected to state plainly that the matcher is a substring-match proxy, that it now requires two independent needles, and that the kitchen-sink control's own `catchRate: 0` is the measured ceiling of what that proxy can be defeated by, not a claim that no cleverer construction exists. Mutation-tested: setting `MIN_DISTINCT_NEEDLES` back to `1` made the new kitchen-sink control fail red with `catchRate === 1` (6/6), reproducing the exact exploit this commit closes.

### WR2-06: `productionExec` executed an arbitrary binary out of an untrusted `cwd`

**Files modified:** `.pi/extensions/quality/index.ts`, `.pi/extensions/workflows/index.ts`, `tests/integration/quality-gate-order.test.ts`, `tests/unit/quality-production-exec.test.ts`, `tests/unit/workflow-budgets.test.ts`
**Commit:** `dc4cc16`
**Applied fix:** `runQuickGateStage` resolved and ran `<ctx.cwd>/node_modules/.bin/{tsc,vitest}` unconditionally, before the user had agreed to anything — on a laptop holding live static IAM admin credentials for an account whose `main` auto-deploys, a freshly cloned or malicious repository shipping a `node_modules/.bin/tsc.cmd` would get arbitrary code execution. `runQuickGateStage` now takes `projectTrusted: boolean`, threaded from `ctx.isProjectTrusted()` at the one production call site (`workflows/index.ts`). `resolveExec` refuses honestly instead of executing when untrusted: both legs degrade to an actionable `unavailable` naming trust as the reason, never `blocking` (GATE-01's three-state contract). A test-installed override still wins regardless of `projectTrusted` — an override never touches disk or spawns anything, so gating it behind trust would add friction to the existing `quality-gate-order.test.ts`/`quick-workflow.test.ts` suites for zero security benefit — which kept the test-file blast radius to five direct call sites (all now passing an explicit, honest `projectTrusted` value) instead of requiring every override-driven test to also fake a trust state. Added three new tests: an untrusted temp repo with a REAL `tsc` stub genuinely installed still reports `unavailable` naming trust, never `pass`/`fail`; the same repo trusted genuinely runs; an installed override wins over `projectTrusted: false`. The untrusted case uses a temp repo, never `repoRoot()`, so its `blocking: false` assertion is not confounded by this repository's own pre-existing, unrelated anti-pattern-leg findings (a real, accepted residual discovered while writing this test, orthogonal to WR2-06). Reconciled the `.pi/extensions/quality` `DIRECTORY_BUDGETS` ratchet in the same commit: 3610 → 3670 (`calibration.ts` 179 → 206 from WR2-05, `index.ts` 355 → 387 from this fix). Mutation-tested: removing the trust check entirely made the new untrusted-temp-repo test fail red with `status: "pass"` instead of `"unavailable"`, reproducing the exact vulnerability this commit closes.

## Skipped Issues

None — all 7 in-scope findings were fixed and verified.

## Notes on out-of-scope findings

The 5 Info findings (IN2-01..IN2-05) were explicitly out of scope for this fix pass per the workflow instruction and were left untouched:
- IN2-01 (`evidence-gate.test.ts`'s stale M1 rationale), IN2-02 (`boundedCallDelta` conflates provider calls with iterations), IN2-03 (`quality/index.ts`'s TypeScript-narrowed drift guard), IN2-04 (CR-03's exec-seam has no failing signature) are all "deliberately out of fix scope" per the review's own IN2-01/02/03 headers, or a documented, accepted residual (IN2-04).
- IN2-05 (`firstChunkWritten` never resolves in `splitStreamAtMultiple` mode) touches `tests/helpers/qoder-loopback.ts`, the same file WR2-03 modified in this pass — left untouched deliberately to keep WR2-03's own diff minimal and reviewable; a future pass can pick it up independently.

---

_Fixed: 2026-08-15T09:08:39Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
