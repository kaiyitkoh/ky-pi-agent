---
phase: 02-diagnostics-the-instrument
plan: 08
subsystem: diagnostics
tags: [wave-4, turn-row, main-loop-hooks, pitfall-3, correlation-join, DIAG-04]
requires:
  - "02-03 — .pi/extensions/diagnostics/jsonl.ts (appendJsonl), schema.ts (TURNS_LOG_BASE, TURNS_ROTATE_BYTES, MAX_ROTATED_FILES, DIAGNOSTICS_ERROR_EVENT, TurnRow), index.ts (safeHandler, noteRowWritten)"
  - "02-05 — .pi/extensions/diagnostics/wire.ts (currentCorrelationId, registerWireHooks)"
  - "02-06 — .pi/extensions/diagnostics/turns.ts (composeTurnRow, TurnRowInput)"
  - "02-01 — tests/helpers/{session,faux,logs,git}.ts"
provides:
  - ".pi/extensions/diagnostics/index.ts — turn_start / message_end / turn_end wiring; the entry point now registers seven hooks"
  - ".pi/extensions/diagnostics/index.ts — SESSION_TURN_ROLE, TURN_NO_MESSAGE_WHERE, MODEL_UNAVAILABLE_EVENT"
  - "tests/integration/turns-log.test.ts — six live-session cases, eleven executed falsifications"
  - ".pi/extensions/diagnostics/schema.ts — Api and Model added to the pi-ai type barrel"
  - ".pi/extensions/diagnostics/wire.ts — UNCORRELATED is now exported, so both logs spell the sentinel one way"
affects:
  - "02-09 (prose retry) — the message_end hook now exists and is block-bodied; the retry must send a follow-up user message, NOT return a replacement"
  - "02-10 (/budget) — rowsWrittenThisSession() now counts main-loop turn rows too"
  - "02-11 (docs/DIAGNOSTICS.md) — the turn-row column list and the 'absence of reasoning means no breakdown' paragraph are here and in turns.ts, to copy rather than re-derive"
  - "Phase 8 (cost accounting) — reads cost.*, role and kind; a row carrying event: diagnostics.model_unavailable must be excluded from a spend total"
  - "Phase 10 (root-cause discrimination) — reads outcome and stopReason per turn"
tech-stack:
  added: []
  patterns:
    - "capture the correlation id at message_end, not turn_end: tool execution in between may issue a new one"
    - "a missing measurement is written as a visible error row, never as a skipped append"
    - "a degraded computation is MARKED, so a zero is never indistinguishable from a computed zero"
    - "assert required fields against Object.keys of the DESERIALISED record — a key assigned undefined survives in memory and vanishes in JSON"
    - "put the structural 'no field came from this hook' guard on the ERROR fixture, where the claim is load-bearing"
key-files:
  created:
    - tests/integration/turns-log.test.ts
  modified:
    - .pi/extensions/diagnostics/index.ts
    - .pi/extensions/diagnostics/schema.ts
    - .pi/extensions/diagnostics/wire.ts
    - tests/unit/diagnostics-entry.test.ts
decisions:
  - "DIAG-04 is marked COMPLETE — it is [FAUX]-only and both halves (the pure composer in 02-06, the live wiring here) are proven offline"
  - "the row spine is turn_start + message_end + turn_end and nothing is derived from after_provider_response; case 4 asserts the absence of httpStatus on an errored row, where faux DID fire the response hook"
  - "the correlation id is captured at message_end rather than turn_end, so a nested callModel during tool execution cannot stamp its id onto the turn row"
  - "an absent ctx.model degrades to a zero-rate model shape AND marks the row with diagnostics.model_unavailable rather than emitting an unmarked zero cost"
  - "Api and Model were added to schema.ts's type barrel rather than making index.ts a fourth pi-ai import site"
  - "wire.ts's UNCORRELATED sentinel is exported rather than re-typed in index.ts"
metrics:
  duration: ~40m
  tasks: 2
  files: 5
  completed: 2026-08-13
---

# Phase 2 Plan 08: The Per-Turn Row Summary

Every completed turn now appends exactly one honest JSONL row — model,
provider, tokens, cost, latency, cache-read ratio, outcome, thinking level —
and the turns that FAILED are in there too, joined to the bytes that produced
them by a shared correlation id.

## What was built

### Task 1 — the three turn hooks in `index.ts` (commit `3a52792`)

The entry point registers seven hooks now: `session_start`, the three
main-loop provider hooks from 02-05, and `turn_start` / `message_end` /
`turn_end`. All three new ones go through `safeHandler`, all three are
block-bodied, and none returns a value.

| Hook | What it contributes |
|---|---|
| `turn_start` | `startedAt` from `event.timestamp`, `ctx.thinkingLevel`, and a fresh accumulator that clears any stale message |
| `message_end` | the finalized assistant message and the correlation id live at that instant |
| `turn_end` | `turnIndex`, `toolResults.length`, and the append itself |

**Why not `after_provider_response`.** It sits after the retry wrapper
[VERIFIED: pi-ai 0.84.1 `src/api/openai-completions.ts:239`] and a 4xx/5xx
throws into the catch at `:590`, so a row built from it would be missing
exactly the turns most worth having. Pitfall 3's warning sign is a day with
errors visible on screen and zero rows carrying `outcome: "error"`. The agent
loop does reach `turn_end` on an error —
`if (message.stopReason === "error" || …) { await emit({ type: "turn_end", message, toolResults: [] }); }`
[VERIFIED: pi-agent-core 0.84.1 `dist/agent-loop.js:106-110`] — so the spine
chosen here records what the response hook cannot.

**Three things the file now states rather than leaves to be rediscovered:**

**The correlation id is captured at `message_end`, not `turn_end`.**
`currentCorrelationId()` returns the last id this module instance issued.
Between the assistant message and the end of the turn, tool execution runs —
and a tool, a Phase 5 router or a Phase 8 gate may make a nested `callModel`
invocation, which issues its own id. Reading the id at `turn_end` would stamp
the turn row with the nested call's correlation and join the turn to bytes it
never sent.

**A turn with no assistant message leaves a visible hole, not silence.**
`turn_end` appends a `diagnostics.error` row with
`where: "turn_end.no_message"` and counts it, so `rowsWrittenThisSession()`
still matches the file. [threat T-02-08-02]

**A degraded cost is marked.** `ctx.model` is `Model<any> | undefined`
[VERIFIED: pi `dist/core/extensions/types.d.ts:223`]. When it is missing the
row is still written, against a zero-rate model shape carrying the message's
own provider and model strings — and it carries
`event: "diagnostics.model_unavailable"`, so Phase 8 can exclude it instead of
quietly under-counting. A zero cost that looks exactly like a computed one is a
fabricated measurement. [threat T-02-08-05]

`message_end`'s handler carries the contract in a comment: a returned
`{ message }` REPLACES the finalized message and the replacement must keep the
role [VERIFIED: pi `src/core/extensions/types.ts:1097-1100`]; the runner applies
it by deleting every key on the live object and `Object.assign`-ing the
replacement on (`agent-session.ts:710-724`), which the loop reads back
immediately (`pi-agent-core agent-loop.ts:350-352`). Diagnostics never replaces
a message. [threat T-02-08-04]

### Task 2 — `tests/integration/turns-log.test.ts` (commit `fc89d26`) — 6 cases

Four in-memory sessions, the real extension loaded at user scope, all six cases
reading the bytes that actually landed on disk.

| Case | What it holds |
|---|---|
| 1 | one prompt → exactly one `kind:"turn"` row carrying all 18 always-present fields, `cost.total > 0`, finite non-negative `latencyMs`, `turnIndex` 0, a real `thinkingLevel` |
| 2 | the row's `corr` equals the `main.request` wire record's `corr`; a per-attempt id is explicitly not claimed, because retries reuse headers [CITED: docs/extensions.md:676] |
| 3 | a tool turn: two rows, `outcome: "tool_use"`, `toolCalls ≥ 1`, and `toolResults` — the one field that can come only from `turn_end` |
| 4 | an errored turn still produces a row: `outcome: "error"`, `errorMessage` present and redacted, non-secret half surviving, **and no `httpStatus` key** |
| 5 | the second turn of a session reads from cache: `cacheRead > 0`, `0 < cacheReadRatio < 1`, with a paired negative on the first turn |
| 6 | no faux row carries a `reasoning` key at all |

Case 4's `httpStatus` assertion is the structural half of Pitfall 3, and it sits
on the error fixture deliberately: faux answers `{status: 200}` unconditionally
before it even looks at the scripted step (`pi-ai faux.ts:341`), so
`after_provider_response` **did** fire for that errored turn — and the row still
carries no status, because no field of a main-loop row is derived from that
hook. An `httpStatus` appearing there is the early warning that the spine moved.

Case 1 checks required fields against `Object.keys` of the DESERIALISED record
rather than `toBeDefined()`, so a field assigned `undefined` — which
`JSON.stringify` silently drops while `Object.keys` in memory still reports it —
fails here instead of surviving as a hole nobody notices.

Case 5's ratio is faux's prefix-cache simulation keyed on `options.sessionId`
(`faux.ts:118-150`), which Pi's main loop does supply
(`pi dist/core/sdk.js:218`). It is a simulation, not a provider measurement; the
real figure is an `RB-02-01` observation and stays **OUTSTANDING**.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npx vitest run tests/integration/turns-log.test.ts` | exit 0, 6 tests |
| `npx vitest run` wire-nonmutating + extension-layout + contributing-boundary + diagnostics-entry + chokepoint-lint | exit 0, 31 tests |
| `npm test` (full suite) | 27 files, **426 tests passed** (was 420 after 02-07) |
| `grep -c registerTool .pi/extensions/diagnostics/index.ts` | 0 |
| registered hook list | exactly the seven the plan names, asserted in `tests/unit/diagnostics-entry.test.ts` |
| CR bytes in all five touched files | 0 |
| `.pi/logs/` in this repository | does not exist |
| `git status --porcelain` after the full suite | clean |

### A real row, dumped from a live session (not hand-written)

```json
{"ts":1786600575245,"kind":"turn","role":"session","sessionId":"019ff9b1-…",
 "corr":"019ff9b1-…#1","provider":"faux","model":"faux-flash","input":624,
 "output":6,"cacheRead":0,"cacheWrite":624,"totalTokens":1254,
 "cost":{"input":0.000624,"output":0.000012,"cacheRead":0,"cacheWrite":0.000936,
 "total":0.001572},"latencyMs":7,"stopReason":"toolUse","outcome":"tool_use",
 "toolCalls":1,"cacheReadRatio":0,"turnIndex":0,"toolResults":1,
 "thinkingLevel":"medium"}
```

No `reasoning` key, no `httpStatus`, a real cost against faux's all-zero
`usage.cost`, and the `corr` matching that turn's `main.headers` /
`main.request` / `main.response` triple. This dump was taken with a throwaway
probe, read, and the probe deleted — it is the reason the `thinkingLevel`
assertion exists at all.

### Falsification checks — eleven, executed, each restored byte-identical

Every sabotage was applied to the real source, the suite run, and the file
restored from a backup verified with `md5sum` and `diff`.

| # | Sabotage | Case that failed |
|---|---|---|
| A | error turns skipped at the append | 4 — "an errored turn produced NO row" |
| B | `corr` forced to the `uncorrelated` sentinel | 2 |
| B2 | `corr` set to a plausible but WRONG id (`#99`) | 2 — the join, not just the sentinel |
| C | `toolResults` dropped from the input | 3 |
| D | `thinkingLevel` never captured at `turn_start` | 1 |
| E | `row.reasoning = usage.reasoning ?? 0` | 6 |
| F | cost copied from `usage.cost` instead of recomputed | 1 — `expected 0 to be greater than 0` |
| G | `errorMessage` not passed through `redactString` | 4 |
| H | `cacheRead` zeroed on the row | 5 |
| I | `httpStatus: 200` added to the composed row | 4 — the Pitfall 3 structural guard |
| J | the row appended twice | 1, 2, 3, 4, 5 |
| K | a required field (`sessionId`) assigned `undefined` | 1 — proving the `Object.keys` check, not a `toBeDefined` |

Sabotage B2 matters more than B: a sentinel check alone would pass any
confidently-wrong id. Sabotage K matters because it is the difference between
the two assertion styles — `toBeDefined()` on a key assigned `undefined` fails,
but the key would still have been reported present by a naive in-memory check.

## Deviations from Plan

### Auto-fixed / necessary

**1. [Rule 3 — blocking] `Api` and `Model` added to `schema.ts`'s type barrel.**

- **Found during:** Task 1
- **Issue:** the degraded-model fallback the plan asks for must be typed
  `Model<Api>`; without the annotation its `input: ["text"]` infers `string[]`
  and is not assignable to `("text" | "image")[]`. Importing those types
  directly into `index.ts` would have made it a FOURTH pi-ai import site, which
  `schema.ts`'s import-concentration rule exists to prevent (pi-ai's root
  entrypoint has an announced future removal).
- **Fix:** `schema.ts` re-exports `Api` and `Model` type-only, with the reason
  written at the export. That is exactly the route its own docstring prescribes:
  "Everything else imports the re-declared types from here."
- **Files modified:** `.pi/extensions/diagnostics/schema.ts`
- **Commit:** `3a52792`

**2. [Rule 3 — blocking] `UNCORRELATED` exported from `wire.ts`.**

- **Found during:** Task 1
- **Issue:** `TurnRowInput.corr` is a required string, so `turn_end` needs a
  value when no id was ever issued. Re-typing `"uncorrelated"` in `index.ts`
  would be a duplicated literal — the house rule (`harness/index.ts:50-56`) says
  that is precisely how an assertion silently stops matching the thing it
  checks, and here it would mean a reader greps one spelling and misses half the
  evidence.
- **Fix:** the constant is exported, with the reason recorded at its docstring.
- **Files modified:** `.pi/extensions/diagnostics/wire.ts`
- **Commit:** `3a52792`

**3. [Rule 3 — blocking] `tests/unit/diagnostics-entry.test.ts`'s hook list grew.**

That test asserts the registered-hook list is exactly four entries, and its own
failure message says: *"If this list changes, a later plan in this phase is
adding hooks and this assertion should grow with them — not be deleted."* It now
asserts all seven, and the message names which plan added which and why
`after_provider_response` is there for the wire dump only.

**4. [Rule 2 — correctness] `writeTurnsRow` passes the rotation cap explicitly.**

The plan specifies `{ rotateBytes: TURNS_ROTATE_BYTES, maxRotated: MAX_ROTATED_FILES }`
at the append. `appendJsonl` already resolves the same numbers from the base
name (`jsonl.ts:269-271`), so this is not a behaviour change — but it is applied
inside the shared `writeTurnsRow` helper rather than only at the new call site,
so every turns append in the file (including `safeHandler`'s error rows) reads
identically to `call-model.ts`'s.

### Additions beyond the letter of the plan

- **A `thinkingLevel` assertion in case 1.** The plan says to record the
  requested level; nothing in it asserts the recording. A live session resolves
  it to a real value (`"medium"` in the dump above), so the assertion is safe and
  falsification D proves it bites. An unasserted field is a field that will
  quietly stop being written.
- **The `httpStatus`-absence assertion in case 4.** The plan's central claim is
  "nothing is derived from `after_provider_response`". Nothing else in the file
  would have caught a later plan wiring that hook back in.
- **A paired negative in case 5** (`rows[0].cacheRead === 0`). Without it, the
  cache assertion cannot distinguish a working column from one that reports a
  non-zero number unconditionally.
- **`readStream`** fails with the remedy — "the extension must load at USER
  scope" — rather than an `ENOENT` stack forty frames from the cause. A missing
  log file is the single most likely failure of this file.
- **Sabotage B2 and K**, which test the *quality* of two assertions rather than
  their presence.

### Findings recorded for the next plan

**5. `turnIndex` resets per prompt, not per session.** `_turnIndex = 0` on
`agent_start` [VERIFIED: pi `dist/core/agent-session.js:441-443`], so two
prompts in one session both produce a row with `turnIndex: 0`. The correlation
id, not `turnIndex`, is what uniquely identifies a turn. Any later plan
grouping rows must not key on `turnIndex`.

**6. `thinkingLevel` is populated in a headless faux session.** It resolved to
`"medium"` with no configuration, so 02-10's `/budget` can rely on it being
present rather than defensive about it.

## Known Stubs

None. Every hook registered is exercised end to end. The `turn_end.no_message`
error path and the `diagnostics.model_unavailable` degradation are the two
branches with no dedicated test: neither is reachable through a live faux
session (the loop always finalizes a message, and `ctx.model` is always set),
and manufacturing them would require a hand-built `ExtensionContext` that proves
the mock, not the code. They are cheap, defensive, and each writes a row that
NAMES itself — which is the property that matters. `02-10`'s `/budget` work is
the natural place to add a unit-level probe for both, since it will already be
driving handlers against a stub context.

## Threat Flags

None beyond the plan's own register.

| Threat | Where it is closed |
|---|---|
| T-02-08-01 errored turns producing no row | the spine is `turn_start` + `message_end` + `turn_end`; case 4 plus falsifications A and I |
| T-02-08-02 a turn silently producing no row | `turn_end` writes a `diagnostics.error` row with `where: "turn_end.no_message"` and counts it |
| T-02-08-03 a secret echoed in `errorMessage` | `composeTurnRow` → `redactString`; case 4 asserts both the redaction and the survival of the non-secret half; falsification G |
| T-02-08-04 `message_end` replacing the finalized message | block-bodied handler, contract cited at `types.ts:1097-1100`, seven-hook registration asserted in the unit test |
| T-02-08-05 a fabricated cost when the model is unavailable | the degraded path sets `event: diagnostics.model_unavailable` |
| T-02-08-06 unbounded turns rows | `TURNS_ROTATE_BYTES` (8 MB), 10 rotated files, 14-day retention from 02-03 — now passed explicitly at the append |
| T-02-08-SC supply chain | nothing installed; `tests/unit/pinning.test.ts` still green in the full run |

## Notes for the next plan

- **02-09 must not return a value from `message_end`.** The hook is now
  registered by this file. The prose retry sends a follow-up user message; it
  does NOT return `{ message }`, and if it ever needs to, the role must be
  preserved or the runner `emitError`s and continues silently.
- **Do not append a second turns row from a `message_end` handler.** `turn_end`
  already writes one per turn and counts it. 02-09 sets `event: PROSE_EVENT`
  through the accumulator, not through a second append.
- **`role` on a main-loop row is the constant `SESSION_TURN_ROLE`.** Import it;
  do not re-type `"session"`.
- **DIAG-01 is still Pending.** Its `[FAUX]` half is complete but `RB-02-01` is
  **OUTSTANDING**, and 02-11 owns the runbook entry.
- **DIAG-04 is COMPLETE.** It is `[FAUX]`-only, and both halves — the pure
  composer (02-06) and the live wiring (this plan) — are proven offline.

## Self-Check: PASSED

All five touched files exist on disk
(`.pi/extensions/diagnostics/{index,schema,wire}.ts`,
`tests/integration/turns-log.test.ts`, `tests/unit/diagnostics-entry.test.ts`),
and both task commits (`3a52792`, `fc89d26`) are present in `git log`.
