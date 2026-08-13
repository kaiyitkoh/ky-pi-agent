---
phase: 03-providers-credentials
plan: 05
subsystem: credential-and-thinking-tier-proofs
tags: [wave-2, bedrock, aws-profile, r1, thinking-levels, PROV-04, PROV-07, RUNBOOK]
requires:
  - "tests/helpers/models.ts — withModelsConfig(), the offline registry with scoped env (plan 03-01)"
  - "tests/helpers/git.ts — repoRoot() (Phase 1)"
  - ".pi/templates/auth-template.json — the artifact case 1 resolves (plan 03-02)"
provides:
  - "tests/unit/bedrock-auth.test.ts — the credential.env.AWS_PROFILE path proven offline in both directions, with Trap T8 executable"
  - "tests/unit/r1-unclamp.test.ts — the modelOverrides unclamp proven to make reasoning_effort low selectable, and the merge proven to be a merge"
affects:
  - "docs/RUNBOOK.md RB-03-03 — this is its named offline proxy; the live SSO half stays OUTSTANDING"
  - "docs/RUNBOOK.md RB-03-04 — step 2's 'if the picker does not offer low, stop' now has a known-good counterpart"
  - "03-11 (runbook entries + docs-policy) — both files are cite-able proxy paths that exist on disk"
tech-stack:
  added: []
  patterns:
    - "blank the WHOLE ambient chain, not just the variable under test — Pi's auth context treats an empty/whitespace value as absent, so blanking is how a test says 'this machine does not have this set' without reading what it does have"
    - "a negative control paired with a positive that uses the identical construction, so 'absent' is proven to mean absent rather than broken"
    - "assert against a baseline composed by the same helper rather than a retyped expectation table, so the comparison is catalogue-vs-catalogue"
    - "an offline proxy for a [RUNBOOK] requirement opens by naming its RB id and stating what it does not prove"
key-files:
  created:
    - tests/unit/bedrock-auth.test.ts
    - tests/unit/r1-unclamp.test.ts
  modified: []
decisions:
  - "Neither PROV-04 nor PROV-07 is marked complete. The plan's own verification block forbids it (Trap T12): both carry an OUTSTANDING live half, and requirements.mark-complete was deliberately not run."
  - "The AWS SDK's npm scope and the AWS CLI's dot-directory name are described rather than spelled in bedrock-auth.test.ts, because the acceptance gate greps both literals to zero and a comment is text like any other. Same precedent as the out-of-scope vendor name in models-template.json (plan 03-02, deviation 1)."
  - "All seven variables in Bedrock's resolve() chain are blanked in every case, not just AWS_PROFILE. Blanking only the variable under test would still let an ambient bearer token answer on the work laptop, and the case would then pass for the wrong reason."
  - "Case 5 asserts the whole resolution is `undefined`, not merely 'not the ambient value': `\"\" ?? ambient` yields `\"\"`, which is falsy, so the branch is not taken and the chain falls off its end. The stronger claim is the true one."
  - "r1-unclamp case 3 reads the built-in compat/cost/contextWindow from a BASELINE registry composed by the same helper instead of a hand-copied table, so a catalogue bump cannot make the survival check assert this file's transcription."
metrics:
  duration: ~20m
  tasks: 2
  files: 2
  completed: 2026-08-13
---

# Phase 3 Plan 05: Bedrock Credential Resolution and the R1 Unclamp Summary

The two things about Bedrock and about R1 that can be proven with no credentials
and no egress, proven — and the two that cannot, named as outstanding in the
files themselves rather than assumed away.

## What was built

### Task 1 — `tests/unit/bedrock-auth.test.ts` (commit `a3656ab`)

Six cases, every one of them inside `withModelsConfig` with an explicit temp
`authPath` and an explicit `env` map. No AWS SDK is loaded, no profile store is
read, no request is issued.

| Case | Claim |
|---|---|
| guard | the shipped `auth-template.json` parses non-empty and carries an `amazon-bedrock` entry — asserted **before** anything iterates it |
| 1 | the **actual committed template**, read from disk each time, resolves: result defined, `source === "stored credential"`, `env.AWS_PROFILE` equal to the template's own placeholder |
| 2 | with the file saying one fixture value and the ambient variable saying a **different** one, the file wins — precedence, not presence |
| 3 | negative control: entry absent, whole chain blank → `undefined` |
| 4 | paired positive: ambient `AWS_PROFILE` alone still resolves, `source === "AWS_PROFILE"` |
| 5 | Trap T8 executable: `env.AWS_PROFILE: ""` beats a good ambient value and resolves **nothing**; plus the shipped placeholder asserted non-empty |

Case 5 is the one that turns a warning into a claim. `resolve()` does
`credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))`
[VERIFIED: `pi-ai 0.84.1 src/providers/amazon-bedrock.ts:65-71`]. `??` falls
through on null/undefined only, so `""` is *present* and the ambient variable is
never consulted — and `""` is then falsy, so the branch is not taken and
resolution falls off the end of the chain entirely. A blank placeholder in a
public repo would therefore present to the user as a Bedrock **outage** on a
machine where `aws sso login` had just succeeded. The case asserts the whole
result is `undefined`, and then asserts the shipped placeholder is a non-empty
string, so the hazard and the artifact are linked in one place.

Isolation is a whole-chain affair, not an `AWS_PROFILE` affair. All seven
variables `resolve()` consults are blanked in every case; a case that cares
about one overrides exactly that one. Pi's auth context returns `undefined`
unless `value.trim().length > 0`
[VERIFIED: `pi-ai 0.84.1 dist/auth/context.js`], so blanking is semantically
identical to absence — which is how the file says "this machine does not have
this set" without ever reading what the machine actually has.
[threat T-03-05-01]

The docstring names `RB-03-03` as the live half with status **OUTSTANDING**,
states that `aws sso login` sets no environment variable at all, and records two
closed doors: `pi auth login` → Amazon Bedrock → **"Existing AWS credential
chain"** stores `{ type: "api_key" }` with no `key` and no `env` (a stored no-op
that looks like configuration — the persisting choice is **"AWS profile"**), and
there is no EC2 instance-profile branch anywhere in the chain.

### Task 2 — `tests/unit/r1-unclamp.test.ts` (commit `8f60c7a`)

Three cases proving the R1 experiment is *executable*, and nothing beyond that.

- **Case 1, the baseline.** The built-in `deepseek/deepseek-v4-flash` offers
  exactly `["off", "high", "max"]` and `clampThinkingLevel(model, "low")`
  returns `"high"`. This is the half of R1 that *is* settleable from a desk, and
  it is now an assertion rather than a paragraph: Pi 0.84.1 with the built-in
  catalogue **can never send** `reasoning_effort: "low"` to DeepSeek-direct.
- **Case 2, with the override.** A registry composed from
  `providers.deepseek.modelOverrides["deepseek-v4-flash"].thinkingLevelMap = { low: "low" }`
  offers `low` and returns `low` unclamped. That is what makes RB-03-04 step 2
  ("if the picker does not offer `low`, the override did not apply — stop") a
  check with a known-good counterpart instead of an instruction with no
  reference behaviour.
- **Case 3, the merge is a merge.** `high`, `max`, `compat`, `cost` and
  `contextWindow` on the overridden model are deep-equalled against a **baseline
  registry composed by the same helper** — never a retyped table. Two paired
  positives (`baseline.compat` defined; `baseline.map` contains `high`) stop the
  case passing by comparing `undefined` with `undefined`.

Pi's own `clampThinkingLevel` and `getSupportedThinkingLevels` are imported from
`@earendil-works/pi-ai` and called on the model Pi composed. A local
reimplementation of the forward walk would assert this file's arithmetic and
would keep passing after Pi changed the rule underneath it.

The docstring records why two researchers disagreed without either being
careless (one answered the API's contract, one answered what Pi will send; both
were right about their own question, neither is the token count), the mechanical
detail that makes the fix a one-liner (`null ?? "low"` is `"low"` — the null
mapping suppresses *selection*, not *emission*, so no adapter change is needed),
why `modelOverrides` and not a model entry (`applyModelOverride` merges
`thinkingLevelMap`, so a full entry would be exactly the drift PROV-06 forbids),
`RB-03-04` as **OUTSTANDING**, the pre-committed threshold
`low.reasoning <= 0.6 * high.reasoning`, and the fourth outcome — an absent
`reasoning` key on both legs is a result worth recording, not a failed run.

## Falsification runs (executed, not assumed)

Per the standing "be suspicious of green" rule, every case was broken and the
file re-run.

| Mutation | Expected | Observed |
|---|---|---|
| `.pi/templates/auth-template.json` placeholder set to `""` | case 1 + case 5's placeholder assertion red | **2 failed** |
| `amazon-bedrock` entry deleted from the template | guard + case 1 + case 5 red | **3 failed** |
| case 2's `auth` object pointed at `dashscope` instead of `amazon-bedrock` | case 2 red | **1 failed** |
| `UNCLAMP_OVERRIDE.thinkingLevelMap` emptied to `{}` | case 2 red | **1 failed** |
| `UNCLAMP_OVERRIDE.thinkingLevelMap` given `high: null` too | case 3 red | **1 failed** |
| `NO_OVERRIDE` replaced by `UNCLAMP_OVERRIDE` | case 1 red | **1 failed** |

All mutations reverted; `git status --short` clean apart from the two new files
before each commit.

## Deviations from Plan

None. Both tasks were executed as written; no Rule 1–4 deviation arose and no
package was installed — this plan is two test files.

## Autonomous decisions

Recorded rather than asked, per the Standing Operating Policy (the user is
asleep):

1. **Neither PROV-04 nor PROV-07 was marked complete**, and
   `requirements mark-complete` was deliberately not run for them. The plan's
   own verification block requires that "no PROV-04 or PROV-07 status anywhere
   in the repo is changed to passing by this plan", and Trap T12 forbids marking
   a `[RUNBOOK]` requirement passing on the strength of a green offline half.
   `.planning/REQUIREMENTS.md` still shows both as `[ ]` / Pending, which is the
   correct state.
2. **Two literals are described rather than spelled** in
   `tests/unit/bedrock-auth.test.ts` — the AWS SDK's npm scope and the AWS CLI's
   dot-directory name — because the acceptance gate greps both to zero and a
   comment is text like any other. The reason is written into the file's own
   docstring so the next reader does not "fix" it. Direct precedent: plan
   03-02's deviation 1, where the same conflict was resolved the same way.

## What this does NOT prove

Nothing here contacted a provider, and nothing here could.

- **PROV-04's live half is `RB-03-03`, OUTSTANDING.** Whether a real SSO token
  on the work laptop resolves — whether `aws sso login --profile X` followed by
  a fresh `pi` session authenticates against Bedrock — is untouched by this
  plan. What is proven is that Pi's *resolution of a stored profile name* works
  and that the shipped template is a valid credential document.
- **PROV-07's answer is `RB-03-04`, OUTSTANDING.** Whether `api.deepseek.com`
  accepts `reasoning_effort: "low"` and whether it yields materially fewer
  reasoning tokens than `"high"` is a question one live request settles and desk
  work cannot. This plan proves only that the request can now be *made*.
  Consequently `/cheap` must still not be defined in terms of a cheap thinking
  tier (CONTEXT decision 9).

## Known Stubs

None. Both files are complete and every case executes.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/unit/bedrock-auth.test.ts` | 6 passed |
| `npx vitest run tests/unit/r1-unclamp.test.ts` | 3 passed |
| `npm run test:unit` | 31 files, **505 passed** |
| `npm test` | 40 files, **565 passed** (baseline 531 + this phase's earlier plans + 9 new) |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no output |
| `grep -c "aws-sdk" tests/unit/bedrock-auth.test.ts` | 0 |
| `grep -n "\.aws" tests/unit/bedrock-auth.test.ts` | no match |
| `grep -ci "skip" tests/unit/bedrock-auth.test.ts` | 0 |
| `.planning/REQUIREMENTS.md` PROV-04 / PROV-07 | still `[ ]` / Pending — unchanged |
| network requests issued | none |

## Self-Check: PASSED

- `tests/unit/bedrock-auth.test.ts` — FOUND
- `tests/unit/r1-unclamp.test.ts` — FOUND
- `.planning/phases/03-providers-credentials/03-05-SUMMARY.md` — FOUND
- commit `a3656ab` — FOUND
- commit `8f60c7a` — FOUND
