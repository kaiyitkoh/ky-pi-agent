---
status: partial
phase: 12-openspec-opt-in-skill
source: [12-VERIFICATION.md]
started: 2026-10-13T10:10:00Z
updated: 2026-10-13T10:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. RB-12-01 install and setup on work laptop and macOS
expected: `openspec --version` prints 1.13.2; `sh scripts/openspec-setup.sh --check` exits 0
result: [pending]

### 2. RB-12-02 live Pi session: skills slice unchanged; `/skill:openspec-explore` and `/opsx-explore` expand
expected: zero per-turn growth in `/budget`; both commands expand
result: [pending]

### 3. RB-12-03 telemetry egress under network capture
expected: no OpenSpec telemetry requests leave the machine
result: [pending]

### 4. RB-12-04 upgrade drill at next version bump
expected: documented upgrade path in docs/OPENSPEC.md works
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
