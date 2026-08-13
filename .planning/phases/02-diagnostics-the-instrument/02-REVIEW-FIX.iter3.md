---
phase: 02-diagnostics-the-instrument
fixed_at: 2026-08-13T12:10:00Z
review_path: .planning/phases/02-diagnostics-the-instrument/02-REVIEW.md
iteration: 2
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report — iteration 2

**Fixed at:** 2026-08-13T12:10:00Z
**Source review:** `.planning/phases/02-diagnostics-the-instrument/02-REVIEW.md` (iteration 2 — fix audit)
**Iteration:** 2

**Summary:**
- Findings in scope: 3 (WR-01R, WR-02R, WR-03R)
- Fixed: 3
- Skipped: 0
- Info findings (9): out of scope, untouched — except the *documentation* half of
  IN-01, which is unavoidably entangled with WR-02R (see the note under WR-02R).

All three findings were regressions introduced by the iteration-1 fix pass. All
three were **confirmed by measurement or by reading Pi's source before being
fixed**, not assumed from the review text. CR-01, CR-02 and WR-01..WR-15 were not
re-opened.

## Verification

| Gate | Baseline | Final |
|---|---|---|
| `npm test` | 35 files / 506 tests passing | **35 files / 514 tests passing** |
| `npm run typecheck` | clean | **clean** (exit 0) |

8 net new tests: 1 in `tests/integration/prose-retry.test.ts` (case 3b) and 7 in
`tests/unit/docs-policy.test.ts` (Group D). One existing test was **inverted**
rather than deleted (`diagnostics-entry.test.ts`), so the count there is
unchanged.

Every new or changed test was FALSIFIED: the subject was neutered, the test
confirmed red with the assertion message quoted, the subject restored, the suite
confirmed green. Six falsifications in total, recorded per finding below and in
each commit message. No pre-existing gate was weakened — no assertion was
deleted, relaxed or made conditional.

Work was done in an isolated worktree (`gsd-reviewfix/02-1403`) with `node_modules`
junctioned from the main repo, then fast-forwarded onto `main`.

## Fixed Issues

### WR-03R: `safeHandler` could replace the outgoing provider payload with `null`

**Files modified:** `.pi/extensions/diagnostics/index.ts`,
`tests/unit/diagnostics-entry.test.ts`
**Commit:** `03dbc4b`
**Status:** fixed

**This was the real correctness bug of the three, and the review's diagnosis is
exactly right.** I verified every link in the chain against the installed Pi
0.84.1 at `%APPDATA%/npm/node_modules/@earendil-works/pi-coding-agent/` rather
than taking the review's citations on trust:

| Claim | Verified at | Content |
|---|---|---|
| `null` is a well-typed return from `before_provider_request` | `dist/core/extensions/types.d.ts:777` | `export type BeforeProviderRequestEventResult = unknown;` |
| the runner replaces on anything not `undefined` | `dist/core/extensions/runner.js:789-792` | `const handlerResult = await handler(event, ctx);` / `if (handlerResult !== undefined) { currentPayload = handlerResult; }` |
| ...and that value is what the adapter gets | `dist/core/extensions/runner.js:806` | `return currentPayload;` |
| the same code in TypeScript | `src/core/extensions/runner.ts:1030-1033`, recovered from `dist/core/extensions/runner.js.map` `sourcesContent` | byte-identical logic; matches the citation `wire.ts:31-33` already carried |
| no event-result type admits `null` as meaningful | `dist/core/extensions/types.d.ts` — grepped every `null` in the file | the only documented `null` semantics in the extension API is a **header map value** meaning "delete this header" (`types.d.ts:511`), which is not a return value at all. `InputEventResult` and `BeforeProviderRequestEventResult` are the only two `type ... EventResult =` aliases; neither mentions `null` |

So IN-07's stated justification — "some Pi hooks distinguish `null` from
`undefined`" — is **false**, and removing the coercion converted a `return match
?? null` typo anywhere inside a wrapped `before_provider_request` handler into
"every outgoing request body becomes `null`". That is precisely the catastrophe
`wire.ts:26-40` is built around and `safeHandler`'s own docstring names.

**Applied fix:** restored `return (result ?? undefined) as R | undefined;` with the
four verifications inline at `file:line` and a `[threat T-02-05-03]` tag; corrected
the docstring, which had been left claiming the success value is "passed through
untouched".

**The test was inverted, not deleted.** It now asserts (a) the wrapper returns
`undefined`, and (b) that under Pi's own replacement rule — transcribed from
`runner.js:789-792` into the test body — a real payload object **survives**. (b)
matters: `toBeUndefined()` alone would pass if the coercion moved somewhere that
did not protect this specific path, so the test asserts the *consequence* the
coercion exists to prevent rather than only its mechanism.

**Falsification 1.** Replaced the line with `return result as R | undefined;`
(exactly the iteration-1 code). `diagnostics-entry.test.ts` went RED:
`"the wrapper must coerce null to undefined ... expected null to be undefined"`.
Restored; green.

### WR-01R: the corrected `RB-02-03` prose-rate numerator under-counted

**Files modified:** `docs/RUNBOOK.md`, `docs/DIAGNOSTICS.md`,
`tests/unit/docs-policy.test.ts`, `tests/integration/prose-retry.test.ts`,
`.pi/extensions/diagnostics/index.ts`
**Commit:** `b0f2b3f`
**Status:** fixed

**Confirmed by measurement before fixing.** The mechanism is as the review
describes: `index.ts` stamps `turn.event = PROSE_EVENT` on the turn accumulator
*before* the retry-budget check, so every detected prose turn leaves a
`kind:"turn"` row carrying the verdict; the kind-less standalone record is written
only when a retry was actually issued; `MAX_PROSE_RETRIES` is `1` per agent run.
I built a fixture holding both record shapes and ran the commands:

```
old step 1 (kind-less action records)                 -> 1
new step 1 (turn rows carrying the verdict)           -> 2
step 2 (denominator, kind:"turn")                     -> 3
retries issued / retries refused                      -> 1 / 1
```

1/3 reported where the truth is 2/3 — a halved rate, which against a published
~11% baseline reads as *refutation* of the leading root-cause hypothesis.

**Applied fix.** RB-02-03 now has four counting steps — numerator (turn rows
carrying the verdict), denominator, retries issued, retries refused — plus the
step-5 qualitative read. The sentence the review flagged ("worth recording beside
the rate rather than folded into it") is replaced by the reconciliation identity
**step 3 + step 4 = step 1**, stated with what each direction of a mismatch means.
The `ctx.model`-undefined caveat is written down as the *reason* that identity is
worth checking, since `MODEL_UNAVAILABLE_EVENT` takes the single `event` slot and
removes such a turn from the numerator. `DIAGNOSTICS.md` carries the same
numerator and the same reasoning; `ENTRY_COMMANDS["RB-02-03"]` pins all four
commands in full.

`index.ts`'s precedence comment was also corrected: it claimed losing the prose
verdict "costs nothing equivalent" because "`message_end` already appended a
standalone record carrying it", which is not true in the cap-hit case — that
record carries `PROSE_EXHAUSTED_EVENT`, not `PROSE_EVENT`.

**New gate that measures rather than transcribes.** `prose-retry.test.ts` case 3b
extracts RB-02-03's own command text out of `docs/RUNBOOK.md` and runs it, through
a faithful interpreter of the four `grep`/`wc` stage forms, over the **real turns
log the capped session left on disk** (`Capture` now carries the raw bytes). The
capped session is one agent run with two prose turns against a cap of one — the
only fixture shape where the verdict count and the action count diverge. The case
asserts 2, 2, 1, 1, the identity, and that the two numbers genuinely disagree on
this fixture (so it could not pass with the old numerator pinned). The interpreter
**throws** on any stage form it does not understand, so a runbook rewrite cannot
silently stop being checked.

**Falsification 2.** Reverted the runbook's step 1 to the old action-count form.
Case 3b RED: `"step 1 (...) must count BOTH prose turns ... expected 1 to be 2"`,
and `docs-policy.test.ts` RED on the verbatim pin. Restored; green.

**Falsification 3.** Moved `turn.event = PROSE_EVENT` to *after* the cap check in
`index.ts` — the subject the numerator depends on. Case 3 **and** case 3b both
RED, each `expected 1 to be 2`. Restored; green.

### WR-02R: the published redaction contract no longer described the redactor

**Files modified:** `docs/DIAGNOSTICS.md`, `tests/unit/docs-policy.test.ts`
**Commit:** `f9cd445`
**Status:** fixed

Confirmed all three divergences against `redact.ts`: the key rule is applied to
plain-object keys inside payloads at `:257` and replaces the whole subtree at
`:308-319`; `TRUNCATION_PLACEHOLDER` has three `return` sites (`:241` budget,
`:285` non-plain object, `:318` non-string under a credential-named key) where the
doc named one; and "preserves the length" is now only true for the string case.

**Applied fix.** The section now states the two placeholders separately, lists the
three causes of `[redacted:truncated]` with the real constants (depth 24, nodes
200,000) and the `Date` exception, says plainly that a reader cannot tell the three
apart from the dump alone, and renames rule 1 to "By key name, applied to header
maps *and to object keys inside a payload*" with the whole-subtree behaviour and
the `null`/`undefined` pass-through and its reason.

**New gate — `docs-policy.test.ts` Group D (7 cases).** It does not transcribe the
contract, it **derives** it: the cause count is counted out of `redact.ts`'s
`return TRUNCATION_PLACEHOLDER;` sites and the doc must state that number in
words; `TRUNCATION_PLACEHOLDER` and `REDACTED_HEADER_KEY_RE.source` are imported
from the module rather than retyped; the header-only phrasing is asserted absent
and the payload-key phrasing asserted present; the `null` rationale is pinned.
Vacuity guarded on section length (>500 chars), on the `## Redaction` heading
existing, and on the derived count being non-zero.

**Falsification 4.** Reverted the doc to `**By header key.**` + "exactly one
cause". Two Group D cases RED. Restored.

**Falsification 5 — the important one, from the code side.** Added a *fourth*
`return TRUNCATION_PLACEHOLDER;` to `redact.ts`. RED: `"redact.ts has 4 code paths
that write [redacted:truncated], so the contract must say 'exactly four causes'"`.
This is exactly the drift that produced WR-02R, now caught from the direction it
actually came from. Restored.

**Falsification 6.** Widened `REDACTED_HEADER_KEY_RE` with `|passphrase`, making
the doc's copy stale. RED on the pattern pin. Restored.

**Entangled Info finding, and the choice made.** IN-01 (a non-plain object at the
payload root discards the whole capture) is an Info finding and its *code* fix is
out of scope. But WR-02R's whole point is that the doc must say what the sentinel
means, and at the root it means "this request is gone" — so leaving that unstated
would have shipped a contract that is still incomplete in the same way. Per the
review's own instruction to "note the fidelity cost in `DIAGNOSTICS.md` alongside
WR-02R", the *documentation* half is included: a short "The fidelity cost, stated"
paragraph, naming `wire-capture.test.ts`'s own admission that the fixture "makes it
realistic and does not make it real". **No code change was made for IN-01**; it
remains open for a later phase.

## Skipped Issues

None. All three in-scope findings were fixed.

The 9 Info findings (IN-01..IN-09) were left untouched per the scope instruction,
with the single documentation-only exception noted above.

## Decisions taken without waking the user

1. **WR-01R shape: five numbered steps, not three plus a folded caveat.** The
   review offered the numerator/denominator/two-actions structure; the runbook's
   own contract requires "the exact command, copy-pasteable" per step and
   `docs-policy.test.ts`'s comment relies on each command sitting on one line of a
   numbered list. Splitting the two action commands into steps 3 and 4 keeps both
   properties and makes the reconciliation identity expressible as "3 + 4 = 1".
2. **WR-02R gate derives the cause count from source instead of pinning "three".**
   A literal pin would have gone stale the same way the prose did. Falsification 5
   is the evidence this was the right call.
3. **WR-03R test inverted, not deleted.** Per the explicit instruction, and it now
   asserts the consequence (`currentPayload` survives) rather than only the return
   value, so it cannot be satisfied by a coercion that has moved somewhere useless.

---

_Fixed: 2026-08-13T12:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
