---
phase: 08-quality-gates-engineering-quality
verified: 2026-08-15T18:10:00Z
status: human_needed
score: 5/5 must-haves verified (roadmap success criteria); 16/16 requirement IDs accounted for
overrides_applied: 0
human_verification:
  - test: "RB-08-01 — confirm main-loop thinking budgets land on the wire for a real turn per provider"
    expected: "A real provider wire dump shows the thinking/reasoning parameter reaching pi.setModel()'s own dispatch, matching the nested-role fix's shape"
    why_human: "Requires live provider inference; this dev machine intentionally holds no usable provider credential for main-loop calls (live static IAM admin creds on this laptop, no inference may be issued) — pre-authorised as OUTSTANDING for this run"
  - test: "RB-08-02 — run the LSP gate leg against a really-installed @narumitw/pi-lsp and a real TypeScript language server"
    expected: "probeLspAvailability reports FAIL against a real seeded type error rather than UNAVAILABLE"
    why_human: "@narumitw/pi-lsp has never been installed (Phase 7 installed nothing); pre-authorised as OUTSTANDING for this run"
  - test: "RB-08-03 — spawn the reviewer as a real pi-subagents subagent and run the seeded-defect corpus through a live model instead of the scripted faux reviewer"
    expected: "A real CalibrationResult with a non-scripted catchRate, expected to differ from 2/6"
    why_human: "Needs pi-subagents actually installed (never installed this project) and a live model credential; pre-authorised as OUTSTANDING for this run"
---

# Phase 8: Quality Gates & Engineering Quality Verification Report

**Phase Goal:** A cheap executor's output is caught by the same class of defect a strong model would have caught, at a measured cost, and the fixes it produces are root-cause fixes rather than symptom patches.
**Verified:** 2026-08-15T18:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Typecheck, lint, LSP diagnostics and deterministic anti-pattern rules run and feed errors back before any model review, adding no model round trip and no measurable wall-clock | ✓ VERIFIED (offline) / human_needed (LSP live leg) | `.pi/extensions/quality/gates.ts` implements `runDeterministicGates` with a `typecheck → lint → lsp → anti-pattern` binding order (`GATE_LEGS`), three-state (`pass`/`fail`/`unavailable`) legs. Wired into `/quick` at `.pi/extensions/workflows/index.ts:45` BEFORE `startRun`/model handoff. `tests/unit/quality-gates.test.ts` and `tests/integration/quality-gate-order.test.ts` (all green, verified by direct run) assert ordering structurally and assert no model round trip. `probeLspAvailability` proven in both `unavailable`/live states offline; `@narumitw/pi-lsp` never installed (Phase 7 installed nothing), so the LSP leg has only ever reported `UNAVAILABLE` — correctly deferred to `RB-08-02`, OUTSTANDING, pre-authorised for this run. |
| 2 | A seeded defect the cheap executor misses is caught by the gate, and seeded-defect calibration reports what share of injected defects the reviewer actually finds | ✓ VERIFIED | `tests/fixtures/seeded-defects/index.ts` (six real Phase 3-7 incidents, each isolated to a `makeTempRepo` clone, never the real working tree). `.pi/extensions/quality/calibration.ts#scoreCalibration` is a pure ratio. Ran `tests/integration/reviewer-calibration.test.ts` directly: 20/20 green. The reported number is **2/6 = 0.333...**, confirmed reproducible (explicit "reproducibility" test passes) and confirmed consistent with the honest, corrected figure across `docs/QUALITY.md`, `docs/RUNBOOK.md`, and `.planning/REQUIREMENTS.md`'s GATE-08 row. Five negative/adversarial controls all score `catchRate: 0` (blind reviewer, shotgun, name-drop, boilerplate kitchen-sink, two-needle kitchen-sink) — the mechanism distinguishes "clean" from "reviewer asleep" and resists three successive exploit constructions (WR-03, WR2-05, WR3-01) found across the phase's own 3-iteration review. Live-model calibration (RB-08-03) is correctly OUTSTANDING/pre-authorised. |
| 3 | Review output carries per-requirement verdict with file:line evidence, mandatory "checked and cleared" section, BLOCKER/WARNING/NIT classification with unclassified findings rejected, and a refute-or-promote pass before a BLOCKER can stop work | ✓ VERIFIED | `.pi/extensions/quality/review-schema.ts` (`validateReview`, 579 lines) rejects unclassified findings, missing verdicts, empty "checked and cleared", by code — confirmed by `tests/unit/quality-schema.test.ts`. `.pi/extensions/quality/verdict.ts` implements `runRefuteOrPromote`/`decideWorkflowStop` with `MAX_REVIEW_ITERATIONS = 2` and a bounded loop (`tests/integration/refute-or-promote.test.ts`, 08-09-PLAN.md's must-haves). All tests run directly, green. |
| 4 | Every change is classified root-cause/symptomatic/workaround with written justification; symptomatic/workaround changes stop the workflow pending approval; an approved workaround is recorded with what the proper fix would be | ✓ VERIFIED (mechanism) | `decideWorkflowStop` in `verdict.ts` implements the QUAL-05 stop signal; `review-schema.ts` rejects a workaround with no proper-fix record. `tests/integration/quality-gate-order.test.ts` proves the stop signal and record at session level over a validated review (per 08-11-PLAN.md's own stated boundary: wiring the signal into a live ceremonial workflow command is Phase 9's QUAL-08, correctly out of this phase's scope and correctly excluded from this phase's requirement list). |
| 5 | The wall-clock and token cost the quality layer adds is a recorded number per turn in the JSONL; nested-role thinking budgets apply; main-loop budgets apply only where Phase 2 proved the parameters land | ✓ VERIFIED (nested) / human_needed (main-loop) | `.pi/extensions/diagnostics/quality-cost.ts` (`addQualityCost`/`takeQualityCost`) exercised by real producers (gate stage, reviewer, refute pass, advisor). `TurnRow.qualityMs`/`qualityTokens` carry the omission rule (absent, not zero, when the layer didn't run) — confirmed in `schema.ts` and `turn-row.test.ts`. The nested-role nested-thinking defect (GATE-10 nested half) is fixed and proven with a RED-before-fix commit pair (see below). Main-loop half is `RB-08-01`, OUTSTANDING, pre-authorised. |

**Score:** 5/5 roadmap success criteria structurally verified to the offline-provable limit of each; all three RUNBOOK-gated live legs are correctly OUTSTANDING and pre-authorised for this run, not gaps.

### Phase's Own Three Stated Obligations (explicitly re-verified against the codebase, not summaries)

| # | Obligation | Status | Evidence |
|---|---|---|---|
| a | Phase 5 defect at `.pi/extensions/routing/modes.ts` fixed with a test recorded RED before the fix (`6dfd77e` → `7ca2315`) | ✓ VERIFIED | `git show 6dfd77e` is a test-only commit ("prove nested calls send the wrong thinking field on Bedrock (RED)") with the commit message pasting the actual `FAIL` output. `git show 7ca2315` is the production fix (`buildNestedApiOptions`, branching on `model.api`: `bedrock-converse-stream → {reasoning}`, `anthropic-messages → throw` (no ROLE_MAP candidate exists to map to), `openai-completions`/default → `{reasoningEffort}`). Read `buildNestedApiOptions` directly at `.pi/extensions/routing/modes.ts:445-474` — matches the commit's claim exactly. `runSingleShotRole` calls it in place of the old inline ternary. |
| b | `tests/integration/qoder-delegate.test.ts` de-flaked at ROOT CAUSE — event-gated, both elapsed bounds deleted — with none of the prohibited mechanisms present | ✓ VERIFIED | Read the file directly. WR-07 case awaits `loop.firstChunkWritten` (an event, not a duration) before asserting; no `>= Nms` wall-clock assertion anywhere in that case. WR-04 case uses an injected clock (`now`) driven by an `onProgress` callback that fires from inside the client's own read loop — zero real `sleep`/wall-clock wait; the test's own comment states the 20-test file completes in well under a second. `grep` across the test file and `vitest.config.ts` for `it.skip`, `.only`, `retry:`, `fileParallelism:false`: zero matches. `testTimeout: 120_000` in `vitest.config.ts` predates this phase (introduced at `b4a5711`, Phase 5) and was not touched by this phase's fix — not a prohibited mechanism reintroduced here. WR3-03 (iteration-3 review) additionally closed a vacuous-pass risk by pinning `nowCalls > 0`, confirmed present in the file. Ran the file directly: 20/20 green, and it ran in ~5s wall clock as part of the full suite. |
| c | Seeded-defect calibration produces a reproducible catch-rate number with controls holding; the honest current number is 2/6 = 0.333 (not the earlier, held-constant-by-construction 3/6 = 0.5) | ✓ VERIFIED | Ran `tests/integration/reviewer-calibration.test.ts` directly with verbose reporter: the `WR3-02` test name itself states `caught === 2, total === 6, catchRate === 2/6 (0.333...)` and explains the fixture was reverted to unedited text. All four other controls (blind, shotgun, name-drop, boilerplate kitchen-sink, two-needle kitchen-sink) score `catchRate: 0`, and a `reproducibility` test (two independently-built runs produce identical `CalibrationResult`) passes. Cross-checked every place the number is stated: `docs/QUALITY.md` (2/6, 0.333...), `docs/RUNBOOK.md:1437,1439,1464-1465` (2/6, with an explicit historical note that it "was 3 of 6, 0.5, before WR3-02"), `.planning/REQUIREMENTS.md` GATE-08 row (2/6, corrected from an undisclosed 3/6). `08-10-SUMMARY.md` and `08-13-SUMMARY.md` retain their original 3/6 body text but carry an explicit correction blockquote at the top stating the honest number is 2/6 — a deliberate, disclosed historical-record pattern (per `08-REVIEW-FIX.md`'s own stated policy of correction blockquotes rather than silent rewrites), not a residual inconsistency. 0.333 is treated correctly as an acceptable poor-but-honest, reproducible number, not a failure. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.pi/extensions/quality/rules.ts` | Six anti-pattern rule functions, syntax-node based | ✓ VERIFIED | 889 lines; `ruleMagicNumber`, `ruleLiteralSpecialCase`, `ruleCopyPaste`, `ruleSwallowedException`, `ruleShippedTodo`, `ruleNPlusOne` all present and exported; `runAntiPatternRules` aggregator present; uses `ts.createSourceFile`/`forEachChild` (grep-confirmed) |
| `.pi/extensions/quality/review-schema.ts` | `submit_review` schema + `validateReview` | ✓ VERIFIED | 579 lines, `validateReview` present, exercised by 20+ passing tests |
| `.pi/extensions/quality/gates.ts` | `runDeterministicGates` + `probeLspAvailability` + `shouldRunDesignReview` | ✓ VERIFIED | 425 lines, all three functions present and exported |
| `.pi/extensions/quality/reviewer.ts` | `buildReviewerContext` + `runReview` via `runSingleShotRole` | ✓ VERIFIED | 424 lines; `reviewer-contract.test.ts` proves all six contract elements land on a captured outgoing request (17/17 green, ran directly) |
| `.pi/extensions/quality/advisor.ts` | `consult_advisor` tool + `executeConsultAdvisor` | ✓ VERIFIED | 197 lines; registered in `quality/index.ts:407-408` |
| `.pi/extensions/quality/verdict.ts` | `runRefuteOrPromote` + `decideWorkflowStop` | ✓ VERIFIED | 548 lines; `MAX_REVIEW_ITERATIONS = 2` present |
| `.pi/extensions/quality/calibration.ts` | Pure `scoreCalibration` | ✓ VERIFIED | 248 lines; ran the full test suite live, matches claims |
| `.pi/extensions/quality/index.ts` | Extension entry point, composes gates/reviewer/verdict, registers `consult_advisor` | ✓ VERIFIED | 421 lines; `pi.registerTool({name: "consult_advisor", ...})` confirmed; `runQuickGateStage` exported and imported by `workflows/index.ts` |
| `.pi/extensions/diagnostics/quality-cost.ts` | Accumulator (`addQualityCost`/`takeQualityCost`) | ✓ VERIFIED | 240 lines; `globalThis`-keyed, confirmed by grep |
| `tests/fixtures/seeded-defects/index.ts` | Six defect-class builders, `makeTempRepo`-isolated | ✓ VERIFIED | Confirmed isolation via `makeTempRepo`; corpus integrity tests all green |
| `docs/QUALITY.md` | Quality layer contract doc, code-authoritative-on-disagreement rule | ✓ VERIFIED | 343 lines, present, states the ownership/contract rule explicitly, contains the corrected 2/6 disclosure |
| `docs/RUNBOOK.md` RB-08-01/02/03 | Three runbook entries, all OUTSTANDING | ✓ VERIFIED | Present at lines 1314-1473, all three marked OUTSTANDING in both the summary table and detail sections |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `.pi/extensions/workflows/index.ts` | `.pi/extensions/quality/index.ts#runQuickGateStage` | imported call at `/quick`'s handler, before `startRun`/handoff | ✓ WIRED | Confirmed at `workflows/index.ts:12,45` — `runQuickGateStage(ctx.cwd, ctx.isProjectTrusted())` runs, and blocks (`gate.blocking`) before `startRun` is ever called |
| `.pi/extensions/quality/gates.ts` | `.pi/extensions/quality/rules.ts` | `runAntiPatternRules` over touched-file set | ✓ WIRED | Confirmed by grep and passing `quality-gates.test.ts` |
| `.pi/extensions/quality/index.ts` | `.pi/extensions/diagnostics/quality-cost.ts` | `addQualityCost` | ✓ WIRED | Confirmed; `/quick`'s blocking path also calls `refundQualityCost` (negative control) |
| `.pi/extensions/routing/modes.ts` | `buildNestedApiOptions` | replaces old inline ternary in `runSingleShotRole` | ✓ WIRED | Confirmed at source, `runSingleShotRole` (`:525`) area references the function |
| `tests/integration/gate10-nested-thinking.test.ts` | fauxProvider per `model.api` | asserts on outgoing options per api id | ✓ WIRED | Ran directly as part of full suite, green |
| `.pi/extensions/quality/reviewer.ts` | `.pi/extensions/diagnostics/redact.ts` | redaction over assembled context | ✓ WIRED | `reviewer-contract.test.ts`'s secret-shaped-token test passes |
| `.pi/extensions/workflows/index.ts` | `.pi/extensions/safety/git.ts` | base/head tree hashes for the evidence-gate residual (08-12) | ✓ WIRED | `startRun`/`endRun` in `workflows/evidence.ts` carry `baseTree`/`currentTree`; branch (6) confirmed present at `evidence.ts` |

### Requirements Coverage

All 16 declared phase requirement IDs (GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06, GATE-08, GATE-09, GATE-10, QUAL-01, QUAL-02, QUAL-04, QUAL-05, QUAL-06, QUAL-07, QUAL-09) are present in `.planning/REQUIREMENTS.md`'s Phase 8 status table — no orphans, no omissions.

| Requirement | Status | Evidence |
|---|---|---|
| GATE-01 | Partial (SATISFIED offline; RB-08-02 OUTSTANDING, pre-authorised) | Deterministic gate stage wired into real `/quick`; LSP leg mechanism proven in both states offline, never observed live |
| GATE-02 | Partial (SATISFIED offline; RB-08-03 OUTSTANDING, pre-authorised) | Six-element context contract proven on captured outgoing request; reviewer dispatched via `runSingleShotRole`, not a real subagent spawn (package never installed) |
| GATE-03 | SATISFIED | `validateReview` rejects any finding missing verdict/file:line by code |
| GATE-04 | SATISFIED | Mandatory "checked and cleared" section, rejected if empty |
| GATE-05 | SATISFIED | BLOCKER/WARNING/NIT enforced, unclassified rejected |
| GATE-06 | SATISFIED | `runRefuteOrPromote`/`decideWorkflowStop`, BLOCKER-only scope, bounded loop |
| GATE-08 | Partial (SATISFIED offline; RB-08-03 OUTSTANDING, pre-authorised) | Corpus + scorer + 5 controls all pass; 2/6 = 0.333 is a scripted-faux-reviewer number, not live |
| GATE-09 | SATISFIED | `consult_advisor` tool registered, dispatches via `runSingleShotRole`, cost attributed |
| GATE-10 | Partial (nested half SATISFIED; RB-08-01 OUTSTANDING, pre-authorised) | Real Bedrock defect found+fixed with RED-before-fix proof; main-loop half needs live wire dump |
| QUAL-01 | SATISFIED | Six anti-pattern rules, syntax-node based, tests green |
| QUAL-02 | SATISFIED | Structural no-model-call assertion + measured wall-clock budget test |
| QUAL-04 | SATISFIED | root-cause/symptomatic/workaround classification in schema + verdict |
| QUAL-05 | SATISFIED | `decideWorkflowStop` stop signal for symptomatic/workaround |
| QUAL-06 | SATISFIED | Workaround-with-no-proper-fix-record rejected by schema |
| QUAL-07 | SATISFIED | `shouldRunDesignReview` fires only on named signals or explicit escalation |
| QUAL-09 | SATISFIED | `qualityMs`/`qualityTokens` omission rule; real producers exercise the ledger; negative control against cost leaking to a later turn |

No orphaned requirements found — QUAL-03 and QUAL-08 are correctly attributed to Phase 9 in REQUIREMENTS.md, and GATE-07 is correctly attributed to Phase 6, matching the phase's own declared scope.

### Anti-Patterns Found

Scanned every `.ts` file touched between the phase-8 start commit (`0f929a5~1`) and `HEAD`. Only two files contain the strings `TODO`/`FIXME`/`XXX`: `.pi/extensions/quality/rules.ts` (the anti-pattern rule's own `SHIPPED_TODO_TOKENS`/`SHIPPED_TODO_PATTERN` definitions — this is the detector, not a debt marker) and `tests/integration/quality-gate-order.test.ts` (a doc comment naming the rule, not a marker). **No unresolved debt markers found in phase-8 code.** No blockers.

### Behavioral Spot-Checks / Direct Test Execution

| Check | Command | Result | Status |
|---|---|---|---|
| Typecheck clean | `npx tsc --noEmit` | zero output, exit 0 | ✓ PASS |
| Full suite green | `npx vitest run` | 108 files / 2016 tests, all passing | ✓ PASS |
| Phase 8 test files (11 files) run in isolation | `npx vitest run tests/unit/workflow-budgets.test.ts tests/unit/docs-policy.test.ts tests/unit/tool-count-baseline.test.ts tests/unit/contributing-boundary.test.ts tests/integration/quality-gate-order.test.ts tests/integration/reviewer-calibration.test.ts tests/integration/refute-or-promote.test.ts tests/integration/reviewer-contract.test.ts tests/integration/advisor-consult.test.ts tests/integration/gate10-nested-thinking.test.ts tests/integration/qoder-delegate.test.ts` | 275/275 tests passing | ✓ PASS |
| Calibration produces reproducible 2/6 | `npx vitest run tests/integration/reviewer-calibration.test.ts --reporter=verbose` | `catchRate === 2/6 (0.333...)`, reproducibility test passes, all 5 controls score 0 | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventional probes found for this phase, and none declared in the 13 PLAN files. SKIPPED — no probe-based verification mechanism applies to this phase (it is verified via `vitest` and direct `tsc`, not shell probes).

### Human Verification Required

### 1. RB-08-01 — main-loop thinking budgets land on the wire

**Test:** On the work laptop, with usable live provider credentials, run one real turn per provider (openai-completions and bedrock-converse-stream) and read the wire dump.
**Expected:** The thinking/reasoning parameter reaches `pi.setModel()`'s own dispatch, matching the shape the nested-role fix (`buildNestedApiOptions`) established.
**Why human:** Requires live provider inference. This dev machine holds live static IAM admin credentials and must not issue provider inference requests. Pre-authorised as OUTSTANDING for this run per the task's explicit instruction — not a gap.

### 2. RB-08-02 — LSP gate leg against a real language server

**Test:** Install `@narumitw/pi-lsp`, start a session with a TypeScript language server, seed a real type error, run `/quick`.
**Expected:** The LSP leg reports `FAIL` carrying the real diagnostic, never `UNAVAILABLE`.
**Why human:** `@narumitw/pi-lsp` has never been installed (Phase 7 installed nothing, per `docs/EXTENSIONS.md`). Pre-authorised as OUTSTANDING for this run — not a gap.

### 3. RB-08-03 — reviewer through a real subagent spawn, and a live calibration run

**Test:** Install `pi-subagents`, wire `.pi/agents/reviewer.md` into `AGENT_NAME_BY_ROLE`, spawn it on a real diff, then run the seeded-defect corpus through the live reviewer.
**Expected:** A real, non-scripted `CalibrationResult`, expected to differ from the scripted 2/6.
**Why human:** Needs `pi-subagents` actually installed (never installed) and a live model credential. Pre-authorised as OUTSTANDING for this run — not a gap.

### Gaps Summary

No gaps found. All artifacts exist, are substantive (200-889 lines each, well past stub thresholds), are wired into `/quick` and each other as claimed, and are exercised by passing tests I ran directly rather than trusting SUMMARY.md's report of them. The phase's three explicitly-stated obligations (RED-before-fix Bedrock defect, root-cause qoder-delegate de-flake with no prohibited mechanisms, and a reproducible honest 2/6 = 0.333 calibration number consistent across all documents) were each independently re-derived from the codebase and confirmed. The three RUNBOOK entries (RB-08-01/02/03) are correctly OUTSTANDING and pre-authorised for this run per the task's own instructions — they are not scored as gaps. QUAL-03, QUAL-08, and GATE-07 are correctly out of this phase's scope, attributed to Phase 9 and Phase 6 respectively in REQUIREMENTS.md, matching the phase's own declared requirement list. Status is `human_needed` rather than `passed` solely because three roadmap-mandated live checks remain outstanding by design — this is the expected, correctly-documented end state for this phase, not a failure.

---

_Verified: 2026-08-15T18:10:00Z_
_Verifier: Claude (gsd-verifier)_
