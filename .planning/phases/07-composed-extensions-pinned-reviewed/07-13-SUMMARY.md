---
phase: 07-composed-extensions-pinned-reviewed
plan: 13
subsystem: docs+testing
tags: [runbook, docs-policy, EXT-09, requirements-reconciliation, phase-closeout]

requires:
  - phase: 07-composed-extensions-pinned-reviewed
    provides: "07-10-SUMMARY.md's install gate NOT SATISFIED + RB-07-02 handoff; 07-11-SUMMARY.md's tool-count baseline and corrected pi-subagents tool naming; 07-12-SUMMARY.md's Subagent capability evidence table and subagent-capabilities.test.ts"
provides:
  - "docs/RUNBOOK.md's Phase 7 section: RB-07-01 (EXT-09's composed smoke ritual, composing RB-02-01/RB-03-0x rather than restating them) and RB-07-02 (install the five pinned specs and reconcile pi list), both OUTSTANDING in both parsed places"
  - "tests/unit/docs-policy.test.ts's PHASE_SEVEN_IDS, ENTRY_COMMANDS rows for both new ids, and a FIXTURE_PHASE_SEVEN/_HALF_FLIPPED pair proving the parser survives Phase 6's gap in the array sequence"
  - "Every EXT-01..EXT-10 status in .planning/REQUIREMENTS.md reconciled against what was actually proven, closing the EXT-05 discrepancy 07-10 registered as a blocker"
affects: []

tech-stack:
  added: []
  patterns:
    - "A phase-gap in the append-only ALL_IDS composition (Phase 6 added no runbook entries) is proven not to silently break the generalised parser, via a dedicated fixture pair rather than only the real file"

key-files:
  created: []
  modified:
    - docs/RUNBOOK.md
    - tests/unit/docs-policy.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "RB-07-02 was needed: 07-10-SUMMARY.md's Task 3 recorded the pi install / pi list reconciliation as UNVERIFIED (not MATCH), per its own documented fallback, because the blocking package-legitimacy checkpoint was found NOT SATISFIED (ground (a) of the user's pre-authorisation -- 'this machine has no credentials' -- is false; live AWS SSO/static admin keys are present). Per this plan's own instruction, an UNVERIFIED verdict means RB-07-02 must be written; a MATCH would have meant it must not be invented."
  - "RB-07-01's procedure composes rather than restates: leg 1 (one turn per provider) and leg 4 (one wire dump) cite RB-02-01/RB-03-0x by id and introduce no new pinned command; only legs 2 (subagent spawn) and 3 (blocked command) are genuinely new content, matching the plan's own instruction that duplicating existing commands creates two sources of truth."
  - "The subagent-spawn leg's clean-working-tree precondition cites pi-subagents@0.49.0 src/runs/shared/worktree.ts:137-142 (resolveRepoState's git status --porcelain -- :!.pi/subagents check) -- the exact citation 07-09-SUMMARY.md recorded, not the plan's own approximate 138-148 line range."
  - "RB-07-01's own prose deliberately avoids repeating RB-07-02's pinned command literals (git status --porcelain and pi list both appear in RB-07-01's text only by cross-reference to RB-07-02's id, never restated verbatim) so that deleting one entry's own copy of a command cannot silently stay green on a neighbouring entry's copy -- the exact blindness the Phase 3 ENTRY_COMMANDS discipline exists to prevent."
  - "EXT-05's REQUIREMENTS.md status moves from [x] Complete to [~] Partial with RB-07-02 named inline, reconciling the discrepancy 07-10-SUMMARY.md registered as a Blocker/Concern: the requirement names eight capabilities as 'available', but four of them (background bash, LSP diagnostics, web lookup, session search) are npm-backed and have never been installed. The four vendored capabilities (plan mode, todo tracking, structured user questions, loop detection) remain genuinely live and stay the honest basis for calling half the requirement proven."
  - "EXT-01, EXT-03 and EXT-04 move to [~] Partial with RB-07-01 named inline, per this plan's own explicit expectation and matching 07-12-SUMMARY.md's own requirements-partial: [EXT-03, EXT-04] frontmatter and its 'RB-07-01 status: Unchanged -- OUTSTANDING' closing note. EXT-01 was previously marked [x] Complete by plans 07-04/07-09 on structural-frontmatter grounds alone (no model: key, agentScope resolution) -- downgraded here because no subagent has ever actually spawned to exercise those structural facts live."
  - "EXT-02/06/07/08/10 stay [x] Complete -- each is proven independent of whether the five npm packages were ever installed (this repository's own worktree-setup hook, a decision fact, vendored artifacts, and pin re-verification), so the install gate's failure does not touch them."

requirements-completed: [EXT-09]

duration: ~50min
completed: 2026-08-15
---

# Phase 07 Plan 13: Composed Smoke Ritual Documented, Every EXT Status Reconciled Summary

**Wrote EXT-09's composed smoke ritual into `docs/RUNBOOK.md` as `RB-07-01` (composing the existing Phase 2/3 entries rather than restating them) plus a second, distinct `RB-07-02` for the install-and-reconcile step plan 07-10 could not perform, machine-governed both via `PHASE_SEVEN_IDS` in `tests/unit/docs-policy.test.ts`, and reconciled every EXT-01..EXT-10 status in `REQUIREMENTS.md` against what the phase's own summaries actually proved — closing the EXT-05 discrepancy plan 07-10 registered as a blocker.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-08-15T05:55Z (approx, following 07-12's completion)
- **Completed:** 2026-08-15T06:34Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **Task 1** — Appended a `## Phase 7 — Composed Extensions, Pinned & Reviewed` section to `docs/RUNBOOK.md`: `RB-07-01` (EXT-09's composed ritual, four legs) and `RB-07-02` (the install-and-reconcile handoff from plan 07-10), both `OUTSTANDING` in the summary-table row and the detail section's `**Status:**` line. Every existing entry (`RB-01-01..03`, `RB-02-01..03`, `RB-03-01..05`, `RB-04-01`, `RB-05-01`) is byte-identical to before — `git diff docs/RUNBOOK.md` for this task shows only additions.
- **Task 2** — Added `PHASE_SEVEN_IDS` to `tests/unit/docs-policy.test.ts` with `ENTRY_COMMANDS` rows for both new ids and a `FIXTURE_PHASE_SEVEN`/`FIXTURE_PHASE_SEVEN_HALF_FLIPPED` pair, following the `FIXTURE_PHASE_TWO`/`FIXTURE_PHASE_THREE` precedent — proving the generalised parser survives the phase-numbering gap (Phase 6 added no ids, so `PHASE_SEVEN_IDS` appends directly after `PHASE_FIVE_IDS`) rather than assuming it. All three required falsifications performed and reverted (below).
- **Task 3** — Updated every EXT-01..EXT-10 status in `.planning/REQUIREMENTS.md` (both the checklist and the status table) against the phase's own summaries rather than this plan's expectations. EXT-01/03/04/09 move to `[~]` Partial with `RB-07-01` named inline; EXT-05 moves to `[~]` Partial with `RB-07-02` named inline, reconciling 07-10's registered Blocker/Concern; EXT-02/06/07/08/10 stay `[x]` Complete.
- Full suite (`npx vitest run`, 92 files, 1606 tests) and `npx tsc --noEmit` both exit 0 after all three tasks.

## Task Commits

1. **Task 1: Append RB-07-01 and RB-07-02 to docs/RUNBOOK.md** — `534f0e0` (docs)
2. **Task 1 fix: re-wrap RB-07-01's pinned audit command onto one line** — `bd02b9e` (fix) — a Rule 1 auto-fix, found while writing Task 2's tests (see Deviations below)
3. **Task 2: Add PHASE_SEVEN_IDS to the docs-policy guard** — `ebf7e5d` (test)
4. **Task 3: Reconcile every EXT requirement's status** — `82ff70d` (docs)

**Plan metadata:** (this commit, made after this SUMMARY per the sequential-executor protocol)

## Files Created/Modified

- `docs/RUNBOOK.md` — new `## Phase 7` section: `RB-07-01` (EXT-09's composed ritual) and `RB-07-02` (install-and-reconcile), both `OUTSTANDING`.
- `tests/unit/docs-policy.test.ts` — `PHASE_SEVEN_IDS`, two new `ENTRY_COMMANDS` rows, a Phase 7 fixture pair, two new Group C test cases.
- `.planning/REQUIREMENTS.md` — every EXT-01..EXT-10 checklist line and status-table row updated with an inline RB id where partial.

## Falsifications Performed (Task 2, all three required, all reverted)

1. **Half-flip.** Flipped only `docs/RUNBOOK.md`'s `RB-07-01` summary-table cell to `PASSED — 2026-08-15`, leaving the detail section's `**Status:**` line at `OUTSTANDING`. Result: `Group B ... declares RB-07-01 in a summary-table row marked OUTSTANDING` failed (table no longer contains `OUTSTANDING`), and `Group C ... RB-07-01 is OUTSTANDING` failed with `RB-07-01 is recorded as INCONSISTENT` — the exact parser-agreement verdict the guard exists to produce. Reverted via `Edit`; re-run confirmed 81/81 passing.
2. **Full flip.** Flipped both the summary-table cell and the `**Status:**` line to `PASSED — 2026-08-15`. Result: `Group C ... RB-07-01 is OUTSTANDING` failed with `expected 'PASSED' to be 'OUTSTANDING'` (2 failing tests total, since the summary-table assertion also failed on its own terms). Reverted via `Edit`; `git diff docs/RUNBOOK.md` confirmed byte-identical to the committed version before re-running.
3. **Disarm the guard.** Deleted `...PHASE_SEVEN_IDS` from `ALL_IDS` in `tests/unit/docs-policy.test.ts`. Result: `Group B ... governs every entry the runbook declares` failed with `expected [ 'RB-07-01', 'RB-07-02' ] to deeply equal []` — the exact unguarded-ids list the Phase 3-authored "governs every entry" case exists to surface. Reverted via `Edit`; re-run confirmed 81/81 passing and `npx tsc --noEmit` clean.

After each falsification, `npx vitest run tests/unit/docs-policy.test.ts` was re-run to confirm a clean pass before proceeding to the next.

## Requirement-to-Summary Status Mapping (Task 3)

| Requirement | New status | Traced to |
|---|---|---|
| EXT-01 | `[~]` Partial, `RB-07-01` inline | `07-04-SUMMARY.md` (frontmatter proof), `07-09-SUMMARY.md` (agentScope correction), `07-12-SUMMARY.md` (ten `file:line` citations against the pinned tarball; its own "RB-07-01 status: Unchanged — OUTSTANDING" closing note) |
| EXT-02 | `[x]` Complete (unchanged) | `07-02-SUMMARY.md`, `07-05-SUMMARY.md` (`tests/integration/worktree-build.test.ts`, this repo's own hook, no install needed) |
| EXT-03 | `[~]` Partial, `RB-07-01` inline | `07-12-SUMMARY.md` (`requirements-partial: [EXT-03, EXT-04]`; findings 1–3, the `async`/`subagent_wait`/detached-dispatch citations) |
| EXT-04 | `[~]` Partial, `RB-07-01` inline | `07-12-SUMMARY.md` (findings 4–6, the `steer`/control-inbox/`deliverSteerRequest` citations) |
| EXT-05 | `[~]` Partial, `RB-07-02` inline | `07-10-SUMMARY.md` (the registered Blocker/Concern: marked `[x]` before any npm package was installed), `07-11-SUMMARY.md` (`tests/unit/extension-composition.test.ts`'s `CAPABILITY_SOURCES` — four vendored rows genuinely live, four npm rows only "resolves to a pinned `packages[]` entry") |
| EXT-06 | `[x]` Complete (unchanged) | `07-01/07-07/07-08-SUMMARY.md` (decision fact, `tests/unit/extension-composition.test.ts`'s regression guard) |
| EXT-07 | `[x]` Complete (unchanged) | vendored `.pi/extensions/checkpoint/`, not install-dependent |
| EXT-08 | `[x]` Complete (unchanged) | `07-01-SUMMARY.md`, `07-10-SUMMARY.md`, `07-11-SUMMARY.md` (independent pin re-verifications) |
| EXT-09 | `[~]` Partial, `RB-07-01` inline | This plan's own `docs/RUNBOOK.md` addition |
| EXT-10 | `[x]` Complete (unchanged) | `07-06-SUMMARY.md` (`pi-loop-police`'s missing LICENSE re-verified three times independently) |

## Decisions Made

See `key-decisions` in frontmatter for full text. Summarized: (1) `RB-07-02` was needed because 07-10 recorded UNVERIFIED, not MATCH; (2) `RB-07-01` composes rather than restates existing entries, and its own prose was written to avoid literally repeating `RB-07-02`'s pinned commands so a dropped-command blindness cannot occur across the two entries; (3) the worktree precondition citation uses `worktree.ts:137-142` (07-09's exact re-read), not the plan text's approximate `138-148`; (4) EXT-05 is downgraded to Partial with `RB-07-02` inline, closing the blocker 07-10 registered, because half its named capabilities have never been installed; (5) EXT-01/03/04/09 are Partial with `RB-07-01` inline per this plan's own explicit expectation and matching 07-12's own frontmatter; (6) EXT-02/06/07/08/10 stay Complete because each is proven independent of the install gate's failure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] RB-07-01's pinned audit command was split across a markdown line wrap**
- **Found during:** Task 2 (first `npx vitest run tests/unit/docs-policy.test.ts` after writing `ENTRY_COMMANDS["RB-07-01"]`)
- **Issue:** Task 1's prose wrote `` `tail\n   -n 1 .pi/logs/audit-$(date +%F).jsonl` `` across a markdown line-wrap boundary, so the exact one-line string `tail -n 1 .pi/logs/audit-$(date +%F).jsonl` never appeared verbatim in `docs/RUNBOOK.md`, and the `names the exact command(s) for RB-07-01` test failed.
- **Fix:** Re-wrapped the sentence so the entire backtick-quoted command sits on one markdown line, matching the Phase 3-5 "sits inside backticks on one line" discipline `ENTRY_COMMANDS`' own header comment states.
- **Files modified:** `docs/RUNBOOK.md`
- **Verification:** `grep -n "tail -n 1 .pi/logs/audit-" docs/RUNBOOK.md` finds it on one line; `npx vitest run tests/unit/docs-policy.test.ts` passes 81/81 afterward.
- **Committed in:** `bd02b9e` (separate commit, since Task 1's own commit `534f0e0` had already landed before this was found during Task 2's work)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a markdown line-wrap bug in this plan's own Task 1 output, found and fixed before Task 2's commit).
**Impact on plan:** No scope creep — the fix is confined to the one file Task 1 declares, and was necessary for Task 2's own verification to pass.

## Issues Encountered

Two collision risks were found and designed around during Task 1/2 drafting, before any test ran red: (1) the fragment `git status --porcelain` would have appeared twice in `RB-07-01`'s own text (once as the pinned command, once inside the explanation of `worktree.ts`'s internal check) — reworded the explanation to avoid restating the literal substring; (2) `pi list` would have appeared in both `RB-07-01`'s "Expected output" prose and `RB-07-02`'s own pinned command — reworded `RB-07-01`'s prose to cross-reference `RB-07-02`'s id instead of restating the command. Both were caught by grep before committing, per Task 2's own acceptance criteria, rather than discovered as test failures.

## Stub Tracking

None. Every new sentence in `docs/RUNBOOK.md` and `tests/unit/docs-policy.test.ts` is either a citation to a real, previously-verified `file:line` or plan-07-XX finding, or new prose describing a procedure that has genuinely never run (marked `OUTSTANDING`, never implied otherwise).

## Threat Flags

None. This plan writes documentation and a test file; it introduces no new network endpoint, auth path, file-access pattern, or schema change at a trust boundary. The threat register's four items (T-07-56..59) are all documentation-honesty/guard-completeness concerns, addressed directly by the falsifications above.

## User Setup Required

**`RB-07-01` and `RB-07-02` are both OUTSTANDING and require the work laptop.** `RB-07-02` must run first (install the five pinned specs with a human physically present for the package-legitimacy gate, then reconcile `pi list` against `.pi/settings.json`); `RB-07-01` presupposes it. Neither may ever be marked passed on the strength of anything built in this repository.

## Next Phase Readiness

Phase 7 is closed: every `docs/RUNBOOK.md` entry for Phases 1 through 7 is machine-governed by `tests/unit/docs-policy.test.ts`'s `ALL_IDS` (16 total: `RB-01-01..03`, `RB-02-01..03`, `RB-03-01..05`, `RB-04-01`, `RB-05-01`, `RB-07-01..02`), all `OUTSTANDING`. Every EXT-01..EXT-10 requirement status is traceable to a specific summary rather than assumed. Full suite (1606 tests, 92 files) and `npx tsc --noEmit` green. No install-blocking technical issue exists for a future phase or a human running `RB-07-02` — the blocker is exclusively the unmet human-verification gate, which requires a human physically present with knowledge of this machine's real credential exposure, exactly as `07-10-SUMMARY.md` and `07-11-SUMMARY.md` already recorded.

---
*Phase: 07-composed-extensions-pinned-reviewed*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: docs/RUNBOOK.md
- FOUND: tests/unit/docs-policy.test.ts
- FOUND: .planning/REQUIREMENTS.md
- FOUND commit: 534f0e0
- FOUND commit: bd02b9e
- FOUND commit: ebf7e5d
- FOUND commit: 82ff70d
- FOUND commit: d85883f
