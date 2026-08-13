---
phase: 03-providers-credentials
plan: 04
subsystem: test-harness
tags: [wave-2, compat, model-metadata, PROV-03, PROV-06, trap-t6, trap-t9, canary]
requires:
  - "tests/helpers/models.ts — withModelsConfig, the offline composed registry (plan 03-01)"
  - ".pi/templates/models-template.json — the DashScope provider whose composed form is asserted (plan 03-02)"
  - "tests/unit/pinning.test.ts:95-102, 244-257 — the table-of-record + nothing-outside-the-table shape"
  - "tests/unit/version-gate.test.ts — the assert-against-the-installed-artifact, throw-never-skip posture"
provides:
  - "tests/unit/dashscope-compat.test.ts — INTENDED_COMPAT deep-equalled against the COMPOSED model.compat, an exact key-set case, a live misspelling fixture, a per-model reasoning===true case, and the detectCompat aliyuncs canary over the installed pi-ai adapter"
  - "tests/unit/model-metadata.test.ts — CONTEXT_WINDOW_OF_RECORD with both sides pinned, the general cross-provider collision loop, the cost-inequality case, COST_UNVERIFIED asserted in both directions, and the maxTokens/UNVERIFIED mark guard"
affects:
  - "03-11 (docs/RUNBOOK.md RB-03-05) — adds the 'every COST_UNVERIFIED id is named in the runbook' case to model-metadata.test.ts in the same commit that creates the entry"
  - "03-0x (dashscope-payload loopback test) — the compat this file pins is the compat that emission test observes on the wire"
  - "any future pi-ai bump — the canary is the thing that will speak first if detectCompat gains a DashScope branch"
tech-stack:
  added: []
  patterns:
    - "the templated model set discovered by DIFFERENCE against a registry composed over an empty `providers` object, so no literal id list can fall out of date"
    - "a negative assertion over an installed artifact paired with a positive control substring from the same code path"
    - "an inline typo fixture that proves the real assertion is live, kept out of the directory it would otherwise be installed from"
key-files:
  created:
    - tests/unit/dashscope-compat.test.ts
    - tests/unit/model-metadata.test.ts
  modified: []
decisions:
  - "The templated model set is computed as a set difference between a registry composed WITH the template and one composed over `{\"providers\":{}}`, rather than from a hardcoded id list or a re-parse of the template's bytes. Pi's registry carries 1,220 built-in models, so neither 'everything' nor 'the two ids I remember' is the right set; the difference is exactly what this repository contributes and it covers a third model added later automatically."
  - "The GENERAL cross-provider context-window loop is scoped to templated models, not to all 1,222 composed models. A blanket 'no two providers may share a context window for the same id' is false by design in Pi's own catalogue — Bedrock and Anthropic legitimately serve the same Claude ids at 200,000 — so a blanket form would have been red on arrival. PROV-06 is about what this repo writes."
  - "The canary's paired positive is `deepseek.com`, one of detectCompat's OWN base-URL substrings. Without it an empty or truncated read satisfies `not.toContain(\"aliyuncs\")` perfectly and the canary proves nothing."
  - "No assertion in model-metadata.test.ts depends on docs/RUNBOOK.md. The COST_UNVERIFIED ↔ RB-03-05 coupling is a one-sentence docstring forward reference to plan 03-11 and nothing more, so the wave boundary is green with no skipped, todo or knowingly-red case."
metrics:
  duration: ~20m
  tasks: 2
  files: 2
  completed: 2026-08-13
---

# Phase 3 Plan 04: Composed-Compat and Model-Metadata Invariants Summary

Two test files that assert what Pi **composes** from the shipped template rather
than what the template **says** — closing the one gap through which this phase
could have shipped a provider that parses, validates, composes and configures
nothing.

## What was built

### Task 1 — `tests/unit/dashscope-compat.test.ts` (commit `0d0f9ca`)

Ten cases over the `compat` object Pi actually built.

`PROVIDER_COMPAT` carries the seven provider-level fields with the generic
default and the emission site written beside each one, transcribed from RESEARCH
§Q2.2. `INTENDED_COMPAT` is that block plus each model's
`requiresReasoningContentOnAssistantMessages: true`, keyed by model id — the
table-of-record shape `pinning.test.ts:95-102` uses.

The load-bearing assertion is `expect(model.compat).toEqual(intended)` against a
model obtained through `withModelsConfig(...).requireModel(...)`. Nothing reads
the template's text for it. Alongside it:

- **Model coverage in both directions** — the set of models the template
  composes must equal the set `INTENDED_COMPAT` has entries for, so a third
  model cannot ship with its compat unasserted and a stale table entry cannot
  look like coverage it no longer provides.
- **Exact key set**, stated separately from the deep equality because the
  failure it catches is different: a key arriving from a layer this file does
  not model names itself in the message instead of appearing in a diff.
- **`reasoning === true` per model** (Trap T5), with the message spelling out
  that every compat assertion above it stays green and becomes inert when this
  flag is false.
- **The misspelling fixture**, inline and never under `.pi/templates/`
  [threat T-03-04-05]. It composes `supportsStoore: false` and asserts three
  things in order: Pi reported **no** models.json error (positive control — the
  typo really did validate), the misspelled key **did** reach the composed
  object, and `supportsStore` is absent from it. That is Trap T6 demonstrated
  rather than asserted, and it is what makes the deep-equality live.

**The `detectCompat` canary** reads
`node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js` — the
installed artifact, not a mirror — asserts `deepseek.com` is present (proving the
read reached the detection code) and `aliyuncs` is absent. Its failure message
says in full sentences that a future Pi which *adds* the branch means every field
in the explicit block was chosen against generic defaults that may no longer
apply, and that the remedy is to re-verify field by field — explicitly **not** to
delete the test. A missing file throws with `npm ci` and the reason a skip is
unacceptable.

The module docstring names `RB-03-01` as the live half and states that a green
run here may never be read as PROV-03 passing (Trap T12).

### Task 2 — `tests/unit/model-metadata.test.ts` (commit `9eddee1`)

Ten cases over the composed numbers.

`CONTEXT_WINDOW_OF_RECORD` pins **both sides** of the collision PROV-06 names:
`dashscope/deepseek-v4-flash` and `-pro` at the sourced `393216`, and Pi's
built-in `deepseek/deepseek-v4-*` at `1000000`, each with its citation. Asserting
only our own number would stay green if the figure it is supposed to differ from
moved underneath it — and a catalogue change is exactly the event that should
make somebody re-read this file. A third assertion in the same case states the
inequality directly.

The **general** form loops every templated id against every other provider
serving the same id, with the collision set asserted non-empty *before* it is
judged: if nothing collides, the most likely reason is that somebody renamed the
DashScope ids to make the problem go away, which dodges the test rather than the
bug.

The **cost-inequality** case has its own positive control — the built-in cost
table's values must sum above zero — because two all-zero blocks would otherwise
satisfy "not equal" by both being equal to nothing.

`COST_UNVERIFIED` is asserted in both directions: everything listed really does
compose an all-zero cost (so an entry that quietly gained a real price stops
being listed as having none), and every all-zero templated model is on the list
(so a new placeholder cannot ship silently). Both messages say what an all-zero
cost does downstream — it renders as "free".

`maxTokens` is pinned at the conservative `65536` with the built-in `384000`
asserted as the contrast that makes it visibly a choice, and the template file is
asserted to still contain the words `UNVERIFIED` and `RB-03-05` — the one place
this file reads the template as a document rather than as configuration, and it
is about the mark, not the value.

## Falsification runs (executed, not assumed)

Per the standing "be suspicious of green" rule, every claim was broken and the
file re-run. All mutations were reverted; `git diff --stat` over the template is
empty.

| Mutation | Expected | Observed |
|---|---|---|
| template `thinkingFormat` → `"deepseek"` | compat deep-equality red | **2 failed** (both models) |
| template `reasoning: true` removed | the Trap T5 case red | **1 failed** |
| `ADAPTER` pointed at `anthropic-messages.js` | the canary's paired positive red | **1 failed** |
| `ADAPTER` pointed at a nonexistent file | throw with the remedy | **1 failed**, message carries `npm ci` |
| fixture spelling corrected to `supportsStore` | the misspelling case red | **1 failed** |
| template `contextWindow` → `1000000` | both named cases + the general loop red | **3 failed** |
| template `cost` → the DeepSeek-direct table | cost inequality + allowlist direction 1 red | **2 failed** |
| the word `UNVERIFIED` deleted from the template | the mark case red | **1 failed** |
| `RB-03-05` deleted from the template | the mark case red | **1 failed** |
| an id dropped from `COST_UNVERIFIED` | allowlist direction 2 red | **1 failed** |
| template `maxTokens` → `384000` | the output-cap case red | **1 failed** |

One falsification **failed to fail** and is recorded rather than hidden:
`sed 's/UNVERIFIED/UNVERIFIEDX/g'` left the mark case green, because the
assertion is `toContain`. The failure mode the case exists for is the word being
**deleted** (falsified above, red); a mangled-into-a-longer-word variant is not
detected. Recorded here rather than over-engineered — a `\bUNVERIFIED\b` regex
would fail on the legitimate `UNVERIFIED —` and `UNVERIFIED;` forms already in
the file for no gain against a failure mode nobody has.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] `getModels()` returns `readonly Model<Api>[]`**

- **Found during:** Task 2 `npm run typecheck`.
- **Issue:** the snapshot helper declared `all: Model<Api>[]`; `tsc` rejected the
  assignment from Pi's readonly array.
- **Fix:** the snapshot type and the module-level binding are `readonly
  Model<Api>[]`. No assertion changed.
- **Files modified:** `tests/unit/model-metadata.test.ts`
- **Commit:** `9eddee1`

### Autonomous decisions (recorded, not asked — the user is asleep)

**2. The general cross-provider loop is scoped to templated models.** The task
text says "for every `(provider, modelId)` pair in it". Read as *every pair in
the composed registry*, the invariant is false by design: Pi's catalogue has
Bedrock and Anthropic serving identical Claude ids at 200,000, and the case would
have been red on arrival with nothing wrong. PROV-06 is stated as "a model must
not inherit a context window from a different provider's entry for the same
model" — an obligation on what this repository writes — so the loop enumerates
templated models and compares each against every other provider serving that id.
The named cases carry the specific collision either way.

**3. The templated model set is a set difference, not a literal.** Neither the
task nor the pattern map prescribes the enumeration. A hardcoded two-id list
would stop covering a third model added later — which is precisely what the
"every all-zero-cost templated model is on the list" case is for — and re-parsing
the template's bytes to enumerate would put the file's text back in the loop that
Trap T6 says cannot be trusted. Composing a second registry over
`{"providers":{}}` and subtracting gives exactly what the template contributes,
with no literal to go stale.

**4. The difference helper is duplicated across the two files rather than added
to `tests/helpers/models.ts`.** The plan's `files_modified` is the two test
files, and a helper in `tests/helpers/` carries a standing obligation to be
covered in `tests/unit/helpers.test.ts`. Fifteen duplicated lines are the cheaper
price; the reason is written into both docstrings.

No Rule 4 (architectural) decision arose. No package was installed — this plan is
two test files.

## Requirements status

**No PROV requirement is marked complete by this plan.** PROV-03 and PROV-06 are
advanced, not discharged: PROV-03 carries an OUTSTANDING live half (`RB-03-01` —
whether DashScope accepts the body this compat block produces) that no offline
green may satisfy (Trap T12), and the unverified figures PROV-06 guards are
measured by `RB-03-05`, which plan 03-11 creates.

**No network request left this machine.** `withModelsConfig` constructs
`ModelRuntime` with `refreshOnCreate: false`, and the only file read outside a
temp directory is the installed `pi-ai` adapter and the tracked template.

## What this does NOT prove

That DashScope accepts `enable_thinking`, `max_tokens`, or the absence of
`store` / `developer` / `strict` / `prompt_cache_*` — `RB-03-01` and `RB-03-02`,
both OUTSTANDING. That `65536` is the real output cap or that these models are
free — `RB-03-05`, OUTSTANDING. Every one of those is a claim about a provider
that has never been contacted from this machine.

## Known Stubs

None. Both files are complete and every case is live, proven by the falsification
table above. The one deliberate omission — the "every `COST_UNVERIFIED` id is
named in `docs/RUNBOOK.md`" case — is a docstring forward reference to plan 03-11
with no assertion attached, precisely so that no wave boundary in an unattended
run is red.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/unit/dashscope-compat.test.ts` | **10 passed** |
| `npx vitest run tests/unit/model-metadata.test.ts` | **10 passed** |
| `npm run test:unit` | 29 files, **496 passed** (was 476) |
| `npm test` | 38 files, **556 passed** (baseline 536) |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no output |
| `git diff --stat .pi/templates/models-template.json` after all falsifications | empty — every mutation reverted |
| `package.json` `devDependencies` | unchanged — the same six audited pins |
| Skips / `todo` / known-red cases in either file | **0** |

## Self-Check: PASSED

- `tests/unit/dashscope-compat.test.ts` — FOUND
- `tests/unit/model-metadata.test.ts` — FOUND
- commit `0d0f9ca` — FOUND
- commit `9eddee1` — FOUND
