---
phase: 11-terminal-ui
verified: 2026-10-13T00:00:00Z
status: human_needed
score: 5/5 requirements verified offline; 3 live runbook items outstanding
overrides_applied: 0
human_verification:
  - test: "RB-11-01 theme ky listed, custom header, ky-statusline segments in an interactive terminal"
    expected: "Theme selectable and applied, header renders, statusline segments visible beside Pi's footer"
    why_human: "Visual check in a real TUI"
  - test: "RB-11-02 pi-subagents widget and statusline agents count during a real subagent run"
    expected: "Widget shows running subagents; count rises for blocking and background runs, returns to none"
    why_human: "Needs live Pi session and model credentials"
  - test: "RB-11-03 live cacheRead ratio on turn 2 plus ui-wire-check across mode switches"
    expected: "ui-wire-check PASS, non-trivial turn-2 cacheRead ratio"
    why_human: "Needs provider credentials and a live wire log"
---

# Phase 11: Terminal UI Verification Report

**Goal:** The harness looks and feels like the user's own tool without costing the prompt prefix.
**Status:** human_needed (no automated gaps)

## Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Theme, header, statusline ship | VERIFIED | `.pi/themes/ky.json` (88 lines), `.pi/settings.json` has `"theme": "ky"`, `package.json` pi manifest lists `./.pi/themes` and `./.pi/extensions`. `.pi/extensions/ui/{index,header,statusline,git-probe,agents}.ts` exist, are substantive and wired: `index.ts` calls `setHeader` (tui only) and `setStatus("ky-statusline")` from session_start, turn_end, model_select, compact, tool and bus events. Targeted run: `ui-theme` + `ui-statusline` 46/46 pass. |
| 2 | Live widget shows running subagents | VERIFIED offline, live pending | Per locked decision, the widget is pi-subagents' own; `agents.ts` tracker feeds an "N agents" statusline segment from tool events and bus topics. `ui-chrome.test.ts` 18/18 pass (stub event shapes, never a real run). RB-11-02 OUTSTANDING. |
| 3 | cacheRead non-trivial; no volatile value in system prompt | VERIFIED offline, live pending | No `before_agent_start`, `systemPrompt` or `setWidget`/`setFooter` use in `.pi/extensions/ui/`; chrome only. `ui-prompt-stability.test.ts` 3/3 pass; `ui-prompt-surface-lint`, `ui-wire-check`, `ui-harness-probe` tests exist. Live ratio is RB-11-03 OUTSTANDING. |

Statusline scope: the model, provider, cost and branch segments are Pi's built-in footer (locked decision in 11-CONTEXT.md); the authored segment adds route, tokens left, changed files and agents. Treated as intended reuse, not a gap.

## Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| UI-01 | 11-02, 11-07 | SATISFIED (visual RB-11-01 pending) | ky.json + ui-theme test |
| UI-02 | 11-03, 11-04, 11-05, 11-07 | SATISFIED (visual RB-11-01 pending) | statusline.ts, ui-statusline and ui-chrome tests |
| UI-03 | 11-04, 11-07 | SATISFIED (visual RB-11-01 pending) | header.ts wired via setHeader |
| UI-04 | 11-03, 11-04, 11-07 | PARTIAL, needs human (RB-11-02) | agents.ts tracker, stub-event proof only |
| UI-05 | 11-01, 11-05, 11-06, 11-07 | PARTIAL, needs human (RB-11-03) | ui-prompt-stability, wire-check tooling |

All five IDs appear in PLAN frontmatter and in REQUIREMENTS.md; no orphaned requirements. REQUIREMENTS.md honestly marks UI-04 and UI-05 as partial.

## Anti-Patterns

Empty `catch {}` blocks in `index.ts` are annotated NEVER THROWS by design (chrome must not break a turn). No TBD/FIXME/TODO found in the surface checked. Code review ran 3 fix iterations. The 3 full-suite failures were fixed in 3f03c56 without budget changes; targeted reruns pass.

## Gaps Summary

None. Remaining work is the three live runbook checks (RB-11-01..03) recorded OUTSTANDING in docs/RUNBOOK.md, per project convention for live-only items.

_Verifier: Claude (gsd-verifier)_
