---
phase: 01-bootstrap-packaging-supply-chain
plan: 02
subsystem: test-harness
tags: [testing, supply-chain, gitignore, vitest, windows-portability]
requires:
  - vitest-test-framework
  - tsconfig-typecheck
  - committable-npmrc-controls
provides:
  - git-ignore-oracle
  - pi-cli-runner
  - path-stub-factory
  - malicious-postinstall-fixture
  - boot09-bidirectional-ignore-test
affects:
  - tests/
tech-stack:
  added: []
  patterns:
    - "Ask the third-party tool, never parse its config: `git check-ignore -q --no-index` is the ignore oracle"
    - "Test helpers throw rather than skip — a skipped load-path test is a vacuous pass"
    - "Stubs live on a throwaway PATH in a temp dir; no test mutates real machine state"
    - "Mutation-check every policy test: break the rule, watch it go red, restore"
key-files:
  created:
    - tests/helpers/git.ts
    - tests/helpers/pi.ts
    - tests/helpers/stub-bin.ts
    - tests/unit/helpers.test.ts
    - tests/unit/gitignore-policy.test.ts
    - tests/fixtures/evil-postinstall/package.json
  modified: []
decisions:
  - "`git check-ignore` needs `--no-index`, not just `-q` — without it the index masks ignore rules for tracked paths and the entire MUST_BE_COMMITTABLE direction asserts nothing"
  - "Stub payloads are `.mjs`, never `.js` — `.JS` is in Windows PATHEXT and would be resolved and handed to Windows Script Host"
  - "`runPi` and `runWithStubBin` fold quoted args into the command string on Windows instead of passing an args array with `shell:true` (Node DEP0190)"
  - "`withStubBin` rejects an async `fn` loudly rather than deleting the stub dir mid-await"
  - "Added `tests/unit/helpers.test.ts` beyond the plan's file list — nothing else exercises `runPi` or `withStubBin` at all"
metrics:
  duration: ~20 min
  completed: 2026-08-13
  tasks: 2
  commits: 2
---

# Phase 1 Plan 02: Test Harness & BOOT-09 Ignore Policy Summary

Built the three helpers every later plan in this phase asserts through — a git-ignore oracle, a Pi CLI runner, and a throwaway-PATH stub factory — then used the oracle immediately to prove BOOT-09 in both directions across 53 paths, and shipped a malicious-postinstall fixture verified to actually fire.

## What Was Built

**Task 1 — three helpers plus their self-tests (commit `49f24dc`)**

`tests/helpers/git.ts` exports `repoRoot()` (resolved once, cached), `isIgnored(path)` and `trackedFiles(pattern)`. `isIgnored` is `git check-ignore -q --no-index -- <path>`, exit 0 = ignored. Two flags, two verified traps — see Key Implementation Details.

`tests/helpers/pi.ts` exports `requirePiOnPath()` and `runPi(args, opts)`. `requirePiOnPath` **throws**, with the exact `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.1` remedy in the message; there is no skip path anywhere in the file, because a skipped load-path test would let CI go green having verified nothing — the precise failure BOOT-02/BOOT-05 exist to catch. `runPi` merges `--offline` unless the caller passed it (`docs/settings.md:83` — disables update checks, package update checks and telemetry), captures `{stdout, stderr, status}`, and uses a 120 s timeout for Pi's cold jiti compile.

`tests/helpers/stub-bin.ts` exports `withStubBin(stubs, fn)` and a `runWithStubBin` convenience. It writes each stub three ways into a `mkdtemp` directory — an `.mjs` payload holding the logic, an extensionless POSIX `sh` launcher, and a `.cmd` shim — prepends that directory to `PATH` (finding the real key case-insensitively, since Windows uses `Path`), and removes the directory in a `finally`. `logTo` makes a stub append `<name> <argv>` one line per invocation, which is how Plan 06 will prove the `.npmrc` assertion runs before any `pi install`.

`tests/unit/helpers.test.ts` (9 tests, not in the plan's file list — see Deviations) exercises all three for real: PATH prepending, temp-dir cleanup on both the normal and the throwing path, stub stdout/exit-code/argv-logging round-trip, and a live `pi --offline --version`.

**Task 2 — fixture and the BOOT-09 test (commit `1746e9b`)**

`tests/fixtures/evil-postinstall/package.json` — private, `version` 1.0.0, **zero dependencies**, never referenced from the root `package.json`. Its `postinstall` is a `node -e` one-liner writing a sentinel to `$KYPI_EVIL_SENTINEL`, falling back to `evil-postinstall-ran` in the OS temp dir. A `readme` field states that a sentinel seen outside a deliberate test run is a real supply-chain incident, not a test artifact.

`tests/unit/gitignore-policy.test.ts` — 58 assertions. `MUST_BE_IGNORED` holds **29** paths (plan floor: 20) spanning Pi project-scope runtime state, the two project-scope package-install roots, generic credential shapes, infra artifacts, non-rooted npmrc files, and `node_modules`. `MUST_BE_COMMITTABLE` holds **24** (plan floor: 17) covering the two `.npmrc` controls, all five Pi resource directories, packaging/toolchain, bootstrap/CI/docs, and the tests themselves. Two further assertion groups: neither committed npmrc matches `/_authToken|_auth\b|_password/i` **and** exactly two npmrc files are tracked repo-wide; and no `.gitignore` exists under `.pi/extensions/`, checked both on disk (recursive walk) and in the index.

## Key Implementation Details

**`--no-index` is the difference between a real test and a green no-op.** The plan specified `check-ignore -q`. That alone is insufficient, and the failure is silent. By default `check-ignore` consults the index and reports any **tracked** path as not-ignored regardless of the rules — and most of `MUST_BE_COMMITTABLE` is already tracked. Executed in a scratch repo, 2026-08-13:

| `.gitignore` | path | `-q` | `-q --no-index` |
|---|---|---|---|
| `.npmrc` + `!/.npmrc` | `.npmrc` (tracked) | 1 (not ignored) ✓ | 1 ✓ |
| `.npmrc` only, negation removed | `.npmrc` (tracked) | **1 — wrong, rule masked** | 0 ✓ |

Without `--no-index`, the plan's own mutation criterion could not have been satisfied: deleting `!/.npmrc` would have left the suite green. With it, the mutation check behaves exactly as the plan demands (evidence below).

**The verbose flag is the other trap**, per RESEARCH §6.4: it exits 0 whenever *any* line matches, including a negation line, so its exit code answers "did a rule match" rather than "is this ignored". That would invert the verdict for every negated path — `!/.npmrc`, `!/.pi/npm/.npmrc`, `!.env.example` — i.e. exactly the paths this repo most needs committable. `git.ts` contains zero occurrences of that flag, in code or prose, so a grep audit stays clean.

**Three Windows facts were measured rather than assumed** (node 24.16.0, executed 2026-08-13):

| Invocation | Result |
|---|---|
| `spawnSync("<name>", args, {shell:false})` where only `<name>.cmd` exists | `error ENOENT` |
| `spawnSync("<abs>/<name>.cmd", args, {shell:false})` | `error EINVAL` (CVE-2024-27980 guard) |
| `spawnSync("<name>", args, {shell:true})` | status 0, stub ran |

So `shell: true` is mandatory on Windows for both `pi` (npm ships `pi`, `pi.cmd`, `pi.ps1`) and for any stub. Two consequences are documented in the source rather than discovered later:

1. Args are quoted and folded into the command *string* on the Windows path, with an empty args array — passing an args array alongside `shell:true` is unescaped concatenation, which is what Node's DEP0190 warns about. The warning was live in the first working version and is now gone.
2. **A stub cannot simulate `gh` *success* inside Pi on Windows.** Pi calls `spawnSync("gh", [...])` with no shell (`interactive-mode.ts:5856-5866`), so it will hit EINVAL/ENOENT and take its failure branch. That is fine for SAFE-16, which asserts the *not-authenticated* path, but a Windows test depending on a stubbed `gh` succeeding inside Pi would be unwritable. Recorded as a KNOWN LIMITATION in `stub-bin.ts`.

**`PATHEXT` on this machine is `.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;...`** — `.JS` is in it. Naming the stub payload `<name>.js` would let Windows resolve the payload itself and hand it to Windows Script Host, which cannot run ESM. `.mjs` is absent from PATHEXT, so only the two launchers are ever resolved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `isIgnored` needed `--no-index` or the committable direction asserted nothing**
- **Found during:** Task 1
- **Issue:** The plan specified `check-ignore -q <path>`. For tracked paths git consults the index and returns "not ignored" regardless of the rules, so all 24 `MUST_BE_COMMITTABLE` assertions would have passed unconditionally and the plan's own mutation criterion would have been unmeetable.
- **Fix:** Added `--no-index` (and `--` before the pathspec). Proven with a scratch-repo A/B before writing the helper; table above.
- **Files modified:** `tests/helpers/git.ts`
- **Commit:** `49f24dc`

**2. [Rule 2 - Missing critical functionality] Helpers had no live exercise**
- **Found during:** Task 1
- **Issue:** Every Task 1 acceptance criterion is static (typecheck, grep, export surface). Nothing ran `runPi` or `withStubBin`, yet Plans 05/06 assert *through* them — a broken helper would surface there as a mysterious failure in the thing under test, and the Windows behaviours above are not the kind of thing a typecheck catches.
- **Fix:** Added `tests/unit/helpers.test.ts`, 9 tests. One file beyond the plan's `files_modified`.
- **Files modified:** `tests/unit/helpers.test.ts` (new)
- **Commit:** `49f24dc`

**3. [Rule 1 - Bug] `pi.ts` docstring tripped the plan's own skip audit**
- **Found during:** Task 1 verification
- **Issue:** The docstring read "there is deliberately no `it.skip` escape hatch", which means the file literally *contains* `it.skip` — failing the acceptance criterion "the source contains no `it.skip`, `describe.skip`, or `ctx.skip`". Same class as Plan 01's `.npmrc` comment tripping its own credential assertion.
- **Fix:** Reworded without the literal. `grep -rnE '(it|describe|ctx|test)\.skip' tests/` now returns nothing.
- **Files modified:** `tests/helpers/pi.ts`
- **Commit:** `49f24dc`

**4. [Rule 2 - Missing critical functionality] DEP0190 on the Windows shell path**
- **Found during:** Task 1 verification
- **Issue:** `spawnSync(cmd, args, {shell:true})` emitted Node's DeprecationWarning about unescaped argument concatenation on every Pi and stub invocation. Noise now, a real quoting bug the moment an argument contains a space.
- **Fix:** Quote each argument and fold into the command string with an empty args array, in both `pi.ts` and `stub-bin.ts`. Warning gone.
- **Files modified:** `tests/helpers/pi.ts`, `tests/helpers/stub-bin.ts`
- **Commit:** `49f24dc`

**5. [Rule 2 - Missing critical functionality] `withStubBin` + async `fn` was a silent footgun**
- **Found during:** Task 1
- **Issue:** The plan's signature is `fn: (env) => T` with cleanup in a `finally`. An async `fn` would have its stub directory deleted the instant it awaited — producing intermittent ENOENT far from the cause.
- **Fix:** Detect a thenable return and throw a `TypeError` naming the constraint. `finally` cleanup is retained as specified.
- **Files modified:** `tests/helpers/stub-bin.ts`
- **Commit:** `49f24dc`

No architectural changes, no auth gates, no checkpoints. No package installs were attempted.

## Decisions Made

1. **`--no-index` added to the oracle.** Correctness, not preference; see Deviation 1.
2. **`.mjs`, not `.js`, for stub payloads** — `.JS` is in PATHEXT on this machine.
3. **Windows `gh`-success stubbing declared impossible rather than worked around.** The alternative (shipping a compiled `.exe` stub) needs a toolchain, breaks the zero-build constraint, and buys a capability no requirement in this phase needs. Documented as a limitation so Plan 05 does not try.
4. **`runWithStubBin` added** as an unlisted export — the three-line spawn dance was going to be copy-pasted into every consumer, and it is where the Windows shell rule belongs.
5. **Arrays exceed the plan's floors** (29/24 vs 20/17). The extra entries are all cheap string assertions covering real credential shapes (`.netrc`, `secrets/`, `*.tfvars`, `id_ed25519`) and the two Pi paths the plan's list omitted (`.pi/agents/`, `.pi/APPEND_SYSTEM.md`).

## Verification Results

Every plan-level check, executed:

```
npx tsc --noEmit                                   -> exit 0
npm test  (whole suite)                            -> 3 files, 74 tests passed
npx vitest run tests/unit/gitignore-policy.test.ts -> 58 tests passed
node -e "<fixture shape check>"                    -> FIXTURE_OK
grep -rnE '(it|describe|ctx|test)\.skip' tests/    -> no matches
grep -c -- '-v' tests/helpers/git.ts               -> 0
grep -c 'evil-postinstall' package.json            -> 0 (absent, correct)
grep -c 'KYPI_EVIL_SENTINEL' fixture package.json  -> 2
```

**Mutation check — the test is live** (plan acceptance criterion 3):

```
# !/.npmrc removed from .gitignore
FAIL tests/unit/gitignore-policy.test.ts > BOOT-09 (reverse) > does not ignore .npmrc
AssertionError: .npmrc MUST be committable but git says it is ignored --
  a clone would be missing it and the harness would silently not load
Tests  1 failed | 57 passed (58)      exit 1
# .gitignore restored; git diff --stat and git status both clean
```

**Fixture liveness — the attack probe is not a dud** (executed in a scratch dir outside the repo, 2026-08-13):

| Scenario | Result |
|---|---|
| `npm install file:evil` with no `ignore-scripts` | **SENTINEL WRITTEN** — fixture fires |
| `npm install file:evil`, cwd holds `ignore-scripts=true` | blocked, no sentinel — control effective |

This is the BOOT-01 end-to-end probe Plan 04 needs, and it is now proven to discriminate in both directions rather than merely existing.

## Requirements Satisfied

- **BOOT-09** — proven by asking git about 53 paths in both directions, with the committable direction verified non-vacuous by mutation. Two supporting assertions ship alongside: exactly two npmrc files are tracked and neither carries a registry auth directive, and no `.gitignore` exists under `.pi/extensions/` on disk or in the index.

## Known Stubs

None. `tests/fixtures/evil-postinstall/` is a deliberate attack fixture, not a placeholder — it is fully functional and verified above. No hardcoded empty values, no TODO/FIXME, no unwired components.

## Notes for Next Plan

- Use `isIgnored` from `tests/helpers/git.ts` for any new ignore claim; do not shell out to `check-ignore` ad hoc, and never drop `--no-index`.
- `runPi` already injects `--offline`. For the BOOT-05 dogfood assertion add `-a`, or the trust gate silently drops project-local resources with no error (RESEARCH §2.3, control row).
- `withStubBin` requires a **synchronous** `fn`; it throws on a thenable.
- On Windows a stub can only drive Pi's `gh` call down its failure branch. Write the SAFE-16 test as "not authenticated ⇒ `/share` refuses", which is the assertion that matters and the one that is portable.
- Plan 04's `ignore-scripts` end-to-end probe should reuse `tests/fixtures/evil-postinstall/` with `KYPI_EVIL_SENTINEL` pointed into a `mkdtemp` dir, and must assert the negative case too — a probe that never fires proves nothing.
- `tests/integration/` is still empty; `passWithNoTests: false` means `npm test` stays green only because `tests/unit` has content.

## Self-Check: PASSED

All 6 claimed files exist on disk. Both claimed commits (`49f24dc`, `1746e9b`) exist in git history. Working tree clean after the mutation check restore. Verified 2026-08-13.
