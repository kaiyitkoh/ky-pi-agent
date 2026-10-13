---
phase: 11-terminal-ui
plan: 04
subsystem: ui
tags: [header, statusline, extension-wiring, recording-ui]
requires: ["11-01", "11-03"]
provides:
  - ui extension entry point (ky-statusline status, tui-only header)
  - formatHeaderLines / createHeaderComponent / HeaderInfo
affects: [11-05, 11-07]
tech-stack:
  added: []
  patterns: [single setStatus key, string-literal bus subscriptions, fire-and-forget git probe]
key-files:
  created:
    - .pi/extensions/ui/header.ts
    - .pi/extensions/ui/index.ts
    - tests/integration/ui-chrome.test.ts
key-decisions:
  - "Route defaults to cheap and is restored from the last ky:mode custom entry by string literal, no import from routing/"
requirements-completed: []
duration: 15min
completed: 2026-10-13
---

# Phase 11 Plan 04: ui extension wiring Summary

Thin `ui` extension: a two-line ky header in tui mode and one `ky-statusline` status (route, provider, context left, changed files, running subagents), with zero tools, commands or prompt changes. UI-02/03/04 are exercised here; requirement status is left for plan 11-07 to reconcile.

## Tasks
1. header.ts (pure lines + live component): d2ff8ac
2. ui/index.ts wiring: d06e301. context-floor (4) and extension-layout (10) green; the new entry point adds no tools or prompt chars.
3. Recording-UI integration tests: f38028a. 14 tests in ui-chrome green; `npx tsc --noEmit` clean.

## Mutation checks
- Replacing the `setHeader` call: header test failed as expected (the mutation also made session_start throw into its swallow, so other session tests failed too); restored.
- Replacing the subagent bus subscription: the subagent count test failed as expected, all others passed; restored.

## Deviations from Plan
- **json mode test**: the plan expected no status in json mode with a recording UI. Pi derives `ctx.hasUI` from the bound UI context rather than the mode, so the status is still recorded; the test asserts the header-only contract (zero setHeader calls), which is what the extension guarantees via `ctx.mode === "tui"`.
- **Git test seeding**: the probe goes silent after exit 128 until reset, so the repository is created in `beforeBind` (before session_start) via `session.sessionManager.getCwd()`; AGENTS.md copy disabled so the count is exactly 1.
- Header test uses `visibleWidth` (truncateToWidth appends ANSI reset codes, so raw length overstates width).

## Known Stubs
None. Subagent event shapes (`id` or `runId`) are exercised via bus stubs by design.

## Self-Check: PASSED
