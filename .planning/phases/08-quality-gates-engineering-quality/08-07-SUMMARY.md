---
phase: 08-quality-gates-engineering-quality
plan: 07
subsystem: quality
tags: [gate-02, reviewer, redaction, anti-review-theatre, submit_review, chokepoint]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality
    provides: "08-01 (RunSingleShotRoleOptions.tools threaded through runSingleShotRole), 08-03 (submitReviewParameters/validateReview/NIT_CAP -- the REVIEW schema), 08-04 (addQualityCost -- the quality-cost ledger)"
provides:
  - "buildReviewerContext(input): the six-element fixed context contract, redacted, throwing per missing element"
  - "buildImportGraph(sources): the pure, syntax-level declared import graph"
  - "REVIEWER_SYSTEM_PROMPT: the adversarial framing, kept byte-identical (mod whitespace) to .pi/agents/reviewer.md's prompt body"
  - "runReview(ctx, {contract, requirementIds}): dispatches through runSingleShotRole with the submit_review tool, times and reports QUAL-09 cost, refuses a prose-only reply before validateReview runs"
  - ".pi/agents/reviewer.md: the eventual real-subagent path's agent file, no model:/fallbackModels: key, honestly not load-bearing today (RB-08-03)"
affects: [08-09-refute-pass, 09-ceremonial-workflows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One pure context-builder + one pure syntax-level graph-builder + one impure dispatcher, mirroring quality/gates.ts's own PURE-except-clearly-separated-impure-functions discipline"
    - "A named allowlist (UNROUTED_AGENT_ALLOWLIST) for a deliberately un-routed agent file, mirroring chokepoint-lint.test.ts's CHOKEPOINT_BYPASS_ALLOWLIST shape"

key-files:
  created:
    - .pi/extensions/quality/reviewer.ts
    - .pi/agents/reviewer.md
    - tests/integration/reviewer-contract.test.ts
  modified:
    - tests/unit/subagent-agents-config.test.ts

key-decisions:
  - "importGraph's 'absent' check is on the ARRAY OF PER-FILE ENTRIES, not any individual entry's `to` list -- buildImportGraph always emits one entry per source (even an empty `to` for a file that imports nothing), so a non-empty touchedFiles fed through it always yields a non-empty importGraph, and the six-element throw only fires when a caller skipped building the graph entirely"
  - "buildReviewerContext's element-presence rule is trim().length===0 for diff/gateReport and length===0 for the four arrays -- a deliberate simplification recorded here since the plan's own wording ('absent') is otherwise ambiguous for an array-shaped element"
  - "runReview never catches a thrown guard refusal from runSingleShotRole -- a refusal (no configured candidate, capability mismatch) never reached a model at all, so nothing was spent and nothing needs to be charged against the QUAL-09 ledger; it is left to propagate, matching runSingleShotRole's own documented zero-request refusal contract"

requirements-completed: [GATE-02]

# Metrics
duration: "~1h10m"
completed: 2026-08-15
---

# Phase 08 Plan 07: Reviewer Context Contract and Adversarial Prompt Summary

**`buildReviewerContext` assembles GATE-02's fixed six-element contract (diff, full file contents, gate report, requirements, files-touched union, declared import graph), redacts it through the existing `redactString`, and `runReview` dispatches it through `runSingleShotRole` with the `submit_review` tool -- proven on the CAPTURED outgoing request from a real `makeTempRepo()` fixture, never on the builder's return value alone.**

## Performance

- **Duration:** ~1h10m
- **Completed:** 2026-08-15
- **Tasks:** 2 (both complete)
- **Files modified:** 4 (3 created, 1 modified as a Rule 3 deviation)

## Accomplishments

- `buildReviewerContext(input): string` -- PURE. Renders the six contract elements as six clearly-labelled, fixed-order Markdown sections, throws a distinct, element-naming `Error` when any one of the six is absent (checked before any rendering happens), and passes the whole assembled string through `redactString` (never a re-implementation) before returning.
- `buildImportGraph(sources)` -- PURE, syntax-level. Collects each source's `import ... from "<specifier>"` targets via a lazy, newline-crossing regex; deliberately the DECLARED graph, not a resolved module graph, and dynamic `import()` is explicitly out of scope. Always emits one entry per source, so a non-empty `touchedFiles` always yields a non-empty `importGraph` -- see Decisions.
- `REVIEWER_SYSTEM_PROMPT` -- carries the four named soft-failure phrases verbatim (stopping at surface issues; treating tests-pass as correctness; downgrading BLOCKER to WARNING to avoid seeming harsh; approving when unsure), the anti-padding counter-instruction, the mandatory per-requirement-verdict and non-empty-`checkedAndCleared` instructions, and the statement that `submit_review` is the only accepted output. States in its own module comment that it is a delivery mechanism, not the enforcement -- `validateReview` (08-03) is the enforcement.
- `runReview(ctx, {contract, requirementIds})` -- the ONE impure export. Builds the context, dispatches via `runSingleShotRole(ctx, {role:"reviewer", systemPrompt, messages, need:{}, tools:[submit_review]})`, times the call and reports `addQualityCost({ms, tokens})` (QUAL-09's ledger), and returns `{ok:false}` naming that prose arrived when no `submit_review` tool call is found -- the "LGTM" path fails here, before `validateReview` is ever reached, not only inside it.
- `.pi/agents/reviewer.md` -- copies `planner.md`'s frontmatter shape exactly (`name`/`description`/`tools`/`thinking: high`/`systemPromptMode: replace`/`inheritProjectContext: false`/`inheritSkills: false`, no `model:`, no `fallbackModels:`), with a trailing HTML comment stating honestly that this phase dispatches the reviewer via `runSingleShotRole` (`ROLE_MECHANISM.reviewer === "call-model"`), so `AGENT_NAME_BY_ROLE` does not map it and this file is not load-bearing at runtime today -- it exists for the eventual real-subagent path, `RB-08-03`, OUTSTANDING. The prompt body is kept byte-identical (mod trailing whitespace) to `REVIEWER_SYSTEM_PROMPT`, proven by a live equality test.
- `tests/integration/reviewer-contract.test.ts` -- a REAL `makeTempRepo()` fixture (`src/b.ts` committed, then `src/a.ts` committed importing it, then a third commit changing `src/a.ts` only via `git diff --unified=0`) drives `runReview` through a faux `deepseek` provider whose response factory captures the outgoing `context` (messages + system prompt + tools) and `options`. Asserts, on that captured request: all six contract elements (including a "full contents carries a line the zero-context diff genuinely does not" proof, sanity-checked by the fixture builder itself), the tools array is exactly `["submit_review"]`, all four soft-failure phrases individually, and the secret-shaped fixture token's absence paired with a non-secret control string's presence. Three negative controls: a prose-only reply refused before the validator runs, a `submit_review` call missing `checkedAndCleared` refused BY the validator, and a truncated contract (`diff:""`) throwing before any request with the faux provider's own call count unchanged. A final `describe` block asserts `.pi/agents/reviewer.md`'s prompt body agrees with `REVIEWER_SYSTEM_PROMPT`.

## Task Commits

1. **Task 1: Assemble the context contract and the adversarial system prompt** - `7306a1b` (feat)
2. **Task 2: Prove all six elements reach the wire, and that the agent file matches the prompt** - `6cb4955` (test)
3. **Deviation fix (Rule 3): agent-file/role completeness exception** - `38055db` (fix)

## Falsification Proof (Task 2's own acceptance criteria)

Run against the fully-committed, working `reviewer.ts` (commit `7306a1b`), one mutation at a time, restored via `git checkout -- .pi/extensions/quality/reviewer.ts` before the next:

| Mutation | Test command | Result |
|---|---|---|
| Removed the "Full Contents of Every Touched File" section from `buildReviewerContext`'s `sections` array | `npx vitest run tests/integration/reviewer-contract.test.ts` | 2 failed / 15 passed -- exactly assertion 2 (the `farFromChangeLine` full-contents proof) turned red, plus the redaction control-string presence check (the same removed section carried `NON_SECRET_CONTROL`) -- both are the same root cause, not two independent bugs |
| Restored via `git checkout --`; confirmed `git diff --stat` empty | -- | clean restore |
| Replaced `return redactString(sections.join("\n\n"));` with `return sections.join("\n\n");` | `npx vitest run tests/integration/reviewer-contract.test.ts` | 1 failed / 16 passed -- exactly the redaction case (`SECRET_FIXTURE_TOKEN` reached the captured request unredacted) turned red; every other case, including the six-element and full-contents cases, stayed green |
| Restored via `git checkout --`; confirmed `git diff --stat` empty | -- | clean restore |

Final state: `npx tsc --noEmit` clean; `npx vitest run tests/integration/reviewer-contract.test.ts tests/unit` 1637/1637 green across 66 files.

## Files Created/Modified

- `.pi/extensions/quality/reviewer.ts` (409 lines) -- `ReviewerContractInput`/`TouchedFile`/`ReviewRequirement`/`ImportGraphEntry`, `buildReviewerContext`, `buildImportGraph`, `REVIEWER_SYSTEM_PROMPT`, `runReview`.
- `.pi/agents/reviewer.md` (41 lines) -- the eventual real-subagent path's agent file.
- `tests/integration/reviewer-contract.test.ts` (522 lines) -- the wire-capture proof, negative controls, and the agent-file/prompt drift guard.
- `tests/unit/subagent-agents-config.test.ts` (Rule 3 deviation) -- `UNROUTED_AGENT_ALLOWLIST` and its staleness check.

## Decisions Made

See `key-decisions` in the frontmatter. In addition:

- **`runReview`'s tools array carries exactly one `Tool`, built inline from `SUBMIT_REVIEW_TOOL_NAME`/`SUBMIT_REVIEW_DESCRIPTION`/`submitReviewParameters` (all from 08-03's `review-schema.ts`)** -- no second schema or description was authored; this module is a pure consumer of plan 08-03's exports, per the plan's own instruction that `submit_review` is a reviewer-scoped schema, not a main-loop tool registration.
- **The diff fixture uses `git diff --unified=0`** rather than the default 3-line context, so the "full contents carries a line the diff does not" proof is genuinely non-vacuous: with default context on a file this short, the marker line would likely be swept into the hunk anyway, and the assertion would pass without the full-contents section actually being needed.
- **`capturedText()` in the test file joins raw message content, never `JSON.stringify`** -- the first draft asserted against `JSON.stringify(context.messages)`, whose escaped double-quotes made a literal `KEEP_MARKER` line assertion fail against text that was genuinely present; caught immediately by running the test, not left in.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `.pi/agents/reviewer.md`, written exactly as the plan specifies, tripped a pre-existing, plan-external completeness check**

- **Found during:** Running the plan's own stated verification command (`npx vitest run tests/integration/reviewer-contract.test.ts tests/unit`) after Task 2's commit.
- **Issue:** `tests/unit/subagent-agents-config.test.ts` (07-04, EXT-01) asserts, in both directions, that every tracked `.pi/agents/*.md` file names a role in `AGENT_NAME_BY_ROLE` and vice versa. Plan 08-07 explicitly instructs `.pi/agents/reviewer.md` to be shipped WITHOUT such a mapping -- the reviewer is dispatched via `runSingleShotRole`, not the subagent/`agentOverrides` mechanism this test's completeness check assumes every shipped agent file participates in. The two are in direct, foreseeable tension: satisfying the plan's own instruction as written necessarily fails this pre-existing test.
- **Fix:** Added `UNROUTED_AGENT_ALLOWLIST` to `subagent-agents-config.test.ts` -- a named-stem-plus-written-reason list, mirroring `chokepoint-lint.test.ts`'s `CHOKEPOINT_BYPASS_ALLOWLIST` shape exactly, citing `RB-08-03`. Added a symmetric staleness check (every allowlist entry must correspond to a real shipped file) so the exception itself cannot silently drift once the reviewer role is eventually wired up.
- **Files modified:** `tests/unit/subagent-agents-config.test.ts`
- **Verification:** `npx vitest run tests/unit/subagent-agents-config.test.ts` green (14/14); full suite (`tests/integration/reviewer-contract.test.ts tests/unit`) green (1637/1637 across 66 files); `npx tsc --noEmit` clean.
- **Committed in:** `38055db`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking, a pre-existing test's invariant directly tripped by this plan's own specified change).
**Impact on plan:** No scope change. The deviation is a minimal, reasoned exception to an unrelated (in origin) but directly-affected test, not a rewrite of this plan's own deliverables.

## Known Stubs

None. `reviewer.ts` is fully wired: `buildReviewerContext`/`buildImportGraph` are pure and complete, `runReview` genuinely dispatches through the chokepoint and validates the result. `.pi/agents/reviewer.md` is honestly documented as not load-bearing at runtime today (its own trailing comment states this, and the completeness-check exception above states the same fact machine-enforced) -- this is a stated, tracked limitation (`RB-08-03`), not a hidden stub.

## Threat Flags

None. All six T-08-22..T-08-26 mitigations named in the plan's threat register are exercised directly by `tests/integration/reviewer-contract.test.ts`: T-08-22 (redaction, secret-absent/control-present), T-08-23 (dispatch only via `runSingleShotRole`; `chokepoint-lint.test.ts` unweakened and unexempted, confirmed green), T-08-24 (a prose-only reply refused, naming that prose arrived), T-08-25 (a truncated contract throws before any request, zero provider calls), T-08-26 (the agent-file/prompt equality assertion). No new network endpoint, auth path, file-access pattern, or schema change at a trust boundary was introduced beyond what the plan's own threat register already names.

## Issues Encountered

- **Pre-existing, unrelated flake observed, not fixed (out of scope per SCOPE BOUNDARY):** `tests/unit/checkpoint-store.test.ts`'s `WR-09` concurrency case (`four overlapping OS processes each recording 150 entries produce all 600 rows`) failed once during a full-suite run on this machine with `the latest start has to precede the earliest finish` -- a real-OS-process-timing assertion, unrelated to this plan's files, that passed cleanly on an immediate re-run in isolation. Not touched; belongs to Phase 7's checkpoint subsystem.
- `commitFile` (from `tests/helpers/git.ts`) requires its parent directory to exist first -- the first fixture run failed with `ENOENT` writing `src/b.ts` until `mkdirSync(join(repo, "src"), {recursive:true})` was added before the first `commitFile` call, matching a documented pre-existing lesson recorded in STATE.md for this exact helper.

## User Setup Required

None. No `[RUNBOOK]` item executed, no real provider inference request issued -- every provider in this plan's tests is faux (`fauxProvider`, driven through `wrapFauxWithPayload`), per the autonomous-run rules.

## Next Phase Readiness

- `runReview` exists, is proven end to end against a faux session, and is ready for a future gate-composition module (plan 08-09's refute pass, or a Phase 9 workflow) to call with a real `ReviewerContractInput` assembled from `quality/gates.ts`'s deterministic-stage report and a real diff/file-set.
- `.pi/agents/reviewer.md` is in place for the eventual real-subagent path; wiring it into `AGENT_NAME_BY_ROLE` (and thereby retiring the `UNROUTED_AGENT_ALLOWLIST` entry added in this plan) is `RB-08-03`, OUTSTANDING.
- No blockers carried forward.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check: PASSED
