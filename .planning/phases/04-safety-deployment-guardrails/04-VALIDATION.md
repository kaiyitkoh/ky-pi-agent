---
phase: 4
slug: safety-deployment-guardrails
status: approved
nyquist_compliant: true
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

Mapped at plan granularity. Each plan's own tasks carry the task-level `<verify><automated>` command — every task in all 12 plans has one, confirmed by `gsd-plan-checker` (Nyquist dimensions 8a-8d), with no `MISSING` references and no watch-mode flags. The per-task detail lives in the PLAN.md files rather than being duplicated here, so there is one source of truth.

| Plan | Wave | Requirements | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|------|------|--------------|------------|-----------------|-----------|-------------------|--------|
| 04-01 | 1 | SAFE-02, SAFE-11 | `<threat_model>` in 04-01 (incl. `T-04-SC` supply chain) | `unbash@4.0.10` pinned exactly, in `dependencies`; user-scope load mechanism proven or fallback taken | unit + spike | `npm run test:unit` | ⬜ pending |
| 04-02 | 1 | SAFE-14 | `<threat_model>` in 04-02 | Audit JSONL append-only; `safety/` reaches it without importing `diagnostics/` | unit | `npm run test:unit` | ⬜ pending |
| 04-03 | 2 | SAFE-02, SAFE-03 | `<threat_model>` in 04-03 | Wrappers resolved; denied AST node kinds refused — **not** an `errors.length` check | unit | `npm run test:unit` | ⬜ pending |
| 04-04 | 3 | SAFE-06, SAFE-08, SAFE-13 | `<threat_model>` in 04-04 | Path canonicalisation over `text` **and** `value`, both slash directions, `/c/`, `/cygdrive/c/`, UNC, `~`, `$HOME` | unit | `npm run test:unit` | ⬜ pending |
| 04-05 | 3 | SAFE-04, SAFE-05 | `<threat_model>` in 04-05 | Writes blocked at `HEAD == main`; `worktree add -b feat main` / `fetch` / `rebase` / `diff` / `log origin/main` explicitly allowed; `glab mr merge` refused | unit + integration | `npm test` | ⬜ pending |
| 04-06 | 3 | SAFE-07 | `<threat_model>` in 04-06 | `terraform apply\|destroy\|import`, mutating `aws`, `kubectl delete` confirm-gated; `aws sts get-caller-identity` / `aws s3 ls` allowed | unit | `npm run test:unit` | ⬜ pending |
| 04-07 | 4 | SAFE-03, SAFE-10 | `<threat_model>` in 04-07 | Decision function initialises to **block** and promotes to allow; no `hasUI`-conditioned allow | unit | `npm run test:unit` | ⬜ pending |
| 04-08 | 5 | SAFE-09, SAFE-10, SAFE-14 | `<threat_model>` in 04-08 | Enforcement at the `tool_call` hook **and** inside the wrapped tool; survives a mutated `event.input`; allow **and** block rows written | unit + integration | `npm test` | ⬜ pending |
| 04-09 | 6 | SAFE-10, SAFE-11 | `<threat_model>` in 04-09 | Installed at user scope by bootstrap; deny proven by a real `pi --mode json` subprocess | integration / e2e | `npm test` | ⬜ pending |
| 04-10 | 7 | SAFE-12, SAFE-14 | `<threat_model>` in 04-10 | Blocked command still blocked inside a real spawned child; allow row is the positive evidence the guard loaded; 4-process concurrent append holds | e2e | `npm test` | ⬜ pending |
| 04-11 | 8 | SAFE-15, SAFE-17 | `<threat_model>` in 04-11 | ≥30 cases, each BLOCKED or OUT-OF-SCOPE, driven through the real `evaluate()`; published table == the OUT-OF-SCOPE rows, no extras | unit | `npm run test:unit` | ⬜ pending |
| 04-12 | 9 | SAFE-01 | `<threat_model>` in 04-12 | `RB-04-01` appended, **OUTSTANDING** in both parsed places; offline proxy parses a real `pre-receive` rejection | unit + integration | `npm test` | ⬜ pending |

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — confirmed by `gsd-plan-checker` across all 12 plans
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — no `<automated>MISSING</automated>` references exist
- [x] No watch-mode flags (`vitest run`, never bare `vitest`)
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter
- [ ] `wave_0_complete` — flips at execution, not at planning

**Approval:** approved 2026-08-14 (plan-checker returned `## VERIFICATION PASSED`, 0 blockers, 0 warnings)
