---
phase: 06-walking-skeleton-quick-evidence-gate
plan: 01
subsystem: testing
tags: [git, spawnSync, jsonl, evidence-gate, gate-07, vitest]

requires:
  - phase: 04-safety
    provides: "safety/git.ts's spawnSync(shell:false) HEAD-oracle pattern (currentBranch), safety/audit.ts's never-throw JSONL binding shape, .pi/lib/jsonl.ts's appendJsonl/pruneLogs"
  - phase: 05-routing
    provides: "routing/guard.ts's {ok:true}|{ok:false,reason} GuardVerdict shape, routing/modes.ts's globalThis-keyed STATE-SLOT pattern"
provides:
  - "currentSha(cwd) -- the HEAD SHA oracle, sibling to currentBranch in safety/git.ts, throws rather than returning a sentinel"
  - "tests/helpers/git.ts: makeTempRepo/commitFile/headSha -- real temp-repo scaffolding producing two genuinely different real SHAs"
  - "workflows/evidence.ts: EvidenceRecord, gateCompletion() pure 4-branch predicate, startRun/recordToolResult/isRunArmed/endRun run state, writeEvidenceRow/pruneEvidenceLogs JSONL binding"
  - "tests/unit/evidence-gate.test.ts: 3 rejections + 1 acceptance + no-borrowing case, all keyed on real repository SHAs, all 5 falsification mutations executed and observed red"
affects: [06-02-quick-command, 06-03, 06-04]

tech-stack:
  added: []
  patterns:
    - "GATE-07 evidence gate: a completion claim is rejected unless a structured Pi tool_result (isError:false) exists at the SHA that is currently HEAD"
    - "globalThis-keyed run-state slot (__kypiQuickRun), matching routing/modes.ts's STATE-SLOT HAZARD reasoning for jiti dual-module-instance safety"

key-files:
  created:
    - .pi/extensions/workflows/evidence.ts
    - tests/unit/evidence-gate.test.ts
  modified:
    - .pi/extensions/safety/git.ts
    - tests/helpers/git.ts

key-decisions:
  - "currentSha(cwd) lands in safety/git.ts (production), not a test helper -- GATE-07's production capture path needs a runtime SHA reader (decision D-A)"
  - "currentSha throws on non-zero exit, unlike currentBranch's DETACHED_HEAD sentinel -- no safe default exists for an unknown SHA (decision D-B)"
  - "EvidenceVerdict is {ok:true,sha}|{ok:false,reason}, matching GuardVerdict/PlanResult rather than safety's {kind:allow|block} -- GATE-07 renders a verdict about a claim, routing's semantics (decision D-C)"
  - "endRun() never throws and writes exactly one row, copying safety/audit.ts's never-throw contract (decision D-D)"

patterns-established:
  - "Evidence records are built field-by-field, never spread, so tool output/file contents can never reach .pi/logs/evidence-*.jsonl"

requirements-completed: [GATE-07]

duration: 45min
completed: 2026-08-14
---

# Phase 6 Plan 1: currentSha() and the GATE-07 Evidence Gate Summary

**A four-branch pure predicate (`gateCompletion`) that rejects a completion claim unless a Pi-computed `isError:false` tool result exists at the exact commit `git rev-parse HEAD` reports right now — proven against a real temp repository, not fixture SHAs, and proven by executing (not merely asserting) five separate mutations.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-08-14T13:46:00Z (approx, first Read call)
- **Completed:** 2026-08-14T14:31:42Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `currentSha(cwd)` added to `.pi/extensions/safety/git.ts`, mirroring `currentBranch`'s exact `spawnSync(shell:false)` discipline, but throwing (no sentinel) on any non-zero exit per decision D-B
- `tests/helpers/git.ts` gained `makeTempRepo`/`commitFile`/`headSha`, producing two genuinely different real commit SHAs from a real disposable git repository
- `.pi/extensions/workflows/evidence.ts` created: `EvidenceRecord`, `gateCompletion()` (the pure GATE-07 predicate), run-state (`startRun`/`recordToolResult`/`isRunArmed`/`endRun`), and a never-throwing JSONL binding (`writeEvidenceRow`/`pruneEvidenceLogs`) that owns the `"evidence"` log base name
- `tests/unit/evidence-gate.test.ts`: 10 tests (3 rejections + 1 acceptance + 1 no-borrowing case + 2 SHA-format/currentSha cases + 2 vacuous-pass/fixture-integrity guards), zero hardcoded 40-char hex literals
- All five falsification mutations (four on `gateCompletion`, one on `currentSha`) were actually executed against the real file, run through `npx vitest run`, observed RED, and reverted — full transcripts below

## Task Commits

Each task was committed atomically:

1. **Task 1: currentSha() and real-SHA test scaffolding** - `17a0a2e` (feat)
2. **Task 2: workflows/evidence.ts — record, run state, gate predicate, JSONL row** - `7bd8c49` (feat)
3. **Task 3: tests/unit/evidence-gate.test.ts — three rejections, one acceptance, real SHAs** - `50552fb` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/safety/git.ts` - added `currentSha(cwd)` beneath `currentBranch`, same spawn options object, throws on non-zero exit (no sentinel)
- `tests/helpers/git.ts` - added `makeTempRepo(prefix)`, `commitFile(repo,name,body,message)`, `headSha(repo)`, all throwing on the failing argv rather than returning silently
- `.pi/extensions/workflows/evidence.ts` - new file: `EvidenceRecord`, `EvidenceVerdict`, `recordFromToolResult`, `gateCompletion`, `startRun`/`recordToolResult`/`isRunArmed`/`endRun`, `writeEvidenceRow`/`pruneEvidenceLogs`. 278 lines (≥90 min_lines satisfied)
- `tests/unit/evidence-gate.test.ts` - new file: table-driven GATE-07 test (R1/R2/R3/A1/M1) plus `currentSha` cases, all SHAs sourced from a real temp repo

## Decisions Made

- D-A/D-B/D-C/D-D from the plan's `<decisions>` block were followed as written (see frontmatter `key-decisions`); no new architectural decisions were required for this plan.
- `gateCompletion`'s branch (2) "stale" rejection lists every distinct recorded SHA (`Array.from(new Set(...))`), not just the first, so the reason string is honest when evidence spans multiple stale commits.
- Avoided all `...` (spread) syntax in `evidence.ts` per the plan's own acceptance grep (`grep -c '\.\.\.' evidence.ts` must be 0) — `pruneEvidenceLogs` builds its options object field-by-field instead of spreading `opts`, and `Array.from(new Set(...))` replaces `[...new Set(...)]` for de-duplicating tool names/SHAs.

## Deviations from Plan

None - plan executed exactly as written.

## Mutation Falsification Log (executed, observed, reverted)

Every mutation below was applied with the Edit tool to the real committed file, run through `npx vitest run tests/unit/evidence-gate.test.ts`, its real output captured, then reverted with the Edit tool. `git diff` was confirmed empty against the prior commit after every revert (see verification block after MUTATION 5).

### MUTATION 1 — delete branch (1) of `gateCompletion` (the empty-records check)

**Change:** removed the `if (records.length === 0) { return {ok:false, reason:"no structured tool result..."} }` block entirely.

**Observed (RED):**
```
❯ tests/unit/evidence-gate.test.ts (10 tests | 1 failed) 244ms
   × R1 -- fabricated prose, no structured tool result at all 24ms

FAIL  tests/unit/evidence-gate.test.ts > GATE-07 -- gateCompletion > R1 -- fabricated prose, no structured tool result at all
AssertionError: reason must name "structured": "recorded evidence is stale: recorded at , but HEAD is now cf156dc9cc4d4e2a4d8cb73dbcb7e7666f21b85b -- this completion claim's evidence does not match the current commit": expected 'recorded evidence is stale: recorded …' to contain 'structured'

 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
```
With branch (1) removed, an empty `records` array falls through to branch (2), which reports "stale" with an empty recorded-SHA list instead of "no structured tool result" — R1's `reasonMustContain: ["structured", "tool result"]` assertion goes red. Reverted; `git diff` empty.

### MUTATION 2 — change branch (2) to `record.sha.length === headSha.length` instead of equality

**Observed (RED):**
```
❯ tests/unit/evidence-gate.test.ts (10 tests | 2 failed) 227ms
   × R2 -- stale SHA: evidence recorded at A, claim made at head (B) 23ms
   × M1 -- no borrowing: stale-but-passing plus fresh-but-failing 20ms

FAIL  ... > R2 -- stale SHA: evidence recorded at A, claim made at head (B)
AssertionError: evidence captured at an older commit than HEAD must not satisfy a claim made now -- got {"ok":true,"sha":"21ede114f1eb42ee8e30ebabb19b005d7b5cccd6"}: expected true to be false

FAIL  ... > M1 -- no borrowing: stale-but-passing plus fresh-but-failing
AssertionError: a passing record from a DIFFERENT sha may not be borrowed to rescue a claim at HEAD -- only records already at headSha are considered for the isError check -- got {"ok":true,"sha":"21ede114f1eb42ee8e30ebabb19b005d7b5cccd6"}: expected true to be false

 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```
Since every real SHA in the test is 40 hex characters, a length-only comparison treats every stale record as if it were at HEAD — both R2 and M1 flip from reject to accept. Reverted; `git diff` empty.

### MUTATION 3 — delete branch (3) (the `isError` check)

**Change:** removed the `passingAtHead`/failing-tool rejection block, leaving `return {ok:true, sha:headSha}` immediately after computing `atHead`.

**Observed (RED):**
```
❯ tests/unit/evidence-gate.test.ts (10 tests | 2 failed) 241ms
   × R3 -- failed command at the current SHA 22ms
   × M1 -- no borrowing: stale-but-passing plus fresh-but-failing 21ms

FAIL  ... > R3 -- failed command at the current SHA
AssertionError: a record with isError:true at HEAD, with no passing record, must reject naming the failing tool -- got {"ok":true,"sha":"87ffa58e1c77967a6d63d27eaba3705f00781cbf"}: expected true to be false

FAIL  ... > M1 -- no borrowing: stale-but-passing plus fresh-but-failing
AssertionError: a passing record from a DIFFERENT sha may not be borrowed to rescue a claim at HEAD -- only records already at headSha are considered for the isError check -- got {"ok":true,"sha":"87ffa58e1c77967a6d63d27eaba3705f00781cbf"}: expected true to be false

 Test Files  1 failed (1)
      Tests  2 failed | 8 passed (10)
```
R3 (a failing tool result at HEAD) now accepts. Reverted; `git diff` empty.

### MUTATION 4 — make `gateCompletion` always return `{ok:false, reason:"no"}`

**Change:** inserted `return {ok:false, reason:"no"};` as the first statement (existing code left unreachable but compiling).

**Observed (RED):**
```
❯ tests/unit/evidence-gate.test.ts (10 tests | 5 failed) 287ms
   × R1 -- fabricated prose, no structured tool result at all 23ms
   × R2 -- stale SHA: evidence recorded at A, claim made at head (B) 21ms
   × R3 -- failed command at the current SHA 21ms
   × A1 -- structured, non-error, at HEAD 21ms
   × M1 -- no borrowing: stale-but-passing plus fresh-but-failing 21ms

FAIL ... > R1: AssertionError: reason must name "structured": "no": expected 'no' to contain 'structured'
FAIL ... > R2: AssertionError: reason must name "b5f0a9e5903e593eab1b0fa4fb754e412c884dc0": "no": expected 'no' to contain '...'
FAIL ... > R3: (reason mismatch, same shape)
FAIL ... > A1: AssertionError: the one accepted shape: a non-error tool result captured at the SHA that is still HEAD -- got {"ok":false,"reason":"no"}: expected false to be true
FAIL ... > M1: AssertionError: reason must name "bash": "no": expected 'no' to contain 'bash'

 Test Files  1 failed (1)
      Tests  5 failed | 5 passed (10)
```
All three reject-reason assertions fail because the hardcoded reason `"no"` doesn't contain the expected substrings, AND — the point of this mutation — the acceptance case A1 also fails, proving the three negative cases alone cannot distinguish a working gate from a gate that always refuses. Reverted; `git diff` empty.

### MUTATION 5 — `currentSha`'s body replaced with `return "0".repeat(40)` (Task 1's own mutation argument, exercised here)

**Change:** `.pi/extensions/safety/git.ts`'s `currentSha` body replaced with the single line `return "0".repeat(40);`.

**Observed (RED):**
```
Test Files  1 failed (1)
     Tests  6 failed | 4 passed (10)

FAIL ... > A1 -- structured, non-error, at HEAD
AssertionError: ... got {"ok":false,"reason":"recorded evidence is stale: recorded at 9609c4c78d7086d666fd6d522b72f15f7d579d2a, but HEAD is now 0000000000000000000000000000000000000000 -- this completion claim's evidence does not match the current commit"}: expected false to be true

FAIL ... > M1 -- no borrowing: stale-but-passing plus fresh-but-failing
AssertionError: reason must name "bash": "recorded evidence is stale: recorded at 8fe4c539f4949e824e2638970da4cf15d439b97b, 9609c4c78d7086d666fd6d522b72f15f7d579d2a, but HEAD is now 0000000000000000000000000000000000000000 -- ...": expected '...' to contain 'bash'

FAIL ... > currentSha > returns the same 40-char lowercase hex string git rev-parse HEAD prints, and matches headSha()
AssertionError: expected '0000000000000000000000000000000000000…' to be '9609c4c78d7086d666fd6d522b72f15f7d579…'

FAIL ... > currentSha > throws on a directory that is not a git repository
AssertionError: expected [Function] to throw an error
```
Every case whose claim SHA is read via `currentSha(repo)` now compares against the all-zero literal instead of the repo's real HEAD, so R2/A1/M1 (whose acceptance/no-borrow logic depends on `currentSha(repo) === shaB`) all flip, and both dedicated `currentSha` cases fail directly (wrong value, and no-throw on a non-repository directory since the stub never calls `spawnSync` at all). 6 of 10 tests failed. Reverted; `git diff` empty.

**Post-revert verification:** `git diff --stat` showed only `.planning/STATE.md` (untouched by this plan, orchestrator-owned) — both `.pi/extensions/safety/git.ts` and `.pi/extensions/workflows/evidence.ts` matched their committed content exactly. Re-ran `npx vitest run tests/unit/evidence-gate.test.ts`: **10 passed (10)**. Re-ran `npx tsc --noEmit`: clean, no output.

## Full Verification

```
$ npx tsc --noEmit
(no output -- exit 0)

$ npx vitest run tests/unit/evidence-gate.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ npx vitest run
 Test Files  81 passed (81)
      Tests  1386 passed (1386)
   Duration  30.97s
```

## Issues Encountered

None.

## Known Stubs

None. `gateCompletion`, `recordFromToolResult` and the run-state functions are fully wired pure logic; nothing renders to a UI in this plan, and no field is a hardcoded placeholder.

## Threat Flags

None. Every threat named in this plan's `<threat_model>` (T-06-01 through T-06-06, T-06-SC) is addressed by code shipped in this plan; no new network endpoint, auth path, file-access pattern, or schema change at a trust boundary was introduced beyond what the threat model already names.

## SEAM FINDING

None for this plan. `currentSha`/`gateCompletion`/the run-state slot compose exactly as `06-RESEARCH.md` (SEAM RISK 1, Q1/Q3) predicted: no existing SHA reader, now added; `isError` is genuinely structural per `bash.js:320-348`, confirmed again by MUTATION 5's observed behavior (the stub `currentSha` never touches `spawnSync`, so the not-a-repo throw case failed exactly as predicted for a function that no longer asks git anything). `/quick`'s own wiring of `startRun`/`recordToolResult`/`endRun` into Pi's `tool_result`/completion events is deferred to plan 06-02, per this plan's own scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `currentSha(cwd)`, `gateCompletion`, and the run-state functions (`startRun`/`recordToolResult`/`isRunArmed`/`endRun`) are ready for plan 06-02 to wire into `/quick`'s `pi.registerCommand` handler and Pi's `tool_result`/`tool_execution_end` events.
- `writeEvidenceRow`/`pruneEvidenceLogs` are ready for a `session_start` prune hook, matching `safety/audit.ts`'s established pattern, when 06-02/06-03 need one.
- No blockers. Full suite (1386 tests / 81 files) and `tsc --noEmit` both green.

---
*Phase: 06-walking-skeleton-quick-evidence-gate*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: .pi/extensions/workflows/evidence.ts
- FOUND: tests/unit/evidence-gate.test.ts
- FOUND commit: 17a0a2e (Task 1)
- FOUND commit: 7bd8c49 (Task 2)
- FOUND commit: 50552fb (Task 3)
