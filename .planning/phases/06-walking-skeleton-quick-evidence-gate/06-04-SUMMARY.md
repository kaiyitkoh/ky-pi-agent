---
phase: 06-walking-skeleton-quick-evidence-gate
plan: 04
subsystem: testing
tags: [integration-test, pi-command, routing, safety, evidence-gate, walking-skeleton, mutation-testing]

requires:
  - phase: 06-01
    provides: "currentSha(cwd), gateCompletion() and the run-state API in workflows/evidence.ts"
  - phase: 06-02
    provides: "/quick -- the registered Pi command that composes planRoleCall, classifyGitInvocation and the evidence gate"
  - phase: 05-routing
    provides: "planRoleCall(registry, {role, state, need}): PlanResult"
  - phase: 04-safety
    provides: "classifyGitInvocation(invocation, facts): GitVerdict, PROTECTED_BRANCHES, the wrapped bash tool's real enforcement + audit log"
  - phase: 02-diagnostics
    provides: "the turns-log writer (turn_start/message_end/turn_end), loaded here to prove /quick's own work turn is really logged"
provides:
  - "tests/integration/quick-workflow.test.ts -- the walking-skeleton proof: /quick refuses in Phase 5's own words at zero provider cost, refuses in Phase 4's own words at zero provider cost, rejects a convincing fabricated transcript without ever reading it, and accepts a real guarded commit bound to a SHA the test itself reads from git, with a Phase 4 audit row and a genuine Phase 2 turn row in the same session"
affects: [06-05-phase-verification, 09-workflow-commands]

tech-stack:
  added: []
  patterns:
    - "Patch ctx.ui's notify METHOD, not the ctx.ui property -- ctx.ui is a getter returning the SAME runner.uiContext object for every context the runner ever builds (command or event), so a per-context Object.defineProperty(ctx,'ui',...) shadow (mode-switch.test.ts's technique) misses any notification issued from a later, freshly-built event context such as agent_end"
    - "A composite user-scope fixture importing multiple real subsystem entry points by absolute path and calling each default export in turn (D-12), extended here with a boolean toggle so one fixture function serves both the two-subsystem and three-subsystem cases"
    - "waitFor(predicate, timeoutMs, label): a small polling helper for a fire-and-forget pi.sendUserMessage, modelled on mode-switch.test.ts's waitForConfiguredAuth -- never a bare setTimeout guess"

key-files:
  created:
    - tests/integration/quick-workflow.test.ts
  modified: []

key-decisions:
  - "ctx.ui.notify is patched on the shared underlying object and restored in a finally, not shadowed per-context -- confirmed necessary by running the file with the mode-switch.test.ts shadowing technique first and observing an empty notifications array on cases 3/4 despite a real evidence row landing"
  - "Both tasks' cases (0-4) were committed as a single test(06-04) commit rather than two separate per-task commits -- the file was authored and iterated on as one cohesive unit and splitting it into two commits after the fact would have required reconstructing an artificial intermediate state with no verification benefit; documented here as the deviation from strict per-task atomic commits"
  - "MUTATION 3's honest finding (see below) is recorded rather than papered over with a stronger assertion -- the plan's own wording anticipated this exact possibility ('it would refuse with the git reason, or not at all')"

requirements-completed: [FLOW-01, GATE-07]

duration: ~50min
completed: 2026-08-14
---

# Phase 6 Plan 4: /quick Walking-Skeleton Integration Test Summary

**Five session-level cases in `tests/integration/quick-workflow.test.ts` proving `/quick` really composes Phase 4's git guard, Phase 5's routing guard and Phase 6's evidence gate — two refusals in the guards' own words at zero provider cost, one fabricated-transcript rejection the gate is shown never to have read, and one real guarded commit accepted and bound to a SHA read via the test's own `git rev-parse HEAD`, alongside a genuine Phase 4 audit row and Phase 2 turn row in the same session.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments

- `tests/integration/quick-workflow.test.ts` created: 5 tests, all green, all reading expected refusal text from the real `planRoleCall`/`classifyGitInvocation` functions rather than retyping literals (D-13)
- Case 4 composes all three subsystems (`safety/index.ts`, `workflows/index.ts`, `diagnostics/index.ts`) in one session and proves a real `kind:"turn"` row lands in the Phase 2 turns log for `/quick`'s own work turn — **this seam connects; no SEAM FINDING was needed for assertion (e)**
- Discovered and fixed a genuine bug in the test's own notification-capture technique before it could hide a false negative: `ctx.ui` is a getter returning the SAME `runner.uiContext` object for every context Pi ever builds (command or event) [`dist/core/extensions/runner.js:464-467`]; `mode-switch.test.ts`'s per-context `Object.defineProperty(ctx,"ui",...)` shadow only works because every assertion in that file happens inside the same command handler. Cases 3/4 need the notification `agent_end` issues on a *different*, freshly-built context — shadowing missed it entirely (observed: empty `notifications` array despite a real evidence row on disk). Fixed by patching the shared object's `notify` method directly and restoring it in a `finally`
- All 6 mutations from both tasks' acceptance criteria were actually executed against real code, observed, and reverted — see Mutation Log below
- Full suite green throughout: 83 files / 1399 tests, `tsc --noEmit` clean

## Task Commits

Both tasks build the same file incrementally and were committed as one unit (see Deviations):

1. **Tasks 1+2: the walking-skeleton proof, both refusal seams + evidence-gate cases** - `5a1fef1` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `tests/integration/quick-workflow.test.ts` - new file, 655 lines. Five cases: case 0 (vacuity guard, `/quick` really registered), case 1 (no configured auth → `planRoleCall`'s own refusal, `callCount === 0`), case 2 (protected branch → `classifyGitInvocation`'s own refusal, `callCount === 0`), case 3 (fabricated `$ npm test`/`exit 0` transcript → rejected, reason quotes none of it, `callCount === 1`), case 4 (real `git commit --allow-empty` through the guarded bash tool → accepted, SHA verified against the test's own `git rev-parse HEAD`, Phase 4 audit row present, Phase 2 turn row present). Both cases 3 and 4 additionally prove the run disarms: a second, ordinary turn after the gated one writes no second evidence row.

## Decisions Made

- **Notification capture fix (found during Task 2, applies to all four notification-checking cases):** patch `ctx.ui.notify` on the shared `runner.uiContext` object and restore in a `finally`, rather than shadowing `ctx.ui` per-context. See key-decisions and the file's own `captureNotify` docstring for the full reasoning and the observed failure that led to it.
- **Single commit for both tasks:** the plan structures this as two TDD-flavoured tasks against one file (cases 0-2, then cases 3-4), but since the file was authored and debugged as one cohesive artifact and both tasks' `tdd="true"` framing is really "write real assertions, then falsify them with mutations" rather than the classic new-production-code RED/GREEN/REFACTOR cycle (no production code was added by this plan — everything it calls already shipped in 06-01/06-02), reconstructing an artificial intermediate commit state would have added risk (a half-finished file with no independent verification value) without reflecting how the work was actually done. Recorded here as the deviation from strict per-task atomicity.
- **ROLE_MAP.cheap.executor's first candidate is read live** via `flashExecutorCandidate()`, never hardcoded — matches 05-11's decision and keeps this file tracking the real routing table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed the notification-capture technique to observe event-context notifications**
- **Found during:** Task 2, first run of cases 3 and 4
- **Issue:** Copying `mode-switch.test.ts`'s `Object.defineProperty(ctx, "ui", ...)` shadow left `notifications` empty for cases 3/4 even though a real evidence verdict landed on disk — the shadow only replaces the ONE `ctx` object's own property, but `/quick`'s acceptance/rejection notification fires from `agent_end`, a different, freshly-built context object that reads the same underlying `runner.uiContext` via its own getter.
- **Fix:** Replaced `withCapturedNotify` with `captureNotify`, which patches the `notify` method on the shared `ctx.ui` object itself (proven, by reading Pi's own source, to be the SAME object reference across every context) and restores it in a `finally` block in every case, so the mutation never leaks into a later test.
- **Files modified:** `tests/integration/quick-workflow.test.ts` (test-only; no production code touched)
- **Verification:** All 5 cases pass with the patched technique; `tsc --noEmit` clean
- **Committed in:** `5a1fef1`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — without it, cases 3 and 4 would have silently asserted nothing about the notification text, which is exactly the false-assurance shape this phase exists to eliminate. No scope creep; only the test file was touched.

## Issues Encountered

None beyond the notification-capture bug documented above, which was fully resolved before this plan's tests were considered done.

## Known Stubs

None. Every assertion reads real production output: `planRoleCall`/`classifyGitInvocation`'s real return values, real JSONL rows written by the real `evidence.ts`/`safety/audit.ts`/`diagnostics/index.ts` writers, and a real `git rev-parse HEAD` this test runs itself.

## Threat Flags

None. This plan adds no new production code and no new trust-boundary surface — it is a test file exercising the surfaces Phase 4/5/6 already shipped and whose threat models already account for. The `<threat_model>` entries T-06-17 through T-06-21 and T-06-SC (fabricated evidence, faked refusal wording, an unloaded guard, tests writing outside a temp dir, an unbounded poll, and package installs) are all mitigated as designed — see the Mutation Log for T-06-17/T-06-18/T-06-19's falsification runs.

## Mutation Log

Every mutation below was actually applied to the real source, run, observed, and reverted (confirmed via `git diff` returning empty afterward).

### Task 1 mutations (workflows/index.ts)

**MUTATION 1 — `plan.reason` replaced with the literal `"cannot route"`.**
Expected: case 1 goes red. **Observed: RED**, exactly as predicted:
```
AssertionError: /quick's refusal text does not equal planRoleCall's own reason -- it may be retyped or hardcoded: expected 'cannot route' to be 'no configured candidate among: deepse…'
Expected: "no configured candidate among: deepseek/deepseek-v4-flash (no configured auth), dashscope/deepseek-v4-flash (did not resolve)"
Received: "cannot route"
```
Reverted; `git diff` clean.

**MUTATION 2 — the `classifyGitInvocation` pre-flight deleted entirely from `/quick`.**
Expected: case 2 goes red (and `callCount` becomes 1). **Observed: RED**:
```
AssertionError: a refusal must still report an outcome: expected +0 to be 1
```
Case 2's synchronous notification assertion fails first (no refusal is ever notified inside the command handler once the git check is gone, since `/quick` falls through to `startRun`/`sendUserMessage`), confirming the pre-flight's removal is detected. Reverted; `git diff` clean.

**MUTATION 3 — the two pre-flight checks reordered (git check moved before the routing check).**
Expected per the plan's own hedged wording: "case 1 goes red (it would refuse with the git reason, **or not at all**)". **Observed: case 1 stayed GREEN.** This is a genuine, honestly-recorded finding, not a shim around a failing assertion: case 1's fixture uses branch `"work"` (explicitly "irrelevant to this case," per the plan's own action text) and case 2's fixture always has a servable route (`plan.ok === true`). In **both** cases only ONE of the two guards is ever capable of blocking for that specific fixture — the other guard always passes silently regardless of where it runs in the sequence — so swapping the two checks' relative order produces an *identical* final notification in either fixture. **What this proves:** mutations 1 and 2 independently confirm BOTH checks are genuinely called and gate correctly (the load-bearing safety property — `faux.state.callCount === 0` on every refusal — holds regardless of order, since both checks run before `startRun`/`sendUserMessage` either way). **What this does NOT prove:** the *relative* order between the two independent guards is not pinned by this test file; a fixture where BOTH guards would independently block (unauthenticated AND on a protected branch simultaneously) would be needed to observe which reason surfaces first, and no such fixture exists in this plan's cases. This is recorded as a known, accepted gap rather than papered over with a weaker or fabricated assertion — the relative order has no safety consequence (zero provider requests either way), only a cosmetic one (which reason text the user sees). Reverted; `git diff` clean.

### Task 2 mutations (workflows/index.ts, workflows/evidence.ts, and the test's own composite fixture)

**MUTATION 4 — `/quick`'s `tool_result` capture handler deleted.**
Expected: case 4 goes red with the gate's "no structured tool result" reason (an accepted run becomes a rejected one). **Observed: RED**, exactly as predicted:
```
AssertionError: expected accept, got: {"...","verdict":"reject","reason":"no structured tool result was recorded for this completion claim -- transcript text is not evidence, however convincing it reads","recordCount":0,...}
Expected: "accept"
Received: "reject"
```
Reverted; `git diff` clean.

**MUTATION 5 — `gateCompletion` mutated to skip the SHA comparison (`atHead = records` instead of `records.filter(r => r.sha === headSha)`).**
Expected: case 3 stays green (this plan's own test does not exercise the stale-SHA path — its evidence set is always empty, so the presence check at branch (1) fires before the SHA filter is ever reached); `tests/unit/evidence-gate.test.ts`'s R2/M1 cases are what catch this. **Observed: exactly as predicted.**
- `tests/integration/quick-workflow.test.ts -t "case 3"`: **1 passed** (unaffected).
- `tests/unit/evidence-gate.test.ts`: **2 failed** (R2 and M1):
```
FAIL ... R2 -- stale SHA: evidence recorded at A, claim made at head (B)
AssertionError: evidence captured at an older commit than HEAD must not satisfy a claim made now -- got {"ok":true,...}: expected true to be false
FAIL ... M1 -- no borrowing: stale-but-passing plus fresh-but-failing
AssertionError: a passing record from a DIFFERENT sha may not be borrowed to rescue a claim at HEAD ... -- got {"ok":true,...}: expected true to be false
```
This confirms, by direct falsification rather than assertion, that `tests/unit/evidence-gate.test.ts` — not this plan's session-level case 3 — is the test that actually pins GATE-07's stale-SHA rule. Reverted; `tests/unit/evidence-gate.test.ts` back to 10/10 passing; `git diff` clean.

**MUTATION 6 — `safety/index.ts` removed from the composite fixture (test file's own `composite()` function, not production code).**
Expected: case 4's assertion (d) goes red (proving the audit row came from the real Phase 4 extension, not from something else in the session). **Observed: RED**, exactly as predicted — and further downstream than assertion (d) itself, at the audit-log-existence guard:
```
Error: ...\.pi\logs\audit-2026-08-14.jsonl does not exist: the session wrote no safety audit log at all. The likeliest cause is the safety extension not loading at USER scope.
```
Reverted; `git diff` clean.

## SEAM FINDING

**None required.** Every seam this plan set out to prove connects:
- The Phase 5 seam (routing refusal) connects: `/quick` genuinely calls `planRoleCall` and surfaces its exact reason (case 1, MUTATION 1).
- The Phase 4 seam (branch-policy refusal) connects: `/quick` genuinely calls `classifyGitInvocation` and surfaces its exact reason (case 2, MUTATION 2).
- The evidence gate connects on both branches: fabrication is rejected without ever being read (case 3), and a real guarded commit is accepted and bound to a real SHA (case 4, MUTATIONS 4 and 6).
- The Phase 2 turn-log seam — the one plan 06-02's own SUMMARY explicitly deferred as "plan 06-04's scope" — **connects**: case 4's composed session, with `diagnostics/index.ts` loaded alongside `safety/index.ts` and `workflows/index.ts`, produces a genuine `kind:"turn"` row for `/quick`'s own work turn with no code in `/quick` itself doing anything diagnostics-specific (D-5 from plan 06-02, now proven rather than merely reasoned about).

The one finding this plan surfaced is MUTATION 3's (see Mutation Log): the *relative order* of the two independent pre-flight guards is not independently pinned by cases 1/2 as constructed, because each fixture only ever triggers one of the two guards. This is a test-completeness observation about check ORDERING, not a disconnected seam — both guards are proven to fire correctly and proven to cost zero provider requests regardless of order (mutations 1 and 2), which is the property that actually matters for GATE-07/FLOW-01's safety claim.

## Decision D-16, restated

Evidence is bound to the SHA at capture time and compared against HEAD at claim time. A verification command run BEFORE the commit is therefore stale by construction the instant the commit lands — GATE-07's stated rule, not a defect. This plan's case 4 makes exactly one commit and captures evidence from that same commit, so it never exercises the stale-SHA path directly; `tests/unit/evidence-gate.test.ts`'s R2/M1 own that proof, confirmed independently by MUTATION 5 above. Re-running verification after a commit, or binding to a tree hash instead of a commit SHA, remains Phase 8's job.

## User Setup Required

None - no external service configuration required.

## Full Verification

```
$ npx tsc --noEmit
(no output -- exit 0)

$ npx vitest run tests/integration/quick-workflow.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ npx vitest run
 Test Files  83 passed (83)
      Tests  1399 passed (1399)
   Duration  32.44s

$ git diff .pi/extensions/workflows/index.ts .pi/extensions/workflows/evidence.ts
(no output -- every mutation fully reverted)
```

## Next Phase Readiness

- The walking skeleton is proven end to end: route → guard → arm → hand off → gate → commit, with all three composed subsystems' own real functions doing the work, not a re-implementation.
- `tests/integration/quick-workflow.test.ts` is a durable regression guard for `/quick` going forward — any future change to `workflows/index.ts`'s dispatch order, `evidence.ts`'s predicate, or the Phase 4/5 guards it composes will be caught here.
- No blockers. Phase 6 (`06-01` through `06-04`) is now fully executed; FLOW-01 and GATE-07 both have session-level proof in addition to their unit-level coverage from 06-01/06-03.
- The MUTATION 3 finding (check-order is not independently pinned) is a candidate for a future hardening pass if Phase 9's `/plan`/`/execute`/`/review` commands ever need a fixture where both guards can fire simultaneously — not urgent, since the safety property (zero cost on any refusal) already holds regardless of order.

---
*Phase: 06-walking-skeleton-quick-evidence-gate*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: tests/integration/quick-workflow.test.ts
- FOUND: .planning/phases/06-walking-skeleton-quick-evidence-gate/06-04-SUMMARY.md
- FOUND commit: 5a1fef1
