---
phase: 11-terminal-ui
plan: 05
subsystem: ui
tags: [prompt-stability, lint, acp-portability, cache-prefix]
requires: ["11-01", "11-04"]
provides:
  - source lint banning prompt/tool/command/message surface in ui/ and ui.custom outside vendored files
  - offline proof that changing UI state leaves the wire system prompt and tool list byte-identical
affects: [11-07]
tech-stack:
  added: []
  patterns: [PROVENANCE-derived vendored set, status-to-prompt leak negative control]
key-files:
  created:
    - tests/unit/ui-prompt-surface-lint.test.ts
    - tests/integration/ui-prompt-stability.test.ts
key-decisions:
  - "Model switch stays inside the four-turn assertion: Pi's own prompt is not model-dependent here, so no with-ui/without-ui fallback test was needed"
requirements-completed: []
duration: 20min
completed: 2026-10-13
---

# Phase 11 Plan 05: Prompt surface lock Summary

Two test files, no production changes: a raw-source lint that keeps the ui extension off the prompt surface and authored prompts off `ui.custom`, and a four-turn full-extension session proving clock, branch, dirty file, routing mode, subagent and model changes never reach the wire prompt. UI-05 offline half exercised; requirement status left for plan 11-07.

## Tasks
1. Prompt-surface lint (6 tests): 419f3f6
2. Full-UI prompt stability (3 tests: main plus two negative controls): 1e380c6

## Vendored set found
Derived from PROVENANCE markers: `questionnaire.ts`, `todo.ts` (sibling markers) and every tracked `.ts` under `background-tasks/` (14), `checkpoint/` (3), `loop-police/` (2), `plan-mode/` (3). `ui.custom` appears only in the vendored questionnaire, todo and background-tasks/src/extension.ts; authored files use `ui.confirm` and `ui.select` only.

## Mutation checks
- Appended `// systemPrompt` to `.pi/extensions/ui/index.ts`: the ui-surface test failed as expected; reverted.
- Dropped the recording `uiContext` from the stability run: the main test failed at the anti-vacuity assertion (0 distinct statuses) and the status-leak control failed (no leak visible); reverted. The volatile-section control is independent of the UI and still passed.
- Regression files unchanged and green, run one at a time: prompt-stability (3), tool-count-baseline (23), workflow-budgets (130), pinning (41). `npx tsc --noEmit` clean.

## Deviations from Plan
- **No helper change needed**: the faux-pro model is resolved via `session.modelRuntime.getModel(session.model.provider, "faux-pro")`, so HarnessHandle gained no accessor.
- **Stash extension**: the plan's inline stash and the negative-control extensions share one inline extension file (the harness supports a single extra source), built by a small `extensionSource(body)` helper.

## Known Stubs
None.

## Self-Check: PASSED
