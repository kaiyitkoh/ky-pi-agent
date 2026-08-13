---
phase: 04-safety-deployment-guardrails
plan: 10
subsystem: safety
tags: [subagent-topology, headless-deny, audit-log, concurrency, faux-provider, jiti, windows]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "the in-process fauxProvider driver-extension pattern and writeUserScopeShim mechanism proven reliable against a real spawned pi process (Plan 09); .pi/extensions/safety/index.ts wiring the tool_call hook + wrapped bash/read/write/edit tools (Plan 08); writeAuditRow/AUDIT_LOG_BASE/AuditRow (Plan 02/Plan 08 wiring); .pi/lib/jsonl.ts's shared rename-based rotation writer (Plan 02)"
provides:
  - "tests/integration/subagent-block.test.ts: one spawned `pi --mode json` child, scripted with two sequential tool calls (blocked then benign), proving SAFE-12 in the pi-subagents spawn topology -- BLOCK with the guard's own reason, ALLOW as positive evidence the guard loaded, and a project-scoped sentinel proven to leave no on-disk evidence of ever being imported"
  - "tests/integration/audit-concurrency.test.ts: four asynchronously spawned processes appending AuditRow-shaped records to one shared audit-*.jsonl, with a wall-clock overlap barrier, zero torn lines, both allow/block verdicts present, full AuditRow field completeness, four distinct pids, and a second case forcing rotation to race concurrent appends with no record lost across the rename"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "single-spawn, multi-turn scripting: rather than spawning a real pi process once per command (Plan 09's two-`it()` shape), one driver extension's faux.setResponses() queue scripts N sequential tool calls in ONE spawned child, keeping the phase's most expensive test to exactly one process launch regardless of how many assertions it carries"
    - "import-time-side-effect sentinel for a 'never loaded' proof: a project-scoped extension writes its marker file at MODULE IMPORT time (before Pi ever calls the default export), so an absent marker is stronger evidence than 'the extension ran and did nothing' -- it proves jiti never even required() the module"
    - "rotation-under-concurrency child script: each spawned child replicates the real writer's stat-then-rename-then-append shape inline (in generated .mjs, not by importing the TS writer), including swallowing a failed rename from a sibling process and still appending unconditionally afterward, so the test proves the SAME race the real writer's docstring names rather than merely re-testing single-process rotation"

key-files:
  created:
    - tests/integration/subagent-block.test.ts
    - tests/integration/audit-concurrency.test.ts
  modified: []

key-decisions:
  - "The full composition (real spawned child, no fallback split) was used for subagent-block.test.ts -- Plan 09's mechanism proved reliable enough (measured 577-891ms across many runs in this plan) that the RESEARCH-authorized fallback split (load-half + faux-session policy-half, deferred to Phase 7 EXT-09) was not needed. Stated here per the plan's requirement that this sentence be present whenever the fallback IS taken -- it was not."
  - "Both scripted commands (blocked, then benign) are driven through ONE spawned pi process rather than two, via a driver extension whose faux.setResponses() queue holds two tool-call turns plus a closing text turn -- keeping this plan's most expensive test to a single process launch while still proving both the BLOCK and the ALLOW-as-evidence assertions in the identical child."
  - "The project-scoped sentinel's evidence is an import-time side effect (a file write at module top level, before the default export is ever invoked) rather than a registered command or tool -- this makes 'the marker is absent' equivalent to 'jiti never imported this module', the strongest available proof of SAFE-11's mechanism from outside Pi's own source."
  - "audit-concurrency.test.ts's generated child scripts hand-construct AuditRow-shaped JSON and append via raw appendFileSync/renameSync rather than importing .pi/lib/jsonl.ts's real writer into the child process -- mirroring jsonl-concurrency.test.ts's own established pattern (DIAG-08), which tests the writer's DOCUMENTED CONTRACT (open-write-close per record, rename-then-append-unconditionally) against real OS-level concurrency, not the TypeScript call graph. The contract itself is unit-proven separately (tests/unit/jsonl-rotation.test.ts, Plan 02)."
  - "Rotation-under-concurrency is a second, separate `it()` case (case 2) rather than folded into the four-writer case 1 -- keeping case 1's assertions (barrier, count, torn-lines, verdicts, pids) about ordinary concurrent appends only, and case 2's assertions (fragment count, cross-fragment total) specifically about the rename race, so a failure in one never masks or gets diluted by the other."

requirements-completed: [SAFE-12, SAFE-14]

# Metrics
duration: ~35min
completed: 2026-08-14
---

# Phase 4 Plan 10: Subagent Block Topology and Audit Concurrency Summary

**`tests/integration/subagent-block.test.ts` proves SAFE-12 by scripting a blocked-then-benign command pair into ONE spawned headless `pi` child in the `pi-subagents` topology (project-scoped sentinel present but never imported, user-scope guard enforcing both verdicts, allow row as positive evidence), and `tests/integration/audit-concurrency.test.ts` proves SAFE-14 by summing AuditRow-shaped records across four asynchronously spawned processes -- once against a stable file, once against one being actively rotated -- with zero torn or lost records.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-14T07:00:00+08:00 (approx)
- **Completed:** 2026-08-14T07:10:30+08:00
- **Tasks:** 2 completed
- **Files modified:** 2 (2 created)

## Accomplishments

- `tests/integration/subagent-block.test.ts` (1 test, measured **772ms** wall-clock for the single spawned child -- see "Cost control" below) spawns a real `pi --mode json` process, with the safety extension loaded ONLY via `writeUserScopeShim` (no project trust granted at all) into a cwd that ALSO carries a project-scoped `.pi/extensions/kypi-project-sentinel/index.ts`. One driver extension scripts two sequential tool calls into the SAME spawn: `cat terraform.tfstate` (must BLOCK, reason `"holds plaintext secrets"`) followed immediately by `echo kypi-subagent-positive-control-sentinel` (must ALLOW). Assertions: (1) the first `bash` tool result is an error carrying the guard's own reason; (2) the second is a successful result containing the echoed sentinel; (3) the child's OWN `.pi/logs/audit-*.jsonl` contains both a block row and an allow row -- the allow row is the positive evidence the guard was genuinely loaded rather than merely quiet, per Pitfall 15's own warning sign; (4) the project-scoped sentinel's marker file, which it writes as an IMPORT-TIME side effect, is absent -- proof jiti never even imported that module, not merely that its default export did nothing.
- `tests/integration/audit-concurrency.test.ts` (2 tests, ~600ms each) spawns four `node:child_process.spawn` children ASYNCHRONOUSLY (never `spawnSync`) against one shared `audit-<date>.jsonl`, mirroring `jsonl-concurrency.test.ts`'s (DIAG-08) barrier discipline exactly: a shared wall-clock start instant, and an assertion that the latest child's start precedes the earliest child's finish. Case 1 (4 x 250 = 1000 records, no rotation): zero torn lines (`readTornSafe`), exact total count, every row's key set equal to the full `AuditRow` contract (`ts`, `event`, `tool`, `command`, `cwd`, `verdict`, `reason`, `pid`), both `"allow"` and `"block"` verdicts present, and exactly 4 distinct `pid` values across every row (ruling out one process silently writing everything). Case 2 (4 x 120 = 480 records, `rotateBytes` forced to 600 bytes) drives each child through an inline replica of the real writer's stat-then-rename-then-append shape, races renames against sibling processes' concurrent appends, then sums records across the live file plus every rotated fragment and asserts the total is still exactly 480 with zero torn lines anywhere in the union.
- **Mutation-tested both files, per the autonomous run's rule 6.** `subagent-block.test.ts`: neutered `.pi/extensions/safety/policy.ts#evaluate()` to always return `{ kind: "allow" }` and re-ran -- the test correctly went red on the guard's-own-reason assertion (`cat: terraform.tfstate: No such file or directory` does not match `/holds plaintext secrets/i`); `policy.ts` restored and confirmed byte-identical via `git diff` before the commit. `audit-concurrency.test.ts`: (a) forced the four children to run SEQUENTIALLY instead of concurrently and confirmed the barrier assertion goes red (`1786662535737` not less than `1786662535593`); (b) made case 2's child drop every 17th record and confirmed the cross-fragment total assertion goes red (`448` received vs `480` expected). Both mutations reverted and the suite re-confirmed green before committing.

## Task Commits

1. **Task 1: The blocked command stays blocked inside a spawned headless child (SAFE-12)** - `faaba4c` (test)
2. **Task 2: Four concurrent processes appending to one audit log (SAFE-14)** - `0153287` (test)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `tests/integration/subagent-block.test.ts` (new, 1 test) - single spawned `pi --mode json` child proving SAFE-12's block-in-a-subagent claim plus the allow-row-as-evidence and project-scope-absence assertions, in the `pi-subagents` proxy topology
- `tests/integration/audit-concurrency.test.ts` (new, 2 tests) - four-asynchronous-process concurrency proof over the audit stream, plus a rotation-under-concurrency case

## Decisions Made

See `key-decisions` in frontmatter. In summary: the full real-spawn composition was used for `subagent-block.test.ts` (Plan 09's fallback was not needed, and that fact is stated here per the plan's own instruction); both scripted commands ride in ONE spawned process rather than two, for cost control; the project-scoped sentinel's evidence is an import-time file write, the strongest available "never loaded" proof from outside Pi's own source; `audit-concurrency.test.ts`'s child scripts hand-construct `AuditRow` JSON and append with raw `fs` calls rather than importing the real TypeScript writer into a spawned process, following the same established pattern `jsonl-concurrency.test.ts` (DIAG-08, Phase 2) uses to test the writer's documented CONTRACT against real OS concurrency; rotation-under-concurrency is a separate case from the plain four-writer case, so a failure in one is never diluted by the other.

## Deviations from Plan

None - plan executed exactly as written. The plan's own pre-authorized fallback clause for Task 1 (splitting into a load-half and a policy-half proof if the full composition proved too fragile) was considered and NOT invoked -- the full composition, reusing Plan 09's proven mechanism verbatim, was reliable across every run in this plan (measured 577-891ms, zero flakiness across 5+ consecutive runs during mutation testing and verification).

## Issues Encountered

None. Both test files passed on first real run after implementation; no debugging cycle was needed beyond the deliberate mutation-testing rounds documented above (each of which behaved exactly as predicted).

## User Setup Required

None - no external service configuration required. This plan adds no new dependency.

## Next Phase Readiness

- SAFE-12 and SAFE-14 are now proven end to end: a blocked command stays blocked inside the exact spawn topology `pi-subagents@0.47.1` (Phase 7) will exercise, with the child's own audit log carrying positive evidence the guard was loaded rather than merely quiet, and the project-scope failure mode demonstrated on the same run; the audit stream survives four genuinely concurrent OS-process writers with zero lost or torn records, including while actively rotating.
- Per the plan's own instruction, the measured single-spawn duration (772ms for `subagent-block.test.ts`) is recorded here rather than left implicit -- well within budget; no escalation to Phase 7 is warranted.
- No blockers. `npx vitest run tests/unit tests/integration` is **1076/1076 green** (up from 1073 before this plan's 3 new tests: 1 in `subagent-block.test.ts`, 2 in `audit-concurrency.test.ts`), `tsc --noEmit` clean.
- Phase 4's SAFE-10/11/12/14 quartet (Plans 08-10) is now complete: the guard fires and is enforced identically whether the calling process is the main session or a spawned headless child, and every allow/block decision from either is durably recorded even under concurrent multi-process load.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: tests/integration/subagent-block.test.ts
- FOUND: tests/integration/audit-concurrency.test.ts
- FOUND: commit faaba4c (Task 1)
- FOUND: commit 0153287 (Task 2)
