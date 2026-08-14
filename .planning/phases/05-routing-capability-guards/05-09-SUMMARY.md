---
phase: 05-routing-capability-guards
plan: 09
subsystem: routing
tags: [routing, escalate, sticky-state, jsonl, extension-commands, faux-session, pi-extensions, typescript]

# Dependency graph
requires:
  - phase: 05-07
    provides: ".pi/extensions/routing/index.ts's applyMode/registerCommand shape, the pre-flight -> guard -> setModel -> persist order this plan's applyEscalate mirrors"
  - phase: 05-04
    provides: "routing/modes.ts's resolveRoute (executor-only escalation lift), pickConfiguredCandidate, getModeState/setEscalated"
  - phase: 05-02
    provides: "routing/guard.ts's guardRoute()"
provides:
  - ".pi/extensions/routing/index.ts -- the /escalate command (on/off, exact argument parsing) and the read-only /mode status command"
  - "a durable, best-effort JSONL escalation record (routing-owned 'escalation' base, via .pi/lib/jsonl.ts) naming the previous/new executor, mode and escalation flag for every successful escalation change"
  - "tests/integration/escalate.test.ts -- ROUTE-03's stickiness-across-a-real-turn proof, the executor-only scope proof, and the never-claim-a-failed-escalation proof"
affects: [05-10, 05-11, docs/ROUTING.md, Phase 11 statusline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "applyEscalate is a SEPARATE function from applyMode, not a third branch: it never calls setMode (the mode itself is untouched by escalation) and always resolves with escalated:<the argument> rather than always false. Both share the identical pre-flight -> guard -> setModel(try/catch, boolean-checked) -> persist order, but share no code beyond the modules they import -- folding them into one function would need caller-intent threaded through every step, the exact implicit-branching shape this codebase's guard.ts/policy.ts house style avoids"
    - "the durable escalation record reuses .pi/lib/jsonl.ts directly from routing/index.ts (no new binding module, following files_modified's declared scope) under a routing-owned 'escalation' base name, mirroring safety/audit.ts#writeAuditRow's catch-and-swallow discipline -- a failed record write can never turn an already-successful setModel switch into a reported error"
    - "the escalated flag is set (setEscalated) strictly AFTER pi.setModel returns true, never before -- the refusal path returns before setEscalated is ever reached, so a refused escalation cannot leave getModeState().escalated claiming a switch that never took effect (T-05-33)"
    - "/mode is read-only and reuses the identical resolveRoute + pickConfiguredCandidate pair applyMode/applyEscalate already use for every non-executor role, so its output cannot drift from what a real switch would actually resolve to"

key-files:
  created:
    - tests/integration/escalate.test.ts
  modified:
    - .pi/extensions/routing/index.ts

key-decisions:
  - "applyEscalate never calls setMode -- escalation changes the executor and the escalation flag only; the current mode name is read via getModeState() and threaded through resolveRoute unchanged in both the on and off directions"
  - "the escalation JSONL record lives directly in routing/index.ts (a local ESCALATION_LOG_BASE constant + a writeEscalationRecord function calling ../../lib/jsonl.ts's appendJsonl), not a new routing/escalation-log.ts binding module -- the plan's files_modified list names only index.ts and the test file, and a single best-effort append site needs no separate binding the way the audit log's multi-call-site writer does"
  - "escalate's argument parsing accepts exactly '', 'on', 'off' (trimmed) -- anything else is refused naming all three accepted forms, verbatim, rather than being silently treated as 'on'"
  - "/mode's executor line reads ctx.model directly (the session's real, live model) rather than re-resolving a candidate through resolveRoute/pickConfiguredCandidate the way the other five roles' lines do -- ctx.model is what is ACTUALLY serving the session right now, which is the concrete claim criterion 2 asks /mode to make"

patterns-established:
  - "A sticky, cross-turn extension-state claim (ROUTE-03's 'still escalated after a further turn') is proven by calling session.prompt() between the command invocation and the re-read of ctx.model/getModeState(), never by re-reading immediately after the command returns -- an immediately-after assertion would pass against a one-shot implementation ARCHITECTURE:55 already rejected"
  - "an executor-only-scope claim (escalation must not widen beyond one role) is proven by capturing a full /mode-shaped text snapshot before and after the state change and asserting every non-subject line is byte-identical, paired with a positive control that the subject line DID change -- proves the comparison is not vacuously comparing two identical blobs"

requirements-completed: [ROUTE-03]

# Metrics
duration: ~20min
completed: 2026-08-14
---

# Phase 5 Plan 9: Escalate and Mode Commands Summary

**`/escalate` (on/off, exact argument parsing) and a read-only `/mode` status command added to `routing/index.ts`, sharing `applyMode`'s pre-flight -> guard -> `setModel` -> persist order through a deliberately separate `applyEscalate` function, proven sticky across a real `session.prompt()` turn, executor-scoped only, and never claiming an escalation that a refused `setModel` never actually performed.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-14T18:16:00Z
- **Completed:** 2026-08-14T18:30:21Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- `.pi/extensions/routing/index.ts` now registers `escalate` and `mode` in addition to `cheap`/`balanced`/`max`. `applyEscalate(pi, ctx, escalate: boolean)` runs the identical order `applyMode` established: `await ctx.waitForIdle()` first; `resolveRoute("executor", {mode: state.mode, escalated: escalate})` (leaning on `modes.ts`'s own executor-only lift) + `pickConfiguredCandidate`, refusing with every candidate named on failure; `guardRoute(candidate.model, "executor", {usesToolLoop: true})`, refusing with the guard's own reason verbatim; `pi.setModel` in `try`/`catch` with the boolean return checked explicitly; and only on `true` does `setEscalated(escalate, escalate ? state.mode : undefined)` run, followed by a `ky:mode` entry, the durable JSONL escalation record, `ROUTING_EVENT`, and one `ctx.ui.notify`. The mode itself (`state.mode`) is never touched by either direction — only the escalation flag and the executor model change, which is what keeps `/escalate` a lift of one role rather than a second whole-mode switch.
- Argument parsing is exact: `escalate.trim()` must be `""`, `"on"` or `"off"` — anything else is refused with a message naming all three accepted forms, verbatim, and changes nothing (proven by falsification: removing the check made case 6 fail with the model actually switching on `"sideways"`).
- A durable, best-effort JSONL record is appended on every successful escalation change (`writeEscalationRecord`, routing-owned `"escalation"` base via `.pi/lib/jsonl.ts` — the same hardened writer `safety/audit.ts` binds to), carrying the previous and new executor `provider/id`, the mode, the escalation flag and a timestamp. It is wrapped in `try`/`catch` and never throws, mirroring `safety/audit.ts#writeAuditRow`'s catch-and-swallow discipline — a failed record write can never turn an already-successful `setModel` switch into a reported error (T-05-35, accepted residual risk).
- `/mode` is read-only: it prints the mode name, whether escalated and from which mode, `ctx.model`'s real `provider/id` for the executor, and — for every other role — the model `resolveRoute` + `pickConfiguredCandidate` would currently resolve to (or `unavailable (<reason>)`). It never touches the session's model and never writes anything.
- `tests/integration/escalate.test.ts` (6 cases) drives the real commands via `session.extensionRunner.getCommand(name).handler(args, ctx)` against a real `createAgentSession`, with `deepseek` registered under both the flash and pro tiers so a real escalation is a genuine model change (`deepseek/deepseek-v4-flash` → `deepseek/deepseek-v4-pro`). Case 1 proves escalation AND stickiness — the model is re-checked after a real `session.prompt()` turn, not only immediately after the command. Case 2 proves `/mode` names the escalated state and the concrete `provider/id`. Case 3 proves `escalate off` restores the flash tier and that the restoration also survives a further turn. Case 4 proves executor-only scope by comparing `/mode`'s full text output before/after escalation line-by-line for the five non-executor roles, with a paired positive that the executor line itself did change. Case 5 proves a refusal (no configured candidate for the pro tier) leaves both the model and `getModeState().escalated` unchanged, and writes no `ky:mode` entry. Case 6 proves an invalid argument is refused, names the accepted forms, and writes no `ky:mode` entry.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the `escalate` and `mode` commands to routing/index.ts** — `df0925a` (feat)
2. **Task 2: `tests/integration/escalate.test.ts`** — `6b37427` (test)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `.pi/extensions/routing/index.ts` — ROUTE-03's `/escalate` and `/mode` commands, plus the durable escalation JSONL record
- `tests/integration/escalate.test.ts` — session-driven proof, 6 cases

## Verification Evidence

- `grep -c "registerTool" .pi/extensions/routing/index.ts` → 0; `grep -nE "modelRegistry\s*\.\s*(complete|completeSimple|stream|streamSimple|getProvider)|getRegisteredNativeProvider|ModelRuntime" .pi/extensions/routing/index.ts` → no output
- `npx vitest run tests/unit/extension-layout.test.ts tests/unit/chokepoint-lint.test.ts tests/unit/contributing-boundary.test.ts tests/integration/mode-switch.test.ts` — 4 files / 26 tests, all green (run AFTER `git add`, since `contributing-boundary`/`chokepoint-lint` scan `git ls-files` and an untracked file is invisible to them)
- `npx vitest run tests/integration/escalate.test.ts` — 1 file / 6 tests, all green
- `npx vitest run tests/integration/escalate.test.ts tests/integration/mode-switch.test.ts tests/unit/chokepoint-lint.test.ts` — 3 files / 17 tests, all green
- `npm run typecheck` (`tsc --noEmit`) — clean, run repeatedly across both tasks and after every falsification restore
- `npx vitest run` (full suite) — **76 test files, 1321 tests, all passed** (~32s)
- **Falsification executed** (BE SUSPICIOUS OF GREEN, standing policy):
  1. Removed the `escalate` argument validation (`if (arg !== "" && arg !== "on" && arg !== "off") { ... }`) — re-ran `escalate.test.ts`: case 6 went red (`expected 'deepseek' to be 'faux'` — the session's model actually switched on `"sideways"`). Reverted; full 6-case file re-ran green.
  2. Mutated `routing/modes.ts#resolveRoute` to also lift `"summariser"` when escalated (`role === "executor" || role === "summariser"`) — re-ran `escalate.test.ts`: case 4 went red (`role "summariser"'s reported route changed... before="summariser: deepseek/deepseek-v4-flash" after="summariser: deepseek/deepseek-v4-pro"`). Reverted; full 6-case file re-ran green.
  - `git diff --stat` after both restores was empty; `npm run typecheck` and the full suite were re-verified green after reverting.

## Decisions Made

See `key-decisions` in the frontmatter for the full list. Summarized:

- `applyEscalate` is a deliberately separate function from `applyMode`, sharing its order but never its body — it never calls `setMode`, and it resolves with `escalated: <the argument>` in both directions rather than always `false`.
- The durable escalation record lives inline in `routing/index.ts` (a local base-name constant plus a `writeEscalationRecord` function bound to `.pi/lib/jsonl.ts`), not a new sibling binding module — consistent with this plan's declared `files_modified` scope and proportionate to a single append call site.
- `escalate`'s argument parsing is exact and unforgiving: only `""`, `"on"`, `"off"` (after trimming) are accepted.
- `/mode`'s executor line reads `ctx.model` directly rather than re-resolving a candidate — it reports what is actually serving the session, not merely what would be picked.

## Deviations from Plan

None — plan executed exactly as written. The one implementation choice left to discretion (whether the escalation record needed its own binding module, matching `safety/audit.ts`'s shape, versus living inline in `index.ts`) was resolved in favor of inline, per the plan's own declared `files_modified` list naming only `index.ts` and the test file.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. Every auth grant in this plan's test is `ModelRuntime#setRuntimeApiKey` against a faux provider, never a real key.

## Next Phase Readiness

- ROUTE-03 is complete: `/escalate` and `/escalate off` both run the full pre-flight → guard → `setModel` → persist path, the elevated state survives a further turn and is visible through `/mode`, escalation lifts the executor only, and a failed escalation leaves both the model and the state untouched.
- The durable escalation JSONL record (T-05-32's mitigation) is written on every successful change and is best-effort per T-05-35's accepted residual risk — no test in this plan reads that file directly, since none of ROUTE-03's acceptance criteria require it; a later phase that wants to assert on it can read the routing-owned `"escalation"` base under `.pi/logs/`.
- ROUTE-09 (mode persistence's `session_start` restore hook, and the zero-context-tokens wire-capture proof) remains explicitly out of this plan's scope, unchanged from 05-07-SUMMARY.md's own handover note — this plan's `requirements` frontmatter names only ROUTE-03.
- Full repo suite verified green after this plan: 1321 tests / 76 files, `tsc --noEmit` clean.
- No blockers for the next plan in this phase's wave.

## Self-Check: PASSED

- FOUND: `.pi/extensions/routing/index.ts`
- FOUND: `tests/integration/escalate.test.ts`
- FOUND: `.planning/phases/05-routing-capability-guards/05-09-SUMMARY.md`
- FOUND commit: `df0925a` (Task 1)
- FOUND commit: `6b37427` (Task 2)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
