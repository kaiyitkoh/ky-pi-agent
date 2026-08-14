---
phase: 05-routing-capability-guards
fixed_at: 2026-08-14T12:31:08Z
review_path: .planning/phases/05-routing-capability-guards/05-REVIEW.md
iteration: 1
findings_in_scope: 14
fixed: 14
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-08-14T12:31:08Z
**Source review:** .planning/phases/05-routing-capability-guards/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 14 (3 Critical, 11 Warning — `fix_scope: critical_warning`, Info findings IN-01..IN-05 out of scope, untouched)
- Fixed: 14
- Skipped: 0

**Autonomous run note:** This was an unattended overnight run per the standing autonomous-run policy. Every fix was applied, verified (3-tier: re-read, `npx tsc --noEmit`, and a live falsification — the fix was temporarily reverted, the new/updated test was confirmed to go red, then the fix was restored and reconfirmed green), and committed atomically. The full suite (`npx vitest run`) and `npm run typecheck` were run once at the end: **1370 tests / 79 files passed, typecheck clean.**

**CR-01 verification note:** The finding's own evidence was a stray `subagents.agentOverrides.planner` key written into the developer's REAL `~/.pi/agent/settings.json` (mtime 2026-08-14 19:29) by a prior, unisolated test run. Per the priority guidance, this file was **not** touched — the fix (`tests/setup/agent-dir.ts`'s suite-wide guard) was verified instead by confirming the file's mtime stayed at 19:29 across both the targeted CR-01 test run and the full 1370-test suite run at the end of this session. The stray key is still present on disk; removing it is the orchestrator's machine-level cleanup, not this run's.

## Fixed Issues

### CR-01: The test suite writes to the developer's REAL global Pi settings file

**Files modified:** `tests/setup/agent-dir.ts` (new), `vitest.config.ts`, `tests/integration/mode-switch.test.ts`, `tests/unit/agent-overrides.test.ts`, `tests/global-teardown.ts`
**Commit:** b4a5711
**Applied fix:** Added a suite-wide `setupFiles` guard (`tests/setup/agent-dir.ts`) that points `PI_CODING_AGENT_DIR` at a fresh temp dir in `beforeAll`, before any test in a file runs — closing the hole structurally rather than relying on per-case discipline. Updated `mode-switch.test.ts`/`agent-overrides.test.ts`'s per-case overrides to *restore* the suite value afterward instead of `delete`-ing the env var (which would have punched a hole in the guard for the rest of that file's cases). Extended `tests/global-teardown.ts` with a second tripwire that snapshots/compares the REAL `~/.pi/agent/settings.json` across the whole run, independent of what any test file does to its own worker's `process.env`.

### CR-02: `runSingleShotRole` discards a resolved chain-member candidate and restarts `callWithFallback` at CHAIN[0]

**Files modified:** `.pi/extensions/routing/modes.ts`, `tests/integration/single-shot-roles.test.ts`
**Commit:** 70ec78f
**Applied fix:** `runSingleShotRole` now enters `callWithFallback` only when the resolved candidate genuinely IS `CHAIN[0]`; every other resolved candidate (chain member or not) is served directly through `callModel` with the specific model the router selected. Added a DashScope-only regression test (`deepseek` deliberately left as Pi's real, unauthed built-in provider — never a network risk under the fix, since the fixed code path never touches it) proving the router's own resolved candidate is served.

### CR-03: A truncated Qoder stream is returned to the model as a complete result

**Files modified:** `.pi/extensions/qoder/client.ts`, `tests/integration/qoder-delegate.test.ts`
**Commit:** 83e887e
**Applied fix:** After the SSE read loop exits, the trailing decoder/buffer is flushed (`decoder.decode()` with no argument + a final `parseSseFrames` pass) so a server that ends the body without a final blank line no longer loses the last frame. `delegateTask` now throws when `!folded.done` instead of returning a partial `FoldedResult` silently. Added loopback cases for both defects (missing trailing blank line; stream closed before `session.status_idle`).

### WR-01: ADJUDICATION — cheap's leg was unproven; closed

**Files modified:** `tests/integration/wire-proof.test.ts`
**Commit:** 5191812
**Applied fix:** Built on CR-02's fix. Added a Task 3 to the wire-proof fixture that switches to `cheap.advisor` (`deepseek/deepseek-v4-pro` — deliberately NOT a `CHAIN` member, since `CHAIN` only knows `deepseek-v4-flash`, and distinct from `balanced.advisor`'s Bedrock Claude), with the session's own executor deliberately switched to a different-tier model first so "the nested row differs from the session's own executor" is non-vacuous. Asserts turn-row identity plus the `corr`-joined `nested.request` payload. This closes the adjudication: criterion 1 is now proven for cheap, balanced, and max.

### WR-02: `writeAgentOverrides` can throw despite documenting "never throws"; the write is not atomic

**Files modified:** `.pi/extensions/routing/agent-overrides.ts`, `tests/unit/agent-overrides.test.ts`
**Commit:** 87e701f
**Applied fix:** Wrapped the whole function body in `try`/`catch` returning `{ok:false, reason, path}`. Removed the dead-weight `void statSync(path)`. Replaced the direct `writeFileSync` with a temp-file (`<path>.<pid>.tmp`, same directory as the target) + `renameSync` for an atomic write. Added a case asserting a refusal (not a throw) when the target directory does not exist, and a case asserting no stray temp file is left behind on success.

### WR-03: `getModeState()` validates shape but not that `mode` is a real mode

**Files modified:** `.pi/extensions/routing/modes.ts`, `tests/unit/routing-dispatch.test.ts`
**Commit:** 42942f9
**Applied fix:** `isKyModeData` now checks `(MODES as readonly string[]).includes(candidate.mode)`, the same narrowing `restoreModeFromBranch` already applies (T-05-36), so a stale/corrupted `globalThis` slot value falls back to `DEFAULT_MODE` instead of crashing `resolveRoute`. Added a unit case that plants a corrupted slot value directly and asserts `resolveRoute` never throws for any role.

### WR-04: `restoreModeFromBranch` throws on a `data: null` payload, contradicting its "NEVER THROWS" contract

**Files modified:** `.pi/extensions/routing/index.ts`, `tests/integration/mode-persistence.test.ts`
**Commit:** e13e9d7
**Applied fix:** Changed the guard from `latest?.data === undefined` (which does not catch `null`) to `latest === undefined || latest.data === null || typeof latest.data !== "object"`. Added a case (`data: null`) proving the function neither throws nor mutates already-in-force state — an early return, not a forced reset to `DEFAULT_MODE` (that only happens once `data` is confirmed to be an object worth reading `mode` off of).

### WR-05: A mode switch clears escalation without writing the durable escalation record

**Files modified:** `.pi/extensions/routing/index.ts`, `tests/integration/escalate.test.ts`
**Commit:** 9b7078f
**Applied fix:** `applyMode` now captures `priorState`/`previousModel` before the mutation and, when `priorState.escalated` was true, calls `writeEscalationRecord` with `escalated:false` after the switch succeeds — closing the "`/escalate` → (expensive turns) → `/cheap`" gap the module's own docstring already promised a record for. Added an integration case (escalate on, then `/cheap`) asserting the LAST `escalation-*.jsonl` record names `escalated:false`, paired with a positive control proving the ON record exists too.

### WR-06: The Qoder stream-open step writes no transcript record

**Files modified:** `.pi/extensions/qoder/client.ts`, `tests/integration/qoder-delegate.test.ts`
**Commit:** bfbf6b4
**Applied fix:** Added `qoder.stream.open.request`/`qoder.stream.open.response` transcript writes mirroring the other two steps, so RB-05-01's documented 401/403 failure signal can actually be found in the transcript for all three requests. Added a test asserting both records exist with the response carrying the HTTP status.

### WR-07: The Qoder SSE read loop has no timeout

**Files modified:** `.pi/extensions/qoder/client.ts`, `tests/helpers/qoder-loopback.ts`, `tests/integration/qoder-delegate.test.ts`
**Commit:** 04e7862
**Applied fix:** Added a 5-minute inactivity deadline (`STREAM_INACTIVITY_TIMEOUT_MS`) that resets on every chunk (never a fixed wall-clock budget), races `reader.read()` against the remaining budget, and cancels the reader before throwing an actionable error. Added a test-only `inactivityTimeoutMs` injection seam so the behaviour is provable without an actual 5-minute wait. Extended the loopback helper with a configurable inter-write delay (`splitDelayMs`) to simulate a real stall. Two new tests: one proving a stall is detected and reported, one proving genuine (if slow) progress is never cut short.

### WR-08: The server-supplied Qoder session id is spliced into request paths unencoded

**Files modified:** `.pi/extensions/qoder/client.ts`, `tests/helpers/qoder-loopback.ts`, `tests/integration/qoder-delegate.test.ts`
**Commit:** 4b93285
**Applied fix:** Added a positive shape check (`/^[A-Za-z0-9._-]{1,128}$/`) on the session id before it is used anywhere, refusing (not truncating or coercing) a malformed id and naming the offending value. Also applies `encodeURIComponent` defensively. Added a `sessionIdOverride` seam to the loopback helper and two tests: a path-traversal-shaped id, and a merely-slash-containing id (proving the check is a positive shape match, not a denylist).

### WR-09: `MAX_TASK_CHARS` and the empty-task refusal have zero test coverage

**Files modified:** `tests/integration/qoder-delegate.test.ts` (no source change — this finding was test-coverage-only)
**Commit:** e4561b6
**Applied fix:** Added three cases: whitespace-only task refused with zero requests, one-character-over-limit task refused naming the limit with zero requests, and the paired positive (exactly-at-limit task succeeds).

### WR-10: The "writeAgentOverrides is never reached" case is self-fulfilling

**Files modified:** `.pi/extensions/routing/index.ts`, `tests/integration/mode-switch.test.ts`, `tests/unit/agent-overrides.test.ts`
**Commit:** fa28953
**Applied fix:** Added a minimal test-only injection seam (`RoutingTestOptions`, threaded from the default export's second, test-only parameter down to `applyMode`'s `agentOverridesFor` call) so a test can drive the REAL `/balanced` command against a role map whose `balanced.planner` candidate is guard-blocked, and assert the CALLER's own observable behaviour (the step-6 notification text, and the injected settings.json's byte content) — not merely the test's own choice not to call `writeAgentOverrides`. The prior unit-level case in `agent-overrides.test.ts` is kept (documented as narrower/self-fulfilling by design) with a comment pointing to the new integration case as the real proof.

### WR-11: `qoder_delegate` has no confirmation gate and no configuration gate

**Files modified:** `.pi/extensions/qoder/index.ts`, `tests/integration/qoder-tool.test.ts` (new)
**Commit:** 456087e
**Applied fix:** (1) Added a deny-by-default `ctx.ui.select` confirmation, mirroring `safety/index.ts#registerApprovalTool`'s exact shape — `undefined` (no UI) and `hasUI === false` both refuse via the same branch. (2) Added a configuration gate: since Pi auto-activates newly-registered tools by default [VERIFIED: `dist/core/agent-session.js:1995-2014`], the extension now immediately deactivates `qoder_delegate` via `pi.setActiveTools(...)` when `resolveQoderConfig` cannot resolve, so an unconfigured machine pays none of the tool's ~329-token schema cost. New test file (`tests/integration/qoder-tool.test.ts`, 5 cases) covers both gates, driven through the real registered tool (`session.extensionRunner.getToolDefinition("qoder_delegate")`), not just the underlying client function.

**Judgement call (autonomous, no standing decision found in 05-CONTEXT.md waiving it):** WR-11's confirmation gate is a real UX/behavior decision, not merely a bug fix. Chose to implement it — consistent with CLAUDE.md's stated security posture ("Extensions execute arbitrary code with full user permissions on a laptop holding live AWS SSO credentials for an account where `main` auto-deploys") and with the precedent `safety/index.ts#registerApprovalTool` already sets for exactly this class of consequential, foreign-code-reaching action.

## Skipped Issues

None — all 14 in-scope findings were fixed.

---

_Fixed: 2026-08-14T12:31:08Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
