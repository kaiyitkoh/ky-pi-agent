---
phase: 10-context-budget-progressive-disclosure
plan: 06
subsystem: context-experiment
tags: [experiment, launcher, posix-sh, env-scrub]
requires: ["10-05"]
provides:
  - "scripts/ctx-experiment.sh: one-command POSIX launcher, env -i scrubbed per-trial runs"
  - "scripts/ctx-experiment.mjs: plan, prepare, settings, pad, args, summarise subcommands over the pure core"
  - "docs/DIAGNOSTICS.md Context-pollution experiment section"
key-files:
  created:
    - scripts/ctx-experiment.sh
    - scripts/ctx-experiment.mjs
    - tests/unit/ctx-experiment-launcher.test.ts
  modified:
    - docs/DIAGNOSTICS.md
requirements-completed: [CTX-05]
completed: 2026-10-13
---

# Phase 10 Plan 06: Experiment launcher Summary

The pre-registered experiment now runs from one sh command (`KY_EXP_MODEL=... KY_EXP_KEY_VAR=... sh scripts/ctx-experiment.sh`). Every trial runs a fresh disposable repo under `env -i` with an allowlist (PATH, SYSTEMROOT, the one key variable) and temp HOME/USERPROFILE/TMP/PI_CODING_AGENT_DIR. The live run stays RB-10-01 (appended by 10-07).

## Tests
- `tests/unit/ctx-experiment-launcher.test.ts`: 4 pass. Fake `pi` records env and argv; polluted `AWS_PROFILE`/`AWS_SECRET_ACCESS_KEY` never appear; key var passes; HOME/agent dir are per-trial; four jsonl files; arm flags distinguish A/C/F; summary.json has n=1 per arm and a decision; missing `KY_EXP_MODEL` exits non-zero before any trial; `summarise` direct test; unknown subcommand exits 2.
- Mutation check: replacing `env -i` with `env` made the scrub test fail (expected true to be false on the AWS_ assertion); restored.
- `lf-and-shell.test.ts` 19 pass, `docs-policy.test.ts` 122 pass, `npx tsc --noEmit` exits 0 (once).
- Acceptance greps: `env -i` count 2, `AWS_|eval ` count 0, `plan --repeats 1` prints 24 lines.

## Deviations from Plan
- **prepare layout**: `prepare <defectId> <trialRoot>` creates `<trialRoot>/repo` and writes `prompt.md` beside it, not inside the repo, so the model's cwd does not contain the prompt file.
- **extra `settings` subcommand**: writes the agent dir settings.json from node so the local package path is a native absolute path (Git Bash `pwd` paths are not valid for a native pi). Arms B/F get `packages: [<repo root>]`; local-path form per docs/packages.md ("Loaded from the resolved path without copying").
- **trial file names** sanitise ':' to '_' (Windows rejects it in file names); `trials.tsv` keeps the original ids.
- **summarise active tools**: harness arms are judged against the minimal four tool names for the prose check (the exact harness tool list is not enumerable offline).
- Key variable names beginning with `AWS_` (any case) are rejected by the launcher.

## Known Stubs
None.

## Self-Check: PASSED
Commits 0433fca (launcher, CLI) and 176b0d9 (test, doc) exist; all listed files present.
