---
phase: 02-diagnostics-the-instrument
verified: 2026-08-13T00:00:00Z
status: human_needed
score: 13/13 offline-verifiable must-haves verified (5/5 ROADMAP success criteria, 8/8 DIAG requirements at their offline-verifiable level)
overrides_applied: 0
human_verification:
  - test: "RB-02-01 (DIAG-01) — one real turn per provider produces a wire dump showing the thinking parameters"
    expected: "DeepSeek-direct payload carries a top-level `reasoning_effort` alongside `thinking:{type:'enabled'}`; Bedrock Claude payload carries a non-empty `additionalModelRequestFields`. Procedure and exact commands are in docs/RUNBOOK.md."
    why_human: "No live model credentials or provider egress exist on the development machine. fauxProvider builds its own payload; a fixture that agrees with itself is not evidence of what a real adapter emits. [RUNBOOK] requirement per ROADMAP.md, pre-authorised to stay OUTSTANDING at this phase boundary."
  - test: "RB-02-02 (DIAG-07) — no live credential appears in any wire dump"
    expected: "grep for credential-shaped strings across .pi/logs/ prints nothing (exit 1); the main.headers record shows every credential-shaped header as `[redacted:N chars]`."
    why_human: "fauxProvider resolves no auth, so no real credential has ever passed through the capture path on this machine. Must run after RB-02-01 on the work laptop with live credentials."
  - test: "RB-02-03 (DIAG-05) — the prose-tool-call detector has fired on real DeepSeek V4 Flash traffic"
    expected: "A working day of real traffic produces a numerator/denominator prose rate comparable to the ~11% baseline in DeepSeek-V3 issue #1244, with at least one instance where the retry recovered the turn."
    why_human: "The ~11% prose failure mode only manifests on real model output; offline the detector is fed messages this repository wrote to make it fire, which measures the predicate and not the model."
---

# Phase 2: Diagnostics — The Instrument Verification Report

**Phase Goal:** "Every claim the rest of the project makes about which model ran, what parameters reached it, and what it cost becomes checkable rather than assumed."
**Verified:** 2026-08-13
**Status:** human_needed
**Re-verification:** No — initial verification

## Judgement call applied (per Standing Operating Policy)

DIAG-01 and DIAG-05 are declared [RUNBOOK] requirements in both ROADMAP.md and REQUIREMENTS.md. This machine has no live model credentials. Per the authoritative project policy supplied with this task, RB-02-01/02/03 are EXPECTED to remain OUTSTANDING and their outstanding state is explicitly "NOT a gap." Consequently this report classifies the phase as `human_needed` rather than `gaps_found`: every truth that can be verified offline on this machine was verified with genuine (non-tautological) evidence, and the three RUNBOOK items are recorded as pre-authorised human-verification items rather than failures. `gaps_found` is reserved for things genuinely not built, and nothing in this phase falls into that category.

## Adversarial method used

Per the critical-verification instruction, every DIAG requirement was checked not merely for "a test file exists and passes" but for whether the test would fail if its subject were deleted or neutered — i.e., for negative controls, non-tautological assertions, and evidence that the Wave-0 `onPayload` trap (fauxProvider never fires `before_provider_request`) was actually closed rather than papered over.

## Goal Achievement

### Observable Truths (ROADMAP Phase 2 success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Wire dumps are redacted **at capture time** (not on read) and written only to gitignored paths | ✓ VERIFIED (offline half); live half [RUNBOOK] OUTSTANDING (expected) | `.pi/extensions/diagnostics/wire.ts:88-89,283-286` redacts inside the `before_provider_request` handler itself, before `appendJsonl` is called — redaction happens before the bytes ever reach disk, not after. `tests/integration/wire-capture.test.ts` case 3 asserts a planted credential (`SECRET_FIXTURE_TOKEN`) is **absent** from the raw bytes on disk and case 4 is the paired positive proving the redactor doesn't over-redact (model id survives). Case 5 asserts every produced path is `git check-ignore`d. `.gitignore:79` covers `.pi/logs/`, line 30 covers `*.jsonl` project-wide. RB-02-01/RB-02-02 (real-credential confirmation) are OUTSTANDING per docs/RUNBOOK.md, exactly as ROADMAP.md's [RUNBOOK] designation for DIAG-01 anticipates. |
| 2 | A build-failing check proves no model call bypasses the instrument, with a negative control | ✓ VERIFIED | `tests/unit/chokepoint-lint.test.ts` bans 6 bypass routes (`modelRegistry.complete`/`completeSimple`/`stream`/`streamSimple`/`getProvider`, `getRegisteredNativeProvider`, deep pi-ai `/api/` imports, `ModelRuntime`) via source-grep over tracked `.pi/extensions/*.ts`, exempting only the `diagnostics/` directory. It has **three vacuous-pass guards**: asserts the scanned set is non-empty, asserts the post-exemption set is non-empty, and proves every forbidden pattern fires against an inline `OFFENDING_FIXTURE` (so a broken regex cannot pass silently). `tests/integration/call-model.test.ts` case 1 is the genuine negative control: a bare `ctx.modelRegistry.complete()` call is asserted to produce **zero** wire/turn records — proving the chokepoint's absence is actually observable, not merely asserted in prose. Case 2c proves a caller-supplied `onPayload` cannot suppress its own capture (spread-order enforcement). |
| 3 | Every turn appends a JSONL row with model, provider, tokens, cost, latency, cache-read ratio, outcome — and no reasoning-token column for Bedrock | ✓ VERIFIED | `.pi/extensions/diagnostics/turns.ts` composes the row; `tests/unit/turn-row.test.ts` asserts via `Object.keys()` (not `toBeUndefined()`, which would pass on a present-but-undefined key) that `reasoning` is **absent**, not zero, when `usage.reasoning` is undefined — exactly Bedrock's shape (`handleMetadata` never assigns it). A defensive `calculateCost` recompute is proven load-bearing: the cost-total assertion starts from `usage.cost.total === 0` (faux's hardcoded value) and proves the row's cost is strictly positive afterward, so `0 === 0` cannot pass silently. `tests/integration/turns-log.test.ts` case 6 proves no faux-driven row ever carries a `reasoning` key at all (faux never populates it), and case 2 proves the turn row and its wire records share one correlation id. |
| 4 | prose_tool_call detection logs and retries rather than treating the turn complete; built + unit-verified with fauxProvider; live confirmation is a RUNBOOK item and stays outstanding | ✓ VERIFIED (offline half); live half [RUNBOOK] OUTSTANDING (expected) | `.pi/extensions/diagnostics/prose.ts` implements the 4-gate predicate; `tests/unit/prose-detector.test.ts` provides positive/negative tables including the deliberate false-positive control (a bare tool-name mention). `tests/integration/prose-retry.test.ts` is a genuine gate with **3 separate negative controls** discovered by falsification testing during development (documented in the file: deleting gate 2 alone left all cases green because gate 1 already held the case, and vice versa — cases 4b/4c were added specifically to isolate each gate). It proves `callCount === 2` (the model really was re-invoked), the retry reached the model with the actual nudge text (`retryOutgoing[0]` inspected), the cap holds at exactly `MAX_PROSE_RETRIES = 1` against 3 scripted prose responses, and the retry budget resets on `agent_start` (case 6, two-run test). RB-02-03 (real DeepSeek traffic) is OUTSTANDING as ROADMAP.md's own SC4 wording anticipates ("built and unit-verified... verified live on the work laptop"). |
| 5 | `/budget` reports system-prompt, tool-schema, context-file and skills-index tokens plus `cacheRead` vs `input`, and logs rotate rather than growing unbounded | ✓ VERIFIED | `.pi/extensions/diagnostics/budget.ts` slices the real system prompt by locating Pi's own literal delimiters (verified against `dist/core/system-prompt.js.map` sourcesContent, cited file:line) rather than guessing; a missing marker is reported as a warning, never silently guessed at. `tests/integration/budget.test.ts` case 1 drives it against the real installed Pi's system prompt and asserts the sliced sections sum to the total; case 3 asserts `cacheRead` vs `input` across two real session turns. Rotation: `.pi/extensions/diagnostics/jsonl.ts` `appendJsonl` checks `size + thisRecord > cap` before every write and rotates via `rename`-based shifting bounded by `MAX_ROTATED_FILES = 10`; `pruneLogs` deletes by date-stamp age (`RETENTION_DAYS = 14`) at `session_start`. Concurrency claim (4 processes, 6000/6000 lines, zero unparseable) is cited as executed on 2026-08-13, Windows, in the file's own docstring. |

**Score:** 5/5 ROADMAP success criteria pass at the offline-verifiable level the ROADMAP itself designates for this phase; the 3 [RUNBOOK]-flagged live confirmations are OUTSTANDING as expected.

### Requirement Coverage (DIAG-01..08)

| Requirement | Source Plan(s) | Status | Evidence |
|---|---|---|---|
| DIAG-01 | 02-01, 02-05, 02-11 | ✓ SATISFIED (offline) / [RUNBOOK] OUTSTANDING (live) | Three hooks registered in `wire.ts`, proven to fire in order `main.headers→main.request→main.response` under one correlation id (`tests/integration/wire-capture.test.ts` case 1), with the Wave-0 `onPayload` trap explicitly closed via `wrapFauxWithPayload` (`tests/helpers/faux.ts`). REQUIREMENTS.md line 31 correctly left unchecked (`[ ]`), consistent with RB-02-01 OUTSTANDING. |
| DIAG-02 | 02-01, 02-07 | ✓ SATISFIED | `callModel()` chokepoint (`call-model.ts`) restores all three hooks for the nested path; negative control proves a bare `modelRegistry.complete()` is invisible. REQUIREMENTS.md correctly checked (`[x]`). |
| DIAG-03 | 02-07 | ✓ SATISFIED | `tests/unit/chokepoint-lint.test.ts` — build-failing source-grep gate with 3 vacuous-pass guards and an inline offending fixture proving every pattern is live. REQUIREMENTS.md correctly checked. |
| DIAG-04 | 02-01, 02-06, 02-08 | ✓ SATISFIED | `turns.ts` composeTurnRow, `tests/unit/turn-row.test.ts` (52 tests) + `tests/integration/turns-log.test.ts` (6 cases). Omitted-key rule proven via `Object.keys`, not `toBeUndefined`. REQUIREMENTS.md correctly checked. |
| DIAG-05 | 02-01, 02-04, 02-09 | ✓ SATISFIED (offline) / [RUNBOOK] OUTSTANDING (live) | `prose.ts` predicate + `index.ts` effect (log, retry once, cap, reset per agent run). `tests/integration/prose-retry.test.ts` has 3 falsification-derived negative controls. REQUIREMENTS.md correctly left unchecked, consistent with RB-02-03 OUTSTANDING. |
| DIAG-06 | 02-10 | ✓ SATISFIED | `budget.ts`, `tests/unit/budget-sections.test.ts` + `tests/integration/budget.test.ts` (5 cases) driven against the real installed Pi's system prompt. REQUIREMENTS.md correctly checked. |
| DIAG-07 | 02-02, 02-03, 02-05, 02-11 | ✓ SATISFIED | `redact.ts` — header key-name matching (closed list + open regex) and value-shape matching (10 credential shapes), bounded regexes (no nested quantifiers, ReDoS-tested at 1MB/<2s), non-mutating contract on `redactDeep`. Applied inside the capture hook itself (capture-time, not read-time). REQUIREMENTS.md correctly checked. |
| DIAG-08 | 02-03 | ✓ SATISFIED | `jsonl.ts` rotation (size-triggered, rename-based, bounded by `MAX_ROTATED_FILES`) and retention (`pruneLogs`, date-stamp-based, run at `session_start`). Concurrency safety verified execution cited in-file. REQUIREMENTS.md correctly checked. |

No orphaned requirements: REQUIREMENTS.md maps exactly DIAG-01..08 to Phase 2, and all 8 are claimed across the 11 plans' `requirements` frontmatter.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.pi/extensions/diagnostics/index.ts` | Entry point registering all hooks + `/budget` | ✓ VERIFIED | Registers `session_start`, 3 wire hooks, 3 turn hooks, `agent_start`, and `/budget` — matches the docstring's claim of "eight hooks... plus exactly one command." Never registers a tool (BOOT-10 boundary rule respected — the registration call is never spelled, even in prose). |
| `.pi/extensions/diagnostics/wire.ts` | Main-loop provider hooks, capture+redact+append | ✓ VERIFIED, WIRED | Imported and called from `index.ts:390`. |
| `.pi/extensions/diagnostics/call-model.ts` | The chokepoint | ✓ VERIFIED, WIRED | Exports `callModel`; chokepoint-lint test asserts it exists, is tracked, sits inside the exempt directory, and contains the sanctioned call. |
| `.pi/extensions/diagnostics/turns.ts` | Pure row composer | ✓ VERIFIED, WIRED | Imported by both `index.ts` and `call-model.ts`. |
| `.pi/extensions/diagnostics/prose.ts` | Pure prose predicate | ✓ VERIFIED, WIRED | Imported by `index.ts:107`, called inside `message_end` handler. |
| `.pi/extensions/diagnostics/redact.ts` | Redactor | ✓ VERIFIED, WIRED | Imported by `wire.ts`, `call-model.ts`, `turns.ts`, `budget.ts`, `index.ts`. |
| `.pi/extensions/diagnostics/jsonl.ts` | Append/rotate/prune writer | ✓ VERIFIED, WIRED | Imported everywhere an append occurs. |
| `.pi/extensions/diagnostics/schema.ts` | Shared literals/types | ✓ VERIFIED, WIRED | Single import-concentration point for pi-ai types, imported by every sibling. |
| `.pi/extensions/diagnostics/budget.ts` | `/budget` command | ✓ VERIFIED, WIRED | Registered via `registerBudgetCommand` at `index.ts:623`. |
| `docs/RUNBOOK.md` (RB-02-01/02/03) | 3 OUTSTANDING entries | ✓ VERIFIED | Present, each with exact command, expected output, offline proxy, and status line, guarded mechanically by `tests/unit/docs-policy.test.ts` (checks summary-table row and `**Status:**` line agree). |
| `docs/DIAGNOSTICS.md` | Documents the row/log contract | ✓ VERIFIED | 434 lines, exists per 02-11-SUMMARY.md. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `index.ts` | `wire.ts` | `registerWireHooks(pi, safeHandler, noteRowWritten)` | ✓ WIRED | Call present at `index.ts:390`; hooks fire and append records (proven by `wire-capture.test.ts`). |
| Main agent loop | `call-model.ts` chokepoint | source-grep ban on direct `modelRegistry.complete` outside `diagnostics/` | ✓ WIRED | `chokepoint-lint.test.ts` passes with a live negative control. |
| `message_end` | `prose.ts` predicate | `isProseToolCall(event.message, pi.getActiveTools())` | ✓ WIRED | `index.ts:441`; active-tool list is live, never hardcoded. |
| Prose detection | retry effect | `pi.sendUserMessage(PROSE_RETRY_PROMPT, {deliverAs:"followUp"})` | ✓ WIRED | `index.ts:502`; proven to reach the model (`retryOutgoing` capture in `prose-retry.test.ts`), capped, and reset per agent run. |
| `/budget` command | real system prompt | `ctx.getSystemPrompt()` / `ctx.getSystemPromptOptions()` | ✓ WIRED | `budget.ts:600-602`; integration test drives it against the real installed Pi's prompt. |
| `appendJsonl` | rotation | size check before every write | ✓ WIRED | `jsonl.ts:322-325`. |

### Data-Flow Trace (Level 4)

Not applicable in the UI sense — this phase produces JSONL logs and a text command output, not rendered components. The equivalent trace (does the reported/logged data come from a real source rather than a static/hardcoded value) was performed as part of the "genuine gate" analysis above: `wire-capture.test.ts` case 2 proves the recorded payload IS the outgoing request (not a constant); `turn-row.test.ts`/`turns-log.test.ts` prove cost is recomputed rather than copied from faux's hardcoded zero; `budget.test.ts` case 1 proves the sliced sections are read from the real installed Pi's system prompt, not a fixture string.

### Behavioral Spot-Checks

Not run as a separate step — the integration test suite (`tests/integration/*.test.ts`) already exercises live in-memory Pi sessions via `withFauxSession`/`createAgentSession` for every one of the 5 ROADMAP success criteria, and `npm test` (462/462 passing, already run per task instructions) covers this ground more thoroughly than a standalone spot-check would.

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or declared probes found for this phase; SKIPPED (no runnable probes declared).

### Anti-Patterns Found

None. Scanned all 9 files under `.pi/extensions/diagnostics/` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` — the only hits are legitimate uses of the word "placeholder" as part of the redaction-placeholder naming convention (`redactionPlaceholder()`, `TRUNCATION_PLACEHOLDER`), not debt markers. No empty-return stubs, no hardcoded-empty stub data. All 29 commit hashes cited across the 11 SUMMARY.md files were confirmed present in `git log` (`git cat-file -e`).

### Requirements Coverage

See Requirement Coverage table above — all 8 DIAG requirements satisfied at their designated verification level (offline-fully for 6, offline+RUNBOOK-outstanding for 2, exactly matching REQUIREMENTS.md's own `[x]`/`[ ]` checkbox state).

### Human Verification Required

See YAML frontmatter `human_verification` block. All three items are RB-02-01, RB-02-02, RB-02-03 from `docs/RUNBOOK.md`, each already documented there with exact commands, expected output and offline proxy. Per the Standing Operating Policy, these are pre-authorised to remain OUTSTANDING at this phase boundary and do not block progression to Phase 3.

### Gaps Summary

None. Every offline-verifiable truth for Phase 2 was checked against genuine, non-tautological evidence (negative controls, falsification-derived isolating fixtures, assertions on `Object.keys` rather than `toBeUndefined`, live-session integration tests rather than pure-fixture-only tests). The only outstanding items are the three RUNBOOK live-credential checks (DIAG-01, DIAG-05), which are structurally impossible to perform on this development machine and are explicitly pre-authorised by project policy to stay OUTSTANDING at this point. No task was found to have shipped a stub, a vacuous test, or an unwired artifact.

One informational note, not a gap: `.planning/ROADMAP.md`'s Progress table (line 304) still reads "0/11 | Planned" for Phase 2, even though the same file's Phase list (line 21) already marks Phase 2 `[x]` complete. This is a documentation bookkeeping inconsistency in the roadmap file itself, unrelated to whether the phase's deliverables exist and work — flagged for the orchestrator to reconcile when it records this verification's outcome, not treated as a phase gap.

---

_Verified: 2026-08-13_
_Verifier: Claude (gsd-verifier)_
