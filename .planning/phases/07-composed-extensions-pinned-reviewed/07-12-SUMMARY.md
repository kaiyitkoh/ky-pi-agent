---
phase: 07-composed-extensions-pinned-reviewed
plan: 12
subsystem: docs+tests
tags: [pi-subagents, EXT-03, EXT-04, evidence-binding, supply-chain]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    provides: ".pi/agents/planner.md (07-04, no model: key); .pi/settings.json packages[] pinning pi-subagents@0.49.0 (07-09); the corrected finding that agentScope is not a settings key (07-09-SUMMARY.md Task 1 finding 3)"
provides:
  - "docs/EXTENSIONS.md ## Subagent capability evidence -- ten file:line citations read from the real pi-subagents@0.49.0 tarball this session, covering EXT-01/EXT-03/EXT-04"
  - "tests/unit/subagent-capabilities.test.ts -- binds every pi-subagents evidence row to .pi/settings.json's pinned version, both directions, plus the repo's own composition"
affects: [07-13, phase-10-tool-count-baseline]

tech-stack:
  added: []
  patterns: ["Doc-to-code evidence table bound to a version pin, following docs/ROUTING.md's role->model both-directions discipline (tests/unit/routing-map.test.ts) applied to a third-party package pin instead of an internal module"]

key-files:
  created: [tests/unit/subagent-capabilities.test.ts]
  modified: [docs/EXTENSIONS.md]

key-decisions:
  - "This plan's own drafted premise (\"an agent file exists, agentScope loads it\") is FALSE for the pinned pi-subagents@0.49.0 and was not written into either the doc or the test as drafted. Re-verified directly against the real tarball's src/shared/types.ts (ExtensionConfig, every field enumerated) and src/extension/schemas.ts:333: agentScope is a per-tool-call parameter defaulting to \"both\" (src/agents/agent-scope.ts:3-6), never a settings key. docs/EXTENSIONS.md states this correction in prose; tests/unit/subagent-capabilities.test.ts's Binding 4 asserts the true shape (.pi/settings.json carries NO agentScope key) instead of the plan's falsified assertion."
  - "Evidence rows are one-citation-per-row (a single file:line each), not multi-citation rows, so Binding 2's well-formed-path:line rule stays a real per-cell check rather than a rule over a comma-joined string that could hide a bad citation inside a good one."
  - "fanout-child.ts's own `subagent` tool registration (a SEPARATE extension entry point, registerFanoutChildSubagentExtension, used only inside nested fanout-child pi processes) is excluded from the model-facing tool count below -- it is not loaded in the main session."
  - "The malformed-row parser throws rather than skips, proven against an inline 6-cell fixture before any real-file binding runs, per this phase's standing lesson that a silent-skip parser is how a table with zero rows parsed passes every assertion."

requirements-completed: []
requirements-partial: [EXT-03, EXT-04]

duration: ~25min
completed: 2026-08-15
---

# Phase 07 Plan 12: Subagent Capability Evidence (EXT-03/EXT-04) Summary

**Read the real `pi-subagents@0.49.0` tarball in this session and cited ten `file:line` locations proving the `async` background-execution mechanism and the `steer` mid-run-steering mechanism exist in the pinned code, bound every citation to the exact version pinned in `.pi/settings.json`, and corrected this plan's own falsified `agentScope` premise rather than encoding it as a test assertion.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- **Task 1:** Packed and inspected `pi-subagents@0.49.0`'s real tarball (`npm pack` + `tar -xf` under this session's scratchpad, never installed, directory removed after each of two inspection passes). Appended a `## Subagent capability evidence` table to `docs/EXTENSIONS.md` with ten rows: three completing EXT-01's supporting citations, four for EXT-03 (background execution), three for EXT-04 (mid-run steering). Every Evidence cell is a single `file:line` read in this session; every row's "What this does NOT prove" column names `RB-07-01`.
- **Task 2:** Created `tests/unit/subagent-capabilities.test.ts`, parsing that table and enforcing five bindings plus a vacuity guard and a malformed-row-throws guard. All required falsifications performed and reverted (below).

## Task 1 Findings — read from the real `pi-subagents@0.49.0` tarball

**EXT-03 (background execution without blocking), the concrete mechanism, not just its existence:**
1. `async: Type.Optional(Type.Boolean(...))` on the `subagent` tool's own parameter schema — `src/extension/schemas.ts:327` (exact match to the research citation, re-confirmed at the pinned version).
2. `registerWaitTool(pi, state, ...)` is called unconditionally, immediately after `pi.registerTool(tool)` — `src/extension/index.ts:621,623`. The `subagent_wait` tool (`src/runs/background/wait-tool.ts:9`) is always present; its `enabled` parameter only controls whether it blocks, not whether it exists.
3. The concrete non-blocking mechanics, traced end to end: `executeWithSingleDispatchGuard` decides `runsForeground` from `dispatchParams.async` (`src/runs/foreground/subagent-executor.ts:6497`); for an async dispatch, `executeAsyncSingle` (`src/runs/background/async-execution.ts`) calls `spawnRunner`, which launches a **detached** Node child process (`spawn(nodeCommand, [...], { detached: true, ... })`, `async-execution.ts:496`) running `subagent-runner.ts` via jiti; that detached process itself execs a **real `pi --mode json -p` child process** (`baseArgs: ["--mode","json","-p"]`, `src/runs/background/subagent-runner.ts:1340` — exact match to `07-VALIDATION.md`'s substitution-note citation). The tool call's own `AgentToolResult` is returned (`runId`/`asyncId` in `details`) at `async-execution.ts:1657-1660`, **before** that child process finishes — no `await` on completion. The result is collected later via `subagent_wait` or the result watcher (`createResultWatcher`, `src/extension/index.ts:444-455`) reading `DIRS.results/<id>.json`.

**EXT-04 (mid-run steering without killing), what distinguishes it from abort:**
4. The `steer` action's `mode` parameter (`steer`/`follow_up`/`auto`) is documented in the schema itself as interrupting "at the next safe point" — `src/extension/schemas.ts:284-285`.
5. The file-based control inbox defines `{ type: "steer" }` (`SteerRequest`, `src/runs/background/control-channel.ts:69-78`) as a request shape **structurally disjoint** from `{ type: "interrupt" }` / `{ type: "stop" }` / `{ type: "timeout" }` (`control-channel.ts:38-57`). The module's own header comment explains why this file-based channel exists at all: Windows cannot deliver `SIGUSR2`/`SIGBREAK` cross-process via `process.kill`, so a portable inbox replaces signals for both interrupt and steer.
6. `deliverSteerRequest` (`src/runs/background/subagent-runner.ts:2644-2706`) only routes a steer message into a step's own inbox (`enqueueStepSteer`, called at `:2688`) when that step's status is **already `"running"`** (`:2679`); a step that is not running gets a `"failed"` steering target instead, and the run's own status is never flipped to a terminal state as a side effect of a successful delivery. This is the concrete code-level distinction the requirement asks for: steering routes into a still-running process; termination is the separate `interrupt`/`stop` request path.

**EXT-01 supporting citations, completing the table (re-verified, not carried over):**
7. `...(frontmatter.thinking !== undefined ? { thinking: ... } : {})` — `src/agents/agents.ts:1644`, exact match.
8. `if (override.model !== undefined && !agentHasFrontmatterField(agent, "model"))` — `src/agents/agents.ts:1155`, exact match — the guard that makes `.pi/agents/planner.md`'s deliberate absence of `model:` load-bearing for Phase 5's routing.
9. Four parent-session tools registered unconditionally: `subagent` (`index.ts:621`), `subagent_wait` (`index.ts:623`), `contact_supervisor` and `intercom` (both via `registerParentTools()`, called unconditionally inside `supervisorChannel.start()` — `src/intercom/native-supervisor-channel.ts:769`, `registerParentTools` itself at `:649-651`). Tool names confirmed at `native-supervisor-channel.ts:303,315`.

**Model-facing tool count baseline for Phase 10 (critical constraint 7).** The four tools in finding 9 above (`subagent`, `subagent_wait`, `contact_supervisor`, `intercom`) are the complete set `pi-subagents@0.49.0` registers into the **main session** unconditionally — no config key reduces this. A fifth `subagent` tool definition exists in `src/extension/fanout-child.ts:189`, but that file is a **separate extension entry point** (`registerFanoutChildSubagentExtension`, exported as its module's default) loaded only inside a nested fanout-child `pi` process, never in the main session — it is excluded from this baseline. **Baseline: 4 model-facing tools from `pi-subagents@0.49.0` in the main session.**

No `npm install` or `pi install` was run. `npm pack pi-subagents@0.49.0` + `tar -xf` under this session's scratchpad temp directory, twice (once for the evidence table, once to confirm the tool-count baseline); both temp directories were removed after inspection.

## The falsified premise, and what was written instead

Critical constraint 1 required re-verifying, not asserting, this plan's own drafted claim ("an agent file exists, `agentScope` loads it"). Direct inspection of the pinned tarball's `src/shared/types.ts` (`ExtensionConfig`, every field enumerated) and `src/extension/schemas.ts:333` confirms `07-09-SUMMARY.md`'s prior finding: `agentScope` is not a `.pi/settings.json` key at any scope. It is a per-tool-call parameter on the `subagent` tool's own schema, resolved to `"both"` by `resolveExecutionAgentScope()` (`src/agents/agent-scope.ts:3-6`) whenever a caller omits it — meaning `.pi/agents/planner.md` is already discovered with no settings write required, and none exists.

`docs/EXTENSIONS.md`'s new section states this correction in a dedicated paragraph before the evidence table. `tests/unit/subagent-capabilities.test.ts`'s Binding 4 — which `07-12-PLAN.md`'s own Task 2 text specified as "`.pi/settings.json` sets `agentScope` to a value that loads project agents" — instead asserts the true, machine-checkable fact: `.pi/settings.json` carries **no** `agentScope` key. This mirrors an equivalent assertion already present in `tests/unit/extension-pins.test.ts` (written by plan 07-09); it is repeated here independently so this file's own EXT-03/EXT-04 composition half does not depend on another test file to be true.

## Task Commits

1. **Task 1: `docs/EXTENSIONS.md` — Subagent capability evidence table** — `35679a3` (docs)
2. **Task 2: `tests/unit/subagent-capabilities.test.ts` — bind the evidence to the pin** — `88dacbe` (test)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `docs/EXTENSIONS.md` — new `## Subagent capability evidence` section: ten citation rows (3× EXT-01, 4× EXT-03, 3× EXT-04), a correction paragraph re the falsified `agentScope` premise, and a closing boundary paragraph naming `RB-07-01`.
- `tests/unit/subagent-capabilities.test.ts` — table parser (throws on malformed rows), vacuity guard, and five bindings (pin-binding, evidence-shape, converse-completeness, repo-composition, honesty guard).

## Falsifications Performed (all four required, all reverted)

1. **Pin drift.** Changed `.pi/settings.json`'s `pi-subagents` pin from `0.49.0` to `0.49.1` (one patch digit). Result: `subagent-capabilities Binding 1 ... every row whose Package is pi-subagents names the exact pinned version` turned red with the exact mismatch named. Reverted via `Edit`.
2. **Row deletion.** Deleted all three EXT-04 rows from `docs/EXTENSIONS.md`'s table. Result: both the vacuity guard (`covered.has("EXT-04")`) and `subagent-capabilities Binding 3 ... EXT-04 appears in at least one parsed row` turned red. Reverted via `git checkout -- docs/EXTENSIONS.md` (confirmed byte-identical to the committed version before re-running).
3. **Prose evidence.** Replaced one Evidence cell (`src/extension/schemas.ts:327`) with the prose string `"somewhere in the schemas file, not exactly pinpointed"`. Result: `subagent-capabilities Binding 2 ... every Evidence cell is a path:line[-line] citation or the literal UNVERIFIED` turned red, naming the offending row. Reverted via `git checkout`.
4. **Blanked honesty cell.** Blanked one row's "What this does NOT prove" cell. Result: `subagent-capabilities Binding 5 ... every row's "What this does NOT prove" cell is non-empty and names RB-07-01` turned red. Reverted via `git checkout`.

After each falsification, `npx vitest run tests/unit/subagent-capabilities.test.ts` was re-run to confirm a clean 16/16 pass before proceeding to the next.

## Decisions Made

See `key-decisions` in frontmatter. Summarized: (1) the plan's own `agentScope` premise is false and was corrected rather than encoded, in both the doc and the test; (2) evidence rows are one-citation-per-row for a real per-cell Binding 2 check; (3) `fanout-child.ts`'s separate-entry-point `subagent` tool is excluded from the main-session tool-count baseline; (4) the malformed-row parser throws, proven before any real-file binding runs.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Corrected a falsified premise, per critical constraint 1] `agentScope` assertion rewritten to the true shape**
- **Found during:** Task 1 (source re-verification, before writing the doc) and Task 2 (writing Binding 4).
- **Issue:** `07-12-PLAN.md`'s own objective text and Task 2's Binding 4 both assert or imply `.pi/settings.json` configures `agentScope`. Direct re-verification against the pinned `pi-subagents@0.49.0` tarball (independently re-confirming `07-09-SUMMARY.md`'s prior finding) shows this is false: no such settings key exists anywhere in `ExtensionConfig`.
- **Fix:** `docs/EXTENSIONS.md` states the correction in prose before the evidence table. `tests/unit/subagent-capabilities.test.ts`'s Binding 4 asserts `.pi/settings.json` has NO `agentScope` key, instead of asserting a value for a key that does not exist. No test was written that would pass against a mechanism that is not real.
- **Files modified:** `docs/EXTENSIONS.md`, `tests/unit/subagent-capabilities.test.ts` (both already declared in the plan's own `files_modified`; no scope expansion).
- **Verification:** `Object.prototype.hasOwnProperty.call(settings, "agentScope")` asserted `false` against the real `.pi/settings.json`; full suite green.
- **Committed in:** `35679a3` (doc), `88dacbe` (test).

**Total deviations:** 1 (Rule 1 — correcting a premise the plan itself drafted incorrectly, per this plan's own explicit critical constraint requiring exactly this correction).
**Impact on plan:** No scope creep — both affected files were already in the plan's declared `files_modified`. The correction is the plan's own critical constraint 1 being honored, not a deviation from the plan's intent.

## Issues Encountered

None beyond the premise correction above, which was anticipated by the plan's own critical constraints.

## Stub Tracking

No stubs. Every table row cites a real, re-read `file:line` location or would be marked `UNVERIFIED` (none were — every mechanism this plan needed was found and cited).

## Threat Flags

None. This plan reads third-party source and writes documentation/tests; it introduces no new network endpoints, auth paths, file-access patterns, or schema changes at a trust boundary.

## User Setup Required

None.

## RB-07-01 status

Unchanged — **OUTSTANDING**. Not written by this plan (that is plan 07-13's job); every evidence row above names it as the live check this plan's own citations do not and cannot substitute for. No claim of passage was made anywhere in this plan's output.

## Next Phase Readiness

`docs/EXTENSIONS.md`'s evidence table and `tests/unit/subagent-capabilities.test.ts` are in place and bound to the pin. Plan 07-13 can now write `RB-07-01` (the composed smoke ritual) citing this evidence table by section name. Phase 10's tool-count baseline work can use this plan's finding directly: `pi-subagents@0.49.0` contributes exactly 4 model-facing tools to the main session (`subagent`, `subagent_wait`, `contact_supervisor`, `intercom`), none config-reducible, with a fifth `subagent` definition in a separate fanout-child-only entry point explicitly excluded. No blockers.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: docs/EXTENSIONS.md (contains "Subagent capability evidence")
- FOUND: tests/unit/subagent-capabilities.test.ts
- FOUND commit: 35679a3
- FOUND commit: 88dacbe
