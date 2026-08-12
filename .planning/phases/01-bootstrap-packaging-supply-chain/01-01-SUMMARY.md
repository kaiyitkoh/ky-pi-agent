---
phase: 01-bootstrap-packaging-supply-chain
plan: 01
subsystem: bootstrap
tags: [supply-chain, packaging, toolchain, npmrc, vitest, typescript]
requires: []
provides:
  - committable-npmrc-controls
  - pi-package-manifest
  - vitest-test-framework
  - tsconfig-typecheck
  - repo-directory-skeleton
affects:
  - .gitignore
  - package.json
tech-stack:
  added:
    - "@earendil-works/pi-coding-agent@0.84.1 (dev)"
    - "@earendil-works/pi-ai@0.84.1 (dev)"
    - "typebox@1.3.7 (dev)"
    - "typescript@5.9.3 (dev)"
    - "vitest@4.1.9 (dev)"
    - "@types/node@24.12.4 (dev)"
  patterns:
    - "Supply-chain controls asserted through `npm config get` / `git check-ignore`, never by reading the file just written"
    - "Peers declared at `\"*\"`, exact pins live in devDependencies + lockfile"
    - "No build step — jiti loads .ts directly"
key-files:
  created:
    - .npmrc
    - .pi/npm/.npmrc
    - package.json
    - package-lock.json
    - tsconfig.json
    - vitest.config.ts
    - tests/unit/manifest.test.ts
    - .pi/settings.json
    - .pi/templates/env.example
  modified:
    - .gitignore
decisions:
  - "`.pi/npm/*` (contents form) not `.pi/npm/` (directory form), so `!/.pi/npm/.npmrc` can re-include a file git would otherwise refuse to reach"
  - "vitest `[SUS]` dismissed at source rather than escalated to a human checkpoint — repository.url re-confirmed as vitest-dev/vitest before install"
  - "Credential-pattern words removed from the .npmrc comment body so the file passes its own content assertion"
metrics:
  duration: ~15 min
  completed: 2026-08-13
  tasks: 3
  commits: 3
---

# Phase 1 Plan 01: Bootstrap Control Files & Toolchain Summary

Unblocked and shipped the two committable `.npmrc` supply-chain controls that `.gitignore:56` was silently swallowing, then stood up the Pi package manifest, exact toolchain pins, a committed lockfile, and the directory skeleton phases 2–11 write into.

## What Was Built

**Task 1 — `.npmrc` controls (commit `b3174c5`)**

`.gitignore` gained a final `# Supply-chain control files (must be committed)` section: `.pi/npm/*`, `.pi/git/`, `!/.npmrc`, `!/.pi/npm/.npmrc`. The blanket `.npmrc` rule on line 56 was deliberately **kept** — nested and user-level npmrc files can carry registry credentials and must stay ignored. Only the two rooted paths are re-included, and the negations sit last so git's last-matching-rule semantics make them win.

- `.npmrc` (repo root): `ignore-scripts=true` + `save-exact=true`, with a comment block citing the four source facts — Pi's git install path runs `npm install --omit=dev` with cwd = the clone (`package-manager.ts:1829`); the npm path passes `--prefix` so this file does *not* cover it (`:1778`); Pi installs itself with `--ignore-scripts` (`config.ts:174`), making the omission deliberate; and the explicit rejection of a global `~/.npmrc`.
- `.pi/npm/.npmrc`: `ignore-scripts=true`, covering project-scope `pi install -l` (prefix `<repo>/.pi/npm`, `package-manager.ts:2004`) and Pi's post-trust auto-install of missing project packages (`docs/packages.md:43`).

Every rule was verified by interrogating git and npm, not by reading the files:

| Probe | Expected | Got |
|---|---|---|
| `git check-ignore -q .npmrc` | 1 (committable) | 1 |
| `git check-ignore -q .pi/npm/.npmrc` | 1 | 1 |
| `git check-ignore -q sub/.npmrc` | 0 (still ignored) | 0 |
| `git check-ignore -q .pi/git/github.com/a/b` | 0 | 0 |
| `git check-ignore -q .pi/npm/node_modules/x` | 0 | 0 |
| `npm config get ignore-scripts` (cwd = repo) | `true` | `true` |
| `npm config get ignore-scripts --prefix "$PWD/.pi/npm"` | `true` | `true` |

**Task 2 — manifest, pins, lockfile (commit `559857c`)**

`package.json` with `keywords: ["pi-package"]`, `engines.node: ">=22.19.0"`, `type: "module"`, and a `pi` manifest whose `extensions` is the **literal** `"./.pi/extensions"` — not a glob, because `globSync` runs with `dot: false` and is fragile around the dot-prefixed `.pi` segment (`package-manager.ts:2290-2305`). All five peers declared at `"*"` verbatim from `docs/packages.md:171`. Scripts are `test`, `test:unit`, `typecheck` — **no `build`**.

The dev toolchain installed at exact versions (Pi core 0.84.1's own pins, deliberately not registry latest): `typescript@5.9.3` (latest is 7.0.2), `vitest@4.1.9` (4.1.10), `@types/node@24.12.4` (26.2.0), `typebox@1.3.7` (1.3.13), plus both `@earendil-works` packages at `0.84.1`. 290 packages added, 0 vulnerabilities, no lifecycle scripts ran — `save-exact=true` from Task 1 was already in force, so no `^` was ever written.

`tests/unit/manifest.test.ts` asserts manifest *shape* in 7 tests (exactness auditing is Plan 04's job): ESM type, `pi-package` keyword, engine string, `pi.extensions` deep-equality plus a no-glob-metacharacter assertion, the three other resource dirs, exactly-five-peers-at-`"*"`, and the absence of `scripts.build`.

**Task 3 — repo skeleton (commit `5273846`)**

Ten directories with `.gitkeep`: `.pi/{extensions,skills,prompts,themes,agents}`, `docs`, `bin`, `scripts`, `tests/integration`, `.github/workflows`. `.pi/settings.json` = `{}`. `.pi/templates/env.example` with four variable names and zero values, inside a `# ky-pi-agent managed:start` / `managed:end` region for idempotent bootstrap rewrites.

Critically, **no `.gitignore` was placed inside `.pi/extensions/`** — the package-discovery path honours one (`package-manager.ts:571`) while project-local discovery does not (`loader.ts:652-684`), so one would make BOOT-05 pass and BOOT-02 fail with no error message anywhere.

## Key Implementation Details

The highest-value thing in this plan is a two-line negation. `.gitignore:56` was a bare `.npmrc`, which meant the BOOT-01 control file could exist on the author's disk, look correct in review, and never reach a single clone — shipping the requirement as a no-op. The fix is ordering-sensitive (negations must come after the blanket rule) and directory-form-sensitive (`.pi/npm/` as a directory exclusion would make `!/.pi/npm/.npmrc` unreachable, reproducing the exact failure being fixed).

`peerDependencies: "*"` looks like a pin regression and is not. Peers are host-provided; jiti aliases every one of them to Pi's own bundled copy at load time (`loader.ts:118-140`). The exact pin lives in `devDependencies` and `package-lock.json`. The test file carries a comment saying so, so a future reader does not "fix" it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `.npmrc` comment tripped its own credential assertion**
- **Found during:** Task 1
- **Issue:** The comment block spelled out the forbidden patterns literally ("no `_authToken`, no `//registry...:_auth`, no `_password`"), which means the file *matches* `_authToken|_auth|_password` — failing the plan's own acceptance criterion and any content assertion Plan 04 writes against it.
- **Fix:** Reworded to describe the prohibition in prose without the literal token strings.
- **Files modified:** `.npmrc`
- **Commit:** `b3174c5`

No other deviations. No architectural changes, no auth gates, no checkpoints.

## Decisions Made

1. **`.pi/npm/*` contents-form ignore, not `.pi/npm/` directory-form** — pre-decided in the plan; implemented as written. Git cannot re-include a file whose parent directory is excluded.
2. **vitest `[SUS]` dismissed without a human checkpoint** — `npm view vitest repository.url` returned `git+https://github.com/vitest-dev/vitest.git` before installing, confirming the audit's source-level adjudication. Per the standing autonomous-run policy, this is not escalated.
3. **`license: "MIT"` and a `description` added to `package.json`** beyond the plan's literal field list — the repo has a LICENSE file and npm warns without them. Cosmetic; no constraint touched.

## Verification Results

All plan-level verification passes:

```
npx vitest run tests/unit   →  1 file, 7 tests passed
npx tsc --noEmit            →  exit 0
git check-ignore -q .npmrc  →  exit 1 (committable)
git check-ignore -q sub/.npmrc → exit 0 (ignored)
npm config get ignore-scripts (repo root, and --prefix .pi/npm) → true, true
devDependencies              →  no ^, ~, or * (PINS_EXACT_OK)
```

## Requirements Satisfied

- **BOOT-01** — `ignore-scripts=true` is in place, committable, and effective in two npm scopes, asserted before any `pi install` runs. Residual gaps (`pi install npm:*` at user scope, third-party git clones) are unchanged and are Plan 02's bootstrap job plus a README/runbook disclosure.
- **BOOT-08** — every dev dependency pinned exactly with `package-lock.json` under version control.

## Known Stubs

None. No placeholder values, no unwired components. `.pi/settings.json` is `{}` by design (its presence is the trust trigger); `.gitkeep` files are intentional empty-directory markers; `.pi/templates/env.example` intentionally carries names with no values.

## Notes for Next Plan

- `bin/bootstrap.sh` must write control 2 (`~/.pi/agent/npm/.npmrc`) and copy `.pi/templates/env.example` into `<repo>/.env.example` between the managed markers.
- The `assert_ignore_scripts()` helper shape is in RESEARCH §1.6; both probes it needs already return `true` on this machine.
- Plan 04's `.gitignore` policy test should be table-driven with both a `MUST_BE_IGNORED` and a `MUST_BE_COMMITTABLE` array — a one-directional test would pass on a `.gitignore` that swallows `.pi/extensions/`.
- `tests/integration/` is empty and `passWithNoTests: false` is set, so `npm test` (which runs the whole suite, not just `tests/unit`) is fine today only because `tests/unit` has content. Keep it that way.

## Self-Check: PASSED

All 10 claimed files exist on disk; all 3 claimed commits (`b3174c5`, `559857c`, `5273846`) exist in git history. Verified 2026-08-13.
