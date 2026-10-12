---
phase: 10-context-budget-progressive-disclosure
plan: 02
subsystem: routing
tags: [tool-profiles, setActiveTools, context-floor, cache-prefix]
requires: ["10-01"]
provides:
  - "--ky-profile flag (recon|review|implement|full, default implement), applied once at session_start"
  - ".pi/extensions/routing/profiles.ts (pure table, resolver, applyProfile, findUnclassified)"
  - "CI completeness: every registered and baselined tool is classified"
affects: [10-03, 10-07]
key-files:
  created:
    - .pi/extensions/routing/profiles.ts
    - tests/unit/tool-profiles-table.test.ts
    - tests/integration/tool-profiles.test.ts
  modified:
    - .pi/extensions/routing/index.ts
    - tests/unit/tool-count-baseline.test.ts
    - tests/unit/workflow-budgets.test.ts
    - tests/integration/context-floor.test.ts
    - tests/helpers/harness-session.ts
requirements-completed: [CTX-01, CTX-02]
completed: 2026-10-13
---

# Phase 10 Plan 02: Named tool profiles Summary

Routing now narrows the active tool set once at `session_start` from `--ky-profile` (default `implement`) via `pi.setActiveTools()`, writing no tool removal into the transcript, with a CI guard that no tool ships unclassified.

## Membership as shipped

| Tool(s) | recon | review | implement | full |
|---|---|---|---|---|
| read, bash, approve_ky_command, web_enable | yes | yes | yes | yes |
| edit, write, todo | no | no | yes | yes |
| consult_advisor, lsp_diagnostics, lsp_fix, subagent, bg_wait, subagent_supervisor, subagents_enable | no | yes | yes | yes |
| web_search, fetch_content, get_search_content, source_check | yes | no | no | yes |
| questionnaire, bg_run, bg_status, bg_logs, bg_kill, qoder_delegate | no | no | no | yes |

Neutral (never removed): grep, find, ls, powershell (powershell found registered-but-inactive by the completeness test). `full` and read-only loadouts (no edit and no write active) are left untouched.

## Tasks and commits
1. Pure table and resolver: 7939d99
2. Flag and once-only narrowing wiring, baseline cross-check, ratchet: 7d456e2
3. Faux transcript proofs and completeness: 5d055e8

## Ratchet raise (workflow-budgets.test.ts)
- `.pi/extensions/routing` directory: 1020 -> 1110 (measured 1102 over 6 files). New code: profiles.ts (78 lines, table and resolver) plus 6 added lines in index.ts (import, flag registration, two-line narrowing, 2-line header). The index.ts file budget (320) was unchanged; it measures 318. `why` updated with the re-measurement.

## Decisions
- Offline-registered tools only: lsp_* , web_search, subagent etc. are not loaded in the harness (npm packages), so T1 membership assertions use tools actually registered offline; the pure table test pins every row by name.
- Added an optional `beforeBind` seam to `tests/helpers/harness-session.ts` (3 lines) to seed a persisted `plan-mode` entry before `session_start`; the resume case is therefore covered, not skipped.
- Context-floor BEFORE and attribution measurements pass `profile: "full"` so they stay the BEFORE configuration.

## Verification
- Targeted: tool-profiles-table, tool-count-baseline, workflow-budgets, tool-profiles, context-floor: 205 passed; comment-discipline, extension-layout, contributing-boundary: 30 passed. `npx tsc --noEmit`: clean. No full-suite run.
- Mutation run once and restored: routing always applying `"full"` fails the recon, review and implement T1 cases.
- Safety files, `.pi/settings.json`, docs/SAFETY.md and new-tool-paths test unchanged.

## Deviations from Plan
- [Rule 3] powershell added to neutral tools (found by the completeness test); harness `beforeBind` option added (file not in plan's list).
- Not testable offline (left for RB-10-03): third-party re-activation by pi-subagents, eager mode on DeepSeek.

## Self-Check: PASSED
