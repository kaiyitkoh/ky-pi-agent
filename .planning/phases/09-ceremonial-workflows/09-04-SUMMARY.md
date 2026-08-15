---
phase: 09-ceremonial-workflows
plan: 04
subsystem: safety
tags: [glab, safety-classifier, git-policy, evasion-corpus, docs]
dependency-graph:
  requires:
    - ".pi/extensions/safety/git.ts (Phase 4 plan 05) -- classifyGlabInvocation, GitSubcommandRule, isProtected"
    - ".pi/extensions/safety/policy.ts (Phase 4 plan 07) -- the single evaluateInvocation call site"
    - ".pi/extensions/safety/index.ts -- PROTECTED_BRANCHES"
  provides:
    - "classifyGlabInvocation(invocation, protectedBranches) -- mr create conditional-allow rule, extended not bypassed"
    - "mrCreateTargetsSafeBranch / extractMrCreateTarget helpers in git.ts"
  affects:
    - "plan 09-15 (/review's MR-open step) -- the sanctioned call site this plan makes possible"
tech-stack:
  added: []
  patterns:
    - "narrow closure-scoped fact (protectedBranches) rather than widening GitPolicyFacts, when only one new fact is needed and the old independence claim must stay literally true"
key-files:
  created: []
  modified:
    - ".pi/extensions/safety/git.ts"
    - ".pi/extensions/safety/policy.ts"
    - "tests/fixtures/evasion-corpus.ts"
    - "tests/unit/git-policy.test.ts"
    - "tests/unit/policy-compose.test.ts"
    - "docs/SAFETY.md"
    - "tests/unit/workflow-budgets.test.ts"
decisions:
  - "classifyGlabInvocation grew a narrow protectedBranches: readonly string[] second parameter, not the existing GitPolicyFacts -- the currentBranch-independence claim in git.ts's module docstring stays literally true, only the destination-branch fact is new"
  - "the mr create predicate is a bespoke closure (mrCreateTargetsSafeBranch(args, protectedBranches)) rather than widening GitSubcommandRule.matches to a second parameter -- every other table row's predicate stays single-argument"
  - "the four legitimate mr create ALLOW forms are asserted in git-policy.test.ts and policy-compose.test.ts, NOT added to tests/fixtures/evasion-corpus.ts -- see Deviations"
metrics:
  duration: "~70m"
  completed: "2026-08-15"
---

# Phase 09 Plan 04: Extend classifyGlabInvocation for `glab mr create` Summary

Extended Phase 4's existing `classifyGlabInvocation` classifier with a conditional-allow rule for `glab mr create`, so a future `/review` command (plan 09-15) can open an MR without a second, ad-hoc gate. `mr create` is permitted only with an explicit, present, non-protected `--target-branch`/`-b` destination (separated or `=` form); an omitted or protected target falls through to the pre-existing fail-closed BLOCK. `mr merge` remains unconditionally blocked on every branch, and the blocked-subcommand lookup still runs before the new conditional-allow check, so a `create` predicate can never accidentally admit a `merge`.

## What Was Built

### Task 1 -- the classifier extension

- `.pi/extensions/safety/git.ts`:
  - `classifyGlabInvocation`'s signature changed to `(invocation: GitInvocation, protectedBranches: readonly string[]): GitVerdict` -- a narrow, separate parameter, not `GitPolicyFacts` (which also carries `currentBranch`), so the pre-existing "glab classification is independent of `HEAD`" claim stays literally true; only the destination-branch fact is new.
  - `extractMrCreateTarget(argsAfterCreate)` -- reads an explicit target from `--target-branch <v>` / `--target-branch=<v>` / `-b <v>`, treating a present-but-valueless flag identically to an absent one (both are the same danger: GitLab defaults an omitted target to the project default branch).
  - `mrCreateTargetsSafeBranch(args, protectedBranches)` -- the whole predicate: `true` only for an explicit, present target that does not match any `protectedBranches` entry case-insensitively (mirroring `isProtected`'s own comparison at `git.ts:333-335`). Built as a closure over `protectedBranches` rather than widening `GitSubcommandRule.matches` to a second parameter -- every other table row's predicate is untouched.
  - `classifyGlabInvocation`'s resolution order: blocked-subcommand table first (unchanged), then read-subcommand table (unchanged), then the new `mr create` conditional-allow check (only reached when subcommand is `"mr"` and `args[0] === "create"`), then the pre-existing fail-closed default. The block reason on the `mr create` fail path distinguishes "no explicit target" from "explicit but protected target" for a more actionable message.
  - Both the module docstring (`WHY glab mr merge IS SEPARATE...`) and `classifyGlabInvocation`'s own docstring were amended to state the distinction explicitly: independence from `currentBranch` is unchanged, dependence on the invocation's own destination branch is new.
- `.pi/extensions/safety/policy.ts`: the single call site (`evaluateInvocation`'s `glab` branch) now passes `facts.protectedBranches`, with a two-line comment explaining why (mr create's rule, not currentBranch).
- `tests/unit/git-policy.test.ts`: the glab call site (`facts(row.currentBranch).protectedBranches`, reusing the existing `facts()` helper rather than a second hardcoded list) updated for the new signature -- required for `tsc --noEmit` to pass; the row additions for the new behaviour landed in Task 2.
- `tests/unit/workflow-budgets.test.ts`: `.pi/extensions/safety`'s `DIRECTORY_BUDGETS` entry raised 4460 -> 4570 (re-measured 4,569 raw lines across the same 9 files: git.ts 621, policy.ts 664, seven others unchanged).

**Call-site enumeration** (`git grep -n "classifyGlabInvocation(" -- .pi/ tests/`):
```
.pi/extensions/safety/git.ts:540:export function classifyGlabInvocation(invocation: GitInvocation, protectedBranches: readonly string[]): GitVerdict {
.pi/extensions/safety/policy.ts:366:			fromGitVerdict(classifyGlabInvocation(toGitInvocation(invocation), facts.protectedBranches)),
tests/unit/git-policy.test.ts:168:						: classifyGlabInvocation(inv, facts(row.currentBranch).protectedBranches);
```
Exactly one production call site (`policy.ts`), as required.

### Task 2 -- corpus, doc and composition-order coverage

- `tests/unit/git-policy.test.ts`: 9 new rows in the glab section -- 4 allow forms (`--target-branch staging`, `--target-branch=staging`, `-b staging`, and one with unrelated flags interleaved before and after the target flag), 4 block forms (no target, `main`, `MAIN`, `master`), and `mr merge --target-branch staging` (still blocked, proving the blocked-table wins).
- `tests/unit/policy-compose.test.ts`: two new rows proving the composition order through the real composed `evaluate()`, not the classifier directly -- `glab mr create --target-branch staging` resolves to `allow`, `glab mr merge --target-branch staging` still resolves to `block`.
- `tests/fixtures/evasion-corpus.ts`: EV-75..EV-79 -- the four `BLOCKED` destination forms (no target, `--target-branch main`, `--target-branch MAIN`, `-b main`) plus EV-79, a `nested-shell`-class indirection row (`sh -c "glab mr create --target-branch staging"`) proving the shell-runner rule denies the whole invocation outright, before it ever reaches `classifyGlabInvocation`'s own target check -- because `glab` is already in `shell.ts`'s `GUARDED_VERB_PATTERN`.
- `docs/SAFETY.md`: the "What the guard does catch" git/glab prose bullet extended with a paragraph describing the new `mr create` conditional allow.

## Deviations from Plan

### Auto-fixed / judgment-applied deviations

**1. [Rule 1 -- correctness] The four `mr create` ALLOW forms were NOT added to `tests/fixtures/evasion-corpus.ts`, despite the plan's acceptance criteria naming "4 allow" rows there.**
- **Found during:** Task 2, before writing the corpus rows.
- **Issue:** `tests/fixtures/evasion-corpus.ts`'s own `EvasionExpectation` type is a closed two-value union (`"BLOCKED" | "OUT-OF-SCOPE"`), and `tests/unit/evasion-corpus.test.ts`'s Group C explicitly asserts "every expect value is exactly BLOCKED or OUT-OF-SCOPE -- no third bucket". `OUT-OF-SCOPE` has a specific, load-bearing meaning in this corpus: "a published LIMIT this guard does not catch" -- Group A' asserts the row genuinely evaluates to `allow` (i.e., the guard fails to stop it) AND Group B requires every such row to appear in `docs/SAFETY.md`'s "Known bypasses this guard does not catch" table. Filing `glab mr create --target-branch staging` there would assert something false: that opening an MR against an explicit, non-protected branch is a bypass this guard fails to stop, when it is precisely the intended, by-design behaviour this plan built. `docs/SAFETY.md`'s own "Authority" section states a stale claim there "is not a documentation nit, it is a false sense of security" -- the same reasoning forbids introducing a false one.
- **Fix:** The four allow forms are instead asserted in `tests/unit/git-policy.test.ts` (the classifier's own fixture table, which has a native `allow` verdict shape) and `tests/unit/policy-compose.test.ts` (the composed evaluator, same shape) -- both files the plan already names for exactly this extension. `tests/fixtures/evasion-corpus.ts` instead carries the 4 block forms plus 1 indirection form (5 new rows, not 9), all of which DO fit the corpus's BLOCKED bucket cleanly (driven through the real `evaluate()`, asserted `not allow`).
- **Files affected:** `tests/fixtures/evasion-corpus.ts` (inline comment explaining the omission, at the top of the new section), `tests/unit/git-policy.test.ts`, `tests/unit/policy-compose.test.ts`.
- **Commit:** `fc4414b`.

**2. [Rule 1 -- plan-text correction] Task 2's acceptance criteria named `tests/unit/docs-policy.test.ts` as the mechanism that derives `docs/SAFETY.md`'s "Known bypasses" table from the corpus, in both directions. It is not.**
- **Found during:** Task 2, before running the two required doc-derivation falsifications.
- **Issue:** `docs-policy.test.ts` contains exactly one mention of `docs/SAFETY.md`, a citation in a comment ("per docs/SAFETY.md's own corpus-derived-limits discipline") -- it asserts nothing about that file. The actual two-directional derivation (row count DERIVED from `EVASION_CORPUS.filter(c => c.expect === "OUT-OF-SCOPE").length`, and the converse -- the doc cannot hold an id the corpus does not know about) lives entirely in `tests/unit/evasion-corpus.test.ts`'s Group B.
- **Fix:** Ran `npx vitest run tests/unit/docs-policy.test.ts` as the plan's acceptance criteria literally states (green, unaffected by this plan's changes -- it governs a different document's derivation, `docs/DIAGNOSTICS.md`'s redaction section), AND ran the two required falsifications against the mechanism that actually implements this for `docs/SAFETY.md` -- `tests/unit/evasion-corpus.test.ts`'s Group B. Both falsifications recorded below are from that file.
- **Commit:** no code change required; recorded here as a plan-text correction for future readers.

## Falsifications (verbatim)

**Task 1, falsification 1 -- case-sensitive target comparison** (mutated `mrCreateTargetsSafeBranch`'s `b.toLowerCase() === target.toLowerCase()` to `b === target`, ran `tests/unit/git-policy.test.ts`, restored):
```
FAIL  tests/unit/git-policy.test.ts > SAFE-04/SAFE-05 -- classifyGitInvocation / classifyGlabInvocation over the table > glab mr create --target-branch MAIN on "main" -> block (case-insensitive match against protected branch names, mirroring isProtected)
AssertionError: expected block for "glab mr create --target-branch MAIN" on "main", got allow: expected 'allow' to be 'block' // Object.is equality

Expected: "block"
Received: "allow"
```

**Task 1, falsification 2 -- missing-target returns `true`** (mutated the `target === undefined` branch to `return true`, ran `tests/unit/git-policy.test.ts`, restored):
```
FAIL  tests/unit/git-policy.test.ts > SAFE-04/SAFE-05 -- classifyGitInvocation / classifyGlabInvocation over the table > glab mr create on "main" -> block (no explicit target -- GitLab defaults an omitted target to the project default branch, so silence is the deploy trigger)
AssertionError: expected block for "glab mr create" on "main", got allow: expected 'allow' to be 'block' // Object.is equality

Expected: "block"
```

**Task 2, falsification 1 -- deleted one corpus OUT-OF-SCOPE row's id (EV-74) without touching `docs/SAFETY.md`**, ran `tests/unit/evasion-corpus.test.ts`, restored:
```
FAIL  tests/unit/evasion-corpus.test.ts > Group B -- the OUT-OF-SCOPE bucket matches docs/SAFETY.md, in both directions > every OUT-OF-SCOPE row's id and class appear in the table
AssertionError: EV-74-DELETED-FOR-FALSIFICATION is tagged OUT-OF-SCOPE in the corpus but its id is missing from docs/SAFETY.md's table: expected '## Known bypasses this guard does not…' to contain 'EV-74-DELETED-FOR-FALSIFICATION'

FAIL  tests/unit/evasion-corpus.test.ts > Group B -- the OUT-OF-SCOPE bucket matches docs/SAFETY.md, in both directions > the table holds no row id the corpus does not know about (the converse)
AssertionError: docs/SAFETY.md's table has a row for "EV-74", but no corpus entry with that id is tagged OUT-OF-SCOPE -- the doc has grown a limit the corpus does not know about: expected false to be true // Object.is equality
```

**Task 2, falsification 2 -- added a fabricated `EV-999` row to `docs/SAFETY.md`'s table with no backing corpus entry**, ran `tests/unit/evasion-corpus.test.ts`, restored:
```
FAIL  tests/unit/evasion-corpus.test.ts > Group B -- the OUT-OF-SCOPE bucket matches docs/SAFETY.md, in both directions > the table's row count is DERIVED from the corpus, never a hand-typed number
AssertionError: docs/SAFETY.md's 'Known bypasses' table must carry exactly one row per OUT-OF-SCOPE corpus entry (14, computed from EVASION_CORPUS.filter(...).length at test time -- never transcribed), following the truncationCauseCount() discipline in docs-policy.test.ts: expected 15 to be 14 // Object.is equality

FAIL  tests/unit/evasion-corpus.test.ts > Group B -- the OUT-OF-SCOPE bucket matches docs/SAFETY.md, in both directions > the table holds no row id the corpus does not know about (the converse)
AssertionError: docs/SAFETY.md's table has a row for "EV-999", but no corpus entry with that id is tagged OUT-OF-SCOPE -- the doc has grown a limit the corpus does not know about: expected false to be true // Object.is equality
```

All four mutations were restored immediately after capturing the failure, verified by a clean `git diff --stat` (no residual diff) and a subsequent full green run.

## Verification

- `npx tsc --noEmit` clean.
- `npx vitest run` -- full suite green: **109 test files, 2086 tests passed**.
- `git grep -n "glab" -- .pi/extensions/ | grep -v safety/` -- one hit, a comment in `plan-mode/read-only.ts` naming `glab` as one of the guarded-verb-pattern verbs; no second classification site.
- No real `glab` invocation was made anywhere in this plan's execution or tests -- every assertion drives the pure classifier or the composed `evaluate()` with fixture facts, never a subprocess.

## Requirements

`FLOW-08` is **advanced, not completed** by this plan, per the plan's own objective statement: FLOW-08 also needs `REVIEW.md`, the scope-drift check and the `/review` command itself (later plans in this phase), so `requirements mark-complete` was deliberately NOT called for `FLOW-08` here -- calling it would falsely mark the requirement done. REQUIREMENTS.md is left as the next plan (or the phase's own closing plan) will find it.

## Next Phase Readiness

Plan 09-15 (`/review`'s MR-open step) can now call `classifyGlabInvocation(invocation, PROTECTED_BRANCHES)` directly before its `glab mr create` exec, exactly as its own `<read_first>` already names (`git.ts:449-466 as EXTENDED by 09-04`). No further classifier work is needed for that plan to open an MR against an explicit non-protected target; `RB-09-02` (the live `glab mr create` against the real work GitLab) remains OUTSTANDING by design -- this machine never invokes `glab` for real.

## Self-Check: PASSED

- `.pi/extensions/safety/git.ts` -- FOUND, contains `mrCreateTargetsSafeBranch` and the updated `classifyGlabInvocation` signature.
- `.pi/extensions/safety/policy.ts` -- FOUND, passes `facts.protectedBranches` at the one call site.
- `tests/fixtures/evasion-corpus.ts` -- FOUND, contains EV-75..EV-79.
- `tests/unit/git-policy.test.ts` -- FOUND, contains the 9 new glab rows.
- `tests/unit/policy-compose.test.ts` -- FOUND, contains the 2 new composed-evaluator rows.
- `docs/SAFETY.md` -- FOUND, contains the `mr create` prose paragraph.
- Commit `4c2f140` -- FOUND in `git log --oneline`.
- Commit `fc4414b` -- FOUND in `git log --oneline`.
