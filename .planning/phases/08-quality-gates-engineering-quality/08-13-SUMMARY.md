---
phase: 08-quality-gates-engineering-quality
plan: 13
subsystem: documentation
tags: [runbook, requirements-reconciliation, docs-policy, honesty-gate]

# Dependency graph
requires:
  - phase: 08-quality-gates-engineering-quality
    provides: "all twelve prior plans (08-01..08-12) — this plan reconciles their claims, not their code"
provides:
  - "docs/RUNBOOK.md's RB-08-01/02/03 — three OUTSTANDING runbook entries, machine-governed"
  - "docs/QUALITY.md — the quality layer's contract, code-authoritative"
  - ".planning/REQUIREMENTS.md — all 16 phase-8 requirement statuses reconciled against what each plan's summary actually proved"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A doc/code agreement test (docs/QUALITY.md <-> RULE_IDS/DEFECT_CLASSES) extracted by numbered-section slicing and a hyphenated-code-span regex, both directions, mirroring docs/ROUTING.md <-> ROLE_MAP (05-12)"
    - "A pinned-command uniqueness check run by hand before commit, following Phase 3-7's ENTRY_COMMANDS discipline: a new entry's pinned command must not also match a neighbouring entry's"

key-files:
  created:
    - docs/QUALITY.md
  modified:
    - docs/RUNBOOK.md
    - tests/unit/docs-policy.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "RB-08-01's pinned wire-read command is a three-provider grep+tail form, deliberately NOT the same whole-line `tail -n 1 .pi/logs/wire-$(date +%F).jsonl` string RB-02-01 already owns -- pinning the identical string in two entries would make both pins stay green if either entry's own step dropped its copy"
  - "GATE-01, GATE-02 and GATE-08 move from [x] to [~] even though their own REQUIREMENTS.md text carried no [RUNBOOK] tag when this phase started -- the tag predates the discovery that the LSP leg, the reviewer's subagent-vs-call-model mechanism, and the calibration corpus's scripted-vs-live reviewer are all genuinely live-blocked; the plan's own expected-shape table named this reconciliation explicitly, and Trap T12 (a green offline proxy is not the check) applies regardless of what tag a requirement carried at definition time"
  - "QUAL-09 moves from Pending to [x] Complete on the strength of plan 08-11's session-level proof: a clean gated /quick turn's own JSONL row carries qualityMs, read off disk rather than an in-memory peek, with a paired negative control proving a blocked gate's cost is never billed to a later, unrelated turn -- this is the strongest evidence any Phase 8 producer offers for its own claim, not a scripted stand-in"
  - "The [RUNBOOK] distribution footnote's count is corrected from the pre-existing '8' to '13' in the same edit that adds GATE-01/02/08 to its Phase 8 clause -- the prior count already undercounted the nine items it listed before this plan touched it; left uninvestigated further as out of this plan's scope, but not left silently wrong on a line this plan was already editing"

requirements-completed: []

# Metrics
duration: "~50min"
completed: 2026-08-15
---

# Phase 08 Plan 13: The Phase's Honest Close-Out Summary

**Appended RB-08-01/02/03 to `docs/RUNBOOK.md` (all OUTSTANDING, machine-governed by `docs-policy.test.ts`'s two-source agreement guard), wrote `docs/QUALITY.md` as the quality layer's code-authoritative contract, and reconciled all 16 phase-8 requirement statuses against what each plan's own summary actually proved rather than what the phase intended — four requirements moved from `[x]` to `[~]`, naming their runbook id inline, and one moved from Pending to `[x]` on the strength of a real session-level proof.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-08-15
- **Tasks:** 3 (all complete)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `docs/RUNBOOK.md` gained a `## Phase 8 — Quality Gates & Engineering Quality` section immediately after Phase 7's, with a summary table and three `### RB-08-xx` detail sections, every one OUTSTANDING in both places:
  - `RB-08-01` — GATE-10's main-loop half, gated behind `RB-02-01` (no live provider credentials). States plainly that plan 08-01's nested-path fix and its offline proof (`gate10-nested-thinking.test.ts`) prove the NESTED path only.
  - `RB-08-02` — GATE-01's LSP leg, gated behind `RB-07-02` (`@narumitw/pi-lsp` never installed). States that `probeLspAvailability`'s `UNAVAILABLE` state, now genuinely wired into a real `/quick` (plan 08-11), reflects an absent install, not a clean result.
  - `RB-08-03` — GATE-02/GATE-08's live reviewer and live calibration run, both gated behind `RB-07-02` (`pi-subagents` never installed). States explicitly that the 3/6 scripted catch rate (plan 08-10) measures the SCORER, not a reviewer.
- `tests/unit/docs-policy.test.ts` extended in the same change: `PHASE_EIGHT_IDS` spread into `ALL_IDS`, an `ENTRY_COMMANDS` row per id with commands verified by hand to occur exactly once in the runbook, and a synthetic `FIXTURE_PHASE_EIGHT`/`FIXTURE_PHASE_EIGHT_HALF_FLIPPED` pair proving the two-source parser catches a disagreement on THIS phase's own ids, not only on the real, already-agreeing file.
- `docs/QUALITY.md` created — eight sections (the deterministic stage, the six anti-pattern rules, the REVIEW artifact, the anti-review-theatre protocol, classification and the stop, calibration, the cost record, what this layer does not prove), opening with the same code-authoritative clause `docs/DIAGNOSTICS.md`/`docs/SAFETY.md`/`docs/WORKFLOWS.md` use, and stating the model-authored-`file:line`-vs-`tool_result`-derived-evidence distinction explicitly.
- `tests/unit/docs-policy.test.ts`'s new Group E asserts `docs/QUALITY.md`'s rule table and calibration section agree with `RULE_IDS` and `DEFECT_CLASSES` in BOTH directions, following the `docs/ROUTING.md` ↔ `ROLE_MAP` precedent (05-12) — falsified by hand (adding a fake `unbounded-recursion` rule id to the doc turned exactly the converse case red, naming the invented id) before being reverted.
- `.planning/REQUIREMENTS.md` reconciled for all 16 phase-8 requirements, reading each plan's own SUMMARY rather than the phase's intentions: GATE-01, GATE-02, GATE-08 and GATE-10 moved `[x]` → `[~]`, each naming its `RB-08-xx` id inline, in both the checklist and the `:297-315` traceability table (updated in the same edit, so the two never disagree). QUAL-09 moved Pending → `[x]` on plan 08-11's live-JSONL proof. GATE-03/04/05/06/09 and QUAL-01/02/04/05/06/07 stayed `[x]`, supported by their own summaries' offline proofs with no live-credential gap.

## Task Commits

1. **Task 1: Append RB-08-01/02/03 and put them under machine enforcement in the same change** — `2ce44a0` (test)
2. **Task 2: docs/QUALITY.md — the quality layer's contract** — `21254e3` (docs)
3. **Task 3: Reconcile all 16 requirement statuses and assert doc/code agreement** — `38424f4` (docs)

## Falsification Proof (per the plan's own acceptance criteria)

Run against the fully-committed Task 1 state (`2ce44a0`), one mutation at a time, restored via `git checkout --` before the next:

| Mutation | Test command | Result |
|---|---|---|
| Flipped RB-08-02's summary-table row to `PASSED`, leaving the detail section `OUTSTANDING` | `npx vitest run tests/unit/docs-policy.test.ts` | 2 failed / 93 passed — the table-row case (`must carry OUTSTANDING`) and the Group C `RB-08-02 is OUTSTANDING` case (recorded as `INCONSISTENT`) both turned red |
| Restored via `git checkout --`; re-ran | — | 95/95 green |
| Flipped BOTH the table row and the detail `**Status:**` line to `PASSED` | same | 2 failed / 93 passed — the table-row case and the Group C case (recorded as `PASSED`, not `OUTSTANDING`) both turned red |
| Restored via `git checkout --`; re-ran | — | 95/95 green |
| Deleted `...PHASE_EIGHT_IDS` from `ALL_IDS` in `docs-policy.test.ts` | same | 1 failed / 85 passed (suite shrank from 95 to 86 tests) — "governs every entry the runbook declares" reported all three RB-08 ids as ungoverned |
| Restored via `git checkout --`; re-ran | — | 95/95 green |

Task 3's own falsification: added a fake `unbounded-recursion` rule id to `docs/QUALITY.md`'s rule table, ran `npx vitest run tests/unit/docs-policy.test.ts -t converse` — exactly the converse-direction case turned red, naming the invented id. Restored via `git checkout --`; confirmed `git diff --stat` empty; re-ran full suite: 102/102 green.

Final state: `npx tsc --noEmit` clean; `npx vitest run` — 106 files / 1959 tests, all green, run once after every falsification was restored.

## Decisions Made

See `key-decisions` in the frontmatter.

## Requirement reconciliation, one line each

- **GATE-01** Partial — typecheck, lint and the QUAL-01 legs run for real in `/quick`; the LSP leg has only ever reported `UNAVAILABLE`. `RB-08-02`, OUTSTANDING.
- **GATE-02** Partial — the six-element reviewer context contract is proven on a captured request; the reviewer dispatches via `runSingleShotRole`, never a real subagent spawn. `RB-08-03`, OUTSTANDING.
- **GATE-03** Complete — parser-level rejection of an unclassified finding, proven offline, no live half.
- **GATE-04** Complete — mandatory non-empty "checked and cleared" section, proven offline, no live half.
- **GATE-05** Complete — BLOCKER/WARNING/NIT classification rejected as malformed if absent, proven offline, no live half.
- **GATE-06** Complete — refute-or-promote, bounded and fail-safe, proven offline, no live half.
- **GATE-07** Complete — Phase 6, unaffected by this phase.
- **GATE-08** Partial — corpus, scorer and both negative controls complete offline; the 3/6 catch rate is scripted, not live. `RB-08-03`, OUTSTANDING.
- **GATE-09** Complete — advisor escalation proven end to end against a faux session, cross-provider, no live half named by the requirement itself.
- **GATE-10** Partial — the nested half's real Bedrock defect was found and fixed and proven offline; the main-loop half needs a real wire dump. `RB-08-01`, OUTSTANDING.
- **QUAL-01** Complete — six syntax-only rules, proven in both directions against real repository source.
- **QUAL-02** Complete — structural no-round-trip proof plus a measured, dated wall-clock budget.
- **QUAL-04** Complete — classification schema plus a worked root-cause example (plan 08-05's de-flake fix).
- **QUAL-05** Complete — `decideWorkflowStop`, a pure numbered predicate, proven offline.
- **QUAL-06** Complete — workaround's `properFix`/`deferralReason` enforced by the validator, proven offline.
- **QUAL-07** Complete — `shouldRunDesignReview`, a pure predicate proven both-signals and boundary-tested.
- **QUAL-09** Complete — the ledger mechanism is exercised by real producers, and a live-session JSONL row carries `qualityMs`, proven off disk with a paired negative control.

## Known Stubs

None. Every artifact this plan claims is exactly what it says it is: three genuinely OUTSTANDING runbook entries, a documentation file describing real code, and a requirements file whose statuses are read from what each prior plan's own summary actually proved.

## Threat Flags

None beyond the plan's own threat register (T-08-49..T-08-52), all mitigated as designed and falsification-proven above: T-08-49 (a `[RUNBOOK]` half reported passed on a green proxy — all three RB-08 entries stay OUTSTANDING, machine-enforced), T-08-50 (a half-flipped status — the two-source guard reports `INCONSISTENT`, falsified), T-08-51 (a runbook id added but ungoverned — `PHASE_EIGHT_IDS` spread into `ALL_IDS`, falsified by deletion), T-08-52 (`docs/QUALITY.md` claiming a rule or defect class the code does not have — Group E's converse case, falsified with a fake id).

## Issues Encountered

- **`RB-02-01`'s own exact command string (`tail -n 1 .pi/logs/wire-$(date +%F).jsonl`) could not be reused verbatim as RB-08-01's own pinned command** — pinning the identical whole line in two entries would make both pins stay green if either entry's own step dropped its copy, exactly the fragment-blindness lesson `RB-02-03`'s and Phase 3's own `ENTRY_COMMANDS` comments already record. Found by running the uniqueness grep before committing (not after); fixed by writing RB-08-01's own distinct three-provider grep+tail form.
- **No documented exact CLI invocation exists for starting a language server against `@narumitw/pi-lsp` once installed** — `docs/EXTENSIONS.md` documents the package's identity and its two tool names, not a session-startup command. RB-08-02's procedure states this honestly (marks the relevant steps UNVERIFIED) rather than inventing a plausible-looking command, per the plan's own instruction not to invent unverified commands.

## User Setup Required

None — no external service configuration required. No `[RUNBOOK]` item executed on this machine; no provider inference request issued; no package installed.

## Next Phase Readiness

- Phase 8 is closed with an honest record: nine of ten GATE requirements and all seven touched QUAL requirements accounted for, four partials each naming their runbook id, one requirement (QUAL-09) promoted on real evidence rather than intention.
- `docs/QUALITY.md` is ready for Phase 9 to extend when `verdict.ts`'s stop signal and `reviewer.ts`'s dispatch are wired into a real ceremonial workflow (QUAL-08) — its own §8 already states this is not done yet.
- `RB-08-01`, `RB-08-02`, `RB-08-03` are pre-authorised to remain OUTSTANDING through the rest of this milestone's autonomous run, per the standing operating policy.
- No blockers carried forward.

---
*Phase: 08-quality-gates-engineering-quality*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `docs/RUNBOOK.md` (modified, RB-08-01/02/03 present)
- FOUND: `docs/QUALITY.md` (created)
- FOUND: `tests/unit/docs-policy.test.ts` (modified, PHASE_EIGHT_IDS + Group E present)
- FOUND: `.planning/REQUIREMENTS.md` (modified, all 16 phase-8 statuses reconciled)
- FOUND commit `2ce44a0` (Task 1)
- FOUND commit `21254e3` (Task 2)
- FOUND commit `38424f4` (Task 3)
- `npx tsc --noEmit`: clean
- `npx vitest run`: 106 files / 1959 tests, all green
