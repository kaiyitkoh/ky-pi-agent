---
phase: 03-providers-credentials
plan: 01
subsystem: test-harness
tags: [wave-0, test-helpers, faux-provider, model-registry, providers]
requires:
  - "tests/helpers/faux.ts — wrapFauxWithPayload (Phase 2, plan 02-01)"
  - "tests/helpers/session.ts — the ModelRuntime.create construction copied here (Phase 2, plan 02-01)"
provides:
  - "tests/helpers/faux.ts — wrapFauxWithStatus(faux | provider, status): a faux provider that reports any HTTP status, exactly once per call"
  - "tests/helpers/models.ts — withModelsConfig(opts, fn): an offline ModelRuntime + ModelRegistry over an arbitrary models.json / auth.json, with requireModel and scoped env"
affects:
  - "03-02 (dashscope compat, model metadata, R1 unclamp) — every composed-model assertion runs through withModelsConfig"
  - "03-03 (templates + installer, bedrock auth) — getProviderAuth interpolation and precedence tests"
  - "03-04+ (fallback chain, PROV-08) — the three error classes are HTTP statuses and need wrapFauxWithStatus"
tech-stack:
  added: []
  patterns:
    - "provider decorator that SUBSTITUTES a callback in a copy of the options bag rather than pre-calling it"
    - "offline ModelRegistry over a caller-supplied models.json (refreshOnCreate: false, temp authPath, config copied into the temp agent dir)"
    - "scoped process.env with delete-on-restore for keys that did not previously exist"
    - "throw-with-remedy instead of returning undefined from a test-helper lookup"
key-files:
  created:
    - tests/helpers/models.ts
  modified:
    - tests/helpers/faux.ts
    - tests/unit/helpers.test.ts
decisions:
  - "RESEARCH Open Question 4 closed: wrapFauxWithStatus SUBSTITUTES onResponse in a copy of the options bag, it does not pre-call it — a pre-call leaves faux's hard-coded 200 firing afterwards, writing two main.response wire records under one correlation id and a /budget row count that lies. Falsified: converting it back to a pre-call turns two cases red with [503, 200]."
  - "wrapFauxWithStatus accepts a FauxProviderHandle OR an already-wrapped Provider, so the two wrappers compose; no existing export's signature changed."
  - "withModelsConfig COPIES the models config into its temp agent dir even when handed a template path — Pi defaults the models store to dirname(modelsPath)/models-store.json, so a modelsPath aimed at .pi/templates/ would aim a writer at this repository."
  - "The helper does NOT try to clear Pi's process-lifetime !command cache: clearApiKeyCache is re-exported from core/model-registry.ts but not from the package root, so there is no supported import path. Documented as a caller obligation instead — PROV-02's cached-vs-uncached proof must do both resolutions inside one callback."
  - "$ENV_VAR values are resolved LAZILY at getProviderAuth() time, not at composition time (falsified: swapping applyEnv below ModelRuntime.create left the test green). The assertion message was rewritten to claim only what it proves."
metrics:
  duration: ~35m
  tasks: 3
  files: 3
  completed: 2026-08-13
requirements-completed: [PROV-01, PROV-08]
---

# Phase 3 Plan 01: Wave 0 Provider Test Seams Summary

Two test seams without which this phase's tests ship vacuously green: a faux
provider that can report a 429 or a 503 exactly once, and a fully offline Pi
model registry composed from an arbitrary `models.json` with no network, no
credentials and no contact with the developer's agent directory.

## What was built

### Task 1 — `wrapFauxWithStatus` (commit `b4f2f86`, `tests/helpers/faux.ts`)

`fauxProvider` runs
`await streamOptions?.onResponse?.({ status: 200, headers: {} }, requestModel)`
unconditionally as the first thing in its microtask
[VERIFIED: `pi-ai 0.84.1 src/providers/faux.ts:510`]. There is no path through
faux to any other status, so PROV-08's three error classes — quota (429),
transient, unavailable (503) — are one indistinguishable green 200 without a
wrapper.

`wrapFauxWithStatus(faux, status)` returns a spread copy of the inner provider
whose `stream` and `streamSimple` each hand the inner provider a **shallow copy
of the options bag with `onResponse` substituted**. Faux's hard-coded call then
invokes the substitute, which forwards `{ status, headers: {} }` to the caller's
original callback. The 200 is therefore *rewritten*, not duplicated.

**RESEARCH Open Question 4 is closed in the docstring, with the reasoning
written out** in the style of `wrapFauxWithPayload`'s `:281-284` comment: the
alternative (pre-calling `onResponse` before delegating, the shape RESEARCH
sketched) leaves faux's own 200 firing afterwards, so the caller sees
`[503, 200]`, Phase 2's wire log gets two `main.response` records under one
correlation id, and `/budget` counts a row that never happened
[threat T-03-01-04].

The caller's bag is copied, never mutated — a wrapper that wrote `onResponse`
back onto the caller's object would leave the substitute installed after the
wrapper went out of scope. The parameter accepts a `FauxProviderHandle` **or** an
already-wrapped `Provider`, which is what lets the two wrappers compose:
`wrapFauxWithStatus(wrapFauxWithPayload(faux), 503)`.

### Task 2 — `withModelsConfig` (commit `36904bf`, `tests/helpers/models.ts`)

An async disposable handing a callback `{ modelRuntime, registry, agentDir,
modelsPath, authPath, requireModel }`.

Three construction rules, each load-bearing:

- `refreshOnCreate: false` — the refresh runs only when
  `options.refreshOnCreate !== false` [VERIFIED: `pi 0.84.1
  src/core/model-runtime.ts:210`], so this is the single option that makes the
  helper offline.
- `authPath` always inside the helper's own `mkdtempSync` dir. Omitting it
  resolves the credential store to `getAgentDir()/auth.json`, i.e. the
  developer's real credentials [VERIFIED: `model-runtime.ts:173`].
  [threat T-03-01-01]
- The models config is **copied** into the temp agent dir, even when the caller
  passes a template path, because the models store defaults to
  `join(dirname(modelsPath), "models-store.json")` [VERIFIED:
  `model-runtime.ts:179-180`] — pointing `modelsPath` at
  `.pi/templates/models-template.json` would aim a writer at this repository.
  [threat T-03-01-02]

`requireModel(providerId, modelId)` **throws**, never returns `undefined`. The
message carries both ids, the full list of models Pi actually composed, the
`models.json` error if there was one, and the note that typebox accepts an
unknown key in silence so a misspelled `providers` entry produces exactly this
failure with no parse error to point at. That is Assumption A7's renamed-id
hazard closed at the seam rather than at every call site.

`env` is applied to `process.env` and restored in the `finally`. A key that did
not exist beforehand is **deleted**, never set to `""` — Bedrock's chain is
`credential.env.AWS_PROFILE ?? ambient AWS_PROFILE` [VERIFIED: `pi-ai 0.84.1
src/providers/amazon-bedrock.ts:52-77`], and an empty string satisfies `??`
while naming no profile. [threat T-03-01-03]

The docstring also states what the helper **cannot** isolate: Pi caches
`!command` config values in a module-level map for the process lifetime, and
`clearApiKeyCache` is re-exported from `core/model-registry.ts` but not from the
package root (`dist/index.d.ts` exports `ModelRegistry` only), so there is no
supported import path to it. Two caller obligations follow and are written down:
PROV-02's cached-vs-uncached proof must do both resolutions inside one callback,
and two tests needing different answers from one command string cannot both be
honest.

### Task 3 — live cases for both seams (commit `71b6c90`, `tests/unit/helpers.test.ts`)

Eight new cases; the file went from 20 to 28 tests.

`wrapFauxWithStatus` (4 cases): a **live-oracle control** first — an unwrapped
payload-wrapped faux call reports exactly `[200]`, so the 503 below it came from
the wrapper and not from a recorder that says 503 to everything; then invocation
count **exactly 1** (the assertion that distinguishes substitution from a
pre-call, with that spelled out in the failure message); status 503 not 200; the
assistant text still intact; and composition over `wrapFauxWithPayload` with the
payload array asserted non-empty **before** anything about its contents.

`withModelsConfig` (4 cases): the composed model carries the declared
`contextWindow: 393216` and `compat.thinkingFormat: "qwen"`, **plus an
undeclared `maxTokens`** — the positive control proving the object is Pi's
composition rather than the parsed template, since only Pi can have supplied it;
`requireModel` throws for an unknown model id with both ids in the message;
`env` is visible inside the callback and a previously-absent key is absent again
afterwards via `Object.hasOwn` (paired with a pre-existing key asserted restored
to its original value, and with the absence of the key asserted *before* the
callback so the whole case is not satisfied by a helper that never set it); and
the temp `agentDir` is gone afterwards, paired with `existsSync` assertions
inside.

## Falsification runs (executed, not assumed)

Per the standing "be suspicious of green" rule, each new seam was broken and the
suite re-run:

| Mutation | Expected | Observed |
|---|---|---|
| `wrapFauxWithStatus` converted to a pre-call (delegate with the original bag) | the exactly-once case goes red | **2 failed** — `onResponse fired 2 time(s) for ONE request`, and the composition case saw `[429, 200]` |
| `requireModel`'s `if (!model)` guard disabled | the throw case goes red | **1 failed** — `requireModel returned instead of throwing` |
| env restoration changed from `delete` to `= ""` | the deletion case goes red | **1 failed** — `Object.hasOwn` true afterwards |
| `applyEnv` moved *below* `ModelRuntime.create` | expected red | **STAYED GREEN** — see the deviation below |

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] An assertion message claimed more than the assertion proved**

- **Found during:** Task 3 falsification.
- **Issue:** the `getProviderAuth` case's message said `undefined` "means env was
  applied after `ModelRuntime.create`". Moving `applyEnv` below `create` left the
  test green, because `$ENV_VAR` values are resolved lazily at
  `getProviderAuth()` time, not at composition time. Under this repo's rule that
  assertion messages *are* the documentation, a message that names a failure
  mode it cannot detect is a defect.
- **Fix:** the message now claims only what it proves — that the seam reaches
  Pi's config-value resolution at all, which is the PROV-01 round trip. The
  measured laziness is recorded as a `[VERIFIED: executed 2026-08-13]` comment in
  `tests/helpers/models.ts` beside the ordering, together with why the ordering
  is kept anyway (nothing in the file should depend on the laziness holding).
- **Files modified:** `tests/helpers/models.ts`, `tests/unit/helpers.test.ts`.
- **Commit:** folded into `36904bf` / `71b6c90`.

### Deliberate widenings of the plan's letter (both stated in the plan's spirit)

**2. `wrapFauxWithStatus` accepts `FauxProviderHandle | Provider`.** RESEARCH's
sketch takes a handle only, but the plan requires that "the two wrappers must
compose" and that a status wrapper applied *over* a payload-wrapped provider keep
`onPayload` intact. A handle-only signature makes that impossible to express. The
union is additive; no existing export's signature changed.

**3. `withModelsConfig` copies a template path instead of loading it in place.**
The plan says `models` may be "an absolute path to a models config file". It is
copied rather than passed through, because Pi's models store defaults to
`dirname(modelsPath)` and would write next to the tracked template. `modelsPath`
on the handle therefore always points inside the temp agent dir, and a test
asserts that.

## Requirements status

**No PROV requirement is marked complete by this plan.** It ships test
apparatus, not requirement code. PROV-01, PROV-03, PROV-04, PROV-06, PROV-07 and
PROV-08 are named in the plan frontmatter as the requirements these seams
*serve*; each is discharged by a later plan in this phase, and PROV-03/04/07 also
carry an OUTSTANDING `RB-03-xx` live half that no offline green may satisfy
(Trap T12). Nothing here touches a provider host; no network request was issued
by any part of this work.

## Verification

| Check | Result |
|---|---|
| `npm test` | **522 passed / 35 files** (baseline 514 + 8 new) |
| `npm run test:unit` | 462 passed / 26 files |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no output |
| `git diff --stat` over the three task commits | exactly `tests/helpers/faux.ts`, `tests/helpers/models.ts`, `tests/unit/helpers.test.ts` |
| `package.json` `devDependencies` | unchanged — the same six audited pins |
| `grep -c 'onResponse' tests/helpers/faux.ts` | 14 (≥ 4 required; the substitution appears inside both overrides) |
| `grep -c '^import' tests/helpers/faux.ts` | 1 — unchanged; no import statement was added |
| `grep -ci skip tests/helpers/models.ts` | 0 |
| `refreshOnCreate: false` present in `tests/helpers/models.ts` | yes |

## Known Stubs

None. Both seams are complete and exercised; nothing is placeholdered.

## Self-Check: PASSED

- `tests/helpers/faux.ts` — FOUND
- `tests/helpers/models.ts` — FOUND
- `tests/unit/helpers.test.ts` — FOUND
- commit `b4f2f86` — FOUND
- commit `36904bf` — FOUND
- commit `71b6c90` — FOUND
