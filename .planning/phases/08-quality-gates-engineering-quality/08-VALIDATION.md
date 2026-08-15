---
phase: 8
slug: quality-gates-engineering-quality
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-15
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `08-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (matches Pi core exactly; the project standard since Phase 1) |
| **Config file** | `vitest.config.ts` (existing) — `testTimeout`/`hookTimeout` 120_000, `pool:"forks"` by default, `globalSetup` dirty-tracked-file tripwire, `setupFiles` real-agent-dir tripwire |
| **Quick run command** | `npx vitest run tests/unit` |
| **Full suite command** | `npx vitest run && npx tsc --noEmit` |
| **Estimated runtime** | ~2–3 minutes (1,791 tests green at Phase 7 close, 97 test files) |

**Standing constraints on every test written in this phase:**

- **Every test must be shown to FAIL if its subject is removed.** This is the binding lesson of Phases 3–7 and it applies with maximum force here, because *this phase's entire subject is tests that cannot fail*. Phase 7's review found a test **labelled "MUTATION-VERIFIED" that survived its own mutation**. A control assertion ships with the case that must fail (`CONTRIBUTING.md` § Repo rules) — one-sided tests certify nothing.
- **No test may write outside the repo or a temp dir.** Enforced structurally by `tests/setup/agent-dir.ts`; do not weaken it.
- **No test may issue a provider inference request** and **no test may execute a `[RUNBOOK]` item.** The dev machine holds live static IAM admin credentials in plaintext (see § Security below). Everything is proved through `fauxProvider` and temp git repos.
- **No test may install a package.** Nothing in `.pi/settings.json` `packages[]` is installed; tests must not change that.
- **Seeded-defect fixtures are applied to a `makeTempRepo()` clone, never to this repository's working tree.**

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/unit`
- **After every plan wave:** `npx vitest run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite green, including the previously-flaky integration test
- **Max feedback latency:** ~30 seconds for the unit quick-run

**Additional gate unique to this phase:** the full suite must be green **across repeated runs**, not once. `tests/integration/qoder-delegate.test.ts` has been red roughly 1 run in 5; a single green run is not evidence that it was fixed. The plan must state the repetition count it treats as proof.

---

## Per-Task Verification Map

Per-task rows are populated at execution time. Requirement-level coverage:

| Requirement | Behavior proven | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| GATE-01 | Deterministic gates run **before** any model review, in order, feeding errors back; each leg reports PASS/FAIL/**UNAVAILABLE** | unit + integration | `npx vitest run tests/unit/quality-gates.test.ts tests/integration/quality-gate-order.test.ts` | ❌ W0 | ⬜ pending |
| GATE-02 | The full reviewer contract (diff + full file contents + test/typecheck output + requirements + files-touched union + import graph) actually reaches the nested call | integration | `npx vitest run tests/integration/reviewer-contract.test.ts` | ❌ W0 | ⬜ pending |
| GATE-03 | Per-requirement verdict Implemented/Partial/Missing with `file:line` | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "verdict"` | ❌ W0 | ⬜ pending |
| GATE-04 | Mandatory non-empty "checked and cleared" section; silence structurally impossible | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "checked and cleared"` | ❌ W0 | ⬜ pending |
| GATE-05 | Unclassified findings **rejected as malformed by code**, both directions | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "malformed"` | ❌ W0 | ⬜ pending |
| GATE-06 | Refute-or-promote runs before a BLOCKER can stop work; BLOCKERs only | integration | `npx vitest run tests/integration/refute-or-promote.test.ts` | ❌ W0 | ⬜ pending |
| GATE-08 | Calibration reports a catch rate per defect class, **including the deliberately-blind-reviewer negative control that must report a LOW number** | integration | `npx vitest run tests/integration/reviewer-calibration.test.ts` | ❌ W0 | ⬜ pending |
| GATE-09 | Executor consults a stronger model at a decision point through `callModel()` | integration | `npx vitest run tests/integration/advisor-consult.test.ts` | ❌ W0 | ⬜ pending |
| GATE-10 (nested) | Per-`model.api` option shape is correct — OpenAI-completions vs Bedrock — asserted on the **outgoing** request | unit + integration | `npx vitest run tests/unit/routing-dispatch.test.ts tests/integration/gate10-nested-thinking.test.ts` | ✅ extend / ❌ W0 | ⬜ pending |
| GATE-10 (main loop) | **[RUNBOOK] — `RB-08-xx`, OUTSTANDING.** Never passing offline. | manual | — | n/a | ⬜ outstanding |
| QUAL-01 | Six anti-pattern rules, positive **and** negative per rule, plus a false-positive check against real repo files | unit | `npx vitest run tests/unit/quality-gates.test.ts -t "QUAL-01"` | ❌ W0 | ⬜ pending |
| QUAL-02 | No model round trip (structural assertion) and wall-clock under a **stated, measured** budget | unit | `npx vitest run tests/unit/quality-gates.test.ts -t "QUAL-02"` | ❌ W0 | ⬜ pending |
| QUAL-04 | Every change classified root-cause / symptomatic / workaround with justification, on the existing review pass | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "classification"` | ❌ W0 | ⬜ pending |
| QUAL-05 | symptomatic/workaround **stops** the workflow pending explicit approval | integration | `npx vitest run tests/integration/quality-gate-order.test.ts -t "stop"` | ❌ W0 | ⬜ pending |
| QUAL-06 | Approved workaround recorded with the proper fix and why it was deferred | unit | `npx vitest run tests/unit/quality-schema.test.ts -t "workaround"` | ❌ W0 | ⬜ pending |
| QUAL-07 | Design review fires **conditionally** on signals or `/escalate`, never on every task | unit | `npx vitest run tests/unit/quality-gates.test.ts -t "QUAL-07"` | ❌ W0 | ⬜ pending |
| QUAL-09 | Quality-layer wall-clock and token cost recorded per turn in JSONL, **honouring the omission rule** (absent, never `0`) | unit + integration | `npx vitest run tests/unit/turn-row.test.ts tests/integration/turns-log.test.ts -t "quality"` | ✅ extend | ⬜ pending |
| (regression) | `tests/integration/qoder-delegate.test.ts` is deterministic — no wall-clock margin assertion remains | integration | `npx vitest run tests/integration/qoder-delegate.test.ts` (repeated) | ✅ fix | ⬜ pending |
| (boundary) | Tool-count baseline and boundary allowlist updated **only if** a tool is genuinely registered | unit | `npx vitest run tests/unit/contributing-boundary.test.ts tests/unit/tool-count-baseline.test.ts` | ✅ extend | ⬜ pending |
| (runbook) | `RB-08-xx` dual-status consistent across summary table and detail subsection | unit | `npx vitest run tests/unit/docs-policy.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/quality-gates.test.ts` — QUAL-01 (six rules, positive + negative + suppression), QUAL-02 (wall-clock budget + structural no-round-trip), QUAL-07 (conditional-fire predicate), GATE-01 (per-leg PASS/FAIL/UNAVAILABLE)
- [ ] `tests/unit/quality-schema.test.ts` — GATE-03/04/05, QUAL-04/06; the REVIEW artifact validator, **both directions**
- [ ] `tests/integration/quality-gate-order.test.ts` — GATE-01 ordering, QUAL-05 stop-the-workflow
- [ ] `tests/integration/reviewer-contract.test.ts` — GATE-02
- [ ] `tests/integration/refute-or-promote.test.ts` — GATE-06
- [ ] `tests/integration/reviewer-calibration.test.ts` — GATE-08 **including the blind-reviewer negative control**
- [ ] `tests/integration/advisor-consult.test.ts` — GATE-09
- [ ] `tests/integration/gate10-nested-thinking.test.ts` — GATE-10 nested, with faux providers registered under **both** api ids, asserting the api-appropriate field name on each. **This test must be shown to FAIL against today's `modes.ts:409` before the fix lands.**
- [ ] `tests/fixtures/seeded-defects/` — GATE-08's corpus: one fixture per real failure class from `08-CONTEXT.md`, each an injectable diff with a known-correct expected finding
- [ ] Extend `.pi/extensions/routing/modes.ts` + `tests/unit/routing-dispatch.test.ts` — the per-api option-shape fix (Pitfall 1), a prerequisite for an honest GATE-10
- [ ] Extend `tests/unit/turn-row.test.ts` and `tests/integration/turns-log.test.ts` — QUAL-09
- [ ] Extend `tests/unit/docs-policy.test.ts` — `PHASE_EIGHT_IDS` into `ALL_IDS` plus `ENTRY_COMMANDS` rows, in the same change as the `RB-08-xx` entries
- [ ] Extend `tests/unit/contributing-boundary.test.ts` / `tests/unit/tool-count-baseline.test.ts` — **only if** a tool is genuinely registered

*No framework install is required — vitest and TypeScript are already pinned, and no new dependency may be added (`tests/unit/pinning.test.ts:253` asserts devDependencies is exactly six pins).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Main-loop thinking budgets land on the wire | GATE-10 (main-loop half) | Needs a real provider request; gated on `RB-02-01`, itself OUTSTANDING. The dev machine has no provider key and holds live admin credentials. | `RB-08-xx` in `docs/RUNBOOK.md`, marked **OUTSTANDING** — never flipped to passed without a human executing it |
| LSP diagnostics gate against a real language server | GATE-01 (LSP leg) | `@narumitw/pi-lsp@0.49.4` is pinned but **NOT INSTALLED** (`RB-07-02` OUTSTANDING). Offline the gate can only prove it reports UNAVAILABLE. | `RB-08-xx` in `docs/RUNBOOK.md`, marked **OUTSTANDING** |
| Reviewer running through a real `pi-subagents` spawn | GATE-02 | Same — nothing is installed. The contract itself is provable offline through `callModel()`; the spawn is not. | `RB-08-xx` in `docs/RUNBOOK.md`, marked **OUTSTANDING** |

**Rule for all three:** an offline proxy exists for each, and **not one of those proxies is the check.** Report them as OUTSTANDING, never as passed. `tests/unit/docs-policy.test.ts` enforces the dual-status consistency and reports `INCONSISTENT` if the summary table and the detail subsection disagree.

---

## Security Domain

**Standing fact governing every decision in this phase:** extensions execute arbitrary code with full user permissions on a machine holding **live static IAM admin credentials in plaintext** at `~/.aws/credentials` (`.planning/STATE.md` Blockers/Concerns; `aws sts get-caller-identity` exit 0 verified in Phase 7). The project's early "no credentials on the dev machine" premise is false.

ASVS L1; block on `high`.

| Threat | STRIDE | Mitigation |
|---|---|---|
| A model-authored `file:line` citation is later consumed as if it were tool-verified ground truth | Spoofing / Tampering | GATE-03's `file:line` is **evidence the model wrote**, not evidence the harness observed. It is not equivalent to `evidence.ts`'s `tool_result`-derived evidence, and the schema documentation must say so — mirroring `docs/WORKFLOWS.md`'s existing "what an ACCEPT does NOT guarantee" discipline |
| The advisor path becomes a second, uncoordinated route to a model, bypassing the diagnostics chokepoint | Elevation of Privilege / Repudiation | Already enforced: `tests/unit/chokepoint-lint.test.ts` build-fails any `modelRegistry.complete` outside `diagnostics/`. The advisor must call `runSingleShotRole`/`callModel`. No new control needed — only correct usage, and the lint must not be weakened or exempted |
| A QUAL-09 field silently reports `0` for a cost or latency never measured | Tampering (data integrity) | The omission rule (`docs/DIAGNOSTICS.md`: "a ratio of nothing is not zero") applies identically — omit the key, never zero-fill |
| A seeded-defect fixture ships as real code, introducing an actual swallowed-exception or shipped-TODO defect into `.pi/extensions/` | Tampering | Fixtures live under `tests/fixtures/seeded-defects/` and are only ever applied to a `makeTempRepo()` clone. QUAL-01's own rules must exempt `tests/fixtures/**` from their scan, or the corpus becomes un-shippable |
| The reviewer's context contract (diff + full file contents) carries secret-shaped content into a model request or a log | Information Disclosure | Reuse Phase 2's `redactDeep`/`redactString` (`.pi/extensions/diagnostics/redact.ts`). Never re-implement redaction |
| A new dependency is added to satisfy QUAL-01, pulling unreviewed code into the tool path next to live admin credentials | Supply chain / EoP | Structurally blocked: `tests/unit/pinning.test.ts:253` asserts devDependencies is exactly six pins. QUAL-01 uses the already-pinned TypeScript compiler API |

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify command or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s on the unit quick-run
- [ ] Every new test demonstrated to fail when its subject is removed
- [ ] The previously-flaky integration test is green across the stated repetition count
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
