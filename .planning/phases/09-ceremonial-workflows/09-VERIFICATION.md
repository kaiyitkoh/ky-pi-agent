---
phase: 09-ceremonial-workflows
verified: 2026-10-13T00:00:00Z
status: human_needed
score: 9/11 requirements fully verified offline; 2 partial by design (FLOW-08, FLOW-09)
overrides_applied: 0
human_verification:
  - test: "RB-09-01 - one real feature end to end through /grill, /plan, /execute, /review on the work laptop"
    expected: "SPEC, PLAN, PROGRESS, REVIEW produced; feature shipped"
    why_human: "Needs live work laptop and credentials"
  - test: "RB-09-02 - real glab mr create --target-branch staging (confirm --description-file flag)"
    expected: "MR opened against staging, never main"
    why_human: "Needs work GitLab credentials"
  - test: "RB-09-03 - real pi-subagents spawn consuming a handoff packet; measure parent-token delta"
    expected: "Live delta negative"
    why_human: "pi-subagents has never spawned; offline delta is a chars/4 estimate"
---

# Phase 9: Ceremonial Workflows Verification Report

**Goal:** spec that cannot be written on unverified assumptions, plan with verification commands, execution pasting real output, review opening an MR to staging.
**Status:** human_needed (no gaps)

## Requirements coverage

All 11 IDs are declared in plan frontmatter (09-03..09-17) and present in REQUIREMENTS.md; none orphaned.
Plans 09-01 (WR-09) and 09-02 (FLOW-11) carry IDs outside the phase list (supporting work).

| ID | Status | Evidence |
|----|--------|----------|
| FLOW-02 | SATISFIED | grill/scorecard.ts, grill-scorecard.test.ts |
| FLOW-03 | SATISFIED | grill/spec-schema.ts gateRequirementsAuthorship, grill-evidence-gate.test.ts |
| FLOW-04 | SATISFIED | IF_THEN_PATTERN in spec-schema.ts, spec-error-behaviour.test.ts |
| FLOW-05 | SATISFIED | scope pin + scope-drift.test.ts (committed diff only) |
| FLOW-06 | SATISFIED | plan-ceremony/, plan-task-form.test.ts |
| FLOW-07 | SATISFIED | execute/ extension (real output bound to SHA) |
| FLOW-08 | PARTIAL (human) | review/mr.ts, MR_TARGET_BRANCH = "staging", stubbed glab only; RB-09-01/02 OUTSTANDING |
| FLOW-09 | PARTIAL (human) | handoff-packet.test.ts offline; RB-09-03 OUTSTANDING |
| FLOW-10 | SATISFIED | artifact-count.test.ts |
| QUAL-03 | SATISFIED | validateSpec branch (8) |
| QUAL-08 | SATISFIED | GATE_DEPTH_BY_WORKFLOW in quality/gates.ts, wired in execute and review |

## Spot-checks run by verifier
- `npx tsc --noEmit`: clean.
- vitest (artifact-count, scope-drift, review-render, spec-error-behaviour, plan-task-form, grill-evidence-gate): 71/71 pass.
- Full suite (earlier, not re-run): 2 quality-rules magic-number failures fixed in 2695014 by naming constants; targeted re-run 287/287.
- Debt markers: only TODO/FIXME token definitions in quality/rules.ts (rule data, not markers). No blockers.
- docs/RUNBOOK.md lines 1545-1596 contain RB-09-01..03 as OUTSTANDING with procedures.

## Gaps
None.

## Human verification required
RB-09-01, RB-09-02, RB-09-03 (see frontmatter).
