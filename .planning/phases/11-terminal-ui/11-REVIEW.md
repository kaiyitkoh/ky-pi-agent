---
phase: 11-terminal-ui
reviewed: 2026-10-13T02:45:16Z
depth: deep
files_reviewed: 25
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
  - AGENTS.md
  - CLAUDE.md
findings:
  critical: 2
  warning: 6
  info: 9
  total: 17
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-10-13T02:45:16Z
**Depth:** deep
**Files Reviewed:** 25
**Status:** issues_found

## Summary

I reviewed the `ui` extension, the wire-check tooling, the theme, the docs and runbook entries, and the Phase 11 tests. I checked claims against Pi 1.1.0 dist and against a read-only extraction of `pi-subagents@0.76.1`. Sources:

- Pi: `core/extensions/loader.js`, `core/event-bus.js`, `core/exec.js`, `modes/interactive/components/footer.js`, `core/settings-manager.js`, `core/system-prompt.js`.
- pi-subagents: `src/shared/types.js`, `runs/background/*.js`, `runs/foreground/subagent-executor.js`.

**What holds up:**

- **Stale context after `/reload` or session replacement.** Pi's `runtime.invalidate()` unsubscribes every `pi.events` handler. The extension's `generation` counter and `lastCtx = undefined` on `session_shutdown` stop a stale probe or context from writing.
- **No volatile value reaches the system prompt.** The `ui` extension has no system-prompt, tool or message surface. The prompt-stability test has real negative controls.
- **Git probe.** It uses `--no-optional-locks`, runs single-flight, and checks `killed`. That check matters because `execCommand` turns a signal-killed exit into `code: 0`.

**Main defects:**

1. The subagent counter counts the wrong things. Every `subagent` tool call counts as a running agent, including about 60 management actions, and async completion is gated on delivery.
2. The live wire check can report PASS without having read a system prompt.
3. The RB-11-03 procedure gives a false FAIL on `main`.
4. The git probe spawns processes in headless and subagent sessions where nothing displays the result.
5. The statusline duplicates Pi's provider field, which locked decision 4 forbids.

## Critical Issues

### CR-01: The subagent count includes management calls, double-counts async launches, and can get stuck

**File:** `.pi/extensions/ui/agents.ts:33-42`, `.pi/extensions/ui/index.ts:138-155`

**Issue:** `onToolStart` counts every `tool_execution_start` with `toolName === "subagent"` as a running foreground agent. In `pi-subagents@0.76.1` the `subagent` tool also serves about 60 management actions (`SUBAGENT_ACTIONS` in `src/shared/types.js:129`): `list`, `status`, `get`, `doctor`, `steer`, `interrupt`, `stop`, `schedule.*`, `watchdog.*`, `inspector.*` and more.

- **Management calls count as agents.** `subagent({action:"status"})` shows "1 agent" while it runs, even when nothing is running.
- **Steering double-counts.** Steering or stopping a running async run shows "2 agents".
- **Async launches double-count.** An async launch (`async: true`) fires `tool_execution_start` and also `subagent:async-started` (`async-execution.js:1409`, `:1986`; `subagent-executor.js:5148` for async workflows). Both are counted until the tool returns.
- **Parallel calls undercount.** A foreground `tasks:[...]` call that runs N children counts as 1.

**The decrement is gated on delivery.** `subagent:async-complete` is emitted by `result-watcher.js:528` only after `notifier.deliver()` is accepted and `ownsCompletion(...)` passes. Two branches return early without emitting it:

- the `alreadyDelivered` branch (`:444-461`)
- the not-owner branch

`pi-subagents` tracks job liveness itself through status polling and `subagent:process-terminal` (`extension/index.js:794`), and the tracker listens to neither. A run whose completion is not delivered to this session therefore stays counted until the next `session_start`.

The only success criterion for this segment is to show running subagents and their status. As written, the count is wrong in normal use. The offline stub test (`ui-chrome.test.ts:157-168`) uses a tool call with empty args, so it cannot see this.

**Fix:** Count a foreground call only when it is a launch, not a management action or an async launch. Also decrement on the terminal process event:
```ts
onToolStart(toolName: unknown, toolCallId: unknown, args: unknown): boolean {
  if (toolName !== "subagent" || typeof toolCallId !== "string" || toolCallId === "") return false;
  const a = (typeof args === "object" && args !== null ? args : {}) as { action?: unknown; async?: unknown };
  if (a.action !== undefined || a.async === true) return false; // management call or async launch (counted via the bus)
  ...
}
// and add "subagent:process-terminal" to SUBAGENT_BUS_TOPICS, deleting by its run id
```
Pass `event.args` from `index.ts:141`. Add tests with `{action:"status"}` and `{async:true}` args.

### CR-02: `ui-wire-check` reports PASS when it extracted no system text

**File:** `scripts/ui-wire-check-core.ts:97-108`, `scripts/ui-wire-check-core.ts:166-170`

**Issue:** When `extractSystemText` returns `undefined`, `analyseWire` hashes `""`. That happens for a payload shape it does not recognise, a fully truncated payload, or a payload where redaction replaced the system subtree.

- Every request then has the same hash, so `stable` is `true`.
- No probe can hit, because `text?.includes(probe)` is falsy.
- `truncated` is set, but `verdict` filters that reason out of `failed`.

The script therefore exits 0 with `PASS`, the verdict that is supposed to prove "no volatile value reached the system prompt" (RB-11-03, Phase 11 criterion 3), without having read a single byte of any system prompt. The tests also lock in the "best-effort" behaviour: `flags truncation by redaction` asserts only the flag, never the verdict.

**Fix:** Treat "no system text found" as INSUFFICIENT, never PASS:
```ts
// analyseWire: track how many requests yielded text
let missing = 0;
mine.forEach((rec, i) => {
  const text = extractSystemText(rec.payload);
  if (text === undefined) { missing += 1; return; }
  if (text.includes(TRUNCATED_MARKER)) truncated = true;
  hashes.push(sha256(text));
  ...
});
// verdict
if (wire.missing > 0) return { status: "INSUFFICIENT", reasons: [`${wire.missing} request(s) had no extractable system text`] };
```
Add a verdict test where the system text is absent, asserting the status is not PASS.

## Warnings

### WR-01: RB-11-03's branch-name probe gives a false FAIL on `main` and silently probes nothing on a detached HEAD

**File:** `docs/RUNBOOK.md:1734`, `scripts/ui-wire-check.mjs:31`, `scripts/ui-wire-check-core.ts:92`

**Issue:** Step 4 runs `--probe "$(git branch --show-current)"`. Pi renders AGENTS.md and CLAUDE.md into the system prompt as `<project_instructions>` (`core/system-prompt.js:25-28`, candidates at `core/resource-loader.js:116`). This repo's AGENTS.md:25 contains `` `main` ``. On `main`, the probe therefore always hits and the check FAILs although nothing leaked.

On a detached HEAD the substitution is `""`, which `analyseWire` silently drops. The run then reports PASS with no probe at all. The suggested `--probe <changed-file-name>` collides in the same way with names that the instructions mention (`index.ts`, `README.md`, and so on).

**Fix:** In the runbook, require a uniquely named throwaway branch and file, for example `ky-probe-$(date +%s)`. Make the script exit 64 on an empty `--probe` value instead of dropping it.

### WR-02: The git probe spawns `git status` in sessions with no UI, including print, json and subagent child sessions

**File:** `.pi/extensions/ui/index.ts:79-86`, `:102`, `:122`, `:151`

**Issue:** `refresh()` returns early when `!ctx.hasUI`, but the probe is still created and triggered on every `session_start`, `turn_end` and edit/write/bash `tool_execution_end`. In `-p` and `--mode json` runs, and in any pi-subagents child process that loads project extensions, each turn spawns a `git status` whose result nothing ever displays.

On Windows a process spawn is expensive. With N concurrent subagents in the same worktree, this becomes N × per-turn `git status` runs against the same index. It is cost with no consumer, and it contradicts the "never blocking, throttled" intent.

**Fix:** Create and trigger the probe only when there is a UI:
```ts
probe = ctx.hasUI ? createGitProbe({...}) : undefined;
...
refresh();
probe?.trigger();
```

### WR-03: The statusline duplicates the provider that Pi's footer already shows, and the comments claim otherwise

**File:** `.pi/extensions/ui/statusline.ts:57`, `:60`, `:68`; `.pi/extensions/ui/index.ts:1-2`; `docs/UI.md:129-135`

**Issue:** Pi's footer already shows `(provider)` whenever `getAvailableProviderCount() > 1` (`footer.js:213-216`). This harness always configures several providers (deepseek, dashscope, amazon-bedrock). Locked decision 4 says not to duplicate a field Pi already renders unless the custom version replaces it, and here it does not.

The file header in `index.ts` ("adds just what it lacks (route, provider, ...)") and the `formatStatusline` JSDoc ("Renders only what Pi's default footer lacks") are factually wrong. AGENTS.md says a wrong comment is worse than none. UI.md's own table lists provider in both columns.

**Fix:** Remove the provider segment, or document it as a deliberate exception: Pi drops the provider when the line is too narrow, as noted in RESEARCH. If you keep it, record that exception in CONTEXT and correct both comments.

### WR-04: The live wire check ignores the tool list, although the docs say the whole request is checked

**File:** `scripts/ui-wire-check-core.ts:97-108`; `docs/UI.md:165-175`

**Issue:** UI.md says no UI value reaches "the system prompt or the tool list", and that the script "searches the requests for probe text". The script hashes and probes only the extracted system text. A volatile value in a tool description or parameter schema would change the cached prefix (on the providers this repo uses, tools sit before or alongside the system prompt in the cache key) and would not be detected live. The offline test checks only tool names, not descriptions.

**Fix:** Include the request's tool declarations in the hash, and search them for probes. For example, hash `JSON.stringify(payload.tools ?? payload.toolConfig ?? null)` next to the system text. Alternatively, correct the UI.md wording to say "system text only".

### WR-05: The "outside a git checkout" test races and does not exercise the exit-128 path

**File:** `tests/integration/ui-chrome.test.ts:178-182`

**Issue:** The test asserts right after `prompt()` resolves, while the git probe started at `session_start` and `turn_end` is still asynchronous. If someone broke the extension to render `0 changed` outside a repo (for example `onResult(changed ?? 0)`), the assertion could run before the probe resolves and still pass.

The test also cannot tell the dedicated `code === 128` disable branch (`git-probe.ts:54-58`) from the generic non-zero branch. Both produce `undefined`, so deleting the 128 handling leaves it green. This breaks CONTEXT's "each new test must fail when its subject is removed".

**Fix:** Wait for the probe to settle before asserting, for example with `vi.waitFor` on an exec spy or a second `turn_end`. Then assert that a second trigger spawns no further git process, which proves the disable latch.

### WR-06: The statusline goes stale after compaction and `/tree` navigation

**File:** `.pi/extensions/ui/index.ts:70-168`

**Issue:** `refresh()` runs only on `session_start`, `turn_end`, `model_select`, subagent tool events and bus events. After `/compact`, `ctx.getContextUsage()` changes sharply (Pi documents `tokens: null` right after compaction), but the "N left" segment keeps its pre-compaction value until the next turn ends. Pi's own footer re-renders immediately, so the two disagree.

`/tree` navigation to a branch with a different `ky:mode` entry likewise leaves the header and statusline showing the old mode.

**Fix:** Subscribe to `session_compact` and `session_tree`, re-run `restoreRoute(ctx)` on `session_tree`, and then call `refresh()`.

## Info

### IN-01: `restoreRoute` uses different rules from the router it mirrors

**File:** `.pi/extensions/ui/index.ts:16`, `:30-41`

**Issue:** `routing/index.ts:253-271` takes the latest `ky:mode` entry only, and maps an invalid mode to `DEFAULT_MODE`. The UI accepts any string, and it skips a malformed latest entry to fall back to an older valid one.

A hand-edited or corrupt entry can therefore make the header and statusline show a mode the router is not in. `DEFAULT_ROUTE = "cheap"` duplicates `DEFAULT_MODE`, and it shows "cheap" even when routing is not loaded.

**Fix:** Apply the same rule: use only the last entry, validate it against `cheap|balanced|max`, and fall back to the default.

### IN-02: `sanitizeLabel` truncates by UTF-16 code units and leaves bidi and zero-width characters

**File:** `.pi/extensions/ui/statusline.ts:22-32`

**Issue:** `slice(0, max - 1)` can split a surrogate pair, leaving a lone surrogate. Length is measured in code units, not terminal columns. Bidi overrides (U+202A–U+202E, U+2066–U+2069) and zero-width characters survive, so a crafted mode or provider string could visually reorder the footer.

**Fix:** Strip `\p{Cf}`, and truncate with `truncateToWidth` from pi-tui, as `header.ts` already does.

### IN-03: The prompt-surface lint can be bypassed and misses some context-rewriting hooks

**File:** `tests/unit/ui-prompt-surface-lint.test.ts:11`, `:13-26`

**Issue:**

- `UI_CUSTOM` misses `const { custom } = ctx.ui` and `ctx.ui["custom"]`.
- The hook regex misses template-literal event names.
- Hooks that also change what the model sees are not forbidden: `tool_result` (patches results into context), `message_end` (replaces messages) and `input` (transforms user text).

**Fix:** Add `tool_result|message_end|input` to the forbidden hook alternation, and match on `\bcustom\b` inside `ui/`.

### IN-04: Comments that only repeat "Swallowed deliberately."

**File:** `.pi/extensions/ui/index.ts:104`, `:114`, `:124`, `:134`, `:143`, `:153`, `:166`, `:175`

**Issue:** The same comment appears eight times and gives no reason; the reason is stated only once, at `:66`. AGENTS.md: comment only a non-obvious WHY, and never narrate.

**Fix:** Wrap the handlers in a single `guard(fn)` helper with one WHY comment, and delete the repeats.

### IN-05: Inconsistent indentation inside one extension

**File:** `.pi/extensions/ui/agents.ts`, `git-probe.ts`, `statusline.ts` (2 spaces) versus `index.ts`, `header.ts` (tabs); `tests/unit/ui-statusline.test.ts` (2 spaces)

**Fix:** Use tabs throughout, to match the rest of the repo.

### IN-06: Git probe on Windows

**File:** `.pi/extensions/ui/index.ts:80`; `.pi/extensions/ui/git-probe.ts:98`

**Issue:**

- **Possible orphan on timeout.** `execCommand` kills only the direct child (`proc.kill("SIGTERM")`, `core/exec.js:20-29`). On Git for Windows, `git` on PATH is often the `cmd\git.exe` redirector. If the 5 s timeout fires, the real `mingw64\bin\git.exe` may keep running. I have not verified this live.
- **Silent retry loop.** A repo that always times out retries every 20 s (`4 × 5000`) indefinitely, with no indication of why the segment never appears.

**Fix:** After two consecutive timeouts, disable the probe the same way exit 128 does.

### IN-07: The wire check's session and ratio selection

**File:** `scripts/ui-wire-check-core.ts:89-91`, `:121-141`

**Issue:**

- **Wrong default session.** The default session is the last `main.request` in a per-cwd log. A second Pi session in the same repo, or a subagent child that loads the diagnostics extension, can make the script analyse the wrong session.
- **Ratio window.** `turnRatios` ignores `--last`, so it covers a different window from the hashes.
- **Overstated ratio.** `turnRatios` omits `cacheWrite` from the denominator, which overstates the ratio on Anthropic/Bedrock.

**Fix:** Print every session id found and require `--session` when there is more than one. Apply the same window to the ratios.

### IN-08: Launcher exit codes and the test's shell discovery

**File:** `scripts/ui-wire-check.sh:9-12`; `tests/unit/ui-wire-check.test.ts:125-129`

**Issue:**

- **Exit-code collision.** `die` exits 1, which is the same code as a FAIL verdict.
- **Shell discovery can break the whole file.** The test resolves `sh` with a non-null assertion inside `describe`. A missing `sh` throws during collection and takes the pure unit tests in the same file down with it.

**Fix:** Have `die` exit 3. Use `it.skipIf` when `sh` cannot be found.

### IN-09: Test-helper redundancy and a vacuous smoke test

**File:** `tests/helpers/harness-session.ts` (bindExtensions branch); `tests/integration/ui-chrome.test.ts:195-199`

**Issue:**

- **Redundant branch.** The `uiContext === undefined && mode === undefined` branch is unnecessary, because spreading two empty objects already gives `{}`.
- **Vacuous smoke test.** The print-mode test passes with the `ui` extension removed or completely broken: `hasUI` is false and every handler swallows errors.

**Fix:** Collapse the branch. Either delete the print-mode test, or assert something about the subject, such as no `git` spawn once WR-02 is fixed.

---

_Reviewed: 2026-10-13T02:45:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
