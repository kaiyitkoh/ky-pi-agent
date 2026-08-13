---
phase: 02-diagnostics-the-instrument
reviewed: 2026-08-13T20:25:00Z
depth: standard
iteration: 3
files_reviewed: 8
files_reviewed_list:
  - .pi/extensions/diagnostics/index.ts
  - .pi/extensions/diagnostics/redact.ts
  - .pi/extensions/diagnostics/wire.ts
  - docs/DIAGNOSTICS.md
  - docs/RUNBOOK.md
  - tests/integration/prose-retry.test.ts
  - tests/unit/diagnostics-entry.test.ts
  - tests/unit/docs-policy.test.ts
findings:
  critical: 0
  warning: 0
  info: 11
  total: 11
warnings_fixed_in_place: 1
status: clean
---

# Phase 2: Code Review Report (iteration 3 — narrow audit of the three iteration-2 fixes)

**Reviewed:** 2026-08-13T20:25:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** clean

> **Orchestrator addendum, 2026-08-13T20:30Z.** The single Warning this iteration
> raised — WR-01R2, a factual inversion in RB-02-03's reconciliation prose — was
> fixed in place immediately after this report was written, in commit
> `docs(02): WR-01R2 un-invert RB-02-03's reconciliation diagnoses`. The fix is
> documentation-only: the *higher* branch now carries both loss causes (a turn row
> that never reached disk, and one that lost its `event` slot to the degraded-cost
> marker), which is the direction that agrees with the caveat it cross-references,
> and the previously-unstated real cause of a sum *below* step 1 is now named —
> `index.ts` stamps `turn.event` before either `writeTurnsRow` call, so a swallowed
> append leaves the verdict row without its action record. No command, number or
> code path changed; `tests/unit/docs-policy.test.ts` (48 tests) still passes, and
> the full suite is 35 files / 514 tests green with `tsc --noEmit` clean. The
> `--fix --auto` loop therefore terminates with zero Critical and zero Warning
> findings outstanding; the 11 Info items below are carried forward by decision,
> not by omission.

## Summary

Narrow audit of `03dbc4b`, `b0f2b3f`, `f9cd445` only. CR-01, CR-02 and
WR-01..WR-15 were not re-opened. The three commits touch exactly six files
(`git diff --stat 229d7a1..HEAD`), so every carried Info finding whose subject is
`redact.ts`, `jsonl.ts`, `budget.ts`, `schema.ts`, `turn-row.test.ts` or
`jsonl-rotation.test.ts` is provably untouched rather than assumed so.

**All three fixes are real, and the substantive one is right.** WR-03R is fixed
correctly and for the verified reason; WR-02R's contract now matches the redactor
line by line and is gated from the code side; WR-01R's numerator is now the
correct one and RB-02-03 is still `OUTSTANDING`.

**Per-finding verdict**

| Finding | Verdict |
|---|---|
| **WR-03R** | **Fixed, correct, correctly gated.** Every Pi citation re-verified by me at file:line (below). The coercion is restored, the test was inverted rather than deleted, and it now asserts the *consequence* (`currentPayload` survives) as well as the mechanism. Falsification reproduced. |
| **WR-02R** | **Fixed.** The section is accurate against `redact.ts` in all three respects. The gate *derives* the cause count from source rather than pinning "three", which is the right shape; falsification 5 (the code-side one) reproduced. Two Info-level residues, below. |
| **WR-01R** | **Fixed — the arithmetic is now right — but the fix introduced one new defect of its own** in the same paragraph: the reconciliation identity's two directional diagnoses are inverted and contradict the caveat they cross-reference. See WR-01R2. |

**Pi source citations independently re-verified** (installed 0.84.1 at
`%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent/`):

- `dist/core/extensions/types.d.ts:777` — `export type BeforeProviderRequestEventResult = unknown;` **[VERIFIED]**
- `dist/core/extensions/runner.js:789-792` — `const handlerResult = await handler(event, ctx);` / `if (handlerResult !== undefined) { currentPayload = handlerResult; }` **[VERIFIED]**
- `dist/core/extensions/runner.js:806` — `return currentPayload;` **[VERIFIED]**
- `dist/core/extensions/types.d.ts:511` — `* the return value is ignored. A \`null\` value deletes that header.` **[VERIFIED]** — i.e. Pi's only documented `null` semantics really is a header-map value, not a return value, so IN-07's justification for removing the coercion was indeed false.

So the hazard was real: `null` from a wrapped `before_provider_request` handler
would have become the outgoing request body. All nine `safeHandler` call sites
(`index.ts:438,463,486,588,679`; `wire.ts:335,356,384`) leave `R = undefined` and
none returns a value, so the restored `?? undefined` is pure defence-in-depth with
no behavioural cost — and `??` does not touch `false`/`0`/`""`, so it cannot
swallow a meaningful falsy return from a future hook.

**Falsifications I reproduced myself** (neuter → targeted suite → restore → full
suite green). Three of the fixer's six, chosen to cover all three findings and
both directions of the WR-01R gate:

| # | Neutering | Result |
|---|---|---|
| **1** | `return (result ?? undefined)` → `return result` in `safeHandler` | `diagnostics-entry.test.ts` **RED** — `"the wrapper must coerce null to undefined … expected null to be undefined"` |
| **5** | added a fourth `return TRUNCATION_PLACEHOLDER;` to `redact.ts` | `docs-policy.test.ts` **RED** — `"redact.ts has 4 code paths … must say 'exactly four causes'"`. This is drift caught from the code side, which is the direction WR-02R actually came from |
| **2** | reverted `RUNBOOK.md` step 1 to the action-count form | `prose-retry.test.ts` case 3b **RED** (`expected 1 to be 2`) **and** `docs-policy.test.ts` RED on the verbatim pin |
| **3** | moved `turn.event = PROSE_EVENT` to after the cap check (`index.ts`) | `prose-retry.test.ts` cases **3 and 3b both RED**, each `expected 1 to be 2` |

All four reproduced exactly as the fix report describes. Every subject restored;
final state re-confirmed: `npm test` **35 files / 514 tests passing**,
`npm run typecheck` clean (exit 0), `git diff -- .pi docs tests` empty.

**WR-01R's arithmetic is now correct, traced rather than trusted.** `index.ts:517`
stamps `turn.event = PROSE_EVENT` before the cap check at `:526`, and both cap
branches write exactly one kind-less record (`:532` exhausted, `:550` issued). So
step 1 (`grep -F '"kind":"turn"' | grep -cF '"event":"prose_tool_call"'`) is one
row per detected prose turn — the true numerator — and step 3 + step 4 is one
record per detected prose turn. `-F` with the trailing `"` keeps
`..._retry_exhausted` out of steps 1 and 3. `rotatedPath` produces
`<stem>.<n>.jsonl` (`jsonl.ts:201,237`), which the `turns-*.jsonl` glob **does**
match, so all four counts see rotated data alike. `RB-02-03` remains `OUTSTANDING`
at both `RUNBOOK.md:208` and `:309` — not flipped.

**WR-02R's contract is accurate.** Three `return TRUNCATION_PLACEHOLDER;` sites
(`redact.ts:241` budget, `:285` non-plain object, `:318` non-string under a
credential-named key) against "exactly three causes"; eleven
`SECRET_VALUE_PATTERNS` against "Eleven patterns"; the eight-key closed list and
`REDACTED_HEADER_KEY_RE.source` both match the code; depth 24 / nodes 200,000
match `redact.ts:86,89`; the `Date` exception and the `null`/`undefined`
pass-through match `:267-268` and `:312-313`.

**No new credential-to-disk route.** The three commits changed no redaction code
and no log path. `wire.ts:335-399` still has statement-bodied handlers with no
`return`, `redactHeaders` on both header captures and `redactDeep` on the payload;
`.gitignore:79` still excludes `.pi/logs/`, and no log file is tracked.

**Why this is `issues_found` and not `clean`.** Exactly one Warning remains, it is
documentation-only, it corrupts no number and no code path, and it is a
one-sentence fix. I am not holding the phase open over a preference: this loop has
graded this same class of defect — a factually wrong sentence in a gated RB-02-03
operator procedure — as WARNING twice already (WR-10, WR-01R), and applying a
looser standard to the same paragraph on the last iteration purely because the cap
is reached would be the softening this review exists to prevent. It is also
squarely the loop's known failure mode: a fix that introduces the next finding.

## Narrative Findings (AI reviewer)

### Warnings

#### WR-01R2: RB-02-03's reconciliation identity gives the operator the wrong diagnosis for each direction of a mismatch, and contradicts the caveat it points at

**File:** `docs/RUNBOOK.md:332-334`, contradicted by `:363-369`
**Severity:** WARNING — introduced by `b0f2b3f` (the WR-01R fix)

**Issue:** the new text reads:

> **step 3 + step 4 must equal step 1.** If the sum is *lower*, a turn row went
> missing or lost its `event` slot (see the caveat below); if it is *higher*, an
> action was recorded for a turn whose row never reached disk.

`sum = step 3 + step 4` counts **action records**; `step 1` counts **turn rows
carrying the verdict**. Trace each named cause:

- *A turn row went missing, or lost its `event` slot.* The standalone action
  record was already written at `message_end` (`index.ts:532` or `:550`) and is
  unaffected, while `step 1` loses one. So the sum goes **HIGHER**, not lower.
  The runbook's own caveat says exactly this three lines below: "Such a turn is
  absent from step 1 while still contributing to step 3 or step 4"
  (`:366-367`) — and the `(see the caveat below)` pointer is attached to the
  *lower* branch, i.e. to the branch that caveat does not describe.
- *An action was recorded for a turn whose row never reached disk.* Same
  arithmetic: sum unchanged, `step 1` down one → **HIGHER**. This clause is
  correctly labelled, which means both stated causes are causes of "higher" and
  the "lower" branch has no cause at all.

The real cause of `sum < step 1` is unstated: the verdict is stamped on the
persisting `inFlight` accumulator at `index.ts:517` *before* either
`writeTurnsRow` call, so if the action append at `:532`/`:550` throws,
`safeHandler` swallows it into a `diagnostics.error` row while `turn_end` still
writes the turn row carrying the verdict — turn row present, action record absent.

Nothing catches this: `docs-policy.test.ts` pins the four *commands*, and case 3b
asserts the identity *holds* on the fixture (it does). Only the directional
guidance is wrong — but that guidance is the entire operational value of adding
the identity, and RB-02-03 is `OUTSTANDING`, so it will be read.

**Fix:** swap the two branches and give "lower" its real cause.

```md
**step 3 + step 4 must equal step 1.** If the sum is *higher*, a turn row went
missing or lost its `event` slot to the degraded-cost marker (see the caveat
below) — the action was recorded, the verdict was not. If it is *lower*, the turn
row carries the verdict but its action record never reached disk: the verdict is
stamped on the turn accumulator before either `writeTurnsRow` call
(`index.ts:517` precedes `:532`/`:550`), so an append that threw there is
swallowed into a `diagnostics.error` row while `turn_end` still writes the row —
grep the same log for `"event":"diagnostics.error"` before believing any other
explanation.
```

Optionally add one `docs-policy.test.ts` case asserting the *higher* branch is the
one that carries the `see the caveat` cross-reference, so the two cannot be
swapped back silently.

### Info (carried forward — compatible with shipping)

Nine of these are iteration-2 items left deliberately out of scope and verified
untouched; two are new residues of this iteration's fixes. None affects a number,
a credential path or a gate.

- **IN-01** — a non-plain object at the payload **root** discards the whole
  capture (`redact.ts:284-286`, `:354-356`). The *documentation* half was shipped
  in `f9cd445` ("The fidelity cost, stated"); the code half is untouched and open.
- **IN-02** — `bigint` still throws inside the append while `redactDeep`'s
  docstring implies serialisability is assured (`redact.ts:287-289`, `:324-331`).
- **IN-03** — the "negative denominator" case in `turn-row.test.ts:411-414` gives
  a denominator of exactly `0`, which the old guard also rejected.
- **IN-04** — two of three `rotate` escape cases resolve to one path, and the
  fixture litters outside the cleaned directory (`jsonl-rotation.test.ts:404-429`).
- **IN-05** — `PROSE_RETRY_FORCES_TOOL_CHOICE` is still a dead export
  (`index.ts:190`); only prose references it.
- **IN-06** — the tool-schema column still omits the per-tool serialisation
  envelope (`budget.ts:429-438`, `:128-130`).
- **IN-07** — `rotate` still mixes the injected clock with `Date.now()`
  (`jsonl.ts:307`).
- **IN-08** — long context-file paths still break the aligned table
  (`budget.ts:513-518`).
- **IN-09** — `schema.ts:25`, `:47` imports and separately re-exports
  `StopReason`.
- **IN-10 (new)** — the WR-02R gate's cause count is a source-text heuristic:
  `truncationCauseCount()` (`docs-policy.test.ts:530-533`) counts the literal
  `return TRUNCATION_PLACEHOLDER;`. A fourth cause written any other way — a
  ternary, a `throw`-adjacent helper, no semicolon — escapes it, and conversely a
  *comment* containing that literal would fail a correct doc. It is the right
  shape and it demonstrably fires (falsification 5), but it is not complete; a
  one-line note in the helper's docstring saying so would keep the next reader
  from over-trusting it.
- **IN-11 (new)** — `DIAGNOSTICS.md:239-242` says `[redacted:<n> chars]`
  "preserves the length, and is written for a **string** that matched either
  rule". For rule 2 only the matched *run* is replaced and `<n>` is the match
  length, not the string length (`redact.ts:189-195` — "leaving everything else
  byte-identical"). Pre-existing phrasing carried through the WR-02R rewrite;
  since that rewrite's whole purpose was contract precision, worth one clause.

---

_Reviewed: 2026-08-13T20:25:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3 — narrow audit of the iteration-2 fixes_
</content>
</invoke>
