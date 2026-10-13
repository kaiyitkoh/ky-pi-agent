---
phase: 12-openspec-opt-in-skill
plan: 01
subsystem: safety
tags: [openspec, infra-guard, gitignore, unbash]
requires: []
provides:
  - openspec arm in classifyInfraInvocation with exported OPENSPEC_ALLOW_SUBCOMMANDS / OPENSPEC_CONFIRM_SUBCOMMANDS
  - rooted /openspec/ ignore rule with oracle tests
affects: [12-02, 12-03, 12-04]
tech-stack:
  added: []
  patterns: [two-word-parent subcommand keys reused for config/store/workset]
key-files:
  created: []
  modified:
    - .pi/extensions/safety/infra.ts
    - tests/unit/infra-policy.test.ts
    - tests/unit/policy-compose.test.ts
    - tests/unit/gitignore-policy.test.ts
    - .gitignore
    - docs/SAFETY.md
key-decisions:
  - "archive is a named allow row, not a path exemption, because bash writes are not path-classified"
  - "unknown and bare openspec subcommands confirm (fail-safe), matching terraform/kubectl"
requirements-completed: [OSPEC-3]
duration: 20min
completed: 2026-10-13
---

# Phase 12 Plan 01: openspec guard and ignore rule Summary

The safety guard now classifies `openspec`: read-only verbs and `archive` allow, while `init`, `update`, `completion`, `feedback`, state-changing `config`/`store`/`workset` words, bare `openspec` and unknown subcommands confirm. A rooted `/openspec/` rule keeps an accidental scaffold out of this public repo.

## Commits
- 33c254c feat(12-01): infra.ts openspec arm + 46 table rows and liveness checks
- 20a038c test(12-01): 7 composed-policy rows, SAFETY.md bullet and gap paragraph
- 84d3a81 chore(12-01): `/openspec/` ignore, 4 ignore rows, 2 committable rows, tracked-files test

## Verification
- infra-policy (166), policy-compose (64), evasion-corpus (101), gitignore-policy (70) all pass; `npx tsc --noEmit` clean.
- `paths.ts`, `policy.ts` and `evasion-corpus.ts` untouched. `^| EV-` rows in SAFETY.md: 14 before and after.
- Negative controls (each run once, then restored):
  - Renaming the dispatch arm in infra.ts: 66 failures in infra-policy; 3 (init, wrapper-update, strongest-wins) in policy-compose.
  - Renaming `/openspec/` in .gitignore: the 4 ignore rows fail.
  - RED was observed first for the infra rows (missing exports) and the gitignore rows (4 failing).

## Deviations from Plan

**1. [Rule 1 - Bug in test premise] wrapper row uses `env -i`, not `env OPENSPEC_TELEMETRY=0`**
- **Found during:** Task 2
- **Issue:** `shell.ts` `resolveWrappers` does not skip `VAR=val` words after `env`, so `env A=1 openspec update` resolves to executable `A=1` and is allowed. Reproduced identically for `env A=1 terraform apply` (allow), so this is a pre-existing hole, not specific to openspec. `A=1 terraform apply` and `env -i ...` classify correctly.
- **Fix:** the row is `env -i openspec update` (still proves wrapper resolution reaches the verb). The `shell.ts` gap is out of scope and is logged below.
- **Commit:** 20a038c

## Deferred Issues
- `shell.ts` `resolveWrappers`: `env NAME=value <cmd>` is not unwrapped, so any gated command behind `env VAR=x` is allowed (confirmed with `terraform apply`). Worth a corpus entry and fix in a safety phase; not touched here. Relevant to plan 02 if skills or scripts rely on `env OPENSPEC_...=0 openspec ...`.

## Known Stubs
None.

## Threat Flags
None.

## Self-Check: PASSED
Commits 33c254c, 20a038c, 84d3a81 exist; all modified files present.
