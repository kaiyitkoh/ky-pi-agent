---
phase: 04-safety-deployment-guardrails
plan: 04
subsystem: safety
tags: [path-canonicalisation, windows-paths, unc, msys, path-policy, dotenv, tfstate, kubeconfig, detonation-targets]

# Dependency graph
requires:
  - phase: 04-safety-deployment-guardrails
    provides: "shell.ts's CanonicalInvocation shape and unbash Word.text/Word.value asymmetry (Plan 03/Plan 01) that motivate normalising path arguments on .text, never .value"
provides:
  - "canonicalisePathArg() in .pi/extensions/safety/paths.ts: one pure normalisation collapsing unquoted/double-quoted/single-quoted Windows paths, /c/, /cygdrive/c/, C:/, UNC, ~ and $HOME forms of the same file to one canonical string, resolved against a caller-supplied cwd/home rather than process.env"
  - "classifyPathRead(): SAFE-06's four sensitive-read classes (.env-family, ~/.aws/{credentials,config}, kubeconfig, *.tfstate) with a deliberate .env.example/.env.template carve-out"
  - "classifyPathWrite(): SAFE-13's eight detonation targets (.git/hooks/*, .git/config, ~/.bashrc, ~/.bash_profile, ~/.profile, ~/.gitconfig, .github/workflows/*.yml|yaml, .gitlab-ci.yml) checked ahead of SAFE-08's project-root containment"
  - "SENSITIVE_READ_PATTERNS and DETONATION_TARGETS as inspectable pattern tables, each entry proven live against a fixture"
affects: [04-08, 04-09, 04-11]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "normalise on the raw source slice (Word.text / tool-parameter string), never the escape-resolved form (Word.value) -- closes the exact Pitfall 3 asymmetry where an unquoted Windows path mangles under POSIX escape rules but its raw text does not"
    - "segment-matched policy tables, never substring matching -- 04-RESEARCH.md:485's 'exact paths, not patterns' rule, proven by a paired negative (docs/workflows.md, docs/hooks/README.md) for every blocked class"
    - "cwd/home/projectRoot/kubeconfigEnv are always caller-supplied parameters, never process.env or existsSync -- lets every rule be proven on a machine, and a path, that do not exist"
    - "detonation-target check runs before project-root containment in classifyPathWrite, so a hook file outside the project is blocked for the same reason as one inside it"

key-files:
  created:
    - .pi/extensions/safety/paths.ts
    - tests/unit/path-policy.test.ts
  modified: []

key-decisions:
  - "UNC's leading \\\\ pair is preserved as a distinct root marker rather than collapsed to // the way bin/bootstrap.sh's tr invocation does for PI_AGENT_DIR -- the plan's <action> text explicitly asks for this spelling ('EXCEPT in a leading UNC \\\\ pair'), and it keeps a UNC canonical form visually and structurally distinct from a drive-letter form without needing a second discriminator later. bootstrap.sh's actual byte-for-byte tr behaviour is cited for the drive-letter-vs-UNC DISTINCTION it draws, not copied literally."
  - "classifyPathRead/classifyPathWrite operate on an ALREADY-canonical path string, not on a PathWordArg -- callers (a later plan wiring shell.ts's CanonicalInvocation and the read/write/edit tool surface) are responsible for running canonicalisePathArg first. This keeps the two policy functions simple pure string/segment comparisons and matches the plan's own explicit interface: 'Both classifiers operate on the CANONICAL path from Task 1.'"
  - "No allowed-outside-root is defined for classifyPathWrite (e.g. system temp is NOT carved out) -- the plan's <behavior> says 'decide and state which; default is to block,' and this module takes the default: block. A later plan that needs a temp-directory carve-out must add it explicitly and name it in a comment, not receive it silently from this module."
  - "kubeconfigEnv (when supplied) is expected to already be a canonical absolute path -- classifyPathRead compares it to the canonical target via segment equality, it does not itself run canonicalisePathArg on it. Documented in the PathPolicyFacts docstring."

requirements-completed: [SAFE-06, SAFE-08, SAFE-13]

# Metrics
duration: 25min
completed: 2026-08-14
---

# Phase 4 Plan 4: Path Canonicalisation and Path Policy Layer Summary

**One pure `canonicalisePathArg()` collapsing every Windows/Git-Bash path form this machine produces to a single canonical string — verified by direct execution against unbash 4.0.10, not assumed from the plan's prose — plus `classifyPathRead`/`classifyPathWrite` implementing SAFE-06's sensitive-read block, SAFE-08's out-of-project containment, and SAFE-13's detonation-target block, all segment-matched and proven live by 57 mutation-verified tests.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-14T04:05:00Z (approx)
- **Completed:** 2026-08-14T04:29:52Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both created)

## Accomplishments

- `canonicalisePathArg()` normalises on unbash's raw `Word.text`, never `.value` — re-verified by executing unbash 4.0.10 directly during this plan (not merely trusted from Plan 01's characterisation table): an unquoted `C:\Users\Admin\.aws\credentials` mangles to `C:UsersAdmin.awscredentials` in `.value` while `.text` preserves it intact, and the double-/single-quoted forms agree with the unquoted one only after this module strips their own quote marks from `.text`.
- Ten distinct path spellings for one file — unquoted, double-quoted, single-quoted, `/c/`, `/cygdrive/c/`, `C:/`, lowercase-drive, `~/`, `$HOME/`, `${HOME}/` — all canonicalise to the identical string `C:/Users/Admin/.aws/credentials` against a fixture home, closing the exact warning 04-RESEARCH.md Pitfall 3 names ("a rule that fires for the quoted form and silently passes the unquoted one").
- UNC paths (`\\server\share\pi\file`) canonicalise to a form that never matches a drive-letter pattern, and a `..` inside a UNC path cannot climb past the server+share root — mirrors, but does not byte-for-byte copy, `bin/bootstrap.sh:63-83`'s drive-letter/UNC discrimination.
- Drive-letter case is normalised to uppercase for comparison while the rest of the path's case is left completely alone — proven by a positive (C: == c:) and a negative (`Users` vs `USERS` remain distinct strings) test pair.
- `classifyPathRead` blocks SAFE-06's four classes (`.env`-family, `~/.aws/{credentials,config}`, kubeconfig, `*.tfstate`/`*.tfstate.backup`) with a deliberate `.env.example`/`.env.template` carve-out, and allows every named false-positive neighbour (`README.md`, `src/config.ts`, `src/environment.ts`, a `config` file whose parent isn't `.aws`/`.kube`).
- `classifyPathWrite` blocks SAFE-13's eight detonation targets ahead of SAFE-08's project-root containment check, so `.git/hooks/pre-commit`, `.git/config`, `~/.bashrc`, `~/.bash_profile`, `~/.profile`, `~/.gitconfig`, `.github/workflows/*.yml|.yaml` and `.gitlab-ci.yml` are all refused, paired against negatives (`docs/workflows.md`, `docs/hooks/README.md`, `notes/gitconfig-backup.md`) proving the match is on SEGMENTS, not substrings.
- 57 table-driven tests across two task-scoped commits, every fixture mutation-verified by neutering the subject function (`canonicalisePathArg` to identity, `classifyPathRead`/`classifyPathWrite` to always-allow), confirming 11, 9 and 13 rows respectively go red, then restoring.
- Every entry in `SENSITIVE_READ_PATTERNS` and `DETONATION_TARGETS` proven reachable by at least one fixture row via a dedicated liveness test that calls each pattern's `.match()` directly and asserts the observed-id set covers the exported table.

## Task Commits

1. **Task 1: canonicalisePathArg — one normalisation that survives every Windows/Git-Bash form** - `69ccec9` (feat)
2. **Task 2: The three path policies — sensitive reads, out-of-project writes, detonation targets** - `2cddbc3` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified

- `.pi/extensions/safety/paths.ts` (new, 373 lines) — `canonicalisePathArg()`, `classifyPathRead()`, `classifyPathWrite()`, `SENSITIVE_READ_PATTERNS`, `DETONATION_TARGETS`, `PathVerdict`, `PathPolicyFacts`, `PathWordArg`, `PathResolutionContext` — every export the plan's artifact contract names, all pure (no `ctx`, no `node:fs`, no `process.env`, no `existsSync`)
- `tests/unit/path-policy.test.ts` (new, 372 lines) — 57 tests: the ten-row canonicalisation equivalence table (Task 1), relative/UNC/case-normalisation tables (Task 1), the 15-row `classifyPathRead` table plus liveness check (Task 2), the 16-row `classifyPathWrite` table plus liveness check (Task 2)

## Decisions Made

See `key-decisions` in frontmatter. In summary: UNC's leading `\\` pair is preserved as a distinct root marker (not collapsed to `//` the way `bin/bootstrap.sh`'s literal `tr` does) per the plan's own explicit wording; `classifyPathRead`/`classifyPathWrite` take an already-canonical path string rather than a `PathWordArg`, matching the plan's stated interface; no allowed-outside-root is defined for writes, taking the plan's stated default (block); `kubeconfigEnv` is documented as caller-pre-canonicalised.

## Deviations from Plan

None — plan executed exactly as written. Both Task 1 and Task 2 acceptance criteria were verified directly (unbash executed live to confirm the `text`/`value` asymmetry table before writing fixtures, matching this plan's own directive to verify at source).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. This plan adds no new dependency; it is pure TypeScript with no imports at all.

## Next Phase Readiness

- Plan 08 (the non-bash `write`/`edit` tool surface) and Plan 09 (the `tool_call` hook) can now import `canonicalisePathArg`, `classifyPathRead` and `classifyPathWrite` directly. Note for whichever plan wires `shell.ts`'s `CanonicalInvocation` into this module: `CanonicalInvocation.args` is currently `readonly string[]` (already `.value`-resolved, per `shell.ts`'s `extractInvocations()`), not `Word[]` — a caller wanting the raw `Word.text` for an argument reached via bash will need either the original `Word` from the parsed AST (not currently threaded through `CanonicalInvocation`) or an extension to `shell.ts` to carry it. This module's `canonicalisePathArg` signature (`{ text, value }`) is ready for either; it does not itself need to change.
- `PathPolicyFacts.projectRoot` and `PathPolicyFacts.kubeconfigEnv` are documented as expected to already be canonical (the caller's responsibility) — the wiring plan should canonicalise them once at setup time rather than per-call.
- No blockers. `npm test` is green at 794/794 (up from 737 at the end of Plan 03; the delta is this plan's 57 new tests), `tsc --noEmit` clean.

---
*Phase: 04-safety-deployment-guardrails*
*Completed: 2026-08-14*

## Self-Check: PASSED

- FOUND: .pi/extensions/safety/paths.ts
- FOUND: tests/unit/path-policy.test.ts
- FOUND: commit 69ccec9 (Task 1)
- FOUND: commit 2cddbc3 (Task 2)
