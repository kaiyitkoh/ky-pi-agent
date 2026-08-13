---
phase: 3
slug: providers-credentials
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-13
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` § Validation Architecture (line 674).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (exact pin, matches Pi core) — already installed and green |
| **Config file** | `vitest.config.ts` — exists (Phase 1): `environment: "node"`, `include: ["tests/**/*.test.ts"]`, `testTimeout: 120_000`, `passWithNoTests: false` |
| **Quick run command** | `npm run test:unit` (`vitest run tests/unit`) |
| **Full suite command** | `npm test && npm run typecheck` (`vitest run` + `tsc --noEmit`) |
| **Estimated runtime** | ~90–120 seconds (the loopback-server integration tests and the bootstrap installer test under a temp `PI_CODING_AGENT_DIR` dominate) |
| **Existing baseline** | 514 tests green, `tsc --noEmit` clean (Phases 1–2) — must stay green |

**Constraints.** No build step (jiti loads `.ts`). No new dependency may be added — `tests/unit/pinning.test.ts` asserts the audited devDependency pin set, so every new capability is a vitest test or a helper, never a package. **No credential exists on this machine and no provider request may be issued**: every PROV requirement is verified offline (`fauxProvider`, a `127.0.0.1` loopback completions server, and structural tests over the templates), and the live halves of PROV-03/04/07/10 are **OUTSTANDING** runbook entries, never "passed".

---

## Sampling Rate

- **After every task commit:** `npm run test:unit && npm run typecheck`
- **After every plan wave:** `npm test` (full suite, incl. loopback + installer integration tests)
- **Before `/gsd:verify-work`:** full suite green, `tsc --noEmit` clean, and `docs/RUNBOOK.md` carrying every `RB-03-xx` with matching **OUTSTANDING** status in both the summary table and the detail subsection (`tests/unit/docs-policy.test.ts` reports `INCONSISTENT` otherwise)
- **Max feedback latency:** 120 seconds

---

## Per-Requirement Verification Map

Task IDs are assigned at plan time; every plan task must map to one of these rows or add a row.

| Requirement | Observable signal | Test type | Automated command | File Exists | Status |
|---|---|---|---|---|---|
| PROV-01 | `getProviderAuth("dashscope").auth.apiKey` equals `process.env.DASHSCOPE_API_KEY`; no secret-shaped literal in either template | integration | `npx vitest run tests/integration/templates-install.test.ts` | ❌ W1 | ⬜ pending |
| PROV-01 | Both templates are tracked by git and NOT swallowed by `.gitignore` (Trap T1 — `.gitignore:46-47` silently eats `auth.json`-shaped names) | unit | `npx vitest run tests/unit/template-tracked.test.ts` | ❌ W0 | ⬜ pending |
| PROV-02 | Zero `!`-prefixed values in `models-template.json` **and** in any `registerProvider` call under `.pi/extensions/`; an `auth.json` `!command` resolves twice with one stub invocation (cached), a `models.json` one resolves twice with two (uncached) | unit | `npx vitest run tests/unit/command-interpolation.test.ts` | ❌ W1 | ⬜ pending |
| PROV-03 | Composed `model.compat` deep-equals the intended object for every DashScope entry | unit | `npx vitest run tests/unit/dashscope-compat.test.ts` | ❌ W1 | ⬜ pending |
| PROV-03 | Loopback request body carries `enable_thinking` + `reasoning_effort` + `max_tokens`, and lacks `store` / `developer` / `strict` / `prompt_cache_*` | integration | `npx vitest run tests/integration/dashscope-payload.test.ts` | ❌ W2 | ⬜ pending |
| PROV-03 | Installed `pi-ai` still has no `aliyuncs` branch in `detectCompat` — a regression canary against a Pi upgrade silently making the explicit block redundant *or* conflicting | unit | `tests/unit/dashscope-compat.test.ts` | ❌ W1 | ⬜ pending |
| PROV-03 | *(live half)* DashScope accepts the emitted body and thinking is actually enabled | **manual** | `RB-03-01` in `docs/RUNBOOK.md` | ❌ W4 | ⬜ **OUTSTANDING** |
| PROV-04 | `getProviderAuth("amazon-bedrock")` returns `source: "stored credential"` with `env.AWS_PROFILE` set from a temp `auth.json`, and `undefined` when absent (negative control) | unit | `npx vitest run tests/unit/bedrock-auth.test.ts` | ❌ W1 | ⬜ pending |
| PROV-04 | *(live half)* `AWS_PROFILE` from `auth.json` survives a fresh shell and the AWS SDK resolves a live SSO token | **manual** | `RB-03-03` | ❌ W4 | ⬜ **OUTSTANDING** |
| PROV-05 | Surfaced `errorMessage` contains the literal `aws sso login --profile <resolved>`; `faux.state.callCount === 1`; `isRetryableAssistantError(rewritten) === false` for all six SSO fixtures | integration | `npx vitest run tests/integration/sso-classifier.test.ts` | ❌ W3 | ⬜ pending |
| PROV-06 | `dashscope/deepseek-v4-flash.contextWindow === 393216` while the built-in `deepseek/deepseek-v4-flash.contextWindow === 1000000` — no cross-provider inheritance | unit | `npx vitest run tests/unit/model-metadata.test.ts` | ❌ W1 | ⬜ pending |
| PROV-06 | Every all-zero-`cost` model is on the `COST_UNVERIFIED` allowlist **and** named in the runbook — a placeholder cost cannot ship silently | unit | same file | ❌ W1 | ⬜ pending |
| PROV-07 | `clampThinkingLevel(model,"low")` is `"high"` without the override and `"low"` with the `modelOverrides.thinkingLevelMap` unclamp — i.e. the experiment is actually executable | unit | `npx vitest run tests/unit/r1-unclamp.test.ts` | ❌ W1 | ⬜ pending |
| PROV-07 | *(live half)* Does `api.deepseek.com` accept `reasoning_effort:"low"`, and does it yield materially fewer reasoning tokens than `"high"` | **manual** | `RB-03-04` | ❌ W4 | ⬜ **OUTSTANDING** |
| PROV-08 | For each of quota / transient / unavailable, the second chain entry is attempted exactly once; for `fatal`, it is not attempted at all — asserted on per-provider `faux.state.callCount` | integration | `npx vitest run tests/integration/fallback-chain.test.ts` | ❌ W3 | ⬜ pending |
| PROV-09 | Every `RB-03-xx` has an `OUTSTANDING` table row **and** a matching `OUTSTANDING` `**Status:**` line, names its commands verbatim, and cites an existing test path as its offline proxy | unit | `npx vitest run tests/unit/docs-policy.test.ts` | ✅ extend | ⬜ pending |
| PROV-10 | On a replayed two-turn context the loopback body's assistant message carries `reasoning_content` — the field whose absence is the second-turn 400 | integration | `npx vitest run tests/integration/dashscope-payload.test.ts` | ❌ W2 | ⬜ pending |
| PROV-10 | *(live half)* A real two-turn tool-calling sequence against DashScope returns 200 on the **second** turn | **manual** | `RB-03-02` | ❌ W4 | ⬜ **OUTSTANDING** |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Two research findings are load-bearing and must land before any requirement code:

1. `fauxProvider` hard-codes HTTP 200 and never surfaces a status, so PROV-08's error-class fixtures need a wrapper.
2. `.gitignore:46-47` silently swallows both `.pi/templates/auth.json` and `auth.example.json` — the filename `ARCHITECTURE.md` sketched would have produced a fresh clone **missing the file while every test passed**.

- [ ] `tests/helpers/faux.ts` — add `wrapFauxWithStatus(faux, status)`. **Blocks PROV-05, PROV-08.**
- [ ] `tests/helpers/models.ts` — `withModelsConfig()` returning a `ModelRuntime` over an arbitrary `modelsPath` / `authPath`. **Blocks PROV-01, PROV-03, PROV-04, PROV-06, PROV-07.**
- [ ] `tests/helpers/loopback.ts` — `withLoopbackCompletions(handler)` bound to `127.0.0.1`. **Blocks PROV-03, PROV-10.** No egress; this is the only way to see the emitted body offline.
- [ ] `tests/unit/template-tracked.test.ts` — `git check-ignore --no-index` + `git ls-files` over both templates. **Blocks PROV-01** (Trap T1).
- [ ] Framework install: **none** — `vitest@4.1.9` is already pinned and configured.

---

## Manual-Only Verifications

Every one of these maps to exactly one runbook id, and **no offline test may be written that appears to cover them**.

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| DashScope accepts the emitted body and thinking is genuinely enabled | PROV-03 | Needs a live region-scoped key and egress; the compat block's effect is provider-side | `RB-03-01` — status **OUTSTANDING** |
| The second turn of a tool-calling sequence returns 200 | PROV-10 | The 400 is provider-side; the first turn always works, so only real traffic tests it | `RB-03-02` — status **OUTSTANDING** |
| `AWS_PROFILE` from `auth.json` survives a fresh shell and a live SSO token resolves | PROV-04 | Needs the work laptop's `~/.aws` and an IAM Identity Center session | `RB-03-03` — status **OUTSTANDING**. Its expected output also folds in the only live check of the SSO classifier: whether a real expiry produces a string the matcher recognises |
| Whether `reasoning_effort:"low"` is accepted and yields materially fewer reasoning tokens | PROV-07 | Settled by one live request, never by desk reasoning (R1) | `RB-03-04` — status **OUTSTANDING**. Result is recorded with a pre-committed "materially fewer" threshold so it is a decision, not a vibe |
| Real DashScope context cap and per-token price | PROV-06 | Console/provider-side; public docs give no price figures | `RB-03-05` — status **OUTSTANDING**. Until run, every affected model carries an all-zero `cost` on the tested `COST_UNVERIFIED` allowlist |

These are **appended** to the existing `docs/RUNBOOK.md` (which already holds RB-01-01/02/03 and RB-02-01/02/03). Never mark them passed; `tests/unit/docs-policy.test.ts` enforces status consistency between the table row and the `**Status:**` line, and reports a disagreement as `INCONSISTENT`.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
