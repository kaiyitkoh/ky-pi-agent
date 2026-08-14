---
status: partial
phase: 05-routing-capability-guards
source: [05-VERIFICATION.md]
started: 2026-08-14T19:40:00Z
updated: 2026-08-14T19:40:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. RB-05-01 — Qoder delegates a task and folds the result back through the real Cloud Agents API
expected: A real `QODER_PERSONAL_ACCESS_TOKEN` + `QODER_AGENT_ID` + `QODER_ENVIRONMENT_ID` against `api.qoder.com` returns a non-empty folded `agent.message` result, and the redacted `.pi/logs/qoder-*.jsonl` transcript shows `done:true` with `stop_reason.type === 'end_turn'`.
why_human: No `QODER_PERSONAL_ACCESS_TOKEN`, no pre-configured agent/environment, and no network egress to `api.qoder.com` exist on this machine, and the standing policy for this autonomous run forbids any network request to that host. Only a real PAT against the real service can prove the harness's SSE-envelope assumptions (documented as UNVERIFIED in `qoder/client.ts`) hold against production.
procedure: `docs/RUNBOOK.md` → RB-05-01
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
