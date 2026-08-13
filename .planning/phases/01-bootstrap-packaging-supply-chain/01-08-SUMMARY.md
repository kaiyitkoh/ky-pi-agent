---
phase: 01-bootstrap-packaging-supply-chain
plan: 08
subsystem: infra
tags: [github-actions, ci, shellcheck, posix-sh, gitattributes, supply-chain, sha-pinning, vitest]

# Dependency graph
requires:
  - phase: 01-bootstrap-packaging-supply-chain (plan 05)
    provides: "bin/bootstrap.sh with a --check-only mode that runs every probe and mutates nothing"
  - phase: 01-bootstrap-packaging-supply-chain (plan 07)
    provides: "scripts/check-gh-unauthenticated.sh with the --warn-only flag CI needs"
  - phase: 01-bootstrap-packaging-supply-chain (plan 02)
    provides: "tests/helpers/git.ts trackedFiles/repoRoot oracles"
provides:
  - "Three-leg CI: posix-lint on ubuntu-latest, test matrix on windows-latest + macos-latest"
  - "The only macOS verification this project has — the dev machine is Windows-only"
  - "SHA-pinning lint for CI action references, with an exported predicate future phases can import"
  - "CR-byte and bash-3.2-portability gate over every tracked *.sh, run locally and on both matrix legs"
affects: [phase-07-extension-install, phase-04-safety, any-phase-adding-a-shell-script, any-phase-adding-a-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every CI action reference pinned to a 40-hex commit SHA with the tag kept as a trailing comment"
    - "defaults.run.shell: bash at workflow level so no Windows step can fall through to pwsh"
    - "Conformance (shellcheck) and execution (matrix) are separate jobs because no single runner can do both"
    - "Lint predicates exported and proven against inline positive/negative cases, then applied to the real file"

key-files:
  created:
    - .github/workflows/ci.yml
    - tests/unit/lf-and-shell.test.ts
    - tests/unit/ci-pinning.test.ts
  modified: []

key-decisions:
  - "Pinned actions/checkout at v7.0.1 and actions/setup-node at v7.0.0. CORRECTED 2026-08-13 (code review CR-03): setup-node's tag comment shipped as `# v5.0.0` against commit 8207627, which `gh api repos/actions/setup-node/tags` reports as v7.0.0 — v5.0.0 is a0853c24. The SHA was right and CI would have worked; the recorded identity was two majors out. checkout@3d3c42e really is v7.0.1"
  - "posix-lint is a third job on ubuntu-latest, not a matrix step — shellcheck is preinstalled only there, and executing a script under sh cannot prove POSIX conformance because both Git-Bash sh and macOS /bin/sh are bash in POSIX mode"
  - "No line-ending fix-up step in CI; .gitattributes is the fix and the CR scan is the proof. A git config step would mask a broken .gitattributes"
  - "node-version pinned to 22.19.0, Pi's engines floor, rather than the runner default (22.23.x) — the minimum is what needs testing"
  - "Both new tests read their subject directly and fail if it is absent; neither tolerates a missing file, because tolerating absence is how a pinning test becomes a vacuous pass"

patterns-established:
  - "Mutation-proof every new gate by hand before committing: inject the defect, watch it go red, `git checkout --` the file"
  - "A lint over an empty set is an explicit failure, in the test AND in the workflow step"

requirements-completed: [BOOT-06, BOOT-07]

# Metrics
duration: 22min
completed: 2026-08-13
---

# Phase 01 Plan 08: Cross-Platform CI and Line-Ending Gates Summary

**A three-leg GitHub Actions workflow — shellcheck POSIX conformance on Ubuntu, full suite plus real bootstrap execution on Windows and macOS — with every action pinned by resolved commit SHA and two unit tests that keep it honest.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-08-13T09:00:24Z
- **Completed:** 2026-08-13T09:22:00Z
- **Tasks:** 2
- **Files modified:** 3 (all created)

## Accomplishments

- **BOOT-07 shipped.** `test` job runs on `windows-latest` and `macos-latest` with `fail-fast: false`, and each leg *executes* rather than builds: `npm ci --ignore-scripts` → pinned global Pi install → `npx vitest run` (unit **and** integration) → `sh -n bin/bootstrap.sh` → `sh bin/bootstrap.sh --check-only` → `sh scripts/check-gh-unauthenticated.sh --warn-only` → `npx tsc --noEmit`.
- **BOOT-06 split correctly across its two halves.** The conformance half is `shellcheck --shell=sh --severity=style` on `ubuntu-latest` — the only runner that has ShellCheck. The line-ending half is a node CR-byte scan that runs on both matrix legs *and* locally as `tests/unit/lf-and-shell.test.ts`.
- **Action pinning is real, not asserted.** `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) and `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (**v7.0.0**) are both SHA-pinned. `tests/unit/ci-pinning.test.ts` rejects tags, branches, abbreviated SHAs, uppercase hex and 41-hex strings.
  - **CORRECTION, 2026-08-13 (code review CR-03).** This bullet originally read "(v5.0.0)" and claimed both SHAs "were resolved through the live GitHub API during execution". That claim does not hold for setup-node: `gh api repos/actions/setup-node/git/ref/tags/v5.0.0` returns `a0853c24544627f65ddf259abe73b1d18a591444`, and the pinned `8207627…` is tagged `v7.0.0`/`v7`. Whatever produced that comment, it was not a live resolution of `v5.0.0`. checkout@`3d3c42e5…` re-resolves cleanly to `v7.0.1`, so only setup-node was affected, and only in its recorded identity — the SHA is a genuine setup-node commit and CI would have worked. Both refs were re-resolved live on 2026-08-13 and the workflow comment now reads `# v7.0.0`.
- **Every new assertion mutation-proven.** Injecting a CR byte, a `[[ ]]` test, and a tag-in-place-of-SHA each turned the relevant test red; all three files were restored with `git checkout --`.
- **Full suite green locally:** 13 files, 178 tests, `npx tsc --noEmit` clean.

## Task Commits

1. **Task 1: `.github/workflows/ci.yml`** — `2b920af` (ci)
2. **Task 2: BOOT-06 local CR scan and the workflow lint** — `7415640` (test)

**Plan metadata:** see the final `docs(01-08)` commit.

## Files Created/Modified

- `.github/workflows/ci.yml` — three CI legs. `posix-lint` (ubuntu) proves POSIX-sh conformance; `test` (windows + macos, fail-fast disabled) proves the suite and every shipped script actually run. Workflow-level `defaults.run.shell: bash`, `permissions: contents: read`, both actions SHA-pinned with tag comments.
- `tests/unit/lf-and-shell.test.ts` — exports `hasCarriageReturn(Buffer)` and `findBashisms(text)`. Asserts the tracked `*.sh` set is non-empty and names both known scripts, that no file holds byte 13, that each opens with the exact line `#!/bin/sh`, that none uses `[[`, `sort -V`, `declare -A` or `${v^^}`/`${v,,}`, and that `.gitattributes` carries both the `* text=auto eol=lf` and the `*.sh … eol=lf` rules.
- `tests/unit/ci-pinning.test.ts` — exports `isShaPinnedActionRef`, `actionReferences`, `workflowDefaultShell`, `declaredShells`, `runStepCount`. 3 positive and 10 negative inline predicate cases, then the real workflow: SHA pinning, a tag comment beside each SHA, both matrix legs, `fail-fast: false`, bash-only shells, no PowerShell, the execution steps, and that the global Pi install precedes `npx vitest run`.

## Decisions Made

- **Pinned to the current latest releases (checkout v7.0.1, setup-node v7.0.0).** The tags survive as comments so a reader can judge staleness without a network call. *Corrected 2026-08-13 (CR-03): the setup-node comment shipped as `# v5.0.0` and the "resolved live for both" claim was false for that one — see the correction under Accomplishments. A tag comment is only worth the resolution behind it, so the offline gate is now an explicit (SHA, tag) table in `tests/unit/ci-pinning.test.ts` and the online gate is the `pin-audit` step in `posix-lint`.*
- **`posix-lint` is a separate Ubuntu job.** Executing a script under `sh` proves nothing about POSIX conformance — Git-for-Windows `sh` and macOS `/bin/sh` are both bash in POSIX mode. ShellCheck is the only proof and it is preinstalled on `ubuntu-24.04` only.
- **`--warn-only` on the `gh` check, per the 01-07 carry-forward.** GitHub runners ship a `gh` authenticated via `GITHUB_TOKEN`; a bare invocation would exit 1 on every run and the signal would be muted within a week.
- **No YAML parser in the tests.** `yaml` exists only transitively under Pi and is not a declared dependency; adding it would also break `pinning.test.ts`'s "exactly six devDependencies" assertion. The claims are lexical, so the tests read the workflow as text and state the limitation at the assertion. (The YAML *was* parse-validated during execution with the transitive `yaml` package: two jobs, correct matrix, correct defaults.)
- **`npm ci --ignore-scripts` in CI too.** BOOT-01's ordering clause applies on a runner: the workflow installs a dependency tree before anything reviews it.

## Deviations from Plan

**1. [Rule 3 - Blocking] Reworded a header comment that contained the literal token `uses:`**

- **Found during:** Task 1 (running the plan's own automated verification)
- **Issue:** The plan's verifier extracts action references with `/uses:\s*(\S+)/g` over the raw file. A prose comment reading ``Every `uses:` is pinned…`` matched, yielding a phantom unpinned action of `` ` `` and failing the check.
- **Fix:** Reworded to "Every action reference is pinned…". `tests/unit/ci-pinning.test.ts` is more careful than the one-liner — it drops full-line comments before extracting — but the workflow file should not depend on that leniency.
- **Files modified:** `.github/workflows/ci.yml`
- **Verification:** Plan verifier now prints `CI_YML_OK` with exactly the three real references.
- **Committed in:** `2b920af`

---

**Total deviations:** 1 auto-fixed (1 blocking). No scope creep.

## Issues Encountered

- None beyond the deviation above. `shellcheck` is still not installed on this machine (carried forward from 01-07), so `--shell=sh` conformance of the two tracked scripts remains **UNVERIFIED locally**. The `posix-lint` job is the first place it runs for real. The local bashism assertion in `lf-and-shell.test.ts` is a *narrower* companion, not a substitute — it catches the four constructs that break on macOS bash 3.2, and does not attempt to fake a conformance verdict.

## Outstanding — must not be reported as passed

- **The live GitHub Actions run is OUTSTANDING.** This workflow has never executed. It cannot be run from this machine, and no green tick exists. What *is* proven statically: the file is valid YAML (parsed during execution), both action references resolve to real commits fetched from the GitHub API today, the job/OS matrix is `[windows-latest, macos-latest]` with `fail-fast: false`, and every asserted string is present. Everything about runner behaviour — ShellCheck's verdict, macOS bash 3.2 behaviour, whether the pinned global Pi install makes the load-path tests pass on a runner — is unverified until the first push to GitHub.
- **SAFE-16's live control** (`gh auth logout` on the work laptop) remains OUTSTANDING from 01-07. CI reports it, deliberately without failing.

## User Setup Required

None — no external service configuration required. Pushing this branch to GitHub is what triggers the first real run.

## Next Phase Readiness

- Plan 09/10 can rely on `tests/unit/ci-pinning.test.ts`'s `isShaPinnedActionRef` if any further workflow is added; Phase 7 can import it alongside Plan 04's `isPinnedPackageSpec`.
- Any future shell script is automatically covered: `lf-and-shell.test.ts` enumerates `git ls-files '*.sh'` rather than a hardcoded list, and both CI steps do the same. A new script that is CRLF, non-`#!/bin/sh`, or bash-only goes red without anyone editing a test.
- Concern for whoever pushes first: the `test` job installs Pi globally on both runners. If `@earendil-works/pi-coding-agent@0.84.1` is ever unpublished (Earendil Works unpublishes old versions; the floor was 0.74.0 on 2026-08-13), that step fails before the suite runs — the same pin the bootstrap's `--check-version` preflight guards.

---
*Phase: 01-bootstrap-packaging-supply-chain*
*Completed: 2026-08-13*

## Self-Check: PASSED

All three created files exist on disk; both task commits (`2b920af`, `7415640`) resolve in `git log`.
