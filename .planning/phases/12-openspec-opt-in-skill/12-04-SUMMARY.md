---
phase: 12-openspec-opt-in-skill
plan: 04
subsystem: docs
tags: [openspec, install, runbook, docs-policy]
requires: [12-01, 12-02, 12-03]
provides:
  - real pinned install of openspec 1.13.2 and user-level skills on this machine
  - docs/OPENSPEC.md operator doc
  - RUNBOOK Phase 12 section, RB-12-01..04 OUTSTANDING
key-files:
  created: [docs/OPENSPEC.md, tests/unit/openspec-docs.test.ts]
  modified: [docs/RUNBOOK.md, tests/unit/docs-policy.test.ts]
key-decisions:
  - "docs/OPENSPEC.md is separate from WORKFLOWS.md; bootstrap.sh untouched"
requirements-completed: [OSPEC-1, OSPEC-2, OSPEC-4]
duration: 25min
completed: 2026-10-13
---

# Phase 12 Plan 04: Real install and OpenSpec docs Summary

Pre-authorised install of `@fission-ai/openspec@1.13.2` with `--ignore-scripts`, 12 flagged skills and 12 prompts live at user level at zero per-turn cost, plus the operator doc and governed RUNBOOK entries.

## Task 1 evidence (2026-10-13T00:28:05Z)
- Before: no openspec on PATH, no `~/.pi/agent/skills` or `prompts`. Node v24.16.0, npm 11.13.0.
- Integrity gate: `npm view ...@1.13.2 dist.integrity` = `sha512-HzBaN9C1/ET+tgm/pxbWQYY4Kf+X9/1MSVEGQ8ZT3g4ZpdHn6v82CHkN+zmt9qv98Ghw0MDpmURasjJD2f90bg==` (matches reviewed value). Scripts: only dev/build/test/release keys; no preinstall, install, postinstall or prepare.
- Install: `sh scripts/openspec-setup.sh --install-cli` ran `npm install -g --ignore-scripts @fission-ai/openspec@1.13.2` (70 packages). `openspec --version` = 1.13.2; `npm ls -g` shows `@fission-ai/openspec@1.13.2`.
- Setup: `sh scripts/openspec-setup.sh` installed 12 skills and 12 prompts; `--check` exit 0.
- Real output matched the fake (flag present, unquoted; `generatedBy: "1.13.2"`); 12 `openspec-*` dirs, 12 flagged, 12 `opsx-*` prompts. No script/fixture change needed.
- Skills index via Pi's `loadSkills`/`formatSkillsForPrompt`: before and after both SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, length 0 (equal). After: 12 skills loaded, 0 diagnostics.
- Telemetry: `openspec config get telemetry.enabled` = `false`. Real config.json holds featureFlags, profile core, delivery both, telemetry.enabled false; no anonymousId present.
- `git status` shows no `.pi` or `openspec` entries; `context-floor.test.ts` 4/4 pass.

## Commits
- 509a418 docs(12-04): OPENSPEC.md and pin-parity test (RED: ENOENT on missing doc, then 4/4)
- 9935963 docs(12-04): RUNBOOK Phase 12 and RB-12-01..04 registration (RED: docs-policy failed on all new ids before the RUNBOOK edit; then 143/143; openspec-docs 6/6; `tsc --noEmit` clean)

## Deviations from Plan
- The RUNBOOK pin-parity assertion was added in the Task 3 commit rather than Task 2, as the plan itself specified. Otherwise none.

## OUTSTANDING
RB-12-01 (work laptop and macOS), RB-12-02 (live Pi session), RB-12-03 (telemetry egress capture), RB-12-04 (upgrade drill).

## Known Stubs
None.

## Self-Check: PASSED
