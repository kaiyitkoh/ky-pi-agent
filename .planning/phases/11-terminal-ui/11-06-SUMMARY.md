---
phase: 11-terminal-ui
plan: 06
subsystem: ui
tags: [wire-check, prompt-cache, diagnostics, tdd]
requires: []
provides:
  - extractSystemText / analyseWire / turnRatios / verdict
  - scripts/ui-wire-check.sh live cache check
affects: [11-07]
tech-stack:
  added: []
  patterns: [pure typed core + thin mjs CLI + POSIX launcher]
key-files:
  created:
    - scripts/ui-wire-check-core.ts
    - scripts/ui-wire-check.mjs
    - scripts/ui-wire-check.sh
    - tests/unit/ui-wire-check.test.ts
key-decisions:
  - "Truncation by redaction is reported as a reason but does not by itself flip PASS to FAIL; hashes are then best-effort"
  - "Bad flags exit 64 with usage on stderr; missing log files exit 2 with the expected path on stdout"
requirements-completed: []
duration: 10min
completed: 2026-10-13
---

# Phase 11 Plan 06: Live wire-dump check Summary

A read-only POSIX command that hashes the system prompt across one session's `main.request` wire records, flags volatile probe strings, and checks turn-2+ cacheRead ratios, giving PASS (0), FAIL (1) or INSUFFICIENT (2).

Run: `sh scripts/ui-wire-check.sh [--logs DIR] [--date YYYY-MM-DD] [--session ID] [--last N] [--probe TEXT]... [--min-ratio X]`

## Tasks
1. Core: RED 2a7cb69, GREEN fc09b71 (23 tests).
2. CLI and launcher: 896f2d6 (29 tests total).

## Verification
- ui-wire-check (29) and lf-and-shell (23) green; `npx tsc --noEmit` clean.
- Mutation check: forcing `stable: true` failed 2 tests; restored.
- Launcher is `i/lf`; output grep for prompt text returns 0 and a test asserts the system text never reaches stdout.
- Redaction reviewed: strings are not length-truncated, only subtrees past the depth/node budget become `[redacted:truncated]`, which the core detects and reports.

## Deviations from Plan
- Unknown-flag exit code is 64 (non-zero as required) rather than 1, to separate usage errors from a FAIL verdict.
- Truncation note is appended to reasons without failing the verdict, per the plan's "best-effort" wording.

## Known Stubs
None.

## Self-Check: PASSED
