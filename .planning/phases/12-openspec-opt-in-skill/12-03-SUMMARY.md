---
phase: 12-openspec-opt-in-skill
plan: 03
subsystem: tooling
tags: [openspec, posix-sh, install, skills, telemetry]
requires: [12-02]
provides:
  - scripts/openspec-setup.sh (install-cli / generate+patch+install / check / uninstall, single pin 1.13.2)
  - tests/integration/openspec-setup.test.ts (14 cases against a fake openspec and fake npm)
affects: [12-04]
tech-stack:
  added: []
  patterns: [generate in throwaway project with isolated XDG, awk frontmatter-only patch, fake CLI via sh launcher plus mjs payload]
key-files:
  created:
    - scripts/openspec-setup.sh
    - tests/integration/openspec-setup.test.ts
  modified: []
key-decisions:
  - "Frontmatter patching lives only in the POSIX script; no new harness command or tool"
  - "Repo-containment check compares pwd -P / cygpath -u forms so a Windows-form agent dir is still caught under Git Bash"
  - "Bespoke fake CLI in the test; tests/helpers/stub-bin.ts left untouched"
requirements-completed: [OSPEC-1, OSPEC-2]
duration: 20min
completed: 2026-10-13
---

# Phase 12 Plan 03: openspec-setup.sh Summary

POSIX `sh` operator script that pins OpenSpec 1.13.2, generates the expanded 12-workflow set in an isolated temp project, patches `disable-model-invocation: true` into each SKILL.md frontmatter, and installs 12 skills and 12 prompts at user level, proven offline against a fake CLI.

## Commits
- 44897a7 test(12-03): failing spec (RED: all 14 cases failed, script absent, ENOENT / non-zero exit, no TypeScript error)
- 6b8571f feat(12-03): the script (GREEN: 14/14)

## Verification
- `openspec-setup.test.ts`: 14/14 pass; `lf-and-shell.test.ts`: 23/23 pass; `tsc --noEmit` clean; `sh -n` ok; grep for bashisms / phase IDs returns 0; `git status --porcelain .pi` empty.
- Negative controls: (a) 11-skill and wrong-version cases fail the script with non-zero exit (they are asserted tests); (b) removing the awk flag insert made 8 of 14 cases fail; script restored.
- Real global install is not done here (plan 04).

## Deviations from Plan
None. The plan's `--check --uninstall` (two args) is rejected with exit 2, covered by a test.

## Known Stubs
None.

## Self-Check: PASSED
