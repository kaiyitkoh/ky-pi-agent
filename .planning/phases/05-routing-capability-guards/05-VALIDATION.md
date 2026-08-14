---
phase: 5
slug: routing-capability-guards
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` § Validation Architecture (lines 729-771).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (pinned, matches Pi core) |
| **Config file** | none — `package.json#scripts.test` = `vitest run` |
| **Quick run command** | `npx vitest run tests/unit/<file>.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | full suite ~1180 tests; per-file quick runs are seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/<touched-file>.test.ts` (and `tests/integration/<touched-file>.test.ts` where applicable)
- **After every plan wave:** Run `npx vitest run` (full suite)
- **Before `/gsd:verify-work`:** Full suite green AND `npx tsc --noEmit` clean
- **Max feedback latency:** < 60 seconds for quick runs

---

## Per-Task Verification Map

Filled in by the planner as tasks are assigned. The requirement→observable→command mapping below is binding.

| Requirement | Observable (what is actually asserted) | Test Type | Automated Command | File Exists | Status |
|-------------|----------------------------------------|-----------|-------------------|-------------|--------|
| ROUTE-01 | Role→model map covers executor, planner, reviewer, advisor, vision, summariser for all three modes; no auto-classification path exists | unit | `npx vitest run tests/unit/routing-map.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-02 | `/cheap`/`/balanced`/`/max` call `waitForIdle` then `setModel`; a `false` return is surfaced as a refusal, not swallowed | session (`withFauxSession`) | `npx vitest run tests/integration/mode-switch.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-03 | `/escalate` state is readable and remains set across turns until explicitly cleared | session | `npx vitest run tests/integration/escalate.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-04 | Nested call emits a `kind:"nested"` turns row AND `ctx.model` is unchanged after it; per-call reasoning effort reaches the payload | session | `npx vitest run tests/integration/single-shot-roles.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-05 | The written `settings.subagents.agentOverrides` JSON has the expected shape and pins child models explicitly | unit | `npx vitest run tests/unit/agent-overrides.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-06 | Pure predicate over `Model<Api>` fixtures: image→`input:["text"]` refused with a reason; oversized context→small `contextWindow` refused with a reason | unit | `npx vitest run tests/unit/capability-guard.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-07 | Bedrock + non-Claude + thinking-enabled is refused; the predicate is re-implemented locally (pi-ai does not export `isAnthropicClaudeModel`) and its test pins the behaviour, not Pi's internals | unit | `npx vitest run tests/unit/capability-guard.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-08 | Explicit model-id deny-list including both `deepseek.r1-v1:0` and `us.deepseek.r1-v1:0` refuses the executor/tool-loop role — **`Model<TApi>` carries no tool-support field, so a catalogue predicate is impossible** | unit | `npx vitest run tests/unit/capability-guard.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-09 | The `ky:mode` entry payload appears in **NO** outgoing request (captured via `wrapFauxWithPayload`), and `getBranch()` after a simulated restart yields the mode entry; the executor model itself is carried by Pi's native `model_change` entry — verify, do not re-build | session | `npx vitest run tests/integration/mode-persistence.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-10 | **The wire record**, read back from `wire-*.jsonl` / `turns-*.jsonl` via `readTornSafe`, names the intended model. NOT a spy on `setModel` — a spy proves intent, the wire record proves service | session | `npx vitest run tests/integration/wire-proof.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-11 (FAUX half) | Delegate tool creates a session, posts a `user.message` event, parses the SSE `event_start`/`event_delta`/`session.status_idle` envelope from a loopback fixture, and folds the result back as tool content; missing `QODER_PERSONAL_ACCESS_TOKEN` fails with a clear message | integration (loopback HTTP+SSE fixture) | `npx vitest run tests/integration/qoder-delegate.test.ts` | ❌ W0 | ⬜ pending |
| ROUTE-11 (RUNBOOK half) | A real PAT reaches `api.qoder.com` and a delegated result folds back | **manual, work laptop only** | `docs/RUNBOOK.md` → `RB-05-01` | N/A | ⬜ **OUTSTANDING by construction** |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/routing-map.test.ts` — ROUTE-01
- [ ] `tests/integration/mode-switch.test.ts` — ROUTE-02
- [ ] `tests/integration/escalate.test.ts` — ROUTE-03
- [ ] `tests/integration/single-shot-roles.test.ts` — ROUTE-04
- [ ] `tests/unit/agent-overrides.test.ts` — ROUTE-05
- [ ] `tests/unit/capability-guard.test.ts` — ROUTE-06 / ROUTE-07 / ROUTE-08
- [ ] `tests/integration/mode-persistence.test.ts` — ROUTE-09
- [ ] `tests/integration/wire-proof.test.ts` — ROUTE-10
- [ ] `tests/integration/qoder-delegate.test.ts` — ROUTE-11 `[FAUX]` half
- [ ] `docs/RUNBOOK.md` `RB-05-01` + the matching `tests/unit/docs-policy.test.ts` additions — ROUTE-11 `[RUNBOOK]` half

**No new test framework install needed** — vitest is already configured and used identically by Phases 2-4. Existing helpers `tests/helpers/{faux,session,models,logs,loopback,pi}.ts` cover the fixtures; extend rather than replace.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Qoder accepts a delegated task and folds the result back | ROUTE-11 | **No `QODER_PERSONAL_ACCESS_TOKEN`, no work-laptop credentials and no network egress on this machine.** Its offline proxy (the loopback SSE fixture) proves the harness *parses* a delegated result; only the live check proves a real PAT reaches `api.qoder.com`. | `docs/RUNBOOK.md` → `RB-05-01`, four-part contract. Status **OUTSTANDING** in BOTH the summary-table row and the `**Status:**` line — `tests/unit/docs-policy.test.ts` reports `INCONSISTENT` if only one is flipped. |

Everything else in this phase is `[FAUX]` and must be planned as **passing**, not outstanding.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run`, never bare `vitest`)
- [x] Feedback latency < 60s for quick runs
- [x] ROUTE-10's assertion reads the **wire record**, not a `setModel` spy — `05-11-PLAN.md` additionally forbids a `setModel` spy by grep
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-14 — verified by `gsd-plan-checker` against all 12 plans (`## VERIFICATION PASSED`, 0 blockers). `wave_0_complete` stays `false` until execution actually creates the Wave 0 test files.
