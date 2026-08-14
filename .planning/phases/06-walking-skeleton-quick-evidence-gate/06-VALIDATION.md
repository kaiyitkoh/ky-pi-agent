---
phase: 6
slug: walking-skeleton-quick-evidence-gate
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-14
updated: 2026-08-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `06-RESEARCH.md` § Validation Architecture. Per-task map populated at planning time
> from `06-01-PLAN.md` … `06-04-PLAN.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (already configured — matches Pi core's pin) |
| **Config file** | `vitest.config.ts` — `setupFiles` already includes `tests/setup/agent-dir.ts`, which forces `PI_CODING_AGENT_DIR` away from the developer's real `~/.pi/agent/` (Phase 5 review fix; **reuse it, do not re-solve it**) |
| **Quick run command** | `npx vitest run tests/unit/<file>.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | full suite ~ the Phase 1–5 baseline (1,346 tests green); targeted files < 10s |

CI already fails the build on a red vitest run — `.github/workflows/ci.yml:181` runs `npx vitest run` on `windows-latest` and `macos-latest`, plus `npx tsc --noEmit` at :201. **That is FLOW-11's enforcement mechanism. Do not add a second one.**

---

## Sampling Rate

- **After every task commit:** Run the targeted `npx vitest run <file>` for the file the task touched
- **After every plan wave:** Run `npx vitest run` (full suite) **and** `npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green and typecheck clean
- **Max feedback latency:** < 30 seconds for targeted runs

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T1 `currentSha` + repo helpers | 06-01 | 1 | GATE-07 | T-06-05 | Fixed argv, `shell:false`, throws rather than returning a spoofable sentinel | unit | `npx vitest run tests/unit/evidence-gate.test.ts` | ❌ W0 | ⬜ pending |
| T2 `workflows/evidence.ts` | 06-01 | 1 | GATE-07 | T-06-01, T-06-04 | Verdict from Pi-computed `isError` only; row fields named, redacted, gitignored | unit | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| T3 evidence-gate table | 06-01 | 1 | GATE-07 | T-06-01, T-06-02 | 3 rejections + 1 acceptance against two real SHAs; 4 mutations executed | unit | `npx vitest run tests/unit/evidence-gate.test.ts` | ❌ W0 | ⬜ pending |
| T1 `docs/WORKFLOWS.md` | 06-02 | 2 | FLOW-01 | — | Counting rule and header exception stated, not left to review | unit | `npx vitest run tests/unit/docs-policy.test.ts` | ✅ | ⬜ pending |
| T2 `/quick` command | 06-02 | 2 | FLOW-01, GATE-07 | T-06-07, T-06-08, T-06-09 | No process spawn in `/quick`; refusal reasons passed through untouched | unit (policy) | `npx vitest run tests/unit/extension-layout.test.ts tests/unit/contributing-boundary.test.ts tests/unit/chokepoint-lint.test.ts` | ✅ | ⬜ pending |
| T1 budget registry | 06-03 | 3 | FLOW-11, FLOW-01 | T-06-13, T-06-14 | Raw-line count; `/quick` ceiling asserted separately; directory aggregate ratchet | unit | `npx vitest run tests/unit/workflow-budgets.test.ts` | ❌ W0 | ⬜ pending |
| T2 registry completeness | 06-03 | 3 | FLOW-11 | T-06-12 | Present-but-undeclared AND declared-but-absent both fail; markdown dodge closed | unit | `npx vitest run tests/unit/workflow-budgets.test.ts` | ❌ W0 | ⬜ pending |
| T1 refusal seams | 06-04 | 3 | FLOW-01 | T-06-18, T-06-19 | Refusals carry the real functions' own wording at zero provider cost | session | `npx vitest run tests/integration/quick-workflow.test.ts` | ❌ W0 | ⬜ pending |
| T2 evidence seams | 06-04 | 3 | GATE-07, FLOW-01 | T-06-17, T-06-19, T-06-20 | Fabricated transcript rejected; real guarded commit accepted at a test-read SHA | session | `npx vitest run tests/integration/quick-workflow.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/evidence-gate.test.ts` — 06-01 T3. GATE-07's pure predicate: three rejections (fabricated/no record; stale SHA; `isError`) and exactly one acceptance, all against real repository SHAs.
- [ ] A git-SHA reader — 06-01 T1. **Decided:** `currentSha(cwd)` lands in `.pi/extensions/safety/git.ts` (production needs it at capture time), throwing on failure because no safe default exists for an unknown SHA. Temp-repo helpers (`makeTempRepo`, `commitFile`, `headSha`) land in `tests/helpers/git.ts`.
- [ ] `tests/unit/workflow-budgets.test.ts` — 06-03. Both directions, plus a `.pi/extensions/workflows/` aggregate ratchet that closes the offloading loophole.
- [ ] `tests/integration/quick-workflow.test.ts` — 06-04. Safety, workflows and (case 4) diagnostics loaded at **USER scope** through one inline composite `extensionSource`, per `double-enforcement.test.ts`'s pattern. No spawned `pi` child is needed — that file already proves in-process faux sessions execute tools and enforce the guard for real.

---

## Manual-Only Verifications

None. **Phase 6 has no `[RUNBOOK]` requirements.** No plan appends an `RB-06-xx` entry; `docs/RUNBOOK.md` and `tests/unit/docs-policy.test.ts` are untouched, and each plan carries that as an acceptance criterion.

---

## Anti-Green Discipline (project-specific, non-negotiable)

Recent history: Phase 4's review needed six iterations and found 11 blockers including a guard entirely absent headless; Phase 5's found the suite writing into the developer's real `~/.pi/agent/settings.json` and a wire-proof test that structurally could not distinguish a routing decision from a hardcoded chain head.

Every test task in this phase carries explicit mutation arguments as acceptance criteria — 4 in 06-01, 3 recorded in 06-02 and exercised in 06-04, 7 in 06-03, 6 in 06-04. Each must be **executed and its output recorded in the plan SUMMARY**, not merely asserted in prose. A mutation that fails to compile proves nothing and looks identical to one that passed (STATE.md, Phase 3 plan 03-10) — confirm each mutated run actually executed the tests.

Specifically:
- `/quick`'s refusal wording is computed in the test by calling the real `planRoleCall` / `classifyGitInvocation`; a retyped literal would stay green against a hardcoded refusal.
- Every refusal also asserts `faux.state.callCount === 0` — the difference between refusing and reporting.
- The evidence gate's SHAs come from a real temp repo and a real `git rev-parse HEAD`; no 40-hex literal appears in any test file.
- The budget test's markdown dodge (`.pi/prompts/*.md`) is proven closed by an executed falsification, not assumed.

---

## Validation Sign-Off

- [x] All tasks have an `<automated>` verify command or a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all MISSING references above
- [x] No watch-mode flags (`vitest run`, never `vitest`)
- [x] Feedback latency < 30s for targeted runs
- [x] Every test carries a recorded mutation argument
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-08-14 (autonomous run; user asleep, per STATE.md Standing Operating Policy item 3)
