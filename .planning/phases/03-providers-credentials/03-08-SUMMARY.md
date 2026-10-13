---
phase: 03-providers-credentials
plan: 08
subsystem: providers-sso-classifier
tags: [wave-2, message_end, bedrock, sso, retry, PROV-05, FAUX]
requires:
  - "tests/helpers/session.ts — withFauxSession, the user-scope extension shim (Phase 2, plan 02-01)"
  - ".pi/extensions/diagnostics/index.ts — safeHandler, imported rather than copied (Phase 2, plan 02-03)"
  - "tests/unit/bedrock-auth.test.ts — the stored-credential precedence this plan does not re-prove (plan 03-05)"
provides:
  - ".pi/extensions/providers/sso.ts — classifySso(errorText), a pure importable predicate over provider error text, plus the exported SSO_PATTERNS table"
  - ".pi/extensions/providers/schema.ts — the six SSO fixtures with Pi's pre-rewrite retry verdict recorded, three non-SSO controls, the `aws sso login --profile ` prefix, the placeholder and the diagnostic keys"
  - ".pi/extensions/providers/index.ts — the message_end handler that replaces the finalized assistant message with one actionable line"
  - "tests/integration/sso-classifier.test.ts — both halves proven on a live in-memory session, with a retryable negative control as the live oracle"
affects:
  - "03-11 (runbook entries + docs-policy) — tests/integration/sso-classifier.test.ts is RB-03-03's second offline proxy and exists on disk"
  - "Phase 5 routing — .pi/extensions/providers/ is now a live project extension directory; anything added there is loaded by Pi on every session"
tech-stack:
  added: []
  patterns:
    - "a message_end handler that REPLACES the finalized message — the first in this repo; the path diagnostics/index.ts:570-582 documents precisely because it declined to take it"
    - "the original provider text moved to the message's diagnostics[] rather than kept in errorMessage, because Pi's retry classifier reads errorMessage and nothing else"
    - "a retryable negative control in the same harness as the live oracle for a callCount === 1 assertion"
    - "a pure predicate whose pattern table lives with it (not in the constants module) because the acceptance gate requires the module to carry no value import"
decisions:
  - "The pattern table lives in sso.ts, not schema.ts. The plan sketched it in schema.ts, but the acceptance criterion requires sso.ts to carry NO value import, and importing the table would be one. schema.ts keeps the fixtures and literals the writer and the tests share; sso.ts owns the regexes it applies and exports them for the exclusion assertions."
  - "MessageEndEventResult is not re-exported from the pi-coding-agent package root (dist/index.d.ts:7 lists MessageEndEvent and not its result type), so the replacement type is DERIVED from the event — `{ message: MessageEndEvent[\"message\"] }` — rather than deep-imported from dist/core/extensions/types.d.ts."
  - "The original SDK text goes on the message's own `diagnostics[]` array, appended not replaced. AssistantMessage has no `details` field; `diagnostics` is the sanctioned details position and is read by nothing in isRetryableAssistantError."
  - "A resolved profile name is shape-checked (`/^[^\\s]{1,64}$/`) before interpolation. The known limit is stated in-file: a profile literally named `timeout` would still re-admit the message to Pi's retryable pattern, and a deny-list of Pi's retryable tokens would be a second copy of a table this repo does not own."
  - "storedProfileName() carries its own try/catch, separate from safeHandler's: an auth-resolution failure must still produce a rewritten message via the ambient variable or the placeholder, because letting it escape means safeHandler returns undefined and the user gets the raw SDK string."
  - "PROV-05 is marked complete. It is [FAUX] and CONTEXT requires it be planned as passing; the fixture-fidelity question (does a REAL expiry produce a matched string?) is folded into RB-03-03's expected output, which stays OUTSTANDING."
metrics:
  duration: ~50m
  tasks: 3
  files: 4
  completed: 2026-08-13
requirements-completed: [PROV-05]
---

# Phase 3 Plan 08: The SSO Classifier Summary

A daily, silent, wall-clock-burning failure now produces one line that tells the
user exactly what to type — proven on a live session, with a retryable control
proving the measurement is a measurement.

## What was built

### Task 1 — `schema.ts` and `sso.ts` (commit `3a65c8f`)

`.pi/extensions/providers/schema.ts` holds every literal that would otherwise be
retyped in a test: the six SSO fixtures, three non-SSO controls, the
`aws sso login --profile ` prefix, the lead sentence, the `<profile>`
placeholder and its RB-03-03 hint, the Bedrock provider id, the `AWS_PROFILE`
key, the diagnostic type and its original-text key, and the profile-name shape
bound. Each fixture carries **Pi's own pre-rewrite retry verdict** in a
`retryableToday` field, which the test asserts against `isRetryableAssistantError`
— so the honest correction is a machine-checked record, not a paragraph.

`.pi/extensions/providers/sso.ts` exports `classifySso(errorText)`: pure, **zero
imports of any kind**, returning `{ kind: "sso-credential", matched }` or
`{ kind: "not-sso" }`. Five patterns, each anchored to an AWS credential
exception name or to the AWS CLI's own two-word `SSO session` phrase — never to
a generic `token`, `invalid` or `expired`, each of which appears in failures that
have nothing to do with credentials. Counted quantifiers, no `.` anywhere, no
`g` flag (the `prose.ts:130-135` lesson: a `g` pattern carries a persistent
`lastIndex` and makes `.test()` lie on every other call).

The exclusion rule is written above the table and exported for assertion: **no
pattern may match a string Pi's `RETRYABLE_PROVIDER_ERROR_PATTERN` also
matches**, because the rewrite produces a non-retryable message and firing on a
transient would strip retries that would have succeeded.

### Task 2 — `index.ts`, the `message_end` handler (commit `2b98491`)

One hook, wrapped in the diagnostics subsystem's already-asserted `safeHandler`
(imported, never copied; a comment records that nothing here calls that module's
default export, so importing it registers nothing). In order: role check first,
then error-stopped with a non-empty `errorMessage`, then `classifySso`, then the
profile resolution, then a **complete** replacement message.

The profile follows Pi's own Bedrock chain — the stored credential's
`env.AWS_PROFILE`, then the ambient variable, then the placeholder pointing at
RB-03-03. Asking the registry for a provider's resolved auth takes a provider id
string and loads no model, so it costs nothing on the one turn in a day that
reaches it.

The original SDK text is kept **out** of `errorMessage` and carried on the
message's `diagnostics[]` instead. That is Trap T4 and it is the one thing this
handler could get wrong in a way nobody would see: `isRetryableAssistantError`
reads `errorMessage` and nothing else, so an `(original: …)` suffix containing
`timed out` or a 5xx would silently restore three retries at 2 s/4 s/8 s against
a credential that cannot become valid.

`after_provider_response` is named exactly once, in a closed-door paragraph with
the source citation, so the next reader does not re-derive Trap T2.

### Task 3 — `tests/integration/sso-classifier.test.ts` (commit `cd0c3cf`)

Eight cases over six fixture runs, one no-profile run and one retryable control.
The probe extension is the shipped classifier plus two observers registered
*after* it, so the `message_end` observer sees the chained replacement and the
`agent_end` observer records what the session actually ended with.

| Case | Claim |
|---|---|
| guard | every capture is non-empty **before** anything reads its contents |
| 1 | the surfaced message contains `aws sso login --profile ky-fixture-sso-profile`, does **not** contain the placeholder, is not the provider's own text, and still carries `role`, `usage`, `model` and `content` — the four fields a patch object would erase |
| 2 | `faux.state.callCount === 1` for all six |
| 3 | the original text is absent from `errorMessage` and present on the diagnostic (Trap T4's live guard) |
| 4 | the paired positive: with no profile resolvable the placeholder **does** appear, with the RB-03-03 pointer, and without the fixture name leaking in |
| 5 | Pi's retry verdict before **and** after the rewrite for all six, opened by an oracle asserting the predicate says `true` about the untouched 503 |
| 6 | the negative control: a 503 passes through byte-identical, carries no diagnostic, and **is** retried (`callCount === 2`, `pending === 0`) |
| 7 | the exclusion rule pattern by pattern: no pattern matches a non-SSO control, and no pattern is dead |

## The honest correction, carried into the code

All six credential strings are **already** non-retryable under Pi 0.84.1. I
re-executed both of Pi's regexes over them while writing this plan
(2026-08-13, node 24.16.0) and confirmed RESEARCH §Q4.3: six `false`, and the
two retryable controls `true`. So `callCount === 1` on an SSO run would hold
with this extension uninstalled, and the file says so in its docstring rather
than claiming credit.

What makes case 2 worth asserting is case 6: the same harness, a 503, and
`callCount === 2`. Falsification C below proves the pair is live — a rewritten
message that *does* match Pi's retryable pattern turns case 2 red with a real
retry, not just case 5.

## Falsification runs (executed, not assumed)

Per the standing "be suspicious of green" rule, every mechanism was broken and
the file re-run. All mutations reverted; `git status --short` clean before each
commit.

| Mutation | Expected | Observed |
|---|---|---|
| A. classifier short-circuited so nothing is ever rewritten | cases 1/3/4 red | **3 failed** — exactly those |
| B. `(original: ${original})` appended to `errorMessage` (Trap T4) | case 3 red | **1 failed** — and case 5 stayed green, which is *why* case 3 exists: all six originals are non-retryable, so the direction table cannot catch this |
| C. lead sentence changed to contain `timed out` | cases 2 and 5 red | **2 failed** — Pi really retried, `callCount` 4 |
| D. `InvalidGrantException` pattern renamed to a dead string | cases 1/3/7 red | **3 failed** — including case 7's dead-pattern half |
| E. `503` alternation added to the `SSO session` pattern | cases 5/6/7 red | **3 failed** — the overreach half of case 7, the control's byte-identity, and case 5's oracle |
| F. ambient `AWS_PROFILE` leg removed from the resolution chain | case 1 red | **1 failed** |
| G. a patch object (`{ role }`) returned instead of a complete message | cases 1/3/4/5 red | **4 failed** — the runner's delete-and-assign leaves no `stopReason`, so the error message is unfindable |

## Deviations from Plan

### Deliberate departures from the plan's letter, in its spirit

**1. The pattern table lives in `sso.ts`, not `schema.ts`.** The plan's Task 1
action text puts "the pattern table derived from them" in `schema.ts`, while its
own acceptance criterion requires `sso.ts` to have "no value import (only
`import type`, if any)". Those cannot both hold: importing the table would be a
value import. The acceptance criterion is the machine-checkable one and it wins.
`schema.ts` keeps the fixtures and the literals the writer and the tests share;
`sso.ts` owns the regexes it applies and exports them so the test can assert the
exclusion rule mechanically. The reason is written into `sso.ts`'s docstring so
the next reader does not "fix" it back.

**2. [Rule 3 — Blocking] `MessageEndEventResult` is not exported from the
package root.** `import type { MessageEndEventResult }` failed
`tsc --noEmit` with TS2724. The type exists at
`dist/core/extensions/types.d.ts:801-804` but `dist/index.d.ts:7` re-exports
`MessageEndEvent` without it. Rather than deep-import an unexported module path,
the replacement type is derived from the event: `{ message: MessageEndEvent["message"] }`.
Same shape, no reach into a path a Pi bump may move. Documented in-file.

**3. Two assertions added beyond the plan's list** (Rule 2 — missing critical
verification): the "complete message" contract (case 1's `role`/`usage`/`model`/
`content` checks) and case 5's retry-predicate oracle. Without the first, a
patch object — the single most likely mistake against this hook's contract — is
caught only indirectly; without the second, every `false` in the direction table
would be vacuously green if the predicate ever returned `false` for everything.
Falsifications G and E respectively confirm both are live.

**4. The stored-credential leg of the profile chain is exercised by
`tests/unit/bedrock-auth.test.ts`, not here.** `createFauxSession` builds its own
agent directory and `ModelRuntime` before the callback runs, so there is no seam
to plant an `auth.json` in without changing a Phase 2 helper this plan does not
own. The live session therefore supplies the name through the ambient
`AWS_PROFILE`, scoped and restored per run. That the *stored* entry beats the
ambient one is already proven offline in both directions by plan 03-05's cases 2
and 4. Stated in the test's docstring rather than left implicit.

No Rule 1 bug was found, no Rule 4 decision arose, and nothing was installed —
`sso.ts` has no import at all.

## Autonomous decisions

Recorded rather than asked, per the Standing Operating Policy (the user is
asleep):

1. **PROV-05 is marked complete.** It carries `[FAUX]` only, and 03-CONTEXT is
   explicit that PROV-05 and PROV-08 "are fully verifiable on this machine and
   must be planned as *passing*, not outstanding". Trap T12 does not apply — it
   governs PROV-03/04/07/10. The residual fixture-fidelity question is recorded
   in the test docstring and folded into RB-03-03.
2. **The placeholder is `<profile>`**, matching RESEARCH's sketch, and the
   fallback line carries ` — no AWS profile is configured; see RB-03-03 in
   docs/RUNBOOK.md` so the dead end has an exit.

## What this does NOT prove

Nothing here contacted a provider, and nothing here could. Every "SSO error" is
a fixture this repository wrote, drawn from AWS's exception names and wording.
**Whether a real expiry on the work laptop produces a string these five patterns
recognise is unproven and is folded into RB-03-03's expected output**, which
remains OUTSTANDING. A green run of this file is evidence about the mechanism,
never about fixture fidelity. [threat T-03-08-06]

## Known Stubs

None. All four files are complete and every case executes.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/integration/sso-classifier.test.ts` | 8 passed |
| `npm test` | 43 files, **597 passed** (baseline 589 + 8 new) |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no output |
| `npx vitest run tests/unit/{chokepoint-lint,extension-layout,contributing-boundary,command-interpolation,diagnostics-entry}.test.ts` | 39 passed |
| `git diff --stat HEAD -- .pi/extensions/diagnostics/` | empty — Phase 2's instrument untouched |
| `grep -c "export default" .pi/extensions/providers/{schema,sso}.ts` | 0 and 0 |
| `grep -c "^import" .pi/extensions/providers/sso.ts` | 0 |
| `grep -cE 'modelRegistry\.complete\|\.completeSimple\|getRegisteredNativeProvider\|ModelRuntime\|@earendil-works/pi-ai/api/' .pi/extensions/providers/*.ts` | 0, 0, 0 |
| `grep -c "pi\.on(" .pi/extensions/providers/index.ts` | 1 |
| `grep -c "after_provider_response" .pi/extensions/providers/index.ts` | 1 — the closed-door docstring paragraph |
| network requests issued | none |

## Self-Check: PASSED

- `.pi/extensions/providers/schema.ts` — FOUND
- `.pi/extensions/providers/sso.ts` — FOUND
- `.pi/extensions/providers/index.ts` — FOUND
- `tests/integration/sso-classifier.test.ts` — FOUND
- commit `3a65c8f` — FOUND
- commit `2b98491` — FOUND
- commit `cd0c3cf` — FOUND
