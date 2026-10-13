---
phase: 12-openspec-opt-in-skill
fixed_at: 2026-10-13T00:00:00Z
review_path: .planning/phases/12-openspec-opt-in-skill/12-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-10-13
**Source review:** .planning/phases/12-openspec-opt-in-skill/12-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (1 critical, 6 warning; Info out of scope)
- Fixed: 7
- Skipped: 0

Verification: each fix ran its targeted vitest file(s) with `--maxWorkers=2`. Every new test was also run against the pre-fix source as a negative control and failed there, except one row noted under WR-03. `npx tsc --noEmit` ran once at the end and exited 0. Adjacent consumers also passed: plan-mode-read-only, shell-policy-gate, infra-policy, safety-entry, routing-map, bg-run-guard, docs-policy, openspec-docs, comment-discipline and lf-and-shell.

## Fixed Issues

### CR-01: Wrapper resolution lets protected git, terraform, kubectl and openspec commands through as `allow`

**Files modified:** `.pi/extensions/safety/shell.ts`, `docs/SAFETY.md`, `tests/fixtures/evasion-corpus.ts`, `tests/unit/policy-compose.test.ts`, `tests/unit/shell-deny-list.test.ts`, `tests/unit/shell-parse.test.ts`
**Commit:** 442a680
**Applied fix:**
- The generic flag-skip and ad-hoc env/sudo loops are replaced by a per-wrapper `WRAPPER_GRAMMARS` table. It covers env, sudo, doas, exec, timeout (one duration operand), nice (`-n N`, `-N`), ionice, nohup, chronic, setsid, time, stdbuf, unbuffer, command, builtin, toybox and busybox.
- `consumeWrapperOptions` handles `--`, `NAME=value` (env and sudo), `--long=value`, packed short values (`-o0`, `-uroot`) and operands.
- **Fails closed:** an unknown option, `env -S`/`--split-string`, a missing value or operand, or an assignment/option left in command position marks the resolution unconfident. If a guarded verb is in that segment, `canonicalise` refuses it with a new `unresolved-wrapper` cause; `env --x ls` stays ok.
- `watch` was added to `SHELL_RUNNERS`, because it joins its operands into `sh -c`.
- **Probed results:** `env A=1 git push origin main` on main blocks. `env A=1 terraform apply`, `exec`, `timeout 5`, `nice -n 5`, `sudo --`, `env -- openspec update` and `env OPENSPEC_TELEMETRY=0 openspec update` all confirm. `env A=1 sh -c 'terraform apply'` blocks as shell-runner.
- **Tests:** corpus rows EV-85..EV-93 are BLOCKED rows, so the SAFETY.md table count is unaffected. Policy-compose rows replace `env -i openspec update` with `env A=1 openspec update`. Wrapper-resolution and deny-list rows were also added. SAFETY.md gains a "Wrapper indirection" bullet.

### WR-01: `openspec` is not a guarded verb, so runner and launcher indirection skip its confirm rows

**Files modified:** `.pi/extensions/safety/shell.ts`, `.pi/extensions/plan-mode/read-only.ts` (comment only), `docs/SAFETY.md`, `docs/OPENSPEC.md`, `tests/fixtures/evasion-corpus.ts`, `tests/unit/policy-compose.test.ts`, `tests/unit/shell-parse.test.ts`
**Commit:** 9218ddc
**Applied fix:**
- `openspec` was added to `GUARDED_VERB_PATTERN`. `sh -c "openspec update"`, `xargs openspec init` and `node .../openspec.js update` are now refused by the shell-runner rule.
- `npx`, `pnpx` and `bunx` are now wrappers, plus the two-word forms `npm exec|x`, `pnpm dlx|exec`, `yarn dlx|exec` and `bun x`. `-p`/`--package` take a value; `-c`/`--call`/`--shell-mode` are unconfident.
- `normaliseExecutable` strips an npm `@version` suffix, so `npx -y @fission-ai/openspec@1.13.2 update` confirms.
- **Still not caught:** `yarn openspec update` is published as OUT-OF-SCOPE corpus row EV-94, with a matching SAFETY.md table row so the coupled count stays consistent. BLOCKED rows EV-95..EV-100 were added.
- SAFETY.md's "two OpenSpec gaps" paragraph and OPENSPEC.md:59 were rewritten to match the probed behaviour.
- **Documented side effect:** an agent running `sh scripts/openspec-setup.sh` is now refused, because the segment names `openspec`.

### WR-02: `context` is in the allow table but can overwrite an arbitrary file

**Files modified:** `.pi/extensions/safety/infra.ts`, `tests/unit/infra-policy.test.ts`, `docs/SAFETY.md`, `docs/OPENSPEC.md`
**Commit:** 553d0e8
**Applied fix:** `openspec context` with `--code-workspace` (separate or `=` form) now returns confirm. This covers creating a file as well as overwriting one with `--force`, since 1.13.2 writes the path with no confinement (verified in the installed `dist/commands/context.js`). Plain `context` and `context --json` stay allowed. The test row label "read-only" was corrected, and confirm rows were added for both forms.

### WR-03: The setup script's "refuse to install into the repository" check can be bypassed

**Files modified:** `scripts/openspec-setup.sh`, `tests/integration/openspec-setup.test.ts`
**Commit:** f873b77
**Applied fix:**
- The script expands a leading `~`/`~/` the way Pi does, before the backslash translation.
- Relative values are made absolute against `$PWD`.
- It resolves the nearest existing ancestor with `CDPATH='' cd -- ... && pwd -P` and appends the rest. A `..` below a missing directory is refused, and an unresolvable path is refused.
- Both sides are compared in `cygpath -m` form and lower-cased.
- New tests cover the relative, case-variant, `..`-climb and `~` forms. The relative, case-variant and `~` tests fail against the old script. The `..`-climb row passes on Windows even pre-fix, because `cygpath -u` collapses `..` there; it guards the POSIX path.

### WR-04: The "restores the pre-test values" test is vacuous

**Files modified:** `tests/unit/openspec-env.test.ts`
**Commit:** 4004230
**Applied fix:** The script now snapshots the four variables at module load, before any hook runs. An `afterAll` asserts that `process.env` equals that snapshot, and the vacuous test was removed. Negative control: with the afterEach restore disabled, the afterAll fails.

### WR-05: `git status --porcelain .pi` makes the setup test depend on the developer's working tree

**Files modified:** `tests/integration/openspec-setup.test.ts`
**Commit:** fb5d873
**Applied fix:** `.pi` porcelain is now snapshotted in `beforeAll` and compared after the runs, instead of being required to be empty. It was verified passing with an untracked file deliberately placed under `.pi`.

### WR-06: OPENSPEC.md claims the setup script verifies the telemetry opt-out, but the script does not check it

**Files modified:** `scripts/openspec-setup.sh`, `tests/integration/openspec-setup.test.ts`, `docs/OPENSPEC.md`, `docs/RUNBOOK.md`
**Commit:** 2c6bb17
**Applied fix:**
- After `config set`, the script runs `openspec config get telemetry.enabled` and warns unless it prints `false`. The real 1.13.2 `config get` prints the raw value, which was verified at source.
- The fake CLI gained a `config get` branch, and there is a test for both the silent and the warning case.
- OPENSPEC.md and RB-12-03 now say the harness sets Pi's `process.env`, which spawned children inherit, including non-OpenSpec tools that honour `DO_NOT_TRACK`. They no longer say it covers "every CLI call it makes".

## Notes for the developer

- **Needs human verification (logic changes):** CR-01, WR-01 and WR-02 change guard classification. Two policy choices deserve a human glance:
  - An unresolvable wrapper in front of a guarded verb is a hard block (refusal), not a confirm.
  - Adding `openspec` to the guarded verbs means any shell-runner segment mentioning the word `openspec` is refused, for example `sh scripts/openspec-setup.sh` or `node x/openspec-foo.js`. This is the same false-positive class `git` already has.
- **Not addressed (Info, out of scope):** IN-01..IN-06. The WR-03 code uses `CDPATH=''` in its own `cd`, but the pre-existing `SCRIPT_DIR` line (IN-06) is unchanged.

---

_Fixed: 2026-10-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
