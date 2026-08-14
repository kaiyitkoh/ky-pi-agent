---
phase: 7
slug: composed-extensions-pinned-reviewed
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-15
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `07-RESEARCH.md` § Validation Architecture (+ Addendum A1–A6).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (matches Pi core exactly; already the project standard since Phase 1) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run tests/unit/<new-file>.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~90 seconds (1,440 tests green at Phase 6 close) |

**Standing constraints on every test written in this phase:**
- **No test may write outside the repo or a temp dir.** Phase 5's review found the suite writing into the developer's real `~/.pi/agent/settings.json`. This phase's subject is *installing things*, so the risk is at its highest here.
- **Every test must be shown to FAIL if its subject is removed.** Phase 6's binding lesson. A test that passes vacuously — e.g. an exclusion glob matching nothing, or a `packages[]` assertion iterating an empty array — is the specific failure mode this phase is about.
- **No `npm install` / `pi install` may run inside a test.** `npm pack` + `tar -xf` is the sanctioned inspection technique.

---

## Sampling Rate

- **After every task commit:** Run the specific new test file for that task.
- **After every plan wave:** Run `npx vitest run tests/unit/ tests/integration/`
- **Before `/gsd:verify-work`:** `npx vitest run` full suite green **and** `npx tsc --noEmit` clean
- **Max feedback latency:** ~90 seconds (full suite)

---

## Per-Task Verification Map

| Requirement | Behavior proven | Test Type | Automated Command | File Exists | Status |
|---|---|---|---|---|---|
| EXT-01 | Shipped `.pi/agents/*.md` carry `thinking`/`tools`/`systemPromptMode` and **no `model:` key**; per-agent config is expressible | unit | `npx vitest run tests/unit/subagent-agents-config.test.ts` | ❌ W0 | ⬜ pending |
| EXT-02 | A real `git worktree add` lacks untracked `.env`/`node_modules`, and the configured setup hook remedies it so the worktree **builds** | integration | `npx vitest run tests/integration/worktree-build.test.ts` | ❌ W0 | ⬜ pending |
| EXT-03 | Background/async subagent path is configured and does not block | session-level (`fauxProvider`) | `npx vitest run tests/integration/subagent-background.test.ts` | ❌ W0 | ⬜ pending |
| EXT-04 | Mid-run steering delivers without killing the run | session-level | `npx vitest run tests/integration/subagent-steering.test.ts` | ❌ W0 | ⬜ pending |
| EXT-05 | All 8 capabilities resolve to an installed or vendored source | unit | `npx vitest run tests/unit/extension-composition.test.ts` | ❌ W0 | ⬜ pending |
| EXT-06 | Every capability covered by a bundled Pi example is sourced from it, not from npm | unit | `npx vitest run tests/unit/extension-composition.test.ts` | ❌ W0 | ⬜ pending |
| EXT-07 | Hardened checkpoint restores the working tree **headlessly** and captures untracked files | integration | `npx vitest run tests/integration/git-checkpoint.test.ts` | ❌ W0 | ⬜ pending |
| EXT-08 | `packages[]` matches the committed pin table; every spec pinned; no undeclared installed package | unit (imports `isPinnedPackageSpec`) | `npx vitest run tests/unit/extension-pins.test.ts` | ❌ W0 | ⬜ pending |
| EXT-09 | `RB-07-01` smoke ritual documented, dual-status consistent | unit | `npx vitest run tests/unit/docs-policy.test.ts` | ✅ extend | ⬜ pending |
| EXT-10 | No LICENSE-less package appears as an npm dependency; vendored copies present with provenance | unit | `npx vitest run tests/unit/vendor-license-audit.test.ts` | ❌ W0 | ⬜ pending |
| (baseline) | Tool-count baseline committed for Phase 10 | unit | `npx vitest run tests/unit/tool-count-baseline.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/helpers/worktree.ts` — new helper, sibling to `tests/helpers/git.ts`. `makeTempRepoWithNodeModulesAndEnv()`, `addWorktree()` wrapping `git worktree add` / `git worktree remove --force`. Shared by the EXT-02 test and any future subagent-worktree test.
- [ ] `tests/unit/extension-pins.test.ts` — EXT-08. **Must import `isPinnedPackageSpec` from `tests/unit/pinning.test.ts`** (Phase 1 exported it for exactly this; a second regex is how the two drift apart).
- [ ] `tests/unit/vendor-license-audit.test.ts` — EXT-10.
- [ ] `tests/unit/extension-composition.test.ts` — EXT-05 / EXT-06.
- [ ] `tests/unit/tool-count-baseline.test.ts` — the Phase 10 baseline (Addendum A4).
- [ ] `tests/unit/subagent-agents-config.test.ts` — EXT-01, including the **no `model:` key** assertion (Addendum A2: settings `agentOverrides` cannot beat frontmatter, so a stray `model:` makes Phase 5 inert).
- [ ] `tests/integration/worktree-build.test.ts` — EXT-02, the decisive new proof.
- [ ] `tests/integration/git-checkpoint.test.ts` — EXT-07.
- [ ] `tests/integration/subagent-background.test.ts`, `tests/integration/subagent-steering.test.ts` — EXT-03 / EXT-04, **scoped to this repo's composition** (that the config is present and wired), not to re-proving `pi-subagents`' own internals. Research recommends citing the package's own passing suite for third-party internals; the plan should state which side of that line each assertion sits on.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| The composed smoke ritual run end-to-end after a real version bump | EXT-09 | Three of its four legs need the work laptop: a real turn per provider (RB-03-0x), a credential-backed wire dump (RB-02-01), and a real subagent spawn against a real model. Only the blocked-command leg is fully provable offline today. | **Append `RB-07-01`** to `docs/RUNBOOK.md`, marked **OUTSTANDING**. Add a `PHASE_SEVEN_IDS` array to `tests/unit/docs-policy.test.ts` and append to `ALL_IDS`, following the Phase 4/5 precedent exactly — **append, never renumber**. The status appears in two places (summary-table row and the `**Status:**` line under `### RB-07-01`); a disagreement is reported as `INCONSISTENT`, which fails the suite. |
| Real runtime behaviour of every third-party extension | EXT-01, EXT-03, EXT-04, EXT-05 | Nothing was ever executed during research — no Pi install, no credentials. All package findings are static source reads. This is the ROADMAP's own carried-forward unknown. | Covered by the offline composition tests above for what this repo controls; anything asserting third-party runtime behaviour must be marked UNVERIFIED or moved into `RB-07-01` rather than claimed. |
| Windows `fs.symlinkSync` EPERM without Developer Mode (Addendum A3) | EXT-02 | Behaviour depends on the machine's Developer Mode / elevation state, which differs between this machine and the work laptop. | The junction remedy (`fs.symlinkSync(..., "junction")`) is testable offline here. Whether the *unremedied* path fails on the work laptop is environment-dependent — assert the remedy works, do not assert the failure mode is universal. |

---

## Validation Sign-Off

- [ ] All tasks have an `<automated>` verify command or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers every MISSING test file referenced above
- [ ] No watch-mode flags anywhere
- [ ] Feedback latency < 90s
- [ ] Every new test demonstrated to FAIL when its subject is removed
- [ ] No test writes outside the repo or a temp dir
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
