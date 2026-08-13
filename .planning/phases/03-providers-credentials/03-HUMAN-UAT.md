---
status: partial
phase: 03-providers-credentials
source: [03-VERIFICATION.md]
started: 2026-08-14T02:35:00Z
updated: 2026-08-14T02:35:00Z
---

## Current Test

[awaiting human testing]

These five items are the live half of Phase 3. Every one of them requires a
credential this development machine does not hold, and the autonomous run that
built the phase was under a standing ban on issuing any network request to a
provider host. They are recorded here so they surface in `/gsd:progress` and
`/gsd:audit-uat` until they are actually run — not so the phase can be called
finished.

Each item's exact command, expected output and offline proxy live in
`docs/RUNBOOK.md` under the matching `RB-03-xx` id. Run them there, then record
the result in `docs/RUNBOOK.md` **and** here. `tests/unit/docs-policy.test.ts`
parses both the summary-table row and the `**Status:**` line for every id and
fails with `INCONSISTENT` if only one of the two is flipped — so a half-recorded
result is caught rather than silently believed.

## Tests

### 1. RB-03-01 — DashScope accepts the explicit `compat` block on the wire
expected: A live turn against `dashscope/deepseek-v4-flash` returns 200 with `enable_thinking`, top-level `reasoning_effort` and `max_tokens` present, and `store`, a `developer` role, `strict` on any function, and `prompt_cache_*` absent. Per `docs/RUNBOOK.md` RB-03-01.
why_human: Requires a live DashScope credential and network egress to `aliyuncs.com`. Neither exists on this machine.
offline_proxy: `tests/integration/dashscope-payload.test.ts` — the same claims proven on real bytes through Pi's real `openai-completions` adapter against a loopback server, with a control body proving the absences are evidence rather than artefact.
result: [pending]

### 2. RB-03-02 — a two-turn tool-calling sequence against DashScope returns 200 on the second turn
expected: The second `main.request` carries a replayed assistant message with `tool_calls` and `reasoning_content`, followed by a `main.response` with status 200. Per `docs/RUNBOOK.md` RB-03-02.
why_human: Requires a live DashScope credential. The first turn always works, so only a live second-turn round trip is the test — this is the failure mode Pi's `detectCompat` cannot catch, because it has no `aliyuncs.com` branch.
offline_proxy: `tests/integration/dashscope-payload.test.ts` — the `reasoning_content` insertion on the replayed assistant message, with a paired negative that deletes the compat key.
result: [pending]

### 3. RB-03-03 — Bedrock authenticates from a fresh shell via `credential.env.AWS_PROFILE`
expected: A `turns` row with `outcome: ok` and non-zero tokens from a fresh shell with no exported `AWS_PROFILE`, using a stored Bedrock credential; plus one live SSO-expiry observation recorded verbatim. Per `docs/RUNBOOK.md` RB-03-03.
why_human: Requires a real IAM Identity Center SSO session and Bedrock access.
offline_proxy: `tests/unit/bedrock-auth.test.ts` — all seven variables in Pi's resolution chain blanked, proving stored `env.AWS_PROFILE` beats ambient; plus `tests/integration/sso-classifier.test.ts` for the expiry message and its non-retryable classification.
result: [pending]

### 4. RB-03-04 — the R1 experiment (`reasoning_effort: "low"` vs `"high"` on DeepSeek-direct)
expected: Four verbatim fragments (two `main.request` payloads, two `turns` rows) recorded, and the **pre-committed** threshold `low.reasoning <= 0.6 * high.reasoning` evaluated against them. Per `docs/RUNBOOK.md` RB-03-04.
why_human: Requires a live DeepSeek-direct credential and a real token count from the provider. The threshold was committed before any number was seen, which is the point — do not adjust it after reading the result.
offline_proxy: `tests/unit/r1-unclamp.test.ts` — the `thinkingLevelMap.low = null` clamp, its removal by a `modelOverrides` unclamp, and `"low"` surviving selection through a real composed `ModelRuntime`.
result: [pending]

### 5. RB-03-05 — the real DashScope context cap and per-token price
expected: Real `cost` and `maxTokens` figures for `dashscope/deepseek-v4-flash` and `dashscope/deepseek-v4-pro`, read from the Model Studio console and written into `.pi/templates/models-template.json`, with `COST_UNVERIFIED` updated in the **same commit**. Per `docs/RUNBOOK.md` RB-03-05.
why_human: Requires a Model Studio console login this machine does not have.
offline_proxy: `tests/unit/model-metadata.test.ts` — the no-cross-provider-inheritance invariant, and the both-directions coupling between an all-zero cost model and its presence on `COST_UNVERIFIED`.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
