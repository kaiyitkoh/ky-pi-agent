---
phase: 05-routing-capability-guards
plan: 05
subsystem: routing
tags: [routing, subagents, settings-write, pi-extensions, typescript]

# Dependency graph
requires:
  - phase: 05-01
    provides: "routing/schema.ts's ROLE_MAP, ROLE_MECHANISM, AGENT_NAME_BY_ROLE, KyModeData"
  - phase: 05-02
    provides: "routing/guard.ts's guardRoute(), GuardNeed -- the capability check agentOverridesFor runs before a pin is written"
provides:
  - ".pi/extensions/routing/agent-overrides.ts -- agentOverridesFor, resolveSettingsPath, writeAgentOverrides"
  - "tests/unit/agent-overrides.test.ts -- shape, refusal, preservation and idempotence proof against real files, 20 cases"
affects: [05-06, 07 (subagent package wiring, PHASE 7 RE-VERIFICATION note), docs/ROUTING.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Validated settings.json read-modify-write in TypeScript, ported from bin/bootstrap.sh#merge_settings' bash+node idiom: refuse-on-invalid-JSON, refuse-on-non-object, replace-only-the-owned-key, byte-idempotent no-op"
    - "A pure derivation function (agentOverridesFor) builds a structural Model<Api> fixture from a {provider,id} pair to feed a capability guard, rather than requiring a ctx/registry lookup -- sound here because only usesToolLoop is ever set on the guard's need argument"
    - "Test-only injection seam (AgentOverridesForOptions) on an otherwise-pure function, defaulting to the real module tables, so a guard-blocked fixture case never mutates the shared ROLE_MAP singleton other routing tests also import"

key-files:
  created:
    - .pi/extensions/routing/agent-overrides.ts
    - tests/unit/agent-overrides.test.ts
  modified: []

key-decisions:
  - "The write target is the GLOBAL getAgentDir()/settings.json, never the project-scoped git-tracked .pi/settings.json -- resolves 05-RESEARCH.md Assumption A1 per the plan's own instruction (do not defer, do not ask): a project-scoped write would dirty this public repo's tree on every mode switch, bootstrap.sh#merge_settings already established the global file as this project's settings write target, and SAFE-11 already established that subagent-visible config belongs at user scope since subagents spawn headless with no project trust"
  - "agentOverridesFor runs guardRoute against a structural Model<Api> fixture built from each candidate's {provider,id}, not a real registry lookup -- sound because the function stays pure (no ctx) and the only need field it ever sets is usesToolLoop:true, so only guardRoute's block 4 (the ROUTE-08 deny-list, keyed on model.id) can ever fire through this call path regardless of the fixture's other field values"
  - "agentOverridesFor gained an injectable AgentOverridesForOptions seam (roleMap/roleMechanism/agentNameByRole) beyond the plan's literal (state: KyModeData) signature -- production code never passes it; it exists because the plan's own test requirement (a fixture role map whose only candidate is guard-blocked) cannot be satisfied by mutating the real ROLE_MAP module singleton without corrupting every other routing test that imports it"
  - "Authentication is deliberately not checked in agentOverridesFor -- hasConfiguredAuth needs a ctx this pure function does not accept, and an unauthenticated subagent pin is inert (nothing reads settings.subagents.agentOverrides yet -- pi-subagents is not installed until Phase 7) rather than a silent-degradation bug; capability is a static, checkable-without-a-session property, auth is not"

patterns-established:
  - "A settings-write refusal is proven by an unchanged-bytes assertion, never merely an ok:false check -- every refusal case in tests/unit/agent-overrides.test.ts re-reads the file after the call and compares it byte-for-byte against what was there before"
  - "Byte-idempotence is proven by mtimeMs equality across two identical writes, with a real (not same-tick) delay between them, not by content equality alone"

requirements-completed: [ROUTE-05]

# Metrics
duration: ~25min
completed: 2026-08-14
---

# Phase 5 Plan 5: Subagent Agent-Overrides Write (agent-overrides.ts) Summary

**Pure derivation of `settings.subagents.agentOverrides` from the same `ROLE_MAP` the session uses, gated by the capability guard before a pin is written, plus a validated read-modify-write against the global agent settings file ported from `bin/bootstrap.sh#merge_settings`'s refuse-rather-than-coerce discipline — proven against real files in a temp directory with a byte-level falsification.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-14T14:05Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments

- `.pi/extensions/routing/agent-overrides.ts` exports `agentOverridesFor` (pure: derives the override object from `ROLE_MAP`/`ROLE_MECHANISM`/`AGENT_NAME_BY_ROLE`, running every subagent role's ordered candidates through `guardRoute` and picking the first that passes, refusing with a role-naming reason when none do), `resolveSettingsPath` (injected path when given, otherwise `join(getAgentDir(), "settings.json")` — the global file, honouring `PI_CODING_AGENT_DIR`), and `writeAgentOverrides` (the validated read-modify-write: refuse on invalid JSON or non-object, replace only `subagents.agentOverrides`, preserve every sibling key, skip the write when byte-identical).
- The write target decision (global vs project-scoped `.pi/settings.json`) is resolved and documented inline per the plan's own instruction, with all three reasons written into the module docstring rather than deferred.
- `tests/unit/agent-overrides.test.ts` (20 cases) proves: the key set equals `AGENT_NAME_BY_ROLE`'s values; every model carries a `/` separator; a regression gate over all three real modes (`cheap`/`balanced`/`max`) asserting the actual `ROLE_MAP` never guard-blocks a subagent pin today; a paired guard-blocked fixture (planner's only candidate is `amazon-bedrock/us.deepseek.r1-v1:0`) yields `ok:false` naming the role and "tool calling", with `writeAgentOverrides` never reached and no settings file created; the default-path branch resolves under an injected `PI_CODING_AGENT_DIR`; creation of a missing file; byte-for-byte preservation of `kyPiAgent` and `subagents.defaultModel` siblings; five refusal cases (invalid JSON, top-level array, top-level null, non-object `subagents`, array-typed `subagents`) each asserting the file's exact bytes are unchanged; and byte+mtime idempotence across two identical writes with a real 20ms delay between them.
- Both structural gates pass: `chokepoint-lint.test.ts` (no forbidden `modelRegistry.complete`/`.stream`/`.getProvider`/`ModelRuntime`, including in comments) and `extension-layout.test.ts` (named-exports-only module correctly classified as a nested, non-entry-point file).
- Falsification executed per the plan's acceptance criteria: the merge step was mutated from `subagents.agentOverrides = overrides` (preserving siblings) to `root.subagents = { agentOverrides: overrides }` (replacing the whole `subagents` object). Ran `tests/unit/agent-overrides.test.ts` and got exactly one targeted failure — `"preserves kyPiAgent and subagents.defaultModel byte-for-byte..."` (`AssertionError: expected undefined to be 'dashscope/deepseek-v4-pro'`) — with the other 19 cases unaffected. Restored; `git diff --stat` after restoration was empty, and the full 20-case file re-ran green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write `.pi/extensions/routing/agent-overrides.ts`** — `a26852a` (feat)
2. **Task 2: `tests/unit/agent-overrides.test.ts`** — `acc1ae2` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/routing/agent-overrides.ts` — ROUTE-05's derivation + validated settings write
- `tests/unit/agent-overrides.test.ts` — shape/refusal/preservation/idempotence proof, 20 cases

## Verification Evidence

- `npx vitest run tests/unit/agent-overrides.test.ts tests/unit/chokepoint-lint.test.ts tests/unit/extension-layout.test.ts` — 3 files / 36 tests, all green
- `npm run typecheck` (`tsc --noEmit`) — clean, no output, both before and after the falsification restore
- `git status --porcelain .pi/settings.json` — empty after the full test run (the tests never touched the tracked project settings file)
- `npx vitest run` (full suite) — **72 test files, 1292 tests, all passed** (33.42s)
- Acceptance-criteria greps against `agent-overrides.ts`: `modelRegistry\s*\.\s*(complete|completeSimple|stream|streamSimple|getProvider)|getRegisteredNativeProvider|ModelRuntime` → 0 matches; `guardRoute` import present; `getAgentDir` + literal `"settings.json"` present; `PHASE 7` note present naming EXT-08

## Decisions Made

- **The write target is the global `getAgentDir()/settings.json`**, resolving 05-RESEARCH.md's Assumption A1 per the plan's explicit instruction not to defer it. Documented inline with all three reasons: the project-scoped file is git-tracked at `{}` in this public repo (a project-scoped write would dirty the tree on every mode switch); `bin/bootstrap.sh#merge_settings` already established the global file as this project's settings write target; SAFE-11 already established subagent-visible config belongs at user scope.
- **`agentOverridesFor` builds a structural `Model<Api>` fixture rather than performing a registry lookup**, because it must stay pure (no `ctx`) to match `guard.ts`'s own purity discipline. This is sound, not a shortcut: the only `need` field the function ever sets is `usesToolLoop: true`, and reading `guardRoute`'s own blocks shows blocks 1-3 each gate on a `need` field (`image`, `estimatedInputTokens`, `thinkingRequested`) that is never set here — so only block 4 (the ROUTE-08 deny-list, keyed on `model.id` and `usesToolLoop`) can ever fire through this call path, and the fixture's other field values are provably irrelevant to the outcome.
- **`agentOverridesFor` gained an injectable `AgentOverridesForOptions` seam** (`roleMap`/`roleMechanism`/`agentNameByRole`, all defaulting to the real `schema.ts` exports) beyond the plan's literal `agentOverridesFor(state: KyModeData)` signature. This was necessary, not scope creep: the plan's own test requirement ("a fixture role map whose only subagent candidate is `bedrock/us.deepseek.r1-v1:0` yields `ok:false`") cannot be satisfied by mutating the real, shared `ROLE_MAP` module singleton without corrupting every other routing test file that also imports it (`routing-map.test.ts`, `routing-dispatch.test.ts`, `capability-guard.test.ts`). Production code (a future `modes.ts`/`index.ts` mode-switch command) never passes these options.
- **Authentication is deliberately not checked**, per the plan's own instruction — documented inline with the reason: capability is a static property checkable without a session; an unauthenticated pin is inert because nothing reads `settings.subagents.agentOverrides` until Phase 7 installs the `pi-subagents` package.

## Deviations from Plan

None affecting scope or correctness. The one addition beyond the plan's literal export list — `AgentOverridesForOptions` (and the type exports `AgentOverrideEntry`, `AgentOverrides`, `AgentOverridesResult`, `AgentOverridesPathOptions`, `WriteAgentOverridesResult`) — is the test-injection seam described above under Decisions Made, required to satisfy the plan's own stated test behavior without corrupting shared module state, and the option/result types those exported functions' own signatures require callers to reference (matching plan 05-04's own precedent for this class of addition).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- ROUTE-05 is complete: subagent-mechanism roles get an explicit, guard-checked model pin derived from the active mode's `ROLE_MAP`, written to a validated, byte-idempotent global settings file that never dirties this repository's tracked `.pi/settings.json`.
- `agent-overrides.ts` is ready for a later plan's `routing/index.ts` (the mode-switch commands) to import `agentOverridesFor`/`writeAgentOverrides` and call them alongside `pi.setModel()` on every mode switch — that wiring (and its own [FAUX] session-level proof) is not this plan's scope.
- **PHASE 7 RE-VERIFICATION obligation is recorded where Phase 7 will read it**: the module's own docstring states plainly that the written shape (`{ "<agentName>": { "model": "<provider>/<id>" } }` under `subagents.agentOverrides`) is ARCHITECTURE.md's documented precedence-chain shape and a forward-compatible best guess, not verified against the real `pi-subagents` package (not yet installed), and names EXT-08 as the requirement that obligates Phase 7 to re-verify it before relying on it unchanged.
- Full repo suite verified green after this plan: 1292 tests / 72 files, `tsc --noEmit` clean.
- No blockers for the next plan in wave 2.

## Self-Check: PASSED

- FOUND: `.pi/extensions/routing/agent-overrides.ts`
- FOUND: `tests/unit/agent-overrides.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-05-SUMMARY.md`
- FOUND commit: `a26852a` (Task 1)
- FOUND commit: `acc1ae2` (Task 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
