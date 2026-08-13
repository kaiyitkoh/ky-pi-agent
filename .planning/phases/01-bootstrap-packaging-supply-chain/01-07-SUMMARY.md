---
phase: 01-bootstrap-packaging-supply-chain
plan: 07
subsystem: safety
tags: [safety, exfiltration, github-cli, posix-sh, path-stub, outstanding-runbook]
requires:
  - path-stub-factory
  - git-repo-root-helper
provides:
  - safe16-share-control-script
  - safe16-classifier-proof
affects:
  - scripts/
  - tests/unit/
tech-stack:
  added: []
  patterns:
    - "A control over a third-party tool is classified by asking that tool, and proven against a stub of it — never against the developer's machine state"
    - "Every stubbed case asserts from the stub's own call log that the stub, not the real binary, answered"
    - "Bidirectional classifier proof: the same script under inverted stub states must produce inverted exit codes"
    - "A dev-machine escape hatch (--warn-only) downgrades the exit code but never the message"
key-files:
  created:
    - scripts/check-gh-unauthenticated.sh
    - tests/unit/gh-unauthenticated.test.ts
  modified: []
decisions:
  - "Argument parsing is a `case` statement with an unknown-arg exit 2, not RESEARCH's bare `[ \"$1\" = ... ] && ...` one-liner — matches bin/bootstrap.sh and makes a typo'd flag loud instead of silently ungated"
  - "Every case asserts the stub's call log contains `gh auth status`, beyond the plan's four assertions — without it a PATH-ordering mistake silently converts the suite into an assertion about the developer's keyring"
  - "Case 4 narrows PATH to the stub dir alone and resolves `sh` to an absolute path up front — the real `gh` is on this machine's PATH, so `withStubBin`'s default prepend-only PATH cannot simulate its absence"
  - "Assertions use /gh\\s+auth\\s+logout/ so the test file never contains the literal logout command — the same self-tripping-audit class as Plan 02's `it.skip` docstring"
metrics:
  duration: ~18 min
  completed: 2026-08-13
  tasks: 2
  commits: 2
---

# Phase 1 Plan 07: SAFE-16 `/share` Control Summary

Shipped the only control that exists over Pi's `/share` — a POSIX sh classifier over `gh auth status` with a dev-machine `--warn-only` mode — and proved it fires in both directions against a PATH-stubbed `gh`, leaving the developer's real GitHub login byte-for-byte intact.

## What Was Built

**Task 1 — `scripts/check-gh-unauthenticated.sh` (commit `c3c4008`)**

Strict POSIX `sh`, LF, no bashisms, 100 lines of which roughly half are the evidence block. Three branches:

| `gh` state | stdout / stderr | bare | `--warn-only` |
|---|---|---|---|
| not on PATH | `OK: gh is not installed; /share cannot upload.` (stdout) | 0 | 0 |
| `gh auth status` exit 0 | four-line warning + remedy (stderr) | **1** | 0 |
| `gh auth status` non-zero | `OK: gh is unauthenticated; /share aborts before export.` (stdout) | 0 | 0 |

The header records the whole control at source, because this is the finding most likely to be re-litigated:

- `/share` exports the entire session to `os.tmpdir()/session.html` (`interactive-mode.ts:5869`) and posts it with `gh gist create --public=false` (`:5907`). "Secret gist" is unlisted, not private.
- **Closed door 1** — it is matched as a literal string in the interactive submit handler (`:2902`) and listed in `src/core/slash-commands.ts:25`, dispatched *before* extension commands and *before* the `input` event. No hook the authored safety layer could register is upstream of it.
- **Closed door 2** — `--remove-scopes gist` is not a workaround: `repo`, `read:org` and `gist` are the documented non-removable minimum set (gh 2.93.0).
- The one branch that stops it is `if (authResult.status !== 0) { … return; }` at `:5856-5866`, which returns *before* the export at `:5869` — so an unauthenticated `gh` means the transcript is never even written to disk.

A closing block states the split: the dev machine runs `--warn-only` because `gh` is legitimately authenticated here for git-over-HTTPS (no SSH key exists); the work-laptop runbook runs it bare.

**Task 2 — `tests/unit/gh-unauthenticated.test.ts` (commit `46533aa`)**

Four cases, each spawning `sh scripts/check-gh-unauthenticated.sh` as a subprocess with a `PATH` from `withStubBin`:

| Case | Stub | Args | Asserts |
|---|---|---|---|
| 1 | `gh` exit 0 | — | exit **1**, stderr matches the logout remedy and `gist` |
| 2 | `gh` exit 1 | — | exit **0**, stdout `unauthenticated` + `aborts` |
| 3 | `gh` exit 0 | `--warn-only` | exit **0**, stderr still carries the warning, stdout carries no `OK:` |
| 4 | none, PATH narrowed | — | exit **0**, stdout `cannot upload`, **zero** `gh` invocations |

Cases 1 and 2 are the classifier proof — the same script, inverted stub state, inverted exit code. A script hardcoded to exit 0 passes case 2 and fails case 1; one hardcoded to exit 1 does the reverse. Neither can pass both.

## Key Implementation Details

**The stub call log is the proof the real `gh` was never touched.** `withStubBin`'s `logTo` writes one `gh <argv>` line per invocation into a directory the test owns (a second `mkdtemp`, outside the stub dir, so it survives `withStubBin`'s `finally` cleanup — it is read inside `fn`). Cases 1–3 assert the log contains `gh auth status`; case 4 asserts it is empty. Without this, a PATH-ordering mistake would leave a green suite that had silently been asserting against the developer's OS keyring — exactly the failure mode `stub-bin.ts` was built to prevent.

**Case 4 needed more than `withStubBin` provides.** `withStubBin` *prepends* its temp dir to the inherited PATH, so the real `gh` (`C:\Program Files\GitHub CLI\gh`) stays reachable. Simulating a machine with no GitHub CLI therefore required narrowing the child's PATH to the stub directory alone. That in turn means `sh` itself has to be located before the narrowing, so `resolveSh()` runs `where sh` / `which sh` once against the real environment and the test spawns the absolute path (`C:\Program Files\Git\usr\bin\sh.exe` here). It **throws** with an install remedy if `sh` is not found — no skip path, per the Plan 02 house rule. The script's only external command is `gh`; everything else it uses (`printf`, `echo`, `command -v`, `[`, `case`) is a shell builtin, so a one-entry PATH is enough to run it.

**`set -e` and the `[ … ] && x` argument parse.** RESEARCH's sample body parses the flag with `[ "$1" = "--warn-only" ] && warn_only=1`. Measured before trusting it (Git Bash, executed 2026-08-13): with no argument the script reaches the next line and exits 0 — errexit is correctly ignored for a non-final command of an AND-OR list. So the sample was not broken. It was still replaced by a `case` statement (see Deviations) for a different reason: an unknown argument silently behaved as a bare invocation.

**Windows stub reachability, confirmed rather than assumed.** Git Bash's `command -v gh` resolves the extensionless POSIX launcher `withStubBin` writes (msys treats a `#!`-prefixed file as executable), which `exec`s node on the `.mjs` payload, so the stub's exit code propagates through `sh` to `spawnSync`. Verified with a standalone probe before the test was written. This is the *inverse* direction to Plan 02's known limitation: that limitation is about Pi spawning `gh` with `shell:false`, which is not what happens here — our own `sh` does the resolving.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Unknown arguments were silently treated as a bare run**

- **Found during:** Task 1
- **Issue:** RESEARCH's body sets `warn_only=1` only on an exact `--warn-only` match and ignores everything else. `sh check-gh-unauthenticated.sh --warnonly` would therefore run in the *strict* mode and exit 1 on the dev machine, and `--warn-only=1` likewise — a flag typo in CI or in the runbook would look like a real finding. The inverse mistake is worse in the other direction on a shared script.
- **Fix:** Replaced the `&&` one-liner with a `case` statement: empty → strict, `--warn-only` → warn, anything else → usage on stderr and exit 2. Matches `bin/bootstrap.sh`'s existing unknown-argument handling exactly.
- **Files modified:** `scripts/check-gh-unauthenticated.sh`
- **Commit:** `c3c4008`

**2. [Rule 2 - Missing critical functionality] Nothing proved the stub, rather than the real `gh`, had answered**

- **Found during:** Task 2
- **Issue:** The plan's four cases assert only exit codes and output text. On this machine the real `gh` exits 0, so a broken PATH prepend would make case 1 pass for the wrong reason — and case 3 too. The suite would be green while asserting against the developer's keyring, which is precisely threat T-01-07.
- **Fix:** Every case now asserts the stub's `logTo` call log. Cases 1–3 require `gh auth status` in it; case 4 requires it empty.
- **Files modified:** `tests/unit/gh-unauthenticated.test.ts`
- **Commit:** `46533aa`

**3. [Rule 1 - Bug] The remedy assertion would have tripped the plan's own source audit**

- **Found during:** Task 2
- **Issue:** Acceptance criterion 4 requires the test source to contain no `gh auth logout` invocation. The natural assertion — `expect(run.stderr).toContain("gh auth logout")` — puts that literal in the file, so a grep-based audit flags it. Same class as Plan 02's `it.skip` docstring and Plan 01's `.npmrc` comment.
- **Fix:** Assertions use `/gh\s+auth\s+logout/`, and the prose says "logging out" rather than the command. The literal appears nowhere in `tests/`.
- **Files modified:** `tests/unit/gh-unauthenticated.test.ts`
- **Commit:** `46533aa`

**4. [Rule 3 - Blocking] TypeScript rejected the conditional stub map**

- **Found during:** Task 2 verification
- **Issue:** `ghExitCode === null ? {} : { gh: {...} }` widens to `{ gh?: undefined } | { gh: StubSpec }`, which is not assignable to `Record<string, StubSpec>` (TS2345).
- **Fix:** Annotated the binding `Record<string, StubSpec>` and imported `StubSpec` as a type-only import.
- **Files modified:** `tests/unit/gh-unauthenticated.test.ts`
- **Commit:** `46533aa`

No architectural changes. No checkpoints. No authentication gates. No package installs were attempted.

## Decisions Made

1. **`case` argument parsing with an unknown-arg exit 2** — consistency with `bin/bootstrap.sh` and a loud failure on a typo'd flag.
2. **Stub-provenance assertions in all four cases** — the cheapest possible guard against the suite quietly becoming a machine-state assertion.
3. **`resolveSh()` throws, never skips** — the Plan 02 house rule; a skipped supply-chain check is a green run that verified nothing.
4. **The two closed doors are asserted nowhere and documented everywhere.** They are properties of Pi 0.84.1 and of gh 2.93.0, not of this repo; a unit test asserting them would be testing someone else's binary. They live in the script header (threats T-01-21, T-01-22, both dispositioned `accept`).
5. **No `gh auth status` assertion inside the test.** The plan's verify command runs it *outside* the suite. Inside, it would be an assertion against the real keyring — forbidden by acceptance criterion 5, and it would go red on any CI runner with no `gh`.

## Verification Results

Every plan-level check, executed on this machine (Windows 11, Git Bash, node 24.16.0, gh 2.93.0):

```
sh -n scripts/check-gh-unauthenticated.sh            -> exit 0  (SYNTAX_OK)
sh scripts/check-gh-unauthenticated.sh --warn-only   -> exit 0  (warning on stderr)
sh scripts/check-gh-unauthenticated.sh               -> exit 1  (the real gate)
node -e "<CRLF / [[ / control / remedy / cite scan>" -> GH_SCRIPT_OK
npx tsc --noEmit                                     -> exit 0  (TYPECHECK_OK)
npx vitest run tests/unit/gh-unauthenticated.test.ts -> 4 passed
npm test  (whole suite)                              -> 9 files, 124 tests passed
gh auth status                                       -> exit 0  (GH_LOGIN_INTACT)
node -e "<forbidden-literal audit of the test file>" -> TEST_AUDIT_OK
```

The audit confirms the test source contains none of: `gh auth logout`, `gh auth refresh`, `process.env.HOME`, `it.skip`, `describe.skip`, `ctx.skip`, or a `\r` byte; and does contain `OUTSTANDING` and `docs/RUNBOOK.md`.

**Mutation check — the classifier is live** (plan acceptance criterion 7). Inverting the single branch `if gh auth status` → `if ! gh auth status`:

```
FAIL  case 1: authenticated + bare invocation fails and names the remedy
FAIL  case 2: unauthenticated passes and says /share aborts
FAIL  case 3: authenticated + --warn-only exits 0 but still reports the risk
PASS  case 4: no gh on PATH passes without invoking anything
Tests  3 failed | 1 passed (4)
```

Cases 1 and 2 both go red, as required; case 3 goes with them; case 4 correctly does not, because the `gh`-absent branch is upstream of the inverted one. Script restored — `git diff --stat` empty, working tree clean apart from the new test file at that point.

The bare invocation exiting 1 on this machine (acceptance criterion 6) was verified by running it, not by mutating `gh` state.

## Requirements Satisfied

- **SAFE-16 (classifier)** — `scripts/check-gh-unauthenticated.sh` exists, is POSIX sh, cites `interactive-mode.ts:2902` and `:5856-5866`, and classifies both states correctly under a bidirectional stubbed test with mutation-verified liveness.
- **SAFE-16 (live control)** — **OUTSTANDING.** See below. Do not mark this requirement green on the strength of the unit test.

## Outstanding — never report as passed

| Item | Why it cannot be done here | Where it lands |
|---|---|---|
| `gh auth logout` applied on the work laptop, then `gh auth status` confirmed non-zero, then `/share` confirmed to abort in a live Pi session | Needs the work machine. This dev box's `gh` credential is how the repo is pushed over HTTPS (no SSH key) and must not be mutated | `docs/RUNBOOK.md`, seeded by Plan 10 |

`docs/` is currently empty; the `docs/RUNBOOK.md` references in the script footer and the test docstring are deliberate forward references to Plan 10's deliverable. Plan 10 also owns the README/runbook prose assertion in the SAFE-16 validation row.

## Known Stubs

None. `tests/unit/gh-unauthenticated.test.ts` uses a *test* stub for `gh` by design — that is the mechanism, not a placeholder. No hardcoded empty values, no TODO/FIXME, no unwired code paths. The script has three real branches and all three are exercised.

## Notes for Next Plan

- **Plan 10 must add the SAFE-16 runbook entry** and keep its status literally `OUTSTANDING`. Two files already point at `docs/RUNBOOK.md` for it.
- **Plan 06 (CI)** should run this script with `--warn-only` on the matrix legs — GitHub runners ship `gh` *authenticated* with a `GITHUB_TOKEN`-backed credential, so a bare invocation would exit 1 on every CI run and the signal would be discarded within a week. The bare mode belongs to the work laptop only.
- **BOOT-06** now has a second tracked `*.sh` to lint. `shellcheck` is not installed on this machine (`--shell=sh` clean is unverified locally); the Ubuntu lint job is the first place it will actually run. Marked UNVERIFIED rather than claimed.
- `resolveSh()` is currently local to this test. If a third suite needs an absolute `sh`, promote it to `tests/helpers/` rather than copying — a second copy is how the Windows path assumption drifts.

## Self-Check: PASSED

Both claimed files exist on disk (`scripts/check-gh-unauthenticated.sh`, `tests/unit/gh-unauthenticated.test.ts`). Both claimed commits exist in git history (`c3c4008`, `46533aa`). Full suite green (124 tests) and `gh auth status` still exits 0 after the run. Verified 2026-08-13.
