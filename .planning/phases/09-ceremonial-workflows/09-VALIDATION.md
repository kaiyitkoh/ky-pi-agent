---
phase: 9
slug: ceremonial-workflows
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-15
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `09-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (pinned; one of the six audited `devDependencies`) |
| **Config file** | `vitest.config.ts` — `environment: "node"`, `testTimeout`/`hookTimeout` `120_000`, `passWithNoTests: false`, `globalSetup: ["./tests/global-teardown.ts"]`, `setupFiles: ["./tests/setup/agent-dir.ts"]`. **No `pool`/`poolOptions`/`fileParallelism` is set — do not add one.** |
| **Quick run command** | `npx vitest run tests/unit/<file>.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Typecheck command** | `npx tsc --noEmit` |
| **Estimated runtime** | full suite ~3–6 min on this machine |

---

## Sampling Rate

- **After every task commit:** run the specific new/modified test file(s) for that task.
- **After every plan wave:** `npx vitest run` (full suite) **and** `npx tsc --noEmit`.
- **Before `/gsd:verify-work`:** full suite green, typecheck clean, **and `npx vitest run tests/unit/checkpoint-store.test.ts` green 10 consecutive times** (the WR-09 de-flake acceptance bar, mirroring plan 08-05's falsification budget).
- **Max feedback latency:** ~30 s for a single unit file; full suite per wave.

---

## Per-Task Verification Map

Task ids are assigned by the planner; the rows below bind each **requirement** to its observable, its command, and its falsification. A test that cannot fail is not a verification (this project has shipped three of them — see `09-CONTEXT.md` decision 6).

| Requirement | Observable that proves it | Test Type | Automated Command | File Exists | Falsification (must turn RED) | Status |
|---|---|---|---|---|---|---|
| FLOW-02 | `/grill` refuses to advance while the ambiguity score is above its threshold or any per-dimension floor is unmet; the question budget is hard and questions are emitted one at a time from a rotating perspective set | unit | `npx vitest run tests/unit/grill-scorecard.test.ts` | ❌ W0 | delete a dimension floor → a below-floor scorecard must still gate | ⬜ pending |
| FLOW-03 | the requirements section **cannot be written** while the Verified Codebase Facts table is absent or carries an evidence-free row | unit | `npx vitest run tests/unit/grill-evidence-gate.test.ts` | ❌ W0 | remove the gate → an evidence-free SPEC must be rejected | ⬜ pending |
| FLOW-04 | every §4 entry matches `IF <condition> THEN THE SYSTEM SHALL <response>`; a minimum entry count is enforced by code | unit | `npx vitest run tests/unit/spec-error-behaviour.test.ts` | ❌ W0 | a §4 entry in prose form, and a §4 with too few entries, must both be rejected | ⬜ pending |
| FLOW-05 | expected-files list is non-empty and is **diffed against a real git diff**; a file outside the union is reported | unit + integration (real temp git repo) | `npx vitest run tests/unit/scope-drift.test.ts tests/integration/scope-drift.test.ts` | ❌ W0 | a diff touching an undeclared path must be flagged; an in-scope diff must not | ⬜ pending |
| FLOW-06 | task lines match `T### [P] [R#] verb <explicit path> + verification command`; the coverage matrix rejects a requirement with zero tasks and a task with no path or no command | unit | `npx vitest run tests/unit/plan-task-form.test.ts` | ❌ W0 | an unmapped `R#`, a pathless task and a commandless task must each turn it red | ⬜ pending |
| FLOW-07 | PROGRESS.md append carries **real pasted command output** bound to a commit SHA; the commit is atomic. Reuses Phase 6's `gateCompletion` (structural `isError` + SHA + tree, never `message.content`) | integration (real temp git repo) | `npx vitest run tests/integration/execute-workflow.test.ts` | ❌ W0 | a fabricated/narrated output with no matching `tool_result`, and an empty or unrelated commit, must each be rejected | ⬜ pending |
| FLOW-08 | REVIEW.md carries all four sections including Scope Drift; the MR call routes through `classifyGlabInvocation`, targets a non-protected branch, and **`glab mr merge` stays blocked** | unit + integration (`stub-bin.ts` `glab`) | `npx vitest run tests/unit/review-render.test.ts tests/integration/review-mr.test.ts tests/unit/git-policy.test.ts` | ❌ W0 (+ extend existing) | an omitted `--target-branch`, a `main` target, and `mr merge` must each be blocked; a staging target must be allowed | ⬜ pending |
| FLOW-09 | the handoff packet builder is **pure**; its measured size is compared against the parent context it replaces; absence of the subagent layer reports `UNAVAILABLE`, **never a silent pass** | unit | `npx vitest run tests/unit/handoff-packet.test.ts` | ❌ W0 | with no subagent tool registered the probe must NOT return available; a packet carrying the whole SPEC must fail the self-containment/size assertion | ⬜ pending |
| FLOW-10 | exactly SPEC, PLAN, REVIEW and a PROGRESS append exist under `.pi/work/<slug>/` after a full run; no fifth artifact | unit (temp-dir filesystem assertion) | `npx vitest run tests/unit/artifact-count.test.ts` | ❌ W0 | planting a fifth file must turn it red | ⬜ pending |
| QUAL-03 | for a fix-framed SPEC, a Root Cause section naming the cause with `file:line` evidence is **required**, gated identically to the Verified Codebase Facts table | unit | `npx vitest run tests/unit/spec-error-behaviour.test.ts` | ❌ W0 | a fix-framed SPEC with no Root Cause, and one whose Root Cause carries no `file:line`, must both be rejected | ⬜ pending |
| QUAL-08 | a **pure selector** returns deterministic-only depth for `/quick` and all four mechanisms for the full workflow, asserted in **both** directions | unit | `npx vitest run tests/unit/gate-depth-selector.test.ts` | ❌ W0 | inverting the selector must turn both directions red (a one-directional assertion passes on a constant) | ⬜ pending |
| **Sideways ratchet** (the ROADMAP's deferred decision) | a `.pi/` resource reachable only by a **non-import path literal** is counted; `WORKFLOW_TEXT_BUDGETS` bounds each workflow's command source + declared bodies | unit | `npx vitest run tests/unit/workflow-budgets.test.ts` | ✓ extend | plant an undeclared `.pi/` resource edge → the completeness scan must fail; plant an over-budget body → the text budget must fail | ⬜ pending |
| **WR-09 de-flake** (folded in) | the concurrency overlap is proved by an **event**, not a wall-clock margin; the lossless recorded property replaces the timing comparison | unit + repetition | `npx vitest run tests/unit/checkpoint-store.test.ts` ×10 consecutive | ✓ modify | removing the store's lock must still turn the 600-row assertion red (mutation-verified, per the Phase 7 lesson that a "MUTATION-VERIFIED" label is not a mutation test) | ⬜ pending |
| **`RB-09-xx` runbook statuses** | each id's status is parsed from **two** places and they agree; a half-flip reports `INCONSISTENT` | unit | `npx vitest run tests/unit/docs-policy.test.ts` | ✓ extend | flip one of the two places → `INCONSISTENT`; flip both → `PASSED`, which must also fail | ⬜ pending |
| **Tool-count discipline** | Phase 9 registers **zero** new tools; the allowlist stays at five | unit | `npx vitest run tests/unit/contributing-boundary.test.ts tests/unit/tool-count-baseline.test.ts` | ✓ existing | adding a `registerTool(` outside the allowlist must fail the build | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

New test files (none exist yet):

- [ ] `tests/unit/grill-scorecard.test.ts` — FLOW-02
- [ ] `tests/unit/grill-evidence-gate.test.ts` — FLOW-03
- [ ] `tests/unit/spec-error-behaviour.test.ts` — FLOW-04, QUAL-03
- [ ] `tests/unit/scope-drift.test.ts` + `tests/integration/scope-drift.test.ts` — FLOW-05
- [ ] `tests/unit/plan-task-form.test.ts` — FLOW-06
- [ ] `tests/integration/execute-workflow.test.ts` — FLOW-07
- [ ] `tests/unit/review-render.test.ts` + `tests/integration/review-mr.test.ts` — FLOW-08
- [ ] `tests/unit/handoff-packet.test.ts` — FLOW-09
- [ ] `tests/unit/artifact-count.test.ts` — FLOW-10
- [ ] `tests/unit/gate-depth-selector.test.ts` — QUAL-08

Existing files to EXTEND (never duplicate — this project's rule is extend-the-gate, not add-a-second-one):

- [ ] `tests/unit/git-policy.test.ts`, `tests/unit/policy-compose.test.ts`, `tests/fixtures/evasion-corpus.ts`, `docs/SAFETY.md`'s derived limits table — the `glab mr create` rule
- [ ] `tests/unit/workflow-budgets.test.ts` — `RESOURCE_EDGES`, `WORKFLOW_TEXT_BUDGETS`, and new `WORKFLOW_BUDGETS`/`DIRECTORY_BUDGETS` entries for every new command source and subsystem
- [ ] `tests/unit/gitignore-policy.test.ts` + `.gitignore` — `.pi/work/`
- [ ] `tests/unit/docs-policy.test.ts` + `docs/RUNBOOK.md` — `PHASE_NINE_IDS`, `ALL_IDS`, `ENTRY_COMMANDS`
- [ ] `tests/unit/checkpoint-store.test.ts` — the WR-09 event-gated rewrite

No framework install is needed. `vitest@4.1.9` is already one of the six audited pins, and **no new npm dependency may be added** (`tests/unit/pinning.test.ts:253`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| One real feature ships end to end through `/grill → /plan → /execute → /review` on the **work laptop** | FLOW-08 (criterion 4, second clause) | Needs the user's GitLab work repo and a real MR. The dev machine holds live static IAM admin credentials and must not be used to exercise it. | `RB-09-xx` in `docs/RUNBOOK.md`, status **OUTSTANDING**. FLOW-08 stays `[~]` partial with the id named inline. |
| A real `glab mr create` against the work GitLab, targeting **staging** | FLOW-08 | Same. The offline proof is a stubbed `glab` on PATH, which proves the harness's classification and argv, never GitLab's acceptance. | `RB-09-xx`, **OUTSTANDING**. |
| A real `pi-subagents` spawn consuming a handoff packet, and the measured parent-token delta | FLOW-09 | `pi-subagents@0.49.0` is pinned and **not installed** (`RB-07-02` is OUTSTANDING). The offline proof is the pure packet builder plus the `UNAVAILABLE` probe. | `RB-09-xx`, **OUTSTANDING**. |

Every other phase behaviour has automated, offline verification.

---

## Validation Sign-Off

- [ ] Every task has an automated verify command, or a named Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references above
- [ ] No watch-mode flags; **no `retry`, no widened bound, no raised `testTimeout`, no `it.skip`, no `fileParallelism: false`** (grep-checkable, per the 08-05 precedent)
- [ ] Every new test shown to FAIL when its subject is removed (falsification column above)
- [ ] No test writes outside the repo or a temp dir
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
