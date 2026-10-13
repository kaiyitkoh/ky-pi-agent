---
phase: 12-openspec-opt-in-skill
fixed_at: 2026-10-13T00:00:00Z
review_path: .planning/phases/12-openspec-opt-in-skill/12-REVIEW.md
iteration: 2
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-10-13
**Source review:** .planning/phases/12-openspec-opt-in-skill/12-REVIEW.md
**Iteration:** 2

**Summary:**
- Findings in scope: 8 (3 critical, 5 warning). IN-01 was also fixed because the orchestrator asked for it explicitly; IN-02..IN-04 were not attempted.
- Fixed: 8
- Skipped: 0

**How the fixes were checked:**
- Each fix ran its targeted vitest files one at a time with `--maxWorkers=2`.
- Every new test was run as a negative control against the previous commit's `shell.ts` (and `read-only.ts` for CR-03), and failed there.
- `npx tsc --noEmit` ran once at the end and exited 0.
- Adjacent consumers also pass: shell-policy-gate, safety-entry, unbash-ast, path-policy, command-interpolation, infra-policy, docs-policy, openspec-docs, comment-discipline and comment-only-diff.

## Fixed Issues

### CR-01: An unresolved expansion behind any wrapper resolves to `allow`

**Files modified:** `.pi/extensions/safety/shell.ts`, `tests/unit/shell-deny-list.test.ts`, `tests/fixtures/evasion-corpus.ts`
**Commit:** 0cb8431
**Applied fix:**
- A new `hasExpansionBehindWrappers` runs once at least one wrapper is consumed. It refuses with `unresolved-expansion-in-command-position` when:
  - any wrapper word or the resolved command word holds an expansion, or
  - a literal guarded verb behind a wrapper has an expanded argument.
- Wrapper words are included because word splitting lets `T="5 terraform"; timeout $T apply` supply the executable through an operand.
- **Cost:** `sudo -u $U git push` and `env PATH=$PATH:x cmd` are now refused. An expansion in an ordinary argument (`env A=1 echo "$HOME"`) is still allowed.
- **Tests:** four deny-list rows and BLOCKED corpus rows EV-101 and EV-102.

### CR-02: The `unresolved-wrapper` refusal tests raw text, so split quotes defeat it

**Files modified:** `.pi/extensions/safety/shell.ts`, `tests/unit/shell-deny-list.test.ts`, `tests/fixtures/evasion-corpus.ts`
**Commit:** 3d75475 (plus a correction folded into 54daec7, see WR-05)
**Applied fix:**
- A new `mentionsGuardedVerb` is used by both the unresolved-wrapper refusal and the shell-runner rule. It tests the raw segment, the raw segment with quotes and backslashes removed, and each quote-resolved word.
- This also closes `sh -c 'g''it push origin main'`, which the review did not list but which was allowed.
- **Tests:** deny-list rows for `env --ignore-signal=PIPE g''it`, `sudo -P te''rraform`, `env -a x g""it` and `sh -c 'g''it ...'`, plus corpus rows EV-103 and EV-104.

### CR-03: Package-runner wrappers loosened plan mode

**Files modified:** `.pi/extensions/safety/shell.ts`, `.pi/extensions/plan-mode/read-only.ts`, `tests/unit/plan-mode-read-only.test.ts`, `tests/unit/shell-parse.test.ts`
**Commits:** a8339de, ec26aea
**Applied fix:**
- `shell.ts` exports `PACKAGE_RUNNER_WRAPPERS`, built from the existing tables. Plan mode denies any invocation whose wrappers include one.
- The `@version` strip moved out of `normaliseExecutable`. It now applies only to an executable reached through a package runner, so `./ls@x` no longer reaches the `ls` rule.
- Plan-mode rows PM-57..PM-61 were added: `npx -y @evil/ls@1.0.0`, `bunx grep x`, `pnpm dlx @x/head@1 a`, `npx -y @attacker/git@1 status` and `./ls@x`.
- The shell-parse npx row now expects executable `@fission-ai/openspec`.
- ec26aea trims read-only.ts by four lines so plan-mode stays inside its 1240-line directory budget without raising it.

### WR-01: Package-manager options before the subcommand skip runner resolution

**Files modified:** `.pi/extensions/safety/shell.ts`, `docs/SAFETY.md`, `tests/unit/shell-parse.test.ts`, `tests/unit/shell-deny-list.test.ts`, `tests/fixtures/evasion-corpus.ts`
**Commit:** 0a48792
**Applied fix:**
- New `PACKAGE_MANAGER_GLOBAL_GRAMMARS` table:
  - npm: `--prefix`, `-w`/`--workspace`, plus `-y`, `-s`, `-q`, `-ws`, ...
  - pnpm: `-C`/`--dir`, `-F`/`--filter`, plus `-w`, `-r`, `-s`
  - yarn and bun: `--cwd`
- A new `locatePackageManagerRunner` skips these options before looking up `exec`/`dlx`/`x`.
- An unknown global option followed anywhere by a runner subcommand makes resolution unconfident. CR-02's refusal then applies, so `npm --loglevel silent exec openspec update` is refused.
- **Tests:** shell-parse rows for `npm --yes exec`, `pnpm -C . dlx` and `yarn --cwd . dlx`; a deny-list row; corpus rows EV-105 and EV-106. SAFETY.md now states the global-option behaviour.

### WR-02: `sudo -D`/`--chdir` never became `cwdOverride`

**Files modified:** `.pi/extensions/safety/shell.ts`, `tests/unit/policy-compose.test.ts`, `tests/unit/shell-parse.test.ts`
**Commit:** 00d722c
**Applied fix:**
- `sudo -D` and `--chdir` (env or sudo) now set `cwdOverride`, the same way `env -C` does.
- **Tests:** policy-compose rows where `currentBranchFor` returns `main` only for `/other`, and a shell-parse row with `expectedCwdOverride`.

### WR-03: `command -v`/`-V` resolved as if it runs its operand

**Files modified:** `.pi/extensions/safety/shell.ts`, `tests/unit/policy-compose.test.ts`
**Commit:** a7bcfc1
**Applied fix:**
- `WrapperGrammar` gained a `query` set, which is `-v`/`-V` for `command`. When one is seen, the wrapper is not consumed, so the executable is `command`, which nothing classifies.
- **Tests:**
  - `command -v openspec` and `command -v git` on main both allow.
  - `command openspec update` still confirms.
- **Side effect:** plan mode now denies `command -v ls`, because `command` is not on its allowlist.

### WR-04: Common runners, including the Windows ones, passed guarded verbs unprompted

**Files modified:** `.pi/extensions/safety/shell.ts`, `docs/SAFETY.md`, `tests/unit/shell-parse.test.ts`, `tests/unit/shell-deny-list.test.ts`, `tests/fixtures/evasion-corpus.ts`
**Commit:** 5756e7b
**Applied fix:**
- **Shell runners added:** `cmd`, `powershell`, `pwsh`, `ksh`, `mksh`, `ash`, `csh`, `tcsh`, `su`, `script`, `parallel`, `ssh`, `chroot`, `strace` and `flock`.
- `find` and `fd` count as runners when they carry an `-exec`-family primary.
- `winpty` is a wrapper, so `winpty git push origin main` is classified as git.
- `powershell`/`pwsh -EncodedCommand` (and its prefixes `-e`, `-enc`, `-ec`) is refused whatever it holds. `-ExecutionPolicy` stays allowed.
- `busybox ash -c` is covered through the existing busybox wrapper.
- Every generic runner the review listed is now handled, so no new OUT-OF-SCOPE rows were needed and the SAFETY.md table count is unchanged.
- **Tests:** shell-parse runner rows for each new runner plus negative controls, deny-list rows for `find -exec` and `busybox ash -c`, and BLOCKED corpus rows EV-107..EV-112. SAFETY.md's nested-shell bullet lists the new runners.

### WR-05: `openspec` as a guarded verb hard-blocked runner use over `openspec/` paths

**Files modified:** `.pi/extensions/safety/shell.ts`, `docs/SAFETY.md`, `docs/OPENSPEC.md`, `tests/unit/shell-parse.test.ts`, `tests/unit/shell-deny-list.test.ts`
**Commit:** 54daec7
**Applied fix:**
- `GUARDED_VERB_PATTERN` now has a `(?![/\\])` lookahead, so a guarded word followed by a path separator is treated as a directory. `node /x/openspec/bin/openspec.js` still matches through the file name.
- The npx grammar gained `-w`/`--workspace` and `--registry` as value options.
- **Correction to CR-02 in this commit:** removing backslashes had regressed `cmd //c "C:\Git\cmd\git.exe push"` to allow. `mentionsGuardedVerb` now also tests each text unstripped, and a row pins the case.
- **Tests:** rows for xargs and python over `openspec/` paths (ok), `npx -w ... tests/git-policy.test.ts` (ok), and pattern unit assertions. SAFETY.md and OPENSPEC.md document the narrowing.

### IN-01 (requested by the orchestrator): comments and docs overpromised, and a review ID stayed in a comment

**Files modified:** `.pi/extensions/safety/shell.ts`, `.pi/extensions/plan-mode/read-only.ts`, `docs/SAFETY.md`
**Commit:** 81403ef (the shell.ts test-file reference was already dropped in 3d75475)
**Applied fix:**
- The shell.ts module docstring no longer claims policy "never" sees a wrapper.
- read-only.ts:
  - The "CORRECTION TO THAT RESIDUAL (CR2-01)" header and its second CR2-01 mention are gone.
  - The decision list now includes the unresolved-wrapper and package-runner steps.
- The SAFETY.md wrapper bullet no longer says "exactly as if typed plainly". It now states:
  - the wrapper-word expansion rule
  - `env -C`/`sudo -D`
  - the `command -v` lookup
  - that the table only covers the wrappers it lists

## Notes for the developer

**Needs human verification (logic changes):** CR-01, CR-02, WR-01, WR-02, WR-03, WR-04 and WR-05 all change guard classification. Policy choices worth a glance:
- Any expansion among wrapper words is refused. This fails closed and over-blocks `env PATH=$PATH:x cmd`.
- Several runners now refuse whenever a guarded verb is named, including `ssh host git status` and `strace git log`.
- `npx -y @attacker/git@1 status` is still `allow` in the safety layer, because it classifies as `git status`. Plan mode denies it. Package supply-chain trust is not something this layer decides.

**Pre-existing test failures, not introduced here and not fixed:**
- The directory line budgets for `.pi/extensions/harness` and `.pi/extensions/safety` already failed `tests/unit/workflow-budgets.test.ts` at 2c6bb17:
  - safety was about 3,030 raw lines against a declared 2,780
  - harness was 94 against 90, and harness was not touched in this pass
- This pass adds about 145 lines to `shell.ts`. Following the instruction not to raise budgets, those two entries were left alone; a human needs to re-baseline or trim them.

**Not addressed:** IN-02 (`env -`), IN-03 (unpinned global install of the guarded CLI) and IN-04 (prior setup-script Info items).

---

_Fixed: 2026-10-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
