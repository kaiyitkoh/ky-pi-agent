---
phase: 12-openspec-opt-in-skill
reviewed: 2026-10-13T00:00:00Z
depth: deep
iteration: 3
files_reviewed: 28
files_reviewed_list:
  - .gitignore
  - .pi/extensions/harness/index.ts
  - .pi/extensions/plan-mode/read-only.ts
  - .pi/extensions/safety/git.ts
  - .pi/extensions/safety/index.ts
  - .pi/extensions/safety/infra.ts
  - .pi/extensions/safety/policy.ts
  - .pi/extensions/safety/shell.ts
  - docs/OPENSPEC.md
  - docs/RUNBOOK.md
  - docs/SAFETY.md
  - scripts/openspec-setup.sh
  - tests/fixtures/evasion-corpus.ts
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
  - tests/unit/plan-mode-read-only.test.ts
  - tests/unit/policy-compose.test.ts
  - tests/unit/shell-deny-list.test.ts
  - tests/unit/shell-parse.test.ts
  - tests/unit/workflow-budgets.test.ts
findings:
  critical: 1
  warning: 2
  info: 4
  total: 7
status: issues_found
---

# Phase 12: Code Review Report (iteration 3)

**Reviewed:** 2026-10-13
**Depth:** deep. HEAD `evaluate()`, `canonicalise()` and `classifyPlanModeCommand()` were probed on about 120 commands. Facts: protected `main`. Column 1 has cwd on `main`. Column 2 has cwd on a feature branch, with `/other` on `main`. I ran `tests/unit/workflow-budgets.test.ts`, and it passes (130/130).
**Files Reviewed:** 28
**Status:** issues_found

## Summary

**A. Previous findings (12-REVIEW.iter3.md).** All eight are resolved at HEAD, and test rows pin each one:

| Finding | Probe at HEAD | Pinned by |
|---|---|---|
| CR-01 | `g=git; env $g push origin main` and `timeout 5 $g ...` are refused | shell-deny-list:131, EV-101/102 |
| CR-02 | `env --ignore-signal=PIPE g''it ...`, `sudo -P te''rraform apply` and `sh -c 'g''it ...'` are refused | shell-deny-list:172-186, EV-103/104 |
| CR-03 | Plan mode denies `npx -y @evil/ls@1.0.0`, `bunx grep x`, `npx -y @attacker/git@1 status` and `./ls@x` | PM-57..61 |
| WR-01 | `npm --yes exec`, `npm -y x --`, `pnpm -C . dlx` and `yarn --cwd . dlx` with openspec confirm. `npm --loglevel silent exec openspec update` is refused | shell-parse:257-271, EV-105/106 |
| WR-02 | `sudo -D /other` and `sudo --chdir=/other git commit` block | policy-compose:378-387 |
| WR-03 | `command -v openspec` and `command -v git` allow | policy-compose:392-400 |
| WR-04 | `cmd //c`, `cmd.exe /c`, `powershell -Command`, `winpty`, `find -exec`, `ssh` and `strace` with a guarded verb block | shell-parse:442-560, EV-107..112 |
| WR-05 | `ls openspec/changes \| xargs -I{} cat openspec/changes/{}/proposal.md`, `python3 x.py openspec/specs` and `npx -w ... tests/git-policy.test.ts` allow | shell-parse:541, shell-deny-list:221 |

**Everyday commands are not regressed.** These all allow:
- `git status`, `git log`, `git diff`
- `npm test`, `npm run build`, `npx vitest run ...`, `npx tsc --noEmit`
- `ls`, `cat`, `grep` and `find` over `openspec/`
- `openspec list`, `show`, `validate`, `status`, `archive`

`openspec init` and `openspec update` confirm. `tests/unit/workflow-budgets.test.ts` now passes, so the pre-existing safety/harness budget failure the fixer reported is gone.

**B. Comments.** No added comment in the changed `.ts` or `.sh` files carries a review or phase ID. A few earlier issues remain (IN-02).

**C. Docs.** The SAFETY.md, OPENSPEC.md and RUNBOOK.md Phase 12 claims match the probed behaviour, with two exceptions: CR-01 and WR-01 below. The Phase 12 text has no usernames, hostnames or home paths. One older SAFETY.md row does (IN-03).

## Structural Findings (fallow)

No structural pre-pass was provided.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Interpreter escapes and empty expansions inside a runner's script string defeat the shell-runner verb match

**File:** `.pi/extensions/safety/shell.ts:410-418` (`mentionsGuardedVerb`), claim at `docs/SAFETY.md:36-43`
**Issue:** Each command below should be refused as `shell-runner`, as `sh -c 'g''it push origin main'` is. Actually: each is `allow` on protected `main` (plan mode denies them).
- `sh -c 'g${u}it push origin main'` (the unset expansion is empty, so the shell runs `git`)
- `bash -c 'gi$@t push origin main'`
- `cmd //c "gi^t push origin main"` (`^` is cmd's escape character)
- ``powershell -Command 'g`it push origin main'`` (a backtick is PowerShell's escape character)

This is the same property as iteration-3 CR-02: split text the matcher does not normalise. The fix only removes quotes and backslashes. The new SAFETY.md bullet presents `cmd //c`, `powershell -Command` and `pwsh -c` as covered runners, but their own escape characters bypass them. The `${u}`/`$@` form is older than this phase. No OUT-OF-SCOPE corpus row covers any of these forms.
**Fix:** Add one more normalised text to `mentionsGuardedVerb`, which is safe because it only adds matches:
```ts
GUARDED_VERB_PATTERN.test(text.replace(/['"\\^`]|\$(\{[^}]*\}|[@*#?!$0-9]|[A-Za-z_][A-Za-z0-9_]*)/g, ""))
```
Add BLOCKED corpus rows for `sh -c 'g${u}it push origin main'`, `cmd //c "gi^t push origin main"` and ``powershell -Command 'g`it push origin main'``. If any form is left open, publish it as an OUT-OF-SCOPE row and qualify the SAFETY.md bullet.

## Warnings

### WR-01: `cwdOverride` ignores how directory overrides compose, so the protected-branch oracle reads the wrong repository

**File:** `.pi/extensions/safety/shell.ts:361-368, 397` (comment at `:162`), claim at `docs/SAFETY.md` ("`env -C` and `sudo -D` directories feed the protected-branch check")
**Issue:** With cwd on a feature branch and `/other` on `main`, the expected verdict is `block`. Actual: `allow` for each of these.
- `env -C /other git -C . commit -m x`
- `sudo -D /other git -C . commit -m x`
- `env -C /other git -C sub commit -m x`
- `git -C . -C /other commit -m x`

Two problems produce this:
- A relative `git -C` replaces the wrapper directory instead of resolving against it. The oracle is asked about `"."`, which is the session cwd.
- `extractGitCwdOverride` returns the first `-C`, but git applies every `-C` cumulatively.

The `env -C` half predates this phase. WR-02's `sudo -D` extends it, and the SAFETY.md sentence added this iteration states the feature without the caveat. `cd /other && git commit -m x` is the same class (also `allow` from a feature cwd) and is not published either.
**Fix:** Fold every directory in order, wrapper directories first and then each `git -C`: an absolute value replaces the accumulator, and a relative value is joined onto it (`path.posix.join`, or `resolve` when the accumulator is absolute). Return the result as `cwdOverride`. Add policy-compose rows for `env -C /other git -C . commit -m x` and `git -C . -C /other commit -m x`, expected `block`. Either publish `cd /other && git ...` as an OUT-OF-SCOPE row or handle a leading `cd` segment.

### WR-02: A guarded word followed by a space or dot still counts as a verb, so `find openspec ... -exec` is hard-blocked

**File:** `.pi/extensions/safety/shell.ts:22` (`GUARDED_VERB_PATTERN`), `:420-424` (`isShellRunner`)
**Issue:** The expected verdict for each of these is `allow` (read-only). Actual: `block` (`shell-runner`), with no approval path.
- `find openspec -name '*.md' -exec wc -l {} +`
- `find . -name '*.md' -path '*openspec*' -exec cat {} \;`
- `fd -e md . openspec -x wc -l`
- `node scripts/gen-openspec.mjs`

The WR-05 lookahead only exempts a word followed by `/`. A directory named as a bare `find` root is followed by a space. Treating `find`/`fd` as runners (WR-04) and adding `openspec` as a guarded verb both arrived this phase. Listing OpenSpec files with `find openspec ... -exec` is an ordinary agent action in a work repo. Note that `find openspec/changes ... -exec grep ...` already allows, so the outcome depends on whether a trailing slash is present.
**Fix:** For `find`/`fd`, match only the words after the exec primary, which form the command the primary runs, instead of the whole segment: `inv.args.slice(inv.args.findIndex((a) => execPrimaries.has(a)) + 1)`. Add allow rows for `find openspec -name '*.md' -exec wc -l {} +` and a block row for `find . -exec git push origin main \;`, which already exists. For `node scripts/*openspec*.mjs`, either accept the hard block and list it in SAFETY.md next to the `sh scripts/openspec-setup.sh` note, or leave it.

## Info

### IN-01: Prior Info items IN-02/IN-03 are still open, plus two siblings

**File:** `.pi/extensions/safety/shell.ts:281, 286`, `docs/SAFETY.md:192` (EV-94)
**Issue:**
- `env - git status` is refused (`unresolved-wrapper`). Expected: allow, because `-` is POSIX `-i`.
- `command -pv git` is refused. The packed query form is unconfident and should behave like `command -p -v git`.
- `npm i -g @fission-ai/openspec@latest` is `allow` and unpublished. This is the unpinned self-upgrade that `openspec update` confirms on.
- `bun run openspec update` and `yarn run openspec update` are `allow`. They belong to EV-94's class, but the row names only bare `yarn`/`pnpm`.

Separately, `env "PATH=$PATH:/x" npm test` and `env HOME="$HOME" npm test` are hard-blocked even though a quoted expansion cannot word-split. This is a documented trade-off, but it is avoidable: only refuse an unquoted expansion among the wrapper words.
**Fix:** Treat `-` as boolean in the env grammar. Accept a packed `-pv` as a query. Publish the global-install form, or confirm on it. Widen EV-94's text to "`run` or a bare word".

### IN-02: Remaining comment-rule violations in touched files

**File:**
- `.pi/extensions/safety/shell.ts:5` ("extension-layout.test.ts would treat it as an entry point") and `:40` ("tests iterate it")
- `.pi/extensions/plan-mode/read-only.ts:64-65` ("in this pass ... a Phase 4 change with Phase 4 consequences")
- `tests/unit/openspec-docs.test.ts` ("The Phase 12 section of the runbook")
- `scripts/openspec-setup.sh:2-18`

**Issue:**
- The shell.ts comments reference callers and tests, which AGENTS.md forbids.
- The read-only.ts block was edited this phase but keeps phase/history wording.
- The openspec-docs test comment carries a phase ID.
- The setup-script header is a 17-line block. The usage list is reasonable, but the rationale paragraph belongs in OPENSPEC.md.

**Fix:** Drop the test references, rewrite the read-only.ts sentence without "pass" or "Phase 4", and say "the OpenSpec section" in the test comment.

### IN-03: A real username and home path in SAFETY.md

**File:** `docs/SAFETY.md:186` (EV-27)
**Issue:** The example `cat C:\Users\Admin\.aws\credentials` embeds the development machine's account name. It predates this phase, but it sits in a doc this phase edited, and it breaks the public-repo rule.
**Fix:** Use `C:\Users\tester\.aws\credentials`, matching the fixture home. Check the corpus row EV-27 for the same string.

### IN-04: The setup-script robustness items are still open

**File:** `scripts/openspec-setup.sh:58`, `:219`
**Issue:** `SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)` still honours `CDPATH`, even though line 91 already uses `CDPATH=''`. The `INT`/`TERM` trap cleans up but does not exit with a signal status.
**Fix:** Change line 58 to `SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname "$0")" && pwd)`, and add `trap 'exit 130' INT; trap 'exit 143' TERM` alongside the EXIT cleanup.

---

_Reviewed: 2026-10-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
