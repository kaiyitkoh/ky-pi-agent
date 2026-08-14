---
phase: 05-routing-capability-guards
verified: 2026-08-14T19:35:00Z
status: human_needed
score: 5/5 must-haves verified in-repo (1 item's live-service half is an OUTSTANDING [RUNBOOK] item, pre-authorised by policy)
overrides_applied: 0
human_verification:
  - test: "RB-05-01 — Qoder delegates a task and folds the result back through the real Cloud Agents API"
    expected: "A real QODER_PERSONAL_ACCESS_TOKEN + QODER_AGENT_ID + QODER_ENVIRONMENT_ID against api.qoder.com returns a non-empty folded agent.message result, and the redacted .pi/logs/qoder-*.jsonl transcript shows done:true with stop_reason.type === 'end_turn'."
    why_human: "No QODER_PERSONAL_ACCESS_TOKEN, no pre-configured agent/environment, and no network egress to api.qoder.com exist on this machine, and the standing policy for this run forbids any network request to that host. Only a real PAT against the real service can prove the harness's SSE-envelope assumptions (documented as UNVERIFIED in qoder/client.ts) hold against production. Procedure is docs/RUNBOOK.md → RB-05-01, marked OUTSTANDING in both the summary table (line 935) and its own Status line (line 939), which tests/unit/docs-policy.test.ts enforces stay consistent."
---

# Phase 5: Routing & Capability Guards Verification Report

**Phase Goal:** The user chooses which model does which job explicitly, and the harness refuses routes that are impossible rather than degrading silently.
**Verified:** 2026-08-14T19:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/cheap`/`/balanced`/`/max` swap the whole role→model map across all six roles, and the wire dump proves the intended model actually served the next turn | ✓ VERIFIED | `.pi/extensions/routing/schema.ts` `ROLE_MAP` covers executor/planner/reviewer/advisor/vision/summariser × cheap/balanced/max explicitly (no inheritance). `.pi/extensions/routing/index.ts` `applyMode` drives `pi.setModel()` after `waitForIdle()`. `tests/integration/wire-proof.test.ts` drives TWO real switches to TWO different models, reads `turns-*.jsonl`/`wire-*.jsonl` off disk (never a `setModel` spy — grep confirms zero calls, only docstring mentions), position-slices rows (never role-filters, closing RESEARCH Pitfall 1), joins nested rows by `corr`, and includes a registered-but-never-routed negative-control model absent from both logs paired with a positive control present in both. |
| 2 | Mode survives a restart at zero context-token cost, and `/escalate` is visible and sticky until explicitly cleared | ✓ VERIFIED | `tests/integration/mode-persistence.test.ts` case 1/2 prove `restoreModeFromBranch` restores mode+escalation from a real branch (last-write-wins, case 2), case 3 proves a corrupted `mode` value falls back to `DEFAULT_MODE` without throwing. Case 4 proves the `ky:mode` marker string is absent from every captured outgoing payload after a real turn AND present when sent as ordinary user content (positive control — closes the "instrument reads nothing" trap). `/escalate` (`applyEscalate` in `index.ts`) sets sticky `globalThis`-keyed state that persists across turns until `/escalate off`; `/mode` command prints it read-only. |
| 3 | Impossible routes are refused with a reason: image→text-only, oversized context→small window, Bedrock non-Claude+thinking (silently dropped by Pi), Bedrock DeepSeek R1 as executor | ✓ VERIFIED | `.pi/extensions/routing/guard.ts` implements all four blocks as an ordered pure predicate, citing exact pi-ai 0.84.1 source lines (`bedrock-converse-stream.js:889-927`, `:542-550`). `tests/unit/capability-guard.test.ts` uses REAL catalogue-verified fixtures (`withModelsConfig` against the full pi-ai catalogue + shipped DashScope template, `requireModel` throws-not-undefined) with a paired negative control for every block and reason-string assertions (never bare `ok===false`). ROUTE-08's deny-list (`deepseek.r1-v1:0`, `us.deepseek.r1-v1:0`) is scoped by `need.usesToolLoop`, derived from role mechanism, not role name — confirmed in `modes.ts`'s `usesToolLoop()`. |
| 4 | Single-shot roles run through `callModel()` with per-call reasoning effort and no session mutation; tool-loop roles run as subagents | ✓ VERIFIED | `.pi/extensions/routing/modes.ts` `runSingleShotRole` dispatches only to `callModel()`/`callWithFallback()` (Phase 2's chokepoint), never a direct-completion route (`chokepoint-lint.test.ts` scans `routing/` with no exemption and passes). `planner` is `ROLE_MECHANISM.subagent`. `tests/integration/single-shot-roles.test.ts` asserts `ctx.model` is byte-identical (provider+id) before and after the nested call. `tests/unit/routing-dispatch.test.ts` proves the pure planning pipeline at the unit level. |
| 5 | Qoder accepts a delegated task and folds the result back, verified live on the work laptop, documented as a foreign agent | ⚠ RUNBOOK OUTSTANDING (pre-authorised) | The delegate tool is fully built and registered (`.pi/extensions/qoder/{client,index}.ts`) — pure config resolution, tolerant incremental SSE parser, three-step Cloud Agents HTTP sequence, redacted transcript — and proven offline against a real `127.0.0.1` HTTP+SSE loopback fixture (`tests/integration/qoder-delegate.test.ts`, `tests/unit/qoder-client.test.ts`). Documented as a foreign agent bypassing tools/AGENTS.md/safety hooks/wire inspector in both the tool description and `docs/ROUTING.md` §6. The LIVE half against `api.qoder.com` is `RB-05-01` in `docs/RUNBOOK.md`, correctly marked OUTSTANDING in both the summary table (line 935) and its own `**Status:**` line (line 939) — consistent, per `tests/unit/docs-policy.test.ts`. This machine has no PAT, no agent/environment ids, and no network egress to `api.qoder.com`, and the standing run policy forbids that request. This is a [RUNBOOK] item (RB-05-01) that cannot be discharged in this environment by design — expected and pre-authorised. |

**Score:** 5/5 in-repo truths verified; 1 (#5) has a live-service half correctly deferred to a human-run runbook item, per phase design.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.pi/extensions/routing/schema.ts` | Role→model map, mode vocabulary, mechanism table | ✓ VERIFIED | 337 lines; `ROLE_MAP` covers 6 roles × 3 modes explicitly; `ROLE_MECHANISM`, `AGENT_NAME_BY_ROLE`, `MODE_ENTRY_TYPE` all present and used downstream |
| `.pi/extensions/routing/guard.ts` | Four hard-block pure predicates | ✓ VERIFIED | 269 lines; `guardRoute` implements all four blocks in order; deny-list + residual-coupling documented and pinned by tests |
| `.pi/extensions/routing/modes.ts` | State, resolution, single-shot dispatch | ✓ VERIFIED | 397 lines; `globalThis`-keyed state (documented jiti-copy hazard), `planRoleCall` pure pipeline, `runSingleShotRole` impure dispatch through the chokepoint |
| `.pi/extensions/routing/agent-overrides.ts` | `settings.subagents.agentOverrides` read-modify-write | ✓ VERIFIED | 428 lines; guard-gated candidate selection, ported read-modify-write discipline from `bin/bootstrap.sh#merge_settings`, byte-idempotent write skip |
| `.pi/extensions/routing/index.ts` | `/cheap`/`/balanced`/`/max`/`/escalate`/`/mode` commands + restart restore | ✓ VERIFIED | 610 lines; shared `applyMode`/`applyEscalate` pre-flight→guard→setModel→persist ordering; `restoreModeFromBranch` exported and directly tested |
| `.pi/extensions/qoder/client.ts` | Config resolution, SSE parser, HTTP client | ✓ VERIFIED | 646 lines; official-API-only, zero runtime deps beyond `fetch`, redaction via `diagnostics/redact.ts` |
| `.pi/extensions/qoder/index.ts` | Registered `qoder_delegate` tool | ✓ VERIFIED | 140 lines; single tool registration, allowlisted in `contributing-boundary.test.ts` |
| `docs/ROUTING.md` | User-facing routing documentation | ✓ VERIFIED | Role table, four refusals, persistence cost, Qoder foreign-agent statement, limits section |
| `docs/RUNBOOK.md` RB-05-01 | Live Qoder check, OUTSTANDING | ✓ VERIFIED | Present, consistent OUTSTANDING status in table + Status line |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `/cheap`,`/balanced`,`/max` commands | `pi.setModel()` | `applyMode` in `index.ts` | ✓ WIRED | Guarded by `waitForIdle()` → resolve → guard → setModel try/catch with explicit boolean check |
| Mode switch | `settings.subagents.agentOverrides` | `agentOverridesFor` + `writeAgentOverrides` | ✓ WIRED | Called from `applyMode`, refusal surfaced in the same notify message, never silently dropped |
| `runSingleShotRole` | Phase 2 chokepoint (`callModel`/`callWithFallback`) | `modes.ts` | ✓ WIRED | `chokepoint-lint.test.ts` confirms no bypass route exists in `routing/` |
| `guardRoute` | Mode-switch and single-shot dispatch | `planRoleCall`, `applyMode`, `applyEscalate`, `agentOverridesFor` | ✓ WIRED | Guard called on every one of the three mechanisms' write paths, including the subagent pin path (load-bearing, not decorative — confirmed by reading `agent-overrides.ts`) |
| `session_start` | `restoreModeFromBranch` | `index.ts` | ✓ WIRED (documented as unexercised by this repo's headless harness; directly unit-tested instead) | Best-effort try/catch wrapper; function itself proven against real branch data in `mode-persistence.test.ts` |
| `qoder_delegate` tool | `delegateTask`/`resolveQoderConfig` | `qoder/index.ts` | ✓ WIRED | Env vars read at the one call site; refusal path throws actionable `Error` |

### Data-Flow Trace (Level 4)

Not applicable in the UI-rendering sense (no dynamic-data component in this phase); the equivalent trace for this phase's dispatch logic is the wire-proof and mode-persistence tests above, which read real disk artifacts (`turns-*.jsonl`, `wire-*.jsonl`, session branch) rather than asserting on an in-memory spy.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase-5 test slice | `npx vitest run tests/unit/routing-map.test.ts tests/integration/mode-switch.test.ts tests/integration/escalate.test.ts tests/integration/single-shot-roles.test.ts tests/unit/agent-overrides.test.ts tests/unit/capability-guard.test.ts tests/integration/mode-persistence.test.ts tests/integration/wire-proof.test.ts tests/integration/qoder-delegate.test.ts tests/unit/qoder-client.test.ts tests/unit/routing-dispatch.test.ts tests/unit/docs-policy.test.ts` | 12 files, 236 tests passed | ✓ PASS |
| Full repository test suite | `npx vitest run` | 78 files, 1346 tests passed | ✓ PASS |
| TypeScript strict compile | `npx tsc --noEmit` | No output (clean) | ✓ PASS |
| Boundary/lint suite (tool-registration allowlist, chokepoint scan, extension layout) | `npx vitest run tests/unit/contributing-boundary.test.ts tests/unit/chokepoint-lint.test.ts tests/unit/extension-layout.test.ts` | 3 files, 21 tests passed | ✓ PASS |
| `setModel` spy check in wire-proof.test.ts (per validation contract §Sign-Off) | `grep -n "setModel" tests/integration/wire-proof.test.ts` | Only appears inside docstring prose explaining why a spy is forbidden — zero calls | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventions or PLAN/SUMMARY-declared probes exist for this phase. SKIPPED (no runnable probe scripts — this phase's proof mechanism is the vitest integration suite reading real disk artifacts, itself directly executed above).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ROUTE-01 | 05-01, 05-04 | Role→model map, no auto-classification | ✓ SATISFIED | `schema.ts` `ROLE_MAP`; `tests/unit/routing-map.test.ts` |
| ROUTE-02 | 05-07 | `/cheap`/`/balanced`/`/max` via `waitForIdle()`+`setModel()` | ✓ SATISFIED | `index.ts` `applyMode`; `tests/integration/mode-switch.test.ts` |
| ROUTE-03 | 05-09 | `/escalate` sticky, visible | ✓ SATISFIED | `index.ts` `applyEscalate`; `tests/integration/escalate.test.ts` |
| ROUTE-04 | 05-04, 05-08 | Single-shot roles via `callModel()`, no session mutation | ✓ SATISFIED | `modes.ts` `runSingleShotRole`; `tests/unit/routing-dispatch.test.ts` + `tests/integration/single-shot-roles.test.ts` |
| ROUTE-05 | 05-05 | Subagent pins via `settings.subagents.agentOverrides` | ✓ SATISFIED | `agent-overrides.ts`; `tests/unit/agent-overrides.test.ts` |
| ROUTE-06 | 05-02 | Image/context-window hard blocks | ✓ SATISFIED | `guard.ts` blocks 1-2; `tests/unit/capability-guard.test.ts` |
| ROUTE-07 | 05-02 | Bedrock non-Claude+thinking hard block | ✓ SATISFIED | `guard.ts` block 3; `tests/unit/capability-guard.test.ts` |
| ROUTE-08 | 05-02 | Bedrock DeepSeek R1 tool-loop hard block | ✓ SATISFIED | `guard.ts` block 4 (deny-list); `tests/unit/capability-guard.test.ts` |
| ROUTE-09 | 05-07, 05-10 | Restart persistence, zero context tokens | ✓ SATISFIED | `index.ts` `restoreModeFromBranch`; `tests/integration/mode-persistence.test.ts` |
| ROUTE-10 | 05-11 | Wire dump proves the model served | ✓ SATISFIED | `tests/integration/wire-proof.test.ts` (scrutinised above — reads disk, not a spy) |
| ROUTE-11 | 05-03, 05-06, 05-12 | Qoder delegate tool + foreign-agent documentation + live check | ⚠ [RUNBOOK] OUTSTANDING (expected) | Tool built, offline-proven, documented; `RB-05-01` correctly OUTSTANDING |

No orphaned requirements: `.planning/REQUIREMENTS.md` lines 276-286 map exactly these 11 IDs to Phase 5, all accounted for across the 12 plans' `requirements:` frontmatter.

### Anti-Patterns Found

None. `grep` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|placeholder|not yet implemented|coming soon` across `.pi/extensions/routing/*.ts`, `.pi/extensions/qoder/*.ts`, and `docs/ROUTING.md` returned zero matches.

### Human Verification Required

### 1. RB-05-01 — Qoder delegates a task and folds the result back (live)

**Test:** On the work laptop, export `QODER_PERSONAL_ACCESS_TOKEN`, `QODER_AGENT_ID`, `QODER_ENVIRONMENT_ID`, start `pi` in this repository, and ask the model to delegate a small task via `qoder_delegate` (e.g., "reply with the single word OK"). Then read `.pi/logs/qoder-$(date +%F).jsonl`.

**Expected:** The tool returns a non-empty folded `agent.message` result as tool content; the transcript's `qoder.delegate.result` record shows `done: true` with `stop_reason.type === "end_turn"`. A `401`/`403` on any request means the PAT/ids are wrong, not transient.

**Why human:** No credentials or network egress to `api.qoder.com` exist on this machine, and this run's standing policy forbids any request to that host. This is `RB-05-01`, a [RUNBOOK] item, and per this phase's own validation contract (`05-VALIDATION.md` row `ROUTE-11 (RUNBOOK half)`) it is **OUTSTANDING by construction** — no test in this repository may be read as discharging it. This is expected and pre-authorised; it does not indicate anything unbuilt.

### Gaps Summary

No gaps. Every truth this phase's roadmap success criteria name is either VERIFIED against real, non-tautological evidence (wire records read from disk, catalogue-verified model fixtures, positive/negative controls throughout) or is the one deliberately-deferred [RUNBOOK] item (`RB-05-01`) that this environment cannot and — per the standing policy — must not attempt to discharge. The `human_needed` status is caused solely by that single pre-authorised outstanding runbook item.

Notably, this phase's test suite is unusually rigorous for a codebase at this stage: every absence claim (zero-context-token proof, negative-control model absent from logs) is paired with a positive control proving the same instrument would have caught the marker if present, and the wire-proof test explicitly closes the "role-filter passes vacuously" and "single-switch proves nothing" traps this project's own RESEARCH notes anticipated. No stub, tautological assertion, or unwired artifact was found during this review.

---

_Verified: 2026-08-14T19:35:00Z_
_Verifier: Claude (gsd-verifier)_
