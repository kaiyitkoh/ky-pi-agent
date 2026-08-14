---
phase: 06-walking-skeleton-quick-evidence-gate
verified: 2026-08-15T02:00:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
deferred:
  - truth: "The directory-aggregate anti-offloading ratchet counts every line of a workflow's code, wherever it lives"
    addressed_in: "Phase 9"
    evidence: "06-REVIEW.md resolution block: 'wr_01_ratchet_blind_sideways: ACCEPTED AND DOCUMENTED — carried to Phase 9. ... Closing it means deciding what \"a workflow's code\" means across subsystem boundaries, which is Phase 9's question, not this walking skeleton's.' REQUIREMENTS.md ties FLOW-11 to Phase 6 only for the mechanism that constrains Phase 9's ceremonial workflows before they are written; Phase 9 is explicitly named as the phase this control exists to survive."
---

# Phase 6: Walking Skeleton — /quick + Evidence Gate Verification Report

**Phase Goal:** The full plumbing path — route → guard → execute → evidence → commit — runs end to
end at the smallest possible size, BEFORE any ceremonial workflow is built on top of it.
**Verified:** 2026-08-15T02:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/quick` takes a trivial task from prompt to atomic commit, routed by Phase 5, guarded by Phase 4, logged by Phase 2, in ≤80 raw lines (hard fail >100) | ✓ VERIFIED | Measured independently: `node -e "...split('\n').length"` on `.pi/extensions/workflows/index.ts` → **79**. Imports and calls the real `planRoleCall` (`../routing/modes.ts`) and `classifyGitInvocation`/`currentBranch`/`currentSha` (`../safety/git.ts`) — not re-implemented. `tests/integration/quick-workflow.test.ts` case 4 proves a Phase 2 `kind:"turn"` row lands with zero code in `/quick` calling diagnostics directly (D-5). |
| 2 | A completion claim is REJECTED unless a `tool_result`-class exit code bound to the CURRENT GIT SHA supports it; prose that merely looks like output does not pass | ✓ VERIFIED | `gateCompletion` in `.pi/extensions/workflows/evidence.ts` keys only on `EvidenceRecord.isError` (Pi-computed, from `tool_execution_end`) and SHA equality against a real `git rev-parse HEAD`; never reads `message.content`. Confirmed via source read and by running `tests/unit/evidence-gate.test.ts` (10/10) and `tests/integration/quick-workflow.test.ts` (14/14, including case 3's fabricated-transcript rejection asserting the reason contains none of the fake text, and cases 5-9 covering no-commit, buried-failure, blocked-call, dropped-capture and HEAD-moved-without-commit shapes). |
| 3 | CI FAILS THE BUILD when any workflow file exceeds its line budget | ✓ VERIFIED | `.github/workflows/ci.yml` runs `npx vitest run` on a `windows-latest`/`macos-latest` matrix (confirmed by direct grep). `tests/unit/workflow-budgets.test.ts` is part of that suite. I independently planted a 600-line file at `.pi/extensions/workflows/ceremony-probe.ts` and re-ran the test file live: it failed in **both** directions — the directory-aggregate over-budget check ("totals 1016 raw lines... over its directory budget of 420") and the present-but-undeclared completeness check — then reverted; suite returned to 24/24 green. |

**Score:** 3/3 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | The anti-offloading directory ratchet reaches every sibling of a command directory (not only files nested under one) | Phase 9 | `06-REVIEW.md`'s `resolution:` frontmatter and Warnings section (WR-01): the reviewer proved, by planting 2,402 unbudgeted lines in `.pi/extensions/workflows-helpers/` and `.pi/lib/`, that the current aggregate — scoped to directories holding a file that spells `registerCommand(` — does not reach a sibling subsystem directory. This was explicitly accepted and documented rather than fixed, with the closing decision assigned to Phase 9 (the phase whose ceremonial commands this control exists to survive). It does not undermine criterion 3 for the phase's actual current scope: no file in the repository today exploits this hole, and every workflow file that exists is inside a covered command directory. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.pi/extensions/safety/git.ts` (`currentSha`) | HEAD-SHA oracle, throws (no sentinel) | ✓ VERIFIED | `export function currentSha` present; `spawnSync` with `shell:false`; throws on non-zero status per decision D-B. |
| `.pi/extensions/workflows/evidence.ts` | `EvidenceRecord`, `gateCompletion`, run-state, JSONL binding | ✓ VERIFIED | 336 raw lines (budget 340). All required exports present (`gateCompletion`, `startRun`, `recordToolResult`, `endRun`, `writeEvidenceRow`, plus `recordCaptureFailure`/`armedCwd` added during review iterations). Imports only `../diagnostics/redact.ts` and `../../lib/jsonl.ts` — none from `../routing/` or `../safety/` (confirmed by grep, 0 hits). |
| `tests/helpers/git.ts` | temp-repo scaffolding, two real SHAs | ✓ VERIFIED | `makeTempRepo`/`commitFile`/`headSha` present and used throughout `evidence-gate.test.ts`. |
| `tests/unit/evidence-gate.test.ts` | 3 rejections + 1 acceptance, table-driven | ✓ VERIFIED | 10 tests passing; no 40-hex literal in the file (grep 0 hits). |
| `.pi/extensions/workflows/index.ts` | `/quick` command, ≤80 raw lines | ✓ VERIFIED | 79 raw lines measured independently; `registerCommand("quick"` present exactly once; no `spawnSync`/`execSync`/`exec(`/`waitForIdle` (all confirmed 0 hits); no tool registration anywhere under `.pi/extensions/workflows/` (grep for `registerTool` returns nothing). |
| `docs/WORKFLOWS.md` | rationale + line-counting rule, no restated budget numbers | ✓ VERIFIED | Contains `raw lines`, points at `tests/unit/workflow-budgets.test.ts` as the single authoritative registry, cites `modes.ts:401` and `runner.js:260`, and its §4 "what an ACCEPT verdict actually guarantees" paragraph matches the code's narrower wording exactly (see truth 2). |
| `tests/unit/workflow-budgets.test.ts` | authoritative registry, enforced both directions | ✓ VERIFIED | 24 tests passing; contains `1,169`; live-falsified in both directions (see truth 3). |
| `tests/integration/quick-workflow.test.ts` | route→guard→execute→evidence→commit proof | ✓ VERIFIED | 1387 lines (min_lines 200 in plan, hugely exceeded because 4 review iterations each added a regression case); 14 tests, all green; refusal reasons read from the real `planRoleCall`/`classifyGitInvocation` (never retyped, grep confirms ≥2 call sites); zero-cost refusals asserted via `faux.state.callCount`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `workflows/evidence.ts` | `.pi/lib/jsonl.ts` | `appendJsonl` with owned base name | ✓ WIRED | `EVIDENCE_LOG_BASE = "evidence"` injected locally into `pruneLogs`'s `ownedBases`, never accepted from caller. |
| `workflows/evidence.ts` | `diagnostics/redact.ts` | `redactString` over recorded command text | ✓ WIRED | `recordFromToolResult` applies `redactString(...).slice(0,200)`. |
| `workflows/index.ts` | `routing/modes.ts` | `planRoleCall` for executor role, verbatim reason on refusal | ✓ WIRED | `tests/integration/quick-workflow.test.ts` case 1 + MUTATION 1 (retyped-literal mutation goes red) confirm the reason is the real function's, not a hardcoded string. |
| `workflows/index.ts` | `safety/git.ts` | `classifyGitInvocation` + `currentBranch` + `PROTECTED_BRANCHES` pre-flight | ✓ WIRED | Case 2 + MUTATION 2 (deleting the pre-flight goes red and `callCount` becomes nonzero) confirm real enforcement, not a decorative call. |
| `workflows/index.ts` | `workflows/evidence.ts` | `startRun`/`recordToolResult`/`endRun` | ✓ WIRED | Case 4 + MUTATION 4 (deleting the capture handler turns an accept into a reject) confirm the gate is actually fed by captured tool results. |
| `workflows/index.ts` | Pi `tool_execution_end` event | structural `isError` capture | ✓ WIRED | Cases 5-8 (no-commit, buried-failure, blocked-call, dropped-capture) all exercise real Pi event dispatch and real safety-extension enforcement in a composite faux session, not a stub. |

### Data-Flow Trace (Level 4)

Not applicable in the UI-rendering sense (this phase ships no component). The equivalent trace —
does the evidence gate's verdict come from real captured tool outcomes rather than a static/stubbed
value — is covered by the Key Link Verification rows above and by cases 3-9 of the integration test,
each of which drives a real `tool_execution_end`/`agent_end` event through a real faux Pi session and
asserts on the resulting JSONL row, not a mocked return value.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `/quick` raw-line budget holds at 79/80 | `node -e "...split('\n').length"` on `index.ts` | `79` | ✓ PASS |
| Full suite green | `npx vitest run` | `Test Files 84 passed (84)` / `Tests 1440 passed (1440)` | ✓ PASS |
| Typecheck clean | `npx tsc --noEmit` | no output, exit 0 | ✓ PASS |
| Budget test fails on a planted unbudgeted 600-line file, both directions | plant `.pi/extensions/workflows/ceremony-probe.ts` (600 lines), run `npx vitest run tests/unit/workflow-budgets.test.ts` | 2 failed / 22 passed (24) — directory-aggregate AND present-but-undeclared both red | ✓ PASS |
| CI actually runs vitest on the cross-platform matrix that would catch the above | grep `.github/workflows/ci.yml` | `matrix: os: [windows-latest, macos-latest]` ... `run: npx vitest run` | ✓ PASS |
| No tool registered anywhere under the phase's files | `grep -n "registerTool" .pi/extensions/workflows/*.ts` | no matches | ✓ PASS |
| `docs/RUNBOOK.md` untouched by this phase | `git diff --name-only 7b33ddf~1 1dff7ef -- docs/RUNBOOK.md package.json package-lock.json .github/workflows/ci.yml` | no output | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files are declared by this phase's PLAN/SUMMARY files, and this is
not a migration/tooling phase in that sense — the phase's own verification mechanism IS the vitest
suite (`tests/unit/workflow-budgets.test.ts`, `tests/unit/evidence-gate.test.ts`,
`tests/integration/quick-workflow.test.ts`), which was executed directly above. Step 7c: SKIPPED (no
conventional probe scripts found for this phase).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| GATE-07 | 06-01, 06-02 | Task completion gated on `tool_result` exit codes bound to a git SHA, never transcript text | ✓ SATISFIED | `gateCompletion` predicate; `evidence-gate.test.ts` (10/10); `quick-workflow.test.ts` cases 3, 5-9 (9/9 relevant); REQUIREMENTS.md marks Complete, mapped to Phase 6. |
| FLOW-01 | 06-02, 06-03, 06-04 | `/quick` executes trivial work with no ceremony, ≤80 lines, CI-enforced | ✓ SATISFIED | `index.ts` = 79 raw lines; `workflow-budgets.test.ts`'s explicit 80-line ceiling test; REQUIREMENTS.md marks Complete, mapped to Phase 6. |
| FLOW-11 | 06-03 | Every workflow has a CI-enforced line budget | ✓ SATISFIED | `workflow-budgets.test.ts`, both-direction enforcement live-falsified (see truth 3); WR-01's sideways-hole is documented and deferred to Phase 9 rather than silently unaddressed; REQUIREMENTS.md marks Complete, mapped to Phase 6. |

No orphaned requirements: `.planning/REQUIREMENTS.md` maps exactly GATE-07, FLOW-01 and FLOW-11 to
Phase 6, and all three appear in at least one plan's `requirements:` frontmatter.

### Anti-Patterns Found

None. Grep for `TBD|FIXME|XXX` across all phase-modified files (`workflows/index.ts`,
`workflows/evidence.ts`, `workflow-budgets.test.ts`, `evidence-gate.test.ts`,
`quick-workflow.test.ts`, `docs/WORKFLOWS.md`) returns zero matches. No placeholder returns, no
empty handlers, no hardcoded empty data flowing to a user-visible path — the accept/reject wording
was itself the subject of a four-iteration adversarial review (`06-REVIEW.md` / `06-REVIEW-FIX.md`)
that specifically hunted for and eliminated an over-claiming wording defect (CR-01, iteration 4).

### Human Verification Required

None. Every claim in this phase is mechanically checkable (line counts, test suite outcomes, JSONL
row contents, git SHAs) and was checked directly against the running codebase rather than accepted
from the summaries.

### Gaps Summary

No gaps. All three ROADMAP success criteria are independently verified against the actual codebase
(not merely against SUMMARY.md claims):

1. `/quick` is 79/80 raw lines and demonstrably composes the real Phase 5 routing and Phase 4 safety
   functions rather than re-implementing them (proven by mutation testing in
   `tests/integration/quick-workflow.test.ts`, re-confirmed by reading the source directly).
2. The evidence gate keys exclusively on Pi-computed `isError` plus a real `git rev-parse HEAD`
   comparison, never on transcript text — and, after a four-iteration review loop, the shipped
   wording ("HEAD moved... no commit was verified and the work itself is NOT verified") accurately
   matches what the predicate can actually establish rather than over-claiming "a commit landed".
   This narrower, honest framing is itself evidence the phase's own adversarial review process
   worked as intended.
3. CI fails the build on an over-budget or unlisted workflow file — verified by direct falsification
   (planting an oversized, unbudgeted file and observing the test go red in both directions), not
   merely by reading the test file.

One item (WR-01: the anti-offloading ratchet does not reach sibling directories outside a command
directory) is a known, explicitly accepted and documented residual risk, correctly deferred to Phase
9 per the review's own resolution record — this is exactly the "accepted-and-documented" pattern
that should not be treated as a silent pass, and it is recorded above as a deferred item rather than
a gap, since it does not undermine any of the three success criteria for the code that exists today.

---

_Verified: 2026-08-15T02:00:00Z_
_Verifier: Claude (gsd-verifier)_
