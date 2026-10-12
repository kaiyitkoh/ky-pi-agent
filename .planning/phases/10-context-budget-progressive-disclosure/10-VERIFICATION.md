---
phase: 10-context-budget-progressive-disclosure
verified: 2026-10-13T00:00:00Z
status: human_needed
score: 3/4 roadmap criteria verified (criterion 4 live-only, outstanding by design); 6/6 CTX IDs accounted for (4 complete, 2 partial)
overrides_applied: 0
human_verification:
  - test: "RB-10-01: run the pre-registered minimal-vs-full experiment on the work laptop and record the decision line"
    expected: "RB-10-01-RESULT.md contains DEGRADES, NO_DETECTABLE_EFFECT or INCONCLUSIVE with d and CI"
    why_human: "Needs live credentials; ROADMAP criterion 4 says 'Verified live on the work laptop'"
  - test: "RB-10-02: live DeepSeek cache hit on turn 2 and after a /plan toggle"
    expected: "turn-2 cacheRead ratio high; prefix re-prices once after /plan"
    why_human: "Live provider only"
  - test: "RB-10-03: measure per-turn cost of pi-subagents, pi-web-access, @narumitw/pi-lsp, pi-session-finder with /budget"
    expected: "Per-profile delta recorded per package"
    why_human: "Packages not installed on the dev machine"
---

# Phase 10: Context Budget & Progressive Disclosure Verification Report

**Phase Goal:** The harness stops being a tax on the model it exists to help, and the open question of whether context pollution degrades output quality gets a measured answer.
**Status:** human_needed (no gaps_found items). Initial verification.

## Roadmap criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Profiles set once at session_start via setActiveTools; context hook cannot strip tools | VERIFIED (reinterpreted R1/R2/R3) | `.pi/extensions/routing/index.ts:320,334` are the only profile-driven setActiveTools calls; `plan-mode/index.ts:253,257` is the documented user-command exception. `tool-profiles.test.ts`, `context-hook-tools.test.ts`, `context-hook-lint.test.ts` pass (re-run: 6 files, 41 tests green). |
| 2 | /budget floor measurably below ~1,850; per-extension cost recorded | VERIFIED with caveat (R4/R5) | `FLOOR_CEILINGS` recon 1820, review 1950, implement 2410, full 4300 enforced in `context-floor.test.ts`; attribution closure with 0-char residual. Per-extension table in `docs/EXTENSIONS.md` with a verdict per entry. |
| 3 | CI fails on AGENTS.md over budget; no volatile prompt content | VERIFIED | `tests/unit/agents-md-budget.test.ts` and `tests/integration/prompt-stability.test.ts` (with negative control) pass. |
| 4 | Live controlled experiment yields a recorded answer | NOT VERIFIABLE HERE (RB-10-01 OUTSTANDING) | Protocol pre-registered and harness proved offline; no live result exists. Runbook entries RB-10-01/02/03 present at `docs/RUNBOOK.md:1610-1667`. Honestly marked partial in REQUIREMENTS.md. |

## Criterion reinterpretations (docs/EXTENSIONS.md R1-R6)

- R1 (profiles only added to; narrowing before first request writes no removal): honest and test-proven by T1/T2 plus reopen/reload cases. Accepted.
- R2 (context hook can strip tools via system-shaped toolsRemoved, so enforce by lint instead of by Pi): honest. This is stronger than the original claim, and the lint proves it. Accepted.
- R3 (no deferred exposure or tool_search): a design choice with stated cost reasoning, with new-tool-paths test kept green. Accepted.
- R4 (baseline reinterpreted): partly generous. The default profile (implement, 2,344 tok) is NOT below 1,850; only recon (1,773) is. The doc discloses this plainly and measures against the true composed BEFORE of 4,179 (default 43.9% lower). Judged honest, but the literal roadmap wording is met for recon only. WARNING, not a blocker.
- R5 (four uninstalled packages not measured): honest, carried into RB-10-03, and CTX-06 is marked partial rather than complete.
- R6 (also bans mid-run section patches): strictly stronger. Accepted.

## Requirements coverage

| ID | Status | Evidence |
|----|--------|----------|
| CTX-01 | SATISFIED | tool-profiles.test.ts |
| CTX-02 | SATISFIED | context-hook-tools.test.ts, context-hook-lint.test.ts |
| CTX-03 | SATISFIED | agents-md-budget.test.ts |
| CTX-04 | SATISFIED (faux); live cache hit is RB-10-02 | prompt-stability.test.ts |
| CTX-05 | PARTIAL, RB-10-01 outstanding | offline harness only |
| CTX-06 | PARTIAL, RB-10-03 outstanding | local extensions closed, 4 packages unmeasured |

No orphaned IDs: REQUIREMENTS.md maps exactly CTX-01..06 to Phase 10.

## Anti-patterns and review

- No unreferenced TBD/FIXME/XXX debt markers in shipped extensions (matches are rule-definition strings in `quality/rules.ts`).
- Review: 19 fixed, WR-01 (triggerTurn turns not narrowed) skipped but documented in `docs/ROUTING.md` with a behaviour-pinning test. Accepted as documented residual.
- Quality-rules budget regression fixed in 6fc4f2c by a documented never-throws contract rather than a budget raise (orchestrator-reported; not re-run here).
- Floor numbers are Windows only (macOS unverified).

## Gaps Summary

No code gaps. The only unmet items are the three live runbook checks (RB-10-01..03), outstanding by design, which keep the phase at human_needed. Phase goal is achieved to the extent verifiable offline; the "measured answer" half of the goal needs RB-10-01.
