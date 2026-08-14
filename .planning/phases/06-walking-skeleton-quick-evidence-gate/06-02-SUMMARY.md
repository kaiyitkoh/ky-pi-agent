---
phase: 06-walking-skeleton-quick-evidence-gate
plan: 02
subsystem: workflows
tags: [pi-command, routing, safety, evidence-gate, walking-skeleton]

requires:
  - phase: 06-01
    provides: "currentSha(cwd), gateCompletion() and the run-state API (startRun/recordFromToolResult/recordToolResult/isRunArmed/endRun) in workflows/evidence.ts"
  - phase: 05-routing
    provides: "planRoleCall(registry, {role, state, need}): PlanResult, getModeState() -- the whole route-plan-and-guard pipeline in one pure call"
  - phase: 04-safety
    provides: "classifyGitInvocation(invocation, facts): GitVerdict, currentBranch(cwd), PROTECTED_BRANCHES -- the branch-policy pre-flight"
provides:
  - "/quick -- a registered Pi command (never a tool) that pre-flights the executor route, pre-flights the branch policy, arms the GATE-07 evidence run, hands the task to the ordinary session prompt loop, and gates completion at agent_end"
  - "docs/WORKFLOWS.md -- the rationale relocated out of /quick's 8-line header: what /quick is, the dispatch shape and its two load-bearing findings, the raw-line budget rule with its header exception and anti-offloading aggregate, and the evidence-not-narration argument"
affects: [06-03-line-budget-registry, 06-04-quick-workflow-integration-test]

tech-stack:
  added: []
  patterns:
    - "A command's whole dispatch order stated as a one-line comment at the top of the handler -- 'the order is the whole claim'"
    - "Refusal reasons passed through verbatim from the real function (PlanResult.reason, GitVerdict.reason) -- never retyped, never wrapped"
    - "Gate at agent_end, never at an awaited ctx.waitForIdle() -- waitForIdle is a no-op in every headless session this repo's tests use"

key-files:
  created:
    - .pi/extensions/workflows/index.ts
    - docs/WORKFLOWS.md
  modified: []

key-decisions:
  - "The line budget is raw lines (readFileSync().split(\"\\n\").length), stated in docs/WORKFLOWS.md rather than restated as a number there -- tests/unit/workflow-budgets.test.ts (plan 06-03) is the single authoritative registry"
  - "/quick's header is capped short as a deliberate, stated exception to house style -- the rationale is relocated to docs/WORKFLOWS.md, not deleted"
  - "/quick never makes a nested model call for the work itself -- runSingleShotRole throws for the executor role by design (modes.ts:401-406), so the task is handed to the session's ordinary prompt loop via pi.sendUserMessage"
  - "The completion gate fires on Pi's agent_end event, never on an awaited ctx.waitForIdle() -- waitForIdle resolves immediately as a no-op in every headless session this repo's test harness uses (runner.js:260)"

patterns-established:
  - "Both event handlers (tool_result capture, agent_end gate) swallow their own try/catch, mirroring safety/index.ts's session_start hook -- a capture or gate-evaluation failure must never break an ordinary tool result or turn, and a swallowed capture yields no evidence, which the gate then rejects (fail closed by construction)"

requirements-completed: [FLOW-01, GATE-07]

duration: ~25min
completed: 2026-08-14
---

# Phase 6 Plan 2: /quick -- the Walking Skeleton Command Summary

**A 73-raw-line Pi command that pre-flights Phase 5's `planRoleCall` and Phase 4's `classifyGitInvocation`, arms the Phase 6 evidence gate, hands the task to the session's own prompt loop via `pi.sendUserMessage`, and gates completion on Pi's `agent_end` event -- with `docs/WORKFLOWS.md` carrying the rationale the header is too short to hold.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-14T22:15:00+08:00 (approx, first Read call)
- **Completed:** 2026-08-14T22:40:02+08:00
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- `docs/WORKFLOWS.md` created first, deliberately, so `/quick`'s header pointer is never dangling -- carries all four required sections (what `/quick` is, the dispatch shape with the `modes.ts:401-406` and `runner.js:260` citations, the line-budget rule, evidence-not-narration) and no budget number besides `80`, verified by grepping the file for every `\d{2,4}` run and confirming each hit is a `modes.ts:401`/`runner.js:260` citation
- `.pi/extensions/workflows/index.ts` created: one `registerCommand("quick", ...)` plus a `tool_result` capture handler and an `agent_end` gate handler, at **73 raw lines** -- under the 80-line budget, with an 8-line header
- All five composed seams are genuinely called from the file: `planRoleCall(`, `classifyGitInvocation(`, `startRun(`, `endRun(`, `sendUserMessage(` -- verified by grep, not merely present in intent
- Zero `spawnSync`/`execSync`/`exec(` in the file -- `/quick` runs no process of its own; its only git contact is `safety/git.ts`'s two read-only oracles (`currentBranch`, `currentSha`)
- Zero `waitForIdle` and zero `modelRegistry.complete` in the file -- both measured constraints from the plan's `<interfaces>`/`<decisions>` blocks are respected structurally, not just by convention
- `tests/unit/contributing-boundary.test.ts` passes: the tool-registration call appears nowhere in the file, not even in a comment
- `tests/unit/extension-layout.test.ts` passes: `.pi/extensions/workflows/index.ts` is recognised as an auto-discovered entry point (default export at statement position, nested-index shape)

## Task Commits

Each task was committed atomically:

1. **Task 1: docs/WORKFLOWS.md -- the rationale /quick's header cannot hold** - `7b33ddf` (docs)
2. **Task 2: .pi/extensions/workflows/index.ts -- /quick, in <=80 raw lines** - `2d85def` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `docs/WORKFLOWS.md` - new file, 132 lines: what `/quick` is (command vs tool vs skill, citing `CONTRIBUTING.md`'s boundary rule without re-arguing it), the five-step dispatch shape with its two load-bearing findings, the raw-line budget rule (D-1/D-2/D-3) with a pointer to `tests/unit/workflow-budgets.test.ts` rather than a restated number, and the evidence-not-narration argument pointing at `workflows/evidence.ts` and `diagnostics/prose.ts`
- `.pi/extensions/workflows/index.ts` - new file, **73 raw lines** (`wc -l`): default-exported `function (pi: ExtensionAPI): void` registering `registerCommand("quick", ...)` (usage check -> `planRoleCall` pre-flight -> `classifyGitInvocation` pre-flight -> `startRun` -> `pi.sendUserMessage`, steps 3-5 wrapped in one `try`/`catch`), `pi.on("tool_result", ...)` (records one `EvidenceRecord` per structured tool result while a run is armed, swallowed try/catch), and `pi.on("agent_end", ...)` (calls `endRun`, notifies the verdict, swallowed try/catch)

## Decisions Made

D-1 through D-7 from the plan's `<decisions>` block were followed as written; no new architectural decisions were required for this plan. The one judgement call exercised in the moment: the header's exact wording (8 lines, under the plan's 12-line cap) and the exact phrasing of the usage-error and evidence-accepted notify strings, both chosen to stay inside the raw-line budget while still naming the accepted form (`"/quick <task>"`) and the accepted SHA on acceptance.

## Deviations from Plan

None - plan executed exactly as written. Both files match the plan's `<action>` sections task-for-task: `docs/WORKFLOWS.md`'s four sections in the specified order, and `/quick`'s five-step handler in the specified order with the specified try/catch scope.

## Issues Encountered

One self-imposed constraint required care rather than causing rework: `docs/WORKFLOWS.md`'s acceptance criterion forbids any raw `\d{2,4}` number other than `80`, a file:line citation, or a phase number. This ruled out stating the ROADMAP's "100 lines is a hard failure" ceiling, the header's own 12-line cap, and Pi's `0.84.1` version number anywhere in the document's prose -- all three were written around rather than included, since the task's own acceptance grep is the authority here and the numbers are stated correctly elsewhere (`06-02-PLAN.md`, `CLAUDE.md`).

## Known Stubs

None. Every line of `.pi/extensions/workflows/index.ts` calls a real, already-shipped function (`planRoleCall`, `classifyGitInvocation`, `currentBranch`, `currentSha`, `startRun`, `recordFromToolResult`, `recordToolResult`, `isRunArmed`, `endRun`) or a real Pi API (`registerCommand`, `on`, `sendUserMessage`, `ctx.ui.notify`). No hardcoded empty value, no placeholder string, no component wired to mock data -- there is no UI component in this plan at all.

## Threat Flags

None. Every threat this plan's `<threat_model>` names (T-06-07 through T-06-11, T-06-SC) is addressed by the shipped code: zero `spawnSync`/`exec` hits (T-06-07), the `classifyGitInvocation` pre-flight before any turn is triggered (T-06-08), verbatim pass-through of `PlanResult.reason`/`GitVerdict.reason` with no retyped literal anywhere in the file (T-06-09), the task string reaching only `pi.sendUserMessage`'s argument and never a log or an argv (T-06-10), and both event handlers swallowing their own try/catch so a capture failure degrades to "no evidence, gate rejects" rather than breaking every tool result in the session (T-06-11). `package.json` is untouched (T-06-SC). No new network endpoint, auth path, file-access pattern, or schema change at a trust boundary was introduced beyond what the threat model already names.

## SEAM FINDING

None for this plan. Every seam RESEARCH.md and PATTERNS.md predicted composed exactly as described: `planRoleCall`'s refusal reason surfaces verbatim (D-4's `modes.ts:401-406` finding held -- no nested `runSingleShotRole`/`callModel` call was needed or attempted), `classifyGitInvocation`'s pre-flight composed cleanly against `currentBranch`/`PROTECTED_BRANCHES` with no new safety code, and the evidence run-state API from plan 06-01 (`startRun`/`recordFromToolResult`/`recordToolResult`/`isRunArmed`/`endRun`) wired into `tool_result`/`agent_end` with no signature mismatch and no missing export. `waitForIdle`'s headless no-op behaviour (D-6's `runner.js:260` finding) was respected by construction -- the file contains zero references to it, confirmed by grep. `/quick`'s own commit path was never exercised end-to-end in this plan (no session-level test was run) -- that composition proof is explicitly plan 06-04's scope per this plan's own `<decisions>` block (D-7) and RESEARCH.md's Q4 test-strategy table.

## User Setup Required

None - no external service configuration required.

## Full Verification

```
$ wc -l < .pi/extensions/workflows/index.ts
73

$ npx tsc --noEmit
(no output -- exit 0)

$ npx vitest run tests/unit/extension-layout.test.ts tests/unit/contributing-boundary.test.ts tests/unit/chokepoint-lint.test.ts tests/unit/pinning.test.ts
 Test Files  4 passed (4)
      Tests  56 passed (56)

$ npx vitest run tests/unit/docs-policy.test.ts
 Test Files  1 passed (1)
      Tests  73 passed (73)

$ npx vitest run
 Test Files  81 passed (81)
      Tests  1386 passed (1386)
   Duration  31.69s

$ git diff --name-only  (against the pre-plan commit)
-- docs/RUNBOOK.md not present in this diff; only docs/WORKFLOWS.md and
   .pi/extensions/workflows/index.ts were added, matching files_modified
```

## Next Phase Readiness

- `/quick` is registered, composes all three real Phase 4/5/6 seams, and stays under the raw-line budget at 73 lines -- ready for plan 06-03's line-budget registry test (`tests/unit/workflow-budgets.test.ts`) to enforce this number going forward, and for plan 06-04's session-level integration test to drive it end-to-end (route refusal, branch-policy refusal, and the acceptance path with a real `agent_end`).
- `docs/WORKFLOWS.md` exists and is internally consistent with the shipped code -- no committed budget number to keep in sync, since plan 06-03 owns that registry exclusively.
- No blockers. Full suite (1386 tests / 81 files) and `tsc --noEmit` both green; `docs/RUNBOOK.md` untouched, as this phase adds no `RB-06-xx` runbook entry.

---
*Phase: 06-walking-skeleton-quick-evidence-gate*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: docs/WORKFLOWS.md
- FOUND: .pi/extensions/workflows/index.ts
- FOUND commit: 7b33ddf (Task 1)
- FOUND commit: 2d85def (Task 2)
