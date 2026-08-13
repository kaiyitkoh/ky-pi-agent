---
phase: 03-providers-credentials
verified: 2026-08-14T02:30:00Z
status: human_needed
score: 10/10 must-haves verified (offline-verifiable scope); 5 RUNBOOK items OUTSTANDING as expected
overrides_applied: 0
human_verification:
  - test: "RB-03-01 — DashScope accepts the explicit compat block on the wire"
    expected: "A live turn against dashscope/deepseek-v4-flash returns 200 with enable_thinking, reasoning_effort, max_tokens present and store/developer-role/strict/prompt_cache_* absent, per docs/RUNBOOK.md RB-03-01"
    why_human: "Requires a live DashScope credential and network egress to aliyuncs.com; none exist on this machine. Cannot be executed under the autonomous-run credential ban."
  - test: "RB-03-02 — a two-turn tool-calling sequence against DashScope returns 200 on the second turn"
    expected: "Second main.request carries a replayed assistant message with tool_calls and reasoning_content, followed by a main.response with status 200, per docs/RUNBOOK.md RB-03-02"
    why_human: "Requires a live DashScope credential; the first turn always works so only a live second-turn round trip is the test. No credentials on this machine."
  - test: "RB-03-03 — Bedrock authenticates from a fresh shell via credential.env.AWS_PROFILE"
    expected: "A turns row with outcome: ok and non-zero tokens after a fresh shell with no exported AWS_PROFILE, using a stored Bedrock credential; plus one live SSO-expiry observation recorded verbatim, per docs/RUNBOOK.md RB-03-03"
    why_human: "Requires a real IAM Identity Center SSO session and Bedrock access; none exist on this machine."
  - test: "RB-03-04 — the R1 experiment (reasoning_effort: low vs high on DeepSeek-direct)"
    expected: "Four verbatim fragments (two main.request payloads, two turns rows) recorded, with the pre-committed threshold low.reasoning <= 0.6 * high.reasoning evaluated, per docs/RUNBOOK.md RB-03-04"
    why_human: "Requires a live DeepSeek-direct credential and a real token count from the provider; cannot be desk-work."
  - test: "RB-03-05 — the real DashScope context cap and per-token price"
    expected: "Real cost and maxTokens figures for dashscope/deepseek-v4-flash and dashscope/deepseek-v4-pro read from the Model Studio console and written into .pi/templates/models-template.json, with COST_UNVERIFIED updated in the same commit, per docs/RUNBOOK.md RB-03-05"
    why_human: "Requires a Model Studio console login this machine does not have."
---

# Phase 3: Providers & Credentials Verification Report

**Phase Goal:** Every provider the harness will route to is structurally complete in-repo with zero secrets, and every credential-dependent behaviour is either unit-verified offline or documented in a runbook the user can execute.
**Verified:** 2026-08-14T02:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Autonomous-run constraint honoured

No network request was issued to any provider host during this verification.
Success Criteria 3 and 4 (live DashScope, live Bedrock, live R1 token counts)
are **not** claimed as passed. All five `RB-03-xx` entries in `docs/RUNBOOK.md`
were read directly and every one reads `OUTSTANDING` in both the summary table
(`docs/RUNBOOK.md:415-419`) and its own `**Status:**` line
(`:423`, `:500`, `:542`, `:628`, `:719`). No `RB-03-xx` id reads `PASSED`. This
is the expected, pre-authorised outcome for this phase — `human_needed` is
used deliberately, not as a downgrade from `gaps_found` and not inflated to
`passed`.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A fresh clone contains structurally complete `models.json`/`auth.json` templates; every value resolves via `$ENV_VAR` or `!command`; no secret present | ✓ VERIFIED | `.pi/templates/models-template.json` and `.pi/templates/auth-template.json` exist and are read by real Pi loaders in `tests/integration/templates-install.test.ts` (per 03-02 SUMMARY decision log). `auth-template.json` carries only `$DASHSCOPE_API_KEY`, `$DEEPSEEK_API_KEY`, and the `REPLACE_WITH_AWS_PROFILE_NAME` sentinel — no literal credential. Repo-wide grep for `AKIA[0-9A-Z]{16}`, `ASIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}` over all tracked files returns nothing. |
| 2 | `!command` appears only in `auth.json`, never in `models.json` (cached vs re-executed per request) | ✓ VERIFIED | `grep -n '"!'` over `.pi/templates/models-template.json` returns nothing; the file's own header states the rule and cites `docs/models.md:172`. `tests/unit/command-interpolation.test.ts` scans both the uncached `models.json`/extension-`apiKey` surface and asserts the auth-template surface is exempt, with vacuity guards (non-empty scanned sets, inline offending fixtures) and a positive control (`$ENV_VAR` present). |
| 3 | Expired SSO produces an actionable message naming `aws sso login --profile <name>` and is classified non-retryable | ✓ VERIFIED | `.pi/extensions/providers/sso.ts` (pure predicate, 5 anchored patterns) + `.pi/extensions/providers/index.ts` (`message_end` handler, rewrites `errorMessage`, keeps original SDK text on `diagnostics[]` per Trap T4) + `.pi/extensions/providers/schema.ts`. `tests/integration/sso-classifier.test.ts` drives all six fixtures on a live in-memory faux session and asserts non-retryability by `callCount === 1` **against a retryable control in the same harness** — the 03-REVIEW.md iteration-3 mutation run confirmed this is not vacuous (deleting the sentinel check alone turned the suite red). |
| 4 | DeepSeek-direct → DashScope fallback chain handles quota, transient and unavailable errors | ✓ VERIFIED | `.pi/extensions/providers/fallback.ts` — `callWithFallback()` with `classifyFailure()` ordering quota-first, then Pi's own retry predicate, then a local availability split; a `fatal` class stops the chain. `tests/integration/fallback-chain.test.ts` proved by 03-REVIEW.md iteration-3 mutation testing: appending `\|exceeded` to `QUOTA_PATTERN` turned 2 cases red; deleting-only-the-production-sentinel-style mutations were also run and caught. |
| 5 | DashScope configured as a custom provider with explicit full `compat` block | ✓ VERIFIED (offline half) | `.pi/templates/models-template.json` ships `compat` written out in full (not relying on `detectCompat`, which has no `aliyuncs.com` branch). `tests/unit/dashscope-compat.test.ts` deep-equals the composed block; `tests/integration/dashscope-payload.test.ts` asserts the same claims on real bytes through Pi's real `openai-completions` adapter via a loopback server (`tests/helpers/loopback.ts`), with a control body proving absences are evidence, not artefact. Whether DashScope **accepts** the block is `RB-03-01`, OUTSTANDING — correctly not claimed here. |
| 6 | Bedrock authenticates via `credential.env.AWS_PROFILE`, checked before process env, no secret, templatable in-repo | ✓ VERIFIED (offline half) | `.pi/templates/auth-template.json` carries the `REPLACE_WITH_AWS_PROFILE_NAME` sentinel; `bin/bootstrap.sh`'s `merge_auth_json` withholds any entry still holding a `REPLACE_WITH_` value. `tests/unit/bedrock-auth.test.ts` blanks all seven variables in Pi's resolution chain and proves stored `env.AWS_PROFILE` wins over ambient, confirmed non-tautological by 03-REVIEW.md's line-swap mutation (RED at `:466`/`:476`). Fresh-shell live authentication is `RB-03-03`, OUTSTANDING — correctly not claimed here. |
| 7 | Every model carries accurate capability metadata; no cross-provider `contextWindow`/`cost` inheritance | ✓ VERIFIED (offline half) | `tests/unit/model-metadata.test.ts` asserts DashScope's templated `deepseek-v4-flash`/`-pro` never share `contextWindow` with the identically-named DeepSeek-direct built-in entry, and that every all-zero cost model is on `COST_UNVERIFIED` in both directions with vacuity guards. Real cap/price is `RB-03-05`, OUTSTANDING. |
| 8 | R1 question executable and unit-proven, with pre-committed threshold, not yet run | ✓ VERIFIED (offline half) | `tests/unit/r1-unclamp.test.ts` proves the `thinkingLevelMap.low = null` clamp exists, that a `modelOverrides` unclamp removes it, and that `"low"` survives selection — all via a real composed `ModelRuntime`. `docs/RUNBOOK.md` RB-03-04 pre-commits `low.reasoning <= 0.6 * high.reasoning` before any number is seen. Actual run is OUTSTANDING — correctly not claimed here. |
| 9 | `docs/RUNBOOK.md` exists and lists every credential-dependent check with expected output, passed-or-outstanding, never silently assumed | ✓ VERIFIED | `docs/RUNBOOK.md` carries 11 entries across Phases 1–3 (`RB-01-01..03`, `RB-02-01..03`, `RB-03-01..05`), each with exact command, expected output, offline proxy and status line. `tests/unit/docs-policy.test.ts` parses both the summary-table row and the `**Status:**` line for every id and reports disagreement as `INCONSISTENT`; fixture cases prove the parser distinguishes OUTSTANDING, PASSED and half-flipped INCONSISTENT states, and `PHASE_THREE_IDS` is read out of `docs/RUNBOOK.md` itself so a deleted array entry is caught (03-REVIEW's falsification F7 in the STATE.md decision log). |
| 10 | Two-turn tool-calling sequence proof mechanism (`reasoning_content` on replayed assistant message) | ✓ VERIFIED (offline half) | `tests/integration/dashscope-payload.test.ts` drives Pi's real adapter over a replayed two-turn context and asserts `reasoning_content` is present on the replayed assistant message, with a paired negative (deleting the compat key removes it). The provider's actual 200 on the second turn is `RB-03-02`, OUTSTANDING — correctly not claimed here. |

**Score:** 10/10 truths verified within the boundary this machine can prove; 5 of them (3, 5, 6, 7 [contextWindow invariant complete but real numbers not], 8, 10 — mapping to PROV-03/04/06/07/10) carry a named `RB-03-xx` OUTSTANDING live half that is explicitly not claimed as passed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.pi/templates/models-template.json` | Structurally complete DashScope model config, no secrets, no `!command` | ✓ VERIFIED | Exists, substantive (300+ lines with cited sources), no `!` interpolation, wired via `bin/bootstrap.sh` `merge_models_json` |
| `.pi/templates/auth-template.json` | Structurally complete credential shape, `$ENV_VAR`/sentinel only | ✓ VERIFIED | Exists, 3 entries (dashscope, deepseek, amazon-bedrock), no literal secrets |
| `.pi/templates/env.example` / `.env.example` | Env var names only | ✓ VERIFIED | Confirmed empty values, managed-region markers |
| `.pi/extensions/providers/index.ts` | `message_end` SSO classifier hook | ✓ VERIFIED | Registers exactly one hook, role-checked, provider-checked, imports `safeHandler` from sealed diagnostics module rather than duplicating it |
| `.pi/extensions/providers/sso.ts` | Pure SSO-error predicate | ✓ VERIFIED | 5 anchored patterns, no value imports, exported for direct test |
| `.pi/extensions/providers/fallback.ts` | `callWithFallback()` two-hop chain | ✓ VERIFIED | Named exports only, routes every hop through the Phase 2 chokepoint (`callModel`), fatal-class short-circuit |
| `.pi/extensions/providers/schema.ts` | Shared fixtures, patterns, CHAIN table | ✓ VERIFIED (referenced by fallback.ts, index.ts, sso.ts and their tests) |
| `bin/bootstrap.sh` | `merge_models_json`/`merge_auth_json` idempotent installers | ✓ VERIFIED | Exercised by `tests/integration/templates-install.test.ts`; `merge_auth_json` withholds `REPLACE_WITH_`-valued entries |
| `docs/RUNBOOK.md` | 5 `RB-03-xx` entries, all OUTSTANDING | ✓ VERIFIED | Read directly; table (`:415-419`) and every detail `**Status:**` line all read `OUTSTANDING`; no `PASSED` token anywhere in the Phase 3 section |
| `tests/unit/docs-policy.test.ts` | Machine-enforced status guard | ✓ VERIFIED | Fixture-tested both directions (OUTSTANDING/PASSED/half-flip → INCONSISTENT); `PHASE_THREE_IDS` array present and non-empty |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `.pi/extensions/providers/index.ts` | `.pi/extensions/providers/sso.ts` | `classifySso(original)` import + call | WIRED | Handler calls the predicate and branches on `verdict.kind` |
| `.pi/extensions/providers/index.ts` | `.pi/extensions/diagnostics/index.ts` | `safeHandler` import | WIRED | Reuses sealed error-containment wrapper rather than duplicating it; `tests/unit/diagnostics-entry.test.ts` still asserts diagnostics' own hook count is unchanged |
| `.pi/extensions/providers/fallback.ts` | `.pi/extensions/diagnostics/call-model.ts` | `callModel(ctx, {...opts, model})` | WIRED | Every hop routes through the Phase 2 chokepoint, verified by `tests/unit/chokepoint-lint.test.ts` source-scanning this file |
| `bin/bootstrap.sh` | `.pi/templates/models-template.json` / `auth-template.json` | `merge_models_json`/`merge_auth_json` functions | WIRED | `tests/integration/templates-install.test.ts` installs into a fresh agent dir and asserts merge, idempotence and do-not-clobber |
| `docs/RUNBOOK.md` (Phase 3 section) | `tests/unit/docs-policy.test.ts` | `PHASE_THREE_IDS` array + summary-table/detail-line parse | WIRED | Confirmed by reading both the runbook (all OUTSTANDING) and the guard test (fixture-proven both directions) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| PROV-01 | 03-01, 03-02, 03-06 | Structurally complete templates, zero secrets | ✓ SATISFIED | Templates exist, no secrets found, bootstrap installer proven |
| PROV-02 | 03-07 | `!command` only in `auth.json` | ✓ SATISFIED | No `!` in models-template.json; call-site (not filename) rule proven by subprocess count |
| PROV-03 | 03-01, 03-02, 03-03, 03-04, 03-09, 03-11 | DashScope explicit `compat` block | ~ PARTIAL (matches REQUIREMENTS.md) | Offline composed + emitted-bytes proof complete; RB-03-01 acceptance OUTSTANDING |
| PROV-04 | 03-01, 03-02, 03-05, 03-06, 03-11 | Bedrock via `credential.env.AWS_PROFILE` | ~ PARTIAL (matches REQUIREMENTS.md) | Resolution order + installer proven offline; RB-03-03 live auth OUTSTANDING |
| PROV-05 | 03-08 | Actionable SSO message, non-retryable | ✓ SATISFIED | `message_end` handler + classifier + `tests/integration/sso-classifier.test.ts` |
| PROV-06 | 03-01, 03-02, 03-04, 03-11 | Accurate capability metadata, no cross-provider inheritance | ~ PARTIAL (matches REQUIREMENTS.md) | Invariant complete and enforced; real numbers RB-03-05 OUTSTANDING |
| PROV-07 | 03-01, 03-05, 03-11 | R1 experiment executable, pre-committed threshold | ~ PARTIAL (matches REQUIREMENTS.md) | Unclamp + selection proven offline; RB-03-04 run OUTSTANDING |
| PROV-08 | 03-01, 03-10 | Fallback chain quota/transient/unavailable | ✓ SATISFIED | `callWithFallback` + `tests/integration/fallback-chain.test.ts`, mutation-tested clean in 03-REVIEW.md |
| PROV-09 | 03-11 | Runbook documenting every credential-dependent check | ✓ SATISFIED | `docs/RUNBOOK.md`, 11 entries, machine-enforced statuses |
| PROV-10 | 03-03, 03-09, 03-11 | Two-turn tool-calling sequence against DashScope returns 200 | ~ PARTIAL (matches REQUIREMENTS.md) | Mechanism proven on real bytes; RB-03-02 provider acceptance OUTSTANDING |

No orphaned requirements — all 10 PROV IDs declared across plan frontmatter match REQUIREMENTS.md exactly, and the phase's own traceability table (`.planning/REQUIREMENTS.md:250-259`) agrees with the roadmap checkbox annotations.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any Phase 3 file (`.pi/extensions/providers/*.ts`, `.pi/templates/*.json`, `bin/bootstrap.sh`, `docs/RUNBOOK.md`) | — | None — reviewed by iteration-3 code review with 0 findings |

`03-REVIEW.md` (iteration 3, final, `status: clean`, 0 critical/warning/info) independently ran 7 mutation-testing passes against the working tree and restored it byte-identical each time (`sha256sum -c`). This verification did not re-run those mutations (out of scope for a goal-backward pass) but did independently: run the full test suite (655/655 passed), run `tsc --noEmit` (clean), read the production source of `fallback.ts`, `sso.ts`, `index.ts` end-to-end, and grep the full tracked file set for secret shapes.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npx vitest run` | 45 files, 655 tests, all passed, 25.5s | ✓ PASS |
| Type-checking | `npx tsc --noEmit` | No output (clean) | ✓ PASS |
| No `!command` in `models-template.json` | `grep -n '"!' .pi/templates/models-template.json` | No matches | ✓ PASS |
| No secret shapes in tracked files | `git ls-files \| xargs grep -lIE 'AKIA...\|sk-...'` | No matches | ✓ PASS |
| Working tree clean | `git status --porcelain` | Empty | ✓ PASS |
| All `RB-03-xx` read OUTSTANDING | Direct read of `docs/RUNBOOK.md` table + status lines | All 5 read OUTSTANDING, none PASSED | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files exist for this phase; PLAN/SUMMARY files reference no probe scripts. Skipped — no conventional or declared probes for Phase 3.

### Human Verification Required

The following five items are pre-authorised, expected, credential-dependent
checks. They are documented in `docs/RUNBOOK.md` with exact commands and
expected output and correctly read `OUTSTANDING`. They are listed here per
the Escalation Gate contract, not as gaps.

### 1. RB-03-01 — DashScope accepts the explicit `compat` block on the wire

**Test:** Run one ordinary turn against `dashscope/deepseek-v4-flash` on the work laptop; read the wire dump.
**Expected:** `main.response` status 200; `main.request` payload carries `enable_thinking`, top-level `reasoning_effort`, `max_tokens`, and lacks `store`, `developer`-role messages, `strict`, `prompt_cache_key`/`prompt_cache_retention`.
**Why human:** Requires a live DashScope credential and network egress to `aliyuncs.com`. Not available on this machine.

### 2. RB-03-02 — Two-turn tool-calling sequence returns 200 on the second turn

**Test:** Ask DashScope a prompt that forces two tool turns; read both `main.request`/`main.response` records.
**Expected:** Second request carries a replayed assistant message with `tool_calls` and `reasoning_content`; a `main.response` with status 200 follows.
**Why human:** Requires a live DashScope credential; the failure mode is provider-side and cannot be produced by a loopback server that accepts everything.

### 3. RB-03-03 — Bedrock authenticates from a fresh shell

**Test:** Configure `pi auth login` with an AWS profile, open a new shell with nothing exported, run one turn against a Bedrock Claude model.
**Expected:** A turns row with `outcome: "ok"` and non-zero tokens. Also record one live SSO-expiry observation (error text + whether the reauth line appeared).
**Why human:** Requires a real IAM Identity Center SSO session. Not available on this machine.

### 4. RB-03-04 — The R1 experiment

**Test:** With the `modelOverrides` unclamp applied, send the same fixed prompt at `reasoning_effort: "low"` and `"high"` against DeepSeek-direct; record both `main.request` payloads and both turns rows.
**Expected:** One of four pre-defined outcomes (accepted-and-cheaper / accepted-but-not-cheaper / rejected / no breakdown reported), evaluated against the pre-committed threshold `low.reasoning <= 0.6 * high.reasoning`.
**Why human:** Requires a live DeepSeek-direct credential and a real token count; cannot be desk-work.

### 5. RB-03-05 — Real DashScope context cap and per-token price

**Test:** Log into the Model Studio console, read the real cost and `maxTokens` figures for `dashscope/deepseek-v4-flash` and `dashscope/deepseek-v4-pro`, write them into the template, and remove the models from `COST_UNVERIFIED` in the same commit.
**Expected:** `npx vitest run tests/unit/model-metadata.test.ts` exits 0 after the edit; `pi --list-models` shows DashScope and built-in DeepSeek entries with different numbers.
**Why human:** Requires a Model Studio console login this machine does not have.

### Gaps Summary

No gaps. Nothing was found to be genuinely un-built. Every artifact required
for the phase's offline-provable scope exists, is substantive, and is wired;
every requirement's offline half is satisfied; the five `RB-03-xx` runbook
entries are correctly documented and correctly left `OUTSTANDING` rather than
being claimed as passed on the strength of a green offline test. The status
is `human_needed` solely because those five entries require live credentials
this machine does not have — the exact, pre-authorised outcome for this phase
per the autonomous-run standing policy.

---

_Verified: 2026-08-14T02:30:00Z_
_Verifier: Claude (gsd-verifier)_
