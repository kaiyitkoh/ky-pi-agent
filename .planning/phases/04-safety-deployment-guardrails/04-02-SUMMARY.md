---
phase: 04-safety-deployment-guardrails
plan: 02
subsystem: safety
tags: [jsonl, audit-log, globalThis, jiti, refactor, vitest]

# Dependency graph
requires:
  - phase: 02-diagnostics-instrumentation
    provides: the hardened append-only, rotating, path-confined JSONL writer (originally in .pi/extensions/diagnostics/jsonl.ts) and its proof suite (jsonl-rotation.test.ts, jsonl-concurrency.test.ts, jsonl-append-only.test.ts)
  - phase: 04-safety-deployment-guardrails
    provides: (04-01) unbash@4.0.10 pinned and the user-scope load mechanism, neither used directly by this plan but establishing the safety/ directory's install posture
provides:
  - ".pi/lib/jsonl.ts — the neutral, subsystem-agnostic append-only JSONL writer both diagnostics and safety bind to"
  - ".pi/extensions/safety/{schema,audit}.ts — the SAFE-14 audit row writer, recording both ALLOW and BLOCK verdicts"
  - "ownership-scoped pruneLogs (caller-supplied ownedBases, no shared hardcoded list) so no binding can delete another's logs"
  - "the append-only gate (jsonl-append-only.test.ts) now scans .pi/lib and .pi/extensions/safety alongside diagnostics"
affects: [04-03, 04-05, 04-06, 04-09, 04-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "shared writer at .pi/lib/, outside .pi/extensions/, so it is never auto-discovered as an extension and two independently-reviewable subsystems can bind to it without importing each other"
    - "globalThis-keyed module state (sizeCache, produced-paths set) to survive jiti's per-import-graph module duplication, applied to a second writer's state using the pattern diagnostics/index.ts's ROWS_WRITTEN_KEY already established"
    - "ownership-scoped retention: pruneLogs takes REQUIRED ownedBases from the caller with no default, proven by a paired negative in both directions"
    - "audit row built field-by-field from caller input, never spread, so extra caller-supplied keys (tool output, file contents) cannot reach the file even under a loose call-site type"

key-files:
  created:
    - .pi/lib/jsonl.ts
    - .pi/extensions/safety/schema.ts
    - .pi/extensions/safety/audit.ts
    - tests/unit/audit-jsonl.test.ts
  modified:
    - .pi/extensions/diagnostics/jsonl.ts
    - tests/unit/jsonl-append-only.test.ts
    - tests/unit/logs-gitignored.test.ts

key-decisions:
  - "safety/audit.ts does NOT import safeHandler from diagnostics/index.ts, even though providers/index.ts established that reuse as acceptable elsewhere — CONTEXT.md decision 7's 'source-reviewable in isolation' is the stricter reading and the one a security reviewer of the credential/exec path needs. A local equivalent, if needed, belongs to Plan 08's safety/index.ts."
  - "writeAuditRow never throws — it catches and returns undefined on failure, so an audit write failure cannot turn a BLOCK into an unhandled exception a caller might treat as an allow. Residual risk (a silently-unwritten log) is accepted and deferred to Plan 10's liveness proof and the SAFE-12 subagent test, which reads this log as its evidence."
  - "MAX_ROTATED_FILES/RETENTION_DAYS moved into .pi/lib/jsonl.ts as neutral internal defaults (DEFAULT_MAX_ROTATED_FILES=10, DEFAULT_RETENTION_DAYS=14) rather than staying imported from diagnostics/schema.ts, since the extracted writer cannot import from diagnostics/ without breaking the safety/ isolation the whole extraction exists to enable. Values match Phase 2's proven numbers; diagnostics/index.ts continues to pass its own schema.ts constants explicitly wherever it already did, so no observed behavior changed."

patterns-established:
  - "Pattern: when two independently-reviewable subsystems need the same hardened low-level machinery, extract it to .pi/lib/ (outside .pi/extensions/, never auto-discovered) rather than having one subsystem import the other's internals or duplicating the hardening."

requirements-completed: [SAFE-14]

# Metrics
duration: ~13min
completed: 2026-08-13
---

# Phase 4 Plan 2: JSONL Writer Extraction and Safety Audit Log Summary

**Moved the Phase 2 hardened JSONL writer to a neutral `.pi/lib/jsonl.ts` and built `safety/audit.ts` on top of it — an ALLOW-and-BLOCK audit row writer for SAFE-14 that imports nothing from `diagnostics/`, proven by TDD with an executed RED failure before the GREEN implementation.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-08-13T19:45Z (approx, from prior plan's completion)
- **Completed:** 2026-08-13T19:56Z
- **Tasks:** 2 completed (Task 2 ran as RED → GREEN, two commits)
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- Extracted every byte of the generic, hardened JSONL machinery (`logDir`, `logPath`, `rotate`, `appendJsonl`, `pruneLogs`, `producedPaths`, `resetProducedPaths`, and their internals) out of `.pi/extensions/diagnostics/jsonl.ts` into `.pi/lib/jsonl.ts`, MOVED rather than copied — confirmed by grep that `appendFileSync` and the stream-avoidance rule live in exactly one place now.
- Reduced `diagnostics/jsonl.ts` to a thin binding that re-exports every previously-exported name with an identical signature; `tests/unit/jsonl-rotation.test.ts` and `tests/integration/jsonl-concurrency.test.ts` needed zero edits and both pass unchanged.
- Made `pruneLogs`'s `ownedBases` a REQUIRED caller-supplied parameter with no shared hardcoded list, so neither binding can delete the other's logs — proven by a paired negative in both directions in the new test file.
- Closed the jiti duplicate-module-instance hazard for the writer's `sizeCache` and `produced` state by moving both to `globalThis`-keyed slots, following the pattern `diagnostics/index.ts:192-224` already established for its rows-written counter.
- Built `.pi/extensions/safety/{schema,audit}.ts`: `writeAuditRow` records an ALLOW or a BLOCK to `<cwd>/.pi/logs/audit-YYYY-MM-DD.jsonl` with exactly `{ts, event, tool, command, cwd, verdict, reason, pid}` and nothing else, imports nothing from `diagnostics/`, and never throws into its caller.
- Widened `tests/unit/jsonl-append-only.test.ts`'s scanned tree from `.pi/extensions/diagnostics` alone to `.pi/extensions/diagnostics`, `.pi/lib` and `.pi/extensions/safety` together, and repointed `WRITER_FILE` at the new location — the stream-avoidance gate now protects every path that can write a log.
- Extended `tests/unit/logs-gitignored.test.ts` to cover the audit stream's paths, both by literal table and by exercising `writeAuditRow` in the real-run check (which shares `producedPaths()` with the diagnostics binding via the same `globalThis` slot).
- Ran the RED phase for real: `tests/unit/audit-jsonl.test.ts` and the extended `logs-gitignored.test.ts` failed on `Cannot find module '.../safety/audit.ts'` before any implementation existed, then passed after it was written.

## Task Commits

1. **Task 1: Extract the generic JSONL writer to .pi/lib/jsonl.ts and reduce diagnostics/jsonl.ts to a thin binding** - `4da9f58` (refactor)
2. **Task 2 (RED): Add failing test for the safety audit writer** - `d9155a1` (test)
3. **Task 2 (GREEN): Implement the safety audit writer** - `27962ea` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/lib/jsonl.ts` (new) - the neutral, subsystem-agnostic append-only/rotating/path-confined JSONL writer; owns `LOG_DIR_SEGMENT`, `DEFAULT_MAX_ROTATED_FILES`, `DEFAULT_RETENTION_DAYS`, `DEFAULT_ROTATE_BYTES` as internal defaults; requires `ownedBases` from every `pruneLogs` caller
- `.pi/extensions/diagnostics/jsonl.ts` - reduced to a thin binding over `.pi/lib/jsonl.ts`, injecting `defaultRotateBytes(base)` and `OWNED_BASES: [WIRE_LOG_BASE, TURNS_LOG_BASE]`
- `.pi/extensions/safety/schema.ts` (new) - `AUDIT_LOG_BASE`, `AUDIT_ROTATE_BYTES`, the `AuditRow`/`AuditVerdict` types
- `.pi/extensions/safety/audit.ts` (new) - `writeAuditRow`, `pruneAuditLogs`, both thin bindings over `.pi/lib/jsonl.ts`, importing nothing from `diagnostics/`
- `tests/unit/audit-jsonl.test.ts` (new) - 8 tests: allow+block in one file, exact file path, exact eight-field row shape (with a poisoned-input case proving no extra fields reach the file), adversarial content cannot steer the write path, a forced write failure is swallowed not thrown, and ownership-scoped prune proven in both directions
- `tests/unit/jsonl-append-only.test.ts` - `SCANNED_DIRS` widened to `.pi/extensions/diagnostics`, `.pi/lib`, `.pi/extensions/safety`; `WRITER_FILE` repointed at `.pi/lib/jsonl.ts`
- `tests/unit/logs-gitignored.test.ts` - added audit-shaped paths to `MUST_BE_IGNORED`; the real-run check now also calls `writeAuditRow`

## Decisions Made

- `safety/audit.ts` does not reuse `diagnostics/index.ts`'s `safeHandler`, per the stricter reading of CONTEXT.md decision 7 (see key-decisions above).
- `writeAuditRow` swallows its own write failures — an explicit trade-off documented in the module docstring and pinned by a real-filesystem test that occupies the log directory's path with a plain file to force `mkdirSync` to fail, then asserts the call returns `undefined` without throwing.
- Rotation/retention defaults for the shared writer are neutral constants in `.pi/lib/jsonl.ts` rather than imported from `diagnostics/schema.ts`, since the extracted module cannot depend on `diagnostics/` without recreating the exact coupling the extraction removes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed the test's own field-list assertion during GREEN**
- **Found during:** Task 2, GREEN phase (first run of `audit-jsonl.test.ts` against the real implementation)
- **Issue:** The test asserting the audit row's exact key set (`["command", "cwd", "event", "pid", "reason", "ts", "verdict"]`) omitted `"tool"` — a bug in the test fixture written during RED, not in `writeAuditRow`, which correctly wrote all eight documented fields.
- **Fix:** Added `"tool"` to the expected key array.
- **Files modified:** `tests/unit/audit-jsonl.test.ts`
- **Verification:** The test passed immediately after the fix with no other change; re-ran the full suite (695/695) to confirm no other case relied on the wrong list.
- **Committed in:** `27962ea` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug, found and fixed within the GREEN phase before commit)
**Impact on plan:** Cosmetic — a test-authored fixture error caught by its own execution, exactly the kind of thing TDD's RED/GREEN discipline exists to surface immediately rather than let drift.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required. Everything in this plan runs offline against a real temporary filesystem (`withTempLogCwd`); no credentials or network access involved.

## Next Phase Readiness

- Plan 03 (`shell.ts`, the AST deny predicate) and the plans after it can call `writeAuditRow`/`pruneAuditLogs` directly from `.pi/extensions/safety/audit.ts` — the row shape, the never-throws contract, and the ownership-scoped retention are all in place.
- The shared writer at `.pi/lib/jsonl.ts` is now the one place any future third stream (should one be needed) would bind to, following the same thin-binding pattern.
- No blockers. `npx vitest run tests/unit tests/integration` is 695/695 green (up from the 685-test baseline recorded at the end of 04-01), `tsc --noEmit` is clean, and `jsonl-rotation.test.ts`/`jsonl-concurrency.test.ts` pass with zero edits, confirming diagnostics' behavior is unchanged by the extraction.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-13*

## Self-Check: PASSED

- FOUND: .pi/lib/jsonl.ts
- FOUND: .pi/extensions/safety/schema.ts
- FOUND: .pi/extensions/safety/audit.ts
- FOUND: tests/unit/audit-jsonl.test.ts
- FOUND: .planning/phases/04-safety-deployment-guardrails/04-02-SUMMARY.md
- FOUND: commit 4da9f58 (Task 1)
- FOUND: commit d9155a1 (Task 2 RED)
- FOUND: commit 27962ea (Task 2 GREEN)
