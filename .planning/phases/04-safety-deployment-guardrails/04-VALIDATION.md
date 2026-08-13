---
phase: 4
slug: safety-deployment-guardrails
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (matches Pi core exactly — already installed) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (655 tests green at Phase 3 close) |

Additional gate, run alongside the suite: `npm run typecheck` (`tsc --noEmit`).

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm test` **and** `npm run typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

*Populated by the planner. Every SAFE requirement must appear in at least one row, and every row must name an automated command or be listed under Manual-Only Verifications below.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| — | — | — | SAFE-02..SAFE-15, SAFE-17 | see PLAN `<threat_model>` | see PLAN | unit / session / e2e | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `unbash@4.0.10` added to `dependencies` (runtime dep — Pi installs with `npm install --omit=dev`, so it cannot be a devDependency)
- [ ] `tests/fixtures/evasion-corpus.ts` — the ≥30-case SAFE-17 corpus as data, consumed by both the guard tests and the SAFE-15 docs test
- [ ] Reuse existing helpers rather than adding parallel ones: `tests/helpers/git.ts` (SAFE-01 offline proxy, SAFE-04 `HEAD == main`), `tests/helpers/stub-bin.ts` (PATH-shadowing cases), `tests/helpers/win-quote.ts` (quoting cases), `tests/helpers/pi.ts` (`--mode json` end-to-end), `tests/helpers/session.ts` + `faux.ts` (session layer), `tests/helpers/logs.ts` (audit JSONL assertions)
- [ ] Wave-0 spike (flagged `[ASSUMED]` in RESEARCH.md): prove the user-scope extension load mechanism actually loads under jiti on Windows. If it does not, SAFE-11/SAFE-12 need a different mechanism and the plan must branch before Wave 1.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A push to a protected GitLab branch is rejected server-side | SAFE-01 | No GitLab access, no work-laptop credentials and no network egress from this machine. Server-side enforcement cannot be simulated — only its rejection *parsing* can. | `docs/RUNBOOK.md` → `RB-04-xx`, status **OUTSTANDING**. Offline proxy: local bare repo with a rejecting `pre-receive` hook, proving the harness parses the rejection. The live check stays OUTSTANDING until run on the work laptop. |

Everything else in Phase 4 is `[FAUX]` and must be planned as **passing**, not outstanding.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, never bare `vitest`)
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
