---
phase: 03-providers-credentials
plan: 02
subsystem: config-templates
tags: [wave-1, templates, dashscope, compat, gitignore, PROV-01, PROV-03, PROV-04, PROV-06]
requires:
  - ".pi/templates/env.example — the shipped-template header + managed-marker convention (Phase 1)"
  - "tests/helpers/git.ts — isIgnored() / trackedFiles(), the only ignore oracle (Phase 1)"
  - "tests/unit/logs-gitignored.test.ts — the live-oracle control this test inverts (Phase 2)"
provides:
  - ".pi/templates/models-template.json — the dashscope provider with an explicit full compat block and two DeepSeek V4 models, every number sourced or marked UNVERIFIED"
  - ".pi/templates/auth-template.json — dashscope / deepseek / amazon-bedrock credential entries with zero secrets, validated against Pi's own ReadOnlyAuthStorage"
  - "KYPI_DASHSCOPE_BASE_URL — the declared install-time base-URL override, inside the managed markers of both env templates"
  - "tests/unit/template-tracked.test.ts — the Trap T1 filename guard, asserted in both directions"
affects:
  - "03-03 (bootstrap merge_models_json / merge_auth_json) — these are the two files it installs"
  - "03-04 (dashscope-compat, model-metadata) — INTENDED_COMPAT and COST_UNVERIFIED are deep-equalled against the composed form of this template"
  - "03-0x (loopback payload test) — the emission asserted on the wire is the emission this compat block configures"
  - "docs/RUNBOOK.md RB-03-01 / RB-03-05 — the base-URL escape hatch and the cost/maxTokens gaps this file records"
tech-stack:
  added: []
  patterns:
    - "whole-line `//` comments in models.json carrying a URL or the word UNVERIFIED beside every number"
    - "a config template validated by running the host's real loader over it, not by reading the validator"
    - "a filename policy asserted in BOTH directions — shipped names tracked, rejected names ignored"
key-files:
  created:
    - .pi/templates/models-template.json
    - .pi/templates/auth-template.json
    - tests/unit/template-tracked.test.ts
  modified:
    - .pi/templates/env.example
    - .env.example
decisions:
  - "The out-of-scope vendor's name is not spelled even in a comment in models-template.json, and the workspace-dedicated DashScope host is described (\"a host whose first label is the caller's own workspace id\") rather than written: both acceptance greps are case-insensitive counts to zero, and a comment is text like any other."
  - "Both templates were validated by executing Pi's own loaders — stripJsonComments + JSON.parse for the models template, ReadOnlyAuthStorage.load()/read() for the auth template — rather than by a local regex-strip. The auth run also proved $DASHSCOPE_API_KEY interpolates and env.AWS_PROFILE survives verbatim."
  - "The header paragraph of .env.example was updated to match the template even though bin/bootstrap.sh only rewrites the managed region — the destination header is preserved by write_env_template, so a stale one would have persisted forever."
  - "trackedFiles() membership, not merely isIgnored(), is the load-bearing half of the T1 guard: `git mv auth-template.json auth.example.json` leaves the negative half green (git mv forces an ignored path into the index) and only the tracked-name case turns red."
metrics:
  duration: ~25m
  tasks: 3
  files: 5
  completed: 2026-08-13
requirements-completed: [PROV-01]
---

# Phase 3 Plan 02: Configuration Templates and the Filename Guard Summary

The two files a fresh clone must contain — a DashScope provider whose `compat`
block is written out in full because Pi's detection has no branch for it, and a
credential template with zero secrets — under filenames git will actually keep,
with the two filenames git would silently swallow machine-asserted as swallowed.

## What was built

### Task 1 — `.pi/templates/models-template.json` (commit `07d68c1`)

One provider, `dashscope`, at the shared `dashscope-intl.aliyuncs.com` host with
`apiKey: "$DASHSCOPE_API_KEY"`, and two models, `deepseek-v4-flash` and
`deepseek-v4-pro`.

Every one of the seven provider-level `compat` fields is written out explicitly,
including the three that happen to match a generic default. `detectCompat` keys
on hard-coded provider ids and base-URL substrings and has no branch for
DashScope, Model Studio, `aliyuncs.com` or Qwen, so a field left to detection
takes the OpenAI default silently: `thinkingFormat` would fall back to `"openai"`
and thinking would never be enabled at all, and
`requiresReasoningContentOnAssistantMessages` would fall back to `false` so the
**second** turn of a tool sequence 400s while the first succeeds. Both are
invisible from the UI. That is the entire reason PROV-03 exists.

Both models carry `reasoning: true` — `modelFromJson` defaults it to `false`, and
every `thinkingFormat` branch plus the `reasoning_content` fix is gated on it, so
omitting it disables thinking and re-opens the PROV-10 400 together and silently.

Every number carries its provenance in a whole-line `//` comment:
`contextWindow: 393216` with the alibabacloud.com URL (and an explicit "never copy
1,000,000 across from the identically-named DeepSeek-direct entry"), `maxTokens:
65536` marked `UNVERIFIED` and deliberately conservative, the all-zero `cost`
block named as a visible placeholder that `RB-03-05` replaces, `thinkingFormat`
carrying the closed upstream issue and the one-key flip to `"deepseek"` if
RB-03-01's wire dump shows `enable_thinking` rejected, and `baseUrl` naming
`KYPI_DASHSCOPE_BASE_URL` as the install-time override.

No Bedrock entry (its built-in catalogue is complete; redefining a catalogued
model is the drift PROV-06 forbids) and no out-of-scope vendor anywhere.

**Verified, not assumed:** the file was parsed with Pi's own
`stripJsonComments` from `node_modules/@earendil-works/pi-coding-agent/dist/utils/json.js`,
not just a local regex strip — it round-trips to one provider, the seven-key
compat block above, and two models at `reasoning=true ctx=393216`.

### Task 2 — `.pi/templates/auth-template.json` + the `KYPI_DASHSCOPE_BASE_URL` seam (commit `3022301`)

Three entries: `dashscope` and `deepseek` as `$ENV_VAR` `api_key` references, and
`amazon-bedrock` as `{"type":"api_key","env":{"AWS_PROFILE":"REPLACE_WITH_AWS_PROFILE_NAME"}}`
— a **non-empty** literal placeholder. Trap T8 is why: `resolve()` does
`credential?.env?.AWS_PROFILE ?? (await env("AWS_PROFILE"))`, so `""` would win
over the ambient variable through `??` and present as a Bedrock outage rather
than as a misconfiguration. Strict JSON, no comments — `auth.json` gets no
comment stripping, and a malformed credential file is worse than an undocumented
one.

**Verified, not assumed:** `ReadOnlyAuthStorage.load()` accepted all three
entries and `read()` resolved `$DASHSCOPE_API_KEY` from a scratch value in
`process.env` and returned `env.AWS_PROFILE` verbatim. That is Pi's real
validator, run over the real file.

`KYPI_DASHSCOPE_BASE_URL=` was added inside the managed markers of
`.pi/templates/env.example` and mirrored byte-identically into `.env.example`
(`tests/unit/gitignore-policy.test.ts`'s WR-10 drift guard compares exactly that
region). Both headers now say real credentials belong in `~/.pi/agent/auth.json`,
installed from `.pi/templates/auth-template.json` by `bin/bootstrap.sh` — the
"Phase 3's concern" wording is gone, because this phase is where that is
discharged — and name `KYPI_DASHSCOPE_BASE_URL` as an install-time override
rather than a credential, pointing at `RB-03-01`.

### Task 3 — `tests/unit/template-tracked.test.ts` (commit `90ba906`)

Nine cases, both directions. The two shipped names are asserted not-ignored **and
present in `trackedFiles(".pi/templates")`**; `.pi/templates/auth.json` and
`.pi/templates/auth.example.json` — the two names `ARCHITECTURE.md` sketched — are
asserted **ignored**, each naming the rule that eats it. The tracked-file list is
asserted non-empty and correctly scoped before any membership check, and the
live-oracle control asserts `isIgnored("README.md") === false`, inverted from
`logs-gitignored.test.ts`'s because here it is the negative half that a
returns-true-for-everything oracle would make vacuous.

**Falsified twice, executed:**

| Mutation | Result |
|---|---|
| `git mv .pi/templates/auth-template.json .pi/templates/auth.example.json` | 1 failed — the tracked-name case. Reverted. |
| Deleting `auth.json` + `auth.*.json` from `.gitignore` | 2 failed — both swallow cases. Restored. |

The first falsification is the more interesting one and produced a decision worth
recording: `git mv` **forces** an ignored path into the index, so after the rename
the file was both ignored and tracked and the negative half stayed green. Only
the `trackedFiles(...).toContain(...)` case turned red. "Not ignored" and "tracked"
are genuinely different questions, and the second is the one that catches a clone
missing a file.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] Two acceptance greps were violated by the comments the same task asked for**

- **Found during:** Task 1 verification.
- **Issue:** The task text asks for a `baseUrl` comment explaining the
  workspace-dedicated alternative and a header stating "no Qoder anything", while
  the acceptance criteria require `grep -c 'maas.aliyuncs.com'` to be 0 and a
  case-insensitive `qoder` count of 0. A comment is text; both greps failed.
- **Fix:** The workspace-dedicated host is now described rather than spelled ("a
  host whose first label is the caller's own workspace id"), and the header states
  that exactly one provider is defined and that the out-of-scope vendor's name is
  not spelled even in a comment because the gate greps it to zero. Both
  explanations survive; neither literal does.
- **Files modified:** `.pi/templates/models-template.json`
- **Commit:** `07d68c1`

**2. [Rule 2 - Missing critical] The `.env.example` header was updated too, not only its managed region**

- **Found during:** Task 2.
- **Issue:** The acceptance criterion only requires the *template* to stop saying
  "Phase 3's concern", and `write_env_template` rewrites only the managed region
  of the destination — so a stale header in `.env.example` would have survived
  every future bootstrap run, permanently.
- **Fix:** Both headers updated identically. The managed regions are byte-identical,
  so `sh bin/bootstrap.sh` still writes nothing.
- **Files modified:** `.env.example`
- **Commit:** `3022301`

No Rule 4 (architectural) decisions arose. No packages were installed — this plan
is two JSON files, one env-template edit and one test.

## Autonomous decisions

- Where the plan's task prose and its own acceptance greps conflicted (deviation 1
  above), the greps won and the prose was rephrased to survive them. Recorded
  rather than asked, per the Standing Operating Policy.

## What this does NOT prove

Nothing here contacted a provider, and nothing here could. The templates are
structurally valid against **Pi's** loaders; whether DashScope accepts the body
this `compat` block produces is `RB-03-01` / `RB-03-02` and remains **OUTSTANDING**.
The real `maxTokens` cap and the real per-token cost are `RB-03-05`, likewise
OUTSTANDING — which is why the zeros are visible placeholders and `maxTokens`
carries the word `UNVERIFIED` in the file itself. `PROV-03`, `PROV-04` and
`PROV-06` are advanced by this plan, not completed by it.

## Known Stubs

None. The all-zero `cost` block and the conservative `maxTokens` are declared
placeholders with an in-file mark and a named runbook entry that replaces them —
they are recorded gaps, not silent ones, and the plan-03-04 `COST_UNVERIFIED`
allowlist test is what will keep them declared.

## Verification

| Check | Result |
|---|---|
| Task 1 verify (`node -e` over the stripped template) | `ok` |
| Task 1 acceptance greps (8 literals present; `1000000`, `maas.aliyuncs.com`, `qoder`, leading-`!` leaves all 0) | pass |
| Pi's own `stripJsonComments` + `JSON.parse` | pass |
| Task 2 verify (`node -e` over `auth-template.json`) | `ok` |
| Pi's own `ReadOnlyAuthStorage.load()` / `read()` | pass, `$DASHSCOPE_API_KEY` interpolated |
| Managed-region byte identity, template vs `.env.example` | pass |
| `npx vitest run tests/unit/template-tracked.test.ts` | 9 passed |
| `npm run test:unit` | 27 files, 471 passed |
| `npm test` | 36 files, 531 passed |
| `npm run typecheck` | clean |

## Self-Check: PASSED

All five files present on disk; all three commits (`07d68c1`, `3022301`,
`90ba906`) present in `git log`.
