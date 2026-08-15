---
phase: 09-ceremonial-workflows
plan: 06
subsystem: workflows
tags: [grill, spec-schema, ears-lite, scope-pin, root-cause, ceremonial-workflows]

# Dependency graph
requires:
  - phase: 09-ceremonial-workflows
    provides: "plan 09-05's SPEC_SECTIONS/parseSpecSections/findSection/EVIDENCE_PATTERN/parseVerifiedFacts/gateRequirementsAuthorship -- the section parser and §2 evidence gate this plan builds on and delegates to (validateSpec branch (2))"
provides:
  - "IF_THEN_PATTERN/MIN_ERROR_BEHAVIOURS/parseErrorBehaviours -- FLOW-04's EARS-lite §4 forcing function as CODE"
  - "ScopePin/EXPECTED_FILE_PATTERN/parseScopePin -- FLOW-05's declaration half: a non-empty, reasoned out-of-scope list and a non-empty expected-files list of legal repo-relative paths"
  - "FIX_FRAMING_MARKERS/isFixFramed/RootCause/parseRootCause -- QUAL-03's conditional Root Cause gate inputs"
  - "validateSpec -- the whole-document, 9-branch, numbered binding-order SPEC.md gate"
  - "renderSpecMarkdown -- the on-disk SPEC.md renderer, round-trip-proved against validateSpec"
affects: [09-08 (wires validateSpec into /grill's actual write path), 09-14 (FLOW-05's diff half -- comparing the expected-files list against a real git diff), 09-VALIDATION.md rows FLOW-04/FLOW-05/QUAL-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounded lazy quantifiers (\\S.{0,2000}?) instead of .+/.* for a per-entry forcing-function regex applied to model-authored text -- closes T-09-06-04 (catastrophic backtracking) while still accepting realistic entries; proved with a 10 KB adversarial single-entry timing test"
    - "Character-class exclusion over lookahead enumeration for a glob-rejecting path pattern -- EXPECTED_FILE_PATTERN's [\\w./-] character class excludes every glob metacharacter simply by never including it, needing only two additional lookaheads (leading /, .. segment) rather than one lookahead per excluded symbol"
    - "A conditional-required-field gate (QUAL-03's Root Cause) copies review-schema.ts's classification===\"workaround\" branch (7) shape exactly: an optional field that becomes mandatory only under a caller-observable condition, proved by a MANDATORY negative control (a non-fix-framed accept case with no Root Cause) so an unconditional implementation cannot pass unnoticed -- confirmed by falsification (c)"
    - "A fixture-table test builder (buildSpec/SpecParts) that assembles full markdown strings from named parts via plain string templating, deliberately NEVER calling the production renderer under test -- keeps the round-trip case (which DOES call the renderer) meaningful rather than tautological"

key-files:
  created:
    - tests/unit/spec-error-behaviour.test.ts
  modified:
    - .pi/extensions/grill/spec-schema.ts
    - tests/unit/workflow-budgets.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "renderSpecMarkdown was implemented alongside validateSpec in the Task 1 commit rather than deferred to Task 2's commit as the plan's task split suggested -- both share the SpecArtifact type and were naturally written together; Task 2's own commit is the test file plus its own budget update, which is where the plan's substantive verification requirement (the fixture table, the falsifications) actually lives"
  - "Root Cause is deliberately NOT added as a ninth SPEC_SECTIONS entry -- that table's own module docstring calls it frozen, and QUAL-03's Root Cause section is CONDITIONALLY required (fix-framed only), unlike the eight sections every SPEC carries unconditionally. It is located by heading-text match instead."
  - "FLOW-04 and QUAL-03 are marked Complete in REQUIREMENTS.md; FLOW-05 stays Partial -- both FLOW-04 and QUAL-03's own requirement text is entirely about SPEC.md's SHAPE, fully closed by validateSpec regardless of whether any command yet calls it (matching this plan's own frontmatter/objective, which states both are 'entirely SPEC-shape requirements'). FLOW-05's own text names a diff against a real git diff, which is explicitly plan 09-14's job -- this plan built only the declaration half."
  - "Falsification (a)'s actual behaviour was recorded honestly, not the plan's predicted one -- see Falsifications section below"

requirements-completed: ["FLOW-04", "QUAL-03"]

# Metrics
duration: ~40min
completed: 2026-08-15
---

# Phase 9 Plan 6: SPEC §4 EARS-lite, §5 scope pin, and the conditional Root Cause gate Summary

**`validateSpec` in `.pi/extensions/grill/spec-schema.ts`: a 9-branch, numbered, binding-order whole-document gate that structurally rejects a SPEC.md with a prose (non-IF/THEN/SHALL) error behaviour, fewer than 3 of them, an empty or unreasoned out-of-scope list, an empty or glob/`..`-carrying expected-files list, or -- for a fix-framed change -- a missing or evidence-free Root Cause section, proved with a 16-row fixture table, a renderer round-trip, and four source-level falsifications.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-15T13:51Z (approx, from STATE.md `last_updated`)
- **Completed:** 2026-08-15T14:11Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `IF_THEN_PATTERN` (FLOW-04): the exact-uppercase, bounded-lazy-quantifier `IF <condition> THEN THE SYSTEM SHALL <response>` forcing function, `MIN_ERROR_BEHAVIOURS = 3` as a named constant, and `parseErrorBehaviours` (malformed entries returned as-is, never dropped).
- `ScopePin`/`EXPECTED_FILE_PATTERN`/`parseScopePin` (FLOW-05 declaration half): a repo-relative-path pattern that rejects a leading `/`, a `..` segment, and every glob metacharacter (via character-class exclusion, not per-symbol lookaheads), plus a bold-labelled three-sublist parser (`**In scope:**`/`**Out of scope:**`/`**Expected files:**`).
- `FIX_FRAMING_MARKERS`/`isFixFramed`/`RootCause`/`parseRootCause` (QUAL-03): a documented, honestly-imprecise fix-framing heuristic with a caller override, and a Root Cause parser requiring a file:line-cited cause distinct from its own "why not the symptom" explanation.
- `validateSpec`: the whole-document gate, 8 numbered reject branches (malformed heading, §2 delegation, empty goal, §4 count, §4 shape, §5 out-of-scope, §5 expected-files, conditional Root Cause) plus accept, constructing `SpecArtifact` at exactly one site.
- `renderSpecMarkdown`: copies `renderReviewMarkdown`'s accumulator shape, round-trip-proved (`validateSpec(renderSpecMarkdown(validateSpec(x).spec))` accepts).
- 20-test fixture-table suite (`tests/unit/spec-error-behaviour.test.ts`): 16 rows (3 accept, 13 reject, every reject asserting on reason TEXT), a vacuity guard, the round-trip case, a T-09-06-04 DoS timing proof, and a direct `EXPECTED_FILE_PATTERN` unit check.
- Four falsifications performed and recorded verbatim below, each restored to a clean `git diff` before the next mutation.
- `.pi/extensions/grill` `DIRECTORY_BUDGETS` re-measured 530 -> 1170 (1161 raw lines, one file) in the same commit as the growth.
- `FLOW-04` and `QUAL-03` marked Complete in `REQUIREMENTS.md`; `FLOW-05` marked Partial with plan 09-14 named inline for the diff half.

## Task Commits

Each task was committed atomically:

1. **Task 1: §4 IF/THEN, §5 scope pin, and the conditional Root Cause gate** (includes `renderSpecMarkdown` -- see Deviations) - `9f65a06` (feat)
2. **Task 2: fixture-table test for validateSpec/renderSpecMarkdown** - `576e7ab` (test)

**Plan metadata:** _pending -- final commit created after this SUMMARY._

## Files Created/Modified

- `.pi/extensions/grill/spec-schema.ts` (1161 raw lines) - `IF_THEN_PATTERN`, `MIN_ERROR_BEHAVIOURS`, `LIST_ITEM_PATTERN`, `parseErrorBehaviours`, `ScopeExclusion`, `ScopePin`, `OUT_OF_SCOPE_SEPARATOR`, `SCOPE_SUBSECTION_PATTERN`, `extractScopeSubsection`, `EXPECTED_FILE_PATTERN`, `parseScopePin`, `FIX_FRAMING_MARKERS`, `isFixFramed`, `RootCause`, `ROOT_CAUSE_HEADING`, `ROOT_CAUSE_CITATION_PATTERN`, `extractLabelledField`, `parseRootCause`, `SpecArtifact`, `SpecValidation`, `ValidateSpecOptions`, `KNOWN_HEADINGS`, `findMalformedHeadingReason`, `validateSpec`, `renderSpecMarkdown`
- `tests/unit/spec-error-behaviour.test.ts` (343 lines, new) - `buildSpec`/`SpecParts` fixture builder, the 16-row `ROWS` table, vacuity guard, round-trip case, DoS timing proof, direct pattern unit check
- `tests/unit/workflow-budgets.test.ts` - `.pi/extensions/grill` `DIRECTORY_BUDGETS` entry re-measured
- `.planning/REQUIREMENTS.md` - FLOW-04 and QUAL-03 marked `[x]` Complete; FLOW-05 left `[ ]` with a Partial note naming plan 09-14

## Decisions Made

See `key-decisions` in the frontmatter above. In short: `renderSpecMarkdown` landed in Task 1's commit (both share `SpecArtifact` and were written together); Root Cause is a heading-text lookup, not a ninth `SPEC_SECTIONS` entry; FLOW-04/QUAL-03 close now (pure SHAPE requirements) while FLOW-05 stays partial (its diff half is 09-14's job); and falsification (a)'s real, weaker-than-predicted result is recorded honestly rather than the plan's stated expectation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `sed`-based falsification (a) mangled regex escaping**
- **Found during:** Task 2, falsification (a)
- **Issue:** An initial attempt to add the `i` flag to `IF_THEN_PATTERN` via `sed` with a double-quoted shell string stripped every backslash (`\s` -> `s`, `\S` -> `S`), producing a syntactically different (and broken) regex rather than the intended minimal one-flag change.
- **Fix:** Reverted via the `Edit` tool instead, which performs an exact string replacement with no shell-escaping hazard.
- **Files modified:** `.pi/extensions/grill/spec-schema.ts` (transiently, corrected before the falsification run)
- **Verification:** `git diff` confirmed only the `/i` flag differed from HEAD before running the falsification test.
- **Committed in:** N/A -- caught and corrected before any commit; the file was clean at falsification time and restored clean afterward.

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug, a tooling mistake caught and corrected before it affected any commit)
**Impact on plan:** No impact on shipped code -- the mistake was in the falsification *procedure*, corrected before producing the falsification's recorded output.

## Falsifications (recorded verbatim, per this plan's `<verification>` requirement)

All four falsifications were performed by editing `.pi/extensions/grill/spec-schema.ts` in place (via the `Edit` tool), running `npx vitest run tests/unit/spec-error-behaviour.test.ts`, capturing the RED output below, then reverting the edit and confirming `git diff --stat .pi/extensions/grill/spec-schema.ts` was empty before proceeding to the next falsification. `tests/unit/spec-error-behaviour.test.ts` itself was committed (`576e7ab`) before any mutation began.

### Falsification (a) -- add the `i` (case-insensitive) flag to `IF_THEN_PATTERN`

**Recorded honestly, DIFFERING from this plan's own stated prediction.** The plan text read: "→ the lower-case and SHOULD cases must turn RED." Only the lower-case case actually turned red. This is the mathematically correct outcome, not a bug in the implementation: a case-insensitive flag changes letter-casing sensitivity only -- it has no effect on the literal `SHALL` vs `SHOULD` word mismatch, which remains a distinct string regardless of case. The SHOULD-variant reject case is therefore NOT weakened by this specific loosening, and correctly stayed green. Recording the true, weaker result here (rather than silently matching the plan's prediction) is exactly this plan's own "BE SUSPICIOUS OF GREEN" instruction applied to the falsification step itself.

```
 ❯ tests/unit/spec-error-behaviour.test.ts (20 tests | 1 failed) 9ms
     × '§4 with a lower-case if/then/shall en…' -> false ('case discipline is the whole point of…') 3ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/spec-error-behaviour.test.ts > validateSpec -- FLOW-04 / FLOW-05 (declaration half) / QUAL-03 > '§4 with a lower-case if/then/shall en…' -> false ('case discipline is the whole point of…')
AssertionError: expected ok=false, got {"ok":true,"spec":{"goal":"Add a file-scoped lock so concurrent checkpoint writers serialise their writes cleanly.","verifiedFacts":[{"claim":"the store test fails intermittently in-suite only","evidence":"tests/unit/checkpoint-store.test.ts:1","howVerified":"ran the suite 30 times locally"}],"requirementsBody":"R1: the concurrency test passes 10 consecutive full-suite runs.","errorBehaviours":["if two checkpoint writers race on the same store file then the system shall serialise the writes with a file lock","IF a writer crashes mid-write THEN THE SYSTEM SHALL leave the prior committed row intact","IF the lock cannot be acquired within the timeout THEN THE SYSTEM SHALL reject the write with a named reason"],"scopePin":{"inScope":[".pi/extensions/checkpoint/store.ts"],"outOfScope":[{"item":"rewriting the checkpoint format entirely","reason":"out of scope for a concurrency fix"}],"expectedFiles":[".pi/extensions/checkpoint/store.ts","tests/unit/checkpoint-store.test.ts"]},"clarificationsBody":"- Q: should the lock be process-wide or file-scoped? -> A: file-scoped, per store.ts's own design.","assumptionsBody":"- Assumes the OS file lock primitive is available on both Windows and macOS.","scorecardBody":"Score: 0.10 (all four dimensions above floor)."}}: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/unit/spec-error-behaviour.test.ts:303:83

 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

### Falsification (b) -- change `MIN_ERROR_BEHAVIOURS` to 1

Exactly the count-defect case turned RED, as predicted.

```
 ❯ tests/unit/spec-error-behaviour.test.ts (20 tests | 1 failed) 9ms
     × '§4 with only 2 well-formed entries' -> false ('FLOW-04\'s own text: \'Mandatory, min…') 4ms

AssertionError: expected ok=false, got {"ok":true,...,"errorBehaviours":["IF two checkpoint writers race on the same store file THEN THE SYSTEM SHALL serialise the writes with a file lock","IF a writer crashes mid-write THEN THE SYSTEM SHALL leave the prior committed row intact"],...}: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ tests/unit/spec-error-behaviour.test.ts:303:83

 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

### Falsification (c) -- make the Root Cause gate unconditional (`const fixFramed = true;`, ignoring `options`/`goal` entirely)

**Stronger than the plan's own prediction** ("the NON-fix-framed accept case must turn RED"): every accept fixture using the default non-fix-framed goal turned red -- not only the one dedicated "NON-fix-framed goal with no Root Cause" row, but also the "3 conforming entries" positive control, the "fully well-formed SPEC" case, and the round-trip case (all of which also default to a non-fix-framed goal with no Root Cause section). This is the correct, more thorough outcome: an unconditional Root Cause gate breaks every accepting fixture that lacks the section, which in this suite is every accepting fixture except none -- the base fixture set was deliberately built with a non-fix-framed default goal, so the conditionality is load-bearing everywhere, not just in the one case named for it.

```
 ❯ tests/unit/spec-error-behaviour.test.ts (20 tests | 4 failed) 9ms
     × '§4 with 3 conforming entries (positiv…' -> true ('the shape §4 itself demands, with eve…') 3ms
     × 'NON-fix-framed goal with no Root Caus…' -> true ('proves QUAL-03\'s gate is CONDITIONAL…') 0ms
     × 'a fully well-formed SPEC' -> true ('the baseline positive control, also u…') 0ms
     × round-trips: renderSpecMarkdown(validateSpec(wellFormed).spec) is itself accepted by validateSpec

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: expected ok=true, got {"ok":false,"reason":"this SPEC is fix-framed (QUAL-03) but carries no \"Root Cause\" section naming the cause with file:line evidence"}: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ tests/unit/spec-error-behaviour.test.ts:303:83

AssertionError: expected false to be true // Object.is equality
 ❯ tests/unit/spec-error-behaviour.test.ts:317:20

 Test Files  1 failed (1)
      Tests  4 failed | 16 passed (20)
```

### Falsification (d) -- remove the `EXPECTED_FILE_PATTERN` check (`if (path === undefined || false)`)

Exactly the two path-shape-specific reject cases (glob, `..`) turned RED, as predicted; everything else stayed green, including the empty-expected-files-list case, whose reject comes from a different branch entirely.

```
 ❯ tests/unit/spec-error-behaviour.test.ts (20 tests | 2 failed) 9ms
     × '§5 expected-files entry that is a glob' -> false ('a glob makes \'is this diffed path in…') 3ms
     × '§5 expected-files entry containing ..' -> false ('a parent-directory escape widens the …') 0ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: expected ok=false, got {"ok":true,...,"expectedFiles":[".pi/extensions/checkpoint/*.ts"]},...}: expected true to be false // Object.is equality
AssertionError: expected ok=false, got {"ok":true,...,"expectedFiles":["../outside/store.ts"]},...}: expected true to be false // Object.is equality

 Test Files  1 failed (1)
      Tests  2 failed | 20 passed (20)... (2 failed, 18 passed)
```

After each falsification, the source file was restored and `git diff --stat .pi/extensions/grill/spec-schema.ts` confirmed empty before proceeding.

## Issues Encountered

None beyond the one auto-fixed deviation documented above (a `sed`-escaping mistake caught before it touched any commit).

## Known Stubs

None. `spec-schema.ts` is a complete, pure module -- every new export (`validateSpec`, `renderSpecMarkdown`, the §4/§5/Root Cause parsers) is a real implementation with no placeholder value, no hardcoded empty return feeding a UI, and no "coming soon" text.

## Threat Flags

None beyond this plan's own `<threat_model>`, all of which were dispositioned by the plan itself and closed by this implementation:
- T-09-06-01 (over-broad expected-files entry) -- `EXPECTED_FILE_PATTERN` rejects a leading `/`, `..`, and every glob metacharacter; falsification (d) proved the check is load-bearing.
- T-09-06-02 (unconditional Root Cause gate goes unnoticed) -- the mandatory non-fix-framed accept case plus falsification (c) close this.
- T-09-06-03 (case-insensitive `IF_THEN_PATTERN`) -- falsification (a) proves the lower-case half is caught; the SHOULD-variant reject is independently robust to this specific loosening (see falsification (a)'s own honest recording above).
- T-09-06-04 (catastrophic backtracking) -- bounded lazy quantifiers plus a 10 KB adversarial single-entry timing test.
- T-09-06-05 (work-repo write) -- accepted per 09-03's `.pi/work/` git-ignore; `renderSpecMarkdown` returns a string and writes nothing.
- T-09-06-SC (supply chain) -- no install occurred; `tests/unit/pinning.test.ts` unaffected.

No new network endpoint, auth path, file access pattern, or schema change at a trust boundary was introduced beyond what the plan already named.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `.pi/extensions/grill/spec-schema.ts` now exports the complete SPEC.md schema/validator/renderer surface plan 09-08 needs to wire `/grill`'s actual write path: `parseSpecSections`, `gateRequirementsAuthorship` (from 09-05), and now `validateSpec`/`renderSpecMarkdown` (this plan).
- FLOW-05 stays `[ ]` Partial in `REQUIREMENTS.md` until plan 09-14 builds the diff half (comparing the declared expected-files list against a real `git diff --name-only`) -- that plan's acceptance criteria should call `parseScopePin`/`EXPECTED_FILE_PATTERN` directly rather than reimplementing any part of this logic.
- No blockers. Full suite (111 files, 2120 tests) green; `npx tsc --noEmit` clean at completion.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/unit/spec-error-behaviour.test.ts`
- FOUND: `.pi/extensions/grill/spec-schema.ts`
- FOUND commit: `9f65a06` (Task 1)
- FOUND commit: `576e7ab` (Task 2)
- CONFIRMED: `git diff --stat .pi/extensions/grill/spec-schema.ts` empty after all four falsification restores
