---
phase: 01-bootstrap-packaging-supply-chain
plan: 04
subsystem: supply-chain-gates
tags: [supply-chain, npmrc, ignore-scripts, pinning, boot-01, boot-08, vitest]
requires:
  - vitest-test-framework
  - committable-npmrc-controls
  - git-ignore-oracle
  - malicious-postinstall-fixture
provides:
  - boot01-effective-config-proof
  - boot01-bidirectional-attack-proof
  - boot08-pinning-gate
  - is-pinned-package-spec-lint
affects:
  - tests/
tech-stack:
  added: []
  patterns:
    - "Ask npm what npm will do (`npm config get`); never read the .npmrc you just wrote"
    - "Sanitise inherited `npm_config_*` before probing npm — env config outranks every file"
    - "Every control assertion is paired with a control case that must go the other way"
    - "Lints are proven against an inline table so they are live before real data exists"
key-files:
  created:
    - tests/unit/npmrc-policy.test.ts
    - tests/unit/pinning.test.ts
  modified: []
decisions:
  - "npm_config_* is stripped from the child environment in every npm probe — npx/npm run export the resolved repo config and npm ranks env above files, which silently made the hardened attack case pass for the wrong reason"
  - "User-scope hardening is asserted as a mechanism against a throwaway agent dir, never against the developer's real home — that live check is bootstrap's (Plan 06)"
  - "isPinnedPackageSpec ships from a test file as an export for Phase 7 rather than a new src module — no production module exists yet and this plan may not create one"
  - "devDependencies is asserted to contain exactly the six audited pins and nothing else"
metrics:
  duration: ~18 min
  completed: 2026-08-13
  tasks: 2
  commits: 2
---

# Phase 1 Plan 04: Supply-Chain Effectiveness & Pinning Gates Summary

Turned BOOT-01 and BOOT-08 from claims into gates: npm is interrogated in three scopes with a discrimination control, the real postinstall attack is executed in both directions through Pi's exact argv, and every range, the lockfile, the six toolchain pins and the package-source lint now fail loudly when broken.

## What Was Built

**Task 1 — `tests/unit/npmrc-policy.test.ts` (commit `82ced26`, 9 tests)**

Group A asks `npm config get ignore-scripts` and never reads a `.npmrc` — RESEARCH Pitfall 1 names checking a file's existence as the warning sign.

| Scope | Probe | Expected |
|---|---|---|
| Developer install + Pi's git path (`package-manager.ts:1829`) | cwd = repo root | `true` |
| Project-scope `pi install -l` (`package-manager.ts:2004`) | `--prefix <repo>/.pi/npm` | `true` |
| User-scope, **mechanism only** | `--prefix <tempAgentDir>/npm`, before and after writing bootstrap's bytes | `false` → `true` |
| Discrimination control | `--prefix <fresh temp dir>` | `false` |
| `--prefix` outranks cwd (RESEARCH §1.2 row 3) | cwd = repo root, `--prefix <bare>` | `false` |

The user-scope assertion deliberately touches no real home directory: it writes `ignore-scripts=true` into a throwaway `PI_CODING_AGENT_DIR`-shaped tree and proves those bytes change npm's answer. The live machine-state check is `bin/bootstrap.sh --assert-hardening` (Plan 06). The source contains no reference to the real agent directory path and no read of `process.env.HOME` or `os.homedir()`.

Group B installs `tests/fixtures/evil-postinstall` with `install <spec> --prefix <root> --legacy-peer-deps` — verbatim from `package-manager.ts:1758-1778` — with cwd set to the repo root **on purpose**, because that is the exact configuration RESEARCH §1.3 proved insufficient. Hardened prefix: no sentinel. Unhardened prefix: sentinel written. The second is what makes the first mean anything.

**Task 2 — `tests/unit/pinning.test.ts` (commit `f764e5b`, 26 tests)**

1. **No range may drift.** `dependencies`, `devDependencies` and `optionalDependencies` are scanned for `^ ~ * > <`, `||` and the ` - ` hyphen range. `"*"` is allow-listed for exactly the five host-provided peers and only inside `peerDependencies`, with the RESEARCH §8.3 resolution written into the source so a future reader does not "fix" it.
2. **Lockfile committed.** `trackedFiles("package-lock.json")` is exactly `["package-lock.json"]`; `npm-shrinkwrap.json` is absent both on disk and in the index.
3. **Alignment with Pi core 0.84.1.** Six literal pins asserted, plus an assertion that `devDependencies` holds *nothing else* — anything extra has not been through the Package Legitimacy Audit. The rejected registry-latest versions (`typescript` 7.0.2, `vitest` 4.1.10, `@types/node` 26.2.0, `typebox` 1.3.13) are recorded in a comment so an upgrade is a decision, not an accident.
4. **Package-source lint.** `isPinnedPackageSpec` is exported and proven against 5 pinned and 6 unpinned inline cases, then applied to `.pi/settings.json` `packages[]` with `https://github.com/kaiyitkoh/ky-pi-agent` as the single documented exemption (BOOT-02 mandates that literal unrefed command). No path under `.github/` is referenced — CI SHA pinning is Plan 08's file.

## Key Implementation Details

**The env leak is the finding of this plan.** The first run of Group A failed four assertions, all in the same direction: a *bare* temp prefix with no `.npmrc` reported `ignore-scripts=true`.

`[VERIFIED: executed 2026-08-13, npm 11.13.0, node 24.16.0]` — `npx` and `npm run` export the fully resolved config into the child as environment variables. Because the suite is launched from inside the repo, the launching npm had already read the repo `.npmrc` and exported 14 `npm_config_*` keys including:

```
npm_config_ignore_scripts=true
npm_config_save_exact=true
npm_config_local_prefix=C:\Users\Admin\Documents\ky-pi-agent
```

npm ranks environment config **above** any `.npmrc`. Two consequences, the second serious:

1. No discrimination control could ever go `false`.
2. Group B's hardened install would have been protected by the inherited variable rather than by the file under test. Deleting `.pi/npm/.npmrc`, or shipping a typo'd control, would still have shown a blocked postinstall — the suite would have certified a control it never exercised. That is the same class of false assurance (T-01-13) as the RESEARCH §1.3 field failure, arriving by a different route.

What surfaced it was the two-directional requirement. The unhardened variant refused to fire, which is a dud probe screaming rather than a control quietly passing. Every npm invocation in the file now runs against an environment with no `npm_config_*` keys, and a contract test asserts the sanitiser still strips them. A further test asserts the hazard directly: with `npm_config_ignore_scripts=true` injected, a bare prefix reports `true`; asked honestly, the same prefix reports `false`.

The full suite was then re-run under `npm test` — the leaking launcher — and is green, so the fix holds on the path CI will actually use.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Inherited `npm_config_*` made the probe measure the launcher, not the files**
- **Found during:** Task 1, first execution
- **Issue:** Detailed above. Four assertions failed; the hardened attack case would have passed for the wrong reason.
- **Fix:** `cleanNpmEnv()` strips every `/^npm_config/i` key from the environment handed to each `npm` invocation, plus a contract test and an explicit env-precedence hazard test.
- **Files modified:** `tests/unit/npmrc-policy.test.ts`
- **Commit:** `82ced26`

**2. [Rule 2 - Missing critical functionality] Two assertions added beyond the plan's list**
- **Found during:** Task 1
- **Issue:** The plan specified one discrimination control (bare prefix → `false`). The `--prefix`-outranks-cwd fact from RESEARCH §1.2 is the actual crux of BOOT-01 and was described in prose but asserted nowhere; an npm release changing it would have been discovered by an attacker rather than by CI. The before/after pair on the throwaway agent dir was likewise needed to make the user-scope "after" attributable to the file.
- **Fix:** Added both. Group A is 5 tests rather than the plan's 3.
- **Files modified:** `tests/unit/npmrc-policy.test.ts`
- **Commit:** `82ced26`

**3. [Rule 2 - Missing critical functionality] `devDependencies` closed to additions**
- **Found during:** Task 2
- **Issue:** Asserting the six pins are present says nothing about a seventh, unaudited dependency appearing beside them.
- **Fix:** Added an exact key-set assertion.
- **Files modified:** `tests/unit/pinning.test.ts`
- **Commit:** `f764e5b`

No architectural changes, no auth gates, no checkpoints, no package installs. No file owned by another plan in this wave was touched.

## Decisions Made

1. **Sanitise `npm_config_*`, do not work around it.** The alternative — accepting the inherited value and asserting only relative differences — would have left the suite unable to distinguish a working control from a working launcher.
2. **`isPinnedPackageSpec` is exported from the test file.** Phase 7 needs it; no production module exists yet and this plan's `files_modified` permits only the two test files. Moving it into `src/` when Phase 7 lands is a one-line import change.
3. **`optionalDependencies` included in the exact-range scan** though the plan named only two maps — it is a free escape hatch otherwise.
4. **The git branch of the spec regex accepts userinfo URLs** (`https://user@host/o/r` judges as pinned). Pi's accepted forms do not use userinfo and tightening risks rejecting legitimate refs; the residual is documented in the function's docstring rather than silently carried.

## Verification Results

Every plan-level and acceptance check, executed:

```
npx vitest run tests/unit/npmrc-policy.test.ts  ->  9 tests passed
npx vitest run tests/unit/pinning.test.ts       ->  26 tests passed
npx vitest run tests/unit                       ->  6 files, 113 tests passed
npm test (whole suite, leaking launcher)        ->  7 files, 117 tests passed
npx tsc --noEmit                                ->  exit 0
grep -c -- '--legacy-peer-deps' npmrc-policy    ->  2   (Pi's real argv shape)
grep -c -- '--prefix'           npmrc-policy    ->  9
grep -cF '~/.pi/agent'          npmrc-policy    ->  0
grep -cE 'process.env.HOME|homedir' npmrc-policy->  0
grep -cF '.github'              pinning         ->  0
```

**Mutation checks — all four gates are live** (each restored immediately; `git diff --stat` empty after every one):

| Mutation | Result |
|---|---|
| `.npmrc` → `ignore-scripts=false` | `× is true with cwd = the repo root` — 1 failed, 8 passed |
| `.pi/npm/.npmrc` removed | `× is true for the project-scope prefix <repo>/.pi/npm` — 1 failed, 8 passed |
| `devDependencies.typescript` → `^5.9.3` | `× devDependencies carries only exact versions`, `× pins typescript at 5.9.3` — 2 failed, 24 passed |
| `.pi/settings.json` `packages: ["…ky-pi-agent", "npm:pi-subagents"]` | `× every third-party entry … carries a ref` — 1 failed, 25 passed |
| same, with `npm:pi-subagents@0.47.1` | 26 passed — the exemption and the lint both behave |

**Attack liveness, both directions** (in-suite, and independently at the shell before the test was written):

| Prefix | Sentinel |
|---|---|
| `.npmrc` with `ignore-scripts=true` | absent — control effective |
| no `.npmrc` | **written** — fixture fires, so the row above is not a dud |

## Requirements Satisfied

- **BOOT-01 (coverage)** — npm's own reported configuration in three scopes, with a discrimination control and the `--prefix`-outranks-cwd fact both asserted, plus a real postinstall that runs on demand and is blocked on demand through Pi's exact argv. The user-scope leg proves the mechanism; its live machine-state check is owed by `bin/bootstrap.sh --assert-hardening` (Plan 06) and is **OUTSTANDING**, not passed.
- **BOOT-08** — exact ranges, tracked lockfile, six literal pins matching Pi core, and a package-source lint proven in both directions. CI action SHA pinning remains Plan 08's leg of this requirement.

## Known Stubs

None. No placeholder values, no TODO/FIXME, no unwired assertions. The `.pi/settings.json` `packages` branch takes an early return when the key is absent, which is the current and correct state (Plan 01 created `{}`); the lint it would apply is proven live against the inline table and was exercised end-to-end by the mutation check above, so it is not a stub.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns or schema changes were introduced. Both files are tests; all writes are confined to `os.tmpdir()` and removed in `afterEach`.

## Notes for Next Plan

- **`bin/bootstrap.sh` must sanitise `npm_config_*` too, or its `--assert-hardening` probe will report the launcher's config rather than the machine's.** In POSIX `sh`: `env $(env | sed -n 's/^\(npm_config_[^=]*\)=.*/-u \1/p') npm config get ignore-scripts --prefix "$dir"`, or simply `npm_config_ignore_scripts= npm config get …` for the single key that matters. This is the same trap as Pitfall 1 wearing different clothes, and a bootstrap invoked from `npm run bootstrap` would hit it.
- The bytes bootstrap should write into the user-scope npm prefix are exactly `ignore-scripts=true\n` — `BOOTSTRAP_NPMRC` in `npmrc-policy.test.ts` is the shared constant; keep them identical or the mechanism test stops describing the real thing.
- Plan 08's `tests/unit/ci-pinning.test.ts` owns `.github/**` SHA pinning; `pinning.test.ts` deliberately references nothing there.
- Phase 7 should import `isPinnedPackageSpec` from `tests/unit/pinning.test.ts` (or move it to a shared module and re-export) rather than writing a second regex.
- The two-directional pattern earned its keep twice in this phase now. Any new control assertion should ship with the case that must fail.

## Self-Check: PASSED

Both claimed files exist on disk (`tests/unit/npmrc-policy.test.ts`, `tests/unit/pinning.test.ts`). Both claimed commits (`82ced26`, `f764e5b`) exist in git history. Working tree clean after every mutation restore. Verified 2026-08-13.
