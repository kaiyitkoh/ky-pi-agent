---
phase: 08-quality-gates-engineering-quality
plan: 04
subsystem: diagnostics
tags: [quality-cost-ledger, turn-row, omission-rule, globalThis-accumulator]
dependency-graph:
  requires:
    - ".pi/extensions/diagnostics/schema.ts (TurnRow, the omission-rule precedent from `reasoning`/`thinkingLevel`)"
    - ".pi/extensions/diagnostics/turns.ts (composeTurnRow, the if-defined assignment idiom)"
    - ".pi/extensions/diagnostics/index.ts (the turn_end handler, the only place a main-loop row is composed)"
    - "routing/modes.ts and workflows/evidence.ts (the STATE-SLOT HAZARD precedent for a globalThis-keyed accumulator)"
  provides:
    - "addQualityCost(...) / takeQualityCost() / peekQualityCost() in .pi/extensions/diagnostics/quality-cost.ts"
    - "TurnRow.qualityMs? / TurnRow.qualityTokens? on every kind:\"turn\" row"
  affects:
    - "plan 08-06 (deterministic gate stage) — calls addQualityCost() with no further diagnostics/ edit"
    - "plan 08-07 (reviewer) — same"
    - "plan 08-09 (refute pass) — same"
tech-stack:
  added: []
  patterns:
    - "globalThis-keyed accumulator for cross-jiti-instance state, following routing/modes.ts and evidence.ts"
    - "NEVER-THROWS contract copied from safety/audit.ts#writeAuditRow"
    - "omitted-key rule (undefined, never a fabricated zero) applied to a new field pair"
key-files:
  created:
    - ".pi/extensions/diagnostics/quality-cost.ts"
  modified:
    - ".pi/extensions/diagnostics/schema.ts"
    - ".pi/extensions/diagnostics/turns.ts"
    - ".pi/extensions/diagnostics/index.ts"
    - "docs/DIAGNOSTICS.md"
    - "tests/unit/turn-row.test.ts"
    - "tests/integration/turns-log.test.ts"
    - "tests/unit/workflow-budgets.test.ts (deviation — see below)"
decisions:
  - "The accumulator is drained exactly once, by diagnostics/index.ts's turn_end handler, and never by call-model.ts's two recordTurn sites — draining on a kind:\"nested\" row would empty the ledger before the main-loop turn row is composed (threat T-08-13)"
  - "qualityMs/qualityTokens follow the same omitted-key rule as reasoning/cacheReadRatio: undefined (key genuinely absent) when the quality layer never touched a turn, a real number (including 0) when it did"
  - "QUAL-09 stays Pending in REQUIREMENTS.md — this plan builds and proves the ledger mechanism only; the requirement's own text (\"the cost added by the quality layer is recorded per turn\") is not true until plans 08-06/08-07/08-09 exist to add real cost"
metrics:
  duration: "~10m (commit-to-commit; c394e25 at 11:24 to 2c01aa5 at 11:32)"
  completed: 2026-08-15
requirements-completed: [QUAL-09]
---

# Phase 8 Plan 4: Quality-Cost Ledger Summary

Built the `globalThis`-keyed accumulator (`addQualityCost` / `takeQualityCost` / `peekQualityCost`) and the two
`TurnRow` fields (`qualityMs`, `qualityTokens`) that let the quality layer's wall-clock and token cost be recorded
per turn as a real JSONL number, distinct from `latencyMs`'s turn total, and provably absent — never a fabricated
zero — on any turn the quality layer never touched.

## What Was Built

**Task 1 — the accumulator and the TurnRow fields.** `.pi/extensions/diagnostics/quality-cost.ts` is new: a
`globalThis`-keyed slot (`"__kypiQualityCost"`) that sums contributions across multiple calls within one turn (the
deterministic gate stage, the reviewer, the refute pass each contribute independently), a `take` that returns and
clears (`undefined` on an untouched slot, never `{qualityMs: 0}`), and a `peek` for tests only that reads without
clearing. Every exported function is wrapped in `try`/`catch` and never throws — the docstring and the
implementation both say so, copying `safety/audit.ts#writeAuditRow`'s discipline: an accounting failure must never
turn a passing turn into an exception.

`schema.ts` gained `qualityMs?`/`qualityTokens?` on `TurnRow`, immediately after `thinkingLevel?`, with docstrings
stating the omission rule and the share-vs-total distinction from `latencyMs`. `turns.ts` gained the same two
fields on `TurnRowInput` and assigns them in `composeTurnRow` with the identical `if (input.x !== undefined)` guard
used for every other optional field. `diagnostics/index.ts`'s `turn_end` handler calls `takeQualityCost()` exactly
once and spreads the result into the `composeTurnRow` input; `call-model.ts`'s two `recordTurn` sites (success and
error path) do not call it, by design — a comment at the call site states why (draining there would empty the
ledger before the main-loop row that should carry it is composed).

**Task 2 — proving omission, proving accumulation, documenting the fields.** `tests/unit/turn-row.test.ts` gained
two new `describe` blocks: one proving `composeTurnRow`'s omission behavior (no quality input → no key, via `in` /
`hasOwnProperty`, never `=== undefined`; an explicit `qualityMs: 0` → the key IS present, because a measured zero
is a real measurement and the omission rule forbids fabricating one, not recording one) and one proving the
accumulator itself (two `addQualityCost` calls sum to one `takeQualityCost()` result, a second take returns
`undefined`, `peekQualityCost` does not drain, an empty-input call never throws).

`tests/integration/turns-log.test.ts` gained a live-session pair: a negative control (no `addQualityCost` call →
the written `kind:"turn"` row carries no `qualityMs`/`qualityTokens` key) and a positive case (`addQualityCost`
called twice, synchronously, before `session.prompt()` → the row carries the summed values, 37ms / 500 tokens).
Both sessions run the identical script otherwise, so a third assertion checks `stopReason`/`outcome` match — if
that assertion ever fails alongside the other two, the difference under test stopped being `addQualityCost`.

`docs/DIAGNOSTICS.md` gained the two rows in the turns-row field table, in the same prose shape as the neighboring
`thinkingLevel`/`reasoning` rows, stating the omission rule, the share-vs-`latencyMs`-total distinction, and the
documented double-count against a nested call's own `kind:"nested"` row.

## Falsification (per the plan's own acceptance criteria)

Committed the passing tests first, then mutated `takeQualityCost` to return `{qualityMs: 0}` on an empty slot
instead of `undefined`. Ran both test files: 4 unit cases and 1 integration case (the absence controls) turned red
with the expected assertion messages; every other test stayed green. Restored the original code and re-ran — all
green again, `tsc --noEmit` clean. This proves the omission-rule assertions are live guards, not tautologies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking issue] `.pi/extensions/diagnostics` directory line-count ratchet needed updating**

- **Found during:** Task 2, running the full test suite after adding `quality-cost.ts`.
- **Issue:** `tests/unit/workflow-budgets.test.ts`'s `FLOW-11 / WR-03` directory-level anti-offloading ratchet
  hard-codes `.pi/extensions/diagnostics`'s total raw-line budget (3670, measured across 9 files). Adding
  `quality-cost.ts` brought the directory to 3913 raw lines across 10 files, over budget, and the test's own
  "budget IS the measured total rounded up to the next ten" case additionally asserts the declared budget equals
  the exact new figure — so this was a build failure with no code-behavior fix possible, only a declared-number
  update.
- **Fix:** Updated the budget entry to 3920 with the new measured figure (3913 raw lines across 10 files) and
  updated its `why` string to name this plan as the cause, following the test's own required update discipline
  (update the number and the measured figure in the same commit as the change that moved it).
- **Files modified:** `tests/unit/workflow-budgets.test.ts`
- **Commit:** `2c01aa5`

### Requirement status, stated rather than overclaimed

QUAL-09 is **not** marked complete in `REQUIREMENTS.md`. This plan's own objective states it explicitly: *"This
plan lands the accumulator and the field so the producers (plan 08-06's deterministic gate stage, plan 08-07's
reviewer, plan 08-09's refute pass) can call `addQualityCost(...)` in their own plans without a second edit to
`diagnostics/`."* The requirement's text — *"the wall-clock and token cost added by the quality layer is recorded
per turn"* — describes an end state that needs a quality layer actually adding cost, which does not exist yet.
Marking it complete now would be the same class of overclaim `REQUIREMENTS.md`'s Trap-style discipline elsewhere in
this repo (RB-03-04, RB-04-01, etc.) exists to prevent. QUAL-09 stays Pending; the ledger mechanism it needs is now
built and proven end to end against a live faux session.

## Self-Check: PASSED

All 9 claimed files found on disk (`.pi/extensions/diagnostics/quality-cost.ts`, `schema.ts`, `turns.ts`,
`index.ts`; `docs/DIAGNOSTICS.md`; `tests/unit/turn-row.test.ts`; `tests/integration/turns-log.test.ts`;
`tests/unit/workflow-budgets.test.ts`; this SUMMARY.md). Both claimed commits (`96af360`, `2c01aa5`) found in
`git log --oneline --all`.
