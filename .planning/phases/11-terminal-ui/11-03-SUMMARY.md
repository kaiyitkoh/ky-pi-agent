---
phase: 11-terminal-ui
plan: 03
subsystem: ui
tags: [statusline, subagent-tracker, git-probe, tdd]
requires: []
provides:
  - formatStatusline / parsePorcelain / sanitizeLabel / formatTokens
  - createAgentTracker / SUBAGENT_BUS_TOPICS
  - createGitProbe / GIT_STATUS_ARGS
affects: [11-04, 11-05]
tech-stack:
  added: []
  patterns: [pure helpers with no Pi imports, injected exec/clock/scheduler for deterministic tests]
key-files:
  created:
    - .pi/extensions/ui/statusline.ts
    - .pi/extensions/ui/agents.ts
    - .pi/extensions/ui/git-probe.ts
    - tests/unit/ui-statusline.test.ts
key-decisions:
  - "Mode label capped at 12 chars and provider at 16 so the worst case renders in exactly 64 columns"
  - "reset() and dispose() bump a generation counter so a superseded in-flight run cannot touch state or report"
requirements-completed: []
duration: 8min
completed: 2026-10-13
---

# Phase 11 Plan 03: UI helper modules Summary

Three Pi-free helpers for the ui extension: a statusline formatter that only renders what Pi's footer lacks, a subagent run tracker, and a single-flight rate-limited git status probe, all covered by 24 unit tests with fake exec and clock.

## Tasks
1. statusline.ts + agents.ts: RED 3c57a2f, GREEN 9c8ceb7 (16 tests).
2. git-probe.ts: RED a4798db, GREEN b3b4c17 (24 tests total).

## Verification
- ui-statusline (24), extension-layout (10), comment-discipline (15) green; `npx tsc --noEmit` clean.
- Mutation check: disabling the changed-files segment failed 3 formatter tests; restored via git checkout.
- No default exports, no `@earendil-works` imports, forbidden-word grep returns 0, no setInterval.

## Deviations from Plan
- sanitizeLabel replaces remaining control characters with a space (then collapses whitespace) instead of deleting them, so tab/newline-separated words do not fuse; ANSI CSI/OSC sequences are removed outright first. Behavior-block cases unaffected.
- The tracker also deduplicates foreground tool starts by toolCallId (not specified, harmless).

## Known Stubs
None.

## Self-Check: PASSED
