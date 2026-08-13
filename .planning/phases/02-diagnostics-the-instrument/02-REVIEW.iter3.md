---
phase: 02-diagnostics-the-instrument
reviewed: 2026-08-13T19:55:00Z
depth: standard
iteration: 2
files_reviewed: 37
files_reviewed_list:
  - .pi/extensions/diagnostics/budget.ts
  - .pi/extensions/diagnostics/call-model.ts
  - .pi/extensions/diagnostics/index.ts
  - .pi/extensions/diagnostics/jsonl.ts
  - .pi/extensions/diagnostics/prose.ts
  - .pi/extensions/diagnostics/redact.ts
  - .pi/extensions/diagnostics/schema.ts
  - .pi/extensions/diagnostics/turns.ts
  - .pi/extensions/diagnostics/wire.ts
  - tests/helpers/faux.ts
  - tests/helpers/logs.ts
  - tests/helpers/session.ts
  - tests/integration/budget.test.ts
  - tests/integration/call-model.test.ts
  - tests/integration/jsonl-concurrency.test.ts
  - tests/integration/prose-retry.test.ts
  - tests/integration/turns-log.test.ts
  - tests/integration/wire-capture.test.ts
  - tests/unit/budget-command.test.ts
  - tests/unit/budget-sections.test.ts
  - tests/unit/call-model-containment.test.ts
  - tests/unit/chokepoint-lint.test.ts
  - tests/unit/diagnostics-entry.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/extension-layout.test.ts
  - tests/unit/helpers.test.ts
  - tests/unit/jsonl-append-only.test.ts
  - tests/unit/jsonl-rotation.test.ts
  - tests/unit/logs-gitignored.test.ts
  - tests/unit/prose-detector.test.ts
  - tests/unit/redact.test.ts
  - tests/unit/turn-hooks.test.ts
  - tests/unit/turn-row.test.ts
  - tests/unit/wire-nonmutating.test.ts
  - tests/unit/wire-record-typing.test.ts
  - docs/DIAGNOSTICS.md
  - docs/RUNBOOK.md
findings:
  critical: 0
  warning: 3
  info: 9
  total: 12
status: issues_found
---

# Phase 2: Code Review Report (iteration 2 — fix audit)

**Reviewed:** 2026-08-13T19:55:00Z
**Depth:** standard
**Files Reviewed:** 37
**Status:** issues_found

## Summary

Both iteration-1 Criticals are genuinely fixed and both are gated by tests that
I independently falsified. Of the fifteen Warnings, thirteen are fully fixed,
one (WR-10) is fixed in the two places it was right and left with a new defect
of the opposite sign, and one (WR-14) is a deliberate documented deferral I judge
legitimate. The new tests are not decoration: five falsification claims were
spot-checked by neutering the subject, and all five reproduced exactly as the fix
report describes.

**All three of the fixer's "the review was wrong" adjudications go the fixer's
way, and I measured each rather than reasoning about it:**

- **(a) WR-15 — fixer RIGHT.** I reverted `wireRecord`'s signature to
  `fields: Partial<WireRecord> & WireAttribution` and ran `tsc --noEmit`. Exactly
  **one** of the four `@ts-expect-error` directives reported TS2578 "unused"
  (`wire-record-typing.test.ts:141`, the empty-payload case). The three mixed-field
  cases still errored, i.e. `Partial<WireRecord>` **did** reject
  `{ payload: {}, status: 200 }`. Iteration 1's core claim ("the `never` guards are
  erased by `Partial`") was false; `Partial` is homomorphic and preserves
  `headers?: never` as `headers?: undefined`. The real gap was that each arm's own
  field became optional, which `WireFieldsFor<K>` closes.
- **(b) WR-10 defect 1 — fixer RIGHT.** Measured against a fixture holding both
  record shapes: `grep -c '"event":"prose_tool_call"'` matched 2 of 4 lines and
  the `..._retry_exhausted` record was **not** among them. The pattern's trailing
  `"` cannot match the `_` that follows. Iteration 1's substring claim was false.
- **(c) WR-08 — fixer RIGHT.** `jsonl-append-only.test.ts` matches its four
  patterns against raw source, comments included, across every tracked `.ts` under
  `.pi/extensions/diagnostics/`, and separately asserts `jsonl.ts` is in that set.
  The review's closing advice ("then `jsonl.ts` may name the constructor in its own
  warning again") is self-contradicting against the review's own suggested gate,
  which also scanned `jsonl.ts`. The fixer shipped it red for one commit
  (`272fa74`) and fixed it in `5fa1f46` — the empirical route to the same
  conclusion.

**WR-14's deferral is legitimate.** The substantive half is a genuine
cross-phase design change (`inFlight`, `proseRetriesThisRun` and
`lastCorrelationId` all rest on the same "the agent loop is serial" premise), it
has **no reachable trigger in the shipped configuration** — the mis-join needs two
concurrent provider requests in one process, and the `tui` loop is serial —
and the limitation is now written into `wire.ts:64-87` with a threat tag and an
explicit statement that it is *not* known to hold for `rpc` mode or Phase 7. I
note without penalty that the half that *was* shipped is a behavioural no-op:
`corr: currentCorrelationId() ?? UNCORRELATED` at `wire.ts:367` and `:389` is
byte-identical to what `wireRecord` already stamped. The docstring is the whole
fix, and the code comments say so.

**Falsification spot-checks I ran myself** (subject neutered → targeted suite →
subject restored → full suite green):

| Claim | Neutering | Result |
|---|---|---|
| CR-01 | `contained()` calls `fn()` outside the `try` | `call-model-containment.test.ts` RED — `EEXIST: mkdir` propagated to the caller |
| CR-02 | `if (false && !OWNED_BASES.includes(...))` | `jsonl-rotation.test.ts` RED — both foreign files deleted |
| WR-06 | one word of `SKILLS_OPEN_MARKER` changed | `budget-command.test.ts` RED — the skills tripwire fired |
| WR-09 | `drive()` passes `tools: []` | `prose-retry.test.ts` RED — **5** cases including the guard itself |
| WR-13 | `assertInsideLogDir` removed from `rotate` | `jsonl-rotation.test.ts` RED — 3 escape cases; the planted file was really renamed |

Final state re-confirmed after all restores: `npm test` 35 files / 506 tests
passing, `npm run typecheck` clean, working tree clean.

**What I found that is still wrong** is concentrated in the fixes themselves,
not in what they replaced: the corrected prose-rate command now under-counts the
number Phase 10 discriminates on, an opportunistically-taken Info finding removed
a guard against the one catastrophe `wire.ts` is built around, and the redactor's
behaviour changed without its published contract changing with it.

### Per-finding audit

| Finding | Verdict |
|---|---|
| CR-01 | **Fixed**, and beyond the review — `composeTurnRow` is inside the containment too, and `transformHeaders` returns the live map from *outside* it. Falsified. |
| CR-02 | **Fixed**. `OWNED_BASES` checked before the regular-file check; three same-age files so age cannot be the discriminator. Falsified. |
| WR-01 | **Fixed**. `!(denominator > 0)` at `turns.ts:155` now agrees with `budget.ts:493`. Asserted on `Object.keys` and on the bytes. (See IN-03 for one weak case.) |
| WR-02 | **Fixed**. `cacheWrite1h` on the row, in the doc table, with a test that also proves the two candidate cost formulas disagree. |
| WR-03 | **Fixed (a)**. Invariant evaluated at runtime, warning pushed first, offending fixture + paired positive. (b) is deliberately *reported* rather than fixed, which is the correct call — the warning is the loud failure. |
| WR-04 | **Fixed**. `globalThis[ROWS_WRITTEN_KEY]`, key exported, asserted in both directions from outside the module. The deviation (keeping `call-model.ts`'s direct import) is sound now the slot is process-wide. |
| WR-05 | **Fixed in code**, both halves, with a `Date` exception and a precondition proving the fixture secret matches none of the eleven patterns. **Doc contract not updated — see WR-02R.** |
| WR-06 | **Fixed**, both halves. Handler driven off a recording stub; tripwire measured against Pi's own `formatSkillsForPrompt` with a non-empty-block precondition. Falsified. |
| WR-07 | **Fixed**. Both markers reachable, healthy control proves the marker is not stamped unconditionally, required-field list derived from the healthy row rather than transcribed. |
| WR-08 | **Fixed**. Gate exists, all three vacuity guards present, fourth pattern (callback-form append) added. Review's remediation advice correctly rejected. |
| WR-09 | **Fixed**. `activeTools` is now read out of the live session via `pi.getActiveTools()`. Falsified — 5 cases red, where the old literal would have stayed green. |
| WR-10 | **Partially fixed, new defect.** Defect 1 was false (measured). Defects 2 and 3 fixed. The corrected command now under-counts — **WR-01R**. |
| WR-11 | **Fixed**. Doc row, both code comments, plus a four-session absence gate with non-empty and completeness guards; paired positive in `call-model.test.ts` case 2. |
| WR-12 | **Fixed**. Honest docstring; test pins survival, over-cap size, and the rotate-on-next-append consequence. |
| WR-13 | **Fixed**. `rotate(cwd, file, maxRotated)` with `assertInsideLogDir` before any `readdir`/`rename`/`unlink`; three escape cases each also asserting the file is still on disk; paired positive. Falsified. |
| WR-14 | **Partial by design — deferral legitimate.** No reachable trigger today; limitation documented with a threat tag. Shipped half is a no-op. |
| WR-15 | **Review was wrong; measured.** Narrowing to `WireFieldsFor<K>` closes the real, smaller gap and adds a compile-time gate that is live in both directions. |

## Narrative Findings (AI reviewer)

### Warnings

#### WR-01R: the corrected `RB-02-03` prose-rate numerator now UNDER-counts, and the runbook tells the operator not to fix it

**File:** `docs/RUNBOOK.md:320-321`, `:326-336`; `docs/DIAGNOSTICS.md:411-421`;
`tests/unit/docs-policy.test.ts:245-250`
**Severity:** WARNING

**Issue:** WR-10's fix corrected a ~2× over-count and introduced an under-count
of the opposite sign in the same number.

`index.ts:495` sets `turn.event = PROSE_EVENT` on the accumulator **before** the
retry-budget check at `:504`. So every detected prose turn leaves a
`kind:"turn"` row carrying `event:"prose_tool_call"`. But the *kind-less*
`prose_tool_call` record — the only thing step 1 now counts — is written at
`:528-534`, which is reached **only when the retry budget has not been spent**.
A prose turn that hits the cap writes `PROSE_EXHAUSTED_EVENT` at `:510-517` and
returns. `proseRetriesThisRun` resets per *agent run* (`:649-654`), and
`MAX_PROSE_RETRIES` is `1`, so in any run with more than one prose turn every
prose turn after the first is invisible to step 1.

Measured on a fixture holding both shapes:

```
step 1 (cat | grep -F event | grep -v kind | wc -l)  -> 1
step 2 (cat | grep -cF '"kind":"turn"')              -> 3
step 3 (cat | grep -cF '..._retry_exhausted')        -> 2
turn rows carrying the verdict (the true numerator)  -> 2
```

So the runbook's stated rate is 1/3 where the real rate is 2/3. And
`RUNBOOK.md:327-328` explicitly instructs the operator *not* to correct it:
"Step 3 is the turns where the nudge did not work, and is worth recording beside
the rate rather than folded into it." Against a published ~11% baseline, an
under-count reads as *refutation* of the leading root-cause hypothesis, which is
the mirror image of the harm WR-10 identified. `docs-policy.test.ts:245-250` now
pins the command in full, so the wrong command is a standing gate.

**Fix:** count the turn rows that carry the verdict — one command, exactly one
record per prose turn, no dependence on the retry cap:

```sh
# RB-02-03 step 1 — the NUMERATOR: prose turns, counted once each.
# The turn's own row carries the verdict whether or not the retry budget was
# spent (index.ts:495 precedes the cap check at :504), so this counts every
# detected prose turn. The kind-less action record does NOT: it is only written
# when a retry was actually issued.
cat .pi/logs/turns-*.jsonl | grep -F '"kind":"turn"' | grep -cF '"event":"prose_tool_call"'

# step 2 — the denominator, unchanged.
cat .pi/logs/turns-*.jsonl | grep -cF '"kind":"turn"'

# step 3 — the ACTIONS, which is what the old step 1 measured. Retries issued
# plus retries refused must equal the numerator above; if it does not, a turn row
# went missing.
cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l
cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'
```

Replace the "worth recording beside the rate rather than folded into it"
sentence with the reconciliation identity above, apply the same numerator at
`DIAGNOSTICS.md:414`, and update `ENTRY_COMMANDS["RB-02-03"]` in the same change.
One caveat belongs in the prose: on a turn where `ctx.model` is undefined,
`MODEL_UNAVAILABLE_EVENT` wins the single `event` slot (`index.ts:623`), so such
a turn is absent from the numerator — which is why the step-3 reconciliation is
worth having rather than optional.

---

#### WR-02R: `docs/DIAGNOSTICS.md`'s Redaction section no longer describes the redactor, and `[redacted:truncated]` now means three different things

**File:** `docs/DIAGNOSTICS.md:217-238`; `.pi/extensions/diagnostics/redact.ts:257-259`,
`:284-286`, `:308-319`
**Severity:** WARNING

**Issue:** commit `70e02a4` changed *what the placeholder means* and left the
published contract untouched. `DIAGNOSTICS.md` is the document a reader consults
to interpret a dump, so a divergence here is a wrong reading, not a stale
comment.

- `:220` calls rule 1 "**By header key**". It is no longer only headers: `walk`
  applies `isRedactedHeaderKey` to plain-object keys inside the payload
  (`redact.ts:257`), and `redactUnderCredentialKey` (`:308-319`) now replaces the
  **whole subtree** under such a key, not just a string value.
- `:236-238` says `[redacted:truncated]` is what "a subtree that blew the depth
  or node budget" becomes. It is now also written for **every non-plain
  object** (`:284-286` — class instance, `Map`, `Set`, typed array) and for
  **every non-string, non-nullish value under a credential-named key**
  (`:317-318`). Three causes, one sentinel, and the doc names one of them. A
  reader who sees the sentinel will conclude the payload was pathologically deep
  when in fact a credential-named key was present or an adapter handed over a
  class instance.
- `:234` states flatly "The replacement is `[redacted:<n> chars]`, which
  preserves the length", which is now only true for the string case.

`docs-policy.test.ts` did not catch this: it pins runbook commands and cited
paths, not the redaction contract.

**Fix:** rewrite `:217-238` to state the three outcomes and their causes, and
give the sentinel a gate so the doc cannot drift again:

```md
Two independent rules, and the payload rule is stronger than a header rule:

1. **By key name**, applied to header maps *and to object keys inside a
   payload*. Closed list plus the open pattern
   `/(^|[-_])(api[-_]?key|token|secret|credential|password)([-_]|$)/i`. A string
   value becomes `[redacted:<n> chars]`; **any other value becomes
   `[redacted:truncated]`, because a key that says "credential" is better
   evidence than any shape heuristic and over-redaction is the right way to be
   wrong.** `null` and `undefined` are passed through: `null` means "delete this
   header" and rewriting it would misreport a deletion as a secret.
2. **By value shape** ... (unchanged)

`[redacted:truncated]` has exactly three causes, and a reader cannot tell them
apart from the dump alone: a subtree that blew the depth (24) or node (200,000)
budget; a non-string value under a credential-named key; and **any object that
is not a plain object or an array** — a class instance, a `Map`, a `Set`, a typed
array. `Date` is the one exception and survives as its own ISO string.
```

Then add a case to `tests/unit/docs-policy.test.ts` pinning that
`TRUNCATION_PLACEHOLDER` and the three cause words appear in this section, so the
next behaviour change to `walk` fails a test rather than only diverging.

---

#### WR-03R: IN-07's fix lets `safeHandler` replace the outgoing provider payload with `null`

**File:** `.pi/extensions/diagnostics/index.ts:384-392`;
`tests/unit/diagnostics-entry.test.ts:139-160`
**Severity:** WARNING

**Issue:** the change is `return (result ?? undefined)` → `return result as R | undefined`.
The coercion it removed was a defence-in-depth guard against the one catastrophe
this subsystem is organised around, and the justification given for removing it
is unverified.

Verified against the installed Pi:

- `BeforeProviderRequestEventResult = unknown`
  [VERIFIED: pi 0.84.1 `dist/core/extensions/types.d.ts:777`], so `null` is a
  well-typed return from a `before_provider_request` handler.
- Pi's runner replaces on anything that is not `undefined`:
  `const handlerResult = await handler(event, ctx); if (handlerResult !== undefined) { currentPayload = handlerResult; }`
  [VERIFIED: pi 0.84.1 `dist/core/extensions/runner.js:789-792`], and
  `currentPayload` is what gets returned to the adapter at `:806`.

So a `safeHandler`-wrapped handler that returns `null` — `return match ?? null`,
`return JSON.parse(...)` on the literal `null`, a mapped lookup that misses —
now sets the real outgoing request body to `null`. Before this commit that was
impossible by construction. `wire.ts:26-40` and `:374-378` are built entirely
around this hazard ("an arrow function with an EXPRESSION body ... silently
rewrites every single request"), and `safeHandler`'s own docstring at
`index.ts:365-372` names it: "a wrapper that invented a return value on failure
could silently rewrite every provider request."

The stated reason for the change — "some Pi hooks distinguish `null` from
`undefined`" (`index.ts:388`) — is **UNVERIFIED and I could not confirm it**. No
Pi event-result type declares `null` as meaningful; the only documented `null`
semantics in the extension API is a *header map value* meaning "delete this
header" (`types.d.ts:511`), which is not a return value. The new test at
`diagnostics-entry.test.ts:139-160` now pins the unsafe behaviour, so the guard
cannot be restored without deleting a green test.

**Fix:** keep the pass-through only where a return value is meaningful, and refuse
`null` where a non-`undefined` return is a replacement:

```ts
// index.ts — inside safeHandler's success path
const result = await fn(event, ctx);
// `null` is NOT passed through. `BeforeProviderRequestEventResult` is `unknown`
// [VERIFIED: pi 0.84.1 dist/core/extensions/types.d.ts:777] and the runner does
// `if (handlerResult !== undefined) currentPayload = handlerResult`
// [VERIFIED: dist/core/extensions/runner.js:789-792], so returning `null` from a
// wrapped handler sets the real request body to `null`. No Pi event result type
// declares `null` as meaningful, so coercing it costs nothing and the coercion
// is the only thing standing between a `?? null` typo and every request in the
// harness being destroyed. [threat T-02-05-03]
return (result ?? undefined) as R | undefined;
```

and turn the new test around: assert that a handler returning `null` yields
`undefined`, with the failure message citing `runner.js:789-792`. If the
pass-through is genuinely wanted, it needs a *verified* Pi hook whose result type
admits `null`, cited at file:line, plus an assertion that a wrapped
`before_provider_request` handler returning `null` does not reach
`currentPayload` — which today it would.

### Info

#### IN-01: a non-plain object at the payload ROOT discards the entire capture

**File:** `.pi/extensions/diagnostics/redact.ts:284-286`, `:354-356`
**Issue:** `redactDeep(value)` calls `walk(value, 0, ...)`, and the new
truncation branch fires at depth 0 too. If any adapter ever hands
`before_provider_request` / `onPayload` a non-plain object (a command instance, a
`Map`), the whole `main.request` record's `payload` becomes the string
`"[redacted:truncated]"` and the wire dump silently loses the request. The only
evidence that real payloads are plain objects is `buildOpenAiFixturePayload` in
`tests/helpers/faux.ts` — a hand-built fixture, which `wire-capture.test.ts:14-20`
itself says "makes it realistic and does not make it real".
**Fix:** at depth 0 only, walk a non-plain object's own enumerable properties
instead of truncating it (`walk({ ...value }, 1, budget)`), or add a
`main.request` record field recording that the root was truncated so the loss is
visible rather than silent. Either way, note the fidelity cost in
`DIAGNOSTICS.md` alongside WR-02R.

#### IN-02: `BigInt` still throws inside the append, while `redactDeep`'s docstring implies the hazard is closed

**File:** `.pi/extensions/diagnostics/redact.ts:287-289`, `:324-331`
**Issue:** primitives pass through untouched, so a `bigint` reaches
`JSON.stringify` in `appendJsonl` and throws. `contained()`
(`call-model.ts:298-301`) names this honestly as a live trigger, but
`redactDeep`'s own "TWO WAYS THIS USED TO BE LESS THAN IT CLAIMED" block names
only the circular-object route to the same throw, which reads as though
serialisability is now assured.
**Fix:** `if (typeof value === "bigint") return \`${value}\`;` with a comment
citing that `JSON.stringify` refuses it, plus a redact-test case; or amend the
docstring to say the `BigInt` route is still open and contained rather than
closed.

#### IN-03: the "negative denominator" case in `turn-row.test.ts` does not discriminate the new guard

**File:** `tests/unit/turn-row.test.ts:411-414`
**Issue:** `makeUsage({ input: -100, cacheRead: 100 })` gives a denominator of
exactly `0`, which the *old* `=== 0` guard also rejected. Only the two `NaN`
cases distinguish `!(denominator > 0)` from `denominator !== 0`, so one third of
the fixture set is a paired duplicate rather than the negative-denominator case
the comment claims.
**Fix:** use `{ input: -100, cacheRead: 50 }` (denominator `-50`), which the old
guard accepted and which would have produced `cacheReadRatio: -1`.

#### IN-04: two of the three `rotate` escape cases resolve to one path, and the fixture litters outside the cleaned directory

**File:** `tests/unit/jsonl-rotation.test.ts:404-408`, `:409-429`
**Issue:** `join(cwd, "../evil.jsonl")` and `join(cwd, "sub/../../evil.jsonl")`
both normalise to `<tmpdir>/evil.jsonl`, so the third case exercises no
additional route. Both also write *above* the directory `withTempLogCwd` removes,
leaving `evil.jsonl` in the OS temp dir after every run and creating a shared
path two vitest workers could contend on.
**Fix:** create a sibling temp directory for the outside paths so cleanup covers
them, and replace one duplicate with a genuinely distinct route — an absolute
path on another drive/root, or a path inside `logDir(cwd)`'s parent
(`join(logDir(cwd), "..", "evil.jsonl")`).

#### IN-05: `PROSE_RETRY_FORCES_TOOL_CHOICE` is still a dead export

**File:** `.pi/extensions/diagnostics/index.ts:190`
**Issue:** carried over from iteration 1, declared out of scope by the fixer.
Referenced by no code; only prose mentions it (`docs/DIAGNOSTICS.md:390`,
`diagnostics-entry.test.ts:287` inside a failure message).
**Fix:** have `diagnostics-entry.test.ts` import it and assert `toBe(false)`
beside the hook-count list, so flipping it fails a test rather than only a
comment.

#### IN-06: the tool-schema column still omits the per-tool serialisation envelope

**File:** `.pi/extensions/diagnostics/budget.ts:429-438`, `:128-130`
**Issue:** carried over from iteration 1. The figure is
`name.length + description.length + JSON.stringify(parameters).length`; the real
cost includes `{"type":"function","function":{...}}` (~40 bytes per tool) plus the
`"tools":[…]` wrapper. `ESTIMATE_NOTE` does not mention the exclusion.
**Fix:** add a named envelope constant and include it per tool, or state the
exclusion in `ESTIMATE_NOTE` so the number is not read as complete.

#### IN-07: `rotate` still mixes the injected clock with `Date.now()`

**File:** `.pi/extensions/diagnostics/jsonl.ts:307`
**Issue:** carried over from iteration 1, and now slightly more visible because
`rotate` gained a `cwd` parameter without gaining `now`. With an injected clock
the `checkedAt` written here is unrelated to the `nowMs` the next `cachedSize`
compares against, so the 1-second re-`stat` window is non-deterministic in tests.
Self-correcting, so no assertion is currently wrong.
**Fix:** thread `now` into `rotate`, or drop the cache write there and let the
next `cachedSize` re-`stat`.

#### IN-08: long context-file paths still break the aligned table

**File:** `.pi/extensions/diagnostics/budget.ts:513-518`
**Issue:** carried over from iteration 1. `padEnd(LABEL_WIDTH)` with
`LABEL_WIDTH = 30` does not truncate, so an absolute Windows path pushes the
character and token columns out of alignment for that row.
**Fix:** truncate with a leading ellipsis beyond `LABEL_WIDTH`, keeping the tail.

#### IN-09: `schema.ts` still imports and separately re-exports `StopReason`

**File:** `.pi/extensions/diagnostics/schema.ts:25`, `:47`
**Issue:** carried over from iteration 1. Two statements name the same symbol
from the same package.
**Fix:** `export type { StopReason }` alongside the local import, or reference
the re-export.

---

_Reviewed: 2026-08-13T19:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2 — fix audit_
