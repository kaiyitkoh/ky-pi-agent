---
phase: 12-openspec-opt-in-skill
fixed_at: 2026-10-13T00:00:00Z
review_path: .planning/phases/12-openspec-opt-in-skill/12-REVIEW.md
iteration: 3
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-10-13
**Source review:** .planning/phases/12-openspec-opt-in-skill/12-REVIEW.md
**Iteration:** 3 (final)

**Summary:**
- Findings in scope: 5 (CR-01, WR-01, WR-02, plus IN-03 and the IN-02 comment items, as directed)
- Fixed: 5
- Skipped: 0
- Out of scope, untouched: IN-01, IN-04

The safety directory is 2,431 raw lines against its 2,440 budget, which is unchanged. The fixes added about 35 lines to shell.ts. To pay for them, 14 guard clauses in policy.ts were compacted to single lines. The `why` text for the budget records the new per-file figures.

Verification: these test files were run one at a time and all pass: workflow-budgets, shell-parse, shell-deny-list, infra-policy, policy-compose, evasion-corpus, git-policy, plan-mode-read-only and docs-policy. The openspec-docs, openspec-setup and git-head-main tests were also run and pass. `npx tsc --noEmit` is clean.

## Fixed Issues

### CR-01: Interpreter escapes and empty expansions inside a runner's script string defeat the shell-runner verb match

**Files modified:** `.pi/extensions/safety/shell.ts`, `docs/SAFETY.md`, `tests/fixtures/evasion-corpus.ts`, `tests/unit/shell-deny-list.test.ts`
**Commit:** bd081fa
**Applied fix:** `VERB_NORMALISERS` adds a third normalised form. It removes quotes, backslashes, cmd `^`, the PowerShell backtick, and `$x`, `${...}`, `$@`, `$*`, `$#`, `$?`, `$!`, `$$` and `$0-9`. The earlier forms are still tested, so this can only add matches. There are new BLOCKED corpus rows EV-113 to EV-116, and shell-deny-list rows for all four examples plus a negative control that should be allowed. Without the fix, all four rows and all four corpus rows fail. The SAFETY.md bullet now lists exactly which characters are normalised.

### WR-02: A guarded word followed by a space or dot still counts as a verb, so `find openspec ... -exec` is hard-blocked

**Files modified:** `.pi/extensions/safety/shell.ts`, `.pi/extensions/safety/policy.ts` (line-budget compaction only), `docs/SAFETY.md`, `docs/OPENSPEC.md`, `tests/unit/shell-deny-list.test.ts`
**Commit:** 7c43897
**Applied fix:** `runnerTexts()` replaces `isShellRunner()`.
- For `find`/`fd`, only the words after the first exec primary are tested.
- For an interpreter, the first operand (the script file) is removed from the tested text, unless its basename starts with a guarded verb. That keeps EV-100 `node /x/openspec/bin/openspec.js update` refused, and keeps `sh scripts/openspec-setup.sh` refused as documented.

New allow rows cover the reviewer's 4 examples, and each one fails without the fix. Negative controls still block: `find openspec ... -exec git add`, `fd ... -x openspec validate`, `sh scripts/openspec-setup.sh`, and `node scripts/gen-openspec.mjs git push origin main`. The existing `find . -exec git push origin main \;` row also still blocks.

### WR-01: `cwdOverride` ignores how directory overrides compose, so the protected-branch oracle reads the wrong repository

**Files modified:** `.pi/extensions/safety/shell.ts`, `.pi/extensions/safety/policy.ts`, `docs/SAFETY.md`, `tests/unit/policy-compose.test.ts`, `tests/unit/workflow-budgets.test.ts` (`why` text only)
**Commit:** f13ed87
**Applied fix:** `cwdOverride` is now built from a list of directories, in this order: earlier `cd`/`pushd` targets, then `env -C`/`sudo -D`/`--chdir`, then every `git -C`/`--git-dir`.
- `foldDirectories` combines them: a relative directory is joined onto the one before it, and an absolute one (POSIX or `X:\`) starts over.
- policy.ts resolves the result against the session cwd.
- Only git's leading global options are read as directories, so `git commit -C HEAD` no longer sends the oracle to a directory named "HEAD". That was an existing fail-open, found while making this fix.
- After a `cd`, the session cwd is checked as well, because a `cd` inside a subshell does not persist.
- If the `cd` target cannot be read as a plain directory, the branch counts as protected. This covers `popd`, a bare `cd`, `cd -`, `cd ~/x` and `cd "$D"`, so they fail closed.

New policy-compose rows cover the reviewer's examples, `git commit -C HEAD`, `cd /other && git commit`, and `cd "$REPO" && git commit`. 7 of them fail without the fix. Two rows pass without it but are kept as regression guards: the subshell `(cd /feat); git commit` and the Windows absolute `git -C 'C:\other'`. Negative controls (`cd sub && git commit` on a feature branch, `cd "$REPO" && git status`) allow. SAFETY.md now describes the fold and the `cd` rules.
**Status:** fixed: requires human verification. This is logic, and it makes one deliberate trade: with the session cwd on a protected branch, `cd <feature-worktree> && git commit` now blocks. Use `git -C <dir> commit` instead.

### IN-03: A real username and home path in SAFETY.md

**Files modified:** `docs/SAFETY.md`, `tests/fixtures/evasion-corpus.ts`
**Commit:** e16e702
**Applied fix:** The EV-27 row now reads `C:\Users\<user>\.aws\credentials`, and the mangled form reads `C:Users<user>.awscredentials`. The same string in the corpus's EV-27 `why` text now reads `<user>`. The three corpus path constants use `tester`, the fixture home, rather than `<user>`. In an unquoted bash command, `<` and `>` would be redirections and change the row's meaning. EV-27, EV-28 and EV-30 keep their verdicts. Other files that still contain the account name were outside this scope, including path-policy.test.ts and EXTENSIONS.md.

### IN-02: Remaining comment-rule violations in touched files

**Files modified:** `.pi/extensions/safety/shell.ts`, `.pi/extensions/plan-mode/read-only.ts`, `scripts/openspec-setup.sh`, `tests/unit/openspec-docs.test.ts`
**Commit:** d5b19fd
**Applied fix:**
- shell.ts: removed the references to extension-layout.test.ts and to "tests iterate it".
- read-only.ts: rewrote the curl/wget decision without "in this pass", "Phase 4", "review-fix" or SAFE-15, and cut it from 12 lines to 6.
- openspec-setup.sh: the header's rationale paragraph now points to docs/OPENSPEC.md, which already describes the throwaway project and the patching steps.
- openspec-docs test: the comment now says "the OpenSpec section". The heading string and identifiers are data and were left alone.

---

_Fixed: 2026-10-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
