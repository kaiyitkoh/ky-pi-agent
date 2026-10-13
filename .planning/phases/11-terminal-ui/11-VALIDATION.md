---
phase: 11
slug: terminal-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-13
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 11-RESEARCH.md "Validation Architecture".

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <single test file> --maxWorkers=2` |
| **Full suite command** | `npx vitest run` (once, at verification) |
| **Estimated runtime** | ~5-30 s per targeted file |

## Sampling Rate

- **After every task commit:** the single targeted test file for that task (`--maxWorkers=2`, never concurrent)
- **After every plan:** `npx tsc --noEmit` once, plus regression files (tool-count-baseline, workflow-budgets, pinning, prompt-stability) run one at a time
- **Before verification:** full suite once
- **Max feedback latency:** 60 seconds

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| UI-01 | theme has 51 required tokens, no unknown keys, legal values, vars resolve; loader accepts; settings `theme` matches | unit | `npx vitest run tests/unit/ui-theme.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| UI-02 | statusline formatting, porcelain parsing, probe throttle/single-flight/non-repo | unit | `npx vitest run tests/unit/ui-statusline.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| UI-02/03 | header + statusline set with recording UI; no UI calls when hasUI false | integration | `npx vitest run tests/integration/ui-chrome.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| UI-04 | stubbed subagent events drive statusline count up and back to zero | unit/integration | `npx vitest run tests/unit/ui-statusline.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| UI-05 | system prompt + tool list byte-identical across turns with UI state changing; volatile values absent; negative control | integration | `npx vitest run tests/integration/ui-prompt-stability.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| UI-05 | no `ui.custom` in non-vendored sources; ui ext has no prompt/tool surface | unit | `npx vitest run tests/unit/ui-prompt-surface-lint.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |
| UI-05 (live) | wire-check script parser | unit | `npx vitest run tests/unit/ui-wire-check.test.ts --maxWorkers=2` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

- [ ] `tests/helpers/harness-session.ts` uiContext/mode forwarding + `tests/helpers/recording-ui.ts`
- [ ] Probe: do `session_start` / `tool_execution_*` fire under `bindExtensions` with faux
- [ ] New test files listed above

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Theme/header/footer look right in a real TUI | UI-01..03 | needs interactive terminal | RB-11-01 |
| pi-subagents widget + statusline segment during a real run | UI-04 | package installs only on live machine | RB-11-02 |
| cacheRead non-trivial on turn 2+ with full UI; wire dump hashes equal | UI-05 | live inference | RB-11-03 (`sh scripts/ui-wire-check.sh`) |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
