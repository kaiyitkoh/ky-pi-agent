---
phase: 02-diagnostics-the-instrument
plan: 06
subsystem: diagnostics
tags: [wave-3, turn-row, cost, omitted-key-rule, DIAG-04]
requires:
  - "02-02 — .pi/extensions/diagnostics/redact.ts (redactString)"
  - "02-03 — .pi/extensions/diagnostics/schema.ts (TurnRow, TurnCost, Outcome, RowKind, OUTCOME_BY_STOP_REASON, AssistantMessage/StopReason re-exports)"
  - "02-01 — tests/helpers/faux.ts (SECRET_FIXTURE_TOKEN)"
provides:
  - ".pi/extensions/diagnostics/turns.ts — composeTurnRow, outcomeFor, cacheReadRatio, TurnRowInput"
  - "tests/unit/turn-row.test.ts — 52 inline-fixture proofs of the omitted-key rule, the outcome map, the error row, cost and optional-field discipline"
affects:
  - "02-08 (the message_end / turn_end wiring) — imports composeTurnRow and appends through appendJsonl(TURNS_LOG_BASE, …); it owns latencyMs, turnIndex, toolResults and httpStatus"
  - "02-09 (prose retry) — passes `event: PROSE_EVENT` / `PROSE_EXHAUSTED_EVENT` through TurnRowInput; no new field needed"
  - "02-11 (docs/DIAGNOSTICS.md) — the omitted-key paragraph in turns.ts's docstring is the source of truth to copy, not re-derive"
  - "Phase 8 (cost accounting) — reads cost.* and the reasoning key's presence; absence means 'no breakdown reported', never zero"
tech-stack:
  added: []
  patterns:
    - "optional fields ASSIGNED after the literal, never declared with an undefined value — absence is structural, and Object.keys can tell the two apart"
    - "a defensive recompute on an isolated copy: the instrument must not edit the object it measures"
    - "a table lookup against a Record<Union, …> so tsc catches a new union member, paired with a map-size assertion so an added-but-unexercised member also fails"
    - "inline fixtures for a pure composer, dodging the *.jsonl gitignore trap entirely"
key-files:
  created:
    - .pi/extensions/diagnostics/turns.ts
    - tests/unit/turn-row.test.ts
  modified:
    - .pi/extensions/diagnostics/schema.ts
decisions:
  - "DIAG-04 stays Pending — this plan ships the pure composer; nothing calls it until the message_end/turn_end wiring in 02-08, so no turn appends a row yet"
  - "turns.ts is the third sanctioned pi-ai import site: calculateCost is a VALUE and cannot come through schema.ts's type-only barrel"
  - "calculateCost is handed an isolated copy of usage rather than the message's own object — it mutates usage.cost in place and the instrument must not alter what it measures"
  - "the omitted-key rule is asserted on Object.keys, never toBeUndefined; the falsification run proved the difference is real"
  - "message.diagnostics is deliberately NOT copied onto the row — its 'redacted' docstring describes intent, not behaviour"
metrics:
  duration: ~35m
  tasks: 2
  files: 3
  completed: 2026-08-13
---

# Phase 2 Plan 06: The Turn Row Summary

A pure composer turns a finalized `AssistantMessage` plus turn timing into a
complete, honest `TurnRow`: cost that is a real number even offline, `outcome`
derived from `stopReason` so an errored turn still produces a row, and a
`reasoning` key that is *genuinely absent* — not zero, not `null` — whenever the
provider reports no breakdown.

## What was built

### Task 1 — `.pi/extensions/diagnostics/turns.ts` (commit `2031a24`)

| Export | What it does |
|---|---|
| `composeTurnRow(input)` | the whole row, pure, from a finalized message plus timing |
| `outcomeFor(stopReason)` | a lookup through `OUTCOME_BY_STOP_REASON`, never a private branch chain |
| `cacheReadRatio(usage)` | `cacheRead / (input + cacheRead)`, `undefined` on a zero denominator |
| `TurnRowInput` | `kind`, `role`, `sessionId`, `corr`, `message`, `model`, `latencyMs` + five optionals |

Three rules are stated at the top of the file rather than left for a reader to
infer:

**The sourcing rule.** Every field comes from the finalized message. Nothing may
be derived from `after_provider_response`, because that hook does not fire on a
provider error — `onResponse` sits after `retryProviderRequest`
[VERIFIED: pi-ai `openai-completions.ts:239`] and a 4xx/5xx throws into the catch
at `:590`. A row sourced there would be missing exactly the turns worth reading.
The hook contributes one optional field, `httpStatus`, and nothing else. The
finalized message, by contrast, exists for every outcome, which is why an errored
turn still produces a row at all.

**The omitted-key rule.** `reasoning` is assigned only when
`message.usage.reasoning !== undefined`, so the key is absent from the object
rather than present holding `undefined`. `JSON.stringify` drops an `undefined`
value but `Object.keys` still reports the key — "present but undefined" and
"absent" are two different objects that serialise identically, and only one of
them is honest in memory. The same discipline governs `cacheReadRatio`,
`httpStatus`, `rawStopReason`, `responseModel`, `turnIndex`, `toolResults`,
`thinkingLevel`, `event` and `errorMessage`. The docstring states the reading
that `docs/DIAGNOSTICS.md` must repeat verbatim: **absence of the key means the
provider reports no breakdown; it does not mean zero thinking tokens were
billed.**

**Why the cost is recomputed.** `calculateCost` is called on every row even
though real adapters already called it, because `fauxProvider` hardcodes
`usage.cost` to all zeros [VERIFIED: pi-ai `faux.ts:256-266`] and the function is
idempotent [VERIFIED: pi-ai `models.ts:878-898`]. Without it every offline cost
assertion in this repo is `0 === 0`.

`message.diagnostics` is **not** copied. Its type calls itself "Redacted
provider/runtime diagnostics" and `pi-ai/src/utils/diagnostics.ts` contains no
redaction logic whatsoever — the word describes intent. The refusal, and the
instruction that a later plan must pass every string through `redactString`
first, sit at the point in the function where the copy would have gone.

### Task 2 — `tests/unit/turn-row.test.ts` (commit `e2d221c`) — 52 tests

Inline fixtures only: `.gitignore` blanket-ignores `*.jsonl`, so a committed dump
fixture would be absent from a fresh clone and this file would be vacuous in CI
while passing locally (blocker B5). The fixture model carries the same four cost
rates as `tests/helpers/session.ts`'s faux model, so the unit and in-session
halves of DIAG-04 price a turn identically, and every product is exact arithmetic
the test states as literals rather than re-deriving from the rates.

1. **The omitted-key rule, four ways** — key absent when `reasoning` is
   `undefined`; key *present* holding `0` when the provider genuinely reports
   zero; `812` recorded verbatim; and the undefined case round-tripped through
   `JSON.parse(JSON.stringify(row))` so the on-disk row matches the in-memory one.
2. **The outcome map, exhaustively** — every key of `OUTCOME_BY_STOP_REASON`
   drives a case, each also asserting the raw `stopReason` survives beside the
   interpretation, plus a map-size assertion of exactly 7 and a check that
   `outcomeFor` agrees with the table.
3. **The error row** — `stopReason: "error"` produces a row (not a skip), the
   latency is still recorded, the secret-shaped credential is gone, `[redacted:`
   is present, and — the paired positive — the non-secret half of the message
   survives, because over-redaction is a failure too. A successful turn omits
   `errorMessage` entirely.
4. **Cost is real** — the fixture asserts `message.usage.cost.total === 0` *before*
   composing (or the case proves nothing), then asserts `row.cost.total > 0`, then
   prices each of the four components against the stated arithmetic, then asserts
   the message's own `usage.cost` is still zero afterwards.
5. **cacheReadRatio** — `0.75` for `input: 100, cacheRead: 300`; the key absent
   for `input: 0, cacheRead: 0`; and the exported helper checked directly in both
   directions.
6. **Optional-field discipline** — `httpStatus`, `rawStopReason`, `responseModel`,
   `turnIndex`, `toolResults`, `thinkingLevel` and `event` each asserted absent
   when unsupplied *and* present when supplied, so every absence assertion has a
   positive twin. `responseModel` is absent when it merely echoes `model` and
   present when it differs. `toolCalls` counts blocks, with a text-only turn
   asserted to be `0` rather than omitted.
7. **Required-field completeness** — the seventeen always-present fields of
   RESEARCH §5.5 asserted one test each on a successful turn and again as a group
   on an errored one, plus verbatim copying of provider/model/token counts,
   `ts` stamped at composition rather than copied from the message clock, and
   `kind`/`role`/`sessionId`/`corr` passed through untouched.

Every `expect` carries a "what this protects" message naming the ROADMAP
criterion or the threat it serves.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npx vitest run tests/unit/turn-row.test.ts` | exit 0, **52 tests**, 0.4 s |
| `npm run test:unit` | exit 0 (part of the full run below) |
| `npm test` (full suite) | 24 files, **406 tests passed** (was 354 after 02-05) |
| `npx vitest run tests/unit/extension-layout.test.ts tests/unit/contributing-boundary.test.ts` | exit 0, 15 tests — the new sibling module does not regress the BOOT-05 layout gate |
| `grep -c calculateCost turns.ts` | 5 |
| `grep -c 'reasoning: 0\|reasoning: null' turns.ts` | **0** |
| `grep -c after_provider_response turns.ts` | 2, both inside comments explaining why it is not a source |
| `grep -c registerTool turns.ts` | 0 |
| `grep -c switch turns.ts` | 0 — the mapping is a table lookup |
| `grep -c 'export default' turns.ts` | 0 — an imported module, not an entry point |
| CR bytes in both new files (counted in node, not grep) | 0 |
| `*.jsonl` fixture added | none |
| `git status --porcelain` after the full suite | clean |

### Falsification checks — executed, not assumed

Each sabotage was applied to the real source, the suite run, and the file
restored from a byte-identical backup (`md5sum` unchanged and `git diff` empty
after every restore).

**1. The defensive `calculateCost` removed** — the sabotage the plan names:

```
× produces a strictly positive total from faux's all-zero `usage.cost`
× prices each component at the model's own rates
× does not mutate the message it was handed
  Tests  3 failed | 49 passed (52)
```

**2. `row.reasoning = usage.reasoning ?? 0`** — the fabricated Bedrock zero:

```
× omits the key entirely when `usage.reasoning` is undefined
× still lacks the key after a JSON round trip …
  Tests  2 failed | 50 passed (52)
```

**3. `row.reasoning = usage.reasoning` unconditionally — and this one is the
finding.** Assigning a present-but-`undefined` key failed **only** the
`Object.keys` case; the JSON round-trip case passed, because `stringify` drops
`undefined`:

```
× omits the key entirely when `usage.reasoning` is undefined
  Tests  1 failed | 51 passed (52)
```

That is the concrete proof that `expect(row.reasoning).toBeUndefined()` would
have shipped this bug green, and it is why PATTERNS insisted on `Object.keys`.
It is also why both assertions exist: the round-trip case guards the bytes, the
`Object.keys` case guards the object.

**4. `cacheReadRatio` returning `0` on a zero denominator:**

```
× omits the key when nothing was read at all
× returns undefined from the exported helper on a zero denominator
  Tests  2 failed | 50 passed (52)
```

**5. `errorMessage` copied verbatim, redactor bypassed:**

```
× redacts a credential quoted by the provider's error text
  Tests  1 failed | 51 passed (52)
```

**6. The isolated-copy removed (`const isolated: Usage = usage`)** — the
composer mutating the message it measures:

```
× does not mutate the message it was handed
  Tests  1 failed | 51 passed (52)
```

**7. An eighth member added to `OUTCOME_BY_STOP_REASON`** (`refusal: "error"`),
proving both halves of T-02-06-05 are live:

```
× covers exactly the seven members of pi-ai's StopReason union
  Tests  1 failed | 52 passed (53)

tsc: schema.ts(158,2): error TS2353: Object literal may only specify known
     properties, and 'refusal' does not exist in type 'Record<StopReason, Outcome>'
```

`tsc` catches a member Pi *has not* declared; the size assertion catches a member
that is declared, mapped, and left unexercised. Neither alone covers both.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 — correctness] `calculateCost` is called on an isolated copy of `usage`, not on `message.usage`.**

- **Found during:** Task 1
- **Issue:** The plan's action text says *"call `calculateCost(input.model, input.message.usage)`"*. That function mutates `usage.cost` **in place** [VERIFIED: pi-ai `models.ts:878-898`]. In production the recomputed values are identical to the ones the adapter already wrote, so the mutation is invisible — but offline, and on any future provider whose adapter skips the call, the composer would be **editing the finalized message Pi later serialises into the session file**. An instrument that alters the object it measures is the failure this whole phase exists to avoid; `wire.ts` already refuses the same thing on the request payload.
- **Fix:** `const isolated: Usage = { ...usage, cost: { ...usage.cost } }` and `calculateCost(model, isolated)`, copied into a fresh `TurnCost`. The row carries the real figure; the message stays exactly as the provider left it. Falsification 6 proves the assertion bites, and the reason is a paragraph at the call site.
- **Files modified:** `.pi/extensions/diagnostics/turns.ts`
- **Commit:** `2031a24`

**2. [Rule 3 — blocking, documentation] `schema.ts`'s import-concentration note now names `turns.ts`.**

- **Found during:** Task 1
- **Issue:** `schema.ts`'s docstring asserted that *"only this module and `call-model.ts` import from"* `@earendil-works/pi-ai`. `turns.ts` must import `calculateCost`, which is a **value** and therefore cannot travel through a type-only re-export. Leaving the note as written would have made a load-bearing rule false on the day it was first extended — and the next reader would either have believed it or deleted it.
- **Fix:** The note names the third site and states the criterion for being on the list. `turns.ts` takes `Api`, `Model` and `Usage` through the *same* statement as `calculateCost` rather than opening a second import site.
- **Files modified:** `.pi/extensions/diagnostics/schema.ts`
- **Commit:** `2031a24`

### Additions beyond the letter of the plan

- **A non-mutation test** (`does not mutate the message it was handed`), which is deviation 1's proof.
- **A paired positive on every absence assertion.** The plan asks for the `httpStatus` pair; the same treatment was given to `rawStopReason`, `responseModel`, `turnIndex`, `toolResults`, `thinkingLevel` and `event`, because an absence assertion with no twin passes just as well against a composer that assigns nothing at all.
- **An over-redaction guard on the error row** — the non-secret half of the message must survive. Falsification 6 of plan 02-05 showed a blanket redactor passes every "the secret is gone" assertion.
- **`outcomeFor` exercised directly**, not only through `composeTurnRow`, so the exported helper 02-08 and 02-09 will call is covered on its own terms.
- **A `ts`-provenance test:** the row's `ts` is stamped at composition and is asserted *not* to equal the message's own timestamp, which belongs to the provider's clock and is a different event.
- **A `toolCalls` case with two real `toolCall` blocks and a text block**, with the message naming DIAG-05: a prose tool call is text, so this count must never see one.
- **A fixture guard inside the cost test:** `message.usage.cost.total` is asserted `0` *before* composing. Without it, a future fixture change that pre-populated cost would make the `> 0` assertion vacuous.

## Known Stubs

None. Every export is implemented and exercised. Nothing calls `composeTurnRow`
yet — that is 02-08's `message_end` / `turn_end` wiring, which is the plan's
stated scope boundary and the reason DIAG-04 stays Pending rather than a stub in
this plan's deliverables.

## Threat Flags

None beyond the plan's own register.

| Threat | Where it is closed |
|---|---|
| T-02-06-01 secret echoed in `errorMessage` | `redactString` before assignment; the error-row case; falsification 5. `message.diagnostics` is refused outright, with the reason at the site |
| T-02-06-02 a fabricated `reasoning` zero | the key is assigned only when defined; asserted on `Object.keys` and after a JSON round trip; falsifications 2 and 3 |
| T-02-06-03 a cost column that is always zero offline | defensive `calculateCost`; a strictly-positive assertion against faux's all-zero `usage.cost`; falsification 1 |
| T-02-06-04 errored turns producing no row | every field sourced from the finalized message; the `stopReason: "error"` case asserts the row exists and carries its latency |
| T-02-06-05 a future `StopReason` mapping to nothing | `Record<StopReason, Outcome>` (tsc) **plus** the map-size assertion (test); falsification 7 shows each catches what the other cannot |
| T-02-06-SC supply chain | nothing installed; `tests/unit/pinning.test.ts` still green |

## Notes for the next plan

- **02-08 owns `latencyMs`.** It is `turn_end` wall clock minus
  `turn_start.timestamp` [RESEARCH §5.5, `types.ts:728-732`]. The composer takes
  the number and asks no questions; if the wiring passes a wrong one, no test in
  this plan will notice.
- **`httpStatus` may only come from the `main.response` wire record**, and must be
  omitted when there is none. Do not default it to `200`: the response hook does
  not fire on error, so a defaulted status would claim a success that was never
  observed.
- **The nested path passes `kind: "nested"` and its own `corr`.** 02-05's note
  applies unchanged — issue the id explicitly rather than relying on
  `currentCorrelationId()`.
- **Append through `appendJsonl(cwd, TURNS_LOG_BASE, row)`** — the 8 MB cap and
  the rotated-file cap come from the base name automatically — and call
  `noteRowWritten()` on every append, or `/budget` under-counts.
- **Do not add a `diagnostics` field to `TurnRow` without redacting each string.**
  The refusal is documented in `turns.ts`; the type's "redacted" wording is
  aspirational.
- **DIAG-04 is Pending on purpose.** It says *every turn appends a row*. Ticking it
  requires 02-08's wiring and an in-session proof that a row reached disk.

## Self-Check: PASSED

Both created files exist on disk
(`.pi/extensions/diagnostics/turns.ts`, `tests/unit/turn-row.test.ts`), the
modified `schema.ts` is committed, and both task commits (`2031a24`, `e2d221c`)
are present in `git log`.
