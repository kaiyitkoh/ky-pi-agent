---
phase: 02-diagnostics-the-instrument
reviewed: 2026-08-13T10:53:38Z
depth: standard
files_reviewed: 33
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
  - tests/unit/budget-sections.test.ts
  - tests/unit/chokepoint-lint.test.ts
  - tests/unit/diagnostics-entry.test.ts
  - tests/unit/docs-policy.test.ts
  - tests/unit/extension-layout.test.ts
  - tests/unit/helpers.test.ts
  - tests/unit/jsonl-rotation.test.ts
  - tests/unit/logs-gitignored.test.ts
  - tests/unit/prose-detector.test.ts
  - tests/unit/redact.test.ts
  - tests/unit/turn-row.test.ts
  - tests/unit/wire-nonmutating.test.ts
  - docs/DIAGNOSTICS.md
  - docs/RUNBOOK.md
  - CLAUDE.md
findings:
  critical: 2
  warning: 15
  info: 7
  total: 24
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-13T10:53:38Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

The subsystem is unusually well defended against the failure class it was built to
avoid — vacuous green tests. Negative controls are real (`call-model.test.ts` case 1,
`prose-retry.test.ts` 4b/4c, `redact.test.ts` `CLEAN_SAMPLES`, `logs-gitignored.test.ts`
"the oracle is live"), paired positives are present at almost every security assertion,
and every Pi API claim I spot-checked against the installed
`@earendil-works/pi-coding-agent@0.84.1` / `pi-ai@0.84.1` is accurate
(`ctx.ui.notify` at `dist/core/extensions/types.d.ts:76`, `getSystemPromptOptions` at
`:256`, `sendUserMessage` at `:932`, `StopReason` at pi-ai `dist/types.d.ts:275`).

That said, the adversarial pass found two defects that must not ship and a substantial
set of quality failures, concentrated in three places:

1. **`call-model.ts` is the one instrumentation path with no failure containment.**
   Every other append site is inside `safeHandler` or a local `try`. On the nested path
   a log-write error propagates into the real model request. The asymmetry is provable:
   the *error*-path `appendTurn` is wrapped, the *success*-path one is not.
2. **`pruneLogs` deletes files it did not create** in a directory it does not own.
3. **The reporting/measurement layer has three unexercised halves**: the `/budget`
   command handler is never invoked by any test, two of the subsystem's own
   honesty markers (`MODEL_UNAVAILABLE_EVENT`, `TURN_NO_MESSAGE_WHERE`) have no
   test that can reach them, and the copy-pasteable runbook command that produces
   the prose rate Phase 10 discriminates on over-counts by roughly 2–3×.

I also found the concurrency test does not touch the writer it is named for, and one
outright tautological assertion.

## Critical Issues

### CR-01: `call-model.ts` — a diagnostics write failure breaks or discards the real model call

**File:** `.pi/extensions/diagnostics/call-model.ts:273-289`, `:333-355`, `:403-418`

**Issue:** `appendWire` and `appendTurn` call `appendJsonl` with no error containment,
and they are invoked from three places where a throw changes the behaviour of the thing
being measured:

- `transformHeaders` (`:333-340`), `onPayload` (`:341-348`) and `onResponse`
  (`:349-355`) each call `record(...)` → `appendWire` → `appendJsonl`. A throw from
  `transformHeaders` propagates out of `ModelRuntime.prepareRequest`; by this file's own
  documented behaviour (`:241-245`) that becomes a `createSetupErrorMessage`, i.e. the
  nested completion **fails**. A throw from `onPayload` propagates into the adapter and
  kills the request outright.
- The **success-path** `appendTurn` at `:403-418` sits *outside* any `try`. If it
  throws, `callModel` never reaches `return message` (`:420`): an already-billed
  `AssistantMessage` is discarded and a filesystem error is thrown at the caller —
  the caller that this file says "owns the fallback decision" (`:398-400`) and will
  therefore retry or downgrade because the disk was full.

The omission is demonstrably unintentional, not a design choice:
- the *failure*-path `appendTurn` at `:377-396` **is** wrapped, with the comment "The
  instrument cannot instrument its own inability to write";
- `wire.ts` routes every equivalent append through `safeHandler`;
- `tests/unit/wire-nonmutating.test.ts:216-255` exists specifically to prove the
  main-loop append failure is swallowed and the payload survives. There is no
  counterpart for the nested path.

Reachable triggers: `ENOSPC`; `EACCES`; `mkdirSync` `EEXIST`/`ENOTDIR` when anything
occupies `logDir(cwd)` (exactly the fixture `wire-nonmutating.test.ts` plants);
Windows `EBUSY`/`EPERM` on the live file; `JSON.stringify` throwing on a payload
containing a `BigInt` or a circular **non-plain** object (which `redactDeep` passes
through by reference — see WR-05).

This directly contradicts the module contract at `:296-299` ("the instrument decides
nothing") and `:298-299` ("the measurement is never lost").

**Fix:**
```ts
/** Append one wire record for the nested path and count it. Never throws. */
function appendWire(cwd: string, record: WireRecord): void {
	try {
		appendJsonl(cwd, WIRE_LOG_BASE, record, {
			rotateBytes: WIRE_ROTATE_BYTES,
			maxRotated: MAX_ROTATED_FILES,
		});
		noteRowWritten();
	} catch {
		// A capture that cannot reach disk must not fail the request it is capturing.
		// transformHeaders/onPayload throw straight into prepareRequest and the adapter.
	}
}

/** Append one turns row for the nested path and count it. Never throws. */
function appendTurn(cwd: string, row: TurnRow): void {
	try {
		appendJsonl(cwd, TURNS_LOG_BASE, row, {
			rotateBytes: TURNS_ROTATE_BYTES,
			maxRotated: MAX_ROTATED_FILES,
		});
		noteRowWritten();
	} catch {
		// The instrument cannot instrument its own inability to write, and losing the
		// row must never lose the AssistantMessage the caller has already paid for.
	}
}
```
With both helpers made total, the redundant `try`/`catch` around the error-path
`appendTurn` (`:377-396`) can be dropped. Add the missing negative control to
`tests/integration/call-model.test.ts`: plant a file at `logDir(cwd)` before a
`callModel` invocation and assert the call still returns its message and no wire
record was written.

---

### CR-02: `pruneLogs` unlinks any dated `.jsonl` in `.pi/logs/`, including files this subsystem never wrote

**File:** `.pi/extensions/diagnostics/jsonl.ts:344`, `:388-415`

**Issue:** `LOG_NAME_RE` matches `^([A-Za-z0-9][A-Za-z0-9_-]*)-(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?\.jsonl$`
— **any** base name, not `wire` or `turns`. `pruneLogs` runs on every `session_start`
(`index.ts:370-380`) and unlinks every match older than `RETENTION_DAYS`. Capture group
1 is parsed and then used only to build the rotation-bucket stem (`:410`); it is never
compared against `WIRE_LOG_BASE` / `TURNS_LOG_BASE`.

`LOG_DIR_SEGMENT = "logs"` (`schema.ts:60`) is the most obvious name any extension
would pick under Pi's config dir, and `CLAUDE.md`'s recommended stack installs ~11
third-party extensions, several of which keep durable state (`pi-background-tasks`,
`@juicesharp/rpiv-todo`). Diagnostics has no claim on that directory, yet it silently
and irreversibly deletes another component's dated JSONL after 14 days, on startup,
with unlink errors swallowed (`:402`) so nothing is reported.

No test covers a foreign name: `tests/unit/jsonl-rotation.test.ts:208-236` plants only
`turns-*` files, so the over-broad scope is unasserted in both directions.

**Fix:**
```ts
// jsonl.ts — restrict retention to the streams this module owns.
import { TURNS_LOG_BASE, WIRE_LOG_BASE /* … */ } from "./schema.ts";

/** Bases this module is allowed to delete. Never widen without a test. */
const OWNED_BASES: readonly string[] = [WIRE_LOG_BASE, TURNS_LOG_BASE];

// …inside the pruneLogs loop, immediately after the LOG_NAME_RE match:
if (!OWNED_BASES.includes(match[1])) {
    // Another extension's log. This module did not create it and must not delete it.
    continue;
}
```
Add a case to `tests/unit/jsonl-rotation.test.ts` that plants
`foreign-2020-01-01.jsonl` alongside a doomed `turns-*` file and asserts the foreign
file survives while the owned one is deleted — the paired negative that makes the
scope restriction real rather than a comment.

## Warnings

### WR-01: `cacheReadRatio` has two divergent implementations that disagree on NaN and negatives

**File:** `.pi/extensions/diagnostics/turns.ts:142-146` vs `.pi/extensions/diagnostics/budget.ts:453-458`

**Issue:** `turns.ts` guards with `if (denominator === 0) return undefined;`;
`budget.ts` guards with `if (denominator > 0)`. Both files claim these are "the same
definition ... so the number `/budget` prints and the number in the log mean one thing"
(`budget.ts:455-456`, `turns.ts` docstring, `docs/DIAGNOSTICS.md:96`). They are not.
For a non-finite or negative denominator — a provider omitting `usage.input` or
`usage.cacheRead` at runtime, which the `Usage` type forbids but no adapter is forced
to honour — `turns.ts` returns `NaN` and `composeTurnRow:236-239` assigns it, because
`NaN !== undefined`. `JSON.stringify` writes `"cacheReadRatio":null`, which
`docs/DIAGNOSTICS.md:109-114` explicitly promises can never happen ("not
present-and-`null`"). `budget.ts` correctly omits it.

**Fix:**
```ts
// turns.ts
export function cacheReadRatio(usage: Usage): number | undefined {
	const denominator = usage.input + usage.cacheRead;
	// `> 0` rather than `!== 0`: a NaN or negative denominator is not a measurement,
	// and NaN would be assigned (NaN !== undefined) and serialise to null.
	if (!(denominator > 0)) return undefined;
	return usage.cacheRead / denominator;
}
```
Add a unit case feeding `input: Number.NaN` and asserting `Object.keys(row)` lacks
`cacheReadRatio`.

---

### WR-02: `TurnRow` drops `usage.cacheWrite1h`, so `cost.cacheWrite` cannot be reproduced from the row on Bedrock/Anthropic

**File:** `.pi/extensions/diagnostics/schema.ts:218-238`, `.pi/extensions/diagnostics/turns.ts:191-211`

**Issue:** `calculateCost` prices 1h cache writes at **2× the input rate**, not the
cacheWrite rate:
```js
const longWrite = usage.cacheWrite1h ?? 0;
const shortWrite = usage.cacheWrite - longWrite;
usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
```
[VERIFIED: pi-ai 0.84.1 `dist/models.js:538-543`]. `Usage.cacheWrite1h` exists and is
documented as "Only Anthropic reports this split" [VERIFIED: pi-ai
`dist/types.d.ts:259`]. `composeTurnRow` copies `input`/`output`/`cacheRead`/
`cacheWrite`/`totalTokens`/`reasoning` and never `cacheWrite1h`, while `costFor`
computes cost from the full usage. Result: on a Bedrock Claude row with 1h retention,
`cost.cacheWrite` is not derivable from any column on the row, and Phase 8's spend
reconciliation will find `cost.cacheWrite ≠ cacheWrite × rates.cacheWrite` with nothing
in the row explaining the gap — precisely the fabricated-measurement class the
`reasoning` omitted-key rule exists to prevent.

`tests/unit/turn-row.test.ts:75` shows the author knew: "(no `cacheWrite1h`, so no 1h
split)". The field is unrecorded and untested.

**Fix:** add to `TurnRow` and assign under the omitted-key rule:
```ts
/**
 * Subset of `cacheWrite` written with 1h retention. Only Anthropic reports it
 * [VERIFIED: pi-ai 0.84.1 dist/types.d.ts:259], and `calculateCost` prices it at
 * 2x the INPUT rate [VERIFIED: pi-ai dist/models.js:538-543] — so without this
 * column `cost.cacheWrite` cannot be reproduced from the row.
 */
cacheWrite1h?: number;
```
```ts
// turns.ts, beside the `reasoning` assignment
if (usage.cacheWrite1h !== undefined) {
	row.cacheWrite1h = usage.cacheWrite1h;
}
```
Add a `turn-row.test.ts` case with `cacheWrite1h` set, asserting both the key's presence
and that `cost.cacheWrite` matches the 2×-input arithmetic; document the column in
`docs/DIAGNOSTICS.md`'s turns-row table.

---

### WR-03: `computeBudget` never checks that the decomposition sums, and `findRegion` can be steered by context-file content

**File:** `.pi/extensions/diagnostics/budget.ts:236-246`, `:274-303`, `:419-433`

**Issue:** Two related gaps in the one function whose whole job is to be checkable.

(a) `sliceSystemPrompt` deliberately computes `base` by physically removing regions so
that `base + contextFiles + skills === total` is a real invariant (`:266-272`), and the
loop at `:287-292` skips a region that overlaps a previous one — leaving the sum broken
on purpose, "which is the loud failure we want". But nothing at runtime is loud:
`computeBudget` (`:419-433`) never evaluates the invariant, so `formatBudgetReport`
prints a mis-attributed table with an empty `warnings` array. The invariant is asserted
only inside tests, against prompts the tests control.

(b) `findRegion` uses `prompt.indexOf(open)` — first occurrence anywhere. Context-file
content is interpolated verbatim into the prompt, so a user's `AGENTS.md` or `CLAUDE.md`
that documents Pi's prompt format (i.e. contains `<project_context>`,
`</project_context>\n`, or "The following skills provide specialized instructions")
relocates or truncates a region. A skills marker quoted inside the context block yields
a skills region that overlaps the context region, and the report then silently
double-counts or under-counts with no warning. This is not hypothetical for this
project: this repository's own planning documents quote those markers.

**Fix:** make the invariant a runtime warning, so the report tells the reader when it is
wrong — the stated purpose of `warnings`:
```ts
// budget.ts, near the other warning literals
export const DECOMPOSITION_DOES_NOT_SUM_WARNING =
	"base + contextFiles + skills does not equal the system-prompt length -- the located " +
	"regions overlap or were located twice (a context file whose CONTENT quotes one of " +
	"Pi's delimiters does this), so every proportion in this table is mis-attributed";

// …inside computeBudget, beside the other pushes
const accounted = slices.base + slices.contextFiles + slices.skills;
if (accounted !== slices.total) {
	warnings.push(`${DECOMPOSITION_DOES_NOT_SUM_WARNING} (accounted ${accounted}, total ${slices.total})`);
}
```
Add a `budget-sections.test.ts` case whose context-file content contains
`SKILLS_OPEN_MARKER`, asserting the warning fires — the offending fixture that proves
the guard is live, in the same style as `chokepoint-lint.test.ts:212-233`.

---

### WR-04: `rowsWritten` is a module-level `let` while the correlation counter deliberately is not, so `/budget`'s row count can under-report

**File:** `.pi/extensions/diagnostics/index.ts:193`, `:215-228`; `.pi/extensions/diagnostics/call-model.ts:122`

**Issue:** `wire.ts:140-158` documents, from an **observed** failure, that jiti gives
Pi's graph and an importing extension's graph separate instances of the same module —
which is why the request counter was moved to `globalThis` under `COUNTER_KEY`.
`rowsWritten` in `index.ts:193` has exactly the same exposure and was left as a
module-level `let`. `call-model.ts:122` then imports `noteRowWritten` from `./index.ts`
directly rather than receiving it, breaking the pattern `registerWireHooks` and
`registerBudgetCommand` both follow.

Consequence: when Phase 5/8 imports `call-model.ts` (its documented cross-phase
contract, `:174-181`), the `noteRowWritten` it calls belongs to whichever instance its
own import graph produced. `/budget`, running in Pi's instance, prints a count that
excludes every nested-call row. That is precisely the failure `index.ts:219-228` says
the export exists to prevent: "a counter that only some append paths increment ... reports
a number that looks like a measurement and is not". Note the tests cannot see this —
`turns-log.test.ts:196-201` and `prose-retry.test.ts:216-219` both explain that they read
bytes on disk *because* the in-process set is empty in the test's instance.

**Fix:** put the counter where the correlation counter already is:
```ts
// index.ts
const ROWS_WRITTEN_KEY = "__kypiDiagnosticsRowsWritten";

export function rowsWrittenThisSession(): number {
	const value = (globalThis as Record<string, unknown>)[ROWS_WRITTEN_KEY];
	return typeof value === "number" ? value : 0;
}

export function noteRowWritten(): void {
	(globalThis as Record<string, unknown>)[ROWS_WRITTEN_KEY] = rowsWrittenThisSession() + 1;
}
```
`inFlight` and `proseRetriesThisRun` (`:204`, `:276`) carry the same hazard; see WR-05
of the state discussion in WR-15.

---

### WR-05: `redactDeep` leaves non-plain objects un-walked and only applies the header-key rule to string values

**File:** `.pi/extensions/diagnostics/redact.ts:221-260`

**Issue:** Two holes in the claim at `:263` ("Redact every string leaf of a payload").

(a) `isPlainObject` (`:222-228`) accepts only `Object.prototype` and `null` prototypes.
Anything else — a class instance, a `Map`, a typed array — is returned **by reference,
un-walked** (`:255-259`). `JSON.stringify` will still serialise its own enumerable
properties into the log, so any credential-shaped string inside it reaches disk
verbatim. The docstring acknowledges the behaviour but asserts "JSON payloads contain
none of the latter" — an assumption about every current and future adapter, in the one
module whose failure is a credential on disk in a public repo. It also means a circular
non-plain object survives into `JSON.stringify` and throws (see CR-01).

(b) The key rule at `:248-251` fires only when `typeof item === "string"`:
```ts
out[key] = isRedactedHeaderKey(key) && typeof item === "string"
    ? redactionPlaceholder(item.length)
    : walk(item, depth + 1, budget);
```
So `{ authorization: { scheme: "Bearer", token: "short123" } }` or
`{ api_key: ["short123"] }` falls through to shape matching only, and a credential too
short or too unusual to match any of the eleven `SECRET_VALUE_PATTERNS` is written out.
`tests/unit/redact.test.ts` has no fixture for either shape — the `redactDeep` block
(`:146-227`) only exercises a string leaf, numbers, booleans, `null`, `undefined` and
depth truncation.

**Fix:** redact the whole subtree under a credential-named key, and refuse to pass an
unrecognised object through silently:
```ts
// redact.ts
out[key] = isRedactedHeaderKey(key)
    ? typeof item === "string"
        ? redactionPlaceholder(item.length)
        // A credential-named key whose value is not a string still holds a credential.
        // Over-redaction is the right way to be wrong here.
        : TRUNCATION_PLACEHOLDER
    : walk(item, depth + 1, budget);

// …and in walk's tail, replace the silent pass-through for object-like values:
if (typeof value === "object" && value !== null) {
    // A non-plain object (class instance, Map, typed array) cannot be walked safely,
    // and JSON.stringify would still emit its own enumerable string properties.
    return TRUNCATION_PLACEHOLDER;
}
return value;
```
Add two `redact.test.ts` cases: a credential under `{ authorization: { token } }`, and a
class instance holding a secret-shaped string — both asserting the secret is absent from
`JSON.stringify(redactDeep(...))`. Keep the existing `Date`/clean-payload negative
control so the change does not start mangling legitimate data.

---

### WR-06: the `/budget` command handler is never executed by any test, and the "tripwire" it advertises is asserted as `0 === 0`

**File:** `.pi/extensions/diagnostics/budget.ts:588-663`; `tests/integration/budget.test.ts:294-305`, `:367-375`, `:408-416`; `tests/unit/diagnostics-entry.test.ts:209-217`

**Issue:** `registerBudgetCommand`'s handler body — ~50 lines including
`ctx.getSystemPrompt()`, `ctx.getSystemPromptOptions()`, `formatSkillsForPrompt(skills)`,
the `getActiveTools`/`getAllTools` intersection, `getLastAssistantUsage(...)`,
`ctx.ui.notify`, and the entire catch path that writes a `diagnostics.error` row with
`BUDGET_COMMAND_WHERE` — has zero coverage. `diagnostics-entry.test.ts` only asserts the
command *name* was registered; its stub `registerCommand` discards the handler.
`budget.test.ts` calls `computeBudget`/`formatBudgetReport` directly and states the gap
in its own header (`:22-40`).

The consequence is worse than missing coverage. Every call of `computeBudget` in
`budget.test.ts` passes `skillsBlock: ""`, hand-written by the test (`:301`, `:371`,
`:412`). In that session `slices.skills` is also `0`, so
`skillsBlockMatchesSlice = ("".length === 0)` — the assertion at `:315-319` that this is
"RESEARCH §7.3's tripwire for Pi changing its format" is comparing a constant the test
supplied against a default that happens to match. Pi's real `formatSkillsForPrompt`
output is never once compared against a real sliced region, in any test, at any level.
`budget-sections.test.ts` case 5 exercises the *comparison* against a synthetic block,
which is not the same claim.

**Fix:** drive the handler. `ExtensionCommandContext` is a plain interface and the pure
functions already take everything as data, so a unit test can do it offline:
```ts
// tests/unit/budget-command.test.ts (new)
const notified: { text: string; level?: string }[] = [];
const ctx = {
	cwd,
	ui: { notify: (text: string, level?: string) => notified.push({ text, level }) },
	getSystemPrompt: () => FULL_PROMPT,
	getSystemPromptOptions: () => ({ cwd, contextFiles: [...], skills: [...] }),
	sessionManager: { getBranch: () => [] },
} as unknown as ExtensionCommandContext;
// capture the handler off a recording registerCommand stub, invoke it, assert the
// notified text contains ROWS_WRITTEN_LABEL and PROVIDER_REPORTED_LABEL;
// then a second case where getSystemPrompt() throws, asserting a diagnostics.error
// row carrying BUDGET_COMMAND_WHERE lands in the turns log.
```
Additionally, in `tests/integration/budget.test.ts`, import `formatSkillsForPrompt` from
`@earendil-works/pi-coding-agent` and feed a session that has a real skill configured, so
the recomputed-versus-sliced cross-check is exercised against Pi's own formatter at least
once with a non-empty block.

---

### WR-07: two of the subsystem's honesty markers are unreachable by any test

**File:** `.pi/extensions/diagnostics/index.ts:153`, `:165`, `:531-545`, `:550`, `:579`

**Issue:** `TURN_NO_MESSAGE_WHERE` (the row a turn with no assistant message must leave,
`:531-545`) and `MODEL_UNAVAILABLE_EVENT` (the marker that makes a zero-rate cost row
excludable from a Phase 8 spend total, `:550`/`:579`) are both exported under this
repo's stated house rule — "Exported so a test imports it rather than re-typing the
literal". A repo-wide grep shows **no test imports either constant**, and no test
constructs a turn without a message or a session with `ctx.model === undefined`. Both
paths, and the `degradedModel` shape at `:306-319`, ship unexecuted.

These are exactly the branches whose failure is invisible: `[threat T-02-08-02]` and
`[threat T-02-08-05]` in the source describe a missing row and a fabricated zero cost,
neither of which produces an error anywhere.

**Fix:** both are reachable with the same recording stub `wire-nonmutating.test.ts`
already uses — capture the `turn_end` handler off a stub `pi.on`, then:
```ts
// no message: invoke turn_end without a preceding message_end
await turnEnd({ type: "turn_end", turnIndex: 0, toolResults: [] }, fakeCtx(cwd));
expect(rows[0]?.where).toBe(TURN_NO_MESSAGE_WHERE);

// degraded model: message_end then turn_end with a ctx whose `model` is undefined
expect(row.event).toBe(MODEL_UNAVAILABLE_EVENT);
expect(row.cost.total).toBe(0);
expect(row.provider).toBe(message.provider); // the degraded shape still names the provider
```
Assert the degraded row still carries every `REQUIRED_TURN_FIELDS` entry, so "honestly
degraded" is a tested claim rather than a comment.

---

### WR-08: the DIAG-08 concurrency test never calls `appendJsonl`, and the grep gate `jsonl.ts` claims protects it does not exist

**File:** `tests/integration/jsonl-concurrency.test.ts:86-114`; `.pi/extensions/diagnostics/jsonl.ts:1-31`

**Issue:** `jsonl.ts:5-13` states the rule and its enforcement: "The `node:fs` stream
constructor is deliberately NOT spelled anywhere in this file ... A plain-substring grep
over this file for that constructor is the mechanical proof that no stream is opened
here". No such grep exists — `grep -rn "createWriteStream\|WriteStream" tests/ .pi/`
returns nothing. The file therefore pays the readability cost of refusing to name the
constructor in exchange for a gate that was never written.

Meanwhile the test named for the property uses raw `appendFileSync` in its generated
child (`:106`) and only borrows `logPath`/`logDir` for the filename. It proves an
operating-system property — which its header honestly says — but it cannot detect the
one regression `jsonl.ts:26` says must never happen ("**Never introduce a stream
here**"): swapping `appendFileSync` for a buffered stream inside `appendJsonl` leaves
every assertion in this file green.

**Fix:** add the missing gate, in the same shape as `chokepoint-lint.test.ts`, with an
inline offending fixture proving the pattern is live:
```ts
// tests/unit/jsonl-append-only.test.ts (new)
const FORBIDDEN = [
	{ pattern: /createWriteStream/, why: "a held fd keeps writing into the file that was renamed away" },
	{ pattern: /WriteStream/, why: "same, via the class" },
	{ pattern: /\bopenSync\b/, why: "a raw descriptor is the same hazard without the helper" },
];
const OFFENDING_FIXTURE = 'const s = createWriteStream(f); const fd = openSync(f, "a");';
// assert every pattern fires against OFFENDING_FIXTURE, then assert none fires
// against readFileSync(".pi/extensions/diagnostics/jsonl.ts"), and assert the file
// DOES contain "appendFileSync" so the check cannot pass over a gutted writer.
```
Then `jsonl.ts` may name the constructor in its own warning again, because the gate is
real.

---

### WR-09: tautological assertion — the "no case was vacuous" guard compares a constant the test supplied

**File:** `tests/integration/prose-retry.test.ts:783-791` (with `:224`)

**Issue:**
```ts
// drive(), line 224
activeTools: [TOOL],
...
// the final `it`
expect(capture.activeTools, "...").toContain(TOOL);
```
`activeTools` is never read from the session; it is hardcoded by the helper that builds
the capture. The assertion is `[TOOL].toContain(TOOL)` and cannot fail even if
`tools: [TOOL]` were removed from `withFauxSession`, which is the condition it claims
to guard (gate 3 refuses an empty active-tool list, so every count in the file would
become a trivial zero). The real precondition guard in this file is the first `it`
(`:346-363`), which is genuine; this one is decoration and, worse, reads as coverage.

**Fix:** observe the live value instead of asserting a literal.
```ts
// in probeSource()/an inline probe, write what Pi really reports:
'\tpi.on("turn_start", (_event, ctx) => {',
'\t\twriteFileSync(join(ctx.cwd, "active-tools.json"), JSON.stringify(pi.getActiveTools()), "utf-8");',
"\t});",
// then in drive(), read it back:
activeTools: existsSync(f) ? (JSON.parse(readFileSync(f, "utf-8")) as string[]) : [],
```
If that is judged too invasive for the fixture, delete the assertion rather than leave a
tautology standing in for a precondition check.

---

### WR-10: the runbook command that produces the prose rate over-counts by roughly 2–3×

**File:** `docs/RUNBOOK.md:320-321`, `:325-337`; `docs/DIAGNOSTICS.md:408-414`

**Issue:** three defects in the copy-pasteable commands whose output is the number
Phase 10 discriminates root causes on.

1. `grep -c '"event":"prose_tool_call"'` is a substring match, so it also counts every
   `"event":"prose_tool_call_retry_exhausted"` record (`schema.ts:126`). The runbook's
   own "Expected output" treats that count as the numerator.
2. RB-02-03 step 1 does **not** filter on `kind`. Every detected prose turn leaves *two*
   matching records — the turn's own row (`index.ts:451`, via `composeTurnRow`) and the
   standalone kind-less record (`index.ts:484-490`). The runbook notes the distinction at
   `:334-337` and then gives a command that ignores it, so the numerator is roughly
   doubled against a denominator (`"kind":"turn"`) that is correct. The published
   comparison is against the ~11% DeepSeek baseline; a 2–3× inflated rate would read as
   confirmation of the leading root-cause hypothesis.
3. `grep -c` over a glob (`turns-*.jsonl`) prints `file:count` per file, not a single
   total, so neither step yields "a numerator and a denominator" as claimed.

`DIAGNOSTICS.md:413` has the same substring defect: `grep -v '"kind":'` correctly drops
turn rows but leaves the exhausted records, which are also kind-less.

**Fix:**
```sh
# RB-02-03 step 1 — the ACTIONS, exactly once each, across every rotated file.
# The trailing `"` closes the JSON string so `prose_tool_call_retry_exhausted`
# does not match, and `grep -v '"kind":'` drops the turn rows that carry the
# same verdict alongside their stopReason.
cat .pi/logs/turns-*.jsonl | grep -F '"event":"prose_tool_call"' | grep -v '"kind":' | wc -l

# RB-02-03 step 2 — the denominator.
cat .pi/logs/turns-*.jsonl | grep -cF '"kind":"turn"'

# and, worth having beside them, the turns where the nudge did not work:
cat .pi/logs/turns-*.jsonl | grep -cF '"event":"prose_tool_call_retry_exhausted"'
```
Apply the same `-F '"event":"prose_tool_call"'` fix at `DIAGNOSTICS.md:413`. Because
`docs-policy.test.ts:229-232` pins these command fragments verbatim, update
`ENTRY_COMMANDS["RB-02-03"]` in the same change.

---

### WR-11: `docs/DIAGNOSTICS.md` mis-documents `httpStatus`; it can never appear on a `kind:"turn"` row

**File:** `docs/DIAGNOSTICS.md:105`; `.pi/extensions/diagnostics/index.ts:552-581`

**Issue:** the schema table lists `httpStatus` with **Source: `after_provider_response`**
and the rule "Absent on any errored turn, and absent on a nested call unless `callModel`
was given an `onResponse`". Both halves mislead:

- `index.ts`'s `turn_end` never passes `httpStatus` to `composeTurnRow` at all
  (`:552-581`), so a main-loop row **never** carries it — successful or not. A reader
  following the table will look for a column that does not exist for `kind:"turn"`, and
  the "Absent on any errored turn" phrasing implies it is present otherwise.
- On the nested path `callModel` always supplies `onResponse` (`call-model.ts:349-355`),
  so the field is present whenever a response was seen — including on an errored row.
  `tests/integration/call-model.test.ts` case 4 exercises exactly that shape: faux
  answers 200 before the scripted `stopReason: "error"` step, so the reviewer row carries
  both `outcome: "error"` and `httpStatus: 200`, contradicting "absent on any errored
  turn".

`turns-log.test.ts:479-484` asserts `httpStatus` is absent from a main-loop error row but
nothing asserts it present anywhere on the main loop — because it cannot be.

**Fix:** replace the table row with what the code does:
```
| `httpStatus` | yes | HTTP status as `onResponse` reported it. **Only ever present on a `kind:"nested"` row** — `turn_end` never derives it, so a main-loop turn never carries one. Absent on a nested call where no HTTP response was seen | `callModel`'s `onResponse` |
```
`schema.ts:249-255`'s comment needs the same correction. If a main-loop `httpStatus` is
genuinely wanted, that is a code change (thread `after_provider_response.status` onto the
accumulator) and must come with the Pitfall-3 caveat, not a doc edit.

---

### WR-12: `appendJsonl`'s documented "never larger than the cap" invariant does not hold for an oversized record

**File:** `.pi/extensions/diagnostics/jsonl.ts:300-330`

**Issue:** `:302-303` promises "the live file is never larger than the cap rather than
merely being rotated once it already is". The guard is
`if (size > 0 && size + bytes > cap)`. Two branches write unconditionally afterwards:
an empty/absent file (`size === 0`) and the post-rotation path (`size` reset to `0` at
`:324`). A single record larger than `rotateBytes` is therefore written whole, leaving a
live file above the cap and — because it is now over the cap with `size > 0` — rotating
on the very next append, producing a stream of one-record rotated files.

Reachable: `logs-gitignored.test.ts:94` already uses `rotateBytes: 400` with a 200-byte
filler; any caller passing a small cap, or a wire payload larger than
`WIRE_ROTATE_BYTES` (a large file read into `messages[]`), hits it.
`jsonl-rotation.test.ts` only ever uses 500-byte records against a 4000-byte cap, so the
branch is untested in both directions.

**Fix:** state the honest invariant and prove it:
```ts
// jsonl.ts — replace the docstring claim:
// The cap is checked against `size + thisRecord`, so the live file never crosses the
// cap on account of records that fit. A SINGLE record larger than the cap is written
// whole regardless: dropping a record to honour a size bound would lose the turn it
// describes, which is the one thing this writer may never do.
```
and add the case that pins it:
```ts
it("writes a single oversized record whole rather than dropping it", async () => {
	await withTempLogCwd(async (cwd) => {
		const live = appendJsonl(cwd, TURNS_LOG_BASE, makeRecord(1), { rotateBytes: 100, now });
		expect(readIntact(live, "the live file").length, "the record must survive").toBe(1);
	});
});
```

---

### WR-13: `rotate()` is exported with no path confinement, unlike every other path-taking export

**File:** `.pi/extensions/diagnostics/jsonl.ts:214-261`

**Issue:** `logPath` validates its `base` against `BASE_RE` and runs
`assertInsideLogDir` (`:156-164`), and `appendJsonl` goes through `logPath`. `rotate`
takes a raw `file: string` and performs `readdirSync`, `renameSync` and `unlinkSync`
relative to whatever directory it derives from that string (`:215-217`), with no
confinement check at all. It is a public export of the module, so the second control
the module docstring advertises — "the resolved file is asserted to sit inside
`logDir(cwd)` before anything is written" (`:47-53`) — does not cover this entry point.
Today's only caller is internal, which is why nothing is broken; the defence-in-depth
claim in the docstring is nonetheless untrue for one of the two exported writers.

**Fix:** either stop exporting it, or make it take the same shape as its siblings:
```ts
export function rotate(cwd: string, file: string, maxRotated: number = MAX_ROTATED_FILES): void {
	// Same second line of defence as logPath: a rename/unlink target must resolve
	// inside the log directory even when the caller built the path itself.
	assertInsideLogDir(cwd, file);
	// …
}
```
and add an escape case to `jsonl-rotation.test.ts`'s existing `ESCAPES` block asserting
`rotate` throws for a path outside `logDir(cwd)`.

---

### WR-14: main-loop wire records take `corr` from mutable module state instead of the id issued for their own triple

**File:** `.pi/extensions/diagnostics/wire.ts:160-161`, `:220-231`, `:276-312`; `.pi/extensions/diagnostics/index.ts:204`, `:276`

**Issue:** `before_provider_headers` issues an id and passes it explicitly (`:261-268`),
but `before_provider_request` and `after_provider_response` pass no `corr` and fall back
to `wireRecord`'s `currentCorrelationId()` read of the module-level `lastCorrelationId`.
`call-model.ts` shows the correct pattern — it issues its own id and threads it through
every record (`:313`, `:317-319`) precisely because "the main loop may have issued one
in between". The main loop has the mirror-image exposure: any second provider request
starting between one request's headers hook and its request/response hooks re-stamps
`lastCorrelationId`, and the first request's bytes are filed under the second request's
id. A wrong join "looks like an answer", which `docs/DIAGNOSTICS.md:191` calls worse
than no id.

The same single-slot assumption governs `inFlight` (`index.ts:276`) and
`proseRetriesThisRun` (`:204`). Both are justified by "the agent loop is serial", which
holds for one session and not for a process running more than one — rpc mode, or the
in-process background/subagent work Phase 7 composes.

**Fix:** thread the id, matching `call-model.ts`. Keep the counter where it is; only the
read changes:
```ts
// wire.ts — hold the triple's id on the module for exactly the two hooks that follow,
// and pass it explicitly so wireRecord never has to guess.
pi.on("before_provider_request", safeHandler<BeforeProviderRequestEvent>("before_provider_request", (event, ctx) => {
	append(ctx.cwd, wireRecord("main.request", {
		corr: currentCorrelationId() ?? UNCORRELATED,
		sessionId: ctx.sessionManager.getSessionId(),
		payload: redactDeep(event.payload),
	}));
}));
```
That alone is cosmetic; the substantive fix is to key the in-flight state by session id
and record, in the module docstring, that concurrent requests within one session remain
unsupported — with an assertion in `wire-nonmutating.test.ts` driving two interleaved
header/request pairs and requiring each request record to carry its own headers record's
`corr`. As written, that test would fail today.

---

### WR-15: `wireRecord`'s `as WireRecord` cast defeats the union that `schema.ts` built to prevent invalid records

**File:** `.pi/extensions/diagnostics/wire.ts:220-231`; `.pi/extensions/diagnostics/schema.ts:281-315`

**Issue:** `schema.ts:287-288` states the design intent: the record type is "modelled as
a union rather than three optional fields so a record carrying both a request `payload`
and a response `status` does not typecheck". `wireRecord` takes
`fields: Partial<WireRecord>` and returns `{...} as WireRecord` (`:225-230`). The
comment claims "the union in `schema.ts` still rejects a caller that passes, say, both a
`payload` and a `status` in `fields`" — but `Partial<WireRecord>` distributes over the
union, and the `never` guards (`headers?: never`) are erased by `Partial`, so
`Partial<A|B|C>` accepts a mix. `wireRecord("main.request", { payload: {}, status: 200 })`
compiles, and the cast then launders it into a `WireRecord`. There is no test asserting
the rejection either, so the stated protection is unverified in both directions.

**Fix:** narrow the parameter to the arm the `kind` selects, so the check happens at the
call site where a human can act on it:
```ts
type WireFieldsFor<K extends WireKind> = K extends `${string}.request`
	? { payload: unknown }
	: K extends `${string}.headers`
		? { headers: Record<string, string | null> }
		: { status: number; headers?: Record<string, string | null> };

export function wireRecord<K extends WireKind>(
	kind: K,
	fields: WireFieldsFor<K> & { corr?: string; sessionId?: string; role?: string },
): WireRecord {
	return { ts: Date.now(), corr: currentCorrelationId() ?? UNCORRELATED, kind, ...fields } as WireRecord;
}
```
If that proves too rigid, at minimum delete the comment's false claim rather than leave a
protection documented that does not exist.

## Info

### IN-01: `PROSE_RETRY_FORCES_TOOL_CHOICE` is a dead export

**File:** `.pi/extensions/diagnostics/index.ts:190`
**Issue:** referenced by no code and imported by no test; only prose mentions it
(`docs/DIAGNOSTICS.md:389`, `diagnostics-entry.test.ts:196` inside a failure message).
The docstring's argument for keeping the mechanism unregistered is sound, but the
constant itself carries no behaviour.
**Fix:** either delete it and keep the paragraph in `docs/DIAGNOSTICS.md`, or have
`diagnostics-entry.test.ts` import it and assert `toBe(false)` beside the eight-hook
list, so flipping it fails a test rather than only a comment.

### IN-02: the tool-schema column omits the per-tool serialisation envelope

**File:** `.pi/extensions/diagnostics/budget.ts:405-414`
**Issue:** the per-tool figure is `name.length + description.length + JSON.stringify(parameters).length`.
The real cost is that inside `{"type":"function","function":{"name":…,"description":…,"parameters":…}}`
— roughly 40 extra bytes per tool, plus the `"tools":[…]` wrapper. With 20 active tools
the report under-states the column by ~800 characters (~200 estimated tokens).
**Fix:** add a named constant for the envelope and include it per tool, or note the
exclusion in `ESTIMATE_NOTE` so the number is not read as complete.

### IN-03: `rotate` mixes the injected clock with `Date.now()`

**File:** `.pi/extensions/diagnostics/jsonl.ts:259`
**Issue:** `appendJsonl` takes `opts.now` for determinism, but `rotate` stamps the size
cache with real `Date.now()`. With an injected clock the resulting `checkedAt` is
unrelated to the `nowMs` the next `cachedSize` compares against, so the 1-second
re-`stat` window is non-deterministic in tests. It self-corrects (a re-`stat` yields the
truth), so no assertion is currently wrong.
**Fix:** thread `now` into `rotate`, or drop the cache write there and let the next
`cachedSize` re-`stat`.

### IN-04: `redactHeaders` throws on a non-string, non-null header value

**File:** `.pi/extensions/diagnostics/redact.ts:207-219`
**Issue:** `value.length` and `redactString(value)` both assume `string`. The declared
type is `Record<string, string | null>` so this should not occur, but a runtime
`undefined` (a provider or another extension deleting a key by assignment rather than
`null`) throws, and `safeHandler` then discards the whole wire record for that hook.
**Fix:** `if (typeof value !== "string") { out[key] = value === undefined ? null : value; continue; }`
before the credential branch.

### IN-05: long context-file paths break the aligned table

**File:** `.pi/extensions/diagnostics/budget.ts:474-479`
**Issue:** `padEnd(LABEL_WIDTH)` with `LABEL_WIDTH = 30` does not truncate, so an
absolute path longer than 30 characters — the normal case on Windows — pushes the
character and token columns out of alignment for that row only.
**Fix:** truncate the label with a leading ellipsis when it exceeds `LABEL_WIDTH`,
keeping the tail (the filename) which is the readable part.

### IN-06: `schema.ts` imports and separately re-exports `StopReason` from the same module

**File:** `.pi/extensions/diagnostics/schema.ts:25`, `:47`
**Issue:** `import type { StopReason }` at `:25` (used by `OUTCOME_BY_STOP_REASON`) and
`export type { … StopReason … }` at `:47` name the same symbol from the same package in
two statements.
**Fix:** `export type { StopReason }` alongside the local import, or drop the separate
import and reference the re-export.

### IN-07: `safeHandler` coerces a handler's `null` return to `undefined`

**File:** `.pi/extensions/diagnostics/index.ts:348`
**Issue:** `return (result ?? undefined) as R | undefined;` converts a deliberate `null`
return into `undefined`. Harmless for the eight handlers registered today (none returns a
value), but the docstring at `:334-335` advertises the wrapper as safe for "a hook with a
real return contract", and some Pi hooks distinguish `null` from `undefined`.
**Fix:** `return result as R | undefined;` — the success path should pass the value
through untouched, which is what the docstring already claims it does.

---

_Reviewed: 2026-08-13T10:53:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
