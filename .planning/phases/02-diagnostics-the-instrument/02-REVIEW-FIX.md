---
phase: 02-diagnostics-the-instrument
fixed_at: 2026-08-13T11:40:00Z
review_path: .planning/phases/02-diagnostics-the-instrument/02-REVIEW.md
iteration: 1
findings_in_scope: 17
fixed: 17
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-08-13T11:40:00Z
**Source review:** `.planning/phases/02-diagnostics-the-instrument/02-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 17 (CR-01, CR-02, WR-01..WR-15)
- Fixed: 17
- Skipped: 0
- Info findings taken opportunistically: 2 (IN-04, IN-07)
- Partially fixed with a documented deferral: 1 (WR-14 — the concurrency redesign)

## Verification

| Gate | Baseline | Final |
|---|---|---|
| `npm test` | 30 files / 462 tests passing | **35 files / 506 tests passing** |
| `npm run typecheck` | clean | **clean** |

Both gates were run on the baseline commit (`44ee475`) inside the isolated
worktree before any edit, and again after the last commit. No existing gate was
weakened: every pre-existing assertion is still present and still asserting the
same thing. The three suites the fixes touched most (`redact`, `jsonl-rotation`,
`prose-retry`) were each re-run in isolation after every edit as well as in the
full run.

44 new tests. Every one was FALSIFIED before being accepted — the subject was
temporarily neutered, the test confirmed red, the subject restored, the test
confirmed green. The falsification is recorded per finding below and in each
commit message.

## Findings that were real bugs vs. nits

**Real defects that would have produced wrong numbers or a broken request:**
CR-01, CR-02, WR-01, WR-02, WR-04, WR-05, WR-13, and the numerator half of
WR-10. These change behaviour.

**Real coverage failures — a test that passed without exercising its subject:**
WR-06, WR-07, WR-08, WR-09. These are the tautological/unreachable class this
phase exists to eliminate, and the fix in each case was to make the test a real
gate, never to loosen it.

**Real but documentation-only:** WR-03 (the invariant existed and was never
evaluated at runtime), WR-11, WR-12, WR-14.

**Findings where the review was partly or wholly WRONG, corrected in the code
comments rather than silently accepted:** WR-15 (the alleged type hole does not
exist) and defect 1 of WR-10 (the alleged substring over-count does not happen).
Both are recorded below with the measurement.

## Fixed Issues

### CR-01: `call-model.ts` — a diagnostics write failure breaks or discards the real model call

**Files modified:** `.pi/extensions/diagnostics/call-model.ts`,
`tests/unit/call-model-containment.test.ts` (new)
**Commit:** `ec005a0`

Real, and worse than the review states — `composeTurnRow` is also outside the
containment on both paths, and it calls `calculateCost` and the redactor after
the provider has already billed. So rather than only making the two append
helpers total, the fix introduces `contained()` (a `safeHandler` for the nested
path) around each of the three capture callbacks INCLUDING their redaction, and
`recordTurn()` which contains composition as well as the append.

Two deliberate deviations from the review's suggested patch, both stated in the
code:
- `httpStatus` is assigned **before** its capture, so the turns row keeps the
  status even when the wire record cannot be written.
- `transformHeaders` returns the live map from **outside** the containment. The
  review's patch would have been correct, but the ordering matters enough to be
  explicit: a return from inside a failed containment would strip every header
  off the real request.

The module contract is also corrected. "The measurement is never lost" was the
wrong promise, because honouring it costs the thing being measured; the contract
is now that a record which cannot be written is DROPPED, with `noteRowWritten`
still firing only on success so `/budget`'s count matches the file and a flat
count is how the drop becomes visible.

**Falsified:** neutering `contained()` makes the sabotaged case fail with
`EEXIST: mkdir` propagating to the caller.

---

### CR-02: `pruneLogs` unlinks any dated `.jsonl` in `.pi/logs/`

**Files modified:** `.pi/extensions/diagnostics/jsonl.ts`,
`tests/unit/jsonl-rotation.test.ts`
**Commit:** `be44166`

Real. Applied as suggested: `OWNED_BASES = [WIRE_LOG_BASE, TURNS_LOG_BASE]`,
checked immediately after the shape match, with the reasoning recorded on the
constant and in `pruneLogs`'s docstring.

The paired test plants **three** 40-day-old files rather than the review's two —
two foreign and one owned — so AGE cannot be what distinguishes them and the only
difference is ownership.

**Falsified:** short-circuiting the ownership check makes the case fail.

---

### WR-01: `cacheReadRatio` has two divergent implementations

**Files modified:** `.pi/extensions/diagnostics/turns.ts`,
`.pi/extensions/diagnostics/schema.ts`, `docs/DIAGNOSTICS.md`,
`tests/unit/turn-row.test.ts`
**Commit:** `86b5b00` (doc table row in `b21708d`)

Real. Guard is now `!(denominator > 0)`, matching `budget.ts`. The test covers
NaN input, NaN cacheRead and a negative input, and asserts on `Object.keys` plus
the serialised bytes — because `toBeUndefined()` would pass on a key holding NaN.

**Falsified:** restoring `=== 0` makes the case fail.

---

### WR-02: `TurnRow` drops `usage.cacheWrite1h`

**Files modified:** `.pi/extensions/diagnostics/schema.ts`,
`.pi/extensions/diagnostics/turns.ts`, `docs/DIAGNOSTICS.md`,
`tests/unit/turn-row.test.ts`
**Commit:** `b21708d`

Real. Both pi-ai claims re-verified locally at 0.84.1 before the change:
`cacheWrite1h?: number` with "Only Anthropic reports this split" at
`dist/types.d.ts:258-259`, and the `rates.input * 2 * longWrite` arithmetic at
`dist/models.js:538-543`.

The test adds a guard the review did not ask for and which the case needs: the
two candidate cost formulas are asserted to give **different** answers, otherwise
the cost assertion would be satisfied by either and would prove nothing about the
split.

Note: this commit also carries the `httpStatus` doc-table row belonging to WR-11
(the two table edits were made in one pass). WR-11's code-comment half is
`d6bb562`.

---

### WR-03: `computeBudget` never checks that the decomposition sums

**Files modified:** `.pi/extensions/diagnostics/budget.ts`,
`tests/unit/budget-sections.test.ts`
**Commit:** `5686c85`

Real, and part (b) is reachable in this very repository. Applied as suggested,
with the warning pushed **first** because when it fires every other number in the
table is unreliable.

The offending fixture is a context file whose CONTENT quotes `SKILLS_OPEN_MARKER`
— exactly the shape the review describes — with the overlap asserted as a
precondition before the warning is asserted, plus a paired positive that a
healthy prompt raises no such warning.

**Falsified:** short-circuiting the check makes case 3b fail.

---

### WR-04: `rowsWritten` is a module-level `let`

**Files modified:** `.pi/extensions/diagnostics/index.ts`,
`tests/unit/diagnostics-entry.test.ts`
**Commits:** `75e1dfe`, then `d072793`

Real. Moved to `globalThis[ROWS_WRITTEN_KEY]`, the same shape `wire.ts` already
uses for the observed jiti duplication.

**Deviation:** the review also asks for `call-model.ts` to RECEIVE
`noteRowWritten` rather than import it. Not done — that would add a parameter to
an exported cross-phase signature that Phases 5 and 8 already consume, and with
the counter process-wide the direct import is harmless. Reasoning recorded on the
constant.

`75e1dfe` shipped a test whose `index.ts?second-module-instance` specifier broke
`npm run typecheck` with TS2307. `d072793` fixes it: `ROWS_WRITTEN_KEY` is
exported (house rule) and the property is asserted where it lives, by driving the
slot from outside the module — which is exactly what a second instance does.

**Falsified:** restoring the module-level `let` makes both cases fail.

---

### WR-05: `redactDeep` leaves non-plain objects un-walked

**Files modified:** `.pi/extensions/diagnostics/redact.ts`,
`tests/unit/redact.test.ts`
**Commit:** `70e02a4`

Real, both halves, and security-relevant. Applied close to the review's patch
with one deliberate addition: **`Date` is kept as its ISO string** rather than
truncated. The review asked for the existing Date/clean-payload negative control
to be preserved; there was in fact no Date fixture in the suite, only a comment
claiming one, so the exception is now implemented AND asserted. An ISO timestamp
matches no credential shape and is what `JSON.stringify` emits anyway.

`null`/`undefined` under a credential-named key are passed through rather than
truncated, for the same reason `redactHeaders` keeps them: `null` means "delete
this header" and rewriting it would misreport a deletion as a secret.

The fixture secret is deliberately short and dull, and a precondition case
asserts it matches **none** of the eleven patterns — otherwise the new cases
would pass through the SHAPE half of the redactor and prove nothing about the KEY
half. A circular-object case covers the `JSON.stringify` throw that was one of
CR-01's triggers.

**IN-04 taken here** (same file, one line): `redactHeaders` read `value.length` on
a value the declared type forbids but nothing enforces, so one loose `undefined`
threw and `safeHandler` discarded the whole wire record for that hook — the
request vanishing from the dump entirely.

**Falsified:** reverting each of the three guards independently reddens exactly
the matching cases, 4 failures in total.

---

### WR-06: the `/budget` command handler is never executed

**Files modified:** `tests/unit/budget-command.test.ts` (new)
**Commit:** `0d6b9d5`

Real, both halves. `tests/unit/budget-command.test.ts` pulls the real handler off
a recording `registerCommand` stub and invokes it against a plain
`ExtensionCommandContext`.

The tripwire half is fixed as the review asks, by a route that does not need a
session: the stub's system prompt is assembled in Pi's own order with its skills
half produced by the **real exported** `formatSkillsForPrompt`, and the handler
recomputes the block with that same function. So a non-empty recomputed block is
compared against a real sliced region, through Pi's own formatter, at the
installed version. A non-vacuity precondition asserts the block is non-empty
first, since the old assertion's whole problem was `0 === 0`.

Five cases in total, also covering the failure path reporting twice with the
credential redacted from **both** copies, the row still landing when
`ctx.ui.notify` itself throws, and an empty branch printing "no assistant turn
yet" rather than a fabricated zero.

**Falsified three ways:** removing the success `notify` reddens 2; renaming
`where` off `BUDGET_COMMAND_WHERE` reddens 2; changing one word of
`SKILLS_OPEN_MARKER` reddens the tripwire case — the falsification the old
assertion could not produce.

---

### WR-07: two honesty markers are unreachable by any test

**Files modified:** `tests/unit/turn-hooks.test.ts` (new)
**Commit:** `13c840c`

Real. Driven with the same recording `pi.on` stub `wire-nonmutating.test.ts` uses;
`getActiveTools()` returns `[]` so gate 3 keeps the prose branch out of the
fixture's log.

**Deviation from the review's sketch:** it suggests asserting `REQUIRED_TURN_FIELDS`
on the degraded row. That list is a local const in another test file, and copying
it would be exactly the duplicated literal the house rule forbids. Instead a
HEALTHY turn is driven through the same handlers in the same session and the
degraded row must carry every key the healthy one carries — the list maintains
itself, and the healthy row doubles as the paired control proving the marker is
not stamped unconditionally and the cost is not zero unconditionally.

**Falsified twice:** an early `return` in the no-message branch reddens 2 cases;
dropping the `MODEL_UNAVAILABLE_EVENT` stamp reddens 1.

---

### WR-08: the grep gate `jsonl.ts` claims does not exist

**Files modified:** `tests/unit/jsonl-append-only.test.ts` (new),
`.pi/extensions/diagnostics/jsonl.ts`
**Commits:** `272fa74`, then `5fa1f46`

Real — the grep genuinely did not exist. Built in `chokepoint-lint.test.ts`'s
shape with all three of its vacuous-pass guards, and with a fourth pattern added
beyond the review's list: the callback-form append, whose asynchrony is the same
torn-record hazard without a stream.

**Deviation:** the review says that with the gate in place `jsonl.ts` "may name
the constructor in its own warning again". It may not, and `272fa74` proved it —
I added a docstring paragraph spelling one banned form and the gate correctly
fired on the file it protects, shipping red for one commit. `5fa1f46` fixes it.
The dodge and the check are the same mechanism, which is blocker B3's lesson that
the docstring above already states. Recorded here because the review's suggestion
is actively wrong on this point.

**Falsified:** replacing the append with a stream reddens the gate.

---

### WR-09: tautological assertion — the "no case was vacuous" guard

**Files modified:** `tests/integration/prose-retry.test.ts`
**Commit:** `2730ae3`

Real tautology. Took the review's preferred option rather than its fallback:
`drive()` now loads `probeSource()` (already the real diagnostics extension plus
observers, already proven by case 2) with one more hook writing
`pi.getActiveTools()` to a file, read back because jiti gives the extension its
own module registry.

`[]` on absence is deliberate — an absent dump means no `turn_start` fired, i.e.
the extension never loaded. Returning `[TOOL]` as a fallback would reinstate the
tautology.

**Falsified:** `tools: []` in `drive()` now reddens 5 cases including this guard.
Under the old literal the guard would have stayed green while the four counting
cases collapsed to trivial zeros, which is the whole point.

---

### WR-10: the runbook command that produces the prose rate over-counts

**Files modified:** `docs/RUNBOOK.md`, `docs/DIAGNOSTICS.md`,
`tests/unit/docs-policy.test.ts`
**Commit:** `4c4f0bf`

**Two of the three claimed defects are real. Defect 1 is not.**

- **Defect 1 — NOT REAL.** The review says
  `grep -c '"event":"prose_tool_call"'` also counts
  `"event":"prose_tool_call_retry_exhausted"`. It does not: the pattern's trailing
  `"` cannot match the `_` that follows in the exhausted record. Measured against
  a fixture holding both — the pattern matched 2 of 4 lines and the exhausted
  record was not one of them. The same applies to the alleged counterpart at
  `DIAGNOSTICS.md:413`. `-F` was added anyway as hardening, and the runbook now
  says explicitly that it fixes no bug and that the trailing quote is why step 3
  must ask for the exhausted count separately.
- **Defect 2 — REAL.** No `kind` filter, so each detected prose turn was counted
  twice (its composed row plus the standalone record). Measured: 2 where the
  answer is 1.
- **Defect 3 — REAL.** `grep -c` over a glob prints `file:count` per file.
  Verified: two files, two lines of output.

The pin needed to be stronger than the review's fragment list, and this was found
by falsification: the runbook's own rationale prose names the same fragments, so
deleting `grep -v '"kind":'` from the command and leaving it in the explanation
kept a fragment pin green. `ENTRY_COMMANDS["RB-02-03"]` now pins the three
commands in full, which is safe because each sits inside backticks on one line of
a numbered list.

**Falsified:** with the full-command pin, removing the `kind` filter reddens
`names the exact command(s) for RB-02-03`. Under the fragment pin the same edit
stayed green.

---

### WR-11: `docs/DIAGNOSTICS.md` mis-documents `httpStatus`

**Files modified:** `docs/DIAGNOSTICS.md` (in `b21708d`),
`.pi/extensions/diagnostics/schema.ts`, `.pi/extensions/diagnostics/turns.ts`,
`tests/integration/turns-log.test.ts`
**Commit:** `d6bb562`

Real, both halves. Table row corrected to the review's wording; the two code
comments that said the same wrong thing are corrected too, and both record that a
main-loop `httpStatus` would be a CODE change carrying the Pitfall 3 caveat.

**Addition beyond the review:** a corrected doc claim with no gate is still
ungated, so `turns-log` case 4b asserts the absence across the rows of all four
sessions in the file rather than the one errored row case 4 covers — with a
non-empty guard and a completeness guard so the absence is about `httpStatus` and
not about stub rows. The paired positive is `call-model.test.ts` case 2, which
requires a nested row to carry `httpStatus: 200`; without it the absence would
also be satisfied by a composer that dropped the field everywhere.

**Falsified:** threading a fabricated `httpStatus: 200` through `turn_end` reddens
4b.

---

### WR-12: `appendJsonl`'s "never larger than the cap" invariant

**Files modified:** `.pi/extensions/diagnostics/jsonl.ts`,
`tests/unit/jsonl-rotation.test.ts`
**Commit:** `1669a4e`

Real. Docstring now states the honest invariant, keeps the half that is true (the
file never crosses the cap on account of records that FIT), names the reachable
triggers, and says why dropping is not an option.

The test goes beyond the review's snippet by also pinning the CONSEQUENCE — the
next append rotates immediately and both records still exist exactly once across
live plus rotated — and by asserting the live file really is over the cap, since a
file under it would mean the record was truncated to fit, which is the same loss
under another name.

**Falsified:** making the writer drop a record larger than the cap reddens the
case.

---

### WR-13: `rotate()` is exported with no path confinement

**Files modified:** `.pi/extensions/diagnostics/jsonl.ts`,
`tests/unit/jsonl-rotation.test.ts`
**Commit:** `8d7c0eb`

Real. Took the review's second option — `rotate(cwd, file, maxRotated)` with
`assertInsideLogDir` first, before any `readdir`, `rename` or `unlink`. The only
caller in the repository is internal and was updated.

Three escape cases (a sibling of the log dir, a parent-relative path, and one
traversing back out through a subdirectory), each also asserting the planted file
is STILL ON DISK — a throw after the rename would leave it moved and only look
safe. Plus the paired positive that `rotate` still rotates a real log.

**Falsified:** removing the `assertInsideLogDir` call reddens all three escape
cases.

---

### WR-14: main-loop wire records take `corr` from mutable module state

**Files modified:** `.pi/extensions/diagnostics/wire.ts`
**Commit:** `96b9e99`
**Status: partially fixed, with the substantive half deliberately deferred.**

The cosmetic half is done as the review asks: both hooks now pass `corr`
explicitly so `wireRecord` never guesses.

The substantive half — keying the in-flight state by session id and threading the
id through the hook chain — is **not done**, and this is a deliberate decision
rather than an oversight. It is a design change with cross-phase consequences
(`index.ts`'s `inFlight` accumulator and `proseRetriesThisRun` rest on the
identical "the agent loop is serial" justification and would all have to move
together), it affects how Phase 7's in-process subagent work composes, and the
review itself notes that the assertion it proposes "would fail today". Writing
the assertion without the design would ship a red test; making the design change
unreviewed, unattended, would be a larger architectural decision than a review
fix is allowed to be.

What is done instead is the thing that makes the gap safe to inherit: the
limitation is written down. `wire.ts`'s docstring now states that
`lastCorrelationId` is a single slot written by one hook and read by two others,
that a concurrent request re-stamps it and mis-joins the first request's bytes,
that `docs/DIAGNOSTICS.md:191` already says a wrong join is worse than no id, that
the assumption holds for a serial `tui` loop and is NOT known to hold for `rpc`
mode or Phase 7's composed work, and that `inFlight` and `proseRetriesThisRun`
carry the same exposure. Marked `[threat T-02-05-04, accepted]`.

This is the same honest-limits posture the subsystem already takes for the
chokepoint gate and the Bedrock credential blind spot: a control that names what
it does not cover is a control.

---

### WR-15: `wireRecord`'s cast defeats the union

**Files modified:** `.pi/extensions/diagnostics/wire.ts`,
`.pi/extensions/diagnostics/call-model.ts`,
`tests/unit/wire-record-typing.test.ts` (new)
**Commit:** `e89b77d`

**The review's stated defect is FALSE, and the measurement is recorded in the
code.** The claim is that `Partial<WireRecord>` accepts a record carrying both a
`payload` and a `status` because `Partial` "erases the `never` guards". `Partial<T>`
is homomorphic so it does distribute over the union, but it PRESERVES each guard's
type while making it optional — `headers?: never` becomes `headers?: undefined`,
and `undefined` remains the only assignable value — so a mixed bag matches no arm.
`wireRecord("main.request", { payload: {}, status: 200 })` did **not** compile.

Verified by building the new type-level gate first, then reverting the signature
and re-running `tsc --noEmit`: three of the four `@ts-expect-error` directives
stayed IN USE, and exactly one reported "unused".

That one is the real gap, and it is genuine though smaller than reported:
`Partial` made each arm's OWN field optional too, so `wireRecord("main.request", {})`
compiled — a `.request` record saying a request happened and nothing about what
was in it. The narrowed `WireFieldsFor<K>` closes it, makes the check happen at
the call site instead of behind a cast, and lets the false half of the old comment
be deleted rather than left standing. `call-model.ts`'s private `record` helper is
generic for the same reason; a non-generic `Partial<WireRecord>` there would
re-open it.

`tests/unit/wire-record-typing.test.ts` holds all four rejections with
`@ts-expect-error`, which is a genuine gate in both directions — a regression
reports an unused directive and fails `npm run typecheck`. Three of the four are
the missing assertions for a protection that already worked but was unverified;
they stay, because an unasserted protection is one edit from not existing. A
paired-positive case pins that every legitimate shape still composes, since a
signature narrowed until it rejected everything would satisfy all four directives
while breaking the entire capture path.

**Falsified:** reverting to `Partial<WireRecord>` fails `npm run typecheck` with
TS2578 on the empty-payload case.

---

### IN-07 (out of scope, taken): `safeHandler` coerces `null` to `undefined`

**Files modified:** `.pi/extensions/diagnostics/index.ts`,
`tests/unit/diagnostics-entry.test.ts`
**Commit:** `74cb11e`

Taken because it is a one-line change in a file WR-04 already touched, and it
makes an existing docstring claim ("the success path's return value is passed
through untouched") true rather than aspirational.

**Falsified:** restoring the `??` reddens the new case.

---

### IN-04 (out of scope, taken): `redactHeaders` throws on a non-string value

Folded into WR-05's commit `70e02a4` — same file, same function family, one line.
Recorded under WR-05 above. It matters more than its Info tier suggests: the
throw was swallowed by `safeHandler`, which discarded the entire wire record for
that hook, so one loose value made a whole request disappear from the dump.

## Info findings NOT taken (out of scope, unchanged)

IN-01 (`PROSE_RETRY_FORCES_TOOL_CHOICE` dead export), IN-02 (tool-schema
serialisation envelope), IN-03 (`rotate` mixes the injected clock with
`Date.now()`), IN-05 (long context-file paths break table alignment), IN-06
(`schema.ts` imports and re-exports `StopReason`). None is adjacent to a Warning
edit as a safe one-liner: IN-02 changes a reported number and needs a decision
about whether the envelope belongs in the figure or in `ESTIMATE_NOTE`; IN-03 and
IN-05 are behaviour changes with their own test needs; IN-06 touches the
import-concentration block, which has its own gate.

---

_Fixed: 2026-08-13T11:40:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
