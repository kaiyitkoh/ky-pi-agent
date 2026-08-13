---
phase: 01-bootstrap-packaging-supply-chain
plan: 05
subsystem: bootstrap
tags: [posix-sh, supply-chain, npm, windows-portability, idempotence, boot-01, boot-03, boot-04]
requires:
  - committable-npmrc-controls
  - env-template-marked-region
  - path-stub-factory
provides:
  - cold-machine-bootstrap
  - ordering-proof-seam
  - published-pin-preflight
  - env-example-generator
  - user-scope-npm-hardening
affects:
  - bin/
  - tests/
  - "~/.pi/agent (machine state, outside the repo)"
tech-stack:
  added: []
  patterns:
    - "Assert the EFFECT through npm, never the presence of a file — a correctly-placed .npmrc can still be ineffective"
    - "Strip npm_config_* before asking npm anything; env config outranks every .npmrc"
    - "Discriminate registry failures on the literal E404 token, never on the exit code — both shapes exit non-zero"
    - "Node compares node; no version-sorting shell trick survives BSD userland"
    - "All JSON read/parse/merge/write goes through `node -e`, key-namespaced, never a whole-file rewrite"
    - "Ordering is enforced by source layout, not by a comment: all hardening call sites precede the single install call site"
key-files:
  created:
    - bin/bootstrap.sh
    - tests/unit/version-gate.test.ts
    - .env.example
  modified:
    - tests/helpers/stub-bin.ts
decisions:
  - "--check-only and --assert-hardening are separate modes: one must exit 0 on a clean CI runner, the other must exit 1 in exactly that situation"
  - "bootstrap sanitises npm_config_* out of its own environment before every npm query — otherwise a run under `npm run` certifies a control it never exercised"
  - "E404-token detection replaces RESEARCH's leading-quote-zero heuristic, which would misclassify any 1.x pin as unpublished"
  - "The full bootstrap was executed for real against ~/.pi/agent, closing Plan 04's OUTSTANDING user-scope machine-state check"
  - "stub-bin.ts gained a stderr channel rather than the test settling for a stdout-only approximation of npm's failure shape"
metrics:
  duration: ~35 min
  completed: 2026-08-13
  tasks: 2
  commits: 2
---

# Phase 1 Plan 05: Cold-Machine Bootstrap & the BOOT-04 Version Gate Summary

A 523-line POSIX `sh` script that structurally cannot reach `npm install` without first having asked npm, three times, whether lifecycle scripts are disabled — plus a test proving the pinned-version preflight tells a yank apart from a dead network.

## What Was Built

**Task 1 — `bin/bootstrap.sh` (commit `dd7c0b9`)**

Four modes plus `--help`, three documented test seams (`PI_CODING_AGENT_DIR`, `KYPI_PI_PINNED`, `KYPI_SKIP_INSTALL`), and no build step, no PowerShell, no external JSON processor, no version-sorting shell trick, no bash-only syntax.

| Mode | Does | Mutates | Exit on a clean CI runner |
|---|---|---|---|
| (none) | probe → verify pin → assert → harden → install → configure | yes | 0 |
| `--check-only` | every probe + both repo-side assertions | **no** | 0 (user scope WARNs with a remedy) |
| `--assert-hardening` | the three `ignore-scripts` assertions only | **no** | **1** — this is the ordering proof |
| `--check-version` | the published-pin preflight only | no | 0 |

Functions: `require_node` (a `node -e` gate on `process.versions.node`), `probe_tools` (8 tools, each labelled `required` or `optional`), `check_pi_version_published`, `assert_ignore_scripts_for`, `assert_repo_scopes`, `assert_user_scope`, `harden_pi_npm_root`, `report_user_scope`, `pi_global_matches_pin`, `install_pi`, `merge_settings`, `write_env_template`.

`.env.example` is generated from the marked region of `.pi/templates/env.example` and is committed — it came out byte-identical to the template on this first run, since the target did not yet exist.

**Task 2 — `tests/unit/version-gate.test.ts` (commit `ccf744a`)**

Three cases, each spawning `sh bin/bootstrap.sh --check-version` as a real subprocess. No skip, no conditional bail-out, no in-process reimplementation of the logic under test.

## Key Implementation Details

**The ordering clause is enforced by source layout, not by a comment.** `run_full()` calls `assert_repo_scopes`, then `harden_pi_npm_root` (which ends in its own assertion), and only then `install_pi`. Every literal `assert_ignore_scripts_for` call site in the file — there are four, all inside helper functions defined near the top — appears before the single `install_pi` call site at byte offset ~19k. That is machine-checkable, and it is checked:

```
BOOTSTRAP_OK lines=524
```
(the audit verifies: no forbidden constructs, no CR byte, `harden_pi_npm_root` defined before `install_pi`, no assertion call site after the install call site, and `assert_repo_scopes`/`harden_pi_npm_root` before `install_pi` *within* `run_full`'s body specifically.)

**Stripping `npm_config_*` is load-bearing, not hygiene.** Plan 04 discovered that `npx` and `npm run` export the fully resolved config as `npm_config_*`, and npm ranks environment config above every `.npmrc`. The same trap applies to this script and is worse here, because this script is the thing that *decides whether to install*. Run through `npm run bootstrap`, an unsanitised version would report `true` for a directory containing no config at all and cheerfully proceed to install. `sanitise_npm_env()` unsets every `npm_config_*` key that is a valid shell identifier before any npm query. Keys npm exports that are *not* valid identifiers (`npm_config_//registry.npmjs.org/:_authToken`) are deliberately left alone: `unset` is a POSIX special built-in and an error in one can terminate the shell even under `|| true`. Those keys are per-registry auth, not policy.

**Windows path handling, measured not assumed.** MSYS converts POSIX paths to Windows form when Git Bash execs a native binary, so `npm config get ignore-scripts --prefix /c/Users/.../.pi/npm` answers correctly (verified: `true`, against `false` for a bare temp prefix). The reverse direction needed help: a `PI_CODING_AGENT_DIR` arriving from a Node-launched test carries backslashes, which MSYS `mkdir` treats literally. The script normalises backslashes to forward slashes **only** for a drive-letter path, never for a genuine POSIX one.

**`merge_settings` writes only the `kyPiAgent` key**, via `node -e` read/parse/merge/write with 2-space indentation, and refuses outright if the existing file is not a JSON object. It reports `unchanged` when the key already matches, so re-running produces a byte-identical file. Pi's tolerance for the unknown key was verified live rather than assumed — see Verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RESEARCH's published-version test would misclassify any non-0.x pin**

- **Found during:** Task 1
- **Issue:** RESEARCH §3.3 detects "published" with `[ "${out#*\"0}" != "$out" ]` — literally "the output contains a quote followed by a zero". Correct for `"0.84.1"`, and wrong the day Pi ships 1.0.0: a perfectly published pin would fall through to the E404 case, miss, hit the catch-all, and tell the user the registry is unreachable. Pi ships every 2–3 days; this is a dated heuristic, not a check.
- **Fix:** Capture npm's exit code explicitly and require `rc == 0` **and** non-empty output **and** no `error` token. Version-agnostic.
- **Files modified:** `bin/bootstrap.sh`
- **Commit:** `dd7c0b9`

**2. [Rule 2 - Missing critical functionality] The script had to strip `npm_config_*` from its own environment**

- **Found during:** Task 1
- **Issue:** Not in the plan. Without it, `npm run bootstrap`, or any invocation from a test suite launched by npm, makes all three hardening assertions answer `true` unconditionally — including for a temp directory with no `.npmrc`. The script would then proceed to install, having proven nothing. This is the exact failure Plan 04 caught in its own test suite, one layer up and with real consequences instead of a false green.
- **Fix:** `sanitise_npm_env()`, called first in every mode, with the evidence and the special-built-in caveat documented inline.
- **Files modified:** `bin/bootstrap.sh`
- **Commit:** `dd7c0b9`

**3. [Rule 1 - Bug] Two comments tripped the plan's own source audit**

- **Found during:** Task 1 verification
- **Issue:** The portability header said "no `[[ ]]`" and "No `sort -V`" — so the file literally contained both forbidden strings, failing its own acceptance criterion. A third comment named `install_pi` above the definition of `harden_pi_npm_root`, which inverts a naive first-index ordering comparison. Same class as Plan 01's `.npmrc` comment tripping its credential assertion and Plan 02's docstring tripping its skip audit; third occurrence in this phase.
- **Fix:** Reworded all three to describe the constructs without naming them literally. The audit now passes and a naive index comparison also gives the right answer.
- **Files modified:** `bin/bootstrap.sh`
- **Commit:** `dd7c0b9`

**4. [Rule 3 - Blocking] `StubSpec` had no stderr channel**

- **Found during:** Task 2
- **Issue:** The plan requires case 3's stub `npm` to fail "with a connection-error message on stderr". `withStubBin` could only write stdout. Approximating with stdout would have made the stub a poor model of npm, which genuinely splits structured error (stdout, `--json`) from human error (stderr).
- **Fix:** Additive `stderr?: string` on `StubSpec`, written with `writeSync(2, ...)` for the same no-truncation reason as stdout. Existing callers unaffected; all 120 tests still pass.
- **Files modified:** `tests/helpers/stub-bin.ts`
- **Commit:** `ccf744a`

### Decisions taken without asking (autonomous run policy)

- **The full bootstrap was executed for real** against `~/.pi/agent`, not only against a temp directory. It is idempotent, key-namespaced, and it is the documented owner of that state (RESEARCH Runtime State Inventory). Doing so closes Plan 04's recorded OUTSTANDING item: user-scope hardening is no longer mechanism-only. A copy of the pre-run agent directory was taken first. `install_pi` correctly no-oped — the pinned 0.84.1 was already the global version.
- **A fourth "positive control" case was kept out of the test file** because the acceptance criterion names exactly three passing cases. It was run as an ad-hoc probe instead and the evidence is recorded below.

No architectural changes. No auth gates. No checkpoints. No package installs attempted.

## Verification Results

Every plan-level and acceptance check, executed on this machine (Windows 11, Git Bash, node 24.16.0, npm 11.13.0, git 2.54.0.windows.1):

```
sh -n bin/bootstrap.sh                                     -> exit 0
sh bin/bootstrap.sh --help                                 -> exit 0, names all 5 required tokens
sh bin/bootstrap.sh --check-only  (x2)                     -> exit 0/0, diff -q: BYTE_IDENTICAL
   stdout contains "glab"                                  -> yes
   stdout contains "optional"                              -> yes
sh bin/bootstrap.sh --assert-hardening                     -> exit 0 (live, after the real full run)
PI_CODING_AGENT_DIR=<empty tmp> ... --assert-hardening     -> exit 1, stderr has "ignore-scripts"
KYPI_PI_PINNED=0.84.1 ... --check-version                  -> exit 0
KYPI_PI_PINNED=0.73.0 ... --check-version                  -> exit 1, stderr has 0.73.0 + Fallback
sh bin/bootstrap.sh --bogus                                -> exit 2 + usage
source audit (no jq / version-sort / [[ / .ps1 / CR)       -> BOOTSTRAP_OK lines=524
CR scan over `git ls-files -- "*.sh"`                      -> 1 file scanned, CR-free
npx tsc --noEmit                                           -> TYPECHECK_OK
npx vitest run tests/unit/version-gate.test.ts             -> 3 passed
npx vitest run tests/unit                                  -> 7 files, 116 tests passed
npm test (whole suite)                                     -> 8 files, 120 tests passed
grep -rnE '(it|describe|ctx|test)\.skip' tests/            -> no matches
```

**Full run, twice, against a throwaway agent dir** (`PI_CODING_AGENT_DIR=<tmp> KYPI_SKIP_INSTALL=1`):

| Run | user-scope `.npmrc` | `settings.json` | `.env.example` |
|---|---|---|---|
| 1 | `wrote …/npm/.npmrc` | `kyPiAgent key merged` | `written from .pi/templates/env.example` |
| 2 | `already hardened` | `already current - unchanged` | `already current - unchanged` |

Both exit 0. The must-have "re-running the script changes nothing" holds at the byte level for both generated files.

**Real full run** against `~/.pi/agent`, and the consequence checked:

```
wrote /c/Users/Admin/.pi/agent/npm/.npmrc
ignore-scripts=true  user-scope prefix (/c/Users/Admin/.pi/agent/npm)
@earendil-works/pi-coding-agent@0.84.1 already installed globally - no action
settings.json kyPiAgent key merged
```
```
pi --offline --version                                   -> 0.84.1, exit 0
cd <repo> && pi --offline -a --list-models | grep -c ky-harness-selftest -> 1
sh bin/bootstrap.sh --assert-hardening                   -> all three scopes true, exit 0
```

Pi 0.84.1 tolerates the unknown `kyPiAgent` top-level key: it starts, reports its version, and still loads the project-local sentinel extension. That was verified rather than assumed, because a settings schema that rejected unknown keys would have bricked the harness on every future bootstrap.

**Mutation check — case 3 is live** (plan acceptance criterion 5). The E404 branch was replaced with a bare non-zero-exit check:

```
FAIL tests/unit/version-gate.test.ts > case 3: an unreachable registry is not
     reported as an unpublished pin
  expect(run.stderr).not.toMatch(/unpublish|yanked|no longer published/i)
  received: "FATAL: pinned Pi version unknown is no longer published on npm. …"
Tests  1 failed | 2 passed (3)
```

Restored immediately; `git diff bin/bootstrap.sh` clean, `sh -n` clean, 3 passed again.

**Positive control — the stub is genuinely consulted.** Case 3's non-zero exit only means something if the stubbed `npm` is what answered. Forcing the same stub to emit `E404` for a pin that *is* published flips the verdict on the same PATH mechanism:

```
POSITIVE CONTROL: stub npm forced to answer E404 for a pin that IS published
exit: 1
stderr line 1: FATAL: pinned Pi version 0.84.1 is no longer published on npm.
stub was consulted: true
```

Case 3's absence-of-yank-wording is therefore attributable to the stub, not to an unstubbed real `npm` that happened to succeed.

## Requirements Satisfied

- **BOOT-01 (ordering)** — the script cannot reach an install without three passing `npm config get` assertions. Enforced by source layout and audited mechanically; the failure path was executed (`PI_CODING_AGENT_DIR` at an empty temp dir → exit 1 with `ignore-scripts` on stderr).
- **BOOT-03** — Node gate via `node -e`; 8-tool probe with explicit `required`/`optional` labels; `glab` optional and named on every run; two consecutive `--check-only` runs byte-identical.
- **BOOT-04** — an unpublished pin produces a message naming the version, the package, the current `latest` and a three-step fallback; a network failure produces a categorically different message that never says the pin was withdrawn. Both proven by test, and the discrimination proven live by mutation.

## Known Stubs

None. `.env.example` carries variable names with empty values by design — it is a template, and the empty values are the security property (RESEARCH §6, threat T-01-18), not an unfinished implementation.

## Threat Flags

None. The plan's `<threat_model>` covers every surface this plan touches. Two mitigations are worth naming as *implemented* rather than merely planned: T-01-01 (three assertions before `install_pi`, asserting npm's reported effective config) and T-01-16 (E404-token discrimination, asserted by version-gate case 3 in both directions).

One new surface was considered and is **not** a flag: the script writes into `~/.pi/agent`, which the plan's trust-boundary table already names. It creates exactly two files there, both idempotent, and touches one namespaced key of a third.

## Notes for Next Plan

- `sh bin/bootstrap.sh --check-only` is CI-ready and deterministic. Wire it into the matrix workflow with `shell: bash` — under the pwsh default the step silently does not run as intended (RESEARCH Pitfall 4).
- `--assert-hardening` is the runbook re-check and the ordering seam. Point `PI_CODING_AGENT_DIR` at an empty temp dir to make it fail on purpose.
- `bin/bootstrap.sh` is the only tracked `*.sh` file so far, so the BOOT-06 CR scan and the Ubuntu shellcheck job currently have exactly one input. `shellcheck` is absent locally and on both matrix runners — the dedicated Ubuntu job is the only place conformance actually gets checked.
- `~/.pi/agent/npm/.npmrc` now exists on this machine. Any future test that wants to observe the *unhardened* user scope must redirect `PI_CODING_AGENT_DIR`; asserting against the real home directory will now pass for the wrong reason.
- `withStubBin` accepts `stderr` as well as `stdout`. Still synchronous-only.
- `bin/.gitkeep` is now redundant. Left in place; removing it is a one-line tidy for whoever touches `bin/` next.

## Self-Check: PASSED

- `bin/bootstrap.sh` — FOUND (523 lines, contains `ignore-scripts`, min_lines 150 satisfied)
- `tests/unit/version-gate.test.ts` — FOUND
- `.env.example` — FOUND
- `tests/helpers/stub-bin.ts` — FOUND (modified)
- Commit `dd7c0b9` — FOUND in `git log`
- Commit `ccf744a` — FOUND in `git log`
- Key link `bin/bootstrap.sh` → `npm config get ignore-scripts` before the install step — PRESENT and mechanically audited
- Key link `bin/bootstrap.sh` → `npm view …` discriminating on `E404` — PRESENT and mutation-tested

Working tree clean apart from the planning artifacts committed alongside this summary. Verified 2026-08-13.
