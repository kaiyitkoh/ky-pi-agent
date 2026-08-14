---
phase: 05-routing-capability-guards
plan: 12
subsystem: routing
tags: [docs, runbook, requirements-traceability, routing, qoder, docs-policy]

# Dependency graph
requires:
  - phase: 05-routing-capability-guards
    plan: 06
    provides: "tests/integration/qoder-delegate.test.ts -- the offline proxy this plan's RB-05-01 entry names"
  - phase: 05-routing-capability-guards
    plan: 10
    provides: "ROUTE-09's restore half (session_start), read back into docs/ROUTING.md §5"
  - phase: 05-routing-capability-guards
    plan: 11
    provides: "tests/integration/wire-proof.test.ts -- ROUTE-10's binding proof, cited in docs/ROUTING.md §7's limits"
provides:
  - "docs/ROUTING.md -- the user-facing routing document: three mechanisms, the role->model table (asserted against ROLE_MAP in both directions), the four refusals, mode-persistence economics, and the Qoder foreign-agent bypass statement"
  - "docs/RUNBOOK.md's RB-05-01 entry -- ROUTE-11's live check, OUTSTANDING, machine-governed"
  - ".planning/REQUIREMENTS.md's finalized ROUTE-11 traceability, now naming the appended RB-05-01 rather than deferring to a later plan"
affects: [06-walking-skeleton, docs/RUNBOOK.md, phase-6-quick-composition]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "docs/ROUTING.md's role->model table is asserted against ROLE_MAP in BOTH directions (forward completeness + converse non-invention), following docs/DIAGNOSTICS.md and docs/SAFETY.md's own corpus-derived-limits discipline -- a narrow provider-namespaced regex (deepseek|dashscope|amazon-bedrock) extracts provider/id tokens from a section-sliced table, so the deny-listed Bedrock R1 ids in the refusals section (written without a provider prefix, deliberately) cannot collide with the extraction"
    - "RB-05-01's procedure pins whole, copy-pasteable export/read commands (never fragments), each independently verified to occur exactly once in docs/RUNBOOK.md before commit -- the same discipline RB-02-03's fragment-pin lesson and RB-03/04's whole-line pins established"

key-files:
  created:
    - docs/ROUTING.md
  modified:
    - tests/unit/routing-map.test.ts
    - docs/RUNBOOK.md
    - tests/unit/docs-policy.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The role->model table's doc<->code consistency check slices only the \"## 2. The role->model table\" section before running extraction/comparison -- mirroring docs-policy.test.ts's Group D redactionSection() pattern -- so a Bedrock id mentioned in the refusals section (§4) cannot accidentally satisfy or break the check"
  - "Bedrock DeepSeek R1's deny-listed ids (deepseek.r1-v1:0, us.deepseek.r1-v1:0) are written in docs/ROUTING.md WITHOUT a provider/ prefix specifically so the PROVIDER_MODEL_RE extraction (scoped to deepseek|dashscope|amazon-bedrock) never treats them as a claimed ROLE_MAP candidate -- verified by the converse falsification (see below)"
  - "RB-05-01's procedure exports the PAT and the pre-configured agent/environment ids as full one-line export commands with bracketed placeholders (matching the RB-03-03/RB-04-01 precedent for account-identifying values in a public file), and reads the redacted qoder-*.jsonl transcript rather than the wire/turns logs, since the delegate tool writes its own transcript stream distinct from diagnostics'"
  - "REQUIREMENTS.md's ROUTE-11 rows are rewritten to name the NOW-APPENDED RB-05-01 and docs/ROUTING.md section 6, replacing the prior \"a later plan appends it\" phrasing left by plan 05-03 -- the requirement stays [~] partial forever by construction; only the evidence citations change"

requirements-completed: [ROUTE-01, ROUTE-02, ROUTE-03, ROUTE-04, ROUTE-05, ROUTE-06, ROUTE-07, ROUTE-08, ROUTE-09, ROUTE-10, ROUTE-11]

# Metrics
duration: ~20min
completed: 2026-08-14
---

# Phase 5 Plan 12: Publish the Phase — docs/ROUTING.md, RB-05-01, and Requirements Close-Out Summary

**`docs/ROUTING.md` publishes the role→model map (asserted against `ROLE_MAP` in both directions), the three mechanisms, the four refusals, and the Qoder foreign-agent bypass statement; `docs/RUNBOOK.md` gains the appended `RB-05-01` entry, OUTSTANDING and machine-governed in both required places; and `.planning/REQUIREMENTS.md` records ten `ROUTE` requirements complete and one partial with its live check named — closing Phase 5 with the full suite (1346 tests / 78 files) and `tsc --noEmit` green.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-14
- **Tasks:** 3 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **`docs/ROUTING.md`** (new, 7 sections): what routing is here (the three mechanisms, restated for a reader rather than an implementer); the role→model table generated from `ROLE_MAP` (18 mode×role rows, five distinct `{provider,id}` candidates); the command reference (`/cheap`, `/balanced`, `/max`, `/escalate`, `/escalate off`, `/mode`) stating that a switch that cannot be applied is refused with a reason and leaves the session alone; the four hard refusals (image→text-only, oversized context, Bedrock non-Claude+thinking with the "UI still offers it" caveat, Bedrock DeepSeek R1 for tool-loop roles) each with its `file:line` citation; what persists and its zero-context-token cost; the Qoder foreign-agent statement naming all four bypassed controls (Pi's tools, `AGENTS.md`/system prompt, the Phase 4 safety guard, the Phase 2 wire inspector) and the auto-deploy consequence, plus what Qoder explicitly is NOT (routable model, `models.json` entry, fallback hop, role-map/guard entry) and the permanent exclusion of the unofficial bypass-proxy packages; and a Limits section naming the still-OUTSTANDING `RB-02-01`/`RB-03-04`/`RB-05-01`. Carries the "code is authoritative, this document is a bug on disagreement" line verbatim from `docs/DIAGNOSTICS.md`'s convention.
- **`tests/unit/routing-map.test.ts`** extended with a new describe block: existence, non-vacuity, forward completeness (every `ROLE_MAP` candidate named in the table), the converse (every `provider/id`-shaped token the table names is a real `ROLE_MAP` candidate — extracted with a provider-namespaced regex from a section-sliced table, mirroring `docs-policy.test.ts`'s Group D pattern), all-six-roles presence, all-three-mode-commands presence, `/escalate`/`/mode` presence, the four-bypassed-controls presence, and the "Qoder is not a routable model" presence. 12 new tests; 54 total in the file, all green.
- **`docs/RUNBOOK.md`**: appended a `## Phase 5 — Routing & Capability Guards` section and the `RB-05-01` entry — summary-table row plus detail subsection with the four-part contract (why it cannot be done here, the on-work-laptop procedure with three copy-pasteable export/read commands, the precise expected output including the `stop_reason.type === "end_turn"` signal and the 401/403 failure signal, and the offline proxy naming `tests/integration/qoder-delegate.test.ts` by its real path). `git diff --stat docs/RUNBOOK.md` shows 73 insertions, 0 deletions — every pre-existing `RB-01..RB-04` entry is byte-unchanged.
- **`tests/unit/docs-policy.test.ts`**: added `PHASE_FIVE_IDS = ["RB-05-01"] as const` (spread into `ALL_IDS`) and `ENTRY_COMMANDS["RB-05-01"]` pinning the three whole command lines from the runbook procedure, each independently verified (`grep -F -c`) to occur exactly once in `docs/RUNBOOK.md` before committing.
- **`.planning/REQUIREMENTS.md`**: ROUTE-01 through ROUTE-10 were already `[x]` (marked incrementally by their own closing plans across the phase, per each plan's `requirements-completed` frontmatter); this plan rewrote ROUTE-11's checkbox description and traceability row to name the now-appended `RB-05-01` and `docs/ROUTING.md` §6, replacing plan 05-03's "a later plan appends it to docs/RUNBOOK.md" placeholder phrasing. ROUTE-11 stays `[~]` partial by construction — it may never be `[x]` on this machine.

## Task Commits

Each task was committed atomically:

1. **Task 1: docs/ROUTING.md + routing-map.test.ts doc-consistency check** — `4dddeea` (docs)
2. **Task 2: RB-05-01 appended to docs/RUNBOOK.md + docs-policy.test.ts extension** — `45e83b1` (docs)
3. **Task 3: REQUIREMENTS.md traceability finalized** — `2eab18f` (docs)

## Files Created/Modified

- `docs/ROUTING.md` — new, the user-facing routing document (7 sections, table asserted against `ROLE_MAP`)
- `tests/unit/routing-map.test.ts` — extended with the doc↔`ROLE_MAP` consistency check (both directions) and role/command presence checks
- `docs/RUNBOOK.md` — appended the Phase 5 section and `RB-05-01` (additions only, verified by `git diff --stat`)
- `tests/unit/docs-policy.test.ts` — `PHASE_FIVE_IDS` + `ENTRY_COMMANDS["RB-05-01"]`
- `.planning/REQUIREMENTS.md` — ROUTE-11's checkbox and traceability rows rewritten to cite the appended runbook entry and the published document

## Decisions Made

See `key-decisions` in the frontmatter for the full list. Summarized:

- The doc↔`ROLE_MAP` consistency check is scoped to the "## 2. The role→model table" section only, via the same section-slicing pattern `docs-policy.test.ts`'s Group D already established for `docs/DIAGNOSTICS.md`'s Redaction section — so a Bedrock id mentioned elsewhere in the document (the R1 refusal in §4) cannot interfere.
- The R1 deny-list ids are deliberately written without a `provider/` prefix in `docs/ROUTING.md`'s prose, so the provider-namespaced extraction regex never mistakes them for a claimed routing candidate — this was verified by the required falsification, not merely asserted.
- `RB-05-01`'s procedure reads the Qoder-owned `qoder-*.jsonl` transcript stream (written by `client.ts`'s own `writeQoderTranscript`), not the diagnostics `wire-*`/`turns-*` streams, because the delegate tool's HTTP traffic is by design invisible to the Phase 2 wire inspector — reading the wrong stream would silently prove nothing.

## Deviations from Plan

None — plan executed exactly as written. ROUTE-01 through ROUTE-10 were already `[x]` in `.planning/REQUIREMENTS.md` when this plan started, having been marked incrementally by plans 05-01 through 05-11 via their own `requirements-completed` frontmatter and the standard state-update flow; this plan's Task 3 verified each against its binding `05-VALIDATION.md` command (all green) and made no correction, which is consistent with the plan's own instruction not to mark anything whose binding command is not green — none needed correcting.

## Issues Encountered

None.

## User Setup Required

None — this plan is entirely offline documentation and test work. `RB-05-01` itself requires work-laptop credentials (`QODER_PERSONAL_ACCESS_TOKEN`, a pre-configured `QODER_AGENT_ID`/`QODER_ENVIRONMENT_ID`) to execute, and stays OUTSTANDING by construction until a human runs the procedure and updates both required places in the same commit.

## Next Phase Readiness

- **Phase 5 is complete.** All eleven ROUTE requirements are accounted for: ten `[x]` (ROUTE-01 through ROUTE-10) and one `[~]` partial (ROUTE-11) with `RB-05-01` named inline and appended to `docs/RUNBOOK.md`, machine-governed by `tests/unit/docs-policy.test.ts` in both the summary-table row and the `**Status:**` line.
- Full suite verified green: **1346 tests / 78 files** (up from 1334/78 at plan 05-11's close — 12 new tests added by this plan, no new test files). `tsc --noEmit` clean.
- `docs/ROUTING.md` publishes a role→model table that cannot drift silently from `routing/schema.ts`'s `ROLE_MAP` — both the forward and converse directions are machine-enforced, and the converse falsification (adding a row for a model absent from `ROLE_MAP`) was executed and confirmed red before being reverted.
- **What Phase 6 inherits:** a `/quick` workflow that composes routing (this phase) with safety (Phase 4) end to end — route → guard → execute → evidence → commit. Phase 6's walking skeleton is the first place these two subsystems, which deliberately import nothing from each other, actually meet in one user-facing command. Phase 6 also owns `GATE-07` (the evidence gate over exit codes) and `FLOW-01`/`FLOW-11` (`/quick` itself and its CI line-budget), none of which this phase built.
- No blockers for Phase 6.

## Self-Check: PASSED

- FOUND: `docs/ROUTING.md`
- FOUND: `tests/unit/routing-map.test.ts`
- FOUND: `docs/RUNBOOK.md`
- FOUND: `tests/unit/docs-policy.test.ts`
- FOUND: `.planning/REQUIREMENTS.md`
- FOUND: `.planning/phases/05-routing-capability-guards/05-12-SUMMARY.md`
- FOUND commit: `4dddeea` (Task 1)
- FOUND commit: `45e83b1` (Task 2)
- FOUND commit: `2eab18f` (Task 3)

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
