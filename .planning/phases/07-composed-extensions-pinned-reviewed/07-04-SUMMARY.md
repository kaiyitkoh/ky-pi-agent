---
phase: 07-composed-extensions-pinned-reviewed
plan: 04
subsystem: subagents
tags: [pi-subagents, frontmatter, EXT-01, routing, agentOverrides]

requires:
  - phase: 05-routing-model-mapping
    provides: "AGENT_NAME_BY_ROLE and the settings.subagents.agentOverrides read-modify-write (agent-overrides.ts)"
provides:
  - "The first shipped .pi/agents/*.md subagent definition (planner.md)"
  - "A mechanically-enforced no-model:-key rule over every .pi/agents/*.md, proven live against inline fixtures"
affects: [07-09 (agentScope settings.json wiring), phase-10-tool-count-baseline]

tech-stack:
  added: []
  patterns:
    - "Agent frontmatter parsed with a local flat-key-plus-fence extractor (not real YAML), mirroring pi-subagents' own custom parser"
    - "Forbidden-key enforcement over a frontmatter contract, proven live via inline never-shipped fixtures (same discipline as extension-layout.test.ts's isEntryPoint)"

key-files:
  created:
    - .pi/agents/planner.md
    - tests/unit/subagent-agents-config.test.ts
  modified: []

key-decisions:
  - "thinking: high chosen for the planner role -- a real frontmatter key at pi-subagents agents.ts:1644, distinct from Pi's bundled sample which parses no thinking key at all"
  - "tools restricted to read, grep, find, ls -- matches Pi's own bundled negative-analog sample's tool list exactly, minus its model: key"
  - "systemPromptMode: replace plus inheritProjectContext: false and inheritSkills: false, per CLAUDE.md's deliberately-minimal-context guidance for cheap executors"

patterns-established:
  - "Any future .pi/agents/*.md must carry name, description, tools, thinking, systemPromptMode and must NEVER carry model: or fallbackModels: -- enforced by tests/unit/subagent-agents-config.test.ts's completeness-both-directions and forbidden-key checks"

requirements-completed: [EXT-01]

duration: 20min
completed: 2026-08-15
---

# Phase 7 Plan 4: Planner Subagent Definition Summary

**Shipped `.pi/agents/planner.md` (read/grep/find/ls tool allowlist, `thinking: high`, no `model:` key) plus a live-proven test that a `model:` key would silently defeat Phase 5's `agentOverrides` routing.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 completed
- **Files modified:** 2 (both new)

## Accomplishments

- `.pi/agents/planner.md` ships the first subagent definition: `name`, `description`, `tools: read, grep, find, ls` (no write/edit/bash), `thinking: high`, `systemPromptMode: replace`, `inheritProjectContext: false`, `inheritSkills: false` — deliberately no `model:` or `fallbackModels:` key.
- `tests/unit/subagent-agents-config.test.ts` mechanically enforces the EXT-01 contract over every tracked `.pi/agents/*.md`: required-key coverage, the forbidden-key rule, and completeness in both directions against `AGENT_NAME_BY_ROLE` (never a hardcoded role name).
- The forbidden-key predicate is proven live against four inline fixtures (never written to `.pi/agents/`): one accepted, three rejected (`model:` present, `fallbackModels:` present, `description` missing).
- Falsification executed and recorded: `model: claude-haiku-4-5` was appended to `.pi/agents/planner.md`, the suite turned red on exactly the forbidden-key case with the expected message, and the file was reverted (confirmed byte-identical to the committed version — `git diff` empty before the Task 2 commit).

## Task Commits

Each task was committed atomically:

1. **Task 1: `.pi/agents/planner.md` — the first shipped subagent definition** - `e96593e` (feat)
2. **Task 2: `tests/unit/subagent-agents-config.test.ts` — enforce it, both directions** - `90f7e64` (test)

_No separate plan-metadata commit was made for this SUMMARY; it is committed together with STATE.md/ROADMAP.md updates per the standing final-commit step._

## Files Created/Modified

- `.pi/agents/planner.md` - The planner subagent's system prompt, tool restriction and thinking level; a body comment cites `pi-subagents/src/agents/agents.ts:1155` for why no `model:` key exists.
- `tests/unit/subagent-agents-config.test.ts` - `extractFrontmatter` (a local flat-key-plus-fence parser mirroring `pi-subagents`' own custom grammar) and `frontmatterViolations` (required/forbidden-key check), driven over real tracked `.pi/agents/*.md` files and over four inline fixtures.

## Decisions Made

- `thinking: high` for the planner: a real frontmatter key (`agents.ts:1644`), which is the fact that justifies depending on `pi-subagents` rather than vendoring Pi's own bundled subagent example (whose `agents.ts` parses no `thinking` key at all).
- Tool allowlist copied from Pi's own bundled `examples/extensions/subagent/agents/planner.md` (`read, grep, find, ls`), used explicitly as a **negative** analog for its `model:` key, which this file omits on purpose.
- No `fallbackModels:` key either — model selection in every form belongs to `.pi/extensions/routing/agent-overrides.ts` (Phase 5, ROUTE-05), never to an agent file's own frontmatter.
- Recorded for the record, per the plan's own instruction: `.pi/agents/*.md` is loaded only when `pi-subagents`' `agentScope` setting is `"project"` or `"both"` (default is user-level only). Writing that setting into `.pi/settings.json` is explicitly plan 07-09's job; this plan does not touch `.pi/settings.json`.

## Deviations from Plan

None — plan executed exactly as written. The frontmatter extractor was scoped to the flat `key: value` subset only (per the plan's own "Interfaces" note that the real parser is a custom flat-key-plus-folded-block grammar, not YAML), since no shipped agent file in this repo uses a folded block.

One in-flight correction, not a deviation from scope: the file's own header prose originally used the literal quoted string `"planner"` in a section title ("NO HARDCODED \"planner\""), which would have failed the plan's own acceptance grep (`grep -c '"planner"' ... shows the literal is not used as the discovery source`). Retitled to "NO HARDCODED ROLE NAME" before committing; `grep -c '"planner"' tests/unit/subagent-agents-config.test.ts` now returns `0`.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `.pi/agents/planner.md` and its enforcing test are in place; `.pi/extensions/routing/agent-overrides.ts` (Phase 5) can now target a real shipped agent file once `pi-subagents` is installed and `agentScope` is configured.
- Outstanding, explicitly deferred: `.pi/settings.json`'s `agentScope: "project"` or `"both"` setting (plan 07-09), and re-verification of `agentOverrides`' exact key path/shape against the real, pinned `pi-subagents` version once installed (agent-overrides.ts's own "PHASE 7 RE-VERIFICATION" note, not resolved by this plan).
- No blockers for subsequent Phase 7 plans.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: .pi/agents/planner.md
- FOUND: tests/unit/subagent-agents-config.test.ts
- FOUND: .planning/phases/07-composed-extensions-pinned-reviewed/07-04-SUMMARY.md
- FOUND commit: e96593e
- FOUND commit: 90f7e64
