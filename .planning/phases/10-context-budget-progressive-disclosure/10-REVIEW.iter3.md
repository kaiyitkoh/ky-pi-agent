---
phase: 10-context-budget-progressive-disclosure
reviewed: 2026-10-12T23:26:45Z
depth: deep
iteration: 2
files_reviewed: 30
files_reviewed_list:
  - .pi/extensions/background-tasks/PROVENANCE.md
  - .pi/extensions/background-tasks/src/core/shell-policy.ts
  - .pi/extensions/diagnostics/budget.ts
  - .pi/extensions/routing/index.ts
  - .pi/extensions/routing/profiles.ts
  - docs/DIAGNOSTICS.md
  - docs/EXTENSIONS.md
  - docs/ROUTING.md
  - docs/RUNBOOK.md
  - scripts/ctx-experiment-core.ts
  - scripts/ctx-experiment.mjs
  - scripts/ctx-experiment.sh
  - tests/helpers/harness-session.ts
  - tests/integration/context-floor.test.ts
  - tests/integration/context-hook-tools.test.ts
  - tests/integration/prompt-stability.test.ts
  - tests/integration/tool-profiles.test.ts
  - tests/unit/agents-md-budget.test.ts
  - tests/unit/budget-command.test.ts
  - tests/unit/context-hook-lint.test.ts
  - tests/unit/ctx-experiment-launcher.test.ts
  - tests/unit/ctx-experiment.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/ky-profile-flag.test.ts
  - tests/unit/prompt-metadata-lint.test.ts
  - tests/unit/shell-policy-gate.test.ts
  - tests/unit/tool-count-baseline.test.ts
  - tests/unit/tool-profiles-table.test.ts
  - tests/unit/workflow-budgets.test.ts
  - AGENTS.md
findings:
  critical: 1
  warning: 3
  info: 9
  total: 13
status: issues_found
---

# Phase 10: Code Review Report (re-review after fix iteration 1)

**Reviewed:** 2026-10-12T23:26:45Z
**Depth:** deep
**Files Reviewed:** 30
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

This re-review covers the 12 fix commits `9040c3f..19b8e9c` (diff `5054eae..HEAD`) and the original 29-file scope, plus `tests/unit/ky-profile-flag.test.ts`. I checked Pi 1.1.0 behaviour in the installed source:

- `pi-agent-core/dist/agent-loop.js` (`declareToolChanges`)
- `pi-ai/dist/utils/transcript.js` (`getCurrentTools`)
- `pi-coding-agent/dist/core/agent-session.js`: the prompt flow at 1588-1625, `setActiveToolsByName`, `_restoreToolsFromTranscript`, `_runAgentPrompt`
- `extensions/runner.js` (`emitBeforeAgentStart`)
- `session-manager.js` (projection and compaction)
- `cli/args.js` and `resource-loader.js`

I ran three throwaway probes in the scratchpad: the rendered skill paths, vitest worker argv, and the shell-policy section after a dropped tool. I did not run the repo suite.

Answers to the six focus points:

1. **WR-01 fix and the "loadout decided before the first request" invariant: holds for declarations, but a new prompt defect was introduced.**
   - Pi computes `toolsAdded`/`toolsRemoved` before each request as the difference between the transcript's `getCurrentTools` and `context.tools` (`agent-loop.js:216-245`).
   - The new `before_agent_start` hook keeps every name in `getCurrentTools(buildSessionProjection().messages)`. It therefore never removes a declared tool and never causes a `toolsRemoved`; it only suppresses additions.
   - Compaction keeps the declared set (`appendCompaction` stores `systemMessage`), so the check also holds after compaction.
   - Because the hook runs inside the same `before_agent_start` emit, handlers that ran earlier see the un-narrowed `selectedTools`. Confirmed: the shell-policy section is sent for a `bg_run` that was dropped (WR-01).
2. **CR-01 (resume/reload/fork): correct.** Pi restores the transcript loadout before `session_start`, and the `type === "message"` skip leaves it alone. A new session with no messages is still narrowed. However, the control test for that case and the reload test are vacuous (WR-02).
3. **CR-02: verified. The key is never on any argv.**
   - The launcher only runs `printenv "$NAME"` inside a command substitution and passes the variable *name*.
   - `ctx-experiment.mjs run` puts the key only in the `env` object.
   - The `sh -c 'exec "$0" "$@"'` argv carries pi, its flags and the prompt only.
   - The `PI_*`/`PATH`/`HOME`/… denylist is case-insensitive in both the shell and the mjs.
4. **CR-03: exclusion and ceiling arithmetic are correct** (`planned = trials + excluded`, `<= 5% + ε`, applied through `decideArms` everywhere). One gap: the prose root cause bypasses the ceiling, contrary to DIAGNOSTICS.md (WR-03).
5. **Path normalisation: confirmed, and worse than reported** (CR-01). Six repo paths in every measured prompt are rendered with backslashes and are never normalised: three Pi doc paths and three skill `<location>`s. The `PAD_TOKENS` exact-equality test therefore fails on both CI legs.
6. **AGENTS.md comment rules: the fix commits add no CR/WR/CTX/RB IDs or history wording.** Pre-existing violations remain (IN-04), and the fixes left some comments stale (IN-08).

## Critical Issues

### CR-01: Floor measurements are not path-normalised, so `PAD_TOKENS` and the BEFORE-floor assertion depend on the checkout path and fail on CI

**File:** `tests/helpers/harness-session.ts:231-249` (also `:8`), `tests/unit/ctx-experiment.test.ts:492-497`, `tests/integration/context-floor.test.ts:3-4,81`, `scripts/ctx-experiment-core.ts` (`PAD_TOKENS = 2653`), `docs/DIAGNOSTICS.md:407-408`

**Issue:** `repoRoot()` returns `git rev-parse --show-toplevel`, which is `C:/Users/...` with forward slashes on Windows. `normalisePaths` adds only a `forwardSlash()` variant of each path, which is a no-op here, and never adds a backslash variant. Pi renders paths through `node:path`, so on Windows the prompt carries the raw backslash form. Probe output from a normalised bare-plus-skills prompt in this checkout:

```
- Main documentation: C:\Users\Admin\Documents\ky-pi-agent\node_modules\@earendil-works\pi-coding-agent\README.md
- Additional docs: C:\Users\Admin\Documents\ky-pi-agent\node_modules\@earendil-works\pi-coding-agent\docs
- Examples: C:\Users\Admin\Documents\ky-pi-agent\node_modules\@earendil-works\pi-coding-agent\examples ...
    <location>C:\Users\Admin\Documents\ky-pi-agent\.pi\skills\grill\SKILL.md</location>
    <location>C:\Users\Admin\Documents\ky-pi-agent\.pi\skills\plan-ceremony\SKILL.md</location>
    <location>C:\Users\Admin\Documents\ky-pi-agent\.pi\skills\review\SKILL.md</location>
```

The consequences:
- **`PAD_TOKENS` fails on both CI legs.** It is pinned with `toBe(full - bare)`. The three Pi doc paths cancel out in that difference, but the three skill paths appear only in `full`.
  - On macos-latest, the forward-slash path *is* normalised to `<repo>` (6 characters instead of 36), so `full` is about 22 tokens smaller.
  - On windows-latest (`D:\a\ky-pi-agent\ky-pi-agent`, 28 characters) it is about 6 tokens smaller.
  - The test fails on both legs of `.github/workflows/ci.yml`.
- **The BEFORE-floor assertion has no headroom.** `context-floor.test.ts:81` asserts `full <= BEFORE_FULL_FLOOR` (4233). Any checkout path longer than this one fails it, which is exactly what the fixer hit in a `%TEMP%` worktree (4248).
- **The published numbers are not reproducible.** The headers ("identical on every machine", harness `:8`, DIAGNOSTICS.md:407-408) are false. Every measured figure in DIAGNOSTICS.md is specific to `C:\Users\Admin\Documents\ky-pi-agent`, and so is the pre-registered pad size, which was derived by hand-subtracting a 15-token offset.

**Fix:** Normalise both separator forms, then re-measure and re-pin `PAD_TOKENS`, `BEFORE_FULL_FLOOR`, `FLOOR_CEILINGS` and the DIAGNOSTICS.md figures in one commit:
```ts
const backSlash = (p: string): string => p.replace(/\//g, "\\");
const variants = pairs.flatMap(([path, placeholder]) => [
	[path, placeholder] as const,
	[forwardSlash(path), placeholder] as const,
	[backSlash(path), placeholder] as const,
]);
// and canonicalise the remaining separators so `<repo>\.pi\skills\x` and `<repo>/.pi/skills/x` count the same:
out = out.replace(/<(repo|cwd|agent)>[\\/][^\s<]*/g, (m) => m.replace(/\\/g, "/"));
```
Add a unit test that runs `normalisePaths` on a backslash `<location>` line and expects `<repo>/...`, so this cannot regress silently.

## Warnings

### WR-01: The pre-prompt narrowing runs mid-emit, so earlier `before_agent_start` handlers build the prompt from the un-narrowed loadout

**File:** `.pi/extensions/routing/index.ts:327-338`, interacting with `.pi/extensions/background-tasks/src/core/shell-policy.ts:167-171`

**Issue:** `emitBeforeAgentStart` hands every handler one normalised copy, `currentOptions` (`runner.js:1122,1140`). Routing's `pi.setActiveTools(kept)` rebuilds `_baseSystemPromptOptions` but not that copy. Pi then replaces `selectedTools` with `getActiveToolNames()` only after all handlers have run (`agent-session.js:1590-1597`).

Background-tasks loads before routing, and its gate reads `event.systemPromptOptions.selectedTools`. When `bg_run` is active but undeclared at prompt time, the gate still sees `bg_run` and writes the `pi_background_shell_policy` section into `options.sections`. Routing then drops `bg_run`. The request carries about 128 tokens of guidance for a tool the model cannot call, and the sections delta is persisted into the transcript. The next prompt no longer sees `bg_run`, so the section is diffed out again. That is mid-session system-prompt churn, which this phase exists to prevent.

Probe, using the same sequence as the fixer's own `session_start on reload` test (default profile, prompt, activate `bg_run`, prompt):
```
req0 bgDeclared=false shellPolicy=false
req1 bgDeclared=false shellPolicy=true
```
The outcome depends on handler order, which the real loader does not guarantee (`readdirSync`, unsorted).

**Fix:** Narrow before the emit instead of inside it. Use the `input` event: it runs in `prompt()` before `emitBeforeAgentStart` (`agent-session.js:1538` vs `1590`). Guard it with `ctx.isIdle()` so a follow-up typed while streaming cannot drop a loader-activated tool before its first request declares it. Alternatively, keep the hook but also remove the dropped names from `event.systemPromptOptions.selectedTools` in place, and make the shell-policy gate re-read `pi.getActiveTools()`. That variant is still order-dependent. Pin the fix with a test that asserts `req1` contains no `pi_background_shell_policy` section when `bg_run` is dropped.

### WR-02: The new CR-01 control and reload tests pass without the code they claim to prove

**File:** `tests/integration/tool-profiles.test.ts:132-160`

**Issue:**
- **The new-session control is vacuous.** "a new empty session is still narrowed" emits `session_start` with reason `new` on a harness whose bind-time `startup` already removed `bg_run`, then asserts that `bg_run` is absent. It passes even if the handler returns early for `new`. This is the only test that a new or forked empty session is narrowed.
- **The reload test does not isolate the reload clause.** "session_start on reload leaves a mid-session addition in place" runs after `prompt("one")`, so the branch already has message entries and the `branch.some(... "message")` clause returns early. Deleting `event.reason === "reload"` does not fail the test.
- **The reload test's title is false.** The `before_agent_start` hook drops the undeclared `bg_run` at `prompt("two")`, so the addition is *not* left in place. The test only checks that no removal was recorded.

**Fix:**
- **New-session test:** activate `bg_run` (`setActiveToolsByName([...active, "bg_run"])`) before emitting `new`, then assert it is gone.
- **Reload test:** test reload in a session with no messages, where only the reason clause can decide. If no observable difference can be shown, delete the `event.reason === "reload"` clause as redundant.
- **Reload test title:** rename it to what it asserts ("records no removal").

### WR-03: The `prose-tool-calls` root cause ignores the exclusion ceiling, contrary to the pre-registered rule

**File:** `scripts/ctx-experiment-core.ts:218-223`, `docs/DIAGNOSTICS.md:598-602`

**Issue:** DIAGNOSTICS.md says that any comparison involving an arm over `MAX_EXCLUDED_SHARE` is INCONCLUSIVE, "and so is the discrimination that depends on it". `discriminate` checks `proseBlamed` for every arm *before* any exclusion check. So a run where arm F lost 40% of its trials to infrastructure failures can still report a confident `prose-tool-calls`, computed from the surviving and therefore self-selected trials.

**Fix:** Return `"inconclusive"` before the prose check when any arm present in the summary fails `exclusionsAcceptable`. Alternatively, skip arms that fail it inside the prose loop. Pin the behaviour in `ctx-experiment.test.ts`.

## Info

### IN-01: The routing comment sits above the wrong statement; the flag repeats the profile constants (carried over)

**File:** `.pi/extensions/routing/index.ts:307-308`

**Issue:** "Best-effort like safety/index.ts's session_start prune" still sits above `registerFlag`. `default: "implement"` and the description repeat `DEFAULT_PROFILE`/`PROFILE_NAMES` as literals, even though `DEFAULT_PROFILE` is now imported.

**Fix:** Move the comment to the `pi.on("session_start"...)` line. Use `default: DEFAULT_PROFILE` and build the description from `PROFILE_NAMES`.

### IN-02: The floor label overflows its column; the test checks only `~` (carried over)

**File:** `.pi/extensions/diagnostics/budget.ts:46,285,325`, `tests/unit/budget-command.test.ts`

**Issue:** `FLOOR_LABEL` is 46 characters against `LABEL_WIDTH = 30`.

**Fix:** Shorten the label or widen the column. Assert the rendered number.

### IN-03: `findUnclassified` uses `in`, `applyProfile` uses `Object.hasOwn` (carried over)

**File:** `.pi/extensions/routing/profiles.ts:55`

**Issue:** A tool named `constructor` or `toString` passes the completeness check but is treated as unclassified by `applyProfile`.

**Fix:** Use `Object.hasOwn(table, name)`.

### IN-04: AGENTS.md comment-rule violations remain in test files (partly carried over)

**File:** `tests/unit/shell-policy-gate.test.ts:3`, `tests/integration/context-floor.test.ts:40`

**Issue:** "(PROVENANCE deviation 9)" is an ID reference. "Mutation check: lowering composedBefore…" names a symbol that does not exist; the block compares against `FLOOR_CEILINGS.full`. The mjs comment was fixed.

**Fix:** Delete the ID and rewrite the mutation comment.

### IN-05: `context-floor.test.ts` blocks share mutable state (carried over)

**File:** `tests/integration/context-floor.test.ts:36-38,110-136`

**Issue:** The attribution block reads `composed`/`bareAgents`, which only earlier blocks assign. Running it with `-t attribution` throws a TypeError.

**Fix:** Compute both in a `beforeAll`.

### IN-06: PROVENANCE deviation 9 says no `bg_*` tool is offered outside `full` (carried over)

**File:** `.pi/extensions/background-tasks/PROVENANCE.md:135-139`

**Issue:** `bg_wait` is kept in review and implement. Plan mode's read-only loadout also declares `bg_*` under any profile, as ROUTING.md now documents.

**Fix:** Name the four tools of this package explicitly.

### IN-07: Lint scope and launcher robustness gaps (carried over)

**File:** `tests/unit/context-hook-lint.test.ts`, `tests/unit/prompt-metadata-lint.test.ts`, `scripts/ctx-experiment.sh:68-99`, `scripts/ctx-experiment-core.ts:337-342`, `tests/unit/ctx-experiment-launcher.test.ts:140-146`

**Issue:**
- The lints scan only `.pi/extensions/**/*.ts`.
- The launcher has no `trap` for `trial_root`, and a failed `prepare` aborts the run under `set -e` instead of being recorded in `failures.tsv`.
- `parseJsonModeOutput` takes `usage` from the last message only.
- The launcher test checks for leaks with a denylist rather than an allowlist.

**Fix:** As in the previous report.

### IN-08: The fixes left "once at session start" wording that is now wrong

**File:** `docs/ROUTING.md:140`, `.pi/extensions/routing/profiles.ts:2`, `tests/integration/tool-profiles.test.ts:2`

**Issue:** These still say the profile is applied "once, at `session_start`" or "once at session start". ROUTING.md:156 and the code now also apply it before every prompt, to undeclared tools. AGENTS.md: "a wrong comment is worse than none".

**Fix:** Change them to "at session start, and before each prompt to tools the transcript has not declared".

### IN-09: The `--tools` argv detection is over-broad, and a changed `--ky-profile` on resume is silently ignored

**File:** `.pi/extensions/routing/profiles.ts:59-61`, `.pi/extensions/routing/index.ts:310,318`

**Issue:**
- **Over-broad match.** `hasExplicitToolAllowlist` matches `-t`/`--tools` anywhere in `process.argv`, including as the value of another option (`pi --name -t`), and without a following value. Pi itself honours it only as `--tools <list>` (`args.js:114`). Either case switches narrowing off.
- **Shared across sessions.** Because it reads the host process argv, every in-process session (SDK host, in-process subagents) inherits the decision.
- **Silent resume.** `pi -c --ky-profile recon` on a transcript recorded under another profile skips narrowing without telling the user, although `ctx.ui.notify` is already used for the unknown-value case.

**Fix:**
- Require a following non-flag value: `argv.some((a, i) => (a === "--tools" || a === "-t") && i + 1 < argv.length)`.
- When the flag was set explicitly and narrowing is skipped because the transcript has messages, notify: "--ky-profile ignored: this conversation's tools were fixed when it started".

---

_Reviewed: 2026-10-12T23:26:45Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
