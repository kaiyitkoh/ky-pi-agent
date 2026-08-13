---
phase: 04-safety-deployment-guardrails
plan: 05
subsystem: safety
tags: [git, glab, head-oracle, per-subcommand-table, fail-closed]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "canonicalise() / CanonicalInvocation in .pi/extensions/safety/shell.ts (Plan 03) -- the cwdOverride shape this plan's HEAD oracle contract assumes a later caller will resolve"
provides:
  - "classifyGitInvocation() in .pi/extensions/safety/git.ts: a two-step evaluation -- HEAD==protected (via the currentBranch oracle) AND a per-subcommand write/read predicate table -- denying only when both hold"
  - "GIT_WRITE_SUBCOMMANDS / GIT_READ_SUBCOMMANDS: explicit per-subcommand predicate tables, with rebase and apply carrying complementary write/read predicates over their own argv rather than a static label"
  - "currentBranch(cwd): the impure HEAD oracle, git symbolic-ref --short HEAD via spawnSync({shell:false}), returning the distinct DETACHED_HEAD sentinel (never undefined) on a non-zero exit"
  - "classifyGlabInvocation(): glab mr merge blocked unconditionally on every branch (the deploy trigger), mr list/view and ci status allowed, unknown forms fail closed"
  - "tests/integration/git-head-main.test.ts: the first test in this repo driving a real, mutable, disposable git checkout as its subject (every prior git helper only asks git ABOUT this repository)"
affects: [04-09, 04-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "two-step branch-protection evaluation: HEAD-is-protected and command-is-a-write are independent questions, combined by AND, never conflated into a single 'mentions main' string check (04-RESEARCH.md Pitfall 5)"
    - "per-subcommand predicate tables (GitSubcommandRule[]) rather than a boolean or a flat name set -- a subcommand may legitimately appear in BOTH the write and read tables with complementary predicates (rebase: bare vs. named-target; apply: writes-the-tree vs. --check/--stat/--numstat dry run)"
    - "fail-closed resolution order: write-match blocks, read-match allows, a known-but-unmatched argument shape blocks, and a wholly unknown subcommand blocks -- the same posture shell.ts's node-type deny predicate established for SAFE-03"
    - "purity split mirrored from shell.ts/paths.ts: the classifier functions take a plain invocation + facts object and never spawn a subprocess; currentBranch is the one deliberately impure export, isolated so the pure half stays a millisecond fixture table"

key-files:
  created:
    - .pi/extensions/safety/git.ts
    - tests/unit/git-policy.test.ts
    - tests/integration/git-head-main.test.ts
  modified: []

key-decisions:
  - "worktree add is unconditionally allowed whether or not -b/-B is present -- the plan named this as Claude's discretion to pin one answer either way; pinned ALLOW, since neither form mutates the named ref, it only reads it to populate a second working directory (matches the plan's own stated recommendation)"
  - "apply carries complementary write/read predicates (writes the tree unless --check/--stat/--numstat) rather than being classified as an unconditional write, since a dry-run apply genuinely does not touch the checked-out branch"
  - "stash's read-table entry is scoped to exactly the 'list' form; bare 'git stash'/'stash pop'/'stash apply' fall through the fail-closed default (block on a protected branch) rather than being given their own predicate, since the plan's <behavior> only names 'stash list' as a required allow case"
  - "DETACHED_HEAD is a named string sentinel ('(detached HEAD)'), not the commit sha and not undefined -- a sha would work too, but a fixed sentinel is simpler to compare and the plan only requires the value be distinct and named, not informative"

requirements-completed: [SAFE-04, SAFE-05]

# Metrics
duration: 25min
completed: 2026-08-14
---

# Phase 4 Plan 5: Git/glab Two-Step Branch-Protection Policy Summary

**A two-step git write/read classifier in `.pi/extensions/safety/git.ts` that denies a command only when `HEAD` is currently the protected branch AND the subcommand writes to it -- keeping `git worktree add -b feat main`, `fetch`, `diff`, `log` and `rebase <other>` working on `main` while blocking `push`/`commit`/`reset --hard`/`merge` there, plus an unconditional `glab mr merge` block on every branch -- proven by 52 tests including a real disposable git checkout with an executed `worktree add`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-14T04:39:00Z (approx, from first vitest run)
- **Completed:** 2026-08-14T04:44:30Z
- **Tasks:** 2 completed
- **Files modified:** 3 (all new)

## Accomplishments

- `classifyGitInvocation()` implements the two-step evaluation Pitfall 5 requires: `isProtected(facts)` (a pure branch-name comparison) gates a per-subcommand predicate-table lookup, denying only when both hold. Non-protected branches allow every subcommand unconditionally, which is what makes the `git push` paired flip (block on `main`, allow on `feature/x`) a genuine measurement rather than a hardcoded label.
- `GIT_WRITE_SUBCOMMANDS`/`GIT_READ_SUBCOMMANDS` are per-subcommand predicate tables, not booleans: `rebase` and `apply` each carry complementary write/read predicates over their own argument list (bare rebase vs. a named other-ref target; `apply` writing the tree vs. `--check`/`--stat`/`--numstat` making it a dry run) — matching `04-RESEARCH.md` Open Question 3's explicit instruction to build a table, not a flat name set.
- Every escape-hatch command named in the plan's `<behavior>` is a NAMED allow row in `tests/unit/git-policy.test.ts` — `git worktree add -b feat main`, `git fetch origin main`, `git diff main`, `git log origin/main`, `git rebase feature` — closing Pitfall 5's exact warning ("this must be a named allow-case, not merely absent from the deny-list").
- Unknown git subcommands and known-subcommand-but-unmatched argument shapes (e.g. `git stash pop`) both fail closed to block, with a reason naming the subcommand or shape as unclassified — the same posture `shell.ts`'s SAFE-03 deny predicate already established.
- `classifyGlabInvocation()` blocks `mr merge` (bare, with an IID, with `--auto-merge`) unconditionally on every branch, since the merge itself is the deploy trigger in the user's work repo (decision 13); `mr list`/`mr view`/`ci status` stay allowed so the harness remains usable for orientation.
- `currentBranch(cwd)` is the one impure export: `spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { shell: false })`, returning the trimmed branch name on exit 0 and the distinct `DETACHED_HEAD` sentinel (never `undefined`, never `""`) on any non-zero exit.
- `tests/integration/git-head-main.test.ts` is the first test in this repository to drive a real, mutable, disposable git checkout as its subject. It proves the paired flip on one fixture (`main` → block, `feature/x` → allow), a distinct detached-HEAD value, a two-repository `cwdOverride` case (proving the oracle honours whichever `cwd` it is given rather than the harness's ambient `process.cwd()`), and executes `git worktree add -b feat main` for real (exit 0) before classifying that exact invocation as allow.
- Every mutation-tested claim in the autonomous run rules was verified directly: the branch-protection gate, the HEAD oracle's success-path return, and both the glab block rule and the glab read rule were each broken in turn, confirmed the relevant test rows/cases went red, then restored — `git.ts` is byte-identical to its committed form (`git diff` empty) after the mutation round.

## Task Commits

1. **Task 1a: RED — failing test for git/glab per-subcommand policy table** - `ad5709c` (test)
2. **Task 1b: GREEN — per-subcommand git write/read table and glab rule (SAFE-04, SAFE-05)** - `81ca5d7` (feat)
3. **Task 2: prove the HEAD oracle against a real disposable git checkout** - `a4020bd` (test)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/extensions/safety/git.ts` (new, 358 lines) — `currentBranch`, `classifyGitInvocation`, `classifyGlabInvocation`, `GIT_WRITE_SUBCOMMANDS`, `GIT_READ_SUBCOMMANDS`, plus `GitInvocation`/`GitPolicyFacts`/`GitVerdict`/`DETACHED_HEAD` for callers and tests
- `tests/unit/git-policy.test.ts` (new, 177 lines) — 47 tests: a 32-row `{command, currentBranch, expected, why}` table covering every named block/allow case in `<behavior>` plus the paired flip and the glab unconditional-block cases, a liveness guard over both subcommand tables, and DETACHED_HEAD/currentBranch export-shape checks
- `tests/integration/git-head-main.test.ts` (new, 207 lines) — 5 tests against a real `mkdtempSync` repository: on-`main` block, checkout-to-`feature/x` allow flip, detached-HEAD distinct value, two-repository `cwdOverride` proof, and a real executed `git worktree add -b feat main`

## Decisions Made

See `key-decisions` in frontmatter. In summary: `worktree add` was pinned to unconditional allow (the plan's own stated recommendation for the without-`-b` case); `apply` was given a genuine read predicate for its dry-run flags rather than being left an unconditional write; `stash` was scoped narrowly to its named `list` form only, since the plan's `<behavior>` names no other stash form as required.

## Deviations from Plan

None — plan executed exactly as written. The plan's own text explicitly left the `worktree add` without-`-b` case and the exact `apply`/`stash` argument boundaries to "Claude's discretion... pin one answer either way" and "decide and pin one answer", which are documented above as decisions, not deviations.

## Issues Encountered

None. Both tasks passed on first implementation after the TDD RED gate; the mutation-testing pass (autonomous run rule 6) surfaced one non-issue worth recording: mutating the `mr merge` block predicate alone did not turn any test row green, because `classifyGlabInvocation`'s fail-closed default absorbed it (still `block`, via the "unclassified" path rather than the named rule). This is not a masking bug — the security property (mr merge always blocks) held throughout — but it meant the first mutation needed to also loosen the `mr` read predicate before the test suite visibly caught the regression. Both mutations were reverted; `git diff` against the committed file is empty.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 09 (the `tool_call` hook / wrapped-tool enforcement) can now import `classifyGitInvocation`/`classifyGlabInvocation` directly, feeding them `shell.ts`'s `CanonicalInvocation.args` (split into subcommand + rest) and a `currentBranch(cwdOverride ?? ctx.cwd)` call for the facts object.
- Plan 11's evasion corpus (SAFE-17) can draw both the deny table (git writes on `main`, `glab mr merge`) and the allow table (the worktree/fetch/diff/log/rebase escape hatches) directly from `tests/unit/git-policy.test.ts`'s 32 rows.
- `npm test` is green at 846/846 (up from ~792 before this plan, reflecting this plan's 52 new tests), `tsc --noEmit` clean.
- No blockers.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: .pi/extensions/safety/git.ts
- FOUND: tests/unit/git-policy.test.ts
- FOUND: tests/integration/git-head-main.test.ts
- FOUND: commit ad5709c (Task 1 RED)
- FOUND: commit 81ca5d7 (Task 1 GREEN)
- FOUND: commit a4020bd (Task 2)
