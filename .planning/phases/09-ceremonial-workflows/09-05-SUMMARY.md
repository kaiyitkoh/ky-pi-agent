---
phase: 09-ceremonial-workflows
plan: 05
subsystem: workflows
tags: [grill, spec-schema, evidence-gate, flow-03, ceremonial-workflows]

# Dependency graph
requires:
  - phase: 09-ceremonial-workflows
    provides: "plan 09-04's git.ts/policy.ts glab mr create conditional-allow (unrelated subsystem, same phase); plan 09-03's .pi/lib/work-artifacts.ts ARTIFACT_FILES/workDir() precedent for path/section discipline"
provides:
  - "gateRequirementsAuthorship(markdown) -- the FLOW-03 predicate: /grill may not write SPEC.md section 3 until section 2 exists and every row carries evidence, as CODE not prompt wording"
  - "SPEC_SECTIONS -- the frozen 8-section table (goal/verifiedFacts/requirements/errorBehaviour/scopePin/clarifications/assumptions/scorecard) each with a named downstream consumer"
  - "parseSpecSections/parseVerifiedFacts -- pure markdown section and table parsers a future /grill command file (plan 09-08) can call directly"
  - "EVIDENCE_PATTERN -- the named, anchored, bounded regex distinguishing a file:line or command-output citation from a bare assertion"
affects: [09-08 (wires this predicate to /grill's actual write path, closing FLOW-03), 09-VALIDATION.md row FLOW-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-arm discriminated union verdict ({ok:true} | {ok:false, reason}), matching review-schema.ts's ReviewValidation and workflows/evidence.ts's EvidenceVerdict -- no third partial-accept arm anywhere in this codebase's gate predicates"
    - "Numbered, binding-order reject branches with a docstring line per branch stating WHY it sits where it does, and every reject reason built from the RECEIVED data, never a caller-supplied string"
    - "requiredSection() module-load-time resolver pattern: converts a SPEC_SECTIONS.find() result from SpecSectionDescriptor|undefined to a definite SpecSectionDescriptor once, at module scope, so downstream functions need no repeated undefined-narrowing across closure boundaries"

key-files:
  created:
    - .pi/extensions/grill/spec-schema.ts
    - tests/unit/grill-evidence-gate.test.ts
  modified:
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "The empty-claim fixture case was deliberately given a malformed evidence cell too (not merely absent), because a well-formed-evidence version would report the identical reason whether branches (3)/(4) run in their real order or reordered -- falsification (c) would then prove nothing about binding order"
  - "Branch (6) (the §3-present overlay) is folded into every §2 defect branch (1)-(5) via a shared withRequirementsGuard() string helper, rather than re-checked as an independent seventh physical branch -- by construction, reaching past (1)-(5) means §2 is already fully valid, so a standalone (6) check could never fire there; the distinguishing '§3 is present, but...' wording is attached the instant a §2 defect is found, matching the docstring's stated binding order without dead code"
  - "FLOW-03 is left Pending in REQUIREMENTS.md, not marked complete by this plan -- the plan's own frontmatter states plainly that this plan 'completes the machine-checkable half of FLOW-03; FLOW-03 closes when 09-08 wires the predicate to /grill's write path'. Marking it complete here would be exactly the kind of overclaim 09-CONTEXT.md decision 6 warns against"

requirements-completed: []

# Metrics
duration: 55min
completed: 2026-08-15
---

# Phase 9 Plan 5: SPEC section parser and the section-2 evidence gate Summary

**`.pi/extensions/grill/spec-schema.ts`: a pure, numbered, binding-order predicate (`gateRequirementsAuthorship`) that structurally refuses to let `/grill` author SPEC.md's Requirements section until the Verified Codebase Facts table exists and every row carries a shape-checked `file:line` or `command output:` citation -- proved with three source-level falsifications, each producing the expected RED and restored clean.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-08-15T12:51Z (approx, from STATE.md `last_updated`)
- **Completed:** 2026-08-15T13:46:44Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Built the phase's single most important gate as CODE: `gateRequirementsAuthorship` in `.pi/extensions/grill/spec-schema.ts`, a pure predicate with a two-arm verdict, six binding-order numbered branches, and reject reasons built entirely from the received markdown (never a caller-supplied string).
- `SPEC_SECTIONS` -- the frozen, ordered 8-section table from `FEATURES.md` Part 2, each entry carrying a non-empty `consumer` string per that document's own design rule ("a section with no named consumer does not ship").
- `EVIDENCE_PATTERN` -- one named, anchored, bounded regex accepting exactly two citation shapes (`file:line`, `command output: ...`) and rejecting a bare assertion, a URL alone, or the word "verified" -- documented explicitly in the constant's own doc comment.
- 12-test fixture-table suite (`tests/unit/grill-evidence-gate.test.ts`) covering both directions (2 accept, 6 reject cases), every reject case asserting on the REASON TEXT rather than merely `ok === false`, plus a 500-row DoS proof (T-09-05-03) and an explicit purity assertion.
- Three falsifications performed and recorded verbatim below, each restored to a clean `git diff` before the next mutation.
- Declared the `.pi/extensions/grill` `DIRECTORY_BUDGETS` row (530, measured 522 raw lines) ahead of the discovery mechanism requiring it, per the plan's own instruction that "declaring the directory before its command file exists is legal and is the honest thing to do."

## Task Commits

Each task was committed atomically:

1. **Task 1: spec-schema.ts -- section parser and the §2 evidence gate** - `2d9f17a` (feat)
2. **Task 2: grill-evidence-gate.test.ts -- table-driven, both directions, falsified** - `5a4c4e4` (test), `a84ac6f` (test -- fixture sharpening required to make falsification (c) observable, see Deviations)

**Plan metadata:** _pending -- final commit created after this SUMMARY._

## Files Created/Modified

- `.pi/extensions/grill/spec-schema.ts` (522 raw lines) - `SPEC_SECTIONS`, `HEADING_PATTERN`, `parseSpecSections`, `findSection`, `EVIDENCE_PATTERN`, `VerifiedFact`, `parseVerifiedFacts`, `SpecGateVerdict`, `gateRequirementsAuthorship`, `requiredSection` (module-load-time resolver), `withRequirementsGuard` (branch-(6) reason wrapper)
- `tests/unit/grill-evidence-gate.test.ts` (216 lines) - the fixture-table suite, the DoS proof, the purity assertion
- `tests/unit/workflow-budgets.test.ts` - one new `DIRECTORY_BUDGETS` entry for `.pi/extensions/grill`

## Decisions Made

See `key-decisions` in the frontmatter above. In short: the empty-claim fixture needed a malformed evidence cell too so falsification (c) would be observable; branch (6) is folded into branches (1)-(5) via a shared string-building helper rather than re-checked independently, since it is structurally unreachable as a standalone seventh branch; and FLOW-03 is deliberately left Pending in REQUIREMENTS.md pending plan 09-08.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript could not narrow `REQUIREMENTS_SECTION`/`VERIFIED_FACTS_SECTION` from `SpecSectionDescriptor | undefined`**
- **Found during:** Task 1, first `npx tsc --noEmit` run
- **Issue:** The original code resolved these two constants with `SPEC_SECTIONS.find(...)` at module scope, followed by a module-level `if (... === undefined) throw`. TypeScript's control-flow narrowing does not carry a module-scoped `const`'s narrowed type across a later function declaration's closure boundary, producing 8 `TS18048`/`TS2345` "possibly undefined" errors at every later reference inside `gateRequirementsAuthorship` and `withRequirementsGuard`.
- **Fix:** Extracted a `requiredSection(id): SpecSectionDescriptor` helper with a definite (non-optional) return type, called once per constant at module load. This resolves the type once, with no narrowing burden on any later reference.
- **Files modified:** `.pi/extensions/grill/spec-schema.ts`
- **Verification:** `npx tsc --noEmit` clean.
- **Committed in:** `2d9f17a` (Task 1 commit -- found and fixed before the first commit, not a follow-up)

**2. [Rule 1 - Bug] The `ok: false` grep-count acceptance criterion demanded literal occurrences, not a shared-helper count**
- **Found during:** Task 1, re-reading the acceptance criterion `grep -c "ok: false" ... >= 5 (one per reject branch)` after an initial draft that funneled every reject through a single `reject(section, defect)` helper (only 2 literal occurrences of `ok: false`)
- **Issue:** A shared helper that constructs and returns the full `{ok: false, reason}` object collapses the literal source-text count of `"ok: false"` to far fewer than the number of logical reject branches, failing the stated acceptance grep.
- **Fix:** Rewrote each of the five reject branches to construct its own literal `{ ok: false, reason: ... }` object inline, using a narrower `withRequirementsGuard(defect, requirementsPresent): string` helper that returns only the reason STRING (never the verdict object), so the literal `ok: false` text appears once per branch.
- **Files modified:** `.pi/extensions/grill/spec-schema.ts`
- **Verification:** `grep -c "ok: false" .pi/extensions/grill/spec-schema.ts` returns 7 (2 in doc-comment/type-definition text, 5 literal branch returns) -- above the required 5.
- **Committed in:** `2d9f17a` (Task 1 commit -- found and fixed before the first commit)

**3. [Rule 1 - Bug] The empty-claim fixture case could not make falsification (c) observable as originally written**
- **Found during:** Task 2, while performing falsification (c) (reordering branches 3 and 4)
- **Issue:** The "a row with an empty claim" fixture case originally paired an empty `claim` with a well-formed `evidence` cell (`.pi/lib/jsonl.ts:606`). Reordering branches (3) (claim check) and (4) (evidence check) has no observable effect on this row's outcome, because a well-formed evidence cell never reaches branch (4)'s reject condition regardless of which branch runs first -- the reordered code would still report "empty claim" via whichever branch runs second, proving nothing about binding order.
- **Fix:** Changed the fixture's `evidence` field to a malformed, non-citation-shaped string (`"read the file directly"`), so the row genuinely fails BOTH branch (3)'s and branch (4)'s conditions, making the reported reason depend on which branch runs first.
- **Files modified:** `tests/unit/grill-evidence-gate.test.ts`
- **Verification:** Re-ran the full suite with the sharpened fixture (still green, 12/12) before performing falsification (c); falsification (c) then produced the expected single-case RED (see Falsifications below) and was restored clean.
- **Committed in:** `a84ac6f` (a separate test-only commit, made and verified green BEFORE falsification (c) was performed, per the 03-11 lesson: commit before mutating)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs, all found and fixed within the same task before its commit, or as a pre-falsification correction committed separately)
**Impact on plan:** All three were necessary for the acceptance criteria to be genuinely met (type-checkable code, a literal grep-satisfying branch count, and a falsification that actually exercises the property it claims to prove). No scope creep -- no new files, no architectural change.

## Falsifications (recorded verbatim, per this plan's `<verification>` requirement)

All three falsifications were performed by editing `.pi/extensions/grill/spec-schema.ts` in place, running `npx vitest run tests/unit/grill-evidence-gate.test.ts`, capturing the RED output below, then reverting the edit and confirming `git diff --stat .pi/extensions/grill/spec-schema.ts` was empty before proceeding to the next falsification. `tests/unit/grill-evidence-gate.test.ts` itself was committed (`5a4c4e4`, then `a84ac6f`) before any mutation began.

### Falsification (a) -- stub `gateRequirementsAuthorship` to `return { ok: true };`

All six reject cases turned RED; both accept cases stayed green.

```
 ❯ tests/unit/grill-evidence-gate.test.ts (12 tests | 6 failed) 7ms
     × §2 heading absent, §3 present -> reject (distinguishes 'never wrote §2' from every other defect -- the reason must name the missing section, not merely fail) 3ms
     × §2 present, zero data rows, §3 present -> reject (must be distinguishable from the absent-heading case -- 'you wrote an empty one' is a different fact than 'you never wrote it') 0ms
     × a row with an empty claim AND a malformed evidence cell -> reject (names the offending row index, per this plan's own must_haves.truths -- branch (3) (empty claim) is checked BEFORE branch (4) (evidence shape), so this reason names the claim defect even though the evidence cell is also malformed) 0ms
     × a row whose evidence cell is the bare word 'verified' -> reject (the bare word 'verified' names no place to look -- EVIDENCE_PATTERN's own doc comment states this is deliberately not accepted, and the reason must quote what arrived) 0ms
     × a row whose evidence cell is a plausible-looking but non-conforming string -> reject (reads like a citation but names no file:line and no command-output label -- must still reject) 0ms
     × a row with an empty howVerified -> reject (GATE-05-shaped completeness: every cell is mandatory, not only claim and evidence) 0ms

AssertionError: expected reject, got {"ok":true}: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/unit/grill-evidence-gate.test.ts:168:75

 Test Files  1 failed (1)
      Tests  6 failed | 6 passed (12)
```

### Falsification (b) -- loosen `EVIDENCE_PATTERN` to `/.+/`

Exactly the two evidence-shape-specific reject cases turned RED (the two cases whose evidence cells are non-empty-but-malformed strings); everything else stayed green, including the empty-claim/empty-howVerified/absent-section cases whose rejects come from a different branch entirely.

```
 ❯ tests/unit/grill-evidence-gate.test.ts (12 tests | 2 failed) 8ms
     × a row whose evidence cell is the bare word 'verified' -> reject (the bare word 'verified' names no place to look -- EVIDENCE_PATTERN's own doc comment states this is deliberately not accepted, and the reason must quote what arrived) 3ms
     × a row whose evidence cell is a plausible-looking but non-conforming string -> reject (reads like a citation but names no file:line and no command-output label -- must still reject) 0ms

AssertionError: expected reject, got {"ok":true}: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/unit/grill-evidence-gate.test.ts:168:75

 Test Files  1 failed (1)
      Tests  2 failed | 10 passed (12)
```

### Falsification (c) -- reorder branches (3) (empty claim) and (4) (evidence shape) in the source

Only the fixture case carrying BOTH an empty claim and a malformed evidence cell turned RED, and its reason text CHANGED from naming the claim defect to naming the evidence defect -- direct proof that the branch order is what the assertion actually checks, not merely what the docstring claims.

```
 ❯ tests/unit/grill-evidence-gate.test.ts (12 tests | 1 failed) 8ms
     × a row with an empty claim AND a malformed evidence cell -> reject (names the offending row index, per this plan's own must_haves.truths -- branch (3) (empty claim) is checked BEFORE branch (4) (evidence shape), so this reason names the claim defect even though the evidence cell is also malformed) 4ms

AssertionError: reason "the \"Requirements\" section (§3) is present, but requirements may not be authored on unverified facts: row 1 of the \"Verified Codebase Facts\" section (§2), claim \"\", has a malformed evidence cell -- expected a \"file:line\" citation or a \"command output: ...\" citation, received \"read the file directly\"" must include "empty claim": expected 'the "requirements" section (§3) is pr…' to contain 'empty claim'

Expected: "empty claim"
Received: "the "requirements" section (§3) is present, but requirements may not be authored on unverified facts: row 1 of the "verified codebase facts" section (§2), claim "", has a malformed evidence cell -- expected a "file:line" citation or a "command output: ...\" citation, received \"read the file directly\""

 ❯ tests/unit/grill-evidence-gate.test.ts:181:9

 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

After each falsification, the source file was restored and `git diff --stat .pi/extensions/grill/spec-schema.ts` confirmed empty before proceeding.

## Issues Encountered

None beyond the three auto-fixed deviations documented above.

## Known Stubs

None. `spec-schema.ts` is a complete, pure module with no placeholder values, no hardcoded empty returns feeding a UI, and no "coming soon" text. It exports a working predicate that a future caller (plan 09-08) will invoke directly -- nothing in this module defers work to itself.

## Threat Flags

None. All five threats named in this plan's own `<threat_model>` (T-09-05-01 through T-09-05-04, T-09-05-SC) were already dispositioned by the plan itself (`accept` for T-09-05-01 with the stated downstream mitigation, `mitigate` for the rest) and this module introduces no new network endpoint, auth path, file access pattern, or schema change at a trust boundary beyond what the plan already named.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `.pi/extensions/grill/spec-schema.ts` exports exactly the four names plan 09-08 needs (`parseSpecSections`, `parseVerifiedFacts`, `gateRequirementsAuthorship`, plus `SPEC_SECTIONS`) with no default export, matching the entry-point/imported-module partition `tests/unit/extension-layout.test.ts` enforces.
- FLOW-03 stays Pending in `REQUIREMENTS.md` until plan 09-08 wires this predicate into `/grill`'s actual write path -- that plan's acceptance criteria should call `gateRequirementsAuthorship` directly rather than reimplementing any part of this logic.
- No blockers. Full suite (110 files, 2100 tests) green; `npx tsc --noEmit` clean at completion.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `.pi/extensions/grill/spec-schema.ts`
- FOUND: `tests/unit/grill-evidence-gate.test.ts`
- FOUND: `.planning/phases/09-ceremonial-workflows/09-05-SUMMARY.md`
- FOUND commit: `2d9f17a` (Task 1)
- FOUND commit: `5a4c4e4` (Task 2, test file)
- FOUND commit: `a84ac6f` (fixture sharpening)
- FOUND commit: `e768e60` (this summary)
