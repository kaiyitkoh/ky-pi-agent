---
phase: 10-context-budget-progressive-disclosure
reviewed: 2026-10-12T22:54:48Z
depth: deep
files_reviewed: 29
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
  - tests/unit/prompt-metadata-lint.test.ts
  - tests/unit/shell-policy-gate.test.ts
  - tests/unit/tool-count-baseline.test.ts
  - tests/unit/tool-profiles-table.test.ts
  - tests/unit/workflow-budgets.test.ts
  - AGENTS.md
findings:
  critical: 3
  warning: 9
  info: 7
  total: 19
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-10-12T22:54:48Z
**Depth:** deep
**Files Reviewed:** 29
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

I reviewed the diff `0bf64e4..HEAD` (28 changed files plus AGENTS.md) and checked Pi 1.1.0 behaviour in the installed source: `dist/core/agent-session.js` (`_restoreToolsFromTranscript`, `reload`, `_refreshToolRegistry`, `before_agent_start` handling), `dist/core/extensions/loader.js` (flags, discovery order), `dist/utils/shell.js`, `dist/cli/args.js` and `dist/modes/json-event.js`. I also cross-checked plan-mode and qoder. I ran `ctx-experiment.mjs prepare/pad` in the scratchpad to measure prompt sizes. I did not run the test suite.

The pure parts hold up. The Wilson and Newcombe arithmetic is correct and reproduces the Newcombe 1998 reference values. The `/budget` floor arithmetic and every number in DIAGNOSTICS.md reconcile (for example 16929/4 gives 4233, 9553/4 gives 2389, and the per-extension deltas sum to 9818 = 16929 - 7111). The shell-policy gate is correct and fails open.

The problems are in how these parts connect:

- The profile is re-applied on every `session_start`. That includes resume, `/reload` and fork, so the documented "profile code never runs again" rule is false.
- The experiment launcher puts the provider key on the `env` command line.
- The experiment summariser scores crashed or rate-limited trials as missed defects. That can produce a false `DEGRADES`.
- Several smaller confounds weaken the experiment design: the pad size, the prose tool list, and the unquoted pad path.

## Critical Issues

### CR-01: Profile narrowing re-runs on resume, `/reload` and fork, removing tools from a live conversation

**File:** `.pi/extensions/routing/index.ts:308-316`

**Issue:** The `session_start` handler calls `applyProfile(pi.getActiveTools(), …)` every time it fires, and Pi fires `session_start` for `startup`, `resume`, `new`, `fork` and `reload` (`agent-session.js:2966`, `agent-session-runtime.js:141,165,211,229,246,291`). Pi restores the transcript's tool loadout in the constructor (`agent-session.js:214-215`, `_restoreToolsFromTranscript`) *before* `bindExtensions` emits `session_start` (`:2618`). The narrowing then runs on that restored set. `reload()` (`:2936-2967`) rebuilds with the current active set and emits `session_start` again. So:

- `pi --ky-profile full`, then later `pi -c` without the flag: the default `implement` strips `bg_run`, `bg_status`, `bg_logs`, `bg_kill`, `questionnaire` and `qoder_delegate` from a conversation that has been using them.
- Any session where the model called `web_enable` (allowed in `implement`): `web_search`, `fetch_content` and the other web tools are removed on the next `/reload` or resume.
- Each of these produces a `toolsRemoved` system message. `tool-profiles.test.ts` T2 shows this re-prices the cache prefix on DeepSeek and Bedrock and stops later additions anchoring.

This contradicts EXTENSIONS.md R1 ("profile code never runs again") and ROUTING.md ("A profile is chosen once per session"). No test covers resume or reload; every T1 case starts from an empty session.

**Fix:** Narrow only a session that has no transcript loadout yet:
```ts
pi.on("session_start", (event, ctx) => {
	try {
		const branch = ctx.sessionManager.getBranch();
		restoreModeFromBranch(branch);
		// A restored transcript already declared its tools; changing them now re-prices the cached prefix.
		if (event.reason === "reload" || branch.some((e) => e.type === "message")) return;
		const next = applyProfile(pi.getActiveTools(), resolveProfile(pi.getFlag("ky-profile")));
		if (next !== undefined) pi.setActiveTools(next);
	} catch { /* … */ }
});
```
Add a test that seeds a message entry via `beforeBind` with `profile: "full"`, then reopens with the default profile and asserts that `bg_run` is still declared and no `toolsRemoved` appears.

### CR-02: The provider key is passed on the `env` command line for the whole trial

**File:** `scripts/ctx-experiment.sh:91-95`

**Issue:** `"$KY_EXP_KEY_VAR=$key_value"` is an **argv** element of `env`, so the secret is part of the `env` process's command line. On Git Bash, `env.exe` is an MSYS program launching a native `node`/`pi`. The MSYS exec emulation keeps the parent stub alive, so the key stays readable for the full trial (`Get-CimInstance Win32_Process | select CommandLine`, Task Manager's command-line column). It is also recorded by any process-creation auditing (Security 4688 with command-line logging, Sysmon EID 1, Defender/EDR telemetry) on the work laptop this is meant to run on. On macOS it is briefly visible to `ps` for all users. The launcher's own header says it exists to control exactly what crosses into the trial, and this is the one value that must not leak. `ctx-experiment-launcher.test.ts` cannot catch this because the fake `pi` records its own argv, not `env`'s.

**Fix:** Do the scrubbed spawn in Node, which takes the environment as an object and never puts it on a command line. For example, add a `run` subcommand to `ctx-experiment.mjs`:
```js
const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMP: tmp, TEMP: tmp, TMPDIR: tmp,
  PI_CODING_AGENT_DIR: agent, [keyVar]: process.env[keyVar] };
if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
spawnSync(piBin, [...args, prompt], { cwd: repo, env, stdio: ["ignore", outFd, errFd], shell: false });
```
If it must stay in sh, export the variable in the subshell (`export "$KY_EXP_KEY_VAR"`) and build the clean environment by unsetting everything outside the allowlist, instead of passing `NAME=value` to `env -i`.

### CR-03: Crashed, rate-limited or errored trials are scored as missed defects

**File:** `scripts/ctx-experiment.mjs:108-118`, `scripts/ctx-experiment.sh:98-100`

**Issue:** The launcher records non-zero exits in `failures.tsv`, but `summarise` never reads that file. A missing or empty `.jsonl` becomes `finalText: ""`, then `scoreTrial` returns `{ caught: false, malformed: true }`, and the trial is counted as a miss in that arm's denominator. The same happens for an in-band provider error (`stopReason: "error"`/`"aborted"` with no text). Infrastructure failures are not arm-neutral. Arm F sends the largest prompt and tool list, so 429s, context or schema rejections, or a harness extension failing at startup land disproportionately on F and lower its catch rate. That alone can produce a pre-registered `DEGRADES`, which then reads as `harness-behaviour` or `context-pollution`. The summary does not even report the failure count.

**Fix:** In `summarise`, read `failures.tsv` and treat any trial with a non-zero exit, no assistant message, or `stopReason` of `error`/`aborted` as **excluded**, not missed. Report `excluded` per arm in `summary.json` and the stdout summary. Make `decide`/`discriminate` refuse (`INCONCLUSIVE`) when exclusions are unbalanced across arms or above a pre-registered ceiling (e.g. 5%), and pin that rule in `ctx-experiment.test.ts`.

## Warnings

### WR-01: Plan mode active at start captures the un-narrowed set, so leaving plan mode undoes the profile; later-registered tools escape narrowing

**File:** `.pi/extensions/routing/profiles.ts:69-71`, `.pi/extensions/plan-mode/index.ts:249-258,496-541`

**Issue:** With `--plan` or a restored `plan-mode` entry, plan-mode's `session_start` calls `enablePlanModeTools()`. That snapshots `toolsBeforePlanMode = pi.getActiveTools()`, which is the full default set, and switches to the read-only set. Routing then sees no `edit`/`write` and returns `undefined`. On `/plan` off, `restoreNormalModeTools()` restores the snapshot, so `bg_*`, `questionnaire`, `qoder_delegate` and the web tools all come back. The snapshot is also persisted in the `plan-mode` entry, so the bypass survives resume. The "plan mode survives the default profile" tests only check the read-only loadout, never the exit path.

The behaviour also depends on handler order. Pi's `discoverExtensionsInDir` uses unsorted `readdirSync` (`loader.js:638`), while `harness-session.ts` sorts entry points (`listEntryPoints`), so tests run in an order the real loader does not guarantee (APFS does not return sorted entries). Any tool registered after routing's `session_start` is activated on registration (`_refreshToolRegistry` → `_isActivatedOnRegistration`) and is never narrowed. One example is `subagent_supervisor`, which pi-subagents registers from its own `session_start` per the tool-count baseline. It is `NOT_RECON` but would stay active under `recon`.

**Fix:** Apply the profile to the plan-mode snapshot as well. The simplest way is for routing to narrow first, regardless of edit/write presence, when plan mode is starting: export `applyProfile` and have plan-mode call it on `toolsBeforePlanMode` when it is captured at `session_start`. Alternatively, run routing's narrowing from `before_agent_start` of the first prompt only (still before the first request, after every `session_start` handler has run). Add a test for the `--plan`, then `/plan` off, then the declared-tools path.

### WR-02: The default profile overrides an explicit `--tools` allowlist and subagent tool lists

**File:** `.pi/extensions/routing/profiles.ts:69-77`, `docs/ROUTING.md` ("The native escape hatch `pi --tools read,bash` is untouched")

**Issue:** The only "already chosen" signal is the absence of both `edit` and `write`. `pi --tools read,bash,edit,write,bg_run` (or `…,web_search`) keeps `edit`, so the default `implement` silently removes the tool the user explicitly named. Pi adds every allowlisted tool to the active set (`_refreshToolRegistry`, `allowedTools` branch). The same applies to any pi-subagents child spawned with a frontmatter tool list that includes `edit` plus a non-implement tool, which RB-10-03 step 4 leaves unverified. The doc's "untouched" claim holds only for allowlists without `edit`/`write`. Also, `-nbt` (no built-ins, extensions on) leaves the full extension set un-narrowed.

**Fix:** Skip narrowing when the user restricted tools on the CLI, i.e. when the flag was not explicitly set and an allowlist is present. At minimum, narrow only names that were not explicitly requested. If Pi exposes no allowlist signal to extensions, document the override precisely in ROUTING.md and have a test pin it.

### WR-03: `PAD_TOKENS` includes AGENTS.md, which arm F never loads, so the padded arm is over-padded by about 16%

**File:** `scripts/ctx-experiment-core.ts:453-454`, `tests/unit/ctx-experiment.test.ts:414-419`

**Issue:** `PAD_TOKENS = 2907` is `measureFloor({profile:"full"})` minus bare. `measureFloor` copies the repo AGENTS.md into the cwd by default (`agentsMd !== false`), so 2907 includes about 452 tokens of AGENTS.md (1778 - 1326 in DIAGNOSTICS.md). In the live run, arm F's cwd is a fresh `mktemp` repo and its agent dir is empty, so F carries no AGENTS.md. Its real excess over A is about 2455 tokens (4233 - 1778). Arm C therefore gets about 18% more mass than F, which biases the C-vs-A comparison towards `context-pollution` exactly where it separates `harness-behaviour` from `context-pollution`.

**Fix:** Measure the full arm the way it runs: `measureFloor({ profile: "full", agentsMd: false })` minus `measureFloor({ entryPoints: [], agentsMd: false, skills: false })`. Update the constant and test, and the DIAGNOSTICS.md text.

### WR-04: Unquoted `$pad_arg` silently breaks arm C when the repo path contains a space

**File:** `scripts/ctx-experiment.sh:71-75`

**Issue:** `arm_args=$(node "$cli" args "$arm" $pad_arg)` word-splits the pad path. With a checkout under `C:/Users/First Last/...`, `padFile` becomes `C:/Users/First`. Pi's `--append-system-prompt` accepts "text or file contents" (`args.js:298`), so instead of failing it appends the literal 14-character string. Arm C then runs as arm A, and the experiment reports a meaningless C-vs-A result with no error.

**Fix:**
```sh
if [ "$arm" = "C" ]; then
	arm_args=$(node "$cli" args "$arm" "$(native "$pad_file")")
else
	arm_args=$(node "$cli" args "$arm")
fi
```
Also have `armArgs`/the CLI assert that `padFile` exists before emitting it.

### WR-05: The `KY_EXP_KEY_VAR` denylist lets the operator's real HOME or agent dir override the scrubbed ones

**File:** `scripts/ctx-experiment.sh:26-30,91-94`

**Issue:** Only `AWS_*` names are refused. Because the key assignment comes after the scrubbed assignments on the `env` line and `env` keeps the last one, `KY_EXP_KEY_VAR=HOME`, `USERPROFILE`, `PI_CODING_AGENT_DIR`, `TMP` or `TMPDIR` silently restores the operator's real value. The bash-capable, safety-free minimal arm then runs against the real home, with `~/.aws` and the real `auth.json` (with `!command` SSO helpers) visible. This only needs a mistake, not malice.

**Fix:** Reject every name the launcher sets itself, case-insensitively: `PATH|HOME|USERPROFILE|TMP|TEMP|TMPDIR|PI_CODING_AGENT_DIR|SYSTEMROOT|PI_*`. Place the key assignment before the scrubbed ones so a collision cannot win.

### WR-06: The "safety envelope" overstates isolation: env scrubbing does not isolate the filesystem

**File:** `scripts/ctx-experiment.sh:5-9`, `docs/DIAGNOSTICS.md` ("Safety envelope"), `docs/RUNBOOK.md` RB-10-01

**Issue:** The docs say "Nothing from the operator's environment crosses" and "No `AWS_*` variable can cross". But arm A gives a cheap model `bash` with no safety layer, running as the operator. Absolute paths such as `/c/Users/<user>/.aws/credentials`, `~/.aws/sso/cache/*.json` and the real `~/.pi/agent/auth.json` stay readable, and the Windows Credential Manager is reachable from Git Bash tools. RUNBOOK.md itself says this machine holds "live static IAM admin credentials". The prompt is review-only, which lowers the odds but enforces nothing. The test proves only that environment variables don't cross.

**Fix:** State the residual risk plainly in both docs: environment isolation only, not filesystem isolation. Require running from an OS account (or container/VM) without cloud credentials. Alternatively, run arm A/C with `--tools read` (no bash), since the trial needs no tool at all (`TRIAL_OUTPUT_INSTRUCTION`). That also removes the tool-ownership asymmetry the instruction is guarding against.

### WR-07: Prose tool calls in harness arms are judged against the minimal four tools

**File:** `scripts/ctx-experiment.mjs:24-25,118`

**Issue:** `ACTIVE_TOOLS = ["read","bash","edit","write"]` is used for every arm. Arm F exposes 12 tools and arm B 7 (DIAGNOSTICS.md). A prose call to `todo`, `consult_advisor`, `bg_run` or `questionnaire` in B/F is never counted. `discriminate` checks `prose-tool-calls` first, so this asymmetric undercount can push a prose-driven F miss into `harness-behaviour` or `context-pollution`. The comment's first clause ("judged against the tools each arm actually exposes") is false.

**Fix:** Derive per-arm lists: A/C use the four built-ins; B/F use `applyProfile` over the measured full list (`read,bash,edit,write,approve_ky_command,consult_advisor,todo,questionnaire,bg_run,bg_status,bg_logs,bg_kill`) with the arm's profile, or record each trial's actual tool list from the first request. Fix the comment.

### WR-08: The two-stage design has no stopping or pooling rule

**File:** `scripts/ctx-experiment-core.ts:33-34`, `docs/DIAGNOSTICS.md` ("Design"), `docs/RUNBOOK.md` RB-10-01 step 3

**Issue:** The rule says "a second stage of R=20 only if the first is inconclusive", and the runbook says "rerun with `KY_EXP_REPEATS=20`". Nothing pre-registers whether stage 2 is pooled with stage 1 or replaces it, and the 90% interval is applied unchanged at both looks. Two looks at a fixed z inflate the error rates of both `DEGRADES` and `NO_DETECTABLE_EFFECT`. This is exactly the post-hoc freedom the "pre-registered" constants are meant to remove.

**Fix:** Pre-register one option: (a) a single fixed R, or (b) a two-look design with an alpha split (e.g. Bonferroni z for 95% one-sided per look, `Z = 1.96`) and a stated pooling rule. Pin it in `ctx-experiment.test.ts` alongside the other constants.

### WR-09: An unknown `--ky-profile` value silently becomes `implement`

**File:** `.pi/extensions/routing/profiles.ts:58-62`, `.pi/extensions/routing/index.ts:311`

**Issue:** `--ky-profile ful` or `--ky-profile Full` runs `implement` with no message, while the user thinks they are on `full`. For a cost and tool-set control in a harness that is meant to be debuggable, a silent misconfiguration is the wrong failure mode, and the outer `catch {}` hides any other failure too.

**Fix:** When the flag is a string that is not in `PROFILE_NAMES`, call `ctx.ui.notify(\`unknown --ky-profile "${flag}"; using implement\`, "warning")` (guarded by `ctx.hasUI`). Keep the fallback.

## Info

### IN-01: The routing comment now sits above the wrong statement; the flag duplicates the profile constants

**File:** `.pi/extensions/routing/index.ts:306-307`

**Issue:** The "Best-effort like safety/index.ts's session_start prune" comment now sits above `registerFlag`, not the handler it describes. The flag's `default: "implement"` and its description repeat `DEFAULT_PROFILE`/`PROFILE_NAMES` as literals.

**Fix:** Move the comment to the `pi.on` line. Use `default: DEFAULT_PROFILE` and build the description from `PROFILE_NAMES`.

### IN-02: The floor row label overflows the label column; its test checks only `~`

**File:** `.pi/extensions/diagnostics/budget.ts:46,325`, `tests/unit/budget-command.test.ts:285-291`

**Issue:** `FLOOR_LABEL` is 46 characters against `LABEL_WIDTH = 30`, so the row is misaligned. The handler test asserts only that the line contains `~`, so rendering `report.systemPrompt` instead of `report.floor` would pass.

**Fix:** Shorten the label (e.g. `per-turn floor`) or widen the column. Assert the rendered line contains `String(expectedFloorChars)`.

### IN-03: `findUnclassified` uses `in`, `applyProfile` uses `Object.hasOwn`

**File:** `.pi/extensions/routing/profiles.ts:55,73`

**Issue:** A tool named `constructor`/`toString` would pass the completeness check (`in` sees the prototype) while `applyProfile` treats it as unclassified.

**Fix:** Use `Object.hasOwn(table, name)` in both.

### IN-04: Comment-rule violations in new code (AGENTS.md)

**File:** `tests/unit/shell-policy-gate.test.ts:3`, `tests/integration/context-floor.test.ts:40`, `scripts/ctx-experiment.mjs:24`

**Issue:**
- `"(PROVENANCE deviation 9)"` is a history/ID reference.
- `"Mutation check: lowering composedBefore below the measured value fails this block"` names a symbol that does not exist. The block compares against `FLOOR_CEILINGS.full`, so this is a wrong comment.
- The mjs comment contradicts itself (see WR-07).

**Fix:** Delete the ID, rewrite or delete the stale mutation comment, and fix the mjs comment.

### IN-05: `context-floor.test.ts` describes share mutable state across blocks

**File:** `tests/integration/context-floor.test.ts:36-38,110-136`

**Issue:** "per-extension attribution" reads `composed` and `bareAgents`, which only earlier `describe` blocks assign. Running it alone (`-t attribution`) or with `sequence.shuffle` throws a TypeError instead of a meaningful failure.

**Fix:** Compute both in a `beforeAll`, or measure them inside the attribution test.

### IN-06: PROVENANCE deviation 9 says "no `bg_*` tool is offered in any profile except `full`"

**File:** `.pi/extensions/background-tasks/PROVENANCE.md:135-139`

**Issue:** `bg_wait` (pi-subagents) is a `bg_*` tool kept in review and implement (`profiles.ts:28`).

**Fix:** Say "no tool from this package (`bg_run`/`bg_status`/`bg_logs`/`bg_kill`)".

### IN-07: Lint scope and launcher robustness gaps

**File:** `tests/unit/context-hook-lint.test.ts:116-121`, `tests/unit/prompt-metadata-lint.test.ts:64-67`, `scripts/ctx-experiment.sh:63-102`, `scripts/ctx-experiment-core.ts:312-319`, `tests/unit/ctx-experiment-launcher.test.ts:127-140`

**Issue:**
- Both lints scan only `.pi/extensions/**/*.ts`. They skip `.pi/lib/*.ts`, which extensions import, and `.js`, which Pi also loads. `promptSnippet: SOME_CONST` passes the metadata lint whatever `SOME_CONST` holds.
- The launcher has no `trap` to clean `trial_root`. A `prepare` failure under `set -e` aborts the run without a summary.
- `parseJsonModeOutput` takes `usage` from the last message only, so `inputTokens` undercounts multi-message trials.
- The launcher test checks for leaks by denylist (`AWS_`, `KY_EXP_MODEL`) rather than asserting that the env names are a subset of the allowlist.

**Fix:**
- Widen both lint globs to `.pi/**/*.{ts,js,mjs}`.
- Add `trap 'rm -rf "$trial_root"' EXIT INT TERM` and record a failed `prepare` in `failures.tsv` instead of aborting.
- Sum usage across assistant messages.
- Assert `envNames ⊆ {PATH, HOME, USERPROFILE, TMP, TEMP, TMPDIR, PI_CODING_AGENT_DIR, SYSTEMROOT, KY_EXP_FAKE_KEY, PWD, SHLVL, _}`.

---

_Reviewed: 2026-10-12T22:54:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
