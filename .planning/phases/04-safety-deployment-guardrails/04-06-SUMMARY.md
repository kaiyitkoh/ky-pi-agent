---
phase: 04-safety-deployment-guardrails
plan: 06
subsystem: safety
tags: [aws, terraform, kubectl, infra-classification, allow-list, fail-closed]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "CanonicalInvocation { executable, args } from shell.ts (Plan 03) — infra.ts consumes the shape, never shell.ts's canonicalise() runtime itself"
provides:
  - "classifyInfraInvocation() in .pi/extensions/safety/infra.ts: a pure three-valued classifier (allow / confirm / sensitive-read / not-applicable) for aws, terraform and kubectl invocations"
  - "isSensitiveAwsRead / isSafeAwsOperation, exported and independently testable, evaluated in the order that keeps secretsmanager get-secret-value sensitive despite matching the ^get- safe prefix"
  - "TERRAFORM_CONFIRM_SUBCOMMANDS / TERRAFORM_ALLOW_SUBCOMMANDS / KUBECTL_CONFIRM_VERBS / KUBECTL_ALLOW_VERBS, every entry proven reachable by a fixture"
  - "the aws sts get-caller-identity / aws s3 ls / terraform plan / kubectl get orientation calls as NAMED allow rows, citing Pitfall 4, so a later change that gates them fails loudly"
affects: [04-07, 04-09, 04-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sensitive-read checked BEFORE safe-operation, always, with the ordering pinned by an actual falsification (swap the checks, watch tests go red, restore) rather than only asserted by fixture"
    - "two-word subcommand keys (terraform state/workspace) joined before any table lookup, so a shared first word cannot let one verdict swallow the other — same shape as aws's service+operation pair"
    - "unknown verb defaults to confirm (human-in-the-loop), not allow and not a hard block — distinct posture from git.ts's unknown-subcommand-under-protected-HEAD hard block"
    - "tabulated (not derived) global-flag skip table for aws --profile/--region/--output, mirroring shell.ts's env/sudo option-grammar tables"

key-files:
  created:
    - .pi/extensions/safety/infra.ts
    - tests/unit/infra-policy.test.ts
  modified: []

key-decisions:
  - "Two atomic commits matching the plan's two TDD tasks: Task 1 shipped aws-only classification with classifyInfraInvocation returning not-applicable for terraform/kubectl (a legitimate intermediate state, not a stub — a not-yet-classified executable correctly reports not-applicable rather than a silent allow); Task 2 extended the same entry point to add terraform/kubectl dispatch. Both commits are independently green (37/37, then 98/98)."
  - "Ordering falsification performed for real, not just asserted: reversed isSensitiveAwsRead/isSafeAwsOperation in classifyAwsInvocation, ran the suite, watched 6 tests go red (both at Task 1's 37-test state and again at Task 2's 98-test state), then restored the original order and reran to confirm green. This is the plan's own <action> instruction (\"reversing the two checks must turn a test red\"), executed rather than described."
  - "kubectl classification keys on the first word (verb) only, not a two-word pair — unlike terraform's state/workspace. The plan's <behavior> table names no two-word kubectl form requiring disambiguation (kubectl config view is a single ALLOW row under the config verb; no kubectl config subcommand appears in a CONFIRM row), so the simpler single-word key was kept rather than adding unrequested two-word machinery."
  - "AWS global-flag extraction treats any unrecognised '-'-prefixed token as boolean (skip one word) rather than guessing an arity. This can only under-consume, which fails toward confirm on a genuinely ambiguous input — never toward a silent allow. Documented in the module docstring rather than left implicit."

requirements-completed: [SAFE-07]

# Metrics
duration: 25min
completed: 2026-08-14
---

# Phase 4 Plan 6: Infrastructure Verb Classification (terraform/aws/kubectl) Summary

**A pure three-valued classifier in `.pi/extensions/safety/infra.ts` that routes `terraform apply|destroy|import`, mutating `aws` calls and `kubectl delete` to confirmation while keeping `aws sts get-caller-identity`, `aws s3 ls`, `terraform plan` and `kubectl get` ungated — with the AWS sensitive-read-before-safe-operation ordering proven by an actual reverse-and-observe falsification, not just a fixture assertion.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-14T04:53:00Z (approx, from first tool read)
- **Completed:** 2026-08-14T04:57:52Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both created in Task 1, extended in Task 2)

## Accomplishments

- `.pi/extensions/safety/infra.ts` ports `SAFE_AWS_EXACT_OPERATIONS`, `SAFE_AWS_CONFIGURE_OPERATIONS`, `SAFE_AWS_SERVICE_OPERATIONS`, `isSensitiveAwsRead`, `isSafeAwsOperation` verbatim from `04-RESEARCH.md`'s reproduction of `@ramtinj95/pi-infra-command-guard@0.9.1` (read this session, never installed — absent from `package.json` and `infra.ts` imports nothing from it).
- `classifyInfraInvocation(invocation)` is the single entry point, returning `{ kind: "not-applicable" | "allow" | "confirm" | "sensitive-read" }`, with every `confirm`/`sensitive-read` verdict carrying a `reason` string.
- The AWS ordering (`isSensitiveAwsRead` before `isSafeAwsOperation`) was falsified for real: the two checks were swapped in the running code, the suite was re-run (6 tests failed, including the `secretsmanager get-secret-value` and `configure get` rows), and the original order was restored and re-verified green. This was repeated once at Task 1's 37-test state (aws-only) and is preserved in the final 98-test suite.
- `aws --profile prod s3 rm s3://b/k` classifies as `s3 rm`, not `--profile rm` — the global-flag skip table (`--profile`/`--region`/`--output` value-taking, `--no-cli-pager`/`--debug` boolean) is tabulated, mirroring `shell.ts`'s `ENV_VALUE_OPTIONS`/`SUDO_VALUE_OPTIONS` pattern rather than guessed.
- `terraform state rm` confirms and `terraform state list` allows despite sharing the `state` first word — classification keys on the joined two-word pair (`terraformSubcommandKey`), same shape as `aws`'s service+operation split.
- Unknown terraform subcommands and unknown kubectl verbs default to `confirm` (fail-safe, human-in-the-loop), a deliberately different posture from `git.ts`'s hard block on an unknown subcommand under a protected `HEAD` — documented in the module docstring with the reasoning for the difference.
- `kubectl exec` confirms with a reason explicitly naming that the bash AST guard cannot see into a remote shell.
- 98 table-driven tests in `tests/unit/infra-policy.test.ts`: 45 classification rows (10 AWS allow, 5 AWS confirm, 4 AWS sensitive-read, 10 terraform confirm, 11 terraform allow, 1 terraform unknown, 9 kubectl confirm, 4 kubectl allow, 1 kubectl unknown, 2 not-applicable), a reason-non-empty check over every gated row, a liveness guard proving every entry in all four new constants (`TERRAFORM_CONFIRM_SUBCOMMANDS`, `TERRAFORM_ALLOW_SUBCOMMANDS`, `KUBECTL_CONFIRM_VERBS`, `KUBECTL_ALLOW_VERBS`) is exercised, and direct unit tests on `isSensitiveAwsRead`/`isSafeAwsOperation`.

## Task Commits

1. **Task 1: The AWS mutating-vs-read-only classification** - `79b1dfc` (feat) — 37/37 tests green, ordering falsified and restored
2. **Task 2: terraform and kubectl classification** - `7fb4673` (feat) — 98/98 tests green, full suite (944 tests) and `tsc --noEmit` clean

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/extensions/safety/infra.ts` (new, 427 lines) — `classifyInfraInvocation`, the AWS predicate pair, the terraform two-word subcommand classifier, the kubectl verb classifier, `InfraVerdict`, and every export the plan's artifact contract names
- `tests/unit/infra-policy.test.ts` (new, 236 lines) — the 45-row `{ command, expected, why }` table, reason-non-empty checks, the four-constant liveness guard, and direct `isSensitiveAwsRead`/`isSafeAwsOperation` unit tests

## Decisions Made

See `key-decisions` in frontmatter. In summary: the plan's two tasks were executed as two genuinely separate, independently-green commits rather than one combined commit, because the plan is marked `tdd="true"` per task and Task 1's own acceptance criteria (`npx vitest run tests/unit/infra-policy.test.ts` exits 0) is stated as a standalone gate. kubectl classification was kept single-word (no `state`/`workspace`-style two-word pairing) because no row in the plan's `<behavior>` table requires disambiguating two kubectl forms sharing a first word.

## Deviations from Plan

None — plan executed exactly as written. The AWS classification, terraform two-word subcommand handling, kubectl verb classification, unknown-defaults-to-confirm posture, and the ordering falsification were all explicit plan instructions, implemented as specified.

## Issues Encountered

None. All acceptance criteria and the plan's `<verification>` block (`npx vitest run tests/unit/infra-policy.test.ts`, `npx vitest run tests/unit/extension-layout.test.ts`, `npm run typecheck`) pass; the full suite (944 tests across 54 files) is green.

## User Setup Required

None — no external service configuration required. This plan adds no new dependency; `infra.ts` has zero imports beyond the `CanonicalInvocation` type from `shell.ts`.

## Next Phase Readiness

- Plan 07 (the `tool_call` hook / approval-protocol composer) can now import `classifyInfraInvocation` alongside `classifyGitInvocation`/`classifyGlabInvocation` (Plan 05) and `classifyPathRead`/`classifyPathWrite` (Plan 04), chaining them without special-casing: every classifier returns a value that either names a verdict or reports `not-applicable`/`allow` for "not my concern."
- `classifyInfraInvocation`'s `confirm`/`sensitive-read` `reason` strings are ready to flow into Plan 07's approval request and into `audit.ts`'s audit row, per the module docstring's contract.
- No blockers. `npm test` is green at 944/944, `tsc --noEmit` clean.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: .pi/extensions/safety/infra.ts
- FOUND: tests/unit/infra-policy.test.ts
- FOUND: commit 79b1dfc (Task 1)
- FOUND: commit 7fb4673 (Task 2)
