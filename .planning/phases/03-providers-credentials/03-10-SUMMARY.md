---
phase: 03-providers-credentials
plan: 10
subsystem: providers-fallback-chain
tags: [wave-3, fallback, PROV-08, FAUX, taxonomy, chokepoint]
requires:
  - ".pi/extensions/diagnostics/call-model.ts — callModel, the one sanctioned path to a model (Phase 2, plan 02-07)"
  - "tests/helpers/faux.ts — wrapFauxWithStatus, the only way a non-200 reaches a faux run (plan 03-01)"
  - "tests/helpers/session.ts — withFauxSession and the user-scope extension shim (Phase 2, plan 02-01)"
  - "tests/helpers/models.ts — withModelsConfig, the offline composed registry (plan 03-01)"
  - ".pi/extensions/providers/schema.ts — extended, not replaced; plan 03-08's SSO constants are untouched"
  - ".pi/templates/models-template.json — the DashScope entry the A7 case resolves against (plan 03-02)"
provides:
  - ".pi/extensions/providers/schema.ts — CHAIN (two hops), FAILURE_CLASSES, ADVANCING_CLASSES, QUOTA_PATTERN, UNAVAILABLE_PATTERN, CLASS_FIXTURES, DASHSCOPE_QUOTA_FIXTURES"
  - ".pi/extensions/providers/fallback.ts — callWithFallback(ctx, opts) and classifyFailure(errorText), named exports, no hook and no registration"
  - "tests/integration/fallback-chain.test.ts — 13 cases: per-provider attempt counts across four classes, the fatal control in the same session, the chokepoint row proof, the A7 resolution check and the rejection branch"
affects:
  - "Phase 5 routing — callWithFallback is the failure path a router calls; it chooses nothing about which model runs"
  - "Phase 7 — pi-model-fallback and pi-subagents' fallbackModels now have an authored incumbent to be compared against"
  - "03-11 — no new [RUNBOOK] id is required by PROV-08 ([FAUX]); one optional fixture-fidelity entry is suggested below"
tech-stack:
  added: []
  patterns:
    - "a taxonomy that reuses Pi's own exported predicate for the split it can express, and a local table only for the one subdivision Pi does not model"
    - "an unresolved lookup is an error with the remedy in the message, never a skipped iteration"
    - "a rejection and a returned failure are classified by ONE rule over the same input (the provider-controlled text)"
    - "fresh faux handles per walk so every attempt count is absolute rather than arithmetic over a running total"
    - "an identity guard (`model.api === handle.api`) on every hop, so a failed registration cannot silently exercise Pi's real built-in provider"
decisions:
  - "The quota table is checked BEFORE Pi's predicate, not after. Pi reports every quota string as non-retryable and is right to, but 'do not retry' and 'do not try somebody else' are different decisions and Pi only makes the first. Checking Pi first would collapse quota into fatal and the chain would never advance on the one failure a second vendor is most certain to survive."
  - "classifyFailure takes the error TEXT, not an AssistantMessage. A registry-facade rejection has no message attached, and classifying a rejection by a different rule than a returned failure is how the same outage advances down one path and stops down the other. Pi's predicate is fed a two-field probe, which is exactly what it reads (dist/utils/retry.js:165-172)."
  - "classifyFailure lives in fallback.ts, not schema.ts. schema.ts stays a constants module with no value import; the function that applies the tables sits with the chain that consumes them, mirroring plan 03-08's split between schema.ts and sso.ts."
  - "A rejection is RETHROWN when the chain is not advancing, never converted into a synthesised message. A synthetic failure no provider produced would erase the stack that says where it came from, and the chokepoint has already written its turns row before rethrowing."
  - "An empty error text classifies as fatal. An unclassifiable failure is not evidence that a second vendor would do better, and advancing on it would forward the whole prompt somewhere on the strength of knowing nothing."
  - "The A7 (every-entry-resolves) case runs against a registry composed from the SHIPPED template plus Pi's catalogue, not against the faux session. In the faux session both ids resolve because the fixture registered them under exactly those ids — falsification F7 proved that half is tautological for A7 and only the composed-registry case catches a renamed id."
  - "PROV-08 is marked complete. It carries [FAUX] only and 03-CONTEXT requires it be planned as passing; Trap T12 governs PROV-03/04/07/10 and does not apply."
metrics:
  duration: ~45m
  tasks: 3
  files: 4
  completed: 2026-08-14
---

# Phase 3 Plan 10: The Fallback Chain Summary

A DeepSeek-direct → DashScope chain that advances exactly one hop on a quota
wall, a rate limit and an outage, refuses to spend a second vendor on a 400, and
reaches every model through the one path the instrument can see.

## What was built

### Task 1 — the chain table and the taxonomy (`schema.ts`, commit `9b09f2e`)

`CHAIN` is two entries, DeepSeek-direct first, with the reason for the order
written beside it: DashScope serves the same weights behind a different account,
different quota and different region, so it is what survives a wall on the
primary — a second hop on the *same* vendor would survive none of the three
classes. Assumption A7 (the second hop serves the same model id) is recorded in
the file, along with the reason an unresolved entry must be an error.

The taxonomy is four classes, and the split is deliberately unequal in origin:

| Class | Rule | Action |
|---|---|---|
| `quota` | local `QUOTA_PATTERN` (checked **first**) | advance |
| `fatal` | Pi's `isRetryableAssistantError` says no | **stop** |
| `unavailable` | Pi says retryable **and** local `UNAVAILABLE_PATTERN` matches | advance |
| `transient` | Pi says retryable, everything else | advance |

`QUOTA_PATTERN`'s first four alternatives are transcribed from Pi's own
`NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` [VERIFIED: pi-ai 0.84.1
src/utils/retry.ts:7-23] so the two agree about the strings they share; the last
two are DashScope's `Arrearage` and `Allocated quota` wording, which Pi's table
does not carry at all.

`CLASS_FIXTURES` carries one representative string per class **with Pi's own
verdict recorded** (`retryableToday`), EXECUTED over `isRetryableAssistantError`
on 2026-08-13 (node 24.16.0). The test imports the strings rather than retyping
them, and case 7 asserts Pi still agrees.

### Task 2 — `callWithFallback` (`fallback.ts`, commit `9e78583`)

One named export, no hook, no registration. The docstring records why the chain
cannot live in an event at all — the registry facade's completion path has no
retry of its own, and a nested invocation fires no extension events — and the
three rejected alternatives (`pi.setModel()`, `before_provider_request`, a
third-party `fallbackModels`) with their reasons, so none of them is
re-litigated.

Per hop: resolve, call the Phase 2 chokepoint, return on a non-error message,
classify otherwise. `fatal` returns the failing message untouched; the three
advancing classes move on immediately with **no backoff of this module's own**,
because the main loop already has one. An unresolved entry throws with the entry
id, the likely cause and the file to fix in the message.

The `try/catch` is kept alongside the `stopReason` branch and is not padding:
`call-model.ts:475-479` rethrows a registry-facade rejection specifically
because "the caller — not this function — owns the fallback decision", and this
module is the only caller that sentence has ever had.

### Task 3 — `tests/integration/fallback-chain.test.ts` (commit `a23c0a6`)

13 cases. Four walks of the chain in **one live session** against the same pair
of providers, then the control:

| Case | Claim |
|---|---|
| 0 | the probe really handed over a live `ExtensionContext` |
| 1 | every hop resolved **this run's faux provider**, not Pi's real built-in `deepseek` |
| 2 (×3) | quota / transient / unavailable: first provider `callCount` **exactly 1** (no same-provider retry), second **exactly 1**, second provider's message returned, and the fixture still classifies as its own class |
| 3 | **THE CONTROL** — a 400 leaves the second provider at **exactly 0**, opened by re-asserting that the quota walk in the same session *did* advance |
| 4 | a successful first hop leaves the second at 0 — the chain does not call ahead |
| 5 | both hops left a `kind:"nested"` turns row, in chain order, the first carrying the 429 the provider reported and the second a 200 |
| 6 | every `CHAIN` entry resolves in a registry composed from the **shipped template** plus Pi's catalogue |
| 6b | an unresolved entry throws, naming the entry and pointing at `schema.ts` |
| 6c | a rejection is classified by the same rule in both directions: fatal-shaped stops at 1 hop, transient-shaped reaches 2 and comes back out |
| 7 | Pi's predicate still returns each fixture's recorded verdict, and quota/fatal are still *both* non-retryable to Pi (which is what makes the local table necessary) |
| 8 | DashScope's own quota wording advances; **all six SSO credential strings are fatal**; an empty error text is fatal |

Case 8's SSO half is not in the plan's task list. It was added under deviation
Rule 2: threat **T-03-10-02** (a dead credential advancing to a second vendor) is
the highest-rated disclosure risk on this plan and had no assertion anywhere.

## Falsification runs (executed, not assumed)

Every mechanism was broken and the file re-run. All mutations reverted; the
suite is green and `git diff` is clean at each commit.

| # | Mutation | Expected | Observed |
|---|---|---|---|
| F1 | the fatal branch made unconditional (`if (true)`) — never advance | cases 2×3, 5 red | **5 failed** — including case 3, which fails on its own paired-positive guard, exactly as designed |
| F2 | the fatal branch removed (`if (false)`) — always advance | case 3 red | **1 failed** — the control |
| F3 | quota checked **after** Pi's predicate | quota red | **4 failed** — cases 2-quota, 3, 5, 8 |
| F4 | unresolved entry → silent `continue` | case 6b red | **1 failed** — and instructively: it still *threw* (the empty-chain guard), so only the "name the entry and the remedy" assertions caught it |
| F5 | `catch` rethrows unconditionally (no classification of a rejection) | case 6c red | **1 failed** |
| F6 | `UNAVAILABLE_PATTERN` alternation replaced with a dead token | unavailable red | **1 failed** — case 2-unavailable, on the class assertion; the counts stayed green because both classes advance, which is exactly why the class assertion exists |
| F7 | second `CHAIN` entry id renamed (A7 breaks) | case 6 red | **1 failed** — **and only case 6.** The faux-session resolution assertions renamed themselves along with `CHAIN`, which proves the composed-registry case is the only non-tautological form of the A7 check |
| F8 | quota fixture's recorded `retryableToday` flipped | case 7 red | **1 failed** |
| F9 | `wrapFauxWithStatus` removed from hop 1 | case 5 red | **1 failed** — faux's hard-coded 200 reached the row instead of the 429 |
| F10 | `QUOTA_PATTERN` replaced with a dead token | quota red | **4 failed** — cases 2-quota, 3, 5, 8 |
| F11 | hop 1's faux never registered | case 1 red | **7 failed** — and the message named the culprit: `expected 'openai-completions' to be 'faux:…'`, i.e. Pi's **real** built-in `deepseek` entry had been resolved |
| F12 | (the repaired rotation case) cap raised above the record size | that case red | **1 failed** — on its own "the record must genuinely exceed the cap" guard |

Two mutation attempts initially produced *no* test failure because Git Bash's
MSYS path translation rewrote a leading `/` argument into `C:/Program Files/Git/…`
and broke the parse instead. Both were re-run with the leading slash removed;
the results above are from the valid runs. A falsification that fails to compile
proves nothing, and it looked identical to a falsification that "passed".

## Deviations from Plan

### 1. [Rule 3 — Blocking] A pre-existing test went red at midnight

`tests/unit/jsonl-rotation.test.ts`'s oversized-record case computed its live log
path as `logPath(cwd, TURNS_LOG_BASE)` — **without** the fixture clock — while
its appends wrote the file named after the fixture date, `2026-08-13`. The two
agreed only while that date happened to be today. The date rolled over during
this plan's execution and the case failed with an `ENOENT` on
`turns-2026-08-14.jsonl` that had nothing to do with rotation.

Fixed by passing `now`, as the file's other two cases already do (commit
`9bfb30c`), with the reason written in-file so it is not "tidied" back.
Pre-existing and unrelated to this plan; fixed rather than deferred because a red
suite blocks this plan's own verification gate. Falsified (F12).

### 2. [Deliberate] `classifyFailure` takes text, not a message

The plan's sketch classifies an `AssistantMessage`. A registry-facade rejection
has no message, and the plan *also* requires the `catch` to be live — so a
message-shaped signature would have forced a second classification rule for
rejections, which is precisely how the same outage advances down one path and
stops down the other. One function over the provider-controlled text serves both,
and Pi's predicate is handed a two-field probe because that is exactly what it
reads.

### 3. [Deliberate] The quota table is consulted before Pi's predicate

RESEARCH §Q4.5 gives quota the rule "the limit pattern matches", but that pattern
is **not exported** by pi-ai — only `isRetryableAssistantError` is, and it folds
quota into "not retryable" alongside fatal. So the ordering had to be decided
here: quota first, or the class disappears. Written up in both files as the one
place the harness deliberately disagrees with Pi, in one direction only.

### 4. [Rule 2] Three assertions beyond the plan's list

The SSO-strings-are-fatal case (threat T-03-10-02), the chokepoint turns-row case
(threat T-03-10-07, and the plan's own must-have "the chain calls the Phase 2
chokepoint"), and the per-hop provider-identity guard. The last one earns its
place loudest: F11 shows that without it a failed registration silently
exercises Pi's **real** built-in `deepseek` provider, and the file would have
been measuring the wrong thing entirely.

No Rule 1 bug was found in this plan's own code, no Rule 4 decision arose, and
nothing was installed.

## Autonomous decisions

Recorded rather than asked, per the Standing Operating Policy (the user is
asleep):

1. **PROV-08 is marked complete.** `[FAUX]` only, and 03-CONTEXT is explicit that
   PROV-05 and PROV-08 "are fully verifiable on this machine and must be planned
   as *passing*". Trap T12 governs PROV-03/04/07/10 and does not apply.
2. **`transient` is the catch-all for the retryable set.** A string Pi calls
   retryable that matches neither local table lands in `transient` rather than in
   a fifth "unknown" class. Both take the same action, so nothing behavioural
   turns on it, and inventing a class with no distinct action would be a name
   without a decision.

## [RUNBOOK] — for 03-11 to pick up (optional, not required by PROV-08)

No new runbook id is *required*: PROV-08 is `[FAUX]` and every input is
exercised offline. One optional fixture-fidelity entry is worth considering
alongside RB-03-01/02, and it must be recorded as **OUTSTANDING** if written:

- **Suggested check:** on the work laptop, capture the actual `errorMessage`
  DeepSeek-direct and DashScope produce for (a) an exhausted quota, (b) a rate
  limit and (c) a 5xx, and confirm each classifies as `quota` / `transient` /
  `unavailable` through `classifyFailure`.
- **Why:** every error string in this plan is a fixture this repository wrote.
  The *classification rule* is anchored on Pi's own exported predicate, so it
  cannot disagree with Pi — but whether a real DashScope arrears failure says
  `Arrearage` is unproven here and cannot be proven on this machine.
- **Offline proxy that already exists:** `tests/integration/fallback-chain.test.ts`
  cases 7 and 8.

## What this does NOT prove

Nothing here contacted a provider, and nothing here could: `fauxProvider` opens
no socket and this machine holds no credential for either vendor. Every error
string is a fixture. What *is* anchored outside this repository is the
retryable/fatal split, which is Pi's own predicate unmodified — so a string Pi
calls retryable is never called fatal here, today or after a Pi bump (case 7 is
the tripwire).

The chain is also **not routing**. It answers one question — "this attempt
failed; is another vendor worth trying?" — and nothing in it chooses which model
should have handled the request. That is Phase 5.

## Known Stubs

None. All three files are complete and every case executes.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/integration/fallback-chain.test.ts` | **13 passed** |
| `npm test` | 45 files, **618 passed** (baseline 605 + 13 new) |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no output |
| `npx vitest run tests/unit/{chokepoint-lint,extension-layout,contributing-boundary,call-model-containment}.test.ts` | 23 passed |
| `npx vitest run tests/integration/sso-classifier.test.ts` (03-08 regression) | 8 passed |
| `grep -cE 'modelRegistry\.complete\|\.completeSimple\|getRegisteredNativeProvider\|ModelRuntime\|@earendil-works/pi-ai/api/' .pi/extensions/providers/{schema,fallback}.ts` | 0 and 0 |
| `grep -ci 'qoder' .pi/extensions/providers/*.ts` | 0, 0, 0, 0 |
| `grep -c 'export default' .pi/extensions/providers/fallback.ts` | 0 |
| `grep -c 'callModel' .pi/extensions/providers/fallback.ts` | 2 |
| `git diff --stat HEAD -- .pi/extensions/diagnostics/` | empty — Phase 2's instrument untouched |
| network requests issued | none |

## Self-Check: PASSED

- `.pi/extensions/providers/schema.ts` — FOUND
- `.pi/extensions/providers/fallback.ts` — FOUND
- `tests/integration/fallback-chain.test.ts` — FOUND
- commit `9b09f2e` — FOUND
- commit `9e78583` — FOUND
- commit `9bfb30c` — FOUND
- commit `a23c0a6` — FOUND
