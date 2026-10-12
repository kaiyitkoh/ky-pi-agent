---
phase: 10-context-budget-progressive-disclosure
fixed_at: 2026-10-12T23:16:13Z
review_path: .planning/phases/10-context-budget-progressive-disclosure/10-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 12
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-10-12T23:16:13Z
**Source review:** .planning/phases/10-context-budget-progressive-disclosure/10-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 12 (3 critical, 9 warning; Info excluded by scope)
- Fixed: 12
- Skipped: 0

Each behaviour-changing fix comes with a test that fails without it. The mutation runs were done for CR-01, CR-02, WR-01, WR-02 and WR-04. Each test was run on its own with `--maxWorkers=2`. `npx tsc --noEmit` was run once at the end and exits 0.

**Pre-existing, path-dependent test failures (not caused by these fixes).** The fixes were made in a worktree under `%TEMP%`. Its path is 20 characters longer than `C:\Users\Admin\Documents\ky-pi-agent`, which adds 15 estimated tokens to any floor measured with skills enabled. That breaks two tests:
- `ctx-experiment.test.ts` "PAD_TOKENS equals ..."
- `context-floor.test.ts` "holds each profile under its ceiling" (4248 vs 4233)

Both failed the same way at the untouched base commit 5054eae in the same worktree (2922 vs 2907), and both pass in the main checkout after the fast-forward. The cause is that `normalisePaths` in `tests/helpers/harness-session.ts` misses the three skill `<location>` paths, which Pi renders with backslashes while `repoRoot()` returns forward slashes. As a result, every floor figure that includes skills, `PAD_TOKENS` among them, depends on the checkout path, including on CI. This is a new observation and was not fixed here.

## Fixed Issues

### CR-01: Profile narrowing re-runs on resume, `/reload` and fork

**Files modified:** `.pi/extensions/routing/index.ts`, `tests/helpers/harness-session.ts`, `tests/integration/tool-profiles.test.ts`, `docs/ROUTING.md`, `docs/EXTENSIONS.md`
**Commit:** 9040c3f
**Applied fix:** `session_start` now skips narrowing when `event.reason === "reload"` or the branch already has a message entry, so the loadout Pi restored from the transcript is left alone. New tests (both failed before the fix):
- A full-profile transcript reopened under the default keeps `bg_run` and records no removal. The harness gained a `sessionManager` option to support this.
- A `session_start` with reason `reload` leaves a mid-session addition in place.
- A control test checks that a new empty session is still narrowed.

Note: this commit pushed `routing/index.ts` past its line budget, and `workflow-budgets.test.ts` failed until 209e266 recorded the raise with a reason.

### CR-02: The provider key is passed on the `env` command line

**Files modified:** `scripts/ctx-experiment.mjs`, `scripts/ctx-experiment.sh`, `tests/unit/ctx-experiment-launcher.test.ts`, `docs/DIAGNOSTICS.md`
**Commit:** 2c6ebf5
**Applied fix:** a new `ctx-experiment.mjs run` subcommand builds the scrubbed environment as an object and spawns pi through `sh -c 'exec "$0" "$@"'`. Going through `sh` keeps shebang fakes and npm's sh shim working on Windows. The key travels only in the child's environment. The launcher passes just the variable name, which is exported; `env -i` is gone. The launcher test now puts shims for `node` and `env` on PATH that log their argv, and asserts that the key appears in neither those logs nor the fake pi's argv. Against the old launcher, the test failed because the key was on `env`'s argv.

### CR-03: Crashed, rate-limited or errored trials are scored as missed defects

**Files modified:** `scripts/ctx-experiment-core.ts`, `scripts/ctx-experiment.mjs`, `tests/unit/ctx-experiment.test.ts`, `tests/unit/ctx-experiment-launcher.test.ts`, `docs/DIAGNOSTICS.md`
**Commit:** 107634b
**Applied fix:**
- `isInfrastructureFailure` marks a trial as excluded when any of these hold: a non-zero exit from `failures.tsv`, no assistant message, or a `stopReason` of `error`/`aborted`.
- `summarise` counts excluded trials per arm (`excluded`), never as catches or misses.
- The new `decideArms` returns INCONCLUSIVE when either arm has more than the pre-registered `MAX_EXCLUDED_SHARE = 0.05` of its planned trials excluded. `discriminate` and the CLI comparisons use it.
- `summary.json` and stdout report the excluded counts.
- The ceiling is pinned in the constants test. An end-to-end summarise test with one failed trial and one empty trial checks the exclusion path.

### WR-01: Plan mode at start restores the un-narrowed set when it ends

**Files modified:** `.pi/extensions/routing/index.ts`, `tests/integration/tool-profiles.test.ts`, `tests/unit/workflow-budgets.test.ts`, `docs/ROUTING.md`, `docs/EXTENSIONS.md`
**Commit:** 209e266
**Applied fix:** routing re-applies the profile in `before_agent_start`, but drops only the tools the transcript has not declared, so a request never records a removal. Under `implement`, running `--plan` and then `/plan-mode` now drops the re-enabled `qoder_delegate`. The same happens to any tool activated after the start-up narrowing but before a request. Both new tests failed without the hook.

Status: **fixed, needs human verification.** Two things differ from the review:
1. Plan mode's own read-only loadout declares `bg_run`/`bg_status`/`bg_logs`/`bg_kill` and `questionnaire`, so those tools stay after plan mode ends. Removing them would re-price the prefix. ROUTING.md says this.
2. The claim that "later-registered tools are activated on registration" did not reproduce. A tool registered from a later `session_start` handler was not active (measured). The new hook covers that case anyway.

The routing per-file budget was raised 320 -> 340 and the directory budget 1110 -> 1120, each with a recorded reason.

### WR-02: The default profile overrides an explicit `--tools` allowlist

**Files modified:** `.pi/extensions/routing/index.ts`, `.pi/extensions/routing/profiles.ts`, `tests/helpers/harness-session.ts`, `tests/integration/tool-profiles.test.ts`, `tests/unit/workflow-budgets.test.ts`, `docs/ROUTING.md`
**Commit:** 941f257
**Applied fix:** Pi does not expose the allowlist to extensions (checked in `agent-session.js`, `_allowedTools`). Routing therefore checks `process.argv` for `--tools`/`-t` (`hasExplicitToolAllowlist`) and treats the session as `full`, meaning no narrowing. The harness gained a `tools` option. One test proves that with `--tools` on argv, every named tool, including `bg_run`, is declared. A negative control proves the default drops `bg_run` without it.

Status: **fixed, needs human verification.** ROUTING.md documents two limits:
- An SDK caller that passes `tools` programmatically is still narrowed.
- pi-subagents children are covered only if the package passes the frontmatter tool list as `--tools`, which was not verified offline.

The directory budget was raised 1120 -> 1130 with a reason.

### WR-03: `PAD_TOKENS` includes AGENTS.md, which arm F never loads

**Files modified:** `scripts/ctx-experiment-core.ts`, `tests/unit/ctx-experiment.test.ts`, `docs/DIAGNOSTICS.md`
**Commit:** 6e40ad1
**Applied fix:** the pad is now measured the way arm F actually runs: `measureFloor({ profile: "full", agentsMd: false })` minus the bare floor. `PAD_TOKENS` changes from 2907 to 2653, and the comment and the DIAGNOSTICS.md arm-C row are updated.

2653 was derived from the worktree measurement (3994 - 1326 = 2668) minus the 15-token path offset described above. After the fast-forward I ran `ctx-experiment.test.ts` and `context-floor.test.ts` in the main checkout: all 60 tests pass, including `PAD_TOKENS` = 2653.

### WR-04: Unquoted `$pad_arg` silently breaks arm C when the path contains a space

**Files modified:** `scripts/ctx-experiment.sh`, `scripts/ctx-experiment.mjs`, `tests/unit/ctx-experiment-launcher.test.ts`
**Commit:** 48ceefc
**Applied fix:** the launcher now quotes the pad path (the suggested `if`/`else`). `args` refuses a pad file that does not exist. The launcher test's output directory now contains a space, and the test asserts that the `--append-system-prompt` argument is the whole existing `pad.txt` path. Against the old launcher it failed with `C:/Users/Admin/AppData/Local/Temp/ctx`. A direct test covers the missing-pad refusal.

### WR-05: The `KY_EXP_KEY_VAR` denylist lets the real HOME or agent dir override the scrubbed ones

**Files modified:** `scripts/ctx-experiment.sh`, `scripts/ctx-experiment.mjs`, `tests/unit/ctx-experiment-launcher.test.ts`, `docs/DIAGNOSTICS.md`
**Commit:** 666e1fc
**Applied fix:** both the launcher and `run` refuse these names case-insensitively: `PATH`, `HOME`, `USERPROFILE`, `TMP`, `TEMP`, `TMPDIR`, `SYSTEMROOT`, `PI_*` and `AWS_*`. `run` also puts the key first in the environment object so the scrubbed values always win. Tests cover six spellings through the launcher (refused before any trial) and one direct `run` call.

### WR-06: The "safety envelope" overstates isolation

**Files modified:** `docs/DIAGNOSTICS.md`, `docs/RUNBOOK.md`, `scripts/ctx-experiment.sh`
**Commit:** 3ea88aa
**Applied fix:** the docs change only. The launcher behaviour is unchanged. Both docs and the launcher header now say that the envelope isolates environment variables, not the filesystem. They also say that arm A/C's `bash` can read `~/.aws`, the real `auth.json` and the Credential Manager. Running the experiment now requires an OS account, container or VM with no cloud credentials. The review's alternative was to restrict arms A/C to `--tools read`. That would change the pre-registered arm design, so it was left for a deliberate decision rather than applied by the fixer.

### WR-07: Prose tool calls in harness arms are judged against the minimal four tools

**Files modified:** `scripts/ctx-experiment-core.ts`, `scripts/ctx-experiment.mjs`, `tests/unit/ctx-experiment.test.ts`, `docs/DIAGNOSTICS.md`
**Commit:** 837f149
**Applied fix:**
- New `FULL_ARM_TOOLS` constant, re-measured against `measureFloor({ profile: "full" })` by a test.
- New `armActiveTools(arm)`: A and C get the built-ins; B gets `applyProfile(FULL_ARM_TOOLS, "implement")`, which is 7 tools; F gets all 12.
- The CLI uses it per arm, and the incorrect comment was removed.
- A test shows that a prose `todo(...)` call counts in F and not in A.

### WR-08: The two-stage design has no stopping or pooling rule

**Files modified:** `scripts/ctx-experiment-core.ts`, `scripts/ctx-experiment.mjs`, `tests/unit/ctx-experiment.test.ts`, `docs/DIAGNOSTICS.md`, `docs/RUNBOOK.md`
**Commit:** 211c0a8
**Applied fix:** I chose the review's option (a): a single look at a fixed R. `FIRST_STAGE_REPEATS`/`SECOND_STAGE_REPEATS` are replaced by `REPEATS = 10`, pinned in the constants test. The changes:
- DIAGNOSTICS.md now says there is no second stage and no pooling, and that a larger run is a separate pre-registered experiment with its own seed. `KY_EXP_REPEATS` is for smoke tests only.
- RUNBOOK RB-10-01 step 3 now says to record INCONCLUSIVE as the result instead of rerunning with R=20.

### WR-09: An unknown `--ky-profile` value silently becomes `implement`

**Files modified:** `.pi/extensions/routing/index.ts`, `tests/unit/ky-profile-flag.test.ts` (new), `docs/ROUTING.md`
**Commit:** 19b8e9c
**Applied fix:** when there is a UI, `session_start` calls `ctx.ui.notify('unknown --ky-profile "<v>"; using implement', "warning")`. The fallback to `implement` is kept. The new unit test uses a stub `pi` and covers four cases: an unknown value, case sensitivity (`Full`), known or absent values (quiet), and no UI (quiet).

---

_Fixed: 2026-10-12T23:16:13Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
