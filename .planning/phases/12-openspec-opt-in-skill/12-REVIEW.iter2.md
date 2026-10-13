---
phase: 12-openspec-opt-in-skill
reviewed: 2026-10-13T00:00:00Z
depth: deep
files_reviewed: 18
files_reviewed_list:
  - .gitignore
  - .pi/extensions/harness/index.ts
  - .pi/extensions/safety/infra.ts
  - docs/OPENSPEC.md
  - docs/RUNBOOK.md
  - docs/SAFETY.md
  - scripts/openspec-setup.sh
  - tests/fixtures/openspec-skills.ts
  - tests/helpers/harness-session.ts
  - tests/integration/openspec-setup.test.ts
  - tests/integration/openspec-zero-cost.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/gitignore-policy.test.ts
  - tests/unit/infra-policy.test.ts
  - tests/unit/openspec-docs.test.ts
  - tests/unit/openspec-env.test.ts
  - tests/unit/openspec-skills.test.ts
  - tests/unit/policy-compose.test.ts
findings:
  critical: 1
  warning: 6
  info: 6
  total: 13
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-10-13
**Depth:** deep (traced `policy.ts` -> `shell.ts` -> `infra.ts`; checked Pi 1.1.0 `skills.js` / `config.js` in node_modules and the installed `@fission-ai/openspec@1.13.2` dist)
**Files Reviewed:** 18
**Status:** issues_found

## Summary

The skill-cost mechanism holds up. Pi 1.1.0 `skills.js:262` reads `frontmatter["disable-model-invocation"] === true`. The patcher puts the flag in the right place, and the real installed `~/.pi/agent/skills/openspec-explore/SKILL.md` matches the fixture shape. The zero-cost and loader tests have genuine negative controls.

The safety integration has problems. `evaluate()` was probed directly with Node, and many wrapper shapes reduce the new `openspec` confirm rows (and the existing terraform/git/kubectl rows) to `allow`. The root cause is `resolveWrappers`: `env VAR=val`, `env --`, `sudo --`, `exec`, `timeout`, `nice -n N` and `env A=1 sh -c ...` all return `allow` for commands that are confirmed or blocked when spelled plainly. `docs/SAFETY.md` now claims OpenSpec has exactly two gaps, which understates them. The setup script's refusal to install into the repo can be bypassed with a relative path or a different letter case. Two tests prove less than their names say.

Probe output (facts: branch `main` protected, current branch `main` for the git rows):

```
block    git push origin main          -> allow    env A=1 git push origin main
block    git commit -m x               -> allow    env A=1 git commit -m x
confirm  terraform apply               -> allow    env A=1 terraform apply / exec terraform apply /
                                                    timeout 5 terraform apply / nice -n 5 terraform apply /
                                                    sudo -- terraform apply / env -- terraform apply
block    sh -c 'terraform apply'       -> allow    env A=1 sh -c 'terraform apply'
confirm  openspec update               -> allow    env A=1 openspec update / sh -c "openspec update" /
                                                    xargs openspec init / npx openspec update /
                                                    bunx openspec update / node /x/openspec/bin/openspec.js update
```

## Critical Issues

### CR-01: Wrapper resolution lets protected git, terraform, kubectl and openspec commands through as `allow`

**File:** `.pi/extensions/safety/shell.ts:409-452` (in the call chain of `infra.ts:383-385` via `policy.ts:155`)
**Issue:** `resolveWrappers` stops consuming after `env` at the first word that does not start with `-`. With `env A=1 terraform apply`, the resolved executable is therefore `A=1`. `classifyInfraInvocation` returns `not-applicable`, the git arm never runs, and `fromInfraVerdict` maps that to `allow`. Because the executable is `A=1` rather than `sh`, the same mistake also defeats the shell-runner denial (`env A=1 sh -c 'terraform apply'` returns allow).

Other spellings fail the same way:
- `env --` and `sudo --` break on the unrecognised `--`.
- `nice -n 5` is skipped one flag at a time, so `5` becomes the executable.
- `exec` and `timeout` are not wrappers at all, so their executable is never classified.

`env A=1 git push origin main` on `main` comes back as `allow`, so the guard does not hold against one of the most common shell idioms. `tests/unit/policy-compose.test.ts:285-290` only exercises `env -i openspec update` (a recognised boolean flag), so this gap stays green. Nothing in the evasion corpus covers `env VAR=val`, `exec`, `timeout`, `--`, or `nice -n`.
**Fix:** In the `env` loop, skip words matching `/^[A-Za-z_][A-Za-z0-9_]*=/` and treat `--` as an end-of-options marker for both `env` and `sudo`. Add `exec`, `timeout` (one positional duration), `nice` (`-n` takes a value), `ionice`, `doas`, `watch` and `unbuffer` with explicit arity. Separately, fail closed when the resolved executable matches `/^[A-Za-z_]\w*=/`, and when a guarded verb appears literally as a later word of an otherwise unclassified invocation.
```ts
if (verb === "env") {
	wrappers.push("env");
	i += 1;
	while (i < values.length) {
		const w = values[i];
		if (w === "--") { i += 1; break; }
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i += 1; continue; }
		if (!w.startsWith("-")) break;
		/* existing flag arity table */
	}
	continue;
}
```
Add evasion-corpus rows: `env A=1 git push origin main`, `env A=1 terraform apply`, `env A=1 sh -c 'terraform apply'`, `exec terraform apply`, `timeout 5 terraform apply`, `nice -n 5 terraform apply`, `sudo -- terraform apply`, `env -- openspec update`. Replace the `env -i` row in `policy-compose.test.ts` with `env A=1 openspec update`.

## Warnings

### WR-01: `openspec` is not a guarded verb, so runner and launcher indirection skip its confirm rows, and SAFETY.md says otherwise

**File:** `.pi/extensions/safety/shell.ts:42`, `docs/SAFETY.md:183`, `docs/OPENSPEC.md:59`
**Issue:** `GUARDED_VERB_PATTERN` is still `git|glab|terraform|aws|kubectl`. As a result:
- `sh -c "openspec update"`, `bash -c 'openspec init'` and `echo update | xargs openspec` are allowed. The shell-runner denial never fires, and the command-position expansion rule never covers `openspec`'s suffix.
- `npx openspec update`, `bunx openspec update`, `pnpm dlx @fission-ai/openspec update` and `node .../openspec.js update` are allowed.

`docs/SAFETY.md:183` says the corpus table "does not list two OpenSpec gaps" (npx and `mv`), and `OPENSPEC.md:59` says the guard "asks for confirmation on init, update, completion, feedback". Both statements are incomplete. By SAFETY.md's own Authority section, a stale claim there is a false sense of security. The paragraph also bypasses the corpus-coupled table on purpose instead of adding OUT-OF-SCOPE corpus rows.
**Fix:** Either add `openspec` to `GUARDED_VERB_PATTERN`, so `sh -c`/`xargs` carrying it are refused like the other guarded verbs, or list every shape above as OUT-OF-SCOPE rows in `tests/fixtures/evasion-corpus.ts` so they reach the coupled table. Then rewrite SAFETY.md:183 and OPENSPEC.md:59 to match the probed behaviour.

### WR-02: `context` is in the allow table but can overwrite an arbitrary file

**File:** `.pi/extensions/safety/infra.ts:263-278`, `tests/unit/infra-policy.test.ts:196`
**Issue:** The table's contract is "read only, or write only inside `openspec/`". In 1.13.2, `openspec context --code-workspace <path> --force` calls `fs.writeFileSync(path.resolve(outputPath), ...)` with no confinement (`dist/commands/context.js`, `writeCodeWorkspace`). Without a prompt, the model can therefore overwrite any file whose parent directory exists, for example `~/.bashrc` or `.gitlab-ci.yml`, with VS Code workspace JSON. The test row labels it "read-only".
**Fix:** Classify `context` as allow only when `args` contains neither `--code-workspace` nor `--code-workspace=`. Otherwise return confirm with a reason such as "writes a workspace file at an arbitrary path". Add both rows.

### WR-03: The setup script's "refuse to install into the repository" check can be bypassed

**File:** `scripts/openspec-setup.sh:61, 74-85`
**Issue:** The check compares strings literally against `pwd -P`, and only resolves the path when the directory already exists. Verified in Git Bash:
- `PI_CODING_AGENT_DIR=C:/users/admin/documents/ky-pi-agent/zz-agent` (case variant) exits 0.
- `/c/users/.../zz-agent` exits 0. `pwd -P` keeps the typed case on Windows, so an existing case-variant directory also passes.
- `zz-agent` or `./zz-agent` (relative) exits 0.

On macOS, a nonexistent directory reached through a symlinked prefix also passes. A relative value like `./.pi` would write `openspec-*` into the repo's own `.pi/skills`, where they are both committable and loaded on every turn. That is the exact outcome the guard exists to prevent.

Separately, Pi's `getAgentDir()` applies `expandTildePath` to `PI_CODING_AGENT_DIR` (`config.js:491-494`), but the script does not. A literal `~/.pi/agent` therefore installs into `./~/.pi/agent`, which Pi never reads.
**Fix:** Expand a leading `~`. Reject relative values, or make them absolute against `$PWD`. Resolve the nearest existing ancestor with `cd ... && pwd -P`, then append the rest. On Windows, run both sides through `cygpath -m` and lower-case them before comparing. Add test rows for the relative and case-variant forms.

### WR-04: The "restores the pre-test values" test is vacuous

**File:** `tests/unit/openspec-env.test.ts:41-44`
**Issue:** `beforeEach` sets `OPENSPEC_TELEMETRY=1` and deletes `DO_NOT_TRACK` before every test, so this test passes even if `afterEach` were deleted. It does not prove restoration.
**Fix:** Record the original values at module load (outside `beforeEach`), and in an `afterAll` assert that `process.env` equals those originals. Alternatively, drop this test and rely on the existing `afterEach`.

### WR-05: `git status --porcelain .pi` makes the setup test depend on the developer's working tree

**File:** `tests/integration/openspec-setup.test.ts:397-398`
**Issue:** The test fails whenever any uncommitted change exists under `.pi/`, for example mid-phase work on an extension, whatever the script does. The script never targets the repo here anyway: every run points `PI_CODING_AGENT_DIR` at a temp directory. `vitest.config.ts`'s global tripwire deliberately diffs against a setup-time snapshot instead of demanding an empty porcelain. This assertion reintroduces the flake that design avoids.
**Fix:** Snapshot `git status --porcelain .pi` in `beforeAll` and compare it after the runs, or remove the assertion and rely on the global tripwire.

### WR-06: OPENSPEC.md claims the setup script verifies the telemetry opt-out, but the script does not check it

**File:** `docs/OPENSPEC.md:53`, `scripts/openspec-setup.sh:247-250`
**Issue:** The doc says the script "writes `telemetry.enabled=false` into the real OpenSpec config and verifies it". The script discards the command's output, only warns on a non-zero exit, and never reads the value back. The same sentence says the harness sets the variables "for every CLI call it makes". In fact it mutates Pi's `process.env`, which spawned children inherit; the harness itself makes no calls. `RUNBOOK.md` RB-12-03's offline proxy repeats the overclaim.
**Fix:** After the `config set`, run `openspec config get telemetry.enabled` and warn (or fail) unless it prints `false`. Alternatively, change the doc to "attempts to write ... and warns on failure" and describe the env inheritance accurately.

## Info

### IN-01: The INT/TERM trap cleans up but does not exit

**File:** `scripts/openspec-setup.sh:182`
**Issue:** `trap 'rm -rf "$work"' EXIT INT TERM` replaces the default signal action. After an interrupt between commands, the script continues with `$work` already deleted. If the interrupt lands inside the copy loop, a skill is left removed and the run exits as an ordinary failure rather than with status 130.
**Fix:** `trap 'rm -rf "$work"' EXIT; trap 'exit 130' INT; trap 'exit 143' TERM`.

### IN-02: The install is not atomic, and uninstall is approximate

**File:** `scripts/openspec-setup.sh:165-176, 228-234`, `docs/OPENSPEC.md:77`
**Issue:**
- Install runs `rm -rf` then `cp -R` for each skill. A failure partway through leaves a mixed or partial set.
- `--uninstall` deletes same-named files that the user wrote, prints "Removed 12 skills" even when none existed, and leaves stale `openspec-*` directories from renamed skills.
- The manual cleanup advice names only the config directory. OpenSpec 1.13.2 also keeps a data directory (`%LOCALAPPDATA%\openspec`, `~/.local/share/openspec`; `global-config.js` `getGlobalDataDir`) holding the store registry and user schemas.

**Fix:** Stage into `$SKILLS_DIR/.openspec-staging` and `mv` per directory, count what was actually removed, and mention the data directory in both places.

### IN-03: The harness comment's rationale is inaccurate, and the forced DO_NOT_TRACK has global reach

**File:** `.pi/extensions/harness/index.ts:23-28`
**Issue:** OpenSpec's precedence (`telemetry/index.js:63-64`) opts out when either `OPENSPEC_TELEMETRY` is not an on-value or `DO_NOT_TRACK` is not an off-value. If both variables were only defaulted, an inherited `OPENSPEC_TELEMETRY=1` would still be overridden by a defaulted `DO_NOT_TRACK=1`. Telemetry would come back only if `DO_NOT_TRACK=0` were also inherited. Separately, forcing `DO_NOT_TRACK=1` changes behaviour for every child tool that honours it, not just OpenSpec. That is acceptable as policy but goes undocumented.
**Fix:** Reword the comment: "Forced, not defaulted: an inherited DO_NOT_TRACK=0 with OPENSPEC_TELEMETRY=1 would re-enable reporting; DO_NOT_TRACK also reaches non-OpenSpec children."

### IN-04: Phase-ID references in test code, and the pin-parity check is weak

**File:** `tests/unit/openspec-docs.test.ts:26-36`, `tests/unit/docs-policy.test.ts:173`
**Issue:** The comment "The Phase 12 section of the runbook" violates AGENTS.md's no-phase-ID rule. Pin parity only checks that the current pin appears somewhere, so a doc still naming both the old and the new version passes. The integrity hash is not tied to the version either.
**Fix:** Drop the phase reference from the comment. Assert that every `@fission-ai/openspec@x.y.z` occurrence equals the script's pin.

### IN-05: Other in-process harness loaders do not restore the OpenSpec variables

**File:** `tests/helpers/harness-session.ts:45-51` (versus `tests/helpers/faux.ts`, used by `tests/unit/comment-rules-delivery.test.ts:107-114`)
**Issue:** Only `harness-session.ts` saves and restores the four variables. The faux helper also imports and runs the harness factory, and it leaves them set for the rest of that test file.
**Fix:** Move the save/restore into a shared helper, or into `tests/setup/agent-dir.ts`, so every in-process load is covered.

### IN-06: An exported CDPATH breaks the `cd` substitutions

**File:** `scripts/openspec-setup.sh:58, 76`
**Issue:** `$(cd "$(dirname "$0")" && pwd)` with `dirname` = `scripts` (relative, no `./`) searches CDPATH and echoes the directory, so `SCRIPT_DIR` ends up with two lines. The same happens at line 76 with a relative agent directory.
**Fix:** Use `CDPATH= cd -- "..." && pwd -P`, or `unset CDPATH` at the top.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
