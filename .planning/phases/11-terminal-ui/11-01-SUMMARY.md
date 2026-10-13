---
phase: 11-terminal-ui
plan: 01
subsystem: testing
tags: [vitest, faux-provider, extension-ui, harness]
requires: []
provides:
  - createRecordingUI recorder for ExtensionUIContext
  - uiContext / mode / fauxModels options on createHarnessSession
  - pinned event-firing facts for headless faux sessions at Pi 1.1.0
affects: [11-04, 11-05]
tech-stack:
  added: []
  patterns: [recording UI with plain-object theme, globalThis pi stash for pi.events emission]
key-files:
  created:
    - tests/helpers/recording-ui.ts
    - tests/integration/ui-harness-probe.test.ts
  modified:
    - tests/helpers/harness-session.ts
key-decisions:
  - "Default bindExtensions({}) path kept literal when neither uiContext nor mode is given"
requirements-completed: [UI-05]
duration: 10min
completed: 2026-10-13
---

# Phase 11 Plan 01: UI test harness Summary

Recording ExtensionUIContext plus harness options (uiContext, mode, fauxModels) and a probe test pinning which Pi events fire in a headless faux session.

## Tasks
1. Harness options and recording UI: b261a8f. context-floor (4) and prompt-stability (3) still green, no edits to them.
2. Probe test: see git log (f569718). 4 tests green; mutating "tui:true" to "rpc:true" failed the test as expected, then restored. `npx tsc --noEmit` clean.

## Probe findings
- session_start fires under bindExtensions: yes. With a recording UI and mode "tui", ctx.mode is "tui" and ctx.hasUI is true.
- Without uiContext: no UI calls recorded (no-op default), so the UI assertions are not vacuous.
- tool_execution_start/end fire for a faux call to a tool named "subagent": yes, both with the same toolCallId.
- Emitting on pi.events from a test via a stashed pi works: yes (key `__kyUiTestPi`, deleted in afterEach).
- Consequence: plans 04 and 05 can drive real events through the faux session; no need to call handlers directly.

## Deviations from Plan
- `ExtensionMode` is not exported from the package root, so the mode option is typed via `Parameters<AgentSession["bindExtensions"]>[0]["mode"]`. Minor, no behaviour change.
- The recording UI's `setWidget` is typed with a loose content parameter to satisfy the two-overload interface.

## Known Stubs
None.

## Self-Check: PASSED
