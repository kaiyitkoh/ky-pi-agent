---
status: partial
phase: 04-safety-deployment-guardrails
source: [04-VERIFICATION.md]
started: 2026-08-14T12:10:00Z
updated: 2026-08-14T12:10:00Z
---

## Current Test

[awaiting human testing on the work laptop]

## Tests

### 1. RB-04-01 — a push to a protected GitLab branch is rejected server-side (SAFE-01)

expected: from the work laptop, against the real work GitLab repository, a push to a
protected branch is rejected **server-side** with GitLab's own wording and a non-zero
exit status — before any harness rule is consulted. This is the only control in Phase 4
that is not theatre; every other guardrail is a client-side mistake-catcher that a
determined user can bypass.

The exact command, the expected output and the offline proxy are recorded in
`docs/RUNBOOK.md` under `RB-04-01`. The local pre-receive-hook test
(`tests/integration/gitlab-push-protection.test.ts`) is a **proxy, not the check** —
it proves the classifier reads a real server-side rejection correctly, not that the
work GitLab server protects the branch.

Status must remain **OUTSTANDING** in both `docs/RUNBOOK.md` locations (the summary
table and the entry's `**Status:**` line) until a human actually runs it.
`tests/unit/docs-policy.test.ts` fails with INCONSISTENT if it is flipped in only one
of the two places, and fails outright if it is flipped without the check having run.

result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
