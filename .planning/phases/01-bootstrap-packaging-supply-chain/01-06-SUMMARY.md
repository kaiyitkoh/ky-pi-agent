---
phase: 01-bootstrap-packaging-supply-chain
plan: 06
subsystem: bootstrap
tags: [testing, integration, supply-chain, npm, idempotence, ordering, windows-portability, boot-01, boot-03]
requires:
  - cold-machine-bootstrap
  - ordering-proof-seam
  - path-stub-factory
provides:
  - boot03-idempotence-proof
  - boot01-ordering-proof
  - argv-conditional-stub-responses
affects:
  - tests/
  - bin/
tech-stack:
  added: []
  patterns:
    - "Execution order is proven by a recorded argv log, never by reading the source — a refactor can reorder execution without reordering the file"
    - "Every ordering assertion is preceded by a non-emptiness assertion; Math.max([]) < Math.min([]) is -Infinity < Infinity"
    - "A negative control is only meaningful next to a positive on the same fixture"
    - "Redirect PI_CODING_AGENT_DIR under os.tmpdir() in every case — this machine's real ~/.pi/agent is now hardened, so an un-redirected test passes for the wrong reason"
    - "A stubbed-binary test asserts the stub's own call log; otherwise a PATH mistake is invisible until it mutates real machine state"
key-files:
  created:
    - tests/integration/bootstrap-check-only.test.ts
    - tests/integration/npmrc-ordering.test.ts
  modified:
    - tests/helpers/stub-bin.ts
    - bin/bootstrap.sh
decisions:
  - "sanitise_npm_env matches the npm_config_ prefix case-INSENSITIVELY — a Node test runner hands children the keys upper-cased and Windows env names are case-insensitive, so the lower-case-only strip certified a control it never exercised"
  - "StubSpec gained argv-conditional `match` responses rather than answering `true` to all four of npm's questions — a stub that answers `true` to `npm view … version` is a caricature, not a model"
  - "case 2's byte-equality holds PI_CODING_AGENT_DIR fixed across both runs; the script correctly echoes the path it checks, so two temp dirs would differ for an honest reason"
  - "case 3 refuses to run unless `npm` resolves inside the stub dir — it is the only case that lets the script reach install_pi for real"
metrics:
  duration: ~30 min
  completed: 2026-08-13
  tasks: 2
  commits: 2
---

# Phase 1 Plan 06: BOOT-03 Idempotence and the BOOT-01 Ordering Proof Summary

Seven integration cases that execute the real `bin/bootstrap.sh` under a redirected agent directory — and one of them immediately caught a live false-certification bug in the script's own supply-chain sanitiser.

## What Was Built

**Task 1 — `tests/integration/bootstrap-check-only.test.ts` (commit `93b6922`)**

Four cases, every one with `PI_CODING_AGENT_DIR` on a fresh `os.tmpdir()` directory, cleaned up in `afterEach`.

| Case | Asserts |
|---|---|
| 1 | `--check-only` exits 0; stdout names `glab` and renders both `optional` and `required` classes |
| 2 | Two consecutive runs on **one** agent dir are strictly byte-identical, plus explicit no-ISO-date and no-clock-time guards |
| 3 | `--check-only` is inert: recursive listing of the agent dir and `git status --porcelain` both unchanged, and the agent dir starts genuinely empty |
| 4 | Two full runs produce byte-identical `settings.json` (parsing to an object with a `kyPiAgent` key) and byte-identical `.env.example` |

Case 4 runs under a stubbed `npm` **and** `KYPI_SKIP_INSTALL=1` — two independent guards against touching the real global prefix — and asserts the stub's own call log both to prove the stub was consulted and to prove the install step was never reached.

`tests/helpers/stub-bin.ts` gained `StubSpec.match`: an ordered list of `{ when: string[], stdout?, stderr?, exitCode? }`, first match wins, falling through to the existing static fields. The argv line is logged *before* the response is chosen, so an invocation the stub has no answer for is still recorded — an ordering proof that dropped calls would be worthless.

**Task 2 — `tests/integration/npmrc-ordering.test.ts` (commit `b65285e`)**

Three cases.

| Case | Asserts |
|---|---|
| 1 | `--assert-hardening` against an empty temp root exits **exactly 1** with `ignore-scripts` on stderr |
| 2 | The same root, one file added (`npm/.npmrc` with `ignore-scripts=true`), exits 0 — the paired positive, without which case 1 would be satisfied by a script that always fails |
| 3 | Stubbed `npm` and `pi` append `<name> <argv>` to one shared log; the **last** `npm config get ignore-scripts` index is `<` the **first** `npm install`/`pi install` index |

The recorded log from a healthy run:

```
npm view @earendil-works/pi-coding-agent@0.84.1 version --json
npm config get ignore-scripts
npm config get ignore-scripts --prefix C:/Users/Admin/Documents/ky-pi-agent/.pi/npm
npm config get ignore-scripts --prefix C:/Users/Admin/AppData/Local/Temp/kypi-agentdir-XXXXXX/npm
npm ls -g --depth=0 --json
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.1
```

Three assertions, then the install. That is BOOT-01's ordering clause as a recording rather than an opinion.

## Key Implementation Details

**Case 3 has a pre-flight guard, and it is not decoration.** It is the only case that lets the script reach `install_pi` for real. If the stub were not the `npm` on `PATH`, the script would run `npm install -g @earendil-works/pi-coding-agent@0.84.1` against the developer's live global prefix. So before running the script it executes `sh -c "command -v npm"` under the stubbed env and throws unless the resolution lands inside the `kypi-stub-` directory. [threat T-01-07]

**Non-emptiness is asserted before the index comparison, in both categories.** `Math.max(...[])` is `-Infinity` and `Math.min(...[])` is `Infinity`, so an ordering assertion over an empty log passes with flying colours while proving nothing. Verified live: forcing `KYPI_SKIP_INSTALL=1` into case 3 makes it fail on `no install was recorded`, not on the ordering comparison. [threat T-01-19]

**Case 2 holds the agent directory fixed across both runs.** The plan wanted absolute temp paths kept out of `--check-only` output; the script legitimately echoes the user-scope path it is checking (`WARN user-scope npm hardening not applied: <path>/npm/.npmrc is absent`), which is correct behaviour and worth keeping — an operator needs to know which path was checked. Holding every input fixed is what makes any remaining difference a defect, and the two extra regex guards (no `\d{4}-\d{2}-\d{2}`, no `\d{1,2}:\d{2}:\d{2}`) cover the specific case where both runs land inside the same second.

**A single static stub stdout could technically have satisfied the whole run** — `true` parses as JSON, contains no `error` token, and would have been accepted by the version gate. That is precisely why it was rejected: the version gate would then be "passing" on a token no registry would ever return, and a regression in its parsing would go unseen.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, security] `sanitise_npm_env` missed upper-case `NPM_CONFIG_*` on Windows**

- **Found during:** Task 2, case 1 — which passed when it had to fail.
- **Issue:** `sed -n 's/^\(npm_config_[A-Za-z0-9_]*\)=.*/\1/p'` matches the lower-case prefix only. Vitest hands its children the same keys **upper-cased** (`NPM_CONFIG_IGNORE_SCRIPTS`, verified by dumping the child's `env`), Windows environment names are case-insensitive, and npm lower-cases before reading — so the override survived the strip and was honoured. `--assert-hardening` therefore reported `ignore-scripts=true` for a directory containing no configuration at all, and `run_full` would have proceeded to `install_pi` on that basis. This is the exact false certification the function exists to prevent, one layer deeper than Plan 04 and Plan 05 found it.
- **Fix:** Explicit bracket classes — `[Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_` — rather than a case-insensitivity flag: neither `sed -I` nor a trailing `/i` is POSIX, and the macOS runner is BSD sed. Verified against lower-case, UPPER-case and MiXeD-case overrides; all three now yield exit 1 on an empty root, and the real machine still exits 0.
- **Files modified:** `bin/bootstrap.sh`
- **Commit:** `b65285e`

**2. [Rule 3 - Blocking] `StubSpec` could not express argv-conditional responses**

- **Found during:** Task 2
- **Issue:** The plan requires the stub `npm` to answer four different questions four different ways. `StubSpec` carried one static `stdout`/`stderr`/`exitCode`.
- **Fix:** Additive `match?: StubResponse[]`, first-match-wins, falling through to the existing fields. All prior callers unaffected; the full suite stayed green.
- **Files modified:** `tests/helpers/stub-bin.ts`
- **Commit:** `93b6922`

### Decisions taken without asking (autonomous run policy)

- **Case 2 reuses one agent directory rather than two.** Asserting that a correct diagnostic path never appears in the output would have been asserting a defect. The idempotence claim (VALIDATION line 52, "diff of two consecutive runs is empty") is preserved exactly, and the specific defect class the plan named — a `date`-derived string — is covered by both the equality assertion and a dedicated regex guard, proven by the mutation check below.

No architectural changes. No auth gates. No checkpoints. No package installs attempted.

## Verification Results

Executed on this machine (Windows 11, Git Bash, node 24.16.0, npm 11.13.0, vitest 4.1.9):

```
npx vitest run tests/integration/bootstrap-check-only.test.ts -> 4 passed
npx vitest run tests/integration/npmrc-ordering.test.ts       -> 3 passed
npx vitest run tests/integration                              -> 3 files, 11 passed
npx vitest run  (whole suite)                                 -> 11 files, 131 passed
npx tsc --noEmit                                              -> TYPECHECK_OK
sh -n bin/bootstrap.sh                                        -> SYNTAX_OK
source audit (no jq / version-sort / [[ / .ps1 / CR, run_full ordering)
                                                              -> BOOTSTRAP_OK lines=535
CR scan over `git ls-files -- "*.sh"`                         -> 2 files, CR-free
grep -rnE '(it|describe|ctx|test)\.skip' tests/               -> NO_SKIPS
git status --porcelain after the suite                        -> clean
```

**Sanitiser fix, all three key casings, against an empty agent root:**

| Override | Exit |
|---|---|
| `npm_config_ignore_scripts=true` | 1 |
| `NPM_CONFIG_IGNORE_SCRIPTS=true` | 1 (was **0** before the fix) |
| `Npm_Config_Ignore_Scripts=true` | 1 |
| real `~/.pi/agent` (control genuinely present) | 0 |

**Mutation check — case 2 is live** (Task 1 acceptance criterion 7). A `printf 'run at %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%S')"` was added to `run_check_only`:

```
FAIL tests/integration/bootstrap-check-only.test.ts > case 2 -- two consecutive
     `--check-only` runs are byte-identical
- run at 2026-08-13T00:52:50
+ run at 2026-08-13T00:52:53
Tests  1 failed | 3 passed (4)
```

Restored; `git diff bin/bootstrap.sh` showed only the sanitiser fix afterwards.

**Mutation check — case 3 is live** (Task 2 acceptance criterion 4). `install_pi` moved above `harden_pi_npm_root` in `run_full`:

```
FAIL tests/integration/npmrc-ordering.test.ts > case 3
AssertionError: every ignore-scripts assertion must complete before the first
install … Log was:
  npm view @earendil-works/pi-coding-agent@0.84.1 version --json
  npm config get ignore-scripts
  npm config get ignore-scripts --prefix …/.pi/npm
  npm ls -g --depth=0 --json
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.1
  npm config get ignore-scripts --prefix …/kypi-agentdir-SVfkf1/npm
expected 5 to be less than 4
```

Restored; source audit re-run clean.

**Vacuity check — the non-emptiness guard fires before the comparison.** `KYPI_SKIP_INSTALL=1` forced into case 3:

```
AssertionError: no install was recorded, so there is nothing to be "before"
expected 0 to be greater than 0
```

The comparison never ran. Restored.

## Requirements Satisfied

- **BOOT-03** — probe reporting proven by execution on a machine that genuinely lacks `glab` (exit 0 with the tool named and classed `optional`); `--check-only` proven inert against both the agent dir and the repo; idempotence proven at the byte level for `--check-only` stdout, `settings.json` and `.env.example`, with the determinism claim mutation-tested.
- **BOOT-01 (ordering)** — proven by a recorded argv log, in both directions: the script refuses without the control (case 1), accepts with it (case 2), and its three assertions all complete before the single install (case 3). Both halves mutation-tested, and the "passes on an empty log" failure mode explicitly closed.

## Known Stubs

None. The stubbed `npm`/`pi` binaries are deliberate test doubles on a throwaway `PATH`, fully functional and asserted through their own call logs — not placeholders.

## Threat Flags

None new. The plan's `<threat_model>` covers every surface touched, and all four dispositions are now *implemented* rather than planned: T-01-01 (argv-log ordering with both non-emptiness checks, plus the refusal path in both directions), T-01-07 (`PI_CODING_AGENT_DIR` under `os.tmpdir()` in all seven cases, stubbed installs, a pre-flight PATH guard, and `git status --porcelain` asserted unchanged), T-01-17 (byte-equality plus JSON-parse on `settings.json` across two full runs), T-01-19 (non-emptiness asserted in both categories, verified live).

Worth recording as a *finding* rather than a flag: T-01-01's mitigation was **not actually effective on Windows** before this plan. The control the ordering clause depends on could be overridden by an environment variable the script believed it had stripped.

## Notes for Next Plan

- `bin/bootstrap.sh` is now 534 lines; the only behavioural change in this plan is the case-insensitive `npm_config_` strip. Re-run `sh bin/bootstrap.sh --assert-hardening` after any future edit to that function — it is the one place where a silent regression re-arms the whole supply-chain risk.
- `withStubBin` now supports `match` for argv-conditional responses. Still synchronous-only, still deletes its directory in a `finally`.
- Any test that spawns a tool which reads `npm_config_*` must remember that a Node runner upper-cases the keys. This is the third distinct manifestation of the env-config trap in this phase (Plan 04 found it in the probe, Plan 05 in the script, Plan 06 in the casing).
- Both new files write to the tracked `.env.example` via the full bootstrap; both snapshot and restore it in a `finally`, so a failing assertion cannot leave the working tree dirty.
- `tests/integration/` now holds three files and 11 cases. The suite runs in ~13 s wall-clock.

## Self-Check: PASSED

- `tests/integration/bootstrap-check-only.test.ts` — FOUND (319 lines)
- `tests/integration/npmrc-ordering.test.ts` — FOUND (268 lines)
- `tests/helpers/stub-bin.ts` — FOUND (253 lines, modified)
- `bin/bootstrap.sh` — FOUND (534 lines, modified)
- Commit `93b6922` — FOUND in `git log`
- Commit `b65285e` — FOUND in `git log`
- Key link `npmrc-ordering.test.ts` → `tests/helpers/stub-bin.ts` via `withStubBin` + `logTo` — PRESENT and exercised
- Key link `bootstrap-check-only.test.ts` → `bin/bootstrap.sh` via `PI_CODING_AGENT_DIR` — PRESENT in all four cases

Working tree clean apart from the planning artifacts committed alongside this summary. Verified 2026-08-13.
