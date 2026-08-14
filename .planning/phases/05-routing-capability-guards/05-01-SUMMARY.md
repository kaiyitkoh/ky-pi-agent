---
phase: 05-routing-capability-guards
plan: 01
subsystem: routing
tags: [routing, model-selection, pi-extensions, typescript, role-map]

# Dependency graph
requires:
  - phase: 02-diagnostics-chokepoint
    provides: callModel() chokepoint (diagnostics/call-model.ts) — routing's single-shot roles will call it, never modelRegistry.complete directly
  - phase: 03-provider-config
    provides: .pi/templates/models-template.json (DashScope deepseek-v4-flash/-pro), providers/fallback.ts CHAIN pattern, tests/helpers/models.ts#withModelsConfig
provides:
  - ".pi/extensions/routing/schema.ts — ROLES, MODES, ROLE_MECHANISM, ROLE_MAP, DEFAULT_MODE, ESCALATION_MODE, MODE_ENTRY_TYPE, ROUTING_EVENT, AGENT_NAME_BY_ROLE"
  - "tests/unit/routing-map.test.ts — coverage, resolvability, vision-capability and no-auto-classification proof, 45 cases"
affects: [05-02, 05-03, 05-04, 05-05, docs/ROUTING.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure constants-module table (schema.ts), named exports only, no default export — matches providers/schema.ts and diagnostics/schema.ts"
    - "withModelsConfig as the single composed-registry oracle for ALL providers (DashScope, DeepSeek-direct, Bedrock) — no second hand-rolled catalogue reader needed"

key-files:
  created:
    - .pi/extensions/routing/schema.ts
    - tests/unit/routing-map.test.ts
  modified: []

key-decisions:
  - "vision role routes to amazon-bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0 (catalogue-verified: input includes image, contextWindow 200000) since both DashScope daily-driver models are input:[\"text\"] only"
  - "withModelsConfig's composed registry resolves Pi's built-in Bedrock and DeepSeek-direct catalogue entries through the same registry.find() call as the DashScope template entries — verified live (node -e probe, 1220 total models, Bedrock Claude resolved with input:[text,image]) — so RESEARCH's suggested second JSON-reading oracle for Bedrock was unnecessary and not built"
  - "planner is ROLE_MECHANISM.subagent, stated inline in schema.ts as the reasoning (reads files, needs a tool loop) so it cannot later be simplified to call-model"
  - "reasoningEffort is a per-role constant (reviewer/advisor: high; others: none), identical across cheap/balanced/max in every case — respects STATE.md's open blocker R1 (modes differ by model, never thinking tier)"
  - "KyModeData scoped to {mode, escalated, escalatedFrom?, at} only — Pi's own model_change session entry already persists/restores the executor's actual model natively, so schema.ts does not model that"

patterns-established:
  - "Role→model map is a static, mode-keyed table with no inheritance between modes — every (mode, role) pair is a literal line, per 05-CONTEXT.md's 'no auto-classification' decision"
  - "No-auto-classification is machine-enforced via a pinned export list PLUS an independent /classif|detect|infer|guess/i regex over the module's runtime exports"

requirements-completed: [ROUTE-01]

# Metrics
duration: ~35min
completed: 2026-08-14
---

# Phase 5 Plan 1: Role→Model Map Summary

**Pure `routing/schema.ts` table mapping six roles × three modes to catalogue-verified DeepSeek/DashScope/Bedrock model ids, proven fully resolvable and vision-capable by 45 tests over Pi's composed model registry.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-14T05:04:11Z (per STATE.md's recorded execution start)
- **Completed:** 2026-08-14T05:10:58Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments

- `.pi/extensions/routing/schema.ts` exports the ROUTE-01 role→model map: `ROLES` (executor, planner, reviewer, advisor, vision, summariser), `MODES` (cheap, balanced, max), `ROLE_MECHANISM` (set-model / call-model / subagent per role), `ROLE_MAP` (every mode × role pair with an ordered candidate list and a per-role reasoning effort), plus the mode-persistence vocabulary (`DEFAULT_MODE`, `ESCALATION_MODE`, `MODE_ENTRY_TYPE`, `KyModeData`, `ROUTING_EVENT`, `AGENT_NAME_BY_ROLE`).
- Verified live against this machine's installed `pi-ai` Bedrock catalogue that `anthropic.claude-sonnet-4-5-20250929-v1:0` exists, carries `input:["text","image"]`, and is the vision role's assignment in every mode — the vision role is routable by construction, not a refusal.
- `tests/unit/routing-map.test.ts` (45 cases) proves: full role/mode coverage with non-empty candidates; every `{provider,id}` resolves through `withModelsConfig`'s composed registry; vision's first candidate always carries `"image"` in its composed input and no mode ever assigns vision to a `dashscope` model; `ROLE_MECHANISM` matches the three-mechanisms decision exactly; `reasoningEffort` is identical across all three modes for every role; a non-vacuity control (cheap vs. max executor model actually differs); and the no-auto-classification gate (pinned export list + independent regex, both proven live against classifier-shaped fixture names).
- Falsification executed per the plan's acceptance criteria: deleted `ROLE_MAP.cheap.summariser`, confirmed 5 targeted red failures (`ROLE_MAP.cheap.summariser is missing entirely`, etc.), restored via `git checkout --` against the already-committed `schema.ts`, reverified 45/45 green.
- Both structural gates pass: `chokepoint-lint.test.ts` (no forbidden `modelRegistry.complete`/`.stream`/`.getProvider` calls, even in comments) and `extension-layout.test.ts` (named-exports-only module correctly classified as a nested, non-entry-point file).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write `.pi/extensions/routing/schema.ts`** — `b1e80a5` (feat)
2. **Task 2: `tests/unit/routing-map.test.ts`** — `bed265b` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/routing/schema.ts` — ROUTE-01's role→model map, pure table, no I/O
- `tests/unit/routing-map.test.ts` — coverage/resolvability/vision-capability/no-auto-classification proof, 45 cases

## Decisions Made

- **Vision routes to Bedrock Claude, enumerated live rather than guessed.** Ran `node -e` against the installed `pi-ai` package's `dist/providers/data/amazon-bedrock.json` and confirmed `anthropic.claude-sonnet-4-5-20250929-v1:0` exists with `input:["text","image"]`, `contextWindow:200000` before writing it into the map — matching RESEARCH's own citation exactly.
- **One composed-registry oracle for every provider, not two.** RESEARCH suggested that if a Bedrock id "cannot be resolved offline" through `withModelsConfig`, the test should fall back to reading the installed `pi-ai` catalogue JSON directly. A live probe (documented in the test file's own docstring) showed `withModelsConfig({models: TEMPLATE})` composes Pi's FULL built-in catalogue (1220 models, including every Bedrock and DeepSeek-direct entry) alongside the DashScope template entries, all resolvable through the same `registry.find()` call. The test therefore uses one oracle for all three providers, which is simpler and more honest than RESEARCH's contingency plan.
- **`KyModeData` deliberately does not carry the executor model.** Per RESEARCH's NEW FINDING (Pi's native `model_change` session entry already persists and restores the executor model across a restart with zero custom code), `schema.ts`'s persisted shape is scoped to `{mode, escalated, escalatedFrom?, at}` only.

## Deviations from Plan

None — plan executed exactly as written. The one refinement (single composed-registry oracle instead of RESEARCH's suggested Bedrock-specific JSON reader) is a simplification within the plan's own stated discretion ("If a Bedrock id cannot be resolved offline through that handle, do NOT skip the case... resolve Bedrock entries directly against the installed pi-ai catalogue JSON") — the contingency was verified unnecessary before being built, not skipped.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- ROUTE-01 is complete. `ROLE_MAP`, `ROLE_MECHANISM`, `AGENT_NAME_BY_ROLE`, `MODE_ENTRY_TYPE`/`KyModeData`, `ROUTING_EVENT`, `DEFAULT_MODE`/`ESCALATION_MODE` are all in place for later plans in this phase to import and build against — the `guard.ts` capability predicate (05-0X, ROUTE-06/07/08), the mode-switch commands and `modes.ts` dispatcher (ROUTE-02/03/04/09/10), and the `agent-overrides.ts` settings writer (ROUTE-05) all consume this file without needing to re-derive any model id.
- Full repo suite verified green after this plan: 1225 tests / 68 files, `tsc --noEmit` clean.
- No blockers for the next plan in wave 1/2.

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
