---
phase: 10
slug: context-budget-progressive-disclosure
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-13
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 10-RESEARCH.md "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <file> --maxWorkers=2` |
| **Full suite command** | `npx vitest run --maxWorkers=2` (ONCE, at verification; `audit-concurrency` is a known flake) |
| **Estimated runtime** | targeted ~10-40 s; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the one targeted test file for that task, `--maxWorkers=2`
- **After every plan:** the plan's touched test files in one sequential invocation + `npx tsc --noEmit` once
- **Before `/gsd:verify-work`:** full suite once, green apart from the known flake
- **CPU rule:** never concurrent test runs; sequential plan execution

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| CTX-01 | Profile declared tools equal table; narrowing at session_start writes no `toolsRemoved`; every registered tool classified | faux integration | `npx vitest run tests/integration/tool-profiles.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| CTX-02 | `context` handler cannot strip tools; `context_with_system` can (negative control); lint forbids it in tracked source | faux + unit | `npx vitest run tests/integration/context-hook-tools.test.ts tests/unit/context-hook-lint.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| CTX-03 | AGENTS.md, rendered block, comment-rule block under budget; over-budget fixture fails | unit | `npx vitest run tests/unit/agents-md-budget.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| CTX-04 | System prompt byte-equal over turns with moved clock; negative control fails; snippet/guideline lint | faux + unit | `npx vitest run tests/integration/prompt-stability.test.ts tests/unit/prompt-metadata-lint.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| CTX-05 | Experiment plan balance/determinism, scoring, decision rule | unit + faux | `npx vitest run tests/unit/ctx-experiment.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| CTX-06 | Per-extension deltas close on composed floor; per-profile ceilings; `/budget` floor line | faux + unit | `npx vitest run tests/integration/context-floor.test.ts tests/unit/budget-command.test.ts --maxWorkers=2` | partial | ⬜ pending |
| all | Runbook ids governed; tool baseline/allowlist updated | unit | `npx vitest run tests/unit/docs-policy.test.ts tests/unit/tool-count-baseline.test.ts tests/unit/contributing-boundary.test.ts --maxWorkers=2` | ✅ (edit) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/helpers/harness-session.ts` — composed faux session with all-tools option and profile option
- [ ] New test files listed above, each with a stated mutation proof (remove subject -> fails)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live minimal-vs-full experiment | CTX-05 | Needs provider credentials | RB-10-01 (OUTSTANDING) |
| Live prompt-cache hit check on DeepSeek/Bedrock | CTX-04 | Needs live provider | RB-10-02 (OUTSTANDING) |
| Per-turn cost of uninstalled pinned packages | CTX-06 | Packages not installed; executing them is out of policy | RB-10-03 (OUTSTANDING) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
