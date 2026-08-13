---
phase: 04-safety-deployment-guardrails
plan: 01
subsystem: safety
tags: [unbash, ast-parsing, supply-chain, pinning, user-scope-extensions, jiti, vitest]

# Dependency graph
requires:
  - phase: 01-bootstrap-and-safety-scaffolding
    provides: the pinning-governance pattern (REQUIRED_DEV_PINS in tests/unit/pinning.test.ts), the .npmrc ignore-scripts=true hardening, tests/helpers/pi.ts (requirePiOnPath/runPi), tests/helpers/session.ts (writeUserScopeShim), and the load-paths.test.ts real-subprocess testing discipline
provides:
  - unbash@4.0.10 installed as a governed runtime dependency (dependencies, not devDependencies)
  - the executed AST node-type vocabulary (CommandExpansion, ProcessSubstitution, ArithmeticCommandExpansion, heredoc/herestring redirect operators, Statement.background) that Plan 03's deny predicate must be written against
  - the executed tolerance finding that forbids an errors.length fail-closed check
  - the Windows-path text-vs-value asymmetry (unquoted drops backslashes, quoted retains them; ~ and $HOME are not expanded)
  - confirmation that a user-scope re-export stub loads in a real spawned pi process on Windows, with the project-scope negative control proven on the same fixture
affects: [04-02, 04-03, 04-05, 04-06, 04-09, 04-10]

# Tech tracking
tech-stack:
  added: ["unbash@4.0.10 (runtime dependency)"]
  patterns:
    - "characterisation test of a third-party parser, separate from any unit test of our own code"
    - "self-memoizing getter detection in a generic tree-walker (walkableKeys()) rather than trusting Object.keys() alone"
    - "sentinel-provider + --list-models as the credential-free, TTY-free way to observe extension load in a real spawned process"

key-files:
  created:
    - tests/unit/unbash-ast.test.ts
    - tests/integration/user-scope-load.test.ts
  modified:
    - package.json
    - package-lock.json
    - tests/unit/pinning.test.ts

key-decisions:
  - "unbash@4.0.10 lands in a new top-level `dependencies` block (not devDependencies), exact-pinned, governed by a new REQUIRED_RUNTIME_PINS exact-match test"
  - "The user-scope load mechanism for Plan 09's bootstrap script is the plain re-export stub (export { default } from \"<abs path>\") -- it passed on the first run; the file:// URL and directory-copy fallbacks named in 04-RESEARCH.md are not needed"
  - "ParsedScript.errors is undefined on a clean parse, not []; every downstream policy check (Plan 03) must read (script.errors ?? []).length, not script.errors.length"

patterns-established:
  - "Pattern: a generic AST tree-walker must explicitly include lazy getter-backed fields (Word.value, Word.parts) via an `in` check, because Object.keys() alone silently skips self-memoizing class properties -- this is the exact gap Plan 03's shell.ts deny predicate must also avoid"

requirements-completed: [SAFE-02, SAFE-11]

# Metrics
duration: 15min
completed: 2026-08-14
---

# Phase 4 Plan 1: unbash Pinning, AST Vocabulary, and User-Scope Load Spike Summary

**Landed `unbash@4.0.10` as a governed runtime dependency, executed the AST node-type vocabulary and tolerance finding Plan 03's deny predicate depends on, and confirmed by direct execution that a user-scope re-export stub loads in a real spawned `pi` process on Windows -- closing 04-RESEARCH.md's one `[ASSUMED]` mechanism before any policy logic exists.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-14T03:27Z (approx, from prior commit)
- **Completed:** 2026-08-14T03:39:35Z
- **Tasks:** 3 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `unbash@4.0.10` installed and exact-pinned in a new `package.json` `dependencies` block, governed by a new `REQUIRED_RUNTIME_PINS` exact-match test mirroring `REQUIRED_DEV_PINS`.
- Executed, not merely quoted, the full AST vocabulary Plan 03's `shell.ts` deny predicate needs: `CommandExpansion`, `ProcessSubstitution`, `ArithmeticCommandExpansion` node types; `<<`, `<<-`, `<<<` redirect operators; `Statement.background`; and the tolerance finding that all seven adversarial inputs (`git $(echo push)`, heredoc-to-script, `nohup ... &`, `sh -c`, `bash -lc`, `env -i`, `git -C`) parse with zero errors, which is why an error-count check cannot be SAFE-03's fail-closed mechanism.
- Confirmed the Windows path text/value asymmetry by execution: unquoted `C:\Users\...` loses its backslashes in `.value`, quoted forms retain them, and `~`/`$HOME` are never expanded by `unbash`.
- Proved SAFE-11's Assumption A1 in a real spawned `pi` subprocess: a user-scope re-export stub loads with no project trust required, the identical sentinel at project scope does not load without `-a` (Pitfall 15's exact failure mode), and editing the stub's target file is picked up by a fresh process with the stub itself untouched.

## Task Commits

1. **Task 1: Pin unbash@4.0.10 as a runtime dependency and govern the new dependencies block** - `9ffb216` (feat)
2. **Task 2: Prove the unbash AST vocabulary and the errors.length tolerance finding by execution** - `52e7b17` (test)
3. **Task 3: Spike the user-scope re-export stub in a real spawned pi process (Assumption A1)** - `556a462` (test)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `package.json` - new top-level `dependencies: { unbash: "4.0.10" }` block
- `package-lock.json` - lockfile entry for `unbash@4.0.10` and its resolved tree
- `tests/unit/pinning.test.ts` - `REQUIRED_RUNTIME_PINS` constant and a new `BOOT-08.5` describe block asserting `dependencies` contains exactly the audited pin
- `tests/unit/unbash-ast.test.ts` (new) - 24 tests across three groups: tolerance table (7 adversarial inputs), vocabulary table (8 node-type/operator/background facts, plus a negative control), Windows-path asymmetry (5 cases)
- `tests/integration/user-scope-load.test.ts` (new) - 3 tests: positive (user-scope stub loads), negative control with paired positive (project scope does not load without `-a`), freshness (editing the target is picked up without touching the stub)

## Decisions Made

- `unbash` lands in `dependencies`, not `devDependencies`: Pi installs consumers with `npm install --omit=dev`, and `tests/unit/pinning.test.ts` already asserts `devDependencies` equals exactly the six audited toolchain pins.
- `npm view unbash scripts.postinstall` returned empty (no postinstall script) -- the outstanding legitimacy-gate item RESEARCH.md named is now closed. Install ran under this repo's `.npmrc` (`ignore-scripts=true`) with a clean `npm_config_*` environment (verified via `env | grep -i npm_config` before the install).
- The user-scope load mechanism for Plan 09's `bin/bootstrap.sh` is the plain re-export stub. It passed on the first execution against a real spawned `pi` process on Windows via Git Bash -- no `file://` URL variant or directory-copy fallback is needed.
- Corrected 04-RESEARCH.md's code examples in the new characterisation test's own docstring: `ParsedScript.errors` is `undefined` on a clean parse (confirmed by direct execution), not `[]` as the research document's examples assumed. Every assertion reads `(script.errors ?? []).length`, and this is the form Plan 03's deny predicate must also use.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a silent tree-walker gap caused by unbash's self-memoizing getters**

- **Found during:** Task 2 (writing `tests/unit/unbash-ast.test.ts`)
- **Issue:** A first draft of the test file's generic AST walker (`collectNodeTypes`, `collectRedirectOperators`, `anyStatementBackgrounded`) used `Object.keys(obj)` to enumerate a node's children. Direct execution showed `unbash`'s `WordImpl` class exposes `.value` and `.parts` as self-memoizing getters, not own enumerable properties: `Object.keys(word)` reports only `["text", "pos", "end"]` even though `"value" in word` and `"parts" in word` are both `true`. The walker therefore silently never descended into a command substitution, process substitution, or expansion hidden inside a `Word` -- every vocabulary-table assertion for `CommandExpansion`, `ProcessSubstitution`, and `ArithmeticCommandExpansion` failed, and the `$HOME`-not-expanded assertion failed too.
- **Fix:** Added `walkableKeys()`, which unions `Object.keys(obj)` with `"value"`/`"parts"` when present via an `in` check (which walks the prototype chain and therefore sees the getters), and used it in place of `Object.keys()` in all three walker functions.
- **Files modified:** `tests/unit/unbash-ast.test.ts`
- **Verification:** All 24 tests in the file pass; the fix was confirmed necessary by first observing the failure (5 of 24 tests red) and then watching all 5 turn green after the fix, with no other test's behavior changing.
- **Committed in:** `52e7b17` (Task 2 commit; the bug was found and fixed within the same task before any commit was made)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix is itself load-bearing for the phase: Plan 03's `shell.ts` deny predicate will walk the same `unbash` AST shape, and this is exactly the gap it must also avoid. Documented prominently in the test file's own docstring so a future reader of `shell.ts` is warned before writing the same walker mistake. No scope creep -- the fix stayed inside the one test file it was found in.

## Issues Encountered

None beyond the deviation above. The Assumption A1 spike (Task 3) was expected to be the highest-risk part of this plan -- RESEARCH.md tagged it `[ASSUMED]` with a two-level fallback chain -- and it passed on the first execution with no fallback required.

## User Setup Required

None - no external service configuration required. `unbash` has no postinstall script and the install ran fully offline-equivalent (registry read only, no credentials involved).

## Next Phase Readiness

- Plan 03 (`shell.ts`, the AST deny predicate) can now cite this plan's executed vocabulary directly rather than re-deriving it from `04-RESEARCH.md`'s code examples, and must use `walkableKeys()`'s discovery (lazy `Word.value`/`Word.parts`) and the `errors ?? []` correction.
- Plan 09 (`bin/bootstrap.sh`'s user-scope install) has a proven, unconditional mechanism to wire: the plain re-export stub, with no conditional fallback logic needed.
- No blockers. `unbash@4.0.10` is installed, pinned, and governed; `npm test` is green at 685/685 with no regressions from the 655-test baseline recorded at the end of Phase 3.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: tests/unit/unbash-ast.test.ts
- FOUND: tests/integration/user-scope-load.test.ts
- FOUND: `"unbash": "4.0.10"` in package.json dependencies
- FOUND: commit 9ffb216 (Task 1)
- FOUND: commit 52e7b17 (Task 2)
- FOUND: commit 556a462 (Task 3)
