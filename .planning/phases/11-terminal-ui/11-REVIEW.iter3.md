---
phase: 11-terminal-ui
reviewed: 2026-10-13T11:10:00Z
depth: deep
iteration: 2
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
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 11: Code Review Report (iteration 2)

**Reviewed:** 2026-10-13T11:10:00Z
**Depth:** deep
**Files Reviewed:** 23
**Status:** issues_found

## Summary

This is a re-review after fix iteration 1 (commits 9500032..fb8e11c). I checked every fix against Pi 1.1.0 in `node_modules/@earendil-works/pi-coding-agent/dist`, and against a read-only extraction of the `pi-subagents@0.76.1` tarball. I ran two targeted test files once each, sequentially: `ui-chrome` (17 passed) and `ui-wire-check` (37 passed).

**Fixes verified correct:**

- **CR-01 (partly).**
  - Management calls (`action` set) and explicit `async: true` launches are no longer counted. The schema rejects an empty `action` (`schemas.js:265`, `minLength: 1`).
  - `subagent:process-terminal` really does carry the same id as `async-started`. The runner close handler uses `runId = launch.id` (`async-execution.js:507`), and the proof sets `runId` (`process-terminal.js:198`).
  - One residual remains for async workflows. See WR-01.
- **CR-02.** A request with no extractable system text, or whose system text is only the truncation marker, now counts as `missing`. `verdict` never returns PASS while `missing > 0`.
- **WR-01.** The runbook probe is a unique throwaway name, and `--probe ""` exits 64. Both are pinned in `docs-policy.test.ts`.
- **WR-02.** The probe is created only when `ctx.hasUI`. pi-subagents child sessions bind in `mode: "print"` with no UI (`child-session.js:445`), so the comment in `index.ts:83` is accurate.
- **WR-03.** The provider segment and field are gone. The comments in `index.ts:1-2` and `statusline.ts:56` are now true.
- **WR-04.** Tool declarations are hashed and searched. Routing's `setActiveTools` only narrows tools before the first message (`routing/index.ts:317-335`), so a stable tool list is a valid expectation and this will not false-FAIL. See WR-03 for the truncation gap.
- **WR-05.** The exit-128 test waits for the probe to settle and asserts that git was spawned exactly once.
- **WR-06 (compaction half).** `session_compact` exists (`types.d.ts:600`), and `ContextUsage.tokens` is `null` after compaction (`types.d.ts:198`). The test performs a real compaction.
- **WR-06 (`/tree` half).** Deferring it is the right call. The router does not re-read `ky:mode` on `session_tree`, so having the UI re-read it would show a mode the router is not using.
- **IN-04.** A single `guard()` helper now carries the one WHY comment.

**Still open from iteration 1 (Info, not re-counted below):** IN-01, IN-02, IN-03, IN-05, IN-06, IN-07, IN-08, and the redundant `bindExtensions` branch from IN-09.

## Warnings

### WR-01: An async workflow run can still stay counted for the rest of the session, and its children are counted on top of it

**File:** `.pi/extensions/ui/agents.ts:1-2`, `:24-29`, `:38-43`

**Issue:** The CR-01 fix relies on `subagent:process-terminal` to drop a run whose `async-complete` was never delivered. An async **workflow** never produces that event.

- **No runner process.** The workflow is launched in-process. `subagent-executor.js:5148` emits `async-started` with `id: workflowRunId` and `pid: process.pid`, and no runner is spawned. `emitProcessTerminalEvent` is wired only into `spawnRunner` (`async-execution.js:1314`, `:1926`).
- **Completion depends on delivery.** The workflow result is written to the results directory (`subagent-executor.js:5751`, `:5813`). `async-complete` then comes only from `result-watcher.js:528`, which is gated on delivery and ownership, or from a detach reconcile (`workflow-detach-reconcile.js:260`). The original CR-01 stuck-count path is therefore still open for every async workflow.

**Children add to the count.** Each workflow child is an ordinary async launch with its own `async-started`, so a 3-child async workflow shows "4 agents". That contradicts the tracker's JSDoc ("children belong to a run already counted").

**The file comment overstates the guarantee.** `agents.ts:2` says process-terminal "fires whenever the runner exits". In fact `finalize` returns without emitting when no proof was persisted (`async-execution.js:517-518`).

**Fix:** Do not count the in-process workflow envelope. Its children are counted, and they get process-terminal events. Then correct the comment:
```ts
if (topic === "subagent:async-started") {
  if ((payload as { mode?: unknown }).mode === "workflow") return false; // in-process: no runner, so no process-terminal
  ...
}
```
```ts
// async-complete is emitted only after delivery to the owning session (result-watcher.js:528);
// process-terminal follows a runner exit once its proof is persisted (async-execution.js:517).
```
Add a tracker test: `async-started {id:"w", mode:"workflow"}` leaves `running()` at 0.

### WR-02: `verdict` turns a real leak into INSUFFICIENT when turn ratios are missing or there is only one request

**File:** `scripts/ui-wire-check-core.ts:170-175`

**Issue:** The two early returns run before any evidence is examined. With two or more requests that contain a probe hit, or that have different system or tool hashes, the result is still INSUFFICIENT (exit 2) whenever `ratios` is empty. Ratios are empty when:

- the turns file is absent from the live log because of rotation (see IN-03),
- the session crosses midnight, or
- every turn-2+ row has `input + cacheRead === 0`.

A single request that contains the probe is likewise reported as INSUFFICIENT. The fix report for CR-02 says "`verdict` still returns FAIL when there is real failing evidence", but these two branches contradict that. For RB-11-03, a definite leak ends up recorded as "not enough data".

**Fix:** Collect the failing evidence first, and use INSUFFICIENT only when there is none:
```ts
const reasons: string[] = [];
for (const hit of wire.probeHits) reasons.push(`probe "${hit.probe}" found ... request ${hit.request}`);
if (wire.requests >= 2 && !wire.stable) reasons.push("system prompt differs between requests");
if (wire.requests >= 2 && !wire.toolsStable) reasons.push("tool list differs between requests");
for (const r of ratios) if (r.ratio < minRatio) reasons.push(...);
if (reasons.length > 0) return { status: "FAIL", reasons };
if (wire.requests < 2) return { status: "INSUFFICIENT", reasons: ["fewer than two main requests in this session"] };
if (ratios.length === 0) return { status: "INSUFFICIENT", reasons: ["no turn-2+ cache ratio available"] };
...
```
Add tests: a probe hit with `ratios = []` returns FAIL, and a single request with a probe hit returns FAIL.

### WR-03: Tool-list truncation by redaction is invisible, so a PASS can rest on a tool schema the check never read

**File:** `scripts/ui-wire-check-core.ts:72-78`, `:110-126`, `:191-194`

**Issue:** `redactDeep` turns any subtree deeper than 24 levels, or beyond 200,000 nodes, into the string `"[redacted:truncated]"` (`diagnostics/redact.ts:20-23`, `:103-104`). Tool parameter schemas are the deepest part of a request, because a nested chain, parallel, items or properties schema adds levels quickly.

- **Not flagged.** `extractToolText` serialises whatever survived. `truncated` is set only from the system text, so a truncated tool subtree raises neither a flag nor the "best-effort" caveat.
- **Probe misses.** A volatile value inside the truncated part hashes identically on every request, because the placeholder is constant, and the probe search cannot find it. The check reports a clean PASS for the tool half.
- **JSON escaping.** Probes are matched against JSON-escaped text, so a probe containing `"` or `\` (a Windows path) never matches.

This repeats the CR-02 pattern for the half that the WR-04 fix added.

**Fix:**
```ts
const tools = extractToolText(rec.payload);
if (tools.includes(TRUNCATED_MARKER)) truncated = true;
```
Then reword the reason to "system text or tool list truncated by redaction". Search probes against `JSON.stringify(probe).slice(1, -1)` as well as the raw probe. Add a test where `tools` contains the marker and assert that the PASS carries the caveat.

## Info

### IN-01: The "briefly counted twice" residual is the default path, and two tests encode the opposite of the shipped default

**File:** `.pi/extensions/ui/agents.ts:18-22`; `tests/unit/ui-statusline.test.ts:143-144`; `tests/integration/ui-chrome.test.ts:201-212`

**Issue:** In `pi-subagents@0.76.1`, `asyncByDefault` defaults to `true` (`extension/config.js:233`: `config.asyncByDefault !== false`). Dispatch is `(async ?? asyncByDefault) !== true` (`subagent-executor.js:7424`), and docs/EXTENSIONS.md:477 already records background as the configured default.

So a plain `subagent({agent, task})` call is an async launch. While it starts up, it is counted once as foreground; after `async-started` it is counted twice, until `tool_execution_end`. The fix report says this happens only for agents with `defaultAsync`; in fact it happens on every default call.

The visible effect is transient, because the overlap is a few milliseconds. But the unit test that asserts `{agent, task}` is a foreground run, and the integration test named "foreground subagent tool call", both describe the opposite of what the pinned package does.

**Fix:** Correct the residual note in the docs. Rename the tests, or have them pass `async: false` explicitly, so they describe the real foreground case.

### IN-02: `createGitProbe().reset()` is dead in production

**File:** `.pi/extensions/ui/git-probe.ts:110-118`

**Issue:** `index.ts` always runs `dispose()` and creates a new probe on `session_start`. `reset()` is called only by `ui-statusline.test.ts:274` and `:296`, so its tested "re-enable after 128" behaviour is unreachable.

**Fix:** Delete `reset()` and its tests, or use it instead of dispose-and-recreate.

### IN-03: The wire check reads only the live log files, so rotation or midnight splits a session silently

**File:** `scripts/ui-wire-check.mjs:53-54`, `:63-65`; `scripts/ui-wire-check-core.ts:143-163`

**Issue:** `wire-<date>.jsonl` rotates at 32 MB and `turns-<date>.jsonl` at 8 MB (`diagnostics/schema.ts:29`, `:32`), into `<stem>.<n>.jsonl` (`lib/jsonl.ts:181`). Each `main.request` carries the full message history, so 32 MB is reachable in one working day. When rotation or midnight splits a session:

- the request window shrinks without any notice;
- `turnRatios`' "skip the first turn" rule drops a mid-session turn instead of turn 1, so the reported "turn-2" ratio is a different turn;
- combined with WR-02, the check can end up INSUFFICIENT.

**Fix:** Read the rotated siblings (`wire-<date>.<n>.jsonl`, oldest first) before the live file, and print the files read. Alternatively, have RB-11-03 tell the user to run the check right after the session, on the same date.

---

_Reviewed: 2026-10-13T11:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
