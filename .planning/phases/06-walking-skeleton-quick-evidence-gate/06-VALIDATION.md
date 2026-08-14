---
phase: 6
slug: walking-skeleton-quick-evidence-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `06-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (already configured — matches Pi core's pin) |
| **Config file** | `vitest.config.ts` — `setupFiles` already includes `tests/setup/agent-dir.ts`, which forces `PI_CODING_AGENT_DIR` away from the developer's real `~/.pi/agent/` (Phase 5 review fix; **reuse it, do not re-solve it**) |
| **Quick run command** | `npx vitest run tests/unit/<file>.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | full suite ~ the Phase 1–5 baseline (1,376 tests green); targeted files < 10s |

CI already fails the build on a red vitest run — `.github/workflows/ci.yml:181` runs `npx vitest run` on `windows-latest` and `macos-latest`, plus `npx tsc --noEmit` at :201. **That is FLOW-11's enforcement mechanism. Do not add a second one.**

---

## Sampling Rate

- **After every task commit:** Run the targeted `npx vitest run <file>` for the file the task touched
- **After every plan wave:** Run `npx vitest run` (full suite) **and** `npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green and typecheck clean
- **Max feedback latency:** < 30 seconds for targeted runs

---

## Per-Task Verification Map

Populated by the planner/executor as tasks are written. Every row must name a real command that is actually run, not a description of one.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | FLOW-01 | — | `/quick` refuses rather than degrades when routing/guard says no | session | `npx vitest run tests/integration/quick-workflow.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | FLOW-11 | — | An unlisted or over-budget workflow file fails the build | unit | `npx vitest run tests/unit/workflow-budgets.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | GATE-07 | — | Fabricated / stale-SHA / non-zero evidence is rejected | unit + session | `npx vitest run tests/unit/evidence-gate.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/workflow-budgets.test.ts` — FLOW-11. Must assert **both** directions: an over-budget listed file fails, **and** a workflow file absent from the registry fails (registry completeness). Without the second assertion Phase 9 can add a 1,169-line workflow the test never looks at.
- [ ] `tests/unit/evidence-gate.test.ts` — GATE-07's pure predicate: three rejections (fabricated prose with no structured result; real structured result bound to a **stale** SHA; real structured result with a failing/`isError` outcome) and exactly one acceptance.
- [ ] `tests/integration/quick-workflow.test.ts` — FLOW-01 end to end. Needs the safety extension loaded at **USER scope** (project scope resolves `trusted:false` headless — the Phase 4 "guard absent headless" finding). Reuse the existing session/spawned-`pi` helper pattern; do not invent a third.
- [ ] A git-SHA reader. **SEAM RISK from research: none exists in this repo today** — `safety/git.ts` has `currentBranch` only. Decide in the plan whether `currentSha(cwd)` lands in `.pi/extensions/safety/git.ts` (production, needed by the evidence-capture path at runtime) or `tests/helpers/git.ts` (tests only), following the identical `spawnSync(["git","rev-parse","HEAD"], {shell:false})` pattern already used by `currentBranch`.

---

## Manual-Only Verifications

None. **Phase 6 has no `[RUNBOOK]` requirements** — all three requirements are verifiable offline on this machine with `fauxProvider`, `tests/helpers/git.ts` temp repos and PATH stubs. No credentials, no network. If a task wants to defer a check to `docs/RUNBOOK.md`, the task is building the wrong thing.

---

## Anti-Green Discipline (project-specific, non-negotiable)

Recent history: Phase 4's review needed six iterations and found 11 blockers including a guard entirely absent headless; Phase 5's found the suite writing into the developer's real `~/.pi/agent/settings.json` and a wire-proof test that structurally could not distinguish a routing decision from a hardcoded chain head.

Therefore, for **every** test written in this phase, the plan must record a one-line **mutation argument**: *"delete X → this test goes red"*. A test whose subject can be removed while it stays green does not count as coverage, and specifically:

- A `/quick` test that only asserts a commit appeared proves nothing about the Phase 4/5 seams. The load-bearing tests are the ones that **break the seam and watch `/quick` refuse**.
- An evidence-gate test whose SHA is a fixture constant cannot distinguish "bound correctly" from "bound to nothing". Use a real temp repo and a real `git rev-parse`.

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify command or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references above
- [ ] No watch-mode flags (`vitest run`, never `vitest`)
- [ ] Feedback latency < 30s for targeted runs
- [ ] Every test carries a recorded mutation argument
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
