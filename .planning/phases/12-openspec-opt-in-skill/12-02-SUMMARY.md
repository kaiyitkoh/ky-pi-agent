---
phase: 12-openspec-opt-in-skill
plan: 02
subsystem: harness
tags: [openspec, skills, prompt-templates, telemetry, zero-cost]
requires: []
provides:
  - tests/fixtures/openspec-skills.ts (12 workflow table, SKILL.md and prompt generators)
  - agentSkills / agentPrompts options on the harness session helper
  - four OpenSpec opt-out env force-assignments in the harness extension
affects: [12-03, 12-04]
tech-stack:
  added: []
  patterns: [Pi loader as oracle instead of regex, unflagged skills as live negative control]
key-files:
  created:
    - tests/fixtures/openspec-skills.ts
    - tests/unit/openspec-skills.test.ts
    - tests/integration/openspec-zero-cost.test.ts
    - tests/unit/openspec-env.test.ts
  modified:
    - tests/helpers/harness-session.ts
    - .pi/extensions/harness/index.ts
key-decisions:
  - "Env opt-outs are forced, not defaulted, so an inherited OPENSPEC_TELEMETRY=1 cannot re-enable reporting"
requirements-completed: [OSPEC-1, OSPEC-2]
duration: 15min
completed: 2026-10-13
---

# Phase 12 Plan 02: zero-cost OpenSpec skills and telemetry opt-outs Summary

Pi's own loader and a real faux session prove twelve flagged OpenSpec skills plus twelve `opsx-*` templates leave the system prompt and tool list byte-identical, while `/skill:` and `/opsx-` still expand. The harness extension now force-sets the four OpenSpec opt-out env vars.

## Commits
- 66519f9 test: fixtures and loader-level proof (4 tests)
- f952109 test: helper options and session byte-identity (4 tests)
- 6ec23b7 feat: env force-assignments and test (3 tests)

## Verification
- openspec-skills (4), openspec-zero-cost (4), openspec-env (3), comment-rules-delivery (13), tool-count-baseline (23), context-floor (4), prompt-stability (3) all pass; `npx tsc --noEmit` clean.
- Negative controls: unflagged skills change the prompt and appear in the index; a quoted `"true"` is not honoured.
- RED for Task 3: before the assignments, `expected '1' to be '0'` on OPENSPEC_TELEMETRY (1 failed, 2 passed).
- No budget, floor or tool-count test edited; nothing under repo `.pi/skills` or `.pi/prompts`.

## Deviations from Plan
None of substance. The plan 01 note about `env VAR=val cmd` was respected; nothing relies on it.

## Known Stubs
None.

## Threat Flags
None.

## Self-Check: PASSED
Commits 66519f9, f952109, 6ec23b7 exist; all listed files present.
