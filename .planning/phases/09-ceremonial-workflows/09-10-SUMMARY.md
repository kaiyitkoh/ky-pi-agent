---
phase: 09-ceremonial-workflows
plan: 10
subsystem: workflows
tags: [plan-ceremony, plan-schema, spec-gate, coverage-matrix, ceremonial-workflows]

# Dependency graph
requires:
  - phase: 09-ceremonial-workflows
    provides: "plan 09-09's plan-schema.ts (validatePlan, renderPlanMarkdown, filesTouchedUnion, TASK_LINE_PATTERN) -- wired here to /plan's actual write path for the first time; plan 09-05/09-06's spec-schema.ts (validateSpec, SpecArtifact, EXPECTED_FILE_PATTERN) as the pre-flight gate over the on-disk SPEC.md; plan 09-03's .pi/lib/work-artifacts.ts (workDir, SLUG_PATTERN); plan 09-08's own /grill precedent (thin command, writeXIfGated shape, skill-body-as-tables discipline) copied rather than re-derived"
provides:
  - "/plan -- a Pi command (zero tools), one entry point, gated by classifyGitInvocation, then slug resolution, then validateSpec re-run on the on-disk SPEC.md every invocation"
  - "writePlanIfGated(cwd, slug, markdown) -- the ONLY function in .pi/extensions/plan-ceremony/ that writes PLAN.md; re-reads and re-validates the on-disk SPEC.md, derives its requirement ids, then runs validatePlan before ever writing, and always writes renderPlanMarkdown's re-rendering of the validated artifact, never the raw incoming text"
  - "extractSpecRequirementIds (requirement-ids.ts) -- a small pure §3 requirement-id extractor (every R<digits> token, deduplicated, numerically sorted) feeding validatePlan's coverage argument, kept out of index.ts to preserve WORKFLOW_TEXT_BUDGETS headroom for the skill body"
  - ".pi/skills/plan-ceremony/SKILL.md -- the task-line grammar, the both-directions coverage rule, the three PLAN.md parts each with a named consumer, and the 'what will refuse you' list, each as a table"
affects: [09-13 (/execute, the next thin command in Group A -- reads PLAN.md's task list and files-touched union), 09-15 (/review -- reads the coverage matrix into its verdict table and the files-touched union into its drift baseline), 09-16 (phase-closing WORKFLOW_TEXT_BUDGETS completeness gate), REQUIREMENTS.md row FLOW-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A gate-composing write function (writePlanIfGated) that RE-READS its own upstream artifact from disk rather than trusting a caller-supplied summary of it -- unlike writeSpecIfGated (which validates only the incoming markdown parameter, since /grill IS producing SPEC.md fresh), writePlanIfGated additionally re-reads and re-validates the on-disk SPEC.md every invocation, because /plan's second validatePlan argument (the SPEC's own requirement ids) does not exist as a typed field anywhere -- SpecArtifact.requirementsBody is deliberately free text (09-09-SUMMARY.md's own design note). This is the T-09-10-01 mitigation made concrete: a prior verdict is never trusted, the write path proves the gate itself, every time."
    - "A robust-to-unspecified-markdown-shape id extractor, not a heading convention invented and then hoped for -- extractSpecRequirementIds treats every bounded R<digits> token anywhere in §3's body as a requirement id, rather than requiring a specific bullet/heading structure nobody has defined yet. Mirrors 09-08's own §8-scorecard-shape precedent (an invention filling a genuine gap) but chooses the more permissive rule since, unlike §8's structured scorecard, §3's prose shape is explicitly left open by FEATURES.md."
    - "Ambiguous cross-invocation state resolution REFUSES rather than picks, even by mtime -- ambiguity here specifically means 'more than one .pi/work/ directory carries a SPEC.md', not 'ties in modification time'; ANY count greater than one refuses naming every candidate, matching the plan's own acceptance criterion over the (superficially different-sounding) 'the single most recently modified directory' plan text, which describes the accept path (a filtered set of size exactly one) rather than a tie-breaking heuristic for a larger set."

key-files:
  created:
    - .pi/extensions/plan-ceremony/index.ts
    - .pi/extensions/plan-ceremony/requirement-ids.ts
    - .pi/skills/plan-ceremony/SKILL.md
    - tests/integration/plan-command.test.ts
  modified:
    - tests/unit/workflow-budgets.test.ts

key-decisions:
  - "writePlanIfGated re-reads SPEC.md off disk (via workDir(cwd, slug)) rather than accepting a pre-validated SpecArtifact as a parameter -- keeps the function's own contract self-contained and re-provable independent of caller discipline, at the cost of a second validateSpec call beyond the handler's own pre-flight. Accepted as deliberate defense-in-depth, mirroring the same 'never trust a prior verdict' rule the threat register (T-09-10-01) states for the pre-flight itself."
  - "extractSpecRequirementIds is a NEW small module (requirement-ids.ts), not named in the plan's own <files> list for either task -- necessary because validatePlan's second argument (specRequirementIds: readonly string[]) has no existing producer anywhere in the codebase: spec-schema.ts's SpecArtifact carries only requirementsBody as free text. Kept out of index.ts specifically to preserve the 200-line WORKFLOW_TEXT_BUDGETS ceiling's headroom for the skill body, the identical reason grill/scorecard-parse.ts was kept out of grill/index.ts in plan 09-08."
  - "Slug-ambiguity resolution is a hard refusal over ANY candidate count greater than one, never an mtime-based pick -- even though 'the single most recently modified directory' language in the plan's own action text could be misread as a tie-breaking rule, task 2's own acceptance criterion ('two candidate slugs present and no arg supplied -> refuses naming both candidates rather than picking one') is unambiguous and is what was implemented and tested."

requirements-completed: ["FLOW-06"]

# Metrics
duration: ~14min
completed: 2026-08-16
---

# Phase 9 Plan 10: The /plan command -- thin, SPEC-gated, coverage-complete PLAN.md writes Summary

**A one-entry-point, zero-tool `/plan` command whose only PLAN.md write path re-validates the on-disk SPEC.md and derives its requirement ids before ever calling `validatePlan`, paired with a 44-line skill body -- combined readable text 184 raw lines against the tightest ceiling in the phase (200).**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-08-16T00:05:10+08:00 (approx, prior plan's completion commit)
- **Completed:** 2026-08-16T00:16:17+08:00
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- `.pi/extensions/plan-ceremony/index.ts` (140 raw lines): registers exactly one command, `plan`, zero tools. Handler runs as one visible top-to-bottom sequence -- git pre-flight (`classifyGitInvocation`, the exact call shape copied from `workflows/index.ts:36-40` and `grill/index.ts`) -> slug resolution (an explicit arg, or the SOLE `.pi/work/` subdirectory carrying a SPEC.md; two or more REFUSES naming every candidate) -> SPEC pre-flight (existence, then `validateSpec` re-run on the on-disk bytes every invocation, refusing with the validator's own reason) -> idle guard -> hand off to the ordinary prompt loop via `pi.sendUserMessage`.
- `writePlanIfGated(cwd, slug, markdown)`: the ONLY function in `.pi/extensions/plan-ceremony/` that writes `PLAN.md`. Re-reads and re-validates the on-disk `SPEC.md` (never trusts a prior verdict), derives the SPEC's own requirement ids via `extractSpecRequirementIds`, then runs `validatePlan` -- refusing with the failing predicate's own reason on the first failure, and only ever writing `renderPlanMarkdown`'s re-rendering of the validated artifact, never the raw `markdown` parameter.
- `.pi/extensions/plan-ceremony/requirement-ids.ts` (42 raw lines): a small, pure §3 requirement-id extractor (`extractSpecRequirementIds`) -- every bounded `R<digits>` token found anywhere in the Requirements section body is a requirement id, deduplicated and sorted numerically. Deliberately a separate module, not inlined in `index.ts`, so it counts only against the `.pi/extensions/plan-ceremony` `DIRECTORY_BUDGETS` ratchet (ample headroom) rather than the frozen 200-line `WORKFLOW_TEXT_BUDGETS` `plan` ceiling.
- `.pi/skills/plan-ceremony/SKILL.md` (44 raw lines): the task-line grammar as one table (element, required/optional, example, what code rejects, naming the `VERIFICATION_SEPARATOR` token), the both-directions coverage rule stated in two lines, the three PLAN.md parts each with a named downstream consumer (task list -> `/execute`; coverage matrix -> `/review`'s verdict table; files-touched union -> `/review`'s drift baseline), a one-line note that a declared path is a PERMISSION for `/execute`, and a "what will refuse you" list naming `validateSpec` and `validatePlan`'s branches.
- `tests/integration/plan-command.test.ts` (six cases): `/plan` and `/plan-mode` both resolve at zero registered tools; a protected-branch refusal matches `classifyGitInvocation`'s own reason at zero provider requests; no `SPEC.md` anywhere refuses at zero provider requests; the LOAD-BEARING case -- a `SPEC.md` present on disk that fails `validateSpec` refuses with the validator's own reason (proven distinct from an existence-only check by falsification, see below) at zero provider requests; two candidate slugs with no arg refuses naming BOTH; `writePlanIfGated` with a plan covering only `R1` while the SPEC also declares `R2` asserts `PLAN.md`'s ABSENCE on disk, not merely a reject verdict.
- `WORKFLOW_BUDGETS` gains rows for `index.ts` (140) and `SKILL.md` (50); the `.pi/extensions/plan-ceremony` `DIRECTORY_BUDGETS` row is re-measured 580 -> 760 (plan-schema.ts 578 + index.ts 140 + requirement-ids.ts 42 = 760, an exact multiple of ten); `WORKFLOW_TEXT_BUDGETS` gains the `plan` row (budget 200, frozen, measured 140+44=184, 16 lines of headroom). Two falsifications performed and recorded verbatim below, both restored clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: the /plan command -- thin, SPEC-gated** - `c4b9835` (feat)
2. **Task 2: .pi/skills/plan-ceremony/SKILL.md, the 200-line ceiling, and the integration test** - `8125d3a` (test)

**Plan metadata:** _pending -- final commit created after this SUMMARY._

## Files Created/Modified

- `.pi/extensions/plan-ceremony/index.ts` (140 raw lines) - `writePlanIfGated`, `resolveSlug`, `candidateSlugsWithSpec`, the `plan` command registration
- `.pi/extensions/plan-ceremony/requirement-ids.ts` (42 raw lines) - `extractSpecRequirementIds`, `REQUIREMENT_ID_PATTERN`
- `.pi/skills/plan-ceremony/SKILL.md` (44 raw lines) - task-line grammar table, coverage rule, the three-part/consumer table, refusal list
- `tests/integration/plan-command.test.ts` (six cases) - registration, four refusal seams, write-path gate proof
- `tests/unit/workflow-budgets.test.ts` - two new `WORKFLOW_BUDGETS` rows, the re-measured `.pi/extensions/plan-ceremony` `DIRECTORY_BUDGETS` row, the new `WORKFLOW_TEXT_BUDGETS` `plan` row

## Decisions Made

See `key-decisions` in the frontmatter above. In short: `writePlanIfGated` re-reads and re-validates `SPEC.md` off disk rather than trusting a caller-supplied requirement-id list; `extractSpecRequirementIds` is a new small module filling a genuine gap (no code anywhere already turns §3's free text into a requirement-id list); and slug-ambiguity resolution is a hard refusal over any candidate count above one, never an mtime tie-break, per the plan's own acceptance criterion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] No §3 requirement-id extractor existed anywhere in the codebase**
- **Found during:** Task 1, wiring `writePlanIfGated`'s call to `validatePlan(markdown, spec.requirementIds)`
- **Issue:** The plan's own action text calls for `validatePlan(markdown, spec.requirementIds)`, but `spec-schema.ts`'s `SpecArtifact` (09-05/09-06) has no `requirementIds` field -- only `requirementsBody`, deliberately left as free text, since FEATURES.md Part 2 prescribes only the overall "R1..Rn" §3 convention, not a markdown structure for an individual requirement entry.
- **Fix:** Added `.pi/extensions/plan-ceremony/requirement-ids.ts`, a small pure extractor (`extractSpecRequirementIds`) that treats every bounded `R<digits>` token anywhere in the §3 body as a requirement id, deduplicated and numerically sorted -- not named in the plan's own task-1 `<files>` list, since it is necessary for the write-path gate to function at all, and keeping it out of `index.ts` was the only way to leave the skill body enough of the 200-line `WORKFLOW_TEXT_BUDGETS` ceiling to actually carry the required content.
- **Files modified:** `.pi/extensions/plan-ceremony/requirement-ids.ts` (new), `.pi/extensions/plan-ceremony/index.ts` (imports it), `tests/unit/workflow-budgets.test.ts` (the `.pi/extensions/plan-ceremony` `DIRECTORY_BUDGETS` re-measure accounts for the new file)
- **Verification:** `writePlanIfGated`'s own integration test exercises the full read-SPEC -> extract-ids -> `validatePlan` chain including this extractor; `npx tsc --noEmit` clean; full suite green.
- **Committed in:** `c4b9835` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 2 missing-functionality), found and fixed while wiring Task 1's own write path, before that task's commit.
**Impact on plan:** Necessary for the plan's own stated acceptance criteria to be genuinely met -- a working `writePlanIfGated` write path could not otherwise call `validatePlan` at all. No architectural change, no scope creep beyond one small supporting module the write-gate could not function without.

## Falsifications (recorded verbatim, per this plan's `<verification>` requirement and task 2's own acceptance criteria)

Falsification (a) was performed by editing `.pi/extensions/plan-ceremony/index.ts`'s pre-flight branch in place via the `Edit` tool (appending `&& false` to neuter the `validateSpec` reject branch, so the pre-flight becomes existence-only in effect), running the targeted integration test, capturing the RED output below, then reverting and confirming `git diff --stat` was empty. Falsification (b) was performed identically against `tests/unit/workflow-budgets.test.ts`'s `plan` `WORKFLOW_TEXT_BUDGETS` row.

### Falsification (a) -- neuter the pre-flight's `validateSpec` reject branch (existence check only)

```
 ❯ tests/integration/plan-command.test.ts (6 tests | 1 failed | 5 skipped) 294ms
     × case 3 (LOAD-BEARING) -- a SPEC.md on disk that FAILS validateSpec refuses with the validator's own reason, at zero provider requests 292ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: a refusal must still report an outcome: expected +0 to be 1 // Object.is equality

- Expected
+ Received

- 1
+ 0

 ❯ tests/integration/plan-command.test.ts:216:76

 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
```

Exactly the load-bearing case turned RED, as predicted: with the reject branch neutered, the handler proceeds past the existence-only check straight to `sendUserMessage`, producing zero notifications instead of a refusal.

### Falsification (b) -- raise the `plan` row's `WORKFLOW_TEXT_BUDGETS` budget from 200 to 210

```
 ❯ tests/unit/workflow-budgets.test.ts (98 tests | 1 failed | 84 skipped) 103ms
     × 'plan''s budget IS the FEATURES.md ceiling -- it may not move to absorb growth 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

AssertionError: plan's WORKFLOW_TEXT_BUDGETS budget is 210 but FEATURES_CEILINGS['plan'] is 200 -- unlike
WORKFLOW_BUDGETS/DIRECTORY_BUDGETS, this ceiling is not a rounded measurement; it is the spec number from
FEATURES.md Part 2, and it MAY NOT MOVE. Over budget means cut text, not raise the number: expected 210 to be 200

Expected: 200
Received: 210

 Test Files  1 failed (1)
      Tests  1 failed | 13 passed | 84 skipped (98)
```

After each falsification, the source/test file was restored and `git diff --stat` confirmed empty before proceeding.

## Issues Encountered

None beyond the one auto-fixed deviation documented above.

## Measured `plan` Text Total Against the 200-Line Ceiling

`.pi/extensions/plan-ceremony/index.ts` (140 raw lines) + `.pi/skills/plan-ceremony/SKILL.md` (44 raw lines) = **184 raw lines**, against `FEATURES_CEILINGS.plan = 200` (frozen, `tests/unit/workflow-budgets.test.ts`'s `WORKFLOW_TEXT_BUDGETS` `plan` row). 16 lines of headroom remain -- the tightest margin of the two ceremonial workflows built so far (`grill` has 57 lines of headroom against its 250 ceiling), consistent with `/plan`'s ceiling being the tightest of the four (200 vs. 250/250/250).

## Known Stubs

None. `writePlanIfGated` is a complete, working write path -- no hardcoded empty return, no "coming soon" text, no component wired to mock data. The one thing it cannot do (drive a live multi-turn `/plan` session end to end against a real model, writing a genuine task list the model composed) is explicitly out of scope for an offline, no-credentials test suite -- the same limit `grill-command.test.ts` accepts for `/grill`'s own `pi.sendUserMessage` hand-off. A scripted faux session proves every refusal seam and the write-gate structurally; it cannot prove what a real model does with the skill's instructions, which is `/plan`'s own live-usage validation, not a machine-checkable gate.

## Threat Flags

None beyond what this plan's own `<threat_model>` already named and dispositioned (T-09-10-01 through T-09-10-06, T-09-10-SC, all `mitigate`). `requirement-ids.ts` is the one file not explicitly named in the plan's threat register; it introduces no new trust boundary -- it is a pure text-in/data-out extractor over text that has already passed `validateSpec` by the time `writePlanIfGated` calls it, and a §3 body with zero, malformed, or adversarial `R<digits>`-shaped tokens degrades gracefully into `validatePlan`'s own coverage branches (an empty extracted-id list makes every task's requirement citation "invented" per branch (7), never a silent accept).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `/plan` is a working, gated command: `.pi/extensions/plan-ceremony/index.ts`, `requirement-ids.ts`, `.pi/skills/plan-ceremony/SKILL.md`.
- FLOW-06 is now complete -- this plan wired 09-09's `validatePlan`/`renderPlanMarkdown` to the actual `/plan` write path, closing the "wiring it to /plan's actual write path is plan 09-10's job" gap both plan-schema.ts's and 09-09-SUMMARY.md's own docstrings flagged as open.
- `TOOL_REGISTRATION_ALLOWLIST` unchanged at 5 entries; model-facing tool count unchanged with zero net change this phase (`tool-count-baseline.test.ts` green, unedited).
- `FEATURES_CEILINGS` unchanged (250/200/250/250/100) -- the mechanism that exists specifically to prevent Phase 9 from repeating GSD's own 1,169-line `quick.md` was never edited to make a failing assertion pass.
- Precedent reinforced for the remaining two ceremonial commands (`/execute` plan 09-13, `/review` plan 09-15): keep the command file thin, move supporting parsers to sibling modules bound only by `DIRECTORY_BUDGETS`, write the skill body as tables, and where a validator's second argument has no existing producer in the codebase, add one as a small pure module rather than overclaiming a shape nobody defined.
- No blockers. Full suite (115 files, 2183 tests) green; `npx tsc --noEmit` clean at completion.

---
*Phase: 09-ceremonial-workflows*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: `.pi/extensions/plan-ceremony/index.ts`
- FOUND: `.pi/extensions/plan-ceremony/requirement-ids.ts`
- FOUND: `.pi/skills/plan-ceremony/SKILL.md`
- FOUND: `tests/integration/plan-command.test.ts`
- FOUND commit: `c4b9835` (Task 1)
- FOUND commit: `8125d3a` (Task 2)
- CONFIRMED: `git diff --stat` empty after both falsification restores
