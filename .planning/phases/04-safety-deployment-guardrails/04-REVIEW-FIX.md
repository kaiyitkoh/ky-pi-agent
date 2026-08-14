---
phase: 04-safety-deployment-guardrails
fixed_at: 2026-08-14T08:55:00Z
review_path: .planning/phases/04-safety-deployment-guardrails/04-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 13
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-08-14
**Source review:** .planning/phases/04-safety-deployment-guardrails/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 13 (5 blockers, 8 warnings)
- Fixed: 13
- Skipped: 0

**Suite:** 1124 tests / 66 files, all green. `tsc --noEmit` clean. Baseline
at the start of this run was 1083 tests / 64 files; the increase is the
regression tests this fix adds (2 new integration test files, plus new
rows/describe blocks in existing files).

**A genuinely new, out-of-scope issue was discovered while fixing WR-04**
(see the WR-04 section below): `.pi/lib/jsonl.ts#rotate()`'s documented
retention window (`maxRotated = 10`) legitimately purges older rotated
fragments once more than ~10 rotations accumulate on one stream —
correct, documented behaviour, not a bug, but easy to trip over when
choosing test parameters. Recorded here as a candidate follow-up: consider
exposing `maxRotated` through `writeAuditRow`'s own `WriteAuditRowOptions`
so a caller (or a future test) can make that trade-off explicitly rather
than discovering it empirically.

## Fixed Issues

### CR-01: The confirm → approve → re-issue protocol can never complete; `approve_ky_command` is dead code

**Files modified:** `.pi/extensions/safety/approvals.ts`, `.pi/extensions/safety/index.ts`, `tests/integration/confirm-approve-reissue.test.ts` (new), `tests/unit/approvals.test.ts`
**Commit:** `56ee6f7`
**Applied fix:** Added a non-consuming `peek(requestKey)` to `approvals.ts`. The `tool_call` hook now calls `peek()` on a `confirm` verdict — if a grant already exists it returns `undefined` (defers to the wrapper) instead of unconditionally minting a fresh pending request and re-blocking. The wrapped tool's own `execute()` still performs the real one-shot `consume()`. Splitting "is there a grant" (hook, `peek`) from "use the grant" (wrapper, `consume`) keeps the grant single-use across the whole two-layer composition rather than single-use at the hook alone (which would leave the wrapper's own `consume()` always finding nothing).
**Before/after verdict:** Reproduced the reviewer's exact evidence — with the fix reverted, a confirm-classified command approved via the store and re-issued produced a SECOND `confirm`-block hook row (identical to the first), never an allow. With the fix restored, the hook produces an `allow` row naming the grant, and the wrapper produces an `allow` row naming the one-shot consume, and the retry reaches the real tool's `execute()`.
**Regression test:** `tests/integration/confirm-approve-reissue.test.ts` — drives block → `approve()` (bypassing only the UI-gating of `approve_ky_command`, which is a separate, already-covered property) → re-issue → real execution, asserting on the audit trail. Verified red (reverting only the hook's `peek()` branch) before restoring the fix.
**Also fixes:** `headless-deny.test.ts:70-79`'s false claim about coverage is now actually true — `confirm-approve-reissue.test.ts` is the file that proves the confirm/approve path, and `double-enforcement.test.ts` still proves SAFE-09 (mutation) independently, unregressed.

### CR-02: `buildFacts` hands un-canonicalised Windows paths to the path policy

**Files modified:** `.pi/extensions/safety/index.ts`, `tests/integration/path-canonicalisation.test.ts` (new)
**Commit:** `56ee6f7`
**Applied fix:** Added `toCanonicalRoot()` (calls `canonicalisePathArg` with the path as its own resolution context) and used it in `buildFacts` for both `ctx.cwd` and `homedir()`.
**Before/after verdict:** Reproduced the reviewer's exact evidence via a real faux session on a native-backslash `cwd` (Windows `mkdtempSync` output) — pre-fix, a `write` to a relative path inside the project was blocked with `"resolves outside the project root"`; post-fix, it is allowed and the file lands in the real session cwd.
**Regression test:** `tests/integration/path-canonicalisation.test.ts`. Verified red (temporarily reverting `buildFacts` to raw `ctx.cwd`/`homedir()`) before restoring the fix. The fail-open half (home-anchored detonation rules silently defeated) is covered by the same fix; not independently re-driven through a real `~/.bashrc` write to avoid a real-file-system side effect in the test suite, per the plan's own scoping note.

### CR-03: Executable matching is exact-string

**Files modified:** `.pi/extensions/safety/shell.ts`, `.pi/extensions/safety/policy.ts`, `.pi/extensions/safety/infra.ts`, `tests/fixtures/evasion-corpus.ts`
**Commit:** `24b7dda`
**Applied fix:** Added `shell.ts#normaliseExecutable` (basename, lower-cased, PATHEXT suffix stripped) and used it in both `policy.ts#evaluateInvocation` and `infra.ts#classifyInfraInvocation` in place of `invocation.executable.toLowerCase()`.
**Before/after verdict:** All eight of the reviewer's own executed examples (`git.exe push`, `/usr/bin/git push`, `./git push`, `terraform.exe apply`, `kubectl.exe delete pod x`, `aws.exe secretsmanager get-secret-value ...`, `glab.exe mr merge`, `env git.exe push`) reproduced as `allow` pre-fix and are `BLOCKED`/`confirm`/`sensitive-read` post-fix.
**Regression test:** `tests/fixtures/evasion-corpus.ts` rows EV-44..EV-51 (all `BLOCKED`), driven through `evaluate()` by `tests/unit/evasion-corpus.test.ts` Group A. Verified red (reverting `normaliseExecutable` usage in both `policy.ts`/`infra.ts` back to `.toLowerCase()`) — all 8 rows failed with "got allow"; restored, all pass.

### CR-04: Pi's built-in `grep`/`find`/`ls` tools are unguarded and unaudited

**Files modified:** `.pi/extensions/safety/index.ts`, `.pi/extensions/safety/policy.ts`, `tests/fixtures/evasion-corpus.ts`, `tests/unit/safety-entry.test.ts`
**Commits:** `56ee6f7` (wrapping + hook filter), `24b7dda` (`evaluate()`'s switch)
**Applied fix:** Both halves, as the finding required. `registerWrappedTools` now also wraps `grep`/`find`/`ls` via `createGrepTool`/`createFindTool`/`createLsTool`, re-evaluating on every call. `registerToolCallHook`'s tool-name filter includes all three. `policy.ts#evaluate()`'s switch gained `evaluateGrep` (checks both `path` and `glob` against the sensitive-read table) and `evaluateFindOrLs` (checks `path`).
**Before/after verdict:** `grep { pattern: ".", path: "~/.aws/credentials" }` and `grep { pattern: "=", glob: ".env" }` reproduced as `allow` (no verdict at all) pre-fix; `BLOCKED` post-fix. `find`/`ls` over `~/.aws/credentials` / `~/.kube/config` likewise.
**Regression test:** `tests/fixtures/evasion-corpus.ts` rows EV-52..EV-55, plus `tests/unit/safety-entry.test.ts`'s updated `toolNames` assertion (now `["bash","read","write","edit","grep","find","ls","approve_ky_command"]`). Verified red (removing the `case "grep"`/`case "find"`/`case "ls"` arms from `evaluate()`'s switch) — 4 rows failed with "got allow"; restored, all pass.

### CR-05: `git push --force origin main` from a feature branch is ALLOWED

**Files modified:** `.pi/extensions/safety/git.ts`, `tests/unit/git-policy.test.ts`
**Commit:** `97f1be1`
**Applied fix:** Added `pushTargetsProtected(args, protectedBranches)`, checked at the START of `classifyGitInvocation` for a `push` subcommand, independent of `isProtected(facts)`. Reads each positional argv token as `src:dst` (destination side) or a bare ref, strips a `refs/heads/` prefix, compares case-insensitively.
**Before/after verdict:** Reproduced the reviewer's exact evidence — `git push origin HEAD:main`, `git push --force origin main`, and `git push origin feature/x:main` (all from `feature/x`) reproduced as `allow` pre-fix, `block` post-fix. The paired negative (`git push origin feature/x` from `feature/x`) stays `allow`, proving this doesn't degenerate into "any push blocked".
**Regression test:** `tests/unit/git-policy.test.ts`, four new rows. Verified red (removing the `pushTargetsProtected` check from `classifyGitInvocation`) — the three positive rows failed with "got allow"; restored, all pass.

### WR-01: Windows path aliasing (NTFS ADS, 8.3 short names) defeats every path rule and is unpublished

**Files modified:** `tests/fixtures/evasion-corpus.ts`, `docs/SAFETY.md`
**Commits:** `24b7dda` (corpus), `961b026` (docs)
**Disposition:** Documented as an accepted, published limitation (the finding's own offered alternative — full closure would need `paths.ts` to stop being deliberately pure text manipulation and gain filesystem canonicalisation, a larger architectural change than this fix scope). Added `EV-56` (`.env::$DATA`) and `EV-57` (`ENV~1`) to the corpus as `OUT-OF-SCOPE`, and matching rows to `docs/SAFETY.md`'s "Known bypasses" table.
**Verification:** `tests/unit/evasion-corpus.test.ts` Group A' (see WR-03) independently asserts both rows genuinely return `allow` through the real `evaluate()`, so this published limit cannot silently go stale. Group B's doc/corpus cross-check passes (row count and identities derived from the corpus, never hand-typed).

### WR-02: The wrapped tools execute against `process.cwd()` while policy evaluates against `ctx.cwd`

**Files modified:** `.pi/extensions/safety/index.ts`
**Commit:** `56ee6f7`
**Applied fix:** Every wrapped tool's `execute()` now builds its delegate fresh from `ctx.cwd` (`createBashTool(ctx.cwd)`, etc.) on every call, rather than delegating to a single instance built once from `process.cwd()` at registration time. The registration-time instance is now used ONLY for its static schema metadata (spread into `registerTool`), never executed.
**Before/after verdict:** Proven by the SAME `tests/integration/path-canonicalisation.test.ts` test used for CR-02 — reverting only the WR-02 half (delegate built once, not per-call) while keeping CR-02's `buildFacts` fix intact reproduces `ENOENT` reading the probe file back from the session's own `cwd`, because the real write landed under the vitest process's own cwd (this repository's root) instead.
**Regression test:** Same file as CR-02 (the two bugs compose into one observable failure mode: policy allows the write, but the write lands in the wrong place). Verified red/green as described under CR-02.

### WR-03: `OUT-OF-SCOPE` corpus rows are never driven through `evaluate()`

**Files modified:** `tests/unit/evasion-corpus.test.ts`
**Commit:** `24b7dda`
**Applied fix:** Added Group A', which asserts every `OUT-OF-SCOPE` row genuinely returns `"allow"` through the real `evaluate()`.
**Before/after verdict:** Demonstrated the exact disarm scenario the finding describes — temporarily changed `EV-35`'s fixture input to a command the guard already blocks (`git push`, keeping `expect: "OUT-OF-SCOPE"`), simulating "a gap was fixed but the corpus/doc claim was never updated back to BLOCKED". Group A' failed with `expected 'block' to be 'allow'`; reverted, all pass. Group A/B alone would NOT have caught this (Group A doesn't touch OUT-OF-SCOPE rows; Group B only checks the doc mentions the id/class, which it still would).
**Note on scope:** Group A' catches a STALE limit claim (code fixed, corpus/doc not updated) reliably. It does not, and structurally cannot, catch the FIRST moment a real regression is disguised as a re-bucketing in the same commit as the regression itself (at that instant the code genuinely does return `allow`, matching what Group A' expects) — this is inherent to any purely-behavioural check and is not a gap this fix could close further without a second, independent oracle (e.g. a required human sign-off on any `expect` change in the corpus, which is a process control, not a test).

### WR-04: The audit concurrency proof exercises a re-implementation, not the writer under test

**Files modified:** `tests/integration/audit-concurrency.test.ts`
**Commit:** `6a2650a`
**Applied fix:** Both children now `import { writeAuditRow } from ".../safety/audit.ts"` via a `file://` URL specifier, run under `node --experimental-strip-types`, exercising the real writer end to end (including its real `rotate()`/retention logic) instead of a hand-rolled `appendFileSync` + rename loop.
**Before/after verdict:** Disabled `appendJsonl`'s rotation trigger in `.pi/lib/jsonl.ts` (temporarily, restored immediately after) — case 2 failed with "zero rotations fired", proving the test genuinely observes the real writer's rotation behaviour rather than a re-implementation's. Restored, both cases pass.
**Discovered during this fix (documented, not silently worked around):** `.pi/lib/jsonl.ts#rotate()`'s retention window (`maxRotated = 10`, not configurable through `writeAuditRow`) legitimately purges older fragments once total rotations on one stream exceed 10 — correct, documented behaviour, but a real trap when choosing test parameters (an early attempt at this fix mis-diagnosed the resulting record-count shortfall as a multi-process data-loss bug; it was retention working as designed, confirmed by re-deriving the same numbers with a single process and watching it hold). This project's own test file's module docstring records this in detail; see the "genuinely new, out-of-scope issue" note above the findings list.
**Regression:** Both cases (`RECORDS_PER_CHILD`, `RECORDS_PER_CHILD_ROTATED`/`ROTATING_CAP`) verified reliable across six repeated full-file runs after the fix.

### WR-05: `pending` and `granted` grow without bound

**Files modified:** `.pi/extensions/safety/approvals.ts`, `tests/unit/approvals.test.ts`
**Commit:** `56ee6f7`
**Applied fix:** `createPending()` now calls a new `sweepExpired(store, now)` at its top, removing every `pending`/`granted` entry with `expiresAt <= now`, before inserting the new one.
**Before/after verdict:** With the sweep removed, an entry created at `T0` and still present after advancing the injected clock past `T0 + APPROVAL_TTL_MS` (via a later `createPending()` call) remained in the map; with the sweep restored, it is gone.
**Regression test:** `tests/unit/approvals.test.ts`, three new tests inspecting the raw `globalThis`-keyed store directly (peek/consume/validate already time-gate individually and cannot distinguish "swept" from "merely expired but present"). Verified red/green.

### WR-06: A leading git global option makes the invocation "unclassified"

**Files modified:** `.pi/extensions/safety/policy.ts`, `tests/unit/policy-compose.test.ts`
**Commit:** `24b7dda`
**Applied fix:** `toGitInvocation` now skips leading `-`-prefixed tokens before selecting the subcommand, consuming a value for `-C`/`-c`/`--git-dir`/`--work-tree`/`--namespace`, mirroring `shell.ts#resolveWrappers`'s tabulated-arity approach for `env`/`sudo`.
**Before/after verdict:** `git -C /repo status` and `git --no-pager log` and `git -c user.name=x diff` (all on protected `main`) reproduced as `block` ("unclassified subcommand") pre-fix, `allow` post-fix; `git -C /repo push` (on protected `main`) stays correctly `block`, proving the fix doesn't accidentally widen the write-table's own reach.
**Regression test:** `tests/unit/policy-compose.test.ts`, four new rows. Verified red/green.

### WR-07: The safety extension loads twice in this repository

**Files modified:** `.pi/extensions/safety/index.ts`, `tests/unit/safety-entry.test.ts`, `tests/integration/double-enforcement.test.ts`
**Commit:** `56ee6f7`
**Applied fix:** The default export now checks a `globalThis`-keyed `SAFETY_INSTALLED_KEY` flag before registering anything, returning immediately if already set. A test-only `resetSafetyInstalledForTests()` export lets the test suite's own legitimate within-process multi-session pattern (several tests in one vitest worker each expecting a fresh "session") continue to work.
**Before/after verdict:** With the guard removed, calling the default export twice against two fresh `pi` stub objects (modelling the project-scope + user-scope double load, which each get their own `api` object per Pi's `createExtensionAPI`) registered the full tool set twice; with the guard restored, the second invocation registers nothing.
**Regression test:** `tests/unit/safety-entry.test.ts`, new `describe` block. Verified red/green.

### WR-08: `docs/SAFETY.md` claims coverage the code does not deliver in three places

**Files modified:** `docs/SAFETY.md`
**Commit:** `961b026`
**Applied fix:** All four bullets the finding named are corrected, now that the underlying code fixes (CR-02, CR-03/CR-04, CR-05) make the corrected claims actually true: seven tool names (not four); the refspec-independent-of-HEAD push check is stated explicitly; grep's own sensitive-read coverage is named; the bashrc-family detonation claim is now genuinely attributable to the bashrc rule (not an accidental containment-rule side effect).
**Verification:** `tests/unit/evasion-corpus.test.ts`'s Group B (doc/corpus cross-check, including the "states the honest ceiling" and "code is authoritative" assertions) passes against the updated doc.

## Skipped Issues

None — all 13 in-scope findings (5 blockers, 8 warnings) were fixed.

---

_Fixed: 2026-08-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
