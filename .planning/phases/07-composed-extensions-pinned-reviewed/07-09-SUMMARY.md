---
phase: 07-composed-extensions-pinned-reviewed
plan: 09
subsystem: infra
tags: [supply-chain, pinning, npm, pi-subagents, worktree, bootstrap]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    provides: "docs/EXTENSIONS.md (07-01) live-resolved package versions; .pi/scripts/worktree-setup-hook.mjs (07-02); tests/unit/pinning.test.ts's isPinnedPackageSpec (Phase 1)"
provides:
  - ".pi/settings.json packages[] -- the lockfile itself, five exact npm pins"
  - "bin/bootstrap.sh merge_subagent_config() -- reproducible, cold-machine wiring of the worktree setup hook into pi-subagents' own (non-.pi/settings.json) config file"
  - "tests/unit/extension-pins.test.ts -- the lockfile diffed against a committed expectation in both directions, plus a fifth section proving the hook wiring is real"
  - "Corrected, source-verified record of pi-subagents@0.49.0's actual configuration surface, superseding a stale 07-04 assumption about agentScope"
affects: [07-10, 07-11, 07-13]

tech-stack:
  added: []
  patterns: ["Key-namespaced merge into a package's OWN dedicated config file, mirroring bin/bootstrap.sh's existing merge_settings/merge_models_json discipline, when that package does not read .pi/settings.json at all"]

key-files:
  created: [tests/unit/extension-pins.test.ts]
  modified: [.pi/settings.json, bin/bootstrap.sh]

key-decisions:
  - "pi-subagents@0.49.0 reads NO configuration from .pi/settings.json -- getConfigPath() (src/extension/config.ts:90-92) resolves to a DEDICATED global file, <agentDir>/extensions/subagent/config.json. .pi/settings.json therefore carries ONLY packages[] in this plan; no subagents configuration block was added there."
  - "agentScope is NOT a settings key at any scope in pi-subagents@0.49.0 -- it is a per-invocation parameter on the subagent tool's own schema (src/extension/schemas.ts:333), resolved to \"both\" by resolveExecutionAgentScope() whenever a caller omits it (src/agents/agent-scope.ts:3-6). This corrects 07-04-SUMMARY.md's recorded decision (\"agentScope must be set to project or both by plan 07-09 or .pi/agents/*.md is never loaded\"), which does not hold for the version this repo actually pins: project-scoped .pi/agents/ is already discovered by default."
  - "The worktree-hook wiring was added to bin/bootstrap.sh's run_full() (merge_subagent_config()), not written as a one-off machine-state mutation -- an ad hoc write to this machine's global agent dir would not survive a fresh clone, violating this repo's own bootstrappable-cold-machine goal (CLAUDE.md constraint). This expands files_modified beyond the plan's declared .pi/settings.json + tests/unit/extension-pins.test.ts; see Deviations."
  - "The wired hook path is ABSOLUTE ($REPO_ROOT-based), not repo-relative, because this config file is written at machine (user) scope and therefore applies to every repo the operator runs Pi in -- a repo-relative path would only resolve correctly inside a ky-pi-agent checkout. The hook script itself is already repo-agnostic (reads repoRoot/worktreePath from its stdin payload)."
  - "Direction 3 of the new test (vendored-package absence) discovers vendored packages by scanning tracked PROVENANCE.md text, not by importing vendor-license-audit.test.ts's MUST_BE_VENDORED registry a second time, per the plan's explicit instruction."

requirements-completed: [EXT-01, EXT-08]

duration: ~55min
completed: 2026-08-15
---

# Phase 07 Plan 09: Lockfile and Subagents Configuration Summary

**Wrote `.pi/settings.json`'s five-entry `packages[]` lockfile and discovered, by reading pi-subagents@0.49.0's real source, that its configuration lives in a dedicated global file rather than `.pi/settings.json` -- so the worktree-setup-hook wiring was added to `bin/bootstrap.sh` instead, reproducibly, and `agentScope` was found to need no configuration at all.**

## Performance

- **Duration:** ~55 min
- **Started:** ~2026-08-15T04:15Z (tarball inspection)
- **Completed:** 2026-08-15T05:03:30+08:00
- **Tasks:** 3
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **Task 1 (research, no commit):** Packed and inspected `pi-subagents@0.49.0`'s real tarball (`npm pack` + `tar -xf` under this session's scratchpad, never installed, directory removed after) and answered all four required questions with `file:line` citations from the actual pinned version -- see "Task 1 Findings" below. Two of the four answers **contradict** the plan's own prose assumptions, both corrected with citations rather than silently followed.
- **Task 2:** `.pi/settings.json`'s `{}` replaced with a `packages` array of exactly five exact npm pins (`pi-subagents@0.49.0`, `pi-background-tasks@2.4.2`, `@narumitw/pi-lsp@0.49.4`, `pi-web-access@0.22.0`, `pi-session-finder@0.5.6`), matching `docs/EXTENSIONS.md`'s live-resolved table character for character. `bin/bootstrap.sh` gained `merge_subagent_config()`, wired into `run_full()`, which key-namespace-merges `worktreeSetupHook`/`worktreeSetupHookTimeoutMs` into pi-subagents' own `<agentDir>/extensions/subagent/config.json` using an absolute, `$REPO_ROOT`-derived hook path. Run for real on this machine (idempotent, verified twice), and `sh bin/bootstrap.sh --assert-hardening` re-confirmed clean afterward.
- **Task 3:** `tests/unit/extension-pins.test.ts` created -- imports `isPinnedPackageSpec` from `tests/unit/pinning.test.ts` (zero second spec-shape regex, `grep -c "new RegExp|/\^npm:"` returns `0`), covers all four required directions plus vacuity guards, and adds a fifth section proving the `bin/bootstrap.sh` hook wiring is real (function defined, called from `run_full()`, hook path resolves to a tracked file). All three required falsifications performed and reverted (see below).

## Task 1 Findings (pi-subagents@0.49.0, read from the real tarball)

1. **Configuration source.** `getConfigPath()` (`pi-subagents src/extension/config.ts:90-92`) resolves to `join(getAgentDir(), "extensions", "subagent", "config.json")` -- confirmed in the file's own JSDoc header at `src/extension/index.ts:11-12`. `getAgentDir()` (`src/shared/utils.ts:97-102`) honours `PI_CODING_AGENT_DIR` identically to Pi core. **Not `.pi/settings.json` at all** -- no precedence chain, single dedicated file, defaults to `{}` on missing/invalid content with a `console.error` (`config.ts:121-129`), never thrown.
2. **`worktreeSetupHook` / `worktreeSetupHookTimeoutMs`.** String / positive-integer-ms (default `30000`) fields of `ExtensionConfig` (`src/shared/types.ts:1952-1953`), consumed at multiple call sites including `src/runs/background/subagent-runner.ts:3794-3795`. Path resolution (`src/runs/shared/worktree.ts:264-295`, `resolveWorktreeSetupHook`): absolute paths pass through; `~/`-paths expand to home; anything else **must contain a `/` or `\`** to be treated as repo-relative (resolved against the invocation's `repoRoot`) or it throws `"worktree setup hook must be an absolute path or a repo-relative path"`. Both forms are accepted -- this repo chose the absolute form (see Decisions).
3. **`agentScope`.** Exhaustively enumerated `ExtensionConfig` (`types.ts:1902-1966`, every field read): **no `agentScope` key exists anywhere in it.** `agentScope` exists ONLY as a per-invocation parameter on the `subagent` tool's own TypeBox schema (`src/extension/schemas.ts:333`: `"Agent discovery scope: 'user', 'project', or 'both' (default: 'both'; project wins on name collisions)"`), resolved by `resolveExecutionAgentScope()` (`src/agents/agent-scope.ts:3-6`) to `"both"` whenever the caller (the model, or a chain/workflow default) omits it. This **corrects** the decision recorded in `07-04-SUMMARY.md` ("agentScope must be set to project or both by plan 07-09 or `.pi/agents/*.md` is never loaded (default is user-level only)") -- that claim does not hold against the version this repo actually pins. Project-scoped `.pi/agents/planner.md` is already discovered by default, with no configuration write required or possible.
4. **`contact_supervisor`/`intercom` tool-pair gating.** No config switch. `createNativeSupervisorChannel(pi, state).start()` is called unconditionally on every `session_start` (`src/extension/index.ts:412, 827-835`), and `start()` calls `registerParentTools()` unconditionally (`src/intercom/native-supervisor-channel.ts:649-651, 766-769`) -- the only guard present is an idempotency check (`hasTool`), not a config gate. `ExtensionConfig`'s full field list (`types.ts:1902-1966`) has nothing that influences this. Plan 07-11's tool-count baseline must count both tools as always-present.

**Preflight constraint (recorded for `docs/RUNBOOK.md`/07-13):** `resolveRepoState()` (`worktree.ts:137-142`) runs `git status --porcelain -- :!.pi/subagents` and throws `"worktree isolation requires a clean git working tree. Commit or stash changes first."` on any non-empty result -- a real operational constraint on using worktree-isolated subagents in this repo.

No `npm install` or `pi install` was run. `npm pack pi-subagents@0.49.0` + `tar -xf` under this session's scratchpad temp directory; the directory was removed after inspection.

## Task Commits

Task 1 was research-only (no file output; findings recorded above and in this SUMMARY, per the plan's own file spec).

1. **Task 2: `.pi/settings.json` packages[] + `bin/bootstrap.sh` `merge_subagent_config()`** - `6c0ebd7` (feat)
2. **Task 3: `tests/unit/extension-pins.test.ts`** - `feb91a5` (test)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `.pi/settings.json` -- the lockfile: `packages[]` with five exact npm pins. No subagents configuration block (none belongs there; see Task 1 finding 1).
- `bin/bootstrap.sh` -- new `merge_subagent_config()` function (key-namespaced merge of `worktreeSetupHook`/`worktreeSetupHookTimeoutMs` into `<agentDir>/extensions/subagent/config.json`), wired into `run_full()`, `usage()` text updated.
- `tests/unit/extension-pins.test.ts` -- EXT-08 enforcement: four directions over `packages[]`, plus a fifth section proving the `bin/bootstrap.sh` wiring is real.

## Decisions Made

See `key-decisions` in frontmatter. Summarized: (1) subagents configuration lives in a dedicated global file, not `.pi/settings.json` -- confirmed from source, not assumed; (2) `agentScope` needs no write anywhere -- pi-subagents@0.49.0 has no such settings key, and its per-call default already achieves the desired discovery behavior, correcting a stale 07-04 decision; (3) the hook wiring was added to `bin/bootstrap.sh` (Rule 2 -- missing critical functionality) rather than performed as a one-off live-machine write, so it survives a cold-machine clone per this repo's own bootstrappable-cold-machine constraint; (4) the wired hook path is absolute, not repo-relative, since the config file applies machine-wide.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Wired the worktree setup hook into `bin/bootstrap.sh` rather than `.pi/settings.json`**
- **Found during:** Task 1 (source re-verification) and Task 2 (writing the configuration)
- **Issue:** The plan's `files_modified` frontmatter declared only `.pi/settings.json` and `tests/unit/extension-pins.test.ts`, on the assumption that pi-subagents reads `worktreeSetupHook`/`agentScope` from `.pi/settings.json`. Task 1's direct read of the pinned `pi-subagents@0.49.0` tarball disproved this: the package reads its own configuration exclusively from `<agentDir>/extensions/subagent/config.json`, a file this repository does not track. The plan's own text explicitly anticipated this outcome ("If Task 1 found the configuration is NOT read from `.pi/settings.json`, write it wherever Task 1 says it IS read from, record the deviation prominently in the summary, and still keep `packages[]` in `.pi/settings.json`"), but a literal one-off write to this machine's real global agent directory would not be reproducible on a fresh clone -- violating this project's own "bootstrappable on a cold machine" constraint (CLAUDE.md) and this repo's own established convention (`.pi/templates/` + `bin/bootstrap.sh` merge functions for `models.json`/`auth.json`/`settings.json`'s `kyPiAgent` key).
- **Fix:** Added `merge_subagent_config()` to `bin/bootstrap.sh`, following the exact key-namespaced-merge discipline `merge_settings`/`merge_models_json` already use (refuse on invalid JSON, refuse on a non-object, replace only the two owned keys, byte-idempotent no-op on a second run), wired into `run_full()`. Also executed for real against this dev machine's actual global agent directory (idempotent, verified with two consecutive runs), matching Phase 1's own precedent of running `--assert-hardening` for real rather than only describing it.
- **Files modified:** `bin/bootstrap.sh` (not in the plan's declared `files_modified`)
- **Verification:** `sh -n bin/bootstrap.sh` and `dash -n bin/bootstrap.sh` both clean; the function extracted and executed in isolation against a temp `PI_CODING_AGENT_DIR` twice (second run reported "already current - unchanged"); run for real against the live machine's agent dir; `sh bin/bootstrap.sh --assert-hardening` re-confirmed all three npm scopes hardened afterward; `tests/unit/extension-pins.test.ts`'s fifth describe block asserts the function's presence, its call from `run_full()`, and that the wired hook path resolves to a real tracked file.
- **Committed in:** `6c0ebd7` (Task 2 commit)

**2. [Rule 1 - Corrected a stale prior decision] `agentScope` is not written anywhere**
- **Found during:** Task 1
- **Issue:** `07-04-SUMMARY.md` recorded that `agentScope` must be set to `project` or `both` in `.pi/settings.json` or `.pi/agents/*.md` would never load, citing a version of `pi-subagents` whose default was allegedly user-level only. Direct inspection of the pinned `0.49.0` tarball found `agentScope` is not a settings key at any scope -- it is a per-tool-call parameter that already defaults to `"both"`.
- **Fix:** No write performed. `tests/unit/extension-pins.test.ts` asserts `.pi/settings.json` carries no `agentScope` key, with a comment naming why, so a future contributor does not "fix" an absence that is correct.
- **Files modified:** `tests/unit/extension-pins.test.ts` (assertion only; no production write)
- **Verification:** Full-text read of `pi-subagents@0.49.0`'s `ExtensionConfig` interface (`src/shared/types.ts:1902-1966`) found no `agentScope` field; `src/agents/agent-scope.ts:3-6`'s `resolveExecutionAgentScope` confirmed the `"both"` default.
- **Committed in:** `feb91a5` (Task 3 commit)

---

**Total deviations:** 2 (1 Rule 2 -- missing critical functionality / scope expansion beyond declared `files_modified`, 1 Rule 1 -- corrected a stale prior decision by direct re-verification against source).
**Impact on plan:** The `bin/bootstrap.sh` change is the only file outside the plan's declared `files_modified`; it exists because the plan's premise (subagents config lives in `.pi/settings.json`) was disproved by Task 1's own mandated research, and the plan's own contingency text authorized writing "wherever Task 1 says it IS read from." No scope creep beyond what closing that gap required -- no other `bin/bootstrap.sh` behavior was touched.

## Issues Encountered

- An early isolated test of `merge_subagent_config()` (sourcing a truncated copy of `bin/bootstrap.sh` via `sh -c '. file'`) produced an incorrect `$REPO_ROOT` (`C:/Users/Admin/Documents` instead of `.../ky-pi-agent`) because sourcing never changes `$0`, and `SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)` depends on it. This was a test-harness artifact, not a bug in the shipped function: re-tested by copying the function definitions into a temporary file placed directly under `bin/` and *executing* it with `sh` (never sourcing), which correctly resolves `$0` to the copy's own location — confirmed the correct absolute hook path both in isolation and in the real, unmodified `bin/bootstrap.sh` run against this machine's actual global agent directory. The temporary copy was deleted immediately after each run; `git status --short bin/` confirmed no artifact was left behind.

## User Setup Required

None -- no external service configuration required. The one live-machine write (`merge_subagent_config` run for real) touched only this development machine's local `~/.pi/agent/extensions/subagent/config.json`, which is outside this repository's tracked files and reproduced automatically by `bin/bootstrap.sh` on any machine.

## Next Phase Readiness

`.pi/settings.json`'s lockfile is committed and diffed against a committed expectation in both directions. The worktree setup hook is genuinely wired into `pi-subagents`' real configuration surface and reproducible on a cold machine via `bin/bootstrap.sh`, not merely documented. Plan 07-10 (the human-gated install) can proceed against a settings file whose `packages[]` array is exactly what will be installed. Plan 07-11's tool-count baseline should count `contact_supervisor` and `intercom` as always-registered (Task 1 finding 4), with no config lever to reduce them. No blockers.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: .pi/settings.json
- FOUND: tests/unit/extension-pins.test.ts
- FOUND: bin/bootstrap.sh
- FOUND: 6c0ebd7 (feat(07-09) commit)
- FOUND: feb91a5 (test(07-09) commit)
