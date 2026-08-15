---
phase: 09-ceremonial-workflows
plan: 11
subsystem: workflows
tags: [pi-subagents, handoff-packet, evidence-gating, offline-measurement, execute-workflow]

requires:
  - phase: 09-ceremonial-workflows (plan 09-09/09-10)
    provides: plan-schema.ts's ParsedTask/PlanArtifact and validatePlan, consumed here as buildHandoffPacket's task input
  - phase: 09-ceremonial-workflows (plan 09-05/09-06/09-07)
    provides: grill/spec-schema.ts's SpecArtifact/VerifiedFact, consumed here as buildHandoffPacket's spec input
  - phase: 02-diagnostics
    provides: diagnostics/budget.ts#estimateTokensFromChars, the only token-cost arithmetic this codebase has
provides:
  - ".pi/extensions/execute/handoff.ts -- probeSubagentAvailability, buildHandoffPacket, renderHandoffPacket, measurePacketDelta, SUBAGENT_TOOL_NAMES"
  - ".pi/agents/executor-handoff.md -- the eventual real-subagent path's agent file"
  - "tests/unit/handoff-packet.test.ts -- the FLOW-09 offline proof suite"
affects: [09-13 (a future /execute plan wiring a real dispatch), 09-17 (RB-09-03 runbook entry)]

tech-stack:
  added: []
  patterns:
    - "Three-arm LegStatus (imported, never redeclared) for an honest-degradation probe over a live registered-tool-name list, never .pi/settings.json"
    - "A packet builder proved self-contained by BOTH presence and absence assertions, never presence alone"
    - "A token-delta measurement whose arithmetic is asserted and whose sign is never asserted"

key-files:
  created:
    - .pi/extensions/execute/handoff.ts
    - .pi/agents/executor-handoff.md
    - tests/unit/handoff-packet.test.ts
  modified:
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "Probe only subagent + subagent_wait (the minimum genuinely needed for spawn-and-wait), not all four parent-session tool names pi-subagents registers -- subagent_supervisor/intercom exist only for mid-run steering, which /execute's one-subagent-per-task shape does not need"
  - "Verified-fact selection for a packet is a declared, checkable rule: a fact travels with the packet iff its claim text appears, case-insensitively, as a substring of the concatenated requirement excerpts -- not 'all of them'"
  - "buildHandoffPacket throws on a requirement id with no matching '\"R<id>:\"' §3 entry, and on a missing path/verificationCommand -- both should already be impossible once validatePlan has run, so reaching either throw means an invariant broke"
  - "The .pi/extensions/execute DIRECTORY_BUDGETS row and the executor-handoff.md RESOURCE_EDGES row are both declared ahead of the command file that will eventually make them reachable by discovery, per the grill/plan-ceremony precedent from plans 09-05 and 09-09"

requirements-completed: []

duration: ~20min
completed: 2026-08-16
---

# Phase 9 Plan 11: FLOW-09 Handoff Packet (Offline) Summary

**Pure `/execute` handoff-packet builder plus an honest subagent-availability probe, built and measured entirely offline against no installed `pi-subagents`, with a real measured token delta of -447 (packet smaller than the parent context it replaces).**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `probeSubagentAvailability` reports a distinct `unavailable` (never a silent `pass`) whenever `subagent`/`subagent_wait` are missing from the live registered-tool-name list, and never reads the settings file — proved with a positive control, an empty-list case and a partial-install case, each asserting on the reason text.
- `buildHandoffPacket` assembles the exact four-field contract `FEATURES.md` Part 2 line 202 states (requirement excerpts, referenced verified facts, file paths, verification command) and is proved self-contained by asserting BOTH presence of the cited requirements and absence of the uncited ones.
- `measurePacketDelta` took a real measurement against a realistic SPEC.md + PLAN.md fixture: **packetTokens=134, parentTokens=581, deltaTokens=-447** (packet 534 chars / parent 2322 chars). The delta came out negative — the packet genuinely is smaller than the context it replaces, for this fixture — and the test file asserts the arithmetic only, never the sign.
- Three falsifications recorded verbatim (below), each turning a targeted, named set of assertions RED and none other.

## Task Commits

Each task was committed atomically:

1. **Task 1: handoff.ts — the honest-degradation probe and the pure packet builder** - `38266a2` (feat)
2. **Task 2: the agent file, its RESOURCE_EDGES declaration, and the falsified unit test** - `5a5db3a` (test)

## Files Created/Modified

- `.pi/extensions/execute/handoff.ts` — `SUBAGENT_TOOL_NAMES`, `probeSubagentAvailability`, `HandoffPacket`, `buildHandoffPacket`, `renderHandoffPacket`, `PacketDeltaMeasurement`, `measurePacketDelta`. Pure module, no I/O, no model call, registers nothing.
- `.pi/agents/executor-handoff.md` — the agent file for the eventual real-subagent path. No `model:`/`fallbackModels:` key. Honest-status comment naming `RB-07-02` and `RB-09-03`.
- `tests/unit/handoff-packet.test.ts` — the FLOW-09 offline proof suite (probe three-state table, packet presence/absence, throw case, delta arithmetic, the recorded realistic-fixture measurement).
- `tests/unit/workflow-budgets.test.ts` — new `.pi/extensions/execute` `DIRECTORY_BUDGETS` row (332 raw lines, budget 340) and new `.pi/agents/executor-handoff.md` `RESOURCE_EDGES` row (33 raw lines, budget 40).

## The Recorded Measurement

Command run (from `tests/unit/handoff-packet.test.ts`'s own "recorded realistic-fixture measurement" test, `--reporter=verbose`):

```
npx vitest run tests/unit/handoff-packet.test.ts --reporter=verbose
```

Raw output line:

```
stdout | tests/unit/handoff-packet.test.ts > FLOW-09 -- the recorded realistic-fixture measurement > measures a real packet against a real SPEC.md + PLAN.md parent-context string, and the arithmetic holds
[FLOW-09 recorded measurement] packetTokens=134 parentTokens=581 deltaTokens=-447 packetChars=534 parentChars=2322 method=estimateTokensFromChars (Math.ceil of chars divided by four), diagnostics/budget.ts -- NOT a tokenizer
```

The fixture: a five-requirement `SpecArtifact` rendered through `renderSpecMarkdown` (full `SPEC.md` text) concatenated with a four-task `PLAN.md` rendered through `renderPlanMarkdown`, as the parent-context string a real `/execute` session would otherwise carry into every subagent's context. The packet: `buildHandoffPacket` for the one task citing `[R2,R4]`, rendered through `renderHandoffPacket`. Both figures are `Math.ceil(chars/4)` estimates via Phase 2's `estimateTokensFromChars` — labelled, not a tokenizer — printed beside the raw char counts so the estimate is never mistaken for a measurement of a different kind. The sign came out negative for this fixture; that is reported as a real result, not asserted as a target.

## Decisions Made

- Probed only `subagent`/`subagent_wait` (spawn-and-wait), not all four parent-session tool names `pi-subagents@0.49.0` registers — `subagent_supervisor`/`intercom` exist only for mid-run steering of an already-spawned child, which `/execute`'s one-subagent-per-task shape does not need to report available.
- Verified-fact selection uses a declared substring rule (a fact's `claim` text found, case-insensitively, inside the task's concatenated requirement excerpts) rather than "all of them" — real, checkable, and asserted in the test file with both a presence and an absence case.
- `buildHandoffPacket` throws (never silently degrades) on a requirement id with no matching §3 entry, and on a task missing its path or verification command — both are invariants `validatePlan` should already guarantee, so a throw here signals a broken invariant, not ordinary input.
- The `DIRECTORY_BUDGETS`/`RESOURCE_EDGES` rows for this plan's two new files were declared ahead of the command file that will eventually make them reachable by automatic discovery, following the identical precedent plans 09-05 (`grill/`) and 09-09 (`plan-ceremony/`) already set.

## Falsifications (recorded verbatim, all reverted)

**(a) Probe short-circuited to `pass` on a miss.** Mutated `probeSubagentAvailability` to gate its `unavailable` branch behind `if (false && missing.length > 0)`. Ran `npx vitest run tests/unit/handoff-packet.test.ts -t "probeSubagentAvailability"`. RED, 3 of 5 cases in that describe block:

```
AssertionError: expected 'pass' to be 'unavailable' // Object.is equality
Expected: "unavailable"
Received: "pass"
 ❯ tests/unit/handoff-packet.test.ts:37:25   (empty list case)
 ❯ tests/unit/handoff-packet.test.ts:48:25   (partial case)
 ❯ tests/unit/handoff-packet.test.ts:78:25   (settings-ignored case)
```

Reverted; suite green again (verified by re-diffing `handoff.ts` against the prior commit — empty diff).

**(b) `buildHandoffPacket` made to include every §3 entry.** Replaced the per-citation loop with `[...entriesById.values()].map((e) => e.text)`, ignoring `task.requirementIds` entirely (this also removed the throw branch as a side effect). Ran `npx vitest run tests/unit/handoff-packet.test.ts -t "buildHandoffPacket"`. RED, 3 of 6 cases:

```
FAIL > packet does NOT contain the R1, R3 or R5 excerpts -- presence alone would pass on a builder that includes everything
AssertionError: expected true to be false

FAIL > the rendered packet text carries no §3 entry for an unreferenced requirement, and no conversation marker
AssertionError: expected '# Handoff Packet: T001\n\n## Requirem…' not to contain 'R1:'
(rendered text shown containing all five R1..R5 entries)

FAIL > throws when the task cites a requirement id the SPEC declares nowhere in §3
AssertionError: expected [Function] to throw an error
- Expected: null
+ Received: undefined
```

Reverted; suite green again (empty diff against the prior commit).

**(c) The `.pi/agents/executor-handoff.md` row deleted from `RESOURCE_EDGES`.** Ran `npx vitest run tests/unit/workflow-budgets.test.ts -t "RESOURCE_EDGES"`. RED, the completeness scan:

```
FAIL > Item 1 (D-12) -- RESOURCE_EDGES: the non-import resource-edge closure > present-but-undeclared: every resource-edge candidate is named in some RESOURCE_EDGES row
AssertionError: ... expected [ '.pi/agents/executor-handoff.md' ] to deeply equal []
```

Restored; full `workflow-budgets.test.ts` suite green again.

## Deviations from Plan

None — plan executed exactly as written. `parseRequirementEntries`'s `"R<id>: text"` convention and `selectReferencedFacts`'s substring rule are both new, small, self-contained inventions the plan explicitly asked for ("a declared, documented selection rule, not 'all of them'") rather than deviations from it.

## Issues Encountered

None. `npx vitest run` (2201 tests / 116 files) and `npx tsc --noEmit` were both run clean at the end of the plan, after all three falsifications had been reverted and diffed empty against their respective commits.

## Constraint Compliance

- No provider inference request was issued.
- No real subagent was spawned — `pi-subagents@0.49.0` remains pinned in `.pi/settings.json` and NOT installed; `npx vitest run tests/unit/pinning.test.ts` stayed green (exactly six audited `devDependencies`) throughout.
- No `glab` command was run.
- No package was installed.
- `.pi/settings.json` is unchanged (verified: not in `git status --short` output at any point in this plan).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- FLOW-09 advances to the limit of what a machine without `pi-subagents` installed can do: the packet builder, its measurement and the availability probe are all built and unit-verified offline. FLOW-09 stays partial — the live spawn-and-wait check is `RB-09-03`, to be appended OUTSTANDING by plan 09-17 alongside the existing `RB-01..RB-08` entries (not renumbered).
- `.pi/extensions/execute/handoff.ts` and `.pi/agents/executor-handoff.md` are ready for a future `/execute` plan to wire a real dispatch against, once `pi-subagents` is installed under `RB-07-02`.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-16*

## Self-Check: PASSED

All created files verified present on disk. Both task commit hashes (`38266a2`, `5a5db3a`) verified present in `git log`.
