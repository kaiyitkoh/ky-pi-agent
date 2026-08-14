---
phase: 07-composed-extensions-pinned-reviewed
plan: 05
subsystem: testing
tags: [git-worktree, junction, windows, subagents, ext-02, roadmap-criterion-4]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    provides: "tests/helpers/worktree.ts and .pi/scripts/worktree-setup-hook.mjs (07-02) — the fixture helper and shipped hook this plan's decisive proof exercises"
provides:
  - "tests/integration/worktree-build.test.ts — the decisive EXT-02/ROADMAP-criterion-4 proof: a fresh git worktree provably CANNOT build (real node_modules/.env untracked-file gap, real spawnSync failure with a module-not-found message), and the shipped .pi/scripts/worktree-setup-hook.mjs provably fixes it (real subprocess spawn, real WorktreeSetupHookInput payload, real positive re-build)"
  - "Direct, executed measurement on this machine that fs.symlinkSync(target, link, \"junction\") succeeds unconditionally while the unqualified two-argument form fails EPERM — reported, not asserted universally"
  - "A source-level regression guard against the shipped hook regressing to pi-subagents' own unqualified-symlinkSync defect, falsified before commit"
  - "docs/EXTENSIONS.md's Worktree isolation section updated with the re-measured outcomes and the falsification result"
affects: []

tech-stack:
  added: []
  patterns: ["Negative-proof-before-remedy on one fixture (tests/unit/npmrc-policy.test.ts Group B's idiom), applied to a real git worktree instead of a real npm install", "Measure environment-dependent behaviour and report it rather than asserting a specific universal outcome"]

key-files:
  created: [tests/integration/worktree-build.test.ts]
  modified: [docs/EXTENSIONS.md]

key-decisions:
  - "The whole ten-step Pattern C sequence (parent builds -> untracked-ness guard -> worktree add -> negative proof -> worktree build fails -> hook remedy -> positive proof) is ONE test on ONE fixture, not split across multiple its -- splitting would let a later step run against a differently-shaped fixture and reintroduce exactly the vacuity risk the plan calls out"
  - "The link-mechanism describe block asserts the junction form unconditionally but only MEASURES (console.log + a type-check on the caught error) the unqualified two-argument form's outcome -- 07-VALIDATION.md's Manual-Only Verifications row 2 explicitly forbids asserting EPERM universally, since it would fail the suite on a correctly-configured (Developer Mode / elevated / POSIX) machine"
  - "The regression-guard regex for an unqualified symlinkSync( call requires both arguments to be simple identifiers (/symlinkSync\\(\\s*[A-Za-z_$][\\w.]*\\s*,\\s*[A-Za-z_$][\\w.]*\\s*\\)/), not a loose two-comma-group match -- the loose form matched the hook file's own header-comment prose (symlinkSync(..., \"junction\")) as a false positive, caught and fixed before falsification"
  - "worktreePath is built as join(mkdtempSync(...), \"wt\") -- a leaf directory that does not yet exist -- and git worktree add is confirmed (manual probe, this machine) to create it itself; no pre-creation via mkdirSync was needed or added"
  - "Cleanup callbacks are pushed in an order that reverses (LIFO) to: removeWorktree first, then the worktree's container temp dir, then the repo -- removing the container before git worktree remove has run would leave a dangling worktree registration in the repo's .git/worktrees/"

requirements-completed: [EXT-02]

duration: ~30min
completed: 2026-08-15
---

# Phase 07 Plan 05: Worktree Build Proof (ROADMAP Criterion 4) Summary

**Proved, with a real `git worktree add` and the real shipped `.pi/scripts/worktree-setup-hook.mjs`, that a fresh subagent worktree genuinely cannot build until the hook runs, and genuinely can afterward — the decisive negative-then-remedy proof for EXT-02, plus a live measurement (not an assumption) of the Windows junction-vs-symlink split the remedy depends on.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-08-15 (session continuing from 07-04)
- **Completed:** 2026-08-15
- **Tasks:** 2
- **Files modified:** 1 created, 1 modified

## Accomplishments

- `tests/integration/worktree-build.test.ts` — one real fixture, in this order: `node src/index.js` succeeds in the original temp repo (fixture sanity) → `git ls-files` confirms `node_modules`/`.env` are genuinely untracked (vacuity guard) → a real `git worktree add <path> -b <branch> HEAD` → `existsSync` confirms both paths are absent from the fresh worktree (the negative proof) → `node src/index.js` in the worktree fails with `Cannot find module 'dep'` (the worktree genuinely cannot build) → the real `.pi/scripts/worktree-setup-hook.mjs` is spawned with a real `WorktreeSetupHookInput` JSON payload on stdin, exits 0, and reports `syntheticPaths: ["node_modules", ".env"]` → `node src/index.js` in the SAME worktree now succeeds (criterion 4, proven).
- A second describe block measures the link mechanism directly: `fs.symlinkSync(target, link, "junction")` is asserted to succeed unconditionally (the mechanism the positive proof above depends on); the unqualified two-argument form's outcome is measured and logged, not asserted, per 07-VALIDATION.md's explicit instruction not to assert an environment-dependent failure universally.
- A source-level regression guard rejects an unqualified two-argument `symlinkSync(` call site in the shipped hook — falsified before commit (see below).
- `docs/EXTENSIONS.md`'s existing "Worktree isolation — accepted residual" section now records the re-measured junction/symlink table and the falsification result, naming the shared-dependency-tree residual as a Phase 8 follow-up (unchanged from 07-02's own framing).

## Task Commits

Each task was committed atomically:

1. **Task 1: The untracked-files negative proof and the hook remedy** - `d4b665c` (test)
2. **Task 2: Pin the Windows symlink-vs-junction finding and record the accepted residual** - `f2cdd15` (docs)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `tests/integration/worktree-build.test.ts` — the EXT-02 decisive proof (274 lines): describe block 1 is the ten-step negative-then-remedy sequence against `tests/helpers/worktree.ts` and the real shipped hook; describe block 2 measures the junction/symlink mechanism and guards against a hook regression
- `docs/EXTENSIONS.md` — appended the re-measured junction/symlink table and falsification result to the existing Worktree isolation section (07-02's section; not rewritten, only extended)

## Literal build commands and exit codes (the load-bearing evidence)

Recorded from the actual `npx vitest run` output on this machine, this session:

```
$ npx vitest run tests/integration/worktree-build.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run
 Test Files  87 passed (87)
      Tests  1462 passed (1462)

$ npx tsc --noEmit
(no output — exit 0)
```

Inside the single decisive test, the sequence of real subprocess exit codes observed (via `spawnSync`, asserted in the test body, and independently reproduced by hand in the scratchpad before writing the vitest assertions):

| Step | Command | cwd | Exit code |
|---|---|---|---|
| Fixture sanity | `node src/index.js` | original temp repo | `0`, stdout `WORKTREE_BUILD_OK` |
| Negative proof | `node src/index.js` | fresh worktree, before hook | non-zero, stderr `Cannot find module 'dep'` |
| Remedy | `node .pi/scripts/worktree-setup-hook.mjs` (real payload on stdin) | fresh worktree | `0`, stdout `{"syntheticPaths":["node_modules",".env"]}` |
| Positive proof | `node src/index.js` | fresh worktree, after hook | `0`, stdout `WORKTREE_BUILD_OK` |

**Manual hand-verification (scratchpad, outside vitest, before the test file was written)** reproduced the identical sequence against a real temp repo and a real `git worktree add`, including the exact `Cannot find module 'dep'` stack trace and the hook's exact `{"syntheticPaths":["node_modules","...`]}` output, confirming the vitest assertions measure real subprocess behaviour rather than a mocked shape.

## Negative control (the "without the hook" proof)

This is the falsification the plan's `<critical_for_this_plan>` block asks for explicitly: the same build, in the same fresh worktree, **without** the hook's provisioning, fails. That is exactly what the ten-step sequence's step 7 asserts (`the worktree build must fail before the remedy runs`, matched against the literal `Cannot find module 'dep'` stderr text, not merely a non-zero exit code) — so the test does not merely show "with the hook it passes"; it first shows "without the hook it fails, for the specific reason under test", on the identical fixture the remedy is then applied to. Both directions run inside one `it()`, sharing one repo and one worktree, so neither could be passing because of a fixture difference between the two halves.

## Falsification performed (Task 2's mandatory falsify-before-commit step)

Per the plan's explicit instruction, the hook was mutated to reproduce `pi-subagents`' own defect, the suite was run, both results recorded, and the hook was restored:

**Mutation:** `.pi/scripts/worktree-setup-hook.mjs` line 183 changed from
`symlinkSync(nodeModulesSrc, nodeModulesDst, "junction")` to
`symlinkSync(nodeModulesSrc, nodeModulesDst)` (the unqualified two-argument form).

**Result — both turned red, exactly as required:**

```
FAIL  tests/integration/worktree-build.test.ts > EXT-02 -- a fresh worktree
  provably cannot build, and the shipped hook provably fixes it > build
  succeeds in the parent -> fails in a fresh worktree -> the shipped hook
  fixes it -> build succeeds again, on one fixture
AssertionError: the shipped hook must exit 0 on a valid payload:
  worktree-setup-hook: failed to junction node_modules into the worktree:
  EPERM: operation not permitted, symlink '...\node_modules' ->
  '...\wt\node_modules' -- a degraded worktree must be visible, not silent

FAIL  tests/integration/worktree-build.test.ts > EXT-02 -- the link
  mechanism the hook depends on is measured, not assumed > the shipped hook
  contains no unqualified two-argument fs.symlinkSync( call (regression
  guard)
AssertionError: found an unqualified two-argument symlinkSync( call in the
  shipped hook: symlinkSync(nodeModulesSrc, nodeModulesDst)
```

Notably the positive-proof failure surfaced one step earlier than the plan anticipated: the hook's own fail-closed design (07-02) means it never got as far as `syntheticPaths` — it caught its own `EPERM`, printed a diagnostic, and exited non-zero, which the test's `hookRun.status` assertion (step 8) caught immediately. This is a *stronger* result than "step 9's positive rebuild fails" would have been: it shows the hook degrades loudly rather than silently producing a half-provisioned worktree that fails later for an unrelated-looking reason (exactly the failure mode 07-RESEARCH.md's Pitfall 2 warns about). The hook was restored (`git diff` confirmed byte-identical to the pre-mutation version) and the full suite re-run green (4/4, then 1462/1462) before committing.

## Decisions Made

See `key-decisions` in frontmatter. Summarized: (1) the ten-step sequence is one test on one fixture, not split, to avoid a later step silently running against a differently-shaped fixture; (2) the unqualified-symlink outcome is measured and logged, never asserted, per 07-VALIDATION.md's explicit instruction; (3) the regression-guard regex was tightened after an initial false positive against the hook file's own header-comment prose; (4) `git worktree add` was manually confirmed (scratchpad probe) to create its own leaf target directory, so no `mkdirSync` pre-step was added; (5) cleanup order is `removeWorktree` → container temp dir → repo, to avoid leaving a dangling `.git/worktrees/` registration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Regression-guard regex false-positived on the hook's own header comment**

- **Found during:** Task 2, first `npx vitest run` of the regression-guard test
- **Issue:** The initial pattern `/symlinkSync\(\s*[^,]+,\s*[^,)]+\)/` matched the hook file's own docstring prose `symlinkSync(..., "junction")` — the comment text was flagged as an unqualified two-argument call, failing the test against unmutated, correct code
- **Fix:** Narrowed the pattern to require both arguments be simple identifiers/property-access expressions (`/symlinkSync\(\s*[A-Za-z_$][\w.]*\s*,\s*[A-Za-z_$][\w.]*\s*\)/`), which no longer matches `"..."` as an argument
- **Files modified:** tests/integration/worktree-build.test.ts
- **Verification:** Re-ran against unmutated hook (green, 4/4) and against the mutated hook (correctly red, matching `symlinkSync(nodeModulesSrc, nodeModulesDst)`)
- **Committed in:** `d4b665c` (Task 1 commit — the fix landed before the first commit of this file, so no separate fix-commit was needed)

---

**Total deviations:** 1 auto-fixed (1 bug, caught before commit via the plan's own mandatory falsification step)
**Impact on plan:** Caught during the plan's own required falsification step, before any commit landed with the defect. No scope creep — the fix is contained to the regex in the same test file the plan specified.

## Issues Encountered

None beyond the auto-fixed regex false positive above. All manual scratchpad probes (fixture build, worktree build failure, hook remedy, junction vs. unqualified symlink) matched the vitest assertions exactly on first attempt.

## User Setup Required

None — no external service configuration required. Everything in this plan was built and proved with local `git`, `fs`, and `node`, no credentials or network access needed.

## Next Phase Readiness

EXT-02 is now proven end-to-end and ROADMAP criterion 4 is discharged: a parallel subagent in an isolated git worktree can genuinely BUILD, not merely check out, using the real hook this repo ships. The scope boundary is stated explicitly in the test file's own docstring and repeated here: this plan says nothing about whether a real `pi-subagents` runtime actually invokes `worktreeSetupHook` — that live-wiring proof (confirming `.pi/settings.json`'s `worktreeSetupHook` key is read and the hook is spawned by a real subagent run) belongs to plan 07-09 (settings wiring) and the runbook entry plan 07-13 writes. No blockers for either of those later plans; both artifacts they depend on (`tests/helpers/worktree.ts`, `.pi/scripts/worktree-setup-hook.mjs`) are now independently exercised by a real, falsified, passing integration test.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: tests/integration/worktree-build.test.ts
- FOUND: docs/EXTENSIONS.md (modified)
- FOUND: d4b665c (test(07-05) commit)
- FOUND: f2cdd15 (docs(07-05) commit)
