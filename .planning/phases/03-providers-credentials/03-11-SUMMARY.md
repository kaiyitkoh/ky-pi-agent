---
phase: 03-providers-credentials
plan: 11
subsystem: runbook-and-traceability
tags: [wave-4, runbook, docs-policy, PROV-09, PROV-03, PROV-04, PROV-06, PROV-07, PROV-10, RUNBOOK]
requires:
  - "docs/RUNBOOK.md — the file Phase 1 created (RB-01-01..03) and Phase 2 extended (RB-02-01..03); this plan APPENDS to it"
  - "tests/unit/docs-policy.test.ts — the generalised RB-<phase>-<n> status guard Phase 2 left ready for a third phase (plan 02-11)"
  - "tests/unit/model-metadata.test.ts — the COST_UNVERIFIED allowlist and the forward reference plan 03-04 deliberately left undischarged"
  - "every offline proxy the five entries cite, all of which had to exist on disk first: tests/unit/{dashscope-compat,bedrock-auth,r1-unclamp,model-metadata}.test.ts and tests/integration/{dashscope-payload,sso-classifier,fallback-chain}.test.ts"
provides:
  - "docs/RUNBOOK.md Phase 3 section — RB-03-01..RB-03-05, all OUTSTANDING, each with exact commands, per-key expected output and a named offline proxy"
  - "PHASE_THREE_IDS in the status guard, five ENTRY_COMMANDS rows pinning whole one-line commands, and an RB-03-01 fixture pair"
  - "a new Group B invariant: every id docs/RUNBOOK.md DECLARES must appear in ALL_IDS, so the guard can no longer be disarmed by deleting a phase array"
  - "the COST_UNVERIFIED <-> RB-03-05 coupling plan 03-04 deferred, with a non-empty guard and a positive control"
  - "the honest phase-level record: five PROV requirements complete, five partial with their OUTSTANDING id named inline"
affects:
  - "Phase 4 (SAFE-01), Phase 5 (ROUTE-11), Phase 8 (GATE-10), Phase 10 (CTX-05) — each appends its own section and adds one array to docs-policy.test.ts; the new coverage case now FAILS if they forget"
  - "Phase 5 (/cheap) — blocked from defining a cheap thinking tier until RB-03-04 has a recorded result"
  - "any later change to .pi/templates/models-template.json's cost block — the allowlist is now coupled to the runbook entry in both directions"
tech-stack:
  added: []
  patterns:
    - "a runbook status is parsed from TWO sources (summary table + **Status:** line) and a half-flip is INCONSISTENT — inherited unchanged, and now proven live on a Phase 3 fixture"
    - "pin WHOLE one-line commands, not fragments (RB-02-03's recorded lesson), and verify each pin occurs exactly ONCE in the runbook so a neighbour cannot cover for it"
    - "a coverage assertion read OUT OF the artefact, so the guard fails when the guard itself is narrowed rather than only when the artefact changes"
    - "a positive control beside every list-driven case: assert the list is non-empty AND that the file being read is the intended one"
decisions:
  - "[Rule 2 deviation] Added a sixth edit the plan did not list: a Group B case asserting every id the runbook declares is in ALL_IDS. Falsification F7 proved the hole was real — deleting `...PHASE_THREE_IDS` from ALL_IDS dropped the suite from 78 to 63 tests and turned NOTHING red. A guard that can be disarmed by removing something is not a guard, and this plan's entire subject is that a status cannot be quietly changed."
  - "The requirement STATUS TABLE says `Partial — … Not complete` rather than Phase 1's `Complete offline — …` shape. Two shapes already existed in the file (BOOT-02's `Complete offline —` and SAFE-16's `Pending —`), and the file's own checkbox legend defines `[~]` as *partial* — so `Partial` is the file's vocabulary rather than an invention, and it is the only one of the three a skimmer cannot misread as done. PROV-03 and PROV-10 are explicitly not complete."
  - "PROV-09 is marked complete, alone among this plan's requirements. It is the only one whose subject is the document itself: the runbook exists, carries eleven entries with the four-part contract, and every status is machine-enforced. The other five are partial precisely BECAUSE this one is complete."
  - "No sixth RB id was created for 03-10's suggested fallback fixture-fidelity check. PROV-08 is [FAUX] and fully exercised offline, so an id would imply a live gate on a requirement that has none; the gap is recorded as machine-state prose with no id, which is the shape RESEARCH prescribes for exactly this."
  - "A runbook entry for BOOT-07's never-executed CI run was NOT added, per the plan's explicit out-of-scope instruction. It is a real gap, it is not credential-dependent, PROV-09 does not own it, and adding an id to PHASE_ONE_IDS from this phase would mix two phases' bookkeeping in one commit. It remains recorded in STATE.md's Blockers."
  - "RB-03-03 documents `aws sso login --profile X` with a literal placeholder `X` rather than a real profile name. The RESEARCH and CONTEXT wording is followed verbatim, and threat T-03-11-05 forbids a real profile name, account id or SSO start URL in a public file."
metrics:
  duration: ~55m
  tasks: 3
  files: 4
  completed: 2026-08-14
requirements-completed: [PROV-09]
---

# Phase 3 Plan 11: The Honesty Ledger Summary

The five things Phase 3 could not verify are now written down with exact commands
and precise expected output, marked OUTSTANDING in two places each, and enforced
by a test that fails on a half-flip, a full flip, a deleted command, a missing
proxy, a narrowed id pattern — and now on the guard being disarmed.

## What was built

**`docs/RUNBOOK.md` gained a Phase 3 section (426 lines, appended; 0 deletions).**
Phase 1's and Phase 2's sections are byte-identical to what they were.

| ID | Requirement | What only the work laptop can answer |
|---|---|---|
| RB-03-01 | PROV-03 | Does DashScope **accept** the compat block Pi emits? |
| RB-03-02 | PROV-10 | Does the **second** turn of a tool sequence return 200? |
| RB-03-03 | PROV-04 | Does Bedrock authenticate from a **fresh shell**? |
| RB-03-04 | PROV-07 | The R1 reasoning-token counts |
| RB-03-05 | PROV-06 | The real cap and the real per-token price |

Each carries the file's four-part contract: an exact copy-pasteable command, an
expected output specific enough that "it seemed fine" is not a result, a named
offline proxy that exists on disk, and a status line. All five say
`OUTSTANDING`, in both the summary table and the detail subsection.

Details that are load-bearing rather than decorative:

- **RB-03-01** lists each key individually (`enable_thinking`, top-level
  `reasoning_effort`, `max_tokens`; **no** `store`, `developer` role, `strict`,
  `prompt_cache_*`), states that a 200 with a missing `enable_thinking` is a
  finding rather than a pass, carries the `KYPI_DASHSCOPE_BASE_URL` remedy as
  one pasteable line (export **and** re-run bootstrap — the remedy is worthless
  in halves), and records the `thinkingFormat` contingency as a one-key change
  that cannot be made silently.
- **RB-03-02** keeps the RESEARCH skeleton's structure, including that
  `reasoning_content: ""` is correct and expected, and that **an absent
  `main.response` after the second request is the signal** — a 4xx throws before
  the response hook, so its absence *is* the evidence, and the turns row carries
  the provider's message.
- **RB-03-03** folds in the one live check of plan 03-08's classifier: all six
  SSO strings are fixtures this repository wrote, so the exact text of a *real*
  expiry — and whether the reauth line appeared — is recorded here either way.
  Both outcomes are results.
- **RB-03-04** reproduces the §Q6.2 procedure whole: the `modelOverrides`
  unclamp block, six numbered steps, the four-outcome table (including "no
  breakdown reported on either leg", which is a result and not a failed run),
  and the threshold `low.reasoning <= 0.6 * high.reasoning` stated as
  **pre-committed, so the result is a decision and not a vibe**. The status
  flips only with four fragments pasted in verbatim.
- **RB-03-05** names both `COST_UNVERIFIED` ids explicitly, which is what makes
  the new test in `model-metadata.test.ts` enforceable.

Plus a Phase 3 machine-state notes section (`qwen-token-plan` is a different
product with `sk-sp-` keys; DashScope keys are region- and workspace-scoped and
non-portable; a **pointer** to the existing `0600`-on-Windows note rather than a
restatement) and three closed doors: `after_provider_response` never fires on a
provider error (T2), the Qwen token-plan product (decision 7), and no Phase 3
SigV4 check because RB-02-02 already owns it (T10).

**`tests/unit/docs-policy.test.ts`** gained `PHASE_THREE_IDS` (added to
`ALL_IDS`, which already drives Group B and Group C), five `ENTRY_COMMANDS`
rows, an `RB-03-01` fixture pair, the Phase 3 sentence in Group C's failure
message, and the Rule 2 coverage case. `ID_RE`, `runbookEntryStatuses`, the
proxy-path scan and both loops are unchanged, exactly as the plan predicted.

**`tests/unit/model-metadata.test.ts`** discharges plan 03-04's forward
reference: every `COST_UNVERIFIED` id must be named in `docs/RUNBOOK.md`, with
the allowlist asserted non-empty *before* the filter and a positive control
asserting `RB-03-05` is itself present — otherwise a test reading the wrong file
passes on an empty list.

## Falsification — every touched test, mutated and confirmed red

Nine mutations. Each was applied to the real tree, run, and reverted. Every one
turned the suite red with a message that names what broke.

| # | Mutation | Expected | Observed |
|---|---|---|---|
| F1 | RB-03-04 **table cell only** → `PASSED` | INCONSISTENT | **2 failed** — `RB-03-04 is recorded as INCONSISTENT`, plus the table-row case |
| F2 | RB-03-04 table cell **and** `**Status:**` → `PASSED` | still red | **2 failed** — `RB-03-04 is recorded as PASSED` |
| F3 | delete `pi --list-models \| grep deepseek-v4-flash` from the entry, leaving the prose | command pin red | **1 failed** — `names the exact command(s) for RB-03-04` |
| F4 | `dashscope/deepseek-v4-pro` no longer named in the runbook | coupling red | **1 failed** — `names every COST_UNVERIFIED model in docs/RUNBOOK.md` |
| F5 | `COST_UNVERIFIED` emptied | non-empty guards red | **3 failed** — including the new case, which did **not** pass vacuously |
| F6 | `RB-03-05` renamed to `RB-03-09` throughout the runbook | positive control red | **4 failed** — including `names RB-03-05 in docs/RUNBOOK.md` and the new coverage case |
| F7 | `...PHASE_THREE_IDS` deleted from `ALL_IDS` | **the reason the Rule 2 case exists** | **1 failed**, and the suite dropped from **78 tests to 63** — without the new case, nothing would have gone red at all |
| F8 | `ID_RE` narrowed back to `RB-0[12]-\d{2}` | Phase 3 fixtures red | **8 failed** — both new fixture cases plus all five real-file statuses |
| F9 | a cited proxy renamed to a path that does not exist | proxy scan red | **1 failed** — `every named test exists on disk` |

F1 and F2 are the two flip directions the plan's acceptance criteria name, and
both are confirmed with the exact status token the parser reported. F7 is the
one that changed the plan: it proved the guard could be disarmed silently, which
is why the Rule 2 case was added.

**A process failure worth recording.** The first falsification batch used
`git checkout --` to restore, while Task 2's edits were still **uncommitted** —
so the restore deleted them, and F2/F3 reported a green 58-test run against the
*pre-edit* file. That is exactly the "a mutation that proves nothing looks
identical to one that passed" trap plan 03-10 recorded, arriving from a
different direction. The edits were re-applied, committed, and every
falsification above was re-run against the committed tree.

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — missing critical functionality] The guard could be disarmed by deletion**

- **Found during:** Task 2, while designing the falsification set.
- **Issue:** Both loops in the file iterate `ALL_IDS`. Every assertion says "the
  ids in `ALL_IDS` are OUTSTANDING"; nothing said "`ALL_IDS` covers the file".
  Deleting `...PHASE_THREE_IDS` therefore left five live checks with **no
  assertion at all** and made the suite *greener* — the same silent shape as
  Phase 1's literal `RB-01-\d{2}`, but reachable by a one-token edit instead of
  by a new phase. Threat T-03-11-02 is mitigated only against forgetting to add
  an array, not against removing one.
- **Fix:** one Group B case reading the declared ids **out of the runbook** and
  asserting every one is governed. It also catches a sixth entry appended
  without extending the array.
- **Files:** `tests/unit/docs-policy.test.ts`
- **Falsified by:** F7 (and F6, F8 as side effects).
- **Commit:** `4500091`

### Recorded, not fixed

- **BOOT-07's live CI run still has no runbook entry.** The plan explicitly puts
  it out of scope and asks for it to be said here rather than done: it is a real
  gap, but it is not credential-dependent, PROV-09 does not own it, and adding
  an id to `PHASE_ONE_IDS` from a Phase 3 commit would mix two phases'
  bookkeeping. It stays in STATE.md's Blockers.
- **The fallback chain's error strings are fixtures.** Recorded as Phase 3
  machine-state prose with no id, per 03-10's own suggestion and RESEARCH's
  "additional prose, no id needed" shape. PROV-08 is `[FAUX]` and stays
  complete.

## Requirements

Reconciled against what the eleven summaries actually prove, not against which
plans ran.

| Req | State | Why |
|---|---|---|
| PROV-01 | **Complete** | templates + installer, structurally complete, zero secrets, `$ENV_VAR` resolution proven through Pi's own loaders |
| PROV-02 | **Complete** | `[FAUX]` end to end; proven by subprocess count, both directions |
| PROV-03 | **Partial** — `RB-03-01` OUTSTANDING | composed compat and emitted bytes both proven; provider acceptance is not |
| PROV-04 | **Partial** — `RB-03-03` OUTSTANDING | resolution order proven with the whole chain blanked; a real SSO session is not |
| PROV-05 | **Complete** | `[FAUX]`; message and non-retryability proven by call count against a retryable control |
| PROV-06 | **Partial** — `RB-03-05` OUTSTANDING | the invariant and the allowlist are complete and enforced both ways; the real cap and price are unknown |
| PROV-07 | **Partial** — `RB-03-04` OUTSTANDING | the experiment is executable and unit-proven; it has never been run |
| PROV-08 | **Complete** | `[FAUX]`; four-class taxonomy anchored on Pi's own predicate |
| PROV-09 | **Complete** | eleven entries, four-part contract, statuses machine-enforced in two places each |
| PROV-10 | **Partial** — `RB-03-02` OUTSTANDING | `reasoning_content` proven on real bytes with a paired negative; the second turn's 200 is not |

Five complete, five partial. No status anywhere in the repository reads
`PASSED` for a check nobody executed.

## What this does NOT prove

Nothing in this plan contacted a provider and nothing in it could. It is
documentation, one test file extended, one test file discharged, and two
planning documents reconciled. Specifically:

- It does not make PROV-03, PROV-04, PROV-06, PROV-07 or PROV-10 true. It makes
  their **untruth legible**, which is the only thing a desk can contribute.
- The eleven statuses being `OUTSTANDING` is not evidence that the checks are
  hard. It is evidence that nobody has run them.
- The commands in the new entries have been checked for **presence and
  uniqueness**, not for **correctness on a live machine**. They were written
  from Pi's documented log shapes and this repository's own schema; the first
  operator to run them may find a flag that needs adjusting, and that correction
  belongs in the same commit as the status flip.

## Verification

| Check | Result |
|---|---|
| `npm test` | 45 files, **638 passed** (baseline 618 + 20 new) |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no output |
| `npx vitest run tests/unit/docs-policy.test.ts` | 66 passed |
| `npm run test:unit` | 32 files, 536 passed |
| `git diff docs/RUNBOOK.md` at Task 1 | **426 insertions, 0 deletions** — Phase 1 and Phase 2 byte-identical |
| RB-03 headings with `**Status:** OUTSTANDING` | 5 / 5 |
| Phase 3 summary-table rows ending `OUTSTANDING` | 5 / 5 |
| every `tests/**/*.test.ts` path named in the new section | all 7 exist on disk |
| `grep -c '0600' docs/RUNBOOK.md` | 2 → 3 (+1: a pointer, not a restatement) |
| required strings in the new section | `KYPI_DASHSCOPE_BASE_URL` ✓ `aws sso login --profile` ✓ `qwen-token-plan` ✓ `reasoning_content` ✓ `0.6` ✓ |
| each of the 12 pinned commands, occurrences in the runbook | exactly **1** each |
| `grep -c 'OUTSTANDING' docs/RUNBOOK.md` change during Task 3 | 0 — the runbook is untouched by that commit |
| network requests issued | none |

## Known Stubs

None. Every entry is complete prose; the five OUTSTANDING statuses are the
plan's intended output, not placeholders.

## Self-Check: PASSED

- `docs/RUNBOOK.md` — FOUND
- `tests/unit/docs-policy.test.ts` — FOUND
- `tests/unit/model-metadata.test.ts` — FOUND
- `.planning/REQUIREMENTS.md` — FOUND
- `.planning/ROADMAP.md` — FOUND
- commit `5e554e1` (Task 1) — FOUND
- commit `4500091` (Task 2) — FOUND
- commit `6e6e9bc` (Task 3) — FOUND
