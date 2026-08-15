---
phase: 08-quality-gates-engineering-quality
plan: 10
subsystem: quality
tags: [gate-08, calibration, seeded-defects, anti-review-theatre, scoreCalibration, faux-provider]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality
    provides: "08-03 (submitReviewParameters/validateReview -- the REVIEW schema), 08-07 (runReview/buildReviewerContext/buildImportGraph -- the reviewer dispatch this plan drives)"
provides:
  - "tests/fixtures/seeded-defects/index.ts -- SEEDED_DEFECTS, six real-incident defect builders, each buildable into an isolated makeTempRepo() clone and inert on import"
  - ".pi/extensions/quality/calibration.ts -- scoreCalibration(expected, findings), a pure catch-rate scorer reporting a raw ratio plus per-defect-class booleans and unmatchedFindings"
  - "tests/integration/reviewer-calibration.test.ts -- the calibration run, its blind-reviewer negative control, and its shotgun control, all driven through runReview against a faux reviewer"
affects: [09-ceremonial-workflows, gate-composition, future-live-calibration-RB-08-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three separable calibration artifacts (corpus / injection / scoring), each independently testable, so no single module can grade itself"
    - "A scorer proven able to report zero via two dedicated negative controls (blind reviewer, shotgun reviewer), not merely assumed correct"
    - "Corpus fixtures built only into isolated makeTempRepo() clones, never onto this repository's own working tree"

key-files:
  created:
    - tests/fixtures/seeded-defects/index.ts
    - .pi/extensions/quality/calibration.ts
    - tests/integration/reviewer-calibration.test.ts
  modified: []

key-decisions:
  - "The calibration group drives ONE combined review contract (all six defects built into one temp repo) through runReview, rather than six separate per-defect calls -- this mirrors a real review pass, which reviews a change once and reports however many of its defects it catches, and it is what scoreCalibration's expected[]/findings[] signature is actually shaped for"
  - "The shotgun fixture's 20 findings deliberately cycle through the six REAL touched files (not an unrelated path) so the 'vagueness does not score' claim is tested by the mustMentionAny check alone, not accidentally by a location mismatch -- caught by re-reading my own first draft, which used a fake 'src/misc-notes.ts' location that made the control vacuous under falsification"
  - "SeededDefectExpectation is re-declared structurally in calibration.ts rather than imported from the corpus module, since production code under .pi/extensions/ must not import from tests/ -- the corpus module is named as authoritative in both files' docstrings"

requirements-completed: [GATE-08]

# Metrics
duration: ~55min
completed: 2026-08-15
---

# Phase 08 Plan 10: Seeded-Defect Calibration Summary

> **Correction (WR3-02, `08-REVIEW.md` iteration 3, 2026-08-15):** the
> `0.5 (3/6)` catch rate this plan originally recorded is stale. WR2-05
> (iteration 2) later raised the calibration matcher's needle bar and, in
> the same commit, extended one fixture finding's text to keep clearing
> it — holding the number at 0.5 by construction, not by measurement. The
> fixture has since been reverted to its unmodified text; the honest,
> currently-measured number is **0.333... (2/6)**. See `docs/QUALITY.md`'s
> own WR3-02 disclosure for the full account. The falsification narrative
> below is left as originally written — it is an accurate record of what
> was tested against the matcher and fixture as they stood when this plan
> executed.

**A reproducible per-defect-class catch rate for GATE-08, computed by `scoreCalibration` over `runReview`'s output against a six-fixture corpus drawn from this project's own Phase 3-7 incidents, with a scripted-reviewer catch rate of 0.5 (3/6) and both required negative controls (blind reviewer, shotgun reviewer) independently proven to report zero.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3 (all complete)
- **Files modified:** 3 (all created)

## Accomplishments

- `tests/fixtures/seeded-defects/index.ts` -- `SEEDED_DEFECTS`, exactly six entries, one per real incident named in the plan's own objective table (Phase 6 fabricated-evidence, Phase 5 tautological-test, Phase 5 escaped-side-effect, Phase 4 absent-guard, Phase 3 symptomatic-fix, Phase 7 false-label). Each `build(repo)` writes and commits its defective shape into an isolated `makeTempRepo()` clone via one combined commit, returning `touchedFiles`/`diff`. Every fixture is proven, live, to produce ZERO ERROR-tier findings from `runAntiPatternRules` -- the assertion that makes "this needs a model reviewer" a measured claim, not an assumption.
- `.pi/extensions/quality/calibration.ts` -- `scoreCalibration(expected, findings): CalibrationResult`, PURE (no `ctx`, no I/O, no model call). `catchRate` is a raw ratio, never rounded, never accompanied by a verdict string. `unmatchedFindings` is reported, never subtracted, so a shotgun reviewer's noise is visible as noise. States plainly in its own header that a scripted-reviewer number is not a live-reviewer number (`RB-08-03`, OUTSTANDING).
- `tests/integration/reviewer-calibration.test.ts` -- 17 test cases across four groups: corpus integrity (six entries, no import-time file-system writes, every fixture invisible to the deterministic stage), the calibration run itself (a known-subset scripted reviewer, the blind-reviewer negative control, the shotgun control), reproducibility (two independently-built temp-repo runs produce identical `CalibrationResult` values), and a direct unit-level proof of `scoreCalibration` independent of `runReview`.

## THE CATCH-RATE NUMBER, VERBATIM

**Reproducing command:**

```sh
npx vitest run tests/integration/reviewer-calibration.test.ts
```

**Result when run (2026-08-15, this machine, faux provider only):** 17/17 passed. The scripted "known subset" reviewer scored:

```
caught: 3
total: 6
catchRate: 0.5
perDefectClass: {
  "fabricated-evidence": true,
  "tautological-test": false,
  "escaped-side-effect": false,
  "absent-guard": true,
  "symptomatic-fix": false,
  "false-label": true
}
unmatchedFindings: 0
```

**This number describes a SCRIPTED faux reviewer we ourselves scripted to catch exactly 3 of 6 -- it is not a measurement of a real model's judgement.** No live reviewer has ever run against this corpus. It exists to prove the pipeline (`build fixtures -> runReview -> validateReview -> scoreCalibration`) computes a real, reproducible, non-rounded number end to end, and that the number is not fixed at any convenient constant (proven by the falsification runs below). **A live calibration run is `RB-08-03` in `docs/RUNBOOK.md`, OUTSTANDING** -- it requires real provider credentials this machine does not carry for inference, and per the autonomous-run rules, no provider inference request was issued at any point in this plan.

**Negative controls, both proven:**

- **Blind reviewer** (approves everything, zero findings): `caught: 0`, `catchRate: 0`, every `perDefectClass` value `false`.
- **Shotgun reviewer** (20 findings referencing the six real touched files, but with generic, non-specific `concreteFailure` text): `catchRate: 0`, `unmatchedFindings: 20`.

**Reproducibility:** the whole calibration group was run twice, against two independently-built temp repos and faux sessions, in the same test file (`tests/integration/reviewer-calibration.test.ts`'s "reproducibility" test). `run2`'s three `CalibrationResult` objects were asserted `toEqual` `run1`'s, and passed.

## Falsification Proof (Task 3's own acceptance criterion)

Both falsifications were run against the fully-committed `calibration.ts` (commit `f13cdd5`), one at a time, restored via `git checkout -- .pi/extensions/quality/calibration.ts` before the next:

| Falsification | Test command | Result |
|---|---|---|
| F1: dropped the `mustMentionAny` check in `findingCatches` (credits any finding whose file matches) | `npx vitest run tests/integration/reviewer-calibration.test.ts` | 2 failed / 15 passed -- exactly the shotgun case (`catchRate` became `1`, no longer `0`) and the direct-proof "right file, no needle" unit case turned red |
| Restored via `git checkout --`; confirmed `git diff --stat` empty | -- | clean restore, re-ran green (17/17) |
| F2: hardcoded `catchRate = 1` in `scoreCalibration`'s return | `npx vitest run tests/integration/reviewer-calibration.test.ts` | 4 failed / 13 passed -- exactly the blind-reviewer negative control, the shotgun case, and two direct-proof unit cases (including the `total === 0` divide-by-zero guard) turned red |
| Restored via `git checkout --`; confirmed `git diff --stat` empty | -- | clean restore, re-ran green (17/17) |

**A real bug was found and fixed during F1's first attempt**, before either falsification above: the shotgun fixture's findings originally referenced a fake, unused path (`src/misc-notes.ts`) as their `location`. Under normal (non-falsified) scoring this happened to still produce `catchRate: 0` for the right *apparent* reason, but F1 (dropping the `mustMentionAny` check) revealed the location check ALONE would already have blocked every shotgun finding -- meaning the control never actually exercised the `mustMentionAny` check at all, and F1 did not turn the shotgun case red on the first attempt. Fixed by making the shotgun fixture's 20 findings cycle through the six REAL touched files (matching each defect's `locationFile`) with severity `BLOCKER` and still-generic `concreteFailure` text -- so under normal scoring the control still reports `catchRate: 0` (correctly, because the text is vague), but under F1 it now correctly turns red (because the location check alone would credit it). This is documented as a deviation below (Rule 1 -- a bug in this plan's own test, not production code).

## Task Commits

Each task was committed atomically:

1. **Task 1: The six-fixture corpus, built on temp repos** - `e4eb080` (test)
2. **Task 2: The pure scorer** - `f13cdd5` (feat)
3. **Task 3: The calibration run, and the blind-reviewer control that must score LOW** - `1b56c57` (test)

## Files Created/Modified

- `tests/fixtures/seeded-defects/index.ts` (386 lines) -- `DEFECT_CLASSES`, `SeededDefect`/`SeededDefectExpectation`, `SEEDED_DEFECTS` (six builders), each using local git plumbing (`commitFiles`, `diffAgainstEmptyTree`) to write and commit its shape into a caller-supplied `makeTempRepo()` clone.
- `.pi/extensions/quality/calibration.ts` (178 lines) -- `SeededDefectExpectation`, `ScorableFinding`, `CalibrationResult`, `scoreCalibration`.
- `tests/integration/reviewer-calibration.test.ts` (418 lines) -- corpus integrity group, calibration group (known-subset/blind/shotgun via `runReview`), reproducibility group, direct `scoreCalibration` unit proof.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Shotgun fixture's findings referenced a fake file path, making the mustMentionAny control untested by its own falsification**

- **Found during:** Task 3, running the falsification proof required by the plan's own acceptance criteria ("dropping the mustMentionAny check must turn the shotgun case red").
- **Issue:** The first draft of `SHOTGUN_REVIEWER_ARGS` used `location: "src/misc-notes.ts:<n>"` -- a path that does not match any seeded defect's `locationFile`. Under normal scoring this coincidentally still produced `catchRate: 0`, because the LOCATION check alone already rejected every finding. When F1 (dropping the `mustMentionAny` check) was run to prove that check load-bearing, the shotgun case stayed green -- proving nothing, because the location mismatch was doing all the rejecting on its own. The control was passing for the wrong reason.
- **Fix:** Rewrote the shotgun fixture to cycle its 20 findings' `location` through the six REAL `locationFile` values (one per seeded defect) at `BLOCKER` severity, keeping `concreteFailure` generic and needle-free. Re-ran F1: the shotgun case now correctly turns red when `mustMentionAny` is dropped, and stays green (`catchRate: 0`, `unmatchedFindings: 20`) under normal scoring.
- **Files modified:** `tests/integration/reviewer-calibration.test.ts`
- **Verification:** `npx vitest run tests/integration/reviewer-calibration.test.ts` green (17/17) before falsification; F1 turns exactly 2 cases red (shotgun + a matching direct-proof unit case); restored and re-verified green.
- **Committed in:** `1b56c57` (Task 3 commit -- the bug was caught and fixed before the task's own commit, never shipped broken).

---

**Total deviations:** 1 auto-fixed (Rule 1, a bug in this plan's own test fixture caught by its own required falsification step -- exactly the discipline `test_integrity` asks for).
**Impact on plan:** No scope change. Caught before the Task 3 commit; the shipped test genuinely exercises the property it claims to.

## Known Stubs

None. Every artifact this plan claims is fully wired: the corpus builds real defective shapes into real temp repos, the scorer computes a real ratio from real input, and the integration test drives the real `runReview` chokepoint (not a bypass) with a scripted faux reviewer.

## Threat Flags

None beyond the plan's own `threat_model`, all mitigated as designed:

- T-08-36 (a seeded defect shipping as real code in `.pi/extensions/`): fixtures live only under `tests/fixtures/seeded-defects/`, are built only into `makeTempRepo()` clones, and import performs no write (proven against a mocked `node:fs`).
- T-08-37 (a calibration harness that can only report 100%): the blind-reviewer control asserts `catchRate === 0`; both negative controls are independently falsification-proven above.
- T-08-38 (measurement fraud -- tuning toward a flattering number): the corpus is fixed to six real incidents; `catchRate` is a raw ratio with no verdict string; the 0.5 reported here is recorded as the actual result of a scripted 3-of-6 reviewer, not tuned toward any target.
- T-08-39 (a scripted number read later as a live number): stated in three places -- `calibration.ts`'s own header, this SUMMARY's catch-rate section, and the integration test file's own docstring -- that the live run is `RB-08-03`, OUTSTANDING.

## Issues Encountered

- Pre-existing, unrelated flake observed during the full-suite run (`npx vitest run`, no path filter), not fixed (out of scope per SCOPE BOUNDARY, and already documented in `08-07-SUMMARY.md`'s own "Issues Encountered"): `tests/unit/checkpoint-store.test.ts`'s `WR-09` concurrency case (`four overlapping OS processes each recording 150 entries produce all 600 rows`) failed once with `the latest start has to precede the earliest finish` -- a real-OS-process-timing assertion unrelated to this plan's files. Belongs to Phase 7's checkpoint subsystem.

## User Setup Required

None. No `[RUNBOOK]` item executed, no live provider inference request issued at any point -- every reviewer driven through `runReview` in this plan's tests is a scripted `fauxProvider`, per the autonomous-run rules.

## Next Phase Readiness

- The three calibration artifacts (corpus, scorer, calibration run) exist, are independently testable, and are ready for a future gate-composition module (Phase 9, or a later Phase 8 triage plan) to run the SAME `scoreCalibration` against a real reviewer's findings once `RB-08-03` (the live run) is performed by hand on the work laptop.
- **Correction to the autonomous-run rules' premise:** `RB-08-02` (cited by plan 08-06, `.pi/extensions/quality/gates.ts`) and `RB-08-03` (cited by plan 08-07, `tests/unit/subagent-agents-config.test.ts`, and now this plan's `calibration.ts`) are CITED BY NAME in code and doc comments across Phase 8, but **neither id has an actual entry in `docs/RUNBOOK.md` yet**, and `docs-policy.test.ts`'s `ALL_IDS` array has no `PHASE_EIGHT_IDS` at all -- verified by `grep -n "RB-08" docs/RUNBOOK.md tests/unit/docs-policy.test.ts`, which returns nothing. This plan's own `files_modified` frontmatter does not list `docs/RUNBOOK.md`, and adding two-to-three ids' worth of runbook entries retroactively for 08-06/08-07/08-08's citations is out of this plan's scope (SCOPE BOUNDARY: only fix what THIS plan's changes directly caused) -- it belongs to this phase's closing plan, matching the Phase 7 precedent where `07-13` added `RB-07-01`/`RB-07-02`/`RB-07-03` together at phase close rather than each contributing plan adding its own entry piecemeal. Flagged here as a Blocker/Concern for that closing plan to pick up, alongside `RB-08-02`.
- No other blockers carried forward.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check: PASSED
