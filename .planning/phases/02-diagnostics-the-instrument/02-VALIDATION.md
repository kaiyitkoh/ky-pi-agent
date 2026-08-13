---
phase: 2
slug: diagnostics-the-instrument
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` § Validation Architecture (line 1241).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (exact pin, matches Pi core) — already installed and green |
| **Config file** | `vitest.config.ts` — exists (Phase 1): `environment: "node"`, `include: ["tests/**/*.test.ts"]`, `testTimeout: 120_000`, `passWithNoTests: false` |
| **Quick run command** | `npm run test:unit` (`vitest run tests/unit`) |
| **Full suite command** | `npm test && npm run typecheck` (`vitest run` + `tsc --noEmit`) |
| **Estimated runtime** | ~60–90 seconds (in-memory agent sessions and the concurrency test's child processes dominate) |
| **Existing baseline** | 248 tests green, `tsc --noEmit` clean (Phase 1) — must stay green |

**Constraints:** No build step (jiti loads `.ts`). No new dependency may be added — `tests/unit/pinning.test.ts:253` asserts the six audited devDependency pins, so ESLint is structurally unavailable and DIAG-03 must be a source-grep vitest test. No credential exists on this machine: every DIAG requirement is verified offline with `fauxProvider`, and the live halves of DIAG-01/05/07 are **OUTSTANDING** runbook entries, never "passed".

---

## Sampling Rate

- **After every task commit:** `npm run test:unit && npm run typecheck`
- **After every plan wave:** `npm test` (full suite, incl. integration)
- **Before `/gsd:verify-work`:** full suite green, `tsc --noEmit` clean, and `docs/RUNBOOK.md` carrying RB-02-01/02/03 with matching **OUTSTANDING** status in both the summary table and the detail subsection (`tests/unit/docs-policy.test.ts` reports `INCONSISTENT` otherwise)
- **Max feedback latency:** 90 seconds

---

## Per-Requirement Verification Map

Task IDs are assigned at plan time; every plan task must map to one of these rows or add a row.

| Requirement | Behaviour observed | Test type | Automated command | File Exists | Status |
|---|---|---|---|---|---|
| DIAG-01 | All three provider hooks fire, in order headers→request→response, on a live in-memory session | integration | `npx vitest run tests/integration/wire-capture.test.ts` | ❌ W1 | ⬜ pending |
| DIAG-01 | Capture handler returns `undefined`; payload the provider receives is byte-identical | unit | `npx vitest run tests/unit/wire-nonmutating.test.ts` | ❌ W1 | ⬜ pending |
| DIAG-01 | *(live half)* Real DeepSeek + Bedrock payloads carry the thinking parameters | **manual** | `RB-02-01` in `docs/RUNBOOK.md` | ❌ W4 | ⬜ **OUTSTANDING** |
| DIAG-02 | `callModel()` produces a `kind:"nested"` row with `role`, `usage`, non-zero `cost`, captured payload + headers + status | integration | `npx vitest run tests/integration/call-model.test.ts` | ❌ W2 | ⬜ pending |
| DIAG-02 | Bare `modelRegistry.complete()` produces **no** extension-hook capture (negative control) | integration | same file | ❌ W2 | ⬜ pending |
| DIAG-03 | Grep fails on a synthetic offending file, passes on the real tree; scanned set non-empty; allowlist empty | unit | `npx vitest run tests/unit/chokepoint-lint.test.ts` | ❌ W2 | ⬜ pending |
| DIAG-04 | One turn → exactly one `kind:"turn"` row with every field populated from the right source | integration | `npx vitest run tests/integration/turns-log.test.ts` | ❌ W2 | ⬜ pending |
| DIAG-04 | `reasoning` key **omitted** when `usage.reasoning === undefined`, present when numeric (Bedrock) | unit | `npx vitest run tests/unit/turn-row.test.ts` | ❌ W2 | ⬜ pending |
| DIAG-04 | `outcome` maps for `stop`/`toolUse`/`length`/`error`/`aborted`; an error turn still produces a row | integration | `tests/integration/turns-log.test.ts` | ❌ W2 | ⬜ pending |
| DIAG-05 | Detector fires on scripted prose; not on a real `toolCall`; not on a mention without `{` | unit | `npx vitest run tests/unit/prose-detector.test.ts` | ❌ W3 | ⬜ pending |
| DIAG-05 | A retry actually occurs: `faux.state.callCount === 2` after one prose response, one `agent_end` | integration | `npx vitest run tests/integration/prose-retry.test.ts` | ❌ W3 | ⬜ pending |
| DIAG-05 | Retry is capped: three prose responses yield one retry + a `prose_tool_call_retry_exhausted` row | integration | same file | ❌ W3 | ⬜ pending |
| DIAG-05 | *(live half)* Detector has fired on real DeepSeek traffic, with a recorded rate | **manual** | `RB-02-03` | ❌ W4 | ⬜ **OUTSTANDING** |
| DIAG-06 | `/budget` sections sum to `ctx.getSystemPrompt().length`; skills slice equals `formatSkillsForPrompt(opts.skills)` | integration | `npx vitest run tests/integration/budget.test.ts` | ❌ W3 | ⬜ pending |
| DIAG-06 | `cacheRead` vs `input` reported across two turns of the same `sessionId` | integration | same file | ❌ W3 | ⬜ pending |
| DIAG-06 | `/budget` is a **command** and `diagnostics/` registers **no tool** — BOOT-10 stays green | unit | `tests/unit/contributing-boundary.test.ts` | ✅ exists | ⬜ pending |
| DIAG-07 | Each secret pattern is redacted; a clean payload returns byte-identical (negative control) | unit | `npx vitest run tests/unit/redact.test.ts` | ❌ W1 | ⬜ pending |
| DIAG-07 | Redaction happens before the write: on-disk bytes never contain the plaintext | integration | `npx vitest run tests/integration/wire-capture.test.ts` | ❌ W1 | ⬜ pending |
| DIAG-07 | Every path the writer produces is gitignored — `git check-ignore --no-index` over real produced paths | unit | `npx vitest run tests/unit/logs-gitignored.test.ts` | ❌ W1 | ⬜ pending |
| DIAG-07 | *(live half)* No live credential in a real dump | **manual** | `RB-02-02` | ❌ W4 | ⬜ **OUTSTANDING** |
| DIAG-08 | Exceeding the size cap renames to `<base>.1.jsonl` and starts a fresh file; no content lost | unit | `npx vitest run tests/unit/jsonl-rotation.test.ts` | ❌ W1 | ⬜ pending |
| DIAG-08 | Retention prune keeps ≤10 rotated files and ≤14 days, oldest deleted first | unit | same file | ❌ W1 | ⬜ pending |
| DIAG-08 | Four concurrent child processes appending produce N×M parseable lines, zero torn records | integration | `npx vitest run tests/integration/jsonl-concurrency.test.ts` | ❌ W1 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Research finding #1 is load-bearing: **`fauxProvider` never calls `onPayload`**, so `before_provider_request` never fires under faux and the naive `[FAUX]` test for DIAG-01/07 ships vacuously green. These helpers must land before any requirement code.

- [ ] `tests/helpers/faux.ts` — `wrapFauxWithPayload(faux)` (RESEARCH §8.3) plus realistic `buildFixturePayload` shapes for the `openai-completions` and `bedrock-converse-stream` paths. **Blocks DIAG-01, DIAG-02, DIAG-07.**
- [ ] `tests/helpers/session.ts` — in-memory `createAgentSession` factory (RESEARCH §8.4) plus a temp `agentDir` whose `extensions/` holds the extension under test at **user scope** (project scope does not load headless).
- [ ] `tests/helpers/logs.ts` — temp `.pi/logs/` fixture, JSONL reader, and `readTornSafe()` reporting unparseable lines rather than throwing.
- [ ] No framework install needed — `vitest@4.1.9` is pinned and green.
- [ ] No new dependency may be added (`tests/unit/pinning.test.ts:253`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|---|---|---|---|
| Real DeepSeek + Bedrock payloads carry the thinking parameters that were set | DIAG-01 | No live model credentials on this machine; only real traffic proves what the adapter emits | `RB-02-01` in `docs/RUNBOOK.md` — status **OUTSTANDING** |
| A real dump taken against live providers contains no credential | DIAG-07 | Redaction correctness against real header/payload shapes cannot be proven from fixtures alone | `RB-02-02` — status **OUTSTANDING** |
| The prose-tool-call detector has fired on real DeepSeek traffic, with a recorded rate | DIAG-05 | The ~11% failure mode only manifests on real model output | `RB-02-03` — status **OUTSTANDING** |

These are appended to the existing `docs/RUNBOOK.md` (which already holds RB-01-01/02/03). Never mark them passed; `tests/unit/docs-policy.test.ts` enforces status consistency.

---

## Validation Sign-Off

Traced by `gsd-plan-checker` against all 11 plans (02-01 … 02-11) on 2026-08-13.

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — 100% of tasks carry an automated verify command; no `<automated>MISSING</automated>` references exist
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — holds trivially at 100% coverage
- [x] Wave 0 covers all MISSING references — plan `02-01` (wave 1, no dependencies) delivers the three helpers, and every downstream capture test asserts a non-empty captured set so the `onPayload` gap cannot ship vacuously green
- [x] No watch-mode flags
- [x] Feedback latency < 90s — one deliberate outlier: `tests/integration/jsonl-concurrency.test.ts` (plan 02-03) spawns four child processes and is budgeted to the 90s ceiling
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-13 (plan-checker verdict: VERIFICATION PASSED, zero blockers)
