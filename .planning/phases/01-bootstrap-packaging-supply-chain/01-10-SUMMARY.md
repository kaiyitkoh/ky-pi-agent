---
phase: 01-bootstrap-packaging-supply-chain
plan: 10
subsystem: documentation-honesty
tags: [boot-01, boot-02, boot-05, safe-16, runbook, readme, outstanding-status-guard, vitest]
requires:
  - git-ignore-oracle
  - bootstrap-script
  - gh-unauthenticated-classifier
  - load-path-sentinel-extension
  - vitest-test-framework
provides:
  - runbook-file
  - phase-one-outstanding-entries
  - outstanding-status-guard
  - readme-residual-gap-statement
affects:
  - README.md
  - docs/
  - tests/
tech-stack:
  added: []
  patterns:
    - "A verification status is machine-parsed from two independent places and required to agree — a half-flip is a distinct, reported failure state"
    - "A status guard's parser is asserted against a PASSED fixture, so asserting OUTSTANDING on the real file is not a tautology"
    - "A runbook entry that cites an offline proxy test must cite one that exists on disk, and the test proves it"
    - "Documentation that carries a security residual gap is asserted by literal substring, so a tidy-up rewrite cannot silently drop it"
key-files:
  created:
    - docs/RUNBOOK.md
    - tests/unit/docs-policy.test.ts
  modified:
    - README.md
decisions:
  - "phaseOneEntryStatuses reads the summary-table row AND the subsection Status line and requires agreement — a partial flip is the most likely real-world failure and would otherwise leave two contradictory answers with no signal; disagreement returns INCONSISTENT, absence returns MISSING, and neither is an acceptable status"
  - "docs/RUNBOOK.md is created in Phase 1 despite being formally a Phase 3 deliverable (PROV-09) — the file states this ownership inline so Phase 3 appends rather than rewrites"
  - "RB-01-01's offline proxy is named as tests/unit/gh-unauthenticated.test.ts (the classifier test) rather than left blank, so all three entries satisfy the proxy-exists assertion and the residual uncertainty is narrow and named"
  - "The README paste guard is a token-alphabet run of 40+ characters plus a Windows absolute-path check — a paste guard, deliberately, not a secret scanner; ordinary prose, paths and URLs break the run long before 40"
metrics:
  duration: ~25 min
  completed: 2026-08-13
  tasks: 3
  commits: 4
---

# Phase 1 Plan 10: README Residual Gap and the Phase 1 Runbook Summary

The two documents that carry this phase's honesty now exist, and a test makes the honesty non-negotiable: three checks that cannot run on this machine are recorded as OUTSTANDING, and flipping any of them — even halfway — breaks the suite.

## What Was Built

**Task 1 — `README.md` extended (commits `680cd4f`, `6621e1b`)**

Five new sections, added without touching the existing voice. The status paragraph ("work in progress. Nothing here is finished or verified.") and the "What this is" section are unchanged and are now asserted to stay that way.

- **Install** — Path A (`pi install <url>`) and Path B (clone + `sh bin/bootstrap.sh`) as explicit alternatives, with the double-load caveat: install globally *or* dogfood by `cd`-ing in, never both. Deduplication is by canonical path, and two absolute paths do not deduplicate, so you get duplicate command entries. Non-fatal, confusing, not worth engineering around.
- **Supply chain — what is protected and what is not.** Opens with the asymmetry that justifies the phase: Pi installs *itself* with `--ignore-scripts` and installs *extensions* without it, on no code path. Then coverage as three positive lists (root `.npmrc`, `~/.pi/agent/npm/.npmrc` after bootstrap, `.pi/npm/.npmrc`) and one honest negative: third-party *git* packages are **not covered**, because their clone directory is created fresh by `git clone` and nothing can be pre-placed in it; nor is any machine bootstrap has never run on. The mitigation is the one-shot `npm_config_ignore_scripts=true pi install <url>`, with the warning against exporting it — Pi passes its inherited environment to everything it spawns including the `bash` tool, so a persistent setting silently skips legitimate native builds mid-session.
- **Second machine / macOS setup** — four numbered steps ending in `sh bin/bootstrap.sh --assert-hardening`, and the reason the step exists: the repo `.npmrc` travels with the clone, the user-scope control does not. `--check-only` named as the non-mutating CI variant.
- **Session sharing** — `/share` cannot be blocked by any extension; `gh auth status` exiting non-zero is the whole control. Names `sh scripts/check-gh-unauthenticated.sh` to inspect and `gh auth logout` to apply, with the git-over-HTTPS cost stated.
- **Verification status** and **Development** — points at `docs/RUNBOOK.md`, and links `CONTRIBUTING.md`, which the README did not previously do (carried forward from 01-09).

**Task 2 — `docs/RUNBOOK.md` (commit `86d5f5b`, 183 lines)**

Header states the file's contract: every entry carries an exact command, an expected output, an offline proxy, and a status that is `OUTSTANDING` or a date-stamped pass. An entry with no status line is a bug in the file. Ownership by PROV-09 (Phase 3) is stated inline, with the reason Phase 1 creates it early.

| ID | Check | Status |
|----|-------|--------|
| RB-01-01 | SAFE-16 — `gh` left unauthenticated on the work laptop | **OUTSTANDING** |
| RB-01-02 | BOOT-02 — `pi install` against the real URL on a clean profile | **OUTSTANDING** |
| RB-01-03 | BOOT-05 — `/reload` re-registers the extension | **OUTSTANDING** |

Each has a "why this cannot be done here" paragraph, a numbered procedure with expected exit codes and messages, an undo where one exists, and a named offline proxy (`tests/unit/gh-unauthenticated.test.ts`, `tests/integration/load-paths.test.ts` case 2, `tests/unit/extension-layout.test.ts`). RB-01-01 records the `--remove-scopes gist` closed door verbatim so it is not re-litigated. The section closes with the two machine-state notes that belong nowhere else: `auth.json`'s `0600` is a no-op against Windows ACLs, and the three pieces of state no repo file can reach, both re-checkable with `--check-only` / `--assert-hardening`.

**Task 3 — `tests/unit/docs-policy.test.ts` (commit `d0877b9`, 29 tests)**

- **Group A** — ten required README strings, each paired with the reason it is load-bearing so a future reader hitting the failure knows what was protected. Plus the work-in-progress framing, a 40+ character token-alphabet paste guard, and a developer absolute-path check (the path is assembled from char codes so the test file does not itself contain one).
- **Group B** — each Phase 1 id has a table row marked OUTSTANDING and names its exact commands; every `tests/**/*.test.ts` path the runbook cites exists on disk, with the referenced set asserted non-empty first; the `--remove-scopes` and `0600` findings are still recorded.
- **Group C** — exported `phaseOneEntryStatuses(markdown)` reads both the table row and the subsection `**Status:**` line, normalises `PASSED — 2026-08-13` to `PASSED`, and returns `INCONSISTENT` on disagreement or `MISSING` on absence. Proven against four inline fixtures, then applied to the real file.

## Negative Controls Executed

The guard is only worth having if it fires. All three were run for real and then restored:

| Mutation | Result |
|----------|--------|
| `RB-01-01` flipped to `PASSED` in both table and subsection | **2 tests failed** (Group B row, Group C status) |
| `RB-01-01` flipped in the subsection only (half-flip) | **1 test failed** — reported `INCONSISTENT` |
| `not covered` removed from `README.md` | **1 test failed** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] README's `not covered` clause was unfindable by a literal assertion**

- **Found during:** Task 3, when Group A ran for the first time
- **Issue:** Task 1's verification used a case-insensitive regex (`/not covered/i`), which passed against the capitalised heading `**Not covered:**`. The prose instance was split across a line break as `**not\ncovered**`. So the phrase ROADMAP criterion 1 requires was present in spirit and absent as a string.
- **Why it matters:** this is the exact decay mode the test exists to prevent — the clause reading fine to a human while being unassertable. A case-insensitive check would have accepted a README whose only instance was a heading.
- **Fix:** reworded the bullet so `not covered` appears lowercase and contiguous, applied explicitly to third-party git packages. Group A asserts it case-sensitively.
- **Files modified:** `README.md`
- **Commit:** `6621e1b`

### Deliberate Additions

**2. [Rule 2 - Missing critical functionality] The parser reads two sources and requires agreement**

The plan asked for a parser extracting "the status token for each `RB-01-*` id". A single-source parser would have missed the most likely real failure: someone updates the skim-able summary table and forgets the detail subsection, or the reverse, leaving the file self-contradictory and the guard green. `phaseOneEntryStatuses` reads both and returns `INCONSISTENT` when they differ. This added one fixture and one negative control, both executed above.

**3. [Rule 2] RB-01-01 was given a named offline proxy**

The plan named offline proxies for RB-01-02 and RB-01-03 but not RB-01-01. Group B asserts every entry's cited proxy exists; leaving one blank would have made SAFE-16 the only entry with unbounded residual uncertainty. `tests/unit/gh-unauthenticated.test.ts` is cited, with the scope stated plainly in the runbook: it proves the classifier, and says nothing about the work laptop's state.

## Outstanding — Carried Into Later Phases

Nothing in this plan was verified live, by design. Recorded here so the phase close does not mistake a written procedure for an executed one:

- **RB-01-01 / SAFE-16** — `gh auth logout` on the work laptop is **OUTSTANDING**. `gh` remains authenticated on this machine; it is how the repo is pushed over HTTPS.
- **RB-01-02 / BOOT-02** — `pi install` against the real GitHub URL on a clean profile is **OUTSTANDING**. Needs network egress and a clean profile.
- **RB-01-03 / BOOT-05** — `/reload` is **OUTSTANDING**. Needs an interactive TTY.
- **The live GitHub Actions run has still never happened** (from 01-08). `docs/RUNBOOK.md` does not yet carry an entry for it — BOOT-07's static proof lives in `tests/unit/ci-pinning.test.ts` and the concern is recorded in `STATE.md`. A later phase should fold it into the runbook alongside these three.
- **`shellcheck` is still not installed here** (from 01-07/01-08), so POSIX-`sh` conformance of the two tracked scripts remains UNVERIFIED locally. The Ubuntu `posix-lint` job is the first real run.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run tests/unit/docs-policy.test.ts` | 29 passed |
| `npx vitest run` (full suite, unit + integration) | **15 files, 212 tests, all passed** (was 14 / 183) |
| `npx tsc --noEmit` | exit 0 |
| `git check-ignore -q --no-index -- docs/RUNBOOK.md` | exit 1 — committable |
| `docs/RUNBOOK.md` length | 183 lines (≥ 50 required) |
| `OUTSTANDING` occurrences in the runbook | 7 (≥ 3 required) |

## Threat Model Dispositions

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-01-33 | mitigated | `phaseOneEntryStatuses` asserts all three are `OUTSTANDING`; parser proven against a `PASSED` fixture and a half-flip fixture, both negative controls executed |
| T-01-01 | accepted, documented | README states third-party git packages are **not covered**, gives the one-shot `npm_config_ignore_scripts` ritual, warns against exporting it |
| T-01-34 | mitigated | README second-machine section: `sh bin/bootstrap.sh` then `--assert-hardening` |
| T-01-20 | mitigated; live application OUTSTANDING | RB-01-01 with full procedure, expected outputs, and the `--remove-scopes` closed door |
| T-01-35 | mitigated | Group A asserts no token-shaped run and no developer absolute path in README |
| T-01-36 | mitigated | Group B asserts every runbook-cited proxy test exists on disk, non-empty set first |

## Known Stubs

None. No stub, placeholder or TODO ships in this plan's files.

## Self-Check

- `README.md` — FOUND
- `docs/RUNBOOK.md` — FOUND
- `tests/unit/docs-policy.test.ts` — FOUND
- commit `680cd4f` — FOUND
- commit `86d5f5b` — FOUND
- commit `6621e1b` — FOUND
- commit `d0877b9` — FOUND

## Self-Check: PASSED
