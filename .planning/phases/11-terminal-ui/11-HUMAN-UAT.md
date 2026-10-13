---
status: partial
phase: 11-terminal-ui
source: [11-VERIFICATION.md]
started: 2026-10-13T03:27:16Z
updated: 2026-10-13T03:27:16Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. RB-11-01 — theme, header and statusline render in a real TUI
expected: `pi` in the repo shows the muted ky theme, the short ky-pi-agent header, and the `ky-statusline` segment (route, tokens left, changed files, agents) beside Pi's footer; `/settings` lists theme `ky`
result: [pending]

### 2. RB-11-02 — pi-subagents widget and statusline agent count during a real run
expected: one `async: false` and one default subagent call each show pi-subagents' widget and the count rises then returns to zero (precondition RB-07-02)
result: [pending]

### 3. RB-11-03 — live cacheRead and wire-dump check
expected: `sh scripts/ui-wire-check.sh --session <id> --probe "$probe"` reports PASS: identical system-prompt and tool-list hashes, no probe hits, turn-2+ cacheRead ratio >= 0.5
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
