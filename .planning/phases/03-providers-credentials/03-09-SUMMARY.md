---
phase: 03-providers-credentials
plan: 09
subsystem: providers-wire-proof
tags: [wave-3, loopback, openai-completions, compat, PROV-03, PROV-10, RUNBOOK]
requires:
  - "tests/helpers/loopback.ts — withLoopbackCompletions / assertLoopbackUrl, the 127.0.0.1 capture server (plan 03-03)"
  - "tests/helpers/models.ts — withModelsConfig, an offline ModelRuntime over an arbitrary models config (plan 03-01)"
  - ".pi/templates/models-template.json — the shipped DashScope provider block, the object under test (plan 03-02)"
  - "tests/unit/dashscope-compat.test.ts — the composed-compat deep equality and the detectCompat canary this file builds on (plan 03-04)"
provides:
  - "tests/integration/dashscope-payload.test.ts — the wire-level proof of every Q2.2 compat claim, offline: 8 cases over 5 captured request bodies built by Pi's real openai-completions adapter"
  - "the paired-positive discipline for absence assertions at wire level — a detection-defaults control body that emits every field the shipped block suppresses"
  - "the Q7 finding as a machine-checked assertion rather than a note: Pi already emits \"strict\": false on every function whenever supportsStrictMode is left to detection"
affects:
  - "03-11 (runbook entries + docs-policy) — this file is the offline proxy RB-03-02 names and now exists on disk; RB-03-01 and RB-03-02 stay OUTSTANDING"
  - "Phase 8/10 (quality gates) — inherits the Q7 strict-mode finding as an executed fact, not as an UNVERIFIED line in PITFALLS"
tech-stack:
  added: []
  patterns:
    - "drive Pi's REAL adapter, not a fixture: ModelRegistry.complete() over a models config whose baseUrl points at a loopback node:http server"
    - "the fixture is the SHIPPED template with exactly two keys overridden, and a case asserts that the set of differing keys is exactly {baseUrl, apiKey}"
    - "every absence assertion is paired with a presence assertion on the SAME body, and with a control body where the suppressing compat field is deleted"
    - "the vacuity guard is a function (wireBody) that every case calls as its first statement, so no content assertion can run against an empty capture"
    - "assertLoopbackUrl over the COMPOSED model.baseUrl — the string the adapter dials — before any request is issued"
decisions:
  - "The five absence assertions get ONE shared control capture (all five suppressing compat fields deleted at once) rather than five separate ones. Same falsifying power, one extra server + registry + completion instead of five, and the control body is readable as a single before/after."
  - "REQUEST_OPTIONS sets cacheRetention: \"long\" AND sessionId. Without both, the prompt_cache_* absence would hold with supportsLongCacheRetention deleted — the emission is gated on the caller asking for long retention (openai-completions.ts:699-704), so a test that never asks proves nothing. Verified by the control: with the field deleted the same options produce prompt_cache_key and prompt_cache_retention: \"24h\"."
  - "The Q7 finding is asserted in BOTH directions, not just the shipped one the plan required. The plan asked for the detection default to be stated in the case's message; a control body that actually carries \"strict\": false makes it an executed fact and simultaneously falsifies the shipped absence. It also turns a future pi-ai change to strict handling into a red test rather than a stale comment."
  - "The tool's parameters use typebox's Type.Object rather than a cast plain object. typebox is already one of the six audited devDependency pins (pinning.test.ts), so this adds no supply-chain surface and keeps Tool<TSchema> honestly typed."
  - "`aliyuncs` appears ZERO times in the file, not merely outside the docstring. The acceptance criterion allowed it in the docstring; zero is strictly safer and the docstring says everything it needs to by naming DashScope, RB-03-01 and RB-03-02."
  - "PROV-03 and PROV-10 are NOT marked complete. Both carry an OUTSTANDING live half (RB-03-01 / RB-03-02) and Trap T12 forbids reporting a [RUNBOOK] requirement as passing on the strength of a green offline half. This plan is the strongest offline evidence either will ever get and it is still not the requirement."
metrics:
  duration: ~40m
  tasks: 2
  files: 1
  completed: 2026-08-13
---

# Phase 3 Plan 09: The Wire-Level Compat Proof Summary

Every claim in the Q2.2 compat table is now an assertion against bytes Pi's real
`openai-completions` adapter built — with no credential, no egress, and a control
body proving each absence is caused by the shipped template rather than by the
harness.

## What was built

`tests/integration/dashscope-payload.test.ts` — one file, 8 cases, 5 captured
request bodies. Each capture stands a `node:http` server on `127.0.0.1`
(`withLoopbackCompletions`), reads `.pi/templates/models-template.json`, strips
its whole-line `//` comments, overrides **only** `providers.dashscope.baseUrl`
(to the loopback handle) and `apiKey` (to `kypi-synthetic-fixture-key-not-a-credential`),
composes it through `withModelsConfig`, and calls `registry.complete()` — Pi's
real path through `ModelRuntime.prepareRequest` into the `openai-completions`
adapter.

### Task 1 — the request-shape proof (commit `80f31de`)

| Case | What it asserts |
|---|---|
| 0 | Exactly one request was captured; it went to `127.0.0.1`; it was `POST /v1/chat/completions`; the body names `deepseek-v4-flash` |
| 1 | The fixture is the shipped template — `compat` deep-equals the template's, the per-model compat blocks deep-equal, and the set of differing provider keys is exactly `["apiKey", "baseUrl"]` |
| 2 | **Presence and absence on the same body.** Present: `enable_thinking: true`, top-level `reasoning_effort: "high"` (and no nested `thinking` object), `max_tokens: 1234` (and no `max_completion_tokens`), a `system` message, one tool named `read_file`. Absent: `store`, any `developer`-role message, `strict` on any function, `prompt_cache_key`, `prompt_cache_retention` |
| 3 | **The detection-defaults control.** Same template, same context, same options, with `supportsStore` / `supportsDeveloperRole` / `maxTokensField` / `supportsStrictMode` / `supportsLongCacheRetention` deleted — and the body carries `store: false`, a `developer` message, `max_completion_tokens` (and *not* `max_tokens`), `prompt_cache_key`, `prompt_cache_retention: "24h"` |
| 4 | **Q7 as an assertion.** No function in the shipped body carries a `strict` key at all; every function in the control body carries `"strict": false` |

Case 3 is what makes case 2 mean anything. Without it, an emission path that
simply never produced `store` — because of the loopback URL, because of the
fixture context, because nobody set an option — would satisfy every absence in
case 2 perfectly.

`REQUEST_OPTIONS` is chosen so no assertion can be satisfied by silence:
`reasoningEffort: "high"` (without it `enable_thinking` is `false` and
`reasoning_effort` is never emitted), `maxTokens: 1234` (Pi emits a cap **only**
when the caller sets one, and 1234 is deliberately not the template's own
`maxTokens: 65536`), and `cacheRetention: "long"` **with** a `sessionId` — the
pair that makes the `prompt_cache_*` absence attributable to the compat field.

### Task 2 — the PROV-10 mechanism (commit `084b4f6`)

A two-turn context built by hand: a user message, an assistant message carrying
one tool call, and the corresponding tool result. Three more captures.

| Case | What it asserts |
|---|---|
| 5 | The emitted assistant entry carries `tool_calls` (length 1) **and** a `reasoning_content` key, whose value is `""` |
| 6 | **Control 1** — with `requiresReasoningContentOnAssistantMessages` removed from the model's compat, the same body's assistant entry still carries its `tool_calls` and the `reasoning_content` key is **gone** |
| 7 | **Control 2, Trap T5** — with `reasoning: false` on the model entry and the compat field left in place, the key is **gone**; and so are `enable_thinking` and `reasoning_effort`, the other half of the same gate |

The fixture is structurally incapable of supplying the key it asserts: pi-ai's
`AssistantMessage` (`dist/types.d.ts:295-310`) has no `reasoning_content` field.
The controls prove that claim rather than resting on it.

## Falsification — every case, mutation run, failure observed, restored

The house rule from Phase 2's code review. Twelve runs. Nine mutate the **shipped
template** (the real subject); three mutate the test's own fixtures to prove the
controls and the vacuity guard are live. All were reverted and the file is
byte-identical to the committed one (`diff -q` confirmed).

| # | Mutation | Cases turned red | Failure observed |
|---|---|---|---|
| F1 | remove `"thinkingFormat": "qwen"` from the template | 2 | *"the body carries no top-level `enable_thinking` … detection's default is \"openai\", the qwen branch never runs"* |
| F2 | remove `"maxTokensField": "max_tokens"` | 2 | *"the token cap must ride as `max_tokens`" — expected undefined to be 1234* |
| F3 | remove `"supportsStrictMode": false` | 2, 4 | *"tools[0].function carries a `strict` key"* |
| F4 | remove `"supportsLongCacheRetention": false` | 2 | *"the body carries `prompt_cache_key`"* |
| F5 | remove `"supportsDeveloperRole": false` | 2 | *"the system prompt must ride as a `system` message" — expected `['developer','user']` to include `'system'`* |
| F6 | remove `"supportsStore": false` | 2 | *"the body carries a `store` key"* |
| F7 | replace the models' `"compat": { "requiresReasoningContentOnAssistantMessages": true }` with `{}` | 5 | *"the replayed assistant message carrying tool_calls has NO `reasoning_content` key. That is exactly the second-turn 400"* |
| F8 | `"reasoning": true` → `false` on both templated models (Trap T5) | 2, 3, 5 | three failures at once — thinking disabled **and** the PROV-10 key gone, exactly as the trap describes |
| F9 | `requestCount: loop.requests.length` → `0` in the test's capture | 0, 2, 3, 4, 5, 6, 7 | seven cases red on the vacuity guard: *"the loopback server recorded 0 requests … every assertion in this case would pass over nothing"*. Case 1 stayed green correctly — it asserts the derived config, not a body |
| F10 | neuter the detection-defaults control's `delete compat.supportsStore` | 3 | *"with `supportsStore` left to detection, Pi should emit `store: false`. It did not"* |
| F11 | neuter control 1's `delete …requiresReasoningContentOnAssistantMessages` | 6 | *"`reasoning_content` is present even with … REMOVED"* |
| F12 | control 2's `model.reasoning = false` → `= true` | 7 | *"`reasoning_content` survived `reasoning: false`, which contradicts the `&& model.reasoning` gate"* |

Two more, run for the egress and derivation guards:

- Pointing the fixture's `baseUrl` at `http://not-loopback.invalid/v1` made
  `assertLoopbackUrl` throw out of `beforeAll` — **8 cases skipped, file failed**,
  before any socket was opened. The `.invalid` TLD has no DNS by RFC 2606; nothing
  left the machine.
- Adding one extra override (`provider.name = "hand-written copy"`) turned case 1
  red: *expected `['apiKey','baseUrl','name']` to deeply equal `['apiKey','baseUrl']`*.

## Deviations from Plan

### 1. [Rule 2 — missing critical falsifiability] The detection-defaults control capture

- **Found during:** Task 1.
- **Issue:** The plan required presence and absence in the same case (which the
  file does), but nothing in it would have failed if the *loopback path itself*
  never emitted `store`, `developer`, `strict` or `prompt_cache_*` for some
  reason unrelated to the compat block. A body that never carries a field
  satisfies "this field is absent" forever.
- **Fix:** Added a sixth-of-a-second control capture (`detectionDefaults`) with
  the five suppressing compat fields deleted, and case 3 asserting every one of
  them appears. This is the paired positive the analog's `:276-288` pattern
  demands, applied at the level of the compat block rather than of one field.
- **Consequence:** the Q7 case (case 4) became a two-directional assertion for
  free, which the plan asked for only as prose in a failure message.

### 2. [Rule 2] `cacheRetention: "long"` + `sessionId` on every capture

- **Found during:** Task 1, while reading `buildParams` at
  `openai-completions.ts:699-704`.
- **Issue:** `prompt_cache_key` / `prompt_cache_retention` are emitted only when
  `cacheRetention === "long" && compat.supportsLongCacheRetention`, and
  `prompt_cache_key` is `clampOpenAIPromptCacheKey(options?.sessionId)` which
  returns `undefined` for an unset `sessionId`. A capture that asked for neither
  would show the fields absent *whatever* the compat block said — a textbook
  vacuous absence assertion.
- **Fix:** both options are set on every capture, and F4 + case 3 confirm the
  absence flips to presence when only the compat field changes.

### 3. [Rule 3] Two commits from one file

- The plan's two tasks both name the same single file. Rather than collapse them
  into one commit, the file was committed in its Task 1 state first (5 cases, run
  green, `tsc` clean) and extended to its Task 2 state second (8 cases). Both
  intermediate states are genuine, verified deliverables.

No architectural changes. No package installed — the server is `node:http` inside
the existing helper, and `typebox` was already one of the six audited pins.

## Verification

- `npx vitest run tests/integration/dashscope-payload.test.ts` — **8 passed**
- `npm test` — **605 tests / 44 files passed** (baseline before this plan: 597 / 43)
- `npx tsc --noEmit` — exit 0
- `grep -c 'aliyuncs' tests/integration/dashscope-payload.test.ts` — **0**
- No request in the suite leaves `127.0.0.1`: the helper refuses a non-loopback
  host before handing out a `baseUrl`, and `captureOne` re-checks the composed
  `model.baseUrl` before every completion. Both were exercised.

## [RUNBOOK] — for plan 03-11 to pick up

Nothing here is new work; it is the record that this plan's green half does **not**
discharge either live check.

- **`RB-03-01` (PROV-03) — OUTSTANDING.** This file proves the emitted body
  carries `enable_thinking`, a top-level `reasoning_effort`, `max_tokens`, and no
  `store` / `developer` role / `strict` / `prompt_cache_*`. It says nothing about
  whether the provider **accepts** that body. One ordinary turn on the work laptop
  returning 200, with the `main.request` wire record showing this same field set,
  is the entry.
- **`RB-03-02` (PROV-10) — OUTSTANDING.** `tests/integration/dashscope-payload.test.ts`
  is the offline proxy the RESEARCH skeleton names, and it now exists on disk (the
  `docs-policy` parser requires every referenced test path to exist). It proves Pi
  inserts `reasoning_content: ""` on the replayed assistant message. The provider's
  **200 on the second turn** is the entry and cannot be substituted.
- **Q7 / strict mode — a finding to carry, not a runbook entry.** Pi already sends
  `"strict": false` on every function definition to any provider that leaves
  `supportsStrictMode` to detection, including DeepSeek-direct. Turning strict *on*
  is a tool-authoring change (`constrainedSampling: { type: "json_schema" }` on the
  tool), not a `compat` or model-entry switch. Phase 8/10 starts from that fact.
  It is now asserted in both directions by case 4, so a pi-ai change to strict
  handling turns a test red rather than leaving a stale note.

## Requirements

Neither requirement is marked complete, deliberately (Trap T12).

| Req | State | Why |
|---|---|---|
| PROV-03 | offline half COMPLETE, live half OUTSTANDING (`RB-03-01`) | the composed block (03-04) and the emitted body (this plan) are both proven; provider acceptance is not |
| PROV-10 | offline half COMPLETE, live half OUTSTANDING (`RB-03-02`) | the exact mechanism is proven with two controls; the second turn's 200 is not |

## Known Stubs

None.

## Self-Check: PASSED

- `tests/integration/dashscope-payload.test.ts` — FOUND
- `.planning/phases/03-providers-credentials/03-09-SUMMARY.md` — FOUND
- commit `80f31de` (Task 1) — FOUND
- commit `084b4f6` (Task 2) — FOUND
