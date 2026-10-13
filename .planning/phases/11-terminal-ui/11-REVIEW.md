---
phase: 11-terminal-ui
reviewed: 2026-10-13T11:25:00Z
depth: deep
iteration: 3
files_reviewed: 23
files_reviewed_list:
  - .pi/extensions/ui/agents.ts
  - .pi/extensions/ui/git-probe.ts
  - .pi/extensions/ui/header.ts
  - .pi/extensions/ui/index.ts
  - .pi/extensions/ui/statusline.ts
  - .pi/settings.json
  - .pi/themes/ky.json
  - docs/EXTENSIONS.md
  - docs/RUNBOOK.md
  - docs/UI.md
  - scripts/ui-wire-check-core.ts
  - scripts/ui-wire-check.mjs
  - scripts/ui-wire-check.sh
  - tests/helpers/harness-session.ts
  - tests/helpers/recording-ui.ts
  - tests/integration/ui-chrome.test.ts
  - tests/integration/ui-harness-probe.test.ts
  - tests/integration/ui-prompt-stability.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/ui-prompt-surface-lint.test.ts
  - tests/unit/ui-statusline.test.ts
  - tests/unit/ui-theme.test.ts
  - tests/unit/ui-wire-check.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 11: Code Review Report (iteration 3)

**Reviewed:** 2026-10-13T11:25:00Z
**Depth:** deep
**Files Reviewed:** 23
**Status:** issues_found

## Summary

This is a re-review after fix iteration 2 (commits f3eeb81, d2d266a, a1589da, ae1986b). I checked each fix against the read-only `pi-subagents@0.76.1` extraction in the scratchpad (`x-pi-subagents_0.76.1/package/src`). I ran one targeted test file once: `tests/unit/ui-wire-check.test.ts`, 43 passed.

**Fixes verified correct:**

- **WR-01 (async workflow envelope).** The in-process envelope is emitted with `mode: "workflow"` and `pid: process.pid` (`subagent-executor.js:5148-5160`). Runner-spawned launches only ever carry `"single"`, `"chain"` or `"parallel"` (`async-execution.js:665`, `:1138`, `:1415`, `:1992`), so the new check cannot drop a real runner. A residual is in WR-01 below.
- **WR-02 (verdict ordering).** Failing evidence is now collected before either INSUFFICIENT branch. A single request with a probe hit, and a changed prompt with no ratios, both return FAIL. `missing > 0` still never yields PASS.
- **WR-03 (truncated tool list and escaped probes).** A truncated tool list sets `truncated`, and probes are also matched in JSON-escaped form. Both are covered by tests.
- **IN-01 (default-async counting).** `isForegroundLaunch` matches the dispatch rule `clarify === true || (async ?? asyncByDefault) !== true` (`subagent-executor.js:7424`) under the default `asyncByDefault = true` (`config.js:233`). The tests now pass `async: false` explicitly. The integration test for a default-async call would fail if the call were counted as foreground.

**Still open from earlier iterations (Info, not re-counted):** IN-02 (dead `reset()`), IN-03 (log rotation), IN-05, IN-06, IN-08, and the redundant `bindExtensions` branch. Iteration-1 IN-07 (wrong default session) is escalated to WR-02 below, with new source evidence.

## Warnings

### WR-01: A foreground workflow is counted once for its tool call and again for every child, and the tracker JSDoc says the opposite

**File:** `.pi/extensions/ui/agents.ts:20-24`, `:26-31`, `:40-46`

**Issue:** `subagent({ workflow | workflowScript, async: false })` passes `isForegroundLaunch`, so its tool call counts as 1. Its children are then launched as real async runners:

- **Children launch async.** When a child omits `async`, `prepareWorkflowLaunchParams` sets `workflowAwaitAsync: true` (`subagent-executor.js:4433-4435`). The child request then resolves through `params.async ?? asyncByDefault`, which is `true` by default (`:3978`, `:5954`).
- **Each child is counted.** `runAsyncPath` spawns a runner and waits on it (`:3140-3158`, `:3006-3018`). The runner emits `subagent:async-started` with `mode: "single"` and `parentWorkflowRunId` (`async-execution.js:1986-1998`). The tracker counts it, because only `mode: "workflow"` is skipped.

So a foreground workflow with 3 children shows "4 agents" for the whole run, which can last minutes. This is the same over-count the previous WR-01 removed for async workflows, now on the foreground path.

**The comments are wrong.** The JSDoc at `:27-28` says "children belong to a run already counted". After the async-workflow change, that is false for async workflows, whose children are the only thing counted, and it is the bug for foreground workflows. The JSDoc is also four lines with a 150-plus-character line, against AGENTS.md's "one sentence plus non-obvious params".

**Related gap.** Inside an async workflow, a child that sets `async: false` (or inherits it from workflow defaults) runs in-process. It gets no `async-started` and no tool call, so it is invisible.

**Fix:** The foreground workflow run id is derived from the tool-call id (`foregroundWorkflowRunId = encodeIndexSegment(_id)`, `subagent-executor.js:4759`). The simplest correct rule is to count a workflow only through its children:
```ts
function isForegroundLaunch(args: unknown): boolean {
  if (typeof args !== "object" || args === null) return false;
  const a = args as { action?: unknown; async?: unknown; clarify?: unknown; workflow?: unknown; workflowScript?: unknown };
  // A workflow is counted through its runner children (subagent-executor.js:4433), never its own call.
  if (a.workflow !== undefined || a.workflowScript !== undefined) return false;
  return a.action === undefined && (a.async === false || a.clarify === true);
}
```
Then rewrite the JSDoc as one sentence, for example: "Counts async runners by bus event and blocking subagent calls by tool call; workflows are counted through their runner children." Add a unit test: `onToolStart("subagent", "c1", { workflow: "x", async: false })` returns `false`.

### WR-02: The wire check's default session can be a subagent child, and RB-11-03's own procedure creates that case

**File:** `scripts/ui-wire-check-core.ts:100-102`; `scripts/ui-wire-check.mjs:272-273`; `docs/RUNBOOK.md` (RB-11-03 steps 4-5)

**Issue:** Without `--session`, `analyseWire` uses the session of the **last** `main.request` in `<cwd>/.pi/logs/wire-<date>.jsonl`. Async subagent children write to that same file:

- **Children load project extensions.** A runner-hosted child gets `ambientExtensions = input.host === "runner" && !toolPlan.disableAmbientExtensions` (`runs/shared/child-launch.js:199`). That is true by default, so the loader is built with `noExtensions: false` (`child-session.js:357`).
- **Same log file, different session id.** The child runs with `cwd` set to the repo. The diagnostics wire hook records `main.request` with `ctx.sessionManager.getSessionId()` and appends under `ctx.cwd` (`diagnostics/wire.ts:136-147`).

RB-11-03 step 4 says "run a subagent, and send one more turn". The default call is async, so the child is often still issuing requests after the parent's last turn. Step 5 then runs the check with no `--session`. The check analyses the child: a short session with its own system prompt and its own turn ratios. It can report PASS or INSUFFICIENT for a session the UI never touched, and a probe leak in the parent goes unseen. The only signal is the `session:` line, and the runbook never asks the user to check it.

This was iteration-1 IN-07 (Info). It is raised to Warning because the shipped procedure for the phase's own live acceptance check triggers it.

**Fix:**
- In `analyseWire`, collect the distinct `sessionId`s. When there is more than one and no `--session` was given, return them, and make the CLI print them and exit 2 (INSUFFICIENT) asking for `--session`.
- Alternatively, default to the session with the most `main.request` rows instead of the last one.
- Either way, update RB-11-03 step 5 to pass `--session <id>`, using the id Pi shows for the parent session (`/session`).
- Add a unit test: interleaved records from two sessions, with the child last, must not silently analyse the child.

## Info

### IN-01: Both INSUFFICIENT branches drop the truncation caveat

**File:** `scripts/ui-wire-check-core.ts:197-202`

**Issue:** `reasons` already holds the "truncated by redaction" caveat when `wire.truncated` is set. The `requests < 2` and `ratios.length === 0` branches return a fresh `reasons` array, so the caveat is lost. The `missing > 0` branch keeps it with `[...reasons, ...]`, so the three branches are inconsistent.

**Fix:** Use `reasons: [...reasons, "fewer than two main requests in this session"]`, and do the same in the ratios branch.

### IN-02: A request with no extractable system text is also skipped for the tool-list hash and the probe search

**File:** `scripts/ui-wire-check-core.ts:117-131`

**Issue:** The `missing` branch returns before `extractToolText` runs. A probe that appears in that request's tool list is never searched, and its tool hash is never compared. The verdict ends as INSUFFICIENT rather than FAIL, even though FAIL evidence was present.

**Fix:** Compute `tools`, hash it and search probes before the `missing` early return. Skip only the system-text hash for that request.

### IN-03: RB-11-02 asks for a foreground subagent run, but a plain call is now async

**File:** `docs/RUNBOOK.md` (RB-11-02 step 1)

**Issue:** "Run one foreground and one async subagent" gives no way to get a foreground run. After the IN-01 change, only `async: false` or `clarify: true` counts through the tool call, and under the default `asyncByDefault` a model's plain call is async. A tester will probably run two async subagents and record the foreground path as checked.

**Fix:** State it explicitly, for example: "ask for a subagent with `async: false` (blocking), then one with no `async` argument (background)". Also record which path each run took.

### IN-04: A whitespace-only `action` is classified differently from pi-subagents

**File:** `.pi/extensions/ui/agents.ts:23`

**Issue:** pi-subagents trims `action` and treats an empty result as a launch (`subagent-executor.js:7419-7422`). The tracker checks `a.action === undefined`, so `{ action: " ", async: false }` is a blocking launch that is not counted. This is a model-error edge case and is harmless in practice.

**Fix:** Use `typeof a.action === "string" ? a.action.trim() === "" : a.action === undefined`, or leave it and accept the edge case.

---

_Reviewed: 2026-10-13T11:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
