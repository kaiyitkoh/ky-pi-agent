---
phase: 12
slug: openspec-opt-in-skill
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-13
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 12-RESEARCH.md "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo pin) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <file> --maxWorkers=2` |
| **Full suite command** | `npx vitest run --maxWorkers=2` (ONCE, at verification) |
| **Estimated runtime** | targeted ~5-30 s; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** the single targeted test file for the task
- **After every plan wave:** the wave's targeted files, sequentially (no concurrent runs)
- **Before verification:** full suite once, green apart from documented flake `audit-concurrency`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Criterion | Behavior | Test Type | Automated Command | File Exists | Status |
|-----------|----------|-----------|-------------------|-------------|--------|
| OSPEC-1 | Exact pin, `--ignore-scripts`, equals RUNBOOK version, no repo dependency | integration | `npx vitest run tests/integration/openspec-setup.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| OSPEC-1 | Telemetry/update-check env defaults set by harness | unit | `npx vitest run tests/unit/openspec-env.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| OSPEC-2 | Patched skills load, absent from prompt index; unpatched present (negative control) | unit | `npx vitest run tests/unit/openspec-skills.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| OSPEC-2 | System prompt byte-identical with/without the user-level skills | integration | `npx vitest run tests/integration/openspec-zero-cost.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| OSPEC-2 | Budget tests unchanged | regression | `npx vitest run tests/unit/tool-count-baseline.test.ts --maxWorkers=2` | ✅ | ⬜ pending |
| OSPEC-3 | `openspec` classification rows | unit | `npx vitest run tests/unit/infra-policy.test.ts --maxWorkers=2` | ✅ extend | ⬜ pending |
| OSPEC-3 | Full evaluate incl. wrappers | unit | `npx vitest run tests/unit/policy-compose.test.ts --maxWorkers=2` | ✅ extend | ⬜ pending |
| OSPEC-3 | `openspec/` ignored and untracked | unit | `npx vitest run tests/unit/gitignore-policy.test.ts --maxWorkers=2` | ✅ extend | ⬜ pending |
| OSPEC-4 | RB-12-xx registered; docs pin rejection + upgrade/uninstall | unit | `npx vitest run tests/unit/docs-policy.test.ts --maxWorkers=2` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/openspec-setup.sh` + `tests/integration/openspec-setup.test.ts` (stub CLI)
- [ ] `tests/unit/openspec-skills.test.ts`, `tests/integration/openspec-zero-cost.test.ts`, `tests/unit/openspec-env.test.ts`
- [ ] `createHarnessSession` option `agentSkills`
- [ ] `PHASE_TWELVE_IDS` / `ENTRY_COMMANDS` rows in `tests/unit/docs-policy.test.ts`

Each new test states a negative control that fails when its subject is removed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real CLI version + telemetry disabled in real config | OSPEC-1 | needs installed global CLI | RB-12-01 / RB-12-03 |
| Real Pi session shows 0-char skills slice and `/skill:openspec-*` expands | OSPEC-2 | needs interactive Pi + credentials | RB-12-02 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
