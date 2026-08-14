---
phase: 07-composed-extensions-pinned-reviewed
plan: 11
subsystem: testing
tags: [supply-chain, tool-registration, EXT-05, EXT-06, tool-count-baseline, phase-10-handoff]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    plan: 06
    provides: ".pi/extensions/loop-police/ (vendored pi-loop-police, EXT-10) plus its PROVENANCE.md"
  - phase: 07-composed-extensions-pinned-reviewed
    plan: 07
    provides: ".pi/extensions/plan-mode/ (vendored Pi bundled example, EXT-06)"
  - phase: 07-composed-extensions-pinned-reviewed
    plan: 08
    provides: ".pi/extensions/todo.ts and questionnaire.ts (vendored Pi bundled examples, EXT-05/EXT-06), the 383-byte/96-token and 1258-byte/315-token measurements"
  - phase: 07-composed-extensions-pinned-reviewed
    plan: 09
    provides: ".pi/settings.json packages[] (the 5-entry lockfile, never installed)"
provides:
  - "tests/unit/extension-composition.test.ts -- CAPABILITY_SOURCES, EXT-05's eight capabilities each bound to a real tracked source, with the EXT-06 npm-alternative regression guard"
  - "tests/unit/tool-count-baseline.test.ts -- TOOL_COUNT_BASELINE, the committed Phase 10 baseline of every model-facing tool name across 5 pinned-but-uninstalled npm packages and 5 vendored extensions"
  - "A corrected pi-subagents parent-session tool-name finding: subagent_supervisor + intercom, not contact_supervisor + intercom (07-12-SUMMARY.md's finding 9 was wrong on this one name)"
affects: [phase-10-quality-levers-and-cuts]

tech-stack:
  added: []
  patterns:
    - "A vendored-entry-point discovery mechanism cannot rely on extension-layout.test.ts's isEntryPoint alone -- a file that re-exports its default (export { X as default } from ...) is a real Pi entry point but does not match that file's own DEFAULT_EXPORT regex; path-shape (FLAT/NESTED_INDEX) plus a content marker is the more robust discriminator for a narrower question than BOOT-05's own (which has a NESTED_MODULE fallback masking the gap)"

key-files:
  created:
    - tests/unit/extension-composition.test.ts
    - tests/unit/tool-count-baseline.test.ts

key-decisions:
  - "Tool-count baseline is measured, not estimated, per critical constraint 7: every npm package's tool names were re-obtained this session via npm pack <pkg>@<pinned-version> --ignore-scripts + tar -xf into a scratch temp directory, grepped for real registerTool( call sites and name: fields, then deleted -- never installed, never executed."
  - "pi-subagents@0.49.0's parent-session pair is subagent_supervisor (constant NATIVE_SUPERVISOR_TOOL_NAME) and intercom, both registered unconditionally via registerParentTools() inside supervisorChannel.start() (src/extension/index.ts:827-835 session_start handler; native-supervisor-channel.ts:649-652). contact_supervisor is a DIFFERENT tool name, registered only inside registerNativeSupervisorClient(), gated by if (!readChildMetadata()) return; (native-supervisor-channel.ts:299,303) -- a child-process-only function. This corrects 07-12-SUMMARY.md's finding 9, which named the parent pair as 'contact_supervisor and intercom'; this plan's own <baseline_starting_point> table (subagent, subagent_wait, subagent_supervisor, intercom) had it right all along."
  - "structured_output is a real pi-subagents tool name but registers only when BOTH process.env[STRUCTURED_OUTPUT_CAPTURE_ENV] and process.env[STRUCTURED_OUTPUT_SCHEMA_ENV] are set (subagent-prompt-runtime.ts:609-622) -- conditional AND child-process-scoped, never active in the parent session. Excluded from the pi-subagents baseline row, cited rather than silently omitted."
  - "pi-web-access's four tools (web_search, source_check, fetch_content, get_search_content) are individually gated by isToolEnabled() (index.ts:244-248), but this repo's .pi/settings.json carries no pi-web-access-specific config at all, and that function's own no-override default resolves true for all four -- recorded as 'conditional, default-enabled with this repo's actual config', not flatly always-active or flatly conditional."
  - "pi-background-tasks's D-07-B redundant set is SIX tools (bg_delegate, bg_result, fusion_reason, fusion_investigate, fusion_research, fusion_validate), matching this plan's own <baseline_starting_point> citation -- not the SEVEN docs/EXTENSIONS.md's 'Installed packages' table names, which additionally counts bg_run_pi_attested as unwanted overhead rather than as a legitimate fifth bg_* tool. The plan's own wording ('six delegate/fusion tools ... duplicate pi-subagents') governs this file's Direction 4 assertion; docs/EXTENSIONS.md's looser prose framing is a different, broader count and is left unchanged (out of this plan's declared file scope)."
  - "TOOL_COUNT_BASELINE's vendored-side discovery does not filter through extension-layout.test.ts's isEntryPoint -- .pi/extensions/loop-police/index.ts uses export { loopPolice as default } from \"./loop-police.ts\" (a re-export, not a direct export default declaration), so isEntryPoint's DEFAULT_EXPORT regex returns false for it even though Pi genuinely auto-discovers and loads this exact path. extension-layout.test.ts's own BOOT-05 suite never noticed because that path also satisfies its NESTED_MODULE fallback shape. Found live during this plan's own falsification pass; fixed by discovering on path-shape (FLAT/NESTED_INDEX) plus a case-insensitive 'vendored' content marker instead."

requirements-completed: [EXT-05, EXT-06]

duration: ~55min
completed: 2026-08-15
---

# Phase 07 Plan 11: EXT-05/EXT-06 Capability Registry and Phase 10 Tool-Count Baseline Summary

**Built the capability-to-evidence registry closing EXT-05/EXT-06 (all eight named capabilities bound to a real tracked source, with a mutual-exclusion guard against the matching npm alternative) and the committed Phase 10 tool-schema baseline, re-verifying every npm package's tool names this session via read-only `npm pack`/`tar -xf` against the exact pinned versions -- finding and correcting a wrong tool name in 07-12's own prior finding along the way.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- **Task 1** -- `tests/unit/extension-composition.test.ts`: `CAPABILITY_SOURCES`, one row per EXT-05 capability (plan mode, todo tracking, structured user questions, loop detection -- all four `"vendored"`; background bash, LSP diagnostics, web lookup, session search -- all four `"npm"`). Four directions: (1) every row resolves to a tracked path or a pinned `packages[]` entry, (2) the EXT-06 regression guard -- no vendored row's npm alternative may appear in `packages[]`, (3) the converse -- every `packages[]` npm entry is either a row here or the named `pi-subagents` exception, (4) vendored provenance is recoverable (a tracked `PROVENANCE.md` for the npm-license case, a vendoring header naming the upstream path and Pi version for the four bundled-example rows).
- **Task 2** -- `tests/unit/tool-count-baseline.test.ts`: `TOOL_COUNT_BASELINE`, one row per pinned npm package (5) and one row per vendored extension including the zero-tool ones (5). Direction 1 mechanically grep-enforces the vendored side against this repo's own tracked source. Direction 2 records the npm side's tool names (never re-derivable without an installed tree) while checking the pin still exists. Direction 3 is completeness both ways on both sides. Direction 4 makes the Phase 10 handoff explicit: the `pi-background-tasks` row lists all eleven tools and its `why` names the six unfilterable duplicates plus their citation.
- **Re-verified every npm package's tool names live, this session**, via `npm pack <pkg>@<pinned-version> --ignore-scripts` + `tar -xf` into a scratch temp directory (never this repo, never `~/.pi`), grepping the extracted `.ts` source, then deleting the scratch directory. No `npm install`, `pi install`, or `pi update` was run anywhere in this plan.
- **Found and corrected a wrong tool name in 07-12-SUMMARY.md's own finding 9.** Re-reading `pi-subagents@0.49.0`'s real source in this session shows the parent (main) session registers `subagent_supervisor` (`NATIVE_SUPERVISOR_TOOL_NAME`) and `intercom`, both via `registerParentTools()` called unconditionally inside `supervisorChannel.start()` (`src/extension/index.ts:827-835`). `contact_supervisor` is a *different* tool name, registered only by `registerNativeSupervisorClient()`, gated by `if (!readChildMetadata()) return;` (`native-supervisor-channel.ts:299,303`) -- a function that only runs inside a spawned child subagent process. `07-12-SUMMARY.md` named the parent pair as "contact_supervisor and intercom"; this plan's own `<baseline_starting_point>` table (`subagent`, `subagent_wait`, `subagent_supervisor`, `intercom`) had the correct name all along.
- **Found a second child-process-only exclusion**: `structured_output`, gated by two environment variables (`STRUCTURED_OUTPUT_CAPTURE_ENV`, `STRUCTURED_OUTPUT_SCHEMA_ENV`) set only when a spawned child subagent step declares an `outputSchema` (`subagent-prompt-runtime.ts:609-622`). Never active in the parent session.
- **Found a real gap in this task's own discovery mechanism, during falsification.** `extension-layout.test.ts`'s exported `isEntryPoint` discriminator returns `false` for `.pi/extensions/loop-police/index.ts`, because that file re-exports its default (`export { loopPolice as default } from "./loop-police.ts";`) rather than declaring `export default ...` directly -- a shape `isEntryPoint`'s `DEFAULT_EXPORT` regex does not match. `extension-layout.test.ts`'s own BOOT-05 suite never noticed because that same path also satisfies its `NESTED_MODULE` fallback shape, so its completeness check passes either way. This file's narrower "is this a vendored entry point" question has no such fallback; fixed by discovering on path shape (`FLAT`/`NESTED_INDEX`) plus a case-insensitive `"vendored"` content marker instead of `isEntryPoint`.
- Both files' full falsification sets executed live and reverted (see below).
- Full suite (`npx vitest run`, 92 files, 1598 tests) and `npx tsc --noEmit` both exit 0 after each task and after both together.

## Task Commits

1. **Task 1: `tests/unit/extension-composition.test.ts` -- capability to evidence, both directions** -- `a0102bd` (test)
2. **Task 2: `tests/unit/tool-count-baseline.test.ts` -- the committed Phase 10 baseline** -- `34707e7` (test)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `tests/unit/extension-composition.test.ts` -- `CAPABILITY_SOURCES` registry (8 rows), 4 directions, 2 vacuity guards, 35 tests.
- `tests/unit/tool-count-baseline.test.ts` -- `TOOL_COUNT_BASELINE` registry (10 rows), 4 directions, 2 vacuity guards, 22 tests.

## The Total Model-Facing Tool Count This Plan Records

Per critical constraint 1 -- **the numbers below are split by provenance, never blended.**

### LIVE, in a session right now (project-scoped `.pi/extensions/*`, no install needed -- measured, real)

| Source | Tool(s) | Tokens | Phase |
|---|---|---|---|
| `.pi/extensions/safety/index.ts` | `approve_ky_command` | 275 | Phase 4 (predates Phase 7) |
| `.pi/extensions/qoder/index.ts` | `qoder_delegate` | 329 | Phase 5 (predates Phase 7) |
| `.pi/extensions/todo.ts` | `todo` | 96 | **Phase 7 (07-08)** |
| `.pi/extensions/questionnaire.ts` | `questionnaire` | 315 | **Phase 7 (07-08)** |
| `.pi/extensions/plan-mode/index.ts` | *(none)* | 0 | **Phase 7 (07-07)** |
| `.pi/extensions/loop-police/index.ts` | *(none)* | 0 | **Phase 7 (07-06)** |
| `.pi/extensions/checkpoint/index.ts` | *(none)* | 0 | **Phase 7 (07-03)** |

**Live total across all phases: 4 tools, 1015 tokens/turn** (matches `tests/unit/contributing-boundary.test.ts`'s `TOOL_REGISTRATION_ALLOWLIST` total exactly). **Phase 7's own contribution to that live total: 2 tools, 411 tokens/turn** (`todo` + `questionnaire`; the three other Phase 7 vendored extensions add zero tools).

### DECLARED, but NOT live (pinned in `.pi/settings.json` `packages[]`, never installed -- `07-10-SUMMARY.md`'s install gate was NOT SATISFIED; recorded from source, zero of these tool schemas have ever ridden on a real request from this machine)

| Package | Tool names | Count |
|---|---|---|
| `pi-subagents@0.49.0` | `subagent`, `subagent_wait`, `subagent_supervisor`, `intercom` | 4 |
| `pi-background-tasks@2.4.2` | `bg_run`, `bg_run_pi_attested`, `bg_status`, `bg_logs`, `bg_kill`, `bg_delegate`, `bg_result`, `fusion_reason`, `fusion_investigate`, `fusion_research`, `fusion_validate` | 11 |
| `@narumitw/pi-lsp@0.49.4` | `lsp_diagnostics`, `lsp_fix` | 2 |
| `pi-web-access@0.22.0` | `web_search`, `source_check`, `fetch_content`, `get_search_content` (conditional, default-enabled with this repo's actual config) | 4 |
| `pi-session-finder@0.5.6` | *(none)* | 0 |

**Declared total: 21 tool names, 0 live, 0 measured tokens** (no schema-byte measurement was performed for these -- `TOOL_COUNT_BASELINE`'s row shape records names and a `promptMetadata` boolean, not per-tool token costs, matching this plan's own declared file scope). If installed unmodified with this repo's current `.pi/settings.json`, these 21 would ride on every request in addition to the 1015-token live total above.

**Every one of the 21 declared tool names carries `promptSnippet` and/or `promptGuidelines`** (re-verified this session, see `TOOL_COUNT_BASELINE`'s `promptMetadata: true` rows) -- none of the 4 live Phase-7-vendored tools (`todo`, `questionnaire`) do.

## Decisions Made

See `key-decisions` in the frontmatter for full text. Summarized: (1) every npm tool name was re-obtained this session via read-only tarball inspection, never copied from research; (2) `pi-subagents`' parent-session pair is `subagent_supervisor`+`intercom`, correcting 07-12's `contact_supervisor` naming; (3) `structured_output` is a second, newly-found child-process-only exclusion; (4) `pi-web-access`'s conditional tools are recorded as default-enabled given this repo's actual config, not flatly either way; (5) the D-07-B redundant set is six tools per this plan's own wording, not the seven `docs/EXTENSIONS.md` names elsewhere; (6) vendored-entry-point discovery in `tool-count-baseline.test.ts` cannot use `isEntryPoint` alone, per the `loop-police/index.ts` re-export-default gap found during falsification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tool-count-baseline.test.ts`'s own vendored-entry-point discovery misclassified `loop-police/index.ts`**
- **Found during:** Task 2's own falsification pass (Direction 3 mutation)
- **Issue:** The first draft filtered discovered `.pi/extensions/` files through `extension-layout.test.ts`'s exported `isEntryPoint`. That function's `DEFAULT_EXPORT` regex matches `export default ...` declared directly; `.pi/extensions/loop-police/index.ts` instead re-exports (`export { loopPolice as default } from "./loop-police.ts";`, a deliberate deviation from a byte-for-byte upstream copy recorded in `loop-police/PROVENANCE.md`, forced by `extension-layout.test.ts`'s own nested-index single-default-export rule). `isEntryPoint` therefore returned `false` for a file Pi genuinely auto-discovers and loads, and the "declared-but-absent" Direction 3 test failed, naming `.pi/extensions/loop-police/index.ts` as no longer resolving on disk.
- **Fix:** Dropped the `isEntryPoint` filter from `discoverVendoredEntryPoints()` in favor of path-shape (`FLAT`/`NESTED_INDEX`, the auto-discovered shapes `isEntryPoint` was meant to gate anyway) plus a case-insensitive `"vendored"` content marker every one of the five vendored entry points genuinely carries.
- **Files modified:** `tests/unit/tool-count-baseline.test.ts`
- **Verification:** All 22 tests pass with the corrected discovery function; the same falsification (deleting the `loop-police/index.ts` marker-carrying header) was re-run afterward and correctly turned Direction 3 red for the right reason (a genuinely undeclared file), confirmed, then reverted.
- **Committed in:** `34707e7` (Task 2 commit -- this fix was made and verified before the task's own commit, so it is not a separate commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 -- a genuine bug in this task's own newly-written discovery logic, found and fixed by the falsification pass this plan's own critical constraints mandated).
**Impact on plan:** No scope creep -- the fix is entirely inside the one file this task creates, made before that file's own commit.

## Issues Encountered

None beyond the discovery-logic fix documented above.

## Stub Tracking

No stubs. Every registry row in both files is a real, re-verified fact (a tracked path, a pinned package spec, or a tool name read from real source this session) or explicitly labelled a recorded (not mechanically re-derivable) baseline in the file's own docstring -- never a placeholder.

## Threat Flags

None. This plan creates two test files that read existing tracked source and `.pi/settings.json`; it introduces no new network endpoint, auth path, file-access pattern, or schema change at a trust boundary. `npm pack`/`tar -xf` network calls were read-only, into a deleted scratch directory outside the repository, per critical constraint 2.

## User Setup Required

None. Every fact recorded was obtained via local file reads and read-only `npm pack`/`tar -xf`/`gh api`-class commands with no lifecycle scripts and no installation, per this plan's critical constraints.

## Next Phase Readiness

`tests/unit/extension-composition.test.ts` closes EXT-05 and EXT-06 with a machine-checked, both-directions registry. `tests/unit/tool-count-baseline.test.ts` is the committed baseline Phase 10 needs: 4 live tools / 1015 tokens right now (2 tools / 411 tokens of which are Phase 7's own contribution), plus 21 declared-but-uninstalled tool names across 5 pinned npm packages that would add an unmeasured-but-real schema cost the moment `RB-07-02` (plan 07-13's outstanding install runbook entry) actually runs `pi install`. The single largest named cut target for Phase 10 remains `pi-background-tasks`' six unfilterable `bg_delegate`/`bg_result`/`fusion_*` duplicates of `pi-subagents`' own delegation surface (decision D-07-B), now a committed, greppable fact in `TOOL_COUNT_BASELINE` rather than only a paragraph in `docs/EXTENSIONS.md`. No blockers for the remaining Phase 7 plans.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: tests/unit/extension-composition.test.ts
- FOUND: tests/unit/tool-count-baseline.test.ts
- FOUND: .planning/phases/07-composed-extensions-pinned-reviewed/07-11-SUMMARY.md
- FOUND commit: a0102bd
- FOUND commit: 34707e7
