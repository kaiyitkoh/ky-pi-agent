---
phase: 05-routing-capability-guards
plan: 11
subsystem: routing
tags: [routing, diagnostics, wire-proof, correlation-id, faux-session, pi-extensions, typescript, jsonl]

# Dependency graph
requires:
  - phase: 05-10
    provides: "routing/index.ts's session_start restore hook and mode-persistence.test.ts's fixture pattern for isolating settings.subagents.agentOverrides writes"
  - phase: 05-07
    provides: "the /cheap, /balanced, /max commands under test and mode-switch.test.ts's measured async-auth-grant pattern (setRuntimeApiKey + waitForConfiguredAuth)"
  - phase: 05-08
    provides: "runSingleShotRole and single-shot-roles.test.ts's identity-guard and no-session-mutation proof this plan's nested case reuses"
  - phase: 02-08
    provides: "diagnostics/turns.ts's composeTurnRow and the TurnRow schema this plan reads back"
  - phase: 02-05
    provides: "diagnostics/wire.ts's main-loop wire capture and the WireRecord schema this plan reads back"
provides:
  - "tests/integration/wire-proof.test.ts -- ROUTE-10's binding proof: the wire dump names the model that actually served a turn, for both the executor path (/balanced -> /max) and the single-shot path (runSingleShotRole), read back from turns-*.jsonl and wire-*.jsonl rather than asserted from a setModel spy"
affects: [05-VALIDATION, docs/ROUTING.md, Phase 8 (quality gates read the same wire dump), Phase 10 (root-cause discrimination reads the same turns log)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two switches, not one, is required to prove routing rather than coincidence -- a single switch's proof would hold even for a router that never changes anything if the session's starting model already matched the target. /balanced and /max resolve DIFFERENT executor candidates in ROLE_MAP (deepseek-v4-flash vs deepseek-v4-pro), so the two observed models are asserted to differ, not merely to exist."
    - "Rows are sliced by POSITION (the count of kind:\"turn\" rows before/after a switch), never filtered by role:\"executor\" -- main-loop rows always carry role:\"session\" (diagnostics/index.ts's SESSION_TURN_ROLE), so a role:\"executor\" filter finds zero rows and passes vacuously. This is RESEARCH's Pitfall 1, and case 4 asserts the constant explicitly across every main-loop row the fixture produces."
    - "The single-shot role's resolved model is deliberately DIFFERENT from the session's own executor model at call time (reviewer resolves to Bedrock Claude in max mode; the session executor is deepseek-v4-pro) -- a nested row naming the right model would prove nothing about routing if the two could never differ."
    - "Nested turns rows and their wire records are joined by corr explicitly, never by array position -- wire.ts's own module docstring states the serial-loop assumption behind correlation ids, and a position-based join would silently depend on that assumption breaking invisibly under a future concurrent path."
    - "A negative control -- a model registered on the faux provider but never a member of any candidate list any route in the fixture resolves -- is asserted absent from both logs, paired with a positive control (a model that WAS routed) so the absence cannot be satisfied by an instrument that reads nothing."
    - "The fixture asserts its own preconditions before running (balanced/max executor ids differ; reviewer's route differs from max's executor route) and throws a diagnostic error naming which ROLE_MAP entry broke the assumption, rather than letting the proof cases fail with an opaque model-mismatch message."
    - "PI_CODING_AGENT_DIR is set to a fresh temp dir for the whole fixture, because a successful executor switch also writes settings.subagents.agentOverrides to getAgentDir()/settings.json, which defaults to this machine's real global Pi settings file when unset -- the same trap tests/integration/mode-switch.test.ts cases 2/4 already avoid."

key-files:
  created:
    - tests/integration/wire-proof.test.ts
  modified: []

key-decisions:
  - "The file was written as one fixture spanning both tasks (Task 1's executor half, Task 2's single-shot half) because Task 2 explicitly extends Task 1's file and shares its session/provider setup -- but committed as two atomic commits by constructing a working Task-1-only intermediate version first (4 passing cases), committing it, then restoring the full 9-case version for the second commit. Both intermediate and final versions were run through vitest and tsc before their respective commits."
  - "ROLE_MAP.balanced.executor.candidates[0] / ROLE_MAP.max.executor.candidates[0] / ROLE_MAP.max.reviewer.candidates[0] are read from the real exported table rather than hardcoded as string literals, so the fixture cannot silently drift from routing/schema.ts's actual role->model map the way a duplicated literal could."
  - "The reviewer faux provider is registered under a SEPARATE provider id (amazon-bedrock) from the executor faux provider (deepseek), matching ROLE_MAP.max.reviewer's real candidate -- this is what makes case 5's \"different from the session executor\" assertion a genuine cross-provider proof rather than a same-provider coincidence."
  - "The header comment states the file's one-line contract (\"a spy proves intent; the wire record proves service\") and is the ONLY place the literal `setModel` appears in the file -- verified by grep after every edit."

patterns-established:
  - "A wire-dump proof for a routed mechanism needs THREE independent proof elements, not one: (a) two distinct outcomes (not one, which could coincide with a no-op), (b) position-based slicing rather than role-based filtering (a filter can silently match nothing), (c) a negative control naming something that was never routed, paired with a positive control naming something that was. Missing any one of the three lets a vacuous or coincidental pass through."

requirements-completed: [ROUTE-10]

# Metrics
duration: ~35min
completed: 2026-08-14
---

# Phase 5 Plan 11: Wire-Dump Proof of Routing Summary

**`tests/integration/wire-proof.test.ts` closes ROADMAP criterion 1's second clause by reading `turns-*.jsonl` and `wire-*.jsonl` off a real faux session's disk after two `/balanced` -> `/max` switches and one `runSingleShotRole(reviewer)` call, proving in nine cases that the model each mechanism intended is the model that actually served the request — never by asserting `setModel` was called.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-14T18:56:00Z
- **Completed:** 2026-08-14T19:02:00Z
- **Tasks:** 2 completed
- **Files modified:** 1 (created)

## Accomplishments

- `tests/integration/wire-proof.test.ts` drives one `createFauxSession` with the real diagnostics extension (main-loop turn/wire capture) and the real routing extension (`/balanced`, `/max`) composed as one user-scope extension. Two faux providers are registered: an executor-tier one under `ROLE_MAP.balanced.executor.candidates[0].provider` (`"deepseek"`) carrying both `balanced`'s and `max`'s executor candidate ids (`deepseek-v4-flash`, `deepseek-v4-pro`) plus a third, never-routed negative-control model id; and a reviewer-tier one under `ROLE_MAP.max.reviewer.candidates[0].provider` (`"amazon-bedrock"`) carrying only that role's resolved model.
- **Task 1 (cases 1-4, the executor path):** switches to `balanced` then `max`, running a real `session.prompt()` turn after each. Rows are sliced by the count of `kind:"turn"` rows before/after each switch (never filtered by `role`), and each new turn row's `provider`/`model` is asserted to name that mode's real executor candidate. Case 2 additionally asserts the two observed models DIFFER — the proof that closes the "a single switch could coincide with a no-op router" gap. Case 3 cross-checks the `main.request` wire record for each turn against its turn row by shared `corr`, an independent second observation of the same fact. Case 4 asserts every main-loop turn row carries `role: SESSION_TURN_ROLE` (`"session"`) explicitly, documenting in the assertion itself why a `role:"executor"` filter would be vacuous.
- **Task 2 (cases 5-9, the single-shot path):** `runSingleShotRole(ctx, {role:"reviewer", ...})` is driven while the session's executor is still `max`'s model (`deepseek/deepseek-v4-pro`) — the reviewer route resolves to Bedrock Claude, a genuinely different provider and model, so case 5's assertion that the nested row names a *different* model than the session executor is a real routing proof, not a same-provider coincidence. Case 6 joins the nested turns row to its wire records by `corr` (never by array position) and asserts the `nested.request` payload's `model` field, and every joined record's `role`, equal `"reviewer"`. Case 7 asserts the contrasting negative: main-loop wire records in the same session carry no `role` key at all. Case 8 asserts the nested call's `corr` never collides with a main-loop turn's. Case 9 is the negative control: a model registered but never routed is asserted absent from both full log captures, paired with a positive control (a model that *was* routed) proving the reader is not merely finding nothing everywhere.
- **Falsification executed** (BE SUSPICIOUS OF GREEN, standing policy): (1) temporarily mutated `routing/schema.ts`'s `ROLE_MAP.max.executor` to resolve the SAME candidates as `balanced.executor` — the fixture's own precondition guard caught it and threw before any test ran (a red suite, not a silent pass); with that guard also disabled, case 2's own `.not.toBe` assertion independently caught the same mutation and went red with an informative message. Both mutations were reverted via `git checkout --` and confirmed byte-identical via `git diff --stat`. (2) Mutated case 9's own assertion to a tautology (`expect(true, ...).toBe(false)`) to confirm the negative control is load-bearing rather than decorative — it went red as expected, then was reverted via `Edit`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The executor path — two switches, two models, read from the turn rows** — `a110344` (test)
2. **Task 2: The single-shot path — nested records joined by correlation id, with a negative control** — `af53497` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `tests/integration/wire-proof.test.ts` — ROUTE-10's binding proof, 9 cases, read back from `wire-*.jsonl` and `turns-*.jsonl`

## Verification Evidence

- `npx vitest run tests/integration/wire-proof.test.ts` — 1 file / 9 tests, all green (both the Task-1-only intermediate, 4/4 green, and the final combined file)
- `npx vitest run tests/integration/wire-proof.test.ts tests/integration/single-shot-roles.test.ts` — 2 files / 17 tests, all green
- `npx vitest run tests/integration/wire-proof.test.ts tests/integration/single-shot-roles.test.ts tests/integration/mode-switch.test.ts` — 3 files / 22 tests, all green
- `npm run typecheck` (`tsc --noEmit`) — clean, run after every edit and after both falsification restores
- `npx vitest run` (full suite) — **78 test files, 1334 tests, all passed** (~33s)
- `grep -n "setModel" tests/integration/wire-proof.test.ts` — three matches, all three inside the header comment block (lines 13, 14, 17); zero outside it, satisfying the acceptance grep
- `git status --porcelain` after the full run — clean except the new tracked file, confirming the `PI_CODING_AGENT_DIR` isolation prevented any write to this machine's real global Pi settings

## Decisions Made

See `key-decisions` in the frontmatter for the full list. Summarized:

- The file was authored as one combined fixture (Task 2 extends Task 1's session/provider setup, per the plan's own instruction) but split into two atomic commits by constructing and verifying a genuine Task-1-only intermediate version first.
- Model ids are read from the real `ROLE_MAP` export rather than hardcoded as literals, so the fixture tracks `routing/schema.ts`'s actual table rather than a copy of it.
- The reviewer faux provider is registered under a different provider id than the executor faux provider, making the "nested model differs from session executor" proof a genuine cross-provider fact.

## Deviations from Plan

None — plan executed exactly as written. The intermediate Task-1-only file construction (to get two clean atomic commits from one designed-as-a-whole fixture) is process, not a deviation from the plan's stated tasks or acceptance criteria.

## Issues Encountered

None. The one thing worth naming: `git checkout -- <path>` silently fails ALL listed paths (not just the missing one) when one pathspec does not match a tracked file — encountered while reverting the falsification mutation on the then-untracked `wire-proof.test.ts` alongside the tracked `schema.ts`. Resolved by reverting each path with its own `git checkout --` call.

## User Setup Required

None — no external service configuration required. Every model in this plan's fixture is a `fauxProvider` with a synthetic API key grant; no real credential is read or required.

## Next Phase Readiness

- ROUTE-10 is now proven for both routed mechanisms this repository has built: the executor path (`/balanced`, `/max`) and the single-shot path (`runSingleShotRole`). The wire dump — not a `setModel` spy — is the evidence for both.
- What this file does NOT prove, stated in its own header: subagent-role routing (`planner`) is not provable from this process's own wire log, since a subagent is a separate `pi` process; ROUTE-05's evidence is the `settings.subagents.agentOverrides` write proven in `tests/integration/mode-switch.test.ts` case 2 (plan 05-07). Nothing here says anything about a real DeepSeek, DashScope or Bedrock request — every model is `fauxProvider`.
- This closes ROADMAP success criterion 1's second clause ("the resulting wire dump proves the intended model actually served the next turn") for the executor and single-shot mechanisms. Criterion 1's remaining unclaimed surface (subagent-role routing having actually run) is out of scope for this phase per 05-CONTEXT.md's Deferred Ideas — Phase 7 installs the subagent package.
- Full repo suite verified green after this plan: 1334 tests / 78 files, `tsc --noEmit` clean.
- No blockers for the next plan in this phase's wave.

## Self-Check: PASSED

- FOUND: `tests/integration/wire-proof.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-11-SUMMARY.md`
- FOUND commit: `a110344` (Task 1)
- FOUND commit: `af53497` (Task 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
