---
phase: 10-context-budget-progressive-disclosure
reviewed: 2026-10-12T23:44:18Z
depth: deep
iteration: 3
files_reviewed: 31
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
  - tests/unit/normalise-paths.test.ts
  - tests/unit/prompt-metadata-lint.test.ts
  - tests/unit/shell-policy-gate.test.ts
  - tests/unit/tool-count-baseline.test.ts
  - tests/unit/tool-profiles-table.test.ts
  - tests/unit/workflow-budgets.test.ts
  - AGENTS.md
findings:
  critical: 0
  warning: 2
  info: 11
  total: 13
status: issues_found
---

# Phase 10: Code Review Report (re-review after fix iteration 2)

**Reviewed:** 2026-10-12T23:44:18Z
**Depth:** deep
**Files Reviewed:** 31
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

This re-review covers the four fix commits `18eb2e2`, `f2dc06c`, `7483904` and `64a5942` (and `5054eae..HEAD` overall), the previous 30-file scope, and the new `tests/unit/normalise-paths.test.ts`.

**Pi 1.1.0 source checked:**
- `agent-session.js`: `prompt()` (1517-1632), `_runInputHandlers` (1476), `_queueUserInput` (1690), `sendUserMessage` (1848), `sendCustomMessage` (1782-1810), `isIdle` (1053)
- `extensions/runner.js`: `emitInput` (1202)
- `system-prompt.js`, `tools/bash.js`, `resource-loader.js`, for anything platform-dependent in the measured text

**Cross-file reads:** `.pi/extensions/plan-mode/index.ts` (the agent_end execute path) and `background-tasks/src/core/common.ts` (`resolveShellPolicy`).

**Tests and probes:**
- Ran these files one at a time: `normalise-paths` (3), `context-floor` (4), `ctx-experiment` (57), `tool-profiles` (20) and `workflow-budgets` (130). All pass.
- Ran three throwaway probes from the scratchpad, using a separate vitest config. Nothing in the repo was modified.

**Focus-point answers:**

1. **`input`-event narrowing works for every turn that goes through `prompt()`.**
   - **Ordering.** `_runInputHandlers` (1538) runs before `emitBeforeAgentStart` (1591), so the shell-policy gate sees the narrowed loadout.
   - **Idle guard.** `isIdle` is `!_isAgentRunActive && !isCompacting`. Steer and follow-up input (`prompt` with `streamingBehavior`, `_queueUserInput`) arrives while a run is active, so it is skipped. A probe that activates `bg_run` mid-run and queues a follow-up confirms the follow-up request declares `bg_run`.
   - **No `toolsRemoved`.** The narrowing filters only names that are absent from `getCurrentTools(projection)`.
   - **Other extensions' `input` handlers.** None are registered in the repo or the four installed packages. If a later handler returned `"handled"`, the narrowing would already have happened, with no request sent. That is harmless, because it only ever drops undeclared names, which the next prompt would drop anyway. A `"transform"` does not affect it.
   - **The gap.** Turns started by `sendCustomMessage({ triggerTurn: true })` call `_runAgentPrompt` directly and skip both `input` and `before_agent_start`. Plan mode's "Execute the plan" is such a turn, and the probe shows it declares out-of-profile tools for good (WR-01).
   - **Untested guard.** The idle guard has no test, although one is easy to stage (WR-02).
2. **Path and shell normalisation leaves no machine-specific text, as far as can be checked without macOS.**
   - **Measured prompt.** A probe dumped the normalised full-profile prompt and every tool's description and parameters. They contain none of these: the repo root, tmpdir, homedir, the user name, the temp cwd or agentDir. The only "Windows" is AGENTS.md's static text.
   - **Shell policy.** `resolveShellPolicy` with `PI_BG_POSIX_SHELL=bash` on darwin and linux yields `{policy:"bash", dialect:"bash", args:["-c","<command>"]}`. That is the same text as win32's default, apart from the executable, which is replaced.
   - **Pi's own text.** The system prompt has no date and no platform text. `cwd` is already `/`-normalised, and the bash tool description has no platform text.
   - **Line endings.** `.gitattributes` pins `*.md` to LF, so AGENTS.md and the SKILL.md files count the same on every OS.
   - **Remaining caveats.** The no-machine-path test inspects only the system prompt (IN-11), and a DIAGNOSTICS.md sentence lost its backslash (IN-10).
3. **WR-03 is consistent across code, tests and docs.**
   - **Code.** `discriminate` now returns `inconclusive` first when any arm fails `exclusionsAcceptable`.
   - **No empty arms.** `summarise` creates an arm only from trial rows, so `planned >= 1` and the `planned > 0` clause never fires on an arm with nothing planned.
   - **Tests.** 3/63 = 4.76% passes the 5% ceiling and 4/64 = 6.25% fails it. The third case, with an over-ceiling B and a prose F, fails without the new check.
   - **Docs.** DIAGNOSTICS.md:607-608 and the "(any arm)" table row agree with the code. `ctx-experiment.mjs` uses `core.discriminate` directly.
4. **The new tests are not vacuous, with one exception.**
   - **Non-vacuous.** The new-session test now activates `bg_run` first. The empty-session reload test is decided only by the `reason === "reload"` clause. The byte-stable test fails if the `input` handler is removed.
   - **Exception.** The idle guard has no covering test (WR-02).
5. **AGENTS.md comment rules: the new comments carry no IDs or history.** The carried violations remain (IN-04), and the stale "once" wording now also directly contradicts a paragraph written in this iteration (IN-08).

## Warnings

### WR-01: Plan mode's "Execute the plan" starts its turn without `input`, so under `--plan` the full pre-plan loadout, `bg_run` and `qoder_delegate` included, is declared permanently

**File:** `.pi/extensions/routing/index.ts:325-338`, `.pi/extensions/plan-mode/index.ts:249-258,463-485`, `docs/ROUTING.md:156`, `tests/integration/tool-profiles.test.ts:232-244`

**Issue:** The narrowing now lives only on `input`, which Pi emits only from `prompt()` and `_queueUserInput`. `sendCustomMessage` with `triggerTurn: true` calls `this._runAgentPrompt(appMessage)` directly when idle (`agent-session.js:1803-1808`), or `agent.followUp` while streaming (1795-1800). Neither path emits `input` or `before_agent_start`.

Plan mode's main TUI exit, the agent_end "Execute the plan" choice, runs two calls: `restoreNormalModeTools()` (line 469), then `pi.sendMessage({ customType: "plan-mode-execute", ... }, { triggerTurn: true, deliverAs: "followUp" })` (lines 482-485).

Under `--plan`, plan mode's `session_start` snapshots `toolsBeforePlanMode` *before* routing narrows. Routing then leaves the read-only loadout alone. So the restore brings back the un-narrowed set, which the existing test proves: it asserts `qoder_delegate` is active after leaving plan mode. The next request declares that set, and from then on the transcript-declared exemption keeps it for the rest of the session. That is exactly the per-turn cost the profile exists to cut: `full` is 4,179 tokens against 2,344 for `implement`.

Probe (`implement`, `--plan`, prompt, `/plan-mode`, then `sendCustomMessage(..., { triggerTurn: true })`):
```
active after exit has qoder: true bg_run: true
req1 declares qoder_delegate: true bg_run: true
```

The before_agent_start hook from the previous iteration had the same blind spot, so this is not a regression. However:
- ROUTING.md:156 now states "Before every prompt the profile is applied once more", and uses leaving plan mode as its worked example.
- The only covering test leaves plan mode via the `/plan-mode` toggle followed by a typed `prompt("two")`. That route goes through `input`, so the test cannot see the gap.
- The same bypass applies to `loop-police` (`triggerTurn: true`, lines 543, 576, 625) and to background-tasks' completion follow-ups (`registry.ts:3078`).

**Fix:** Narrow at the source of the un-narrowed set, not only at `input`:
- Export a pure helper from `routing/profiles.ts`:
  ```ts
  export function dropUndeclared(active: readonly string[], profile: ProfileName, declared: ReadonlySet<string>): string[] | undefined {
  	const next = applyProfile(active, profile);
  	if (next === undefined) return undefined;
  	const kept = active.filter((n) => next.includes(n) || declared.has(n));
  	return kept.length === active.length ? undefined : kept;
  }
  ```
- Use it in routing's `input` handler.
- Have plan mode's `restoreNormalModeTools` pass its restored set through the same helper. Alternatively, have routing listen for plan mode's state entry and re-narrow when it restores, before the triggerTurn message is sent.
- Add a test: `--plan`, `prompt("one")`, `/plan-mode`, then `h.session.sendCustomMessage({ customType: "x", content: "go", display: true }, { triggerTurn: true })`. Assert that `sink[1]` declares neither `qoder_delegate` nor `bg_run` and records no removal.
- Until this is fixed, change ROUTING.md:156 to "before every prompt you or a command sends; turns an extension starts with `triggerTurn` (plan mode's Execute, loop-police) are not narrowed".

### WR-02: The idle guard is load-bearing and untested; removing `ctx.isIdle() ?` passes the whole suite

**File:** `.pi/extensions/routing/index.ts:330`, `tests/integration/tool-profiles.test.ts`

**Issue:** The fix report says the guard has no test "because a follow-up queued during a faux run is hard to stage". It is easy to stage: a faux response step can activate a tool (as a loader would) and queue `prompt(..., { streamingBehavior: "followUp" })` while the run is active. Without the guard, that follow-up's `input` drops the loader-activated tool before its first declaration. That is the exact failure the guard exists to stop, and nothing pins it. A probe built this way passes today (`requests: 2`, `req1 declares bg_run: true`), so the test is ready to adopt.

**Fix:** Add this test to the "a transcript's loadout is never narrowed again" block:
```ts
it("a follow-up queued mid-run keeps a tool activated during that run", async () => {
	const sink: TranscriptContext[] = [];
	let h!: HarnessHandle;
	let queued: Promise<void> | undefined;
	const responses: FauxResponseStep[] = [
		(c) => {
			sink.push(c);
			h.session.setActiveToolsByName([...h.session.getActiveToolNames(), "bg_run"]);
			queued = h.session.prompt("follow", { streamingBehavior: "followUp" });
			return fauxAssistantMessage("ok");
		},
		(c) => { sink.push(c); return fauxAssistantMessage("ok"); },
	];
	await withHarnessSession({ responses }, async (handle) => {
		h = handle;
		await h.session.prompt("one");
		await queued;
		expect(sink.length, "non-vacuity: the follow-up reached the provider").toBe(2);
		expect(getCurrentTools(sink[1]!.messages).map((t) => t.name)).toContain("bg_run");
	});
});
```
Confirm it fails with the guard removed.

## Info

### IN-01: The routing comment sits above the wrong statement; the flag repeats the profile constants (carried over)

**File:** `.pi/extensions/routing/index.ts:307-308`

**Issue:** The comment "Best-effort like safety/index.ts's session_start prune" still sits above `registerFlag`. The flag also hard-codes `default: "implement"` and the profile list in its description.

**Fix:** Move the comment to the `pi.on("session_start", ...)` line. Use `default: DEFAULT_PROFILE`, and build the description from `PROFILE_NAMES`.

### IN-02: The floor label overflows its column; the test checks only `~` (carried over)

**File:** `.pi/extensions/diagnostics/budget.ts:46,285,325`, `tests/unit/budget-command.test.ts`

**Issue:** `FLOOR_LABEL` is 46 characters, but `LABEL_WIDTH` is 30.

**Fix:** Shorten the label or widen the column, and assert the rendered number.

### IN-03: `findUnclassified` uses `in`, `applyProfile` uses `Object.hasOwn` (carried over)

**File:** `.pi/extensions/routing/profiles.ts:55`

**Issue:** A tool named `constructor` passes the completeness check, but `applyProfile` treats it as unclassified.

**Fix:** Use `Object.hasOwn(table, name)`.

### IN-04: AGENTS.md comment-rule violations remain in test files (carried over)

**File:** `tests/unit/shell-policy-gate.test.ts:3`, `tests/integration/context-floor.test.ts:40`

**Issue:** "(PROVENANCE deviation 9)" is an ID reference. The comment "Mutation check: lowering composedBefore…" names a symbol that does not exist.

**Fix:** Delete the ID and rewrite the comment against `FLOOR_CEILINGS.full`.

### IN-05: `context-floor.test.ts` blocks share mutable state (carried over)

**File:** `tests/integration/context-floor.test.ts:36-38,110-136`

**Issue:** The attribution block reads `composed` and `bareAgents`, which only earlier blocks assign. Running it alone with `-t attribution` throws.

**Fix:** Compute both values in a `beforeAll`.

### IN-06: PROVENANCE deviation 9 says no `bg_*` tool is offered outside `full` (carried over)

**File:** `.pi/extensions/background-tasks/PROVENANCE.md:135-139`

**Issue:** This is not true:
- `bg_wait` is kept in `review` and `implement`.
- Plan mode's read-only loadout declares `bg_*` under any profile.

**Fix:** Name the four tools explicitly.

### IN-07: Lint scope and launcher robustness gaps (carried over)

**File:** `tests/unit/context-hook-lint.test.ts`, `tests/unit/prompt-metadata-lint.test.ts`, `scripts/ctx-experiment.sh:68-99`, `scripts/ctx-experiment-core.ts:337-342`, `tests/unit/ctx-experiment-launcher.test.ts:140-146`

**Issue:** These carried-over gaps remain:
- The lint scope covers only `.pi/extensions`.
- The launcher has no `trap` for `trial_root`.
- A failed `prepare` aborts under `set -e` instead of being recorded in `failures.tsv`. Such trials are then neither scored nor excluded, so the exclusion ceiling undercounts them.
- `parseJsonModeOutput` reads `usage` from the last message only.
- The leak check in the launcher test is a denylist.

**Fix:** Apply the fixes from the earlier report.

### IN-08: Stale "once at session start" wording now contradicts this iteration's own paragraph (carried over, slightly worse)

**File:** `docs/ROUTING.md:140`, `.pi/extensions/routing/profiles.ts:2`, `tests/integration/tool-profiles.test.ts:2`

**Issue:** These places still say the profile is applied "once, at `session_start`" or "once, before the first provider request". The same ROUTING.md section (line 156), rewritten in `f2dc06c`, says it is also applied on `input` before every idle prompt.

**Fix:** Use "at session start, and on each idle prompt to tools the transcript has not declared".

### IN-09: The `--tools` argv detection is over-broad, and a changed `--ky-profile` on resume is silently ignored (carried over)

**File:** `.pi/extensions/routing/profiles.ts:59-61`, `.pi/extensions/routing/index.ts:310,318`

**Issue:** Unchanged since the previous report.

**Fix:** Require a following value. Notify the user when an explicit flag is skipped because the transcript already has messages.

### IN-10: DIAGNOSTICS.md lost the backslash in "(raw, `/` and `` forms)"

**File:** `docs/DIAGNOSTICS.md:408`

**Issue:** The line reads `` (raw, `/` and `` forms) ``. The code span that should hold `\` is empty, so the rendered sentence names only two of the three forms.

**Fix:** Write `` `\` `` (or "back-slash").

### IN-11: The machine-path test inspects only the system prompt and only the repo root

**File:** `tests/unit/normalise-paths.test.ts:26-34`

**Issue:** `measureFloor` counts tool descriptions and parameters as well (`budget.toolSchemas`), but neither field is normalised or checked. The test also never looks for tmpdir or homedir.

Nothing machine-specific is there today: a probe found no repo root, tmpdir, homedir, user name or temp dir in any tool text. However, a future tool description that embeds a path would silently make `PAD_TOKENS` and the ceilings OS-dependent again.

**Fix:** In the same test:
- Assert that `JSON.stringify(view.tools)` contains none of `repoRoot()`, `tmpdir()` or `homedir()` in either slash form.
- Assert the same for the normalised system prompt, using `tmpdir()` and `homedir()`.

---

_Reviewed: 2026-10-12T23:44:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
