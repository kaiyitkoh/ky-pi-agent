---
phase: 11-terminal-ui
fixed_at: 2026-10-13T11:15:00Z
review_path: .planning/phases/11-terminal-ui/11-REVIEW.md
iteration: 2
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 11: Code Review Fix Report (iteration 2)

**Fixed at:** 2026-10-13T11:15:00Z
**Source review:** .planning/phases/11-terminal-ui/11-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 3 (WR-01..WR-03; critical_warning scope)
- Fixed: 3, plus IN-01, which was fixed on request
- Skipped: 0

Every fix has a test that fails without it. I checked this by stashing the source change, running the targeted test file to see it fail, then restoring the change and seeing it pass. I ran test files one at a time with `--maxWorkers=2` and never ran the full suite. `npx tsc --noEmit` ran once at the end and passed with exit 0.

Final targeted runs:
- `tests/unit/ui-statusline.test.ts`: 29 passed
- `tests/unit/ui-wire-check.test.ts`: 43 passed
- `tests/integration/ui-chrome.test.ts`: 18 passed

## Fixed Issues

### WR-01: An async workflow run can still stay counted for the rest of the session, and its children are counted on top of it

**Files modified:** `.pi/extensions/ui/agents.ts`, `tests/unit/ui-statusline.test.ts`
**Commit:** f3eeb81
**Applied fix:**
- The tracker no longer counts `subagent:async-started` events with `mode: "workflow"`. I confirmed in the pi-subagents@0.76.1 source (`subagent-executor.js:5148-5160`) that the in-process envelope is emitted with `mode: "workflow"` and `pid: process.pid`. The workflow is now counted through its children, and each child gets a process-terminal event.
- The file-header comment now says that process-terminal follows a runner exit only once its proof is persisted (`async-execution.js:517`).
- The JSDoc is updated to match.
- New test: a workflow envelope leaves `running()` at 0, and two children count as 2.

**Status:** fixed: requires human verification. This is a counting-logic change.

### WR-02: `verdict` turns a real leak into INSUFFICIENT when turn ratios are missing or there is only one request

**Files modified:** `scripts/ui-wire-check-core.ts`, `tests/unit/ui-wire-check.test.ts`
**Commit:** d2d266a
**Applied fix:**
- `verdict` now collects the failing evidence first: unstable system prompt, unstable tool list, probe hits and low ratios. If any is present it returns FAIL, still with the truncation caveat when that applies.
- INSUFFICIENT is returned only when there is no failing evidence and either fewer than 2 requests or no ratios exist.
- The `missing > 0` result is still INSUFFICIENT, never PASS.
- New tests (all three failed before the fix):
  - a probe hit with `ratios = []` returns FAIL
  - a single request with a probe hit returns FAIL
  - a changed prompt with `ratios = []` returns FAIL

**Status:** fixed: requires human verification. This is a verdict-logic change.

### WR-03: Tool-list truncation by redaction is invisible, so a PASS can rest on a tool schema the check never read

**Files modified:** `scripts/ui-wire-check-core.ts`, `tests/unit/ui-wire-check.test.ts`
**Commit:** a1589da
**Applied fix:**
- `analyseWire` sets `truncated` when the serialised tool list contains the redaction marker.
- Probes are also matched against their JSON-escaped form (`JSON.stringify(p).slice(1, -1)`) in the tool text.
- The caveat now reads "system text or tool list truncated by redaction; hash comparison is best-effort".
- New tests:
  - a truncated tool list sets `truncated`
  - a probe containing a backslash and a quote is found in a tool description
  - PASS with a truncated tool list carries the caveat

### IN-01: The "briefly counted twice" residual is the default path (Info; fixed on request)

**Files modified:** `.pi/extensions/ui/agents.ts`, `tests/unit/ui-statusline.test.ts`, `tests/integration/ui-chrome.test.ts`
**Commit:** ae1986b
**Applied fix:**
- `isForegroundLaunch` now follows the pi-subagents@0.76.1 dispatch rule (`subagent-executor.js:7424`, with `asyncByDefault` defaulting to true at `config.js:233`). A `subagent` call counts as foreground only when it has no `action` and sets `async: false` or `clarify: true`.
- A plain call, or a call with no args, is an async launch and is counted once, through its `async-started` event.
- The unit and integration tests that treated `{}` or `{agent, task}` as foreground now pass `async: false` explicitly. The integration test is renamed "shows an explicitly foreground subagent tool call while it runs".
- New tests: a default-async call is not counted before its bus event (unit and integration), and `clarify: true` is counted.

**Residual:**
- If a user config sets `asyncByDefault: false`, a plain call runs in the foreground but is not counted, because the tracker cannot read pi-subagents' config.
- `forceTopLevelAsync` can turn an explicit `async: false` into async, which brings back a brief double count.

Both are non-default settings, and this repo sets neither.

**Status:** fixed: requires human verification. This is a counting-logic change.

---

_Fixed: 2026-10-13T11:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
