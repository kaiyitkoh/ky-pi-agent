---
phase: 04-safety-deployment-guardrails
plan: 03
subsystem: safety
tags: [unbash, ast-parsing, bash-guard, node-type-deny-list, wrapper-resolution]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "unbash@4.0.10 pinned as a governed runtime dependency, and the executed AST node-type/operator vocabulary (Plan 01, tests/unit/unbash-ast.test.ts) this plan's deny predicate is written against, including the Word.value/Word.parts self-memoizing-getter trap"
provides:
  - "canonicalise() in .pi/extensions/safety/shell.ts: a pure, recursive unbash AST walk that fails closed on command substitution, process substitution, arithmetic-command-expansion, heredoc/herestring redirects, backgrounded statements and unresolved expansions in a policy-relevant command position"
  - "wrapper resolution (sudo/env/nohup/nice/stdbuf/command/... ) to a canonical {executable, args, wrappers, rawSegment, cwdOverride?} invocation, with the sudo -u / env -C option-grammar regressions pinned by fixture"
  - "shell-runner denial: a resolved sh/bash/zsh/xargs/... executable whose raw segment text contains a guarded verb (git/glab/terraform/aws/kubectl) is refused outright, never routed to approval"
  - "git -C / --git-dir captured as cwdOverride, for a later plan's HEAD==main oracle to evaluate the invocation's actual target repository, not the harness's cwd"
  - "two explicit out-of-scope corpus rows (task-runner indirection, PATH shadowing) feeding SAFE-15's published limits table"
affects: [04-04, 04-05, 04-06, 04-09, 04-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "node-type presence deny-list over a tolerant parser's AST, never an errors.length check (SAFE-03's central finding, executed and reproduced from Plan 01)"
    - "position-sensitive expansion refusal: Command.name is always checked; a guarded verb's suffix[] arguments are additionally checked, because the plan's own worked example places the unresolved variable in the subcommand position, not argv[0]"
    - "tabulated (not derived) wrapper option grammars, keyed by exact flag string, to avoid the sudo -u -> executable 'root' failure mode"
    - "deny-outright substring containment over raw segment text for shell-runner + guarded-verb combinations, deliberately not a recursive re-parse"

key-files:
  created:
    - .pi/extensions/safety/shell.ts
    - tests/unit/shell-deny-list.test.ts
    - tests/unit/shell-parse.test.ts
  modified: []

key-decisions:
  - "Reused this plan's own <behavior> worked example (g=push; git $g origin main) to derive the ACTUAL position-sensitivity rule by execution: Command.name is 'git' (literal), the unresolved $g sits in suffix[0]. The predicate therefore checks Command.name unconditionally AND checks every suffix word when Command.name is a literal match for the guarded-verb pattern -- not argv[0] alone, which the plan's prose ('command-name word') would have implied and which would have let the example itself through."
  - "Replaced the plan's literal git $((1+1)) fixture with echo $(( $(echo 1) )) for the arithmetic-command-expansion test row: executed against unbash 4.0.10, git $((1+1)) produces ArithmeticExpansion/ArithmeticBinary, never ArithmeticCommandExpansion -- that node type only appears when a command substitution is nested inside an arithmetic expansion."
  - "'time git push' resolves to wrappers: [] rather than ['time']: unbash parses bash's 'time' as a genuine Pipeline.time === true keyword, not a literal command word -- the Command node it hands back is already just 'git push'. PASSTHROUGH_WRAPPERS still lists 'time' for defence-in-depth against a quoted/aliased literal, but it is dead code for this exact fixture."
  - "SHELL_REFUSAL_CAUSES is a single exported runtime array (not just a TS union) so both test files can mechanically assert every cause is reachable by at least one fixture; shell-deny-list.test.ts's coverage check is scoped to exclude 'shell-runner', which only exists after Task 2's wrapper resolution and is covered by shell-parse.test.ts instead."

requirements-completed: [SAFE-02, SAFE-03]

# Metrics
duration: 20min
completed: 2026-08-14
---

# Phase 4 Plan 3: unbash AST Deny Predicate and Wrapper Resolution Summary

**A pure, recursive `unbash` AST walk in `.pi/extensions/safety/shell.ts` that fails closed on six adversarial node classes by node-TYPE presence (never `errors.length`), then resolves `sudo`/`env`/`nohup`/shell-runner indirection to a canonical `{executable, args, wrappers, cwdOverride?}` invocation — closing SAFE-02 and SAFE-03 with 42 mutation-verified tests.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-13T19:55:00Z (approx, from prior commit)
- **Completed:** 2026-08-13T20:15:36Z
- **Tasks:** 2 completed
- **Files modified:** 3 (3 created, 0 modified — `shell-deny-list.test.ts` was created in Task 1 and extended in Task 2)

## Accomplishments

- `canonicalise()` implements SAFE-03's central finding as executable code: a recursive walk over the whole `unbash` `Script` (not just the top level) that refuses on the PRESENCE of `CommandExpansion`, `ProcessSubstitution`, `ArithmeticCommandExpansion`, `<<`/`<<-`/`<<<` redirect operators, `Statement.background === true`, or an unresolved `SimpleExpansion`/`ParameterExpansion` in a policy-relevant command position — `errors.length > 0` is kept only as a final catch-all (`cause: "parse-error"`), never the primary mechanism.
- Wrapper resolution (`resolveWrappers()`) tabulates `env`/`sudo` boolean vs. value-taking flag grammars and closes the Pitfall-2 regression by fixture: `sudo -u root git push` resolves to executable `git`, not `root`. `git -C`/`--git-dir` (both split and packed forms) is captured as `cwdOverride`, taking precedence over an `env -C` wrapper directory.
- Shell-runner denial (`findShellRunnerDenial()`) refuses `sh -c "git push"`, `bash -lc "git push"` and `xargs git push` outright — never routed to approval, per SAFE-03's fail-closed contract — while the paired negative control `sh -c "ls"` is correctly NOT refused, proving the predicate keys on the guarded-verb pattern, not "any shell runner."
- 42 table-driven tests across `shell-deny-list.test.ts` (19) and `shell-parse.test.ts` (23), every REFUSED/NOT-REFUSED row and cause-reachability guard mutation-verified by deliberately neutering the subject function, observing the expected tests go red, and restoring.
- Two explicit out-of-scope corpus rows (`npm run deploy`/`make deploy` task-runner indirection, PATH-shadowed `git`) recorded with a `why` naming SAFE-15, feeding the published limits table a later plan writes.

## Task Commits

1. **Task 1: The fail-closed node-type deny predicate (SAFE-03)** - `59fc79f` (feat)
2. **Task 2: Wrapper resolution to a canonical invocation (SAFE-02)** - `774a9d2` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/extensions/safety/shell.ts` (new, 708 lines) - `canonicalise()`, the node-type deny predicate, wrapper resolution, and every export the plan's artifact contract names (`canonicalise`, `DENIED_PART_TYPES`, `HEREDOC_OPERATORS`, `SHELL_RUNNERS`, `GUARDED_VERB_PATTERN`), plus `SHELL_REFUSAL_CAUSES`/`ShellRefusalCause`/`CanonicalInvocation`/`ShellVerdict` for the tests and a future policy module to import
- `tests/unit/shell-deny-list.test.ts` (new, 217 lines) - 19 tests: the SAFE-03 deny-list table (6 REFUSED classes + 3 NOT-REFUSED classes + 3 extra regression rows), cause-reachability guard, DENIED_PART_TYPES/HEREDOC_OPERATORS vocabulary assertions
- `tests/unit/shell-parse.test.ts` (new, 280 lines) - 23 tests: the SAFE-02 wrapper-resolution table (10 wrapper rows + 3 out-of-scope rows + 1 negative-cwdOverride guard per row) and the shell-runner denial table (3 refused + 2 not-refused, including the pipeline false-positive corpus row for Plan 11)

## Decisions Made

See `key-decisions` in frontmatter. In summary: two of the plan's own literal fixture examples (`git $((1+1))` for arithmetic-command-expansion, and a strict "command-name word" reading for the unresolved-expansion rule) did not match what `unbash` actually produces when executed, so the test fixtures and the predicate's scope were built against the executed AST instead, per CLAUDE.md's "verify at source, not docs" and this plan's own `read_first` instruction to prefer `tests/unit/unbash-ast.test.ts`'s executed spellings over `04-RESEARCH.md`'s prose when they disagree.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the arithmetic-command-expansion test fixture**

- **Found during:** Task 1, while writing `shell-deny-list.test.ts`
- **Issue:** The plan's `<behavior>` names `git $((1+1))` as producing an "arithmetic command expansion" that must be refused. Executed against `unbash@4.0.10`, `git $((1+1))` parses to `ArithmeticExpansion`/`ArithmeticBinary`/`ArithmeticWord` — none of which is `ArithmeticCommandExpansion`, the node type `DENIED_PART_TYPES` actually names. That node type only appears when a command substitution is nested INSIDE an arithmetic expansion.
- **Fix:** Used `echo $(( $(echo 1) ))` instead — the exact fixture `tests/unit/unbash-ast.test.ts` (Plan 01) already proved produces `ArithmeticCommandExpansion` by execution. `DENIED_PART_TYPES` and the deny predicate are unaffected; only the test fixture changed.
- **Files modified:** `tests/unit/shell-deny-list.test.ts`
- **Verification:** The row passes; mutation-tested by neutering `detectDeniedPartType()` and confirming the row (among others) goes red, then restoring.
- **Committed in:** `59fc79f` (Task 1 commit)

**2. [Rule 1 - Bug] Widened the unresolved-expansion-in-command-position rule beyond `Command.name` alone**

- **Found during:** Task 1, while writing `shell-deny-list.test.ts`
- **Issue:** The plan's `<behavior>` describes the rule as firing "when it appears in the command-name word," and gives `g=push; git $g origin main` as the example. Executed against `unbash`, `Command.name` for this fixture is the literal word `"git"` (no parts at all); the unresolved `$g` sits in `suffix[0]` — the git subcommand position. A predicate that checked only `Command.name` would let the plan's own worked example through.
- **Fix:** Implemented the rule as: refuse an unresolved expansion in `Command.name` unconditionally, AND refuse an unresolved expansion anywhere in `suffix[]` when `Command.name` is a literal (no expansion of its own) match for the guarded-verb pattern (`git`/`glab`/`terraform`/`aws`/`kubectl`). `echo "$HOME"` remains NOT refused because `echo` is not a guarded verb.
- **Files modified:** `.pi/extensions/safety/shell.ts` (implementation), `tests/unit/shell-deny-list.test.ts` (added a second row, `CMD=git; $CMD push`, to separately cover the argv[0]-is-dynamic case)
- **Verification:** Both rows pass; mutation-tested by neutering `hasUnresolvedExpansionInCommandPosition()` and confirming both rows go red, then restoring.
- **Committed in:** `59fc79f` (Task 1 commit)

**3. [Rule 1 - Bug] Corrected the `time git push` wrapper-resolution expectation**

- **Found during:** Task 2, while writing `shell-parse.test.ts`
- **Issue:** Drafted the test expecting `wrappers: ["time"]` for `time git push`, mirroring the other bare pass-through wrappers. Executed against `unbash`, `time` parses as a genuine `Pipeline.time === true` structural keyword — the `Command` node returned already contains just `git push`, with no `"time"` word present anywhere for `resolveWrappers()` to consume.
- **Fix:** Changed the expectation to `wrappers: []` with a comment explaining unbash's keyword handling. `PASSBTHROUGH_WRAPPERS` still lists `"time"` (harmless, defends a quoted/aliased literal `"time"` if one were ever constructed), but this exact fixture never exercises that branch.
- **Files modified:** `tests/unit/shell-parse.test.ts`
- **Verification:** All 23 rows in the wrapper table pass; re-ran the full 42-test pair after the fix.
- **Committed in:** `774a9d2` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs, all in test-fixture correctness or rule scope, discovered by executing `unbash` directly rather than trusting the plan's prose)
**Impact on plan:** All three fixes make the guard MORE correct than a literal reading of the plan would have produced — in particular, deviation 2 closes a real gap (the plan's own adversarial example would have passed the predicate under a naive `Command.name`-only reading). No scope creep: every fix stayed inside the two files it was found in and is documented in both the test file's own comments and here.

## Issues Encountered

None beyond the deviations above, each resolved within the task it was found in before that task's commit.

## User Setup Required

None — no external service configuration required. This plan adds no new dependency; `unbash@4.0.10` was already pinned and governed by Plan 01.

## Next Phase Readiness

- Plan 04 (policy: `HEAD==main`, `glab mr merge`, terraform/aws/kubectl classification) can now import `canonicalise()` and consume `CanonicalInvocation.{executable, args, cwdOverride}` directly, including the `-C`-resolved repository for its `HEAD == main` oracle.
- Plan 09 (the `tool_call` hook / wrapped-tool enforcement) and Plan 06 (the non-bash write/edit path) both depend on this module being pure (no `ctx`, no I/O) — confirmed: the only import is `parse`/AST types from `unbash`.
- `SHELL_REFUSAL_CAUSES` and `ShellRefusalCause` are exported as a single runtime-checkable source of truth; any later plan adding a new refusal cause should extend that array and follow the same cause-reachability-guard pattern established in `shell-deny-list.test.ts`/`shell-parse.test.ts`.
- No blockers. `npm test` is green at 737/737 (up from 685 recorded at the end of Plan 01; the delta reflects this plan's 42 new tests plus Plan 02's audit-writer tests already landed), `tsc --noEmit` clean.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: .pi/extensions/safety/shell.ts
- FOUND: tests/unit/shell-deny-list.test.ts
- FOUND: tests/unit/shell-parse.test.ts
- FOUND: commit 59fc79f (Task 1)
- FOUND: commit 774a9d2 (Task 2)
