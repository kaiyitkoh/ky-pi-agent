---
phase: 02-diagnostics-the-instrument
plan: 11
subsystem: documentation
tags: [wave-6, runbook, outstanding-status-guard, honest-limits, DIAG-01, DIAG-05, phase-close]
requires:
  - "02-02 — tests/unit/redact.test.ts (the offline proxy RB-02-02 names)"
  - "02-04 — tests/unit/prose-detector.test.ts (one of the two offline proxies RB-02-03 names)"
  - "02-05 — tests/integration/wire-capture.test.ts (the offline proxy RB-02-01 names); wire.ts's Bedrock blind spot and corr-id docstrings"
  - "02-07 — .pi/extensions/diagnostics/call-model.ts (the six-route scope caveat, copied not re-derived)"
  - "02-09 — tests/integration/prose-retry.test.ts (the second offline proxy RB-02-03 names); index.ts's promotion-alternative docstring"
  - "02-10 — .pi/extensions/diagnostics/budget.ts (the three token paragraphs, copied not re-derived)"
  - "01-10 — docs/RUNBOOK.md and tests/unit/docs-policy.test.ts (the five-part entry shape and the two-source status parser)"
provides:
  - "docs/RUNBOOK.md — an appended Phase 2 section with RB-02-01, RB-02-02 and RB-02-03, all OUTSTANDING, in the existing five-part shape"
  - "tests/unit/docs-policy.test.ts — runbookEntryStatuses (renamed from phaseOneEntryStatuses), ID_RE generalised to /RB-\\d{2}-\\d{2}/g, PHASE_TWO_IDS, ALL_IDS, three new Group C fixtures"
  - "docs/DIAGNOSTICS.md — the JSONL row contract for both streams, the reasoning-key closed door, three Known limits, and three executed worked examples"
affects:
  - "Phase 3 (PROV-09, the formal owner of docs/RUNBOOK.md) — appends a Phase 3 section and adds its ids to PHASE_THREE_IDS; the guard is already generalised for it"
  - "Phase 3 (PROV-07) — RB-02-01 is the apparatus that answers the Carried-Forward Unknown about reasoning_effort on DeepSeek V4 Flash"
  - "Phase 5, Phase 8, Phase 10 — read the turns and wire logs; docs/DIAGNOSTICS.md is the schema of record they read instead of the code"
  - "Phase 4 — once the command guard ships, tool-call promotion becomes an available lever for read-only tools; the condition is written down in docs/DIAGNOSTICS.md"
tech-stack:
  added: []
  patterns:
    - "generalise a guard's id pattern rather than extending it phase by phase — an unextended guard fails silently, through a file nobody touched"
    - "hold a widened pattern to a SHAPE with a malformed-id fixture, so widening it further fails a test"
    - "prove a generalisation with a synthetic fixture of the new shape, never only against the real file the guard polices"
    - "a schema document declares the code authoritative and itself the bug; the field list is checked by script and the checker is falsified"
    - "copy a source docstring's reasoning into the document rather than re-deriving it, so the two cannot drift into two answers"
key-files:
  created:
    - docs/DIAGNOSTICS.md
  modified:
    - docs/RUNBOOK.md
    - tests/unit/docs-policy.test.ts
decisions:
  - "DIAG-01 and DIAG-05 stay Pending; DIAG-02/03/04/06/07/08 remain Complete — this plan writes down what could not be verified and marks nothing passed"
  - "the guard is generalised to /RB-\\d{2}-\\d{2}/g rather than given a second Phase 2 branch, so Phase 3 adds an array and inherits the whole thing"
  - "a malformed-id fixture (RB-2-1, which must parse to {}) was added beyond the plan's list — the plan asked for a widening and nothing held the widening to a shape"
  - "the RUNBOOK preamble was NOT edited: its 'enforces the Phase 1 statuses' sentence is still true, and the Phase 2 section states the guard now spans both phases, keeping the diff purely additive"
  - "RB-02-03's expected output includes what a zero numerator means — a quiet day is a result, but it is not this check passing"
  - "docs/DIAGNOSTICS.md documents the kind-less out-of-band records as a first-class table, because 'a per-turn total sums over kind:\"turn\"' is the single most likely misreading of the turns log"
metrics:
  duration: ~25m
  tasks: 3
  files: 3
  completed: 2026-08-13
requirements-completed: [DIAG-02, DIAG-04, DIAG-07]
---

# Phase 2 Plan 11: The Runbook Section and the JSONL Contract Summary

The three checks Phase 2 could not run are recorded with exact commands, precise
expected output and named offline proxies — all `OUTSTANDING`, and now
machine-enforced as such by a guard that no longer hardcodes Phase 1 — and the
two log streams have a schema of record that names its own three limits.

## What was built

### Task 1 — the Phase 2 runbook section (commit `a5e5193`)

162 lines appended to `docs/RUNBOOK.md`. Zero deletions: `git diff --numstat`
reported `162 0`, so the three RB-01 entries and the preamble are byte-identical
to what Phase 1 wrote.

| Id | Requirement | The question it asks | Named offline proxy |
|---|---|---|---|
| `RB-02-01` | DIAG-01 | does a real DeepSeek payload carry `thinking.type: enabled` **and** a sibling top-level `reasoning_effort`, and does a real Bedrock payload carry a non-empty `additionalModelRequestFields`? | `tests/integration/wire-capture.test.ts` |
| `RB-02-02` | DIAG-07 | does the pattern list cover the credentials the **work laptop** actually holds? | `tests/unit/redact.test.ts` |
| `RB-02-03` | DIAG-05 | has the detector fired on real DeepSeek V4 Flash traffic, at what rate, and did the retry recover the turn? | `tests/unit/prose-detector.test.ts` **and** `tests/integration/prose-retry.test.ts` |

Each carries the runbook's four contract items and the
`**Offline proxy:** … It proves X. It says nothing about Y.` closing sentence.
Three things beyond the shape are worth naming:

- **RB-02-01 states what it is the apparatus for.** The Carried-Forward Unknown
  — *does DeepSeek V4 Flash honour `reasoning_effort` through Pi's
  `openai-completions` adapter?* — is read out of this dump. Phase 2 does not
  answer it; the entry says so explicitly, so a green Phase 2 suite is not
  mistaken for an answer to a question it never asked.
- **RB-02-02 carries a closed door.** A Bedrock SigV4 signature can never appear
  in a dump: SigV4 is applied by Smithy middleware downstream of everything Pi
  hands over, and `x-amz-*`, `authorization` and `host` are silently ignored on
  that path (`pi-ai 0.84.1 src/types.ts:148-153`). The entry is therefore
  written around the DeepSeek / DashScope bearer path, where a token genuinely
  does pass through the hook, and the door says why so nobody "improves" it into
  a check that passes while exercising nothing.
- **RB-02-03 says what a zero means.** A working day with no `prose_tool_call`
  rows is a result worth recording, but it is *not* the check passing — it means
  the sample was too small and the window extends. It also names the trap in its
  own commands: the turn row and the standalone action record both carry
  `event: prose_tool_call`, and only the `"kind":"turn"` filter keeps the
  denominator honest.

### Task 2 — the generalised status guard (commit `ac74072`)

`tests/unit/docs-policy.test.ts`, +126 / −15.

| Change | Before | After |
|---|---|---|
| id pattern | `/RB-01-\d{2}/g` | `/RB-\d{2}-\d{2}/g` |
| parser name | `phaseOneEntryStatuses` | `runbookEntryStatuses` |
| governed ids | `PHASE_ONE_IDS` (3) | `ALL_IDS` = `PHASE_ONE_IDS` + `PHASE_TWO_IDS` (6) |
| `ENTRY_COMMANDS` | 3 entries | 6 entries |
| Group B loop, proxy-scan magnitude guard, Group C real-file guard | `PHASE_ONE_IDS` | `ALL_IDS` |

The parser body is untouched. Its two-source rule — read the summary-table row
*and* the `**Status:**` line, report `INCONSISTENT` when they disagree and
`MISSING` when neither exists — is the load-bearing part and needed no change;
generalising the id pattern was sufficient to make it govern six entries instead
of three.

Three fixtures were added rather than the plan's one. The plan asked for a
Phase 2 fixture proving the widening is live; a widening also needs a bound, so
a malformed-id fixture was added to hold the pattern to a shape:

| Fixture | Asserts |
|---|---|
| `FIXTURE_PHASE_TWO` | `{"RB-02-01": "OUTSTANDING"}` — the Phase 1 fixtures cannot tell `/RB-\d{2}-\d{2}/` apart from the literal it replaced, since both match `RB-01-01` |
| `FIXTURE_PHASE_TWO_HALF_FLIPPED` | `{"RB-02-01": "INCONSISTENT"}` |
| `FIXTURE_MALFORMED_ID` | `{}` — `RB-2-1` must not parse; `RB-[\d-]+` would match it, and an id in no phase array is a status that is read and never asserted |

Test count for the file went 29 → 41.

### Task 3 — `docs/DIAGNOSTICS.md` (commit `2d4cc7b`)

434 lines, new. Opens with the contract: this is the schema of record for
`.pi/logs/wire-<date>.jsonl` and `.pi/logs/turns-<date>.jsonl`, and **if the
code and this document disagree, the code is authoritative and this document is
a bug**.

Sections: where the logs live and how they rotate (the four constants, the
open-write-close rule, the gitignore control and the `git add -f` hole);
**all 27 `TurnRow` fields** with meaning and source hook plus the
absent-not-zero omission rule; the kind-less out-of-band records as their own
table; the `reasoning` closed door; the six wire record kinds, the `corr` join
key and why no per-attempt id exists; redaction at capture, both rules and the
length-preserving placeholder; **Known limits**; token estimates; the prose
event and the lever not pulled; three worked examples.

**The three Known limits, each a "Closed door — do not re-litigate":**

1. *Bedrock credentials never reach the inspector.* The dump is incomplete on
   Bedrock by construction (`pi-ai types.ts:148-153`), which is why RB-02-02
   targets the bearer path.
2. *The chokepoint gate does not close every route.* All six routes from
   `call-model.ts`'s own caveat, including the realistic future gap —
   `pi.registerProvider` with a hand-written `streamSimple`. The consequence is
   stated bluntly: such a call is *invisible* to every cost figure, not merely
   under-counted.
3. *`after_provider_response` never fires on a provider error.* Hence the design
   rule that no turns-row field is derived from it; it contributes one optional
   `httpStatus` and nothing else.

Three paragraphs are **copied** from `budget.ts`'s docstring rather than
re-derived, exactly as 02-10 asked: no tokenizer exists and none may be added;
characters are the measurement and tokens are ±20%; and there are *two*
independent reasons `/budget` is a command — zero per-turn tokens, and
`getSystemPromptOptions()` being command-context only. The same discipline
applies to the six bypass routes (from `call-model.ts`) and the promotion
alternative (from `index.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical guard] A widened regex with no upper bound**

- **Found during:** Task 2
- **Issue:** The plan specified widening `ID_RE` to `/RB-\d{2}-\d{2}/g` and adding
  a fixture proving a Phase 2 id parses. Nothing in that set would fail if the
  pattern were widened *further* — `/RB-[\d-]+/g` passes every test the plan
  named. A pattern that matches ids belonging to no entry in `ALL_IDS` reads a
  status that neither loop then asserts, which is the same silent-unguarded
  outcome the whole task exists to prevent, arriving from the other direction.
- **Fix:** Added `FIXTURE_MALFORMED_ID` (`RB-2-1` in the full two-source shape)
  asserting `runbookEntryStatuses` returns `{}`, with the reasoning in the
  fixture's docstring.
- **Files modified:** `tests/unit/docs-policy.test.ts`
- **Commit:** `ac74072`
- **Falsified:** widening `ID_RE` to `/RB-[\d-]+/g` fails exactly this case (1
  failure), then reverted byte-for-byte.

### Judgement calls, recorded

**The RUNBOOK preamble was deliberately left untouched.** Line 22-24 says
`tests/unit/docs-policy.test.ts` "enforces the Phase 1 statuses mechanically".
After Task 2 that sentence is still *true*, merely no longer complete — so
editing it was not required for honesty, and leaving it kept Task 1's diff
purely additive as its acceptance criterion demanded. The completeness is
supplied inside the new Phase 2 section, which states that the guard parses both
sources of every `RB-<phase>-<n>` entry.

**`requirements mark-complete` was not run.** The plan's frontmatter lists
`[DIAG-01, DIAG-02, DIAG-04, DIAG-05, DIAG-07]`. DIAG-02, DIAG-04 and DIAG-07
were already marked Complete by plans 02-07, 02-08 and 02-05; DIAG-01 and
DIAG-05 **must stay Pending** — their `[RUNBOOK]` halves are the very entries
this plan recorded as OUTSTANDING. `REQUIREMENTS.md` was verified to already
carry exactly that state and was not edited.

## Verification performed

Everything below was executed, not inspected.

| # | What | Result |
|---|---|---|
| 1 | `npx vitest run` baseline before any edit | 30 files, 450 tests, green |
| 2 | `git diff --numstat docs/RUNBOOK.md` after Task 1 | `162 0` — additions only |
| 3 | `npx vitest run tests/unit/docs-policy.test.ts` after Task 2 | 41 tests green |
| 4 | `npm run test:unit && npm run typecheck` | 21 files / 404 tests green; `tsc --noEmit` clean |
| 5 | `npm test && npm run typecheck` after Task 3 | **30 files, 462 tests green**; typecheck clean |
| 6 | CR-byte scan on all three files | 0 in each |
| 7 | `git check-ignore --no-index docs/DIAGNOSTICS.md` | not ignored — committable |

### Falsifications executed, then reverted byte-for-byte

| # | Sabotage | Expected | Observed |
|---|---|---|---|
| A | RB-02-01 **table cell only** → `PASSED` | half-flip caught | 2 failures; Group C reports `INCONSISTENT` |
| B | RB-02-01 table cell **and** `**Status:**` → `PASSED` | full flip caught | 2 failures; Group C reports `PASSED` |
| C | `ID_RE` narrowed back to `/RB-01-\d{2}/g` | the generalisation is load-bearing | **5 failures** — the Phase 2 fixture, the Phase 2 half-flip, and all three real-file RB-02 assertions |
| D | `ID_RE` widened to `/RB-[\d-]+/g` | the shape is bounded | 1 failure — the malformed-id case |
| E | `` `cacheReadRatio` `` removed from `docs/DIAGNOSTICS.md` | the field-coverage check is not vacuous | reported `MISSING: cacheReadRatio` |

After A and B, `git status --short docs/RUNBOOK.md` printed nothing — the file
was restored byte-for-byte, not merely re-edited to look the same. C, D and E
were restored from a byte copy taken before the sabotage.

### The field-coverage check

`docs/DIAGNOSTICS.md`'s field list was compared to `schema.ts`'s `TurnRow` by
script rather than by eye: the interface body was parsed, 27 field names
extracted, and each required to appear in the document as an inline-code span.
Result: **27 found, 0 missing.** The check is non-vacuous by construction (a
regex matching nothing would report 0 fields, and it reported 27) and was
falsified anyway — see row E.

### The three worked examples were run

A fabricated `.pi/logs/` containing two turn rows, a `session_start` record, a
standalone `prose_tool_call` record and a three-record wire triple was built in
a scratch directory, and all three `sh` snippets from the "How to read a log"
section were executed against it. The most-expensive-turn pipeline returned
`deepseek-chat 1.9 s1#2`; the detector query correctly returned **only** the
kind-less action record, excluding the turn row that carries the same `event`
value; the join returned the full triple for `s1#2`. A documented command that
has never been run is a guess.

## Requirement state at Phase 2 close

| Requirement | State | Why |
|---|---|---|
| DIAG-01 | **Pending** | `[FAUX]` half complete since 02-05/02-07; `RB-02-01` OUTSTANDING |
| DIAG-02 | Complete | 02-07 |
| DIAG-03 | Complete | 02-07 |
| DIAG-04 | Complete | 02-08 |
| DIAG-05 | **Pending** | `[FAUX]` half complete since 02-09; `RB-02-03` OUTSTANDING |
| DIAG-06 | Complete | 02-10 |
| DIAG-07 | Complete | 02-05 |
| DIAG-08 | Complete | 02-03 |

Six of eight complete. The two that are not are the two carrying `[RUNBOOK]`
tags, and both now have an entry naming the exact command that would close them.

## What a later phase should know

- **`docs/RUNBOOK.md` now carries six entries and the guard is phase-agnostic.**
  Phase 3 (PROV-09, the file's formal owner) appends its section, adds
  `PHASE_THREE_IDS` and its `ENTRY_COMMANDS` rows, and spreads the array into
  `ALL_IDS`. Nothing else needs touching. The ordering constraint from Phase 2
  still applies: an entry may only name an offline proxy that already exists on
  disk, because `PROXY_PATH_RE` asserts every named test path exists.
- **`docs/DIAGNOSTICS.md` is the schema of record, and it says the code wins.**
  When a later phase adds a field to `TurnRow`, it adds a row to the field table
  in the same change. The field-coverage script used here is reproducible in a
  few lines and is worth promoting to a test the first time this document drifts.
- **BOOT-07's live CI run still has no runbook entry.** STATE.md flagged that
  gap during Phase 1 and this plan did not close it — it wrote only the three
  entries its own plan named. It remains a candidate for `RB-01-04`.

## Threat Flags

None. This plan installed nothing, added no dependency, registered no hook and
introduced no network, auth or file-access surface. Its only executable change
is one test file.

## Self-Check: PASSED

- `docs/RUNBOOK.md` — FOUND (7 occurrences of `RB-02-0`)
- `tests/unit/docs-policy.test.ts` — FOUND
- `docs/DIAGNOSTICS.md` — FOUND (434 lines)
- commit `a5e5193` — FOUND
- commit `ac74072` — FOUND
- commit `2d4cc7b` — FOUND
