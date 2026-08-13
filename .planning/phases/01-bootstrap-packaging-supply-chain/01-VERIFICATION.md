---
phase: 01-bootstrap-packaging-supply-chain
verified: 2026-08-13T10:35:00Z
status: human_needed
score: 11/11 must-haves verified (offline); 4 live checks correctly recorded as OUTSTANDING and pre-authorised for human execution
overrides_applied: 0
human_verification:
  - test: "RB-01-01 (SAFE-16) — gh auth logout on the work laptop, then confirm /share aborts"
    expected: "sh scripts/check-gh-unauthenticated.sh (bare) exits 1 before logout, naming the risk; after `gh auth logout`, exits 0 with 'OK: gh is unauthenticated'; a live /share attempt aborts with 'GitHub CLI is not logged in.'"
    why_human: "Requires live credential state change on the actual work laptop (not this dev machine, where gh is legitimately authenticated for git-over-HTTPS push access). Documented in docs/RUNBOOK.md RB-01-01 as OUTSTANDING."
  - test: "RB-01-02 (BOOT-02) — pi install https://github.com/kaiyitkoh/ky-pi-agent on a clean profile"
    expected: "pi --list-models includes ky-harness-selftest, proving the manifest resolved, the extension directory was collected over the network, and the extension loaded."
    why_human: "Requires a clean Pi profile (PI_CODING_AGENT_DIR pointed at an empty directory) and real network egress to GitHub — this dev machine's profile already has trust/package state recorded. Offline proxy (tests/integration/load-paths.test.ts case 2, local clone + npm install --omit=dev) is verified passing; the real-URL fetch itself is untested here by design. Documented in docs/RUNBOOK.md RB-01-02 as OUTSTANDING."
  - test: "RB-01-03 (BOOT-05) — /reload re-registers the extension in an interactive TTY session"
    expected: "Editing SELFTEST_MODEL_ID and running /reload surfaces the new value in the same session, without restarting pi."
    why_human: "/reload is an interactive slash command with no non-interactive equivalent and no scriptable path; requires a TTY. Structural precondition (extension sits at an auto-discovered path) is verified by tests/unit/extension-layout.test.ts, which is necessary but not sufficient. Documented in docs/RUNBOOK.md RB-01-03 as OUTSTANDING."
  - test: "CI workflow's first live run on windows-latest and macos-latest (BOOT-06 conformance half, BOOT-07)"
    expected: "posix-lint job (shellcheck --shell=sh --severity=style + pin-audit) and the windows-latest/macos-latest test matrix (full vitest suite, bootstrap --check-only, gh check --warn-only, tsc) all pass on GitHub's runners."
    why_human: "Cannot be triggered from this machine — needs a push/PR against the GitHub-hosted repo. ci.yml is statically verified end-to-end by tests/unit/ci-pinning.test.ts (77 tests green) and shellcheck is confirmed absent locally, so the POSIX-conformance half genuinely cannot be exercised here. Never executed to date, per REQUIREMENTS.md traceability."
---

# Phase 1: Bootstrap, Packaging & Supply Chain Verification Report

**Phase Goal:** A cold machine can be brought to a state where installing and running the harness does not execute unreviewed third-party code with full permissions, and the repo shape every later phase writes into exists and loads both ways.
**Verified:** 2026-08-13T10:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

This phase's contract is unusual: 4 of its checks are structurally complete and offline-verified but require live execution on hardware/credentials this machine does not have (a work laptop, a clean Pi profile with network egress, and GitHub-hosted CI runners). Per the autonomous-run policy and `.planning/REQUIREMENTS.md`'s own `[~]` partial-completion convention, these are **not gaps** — they are exactly the outstanding-live-check category the phase itself documents and gates mechanically (`tests/unit/docs-policy.test.ts` enforces that `docs/RUNBOOK.md` cannot silently claim PASSED). All offline-verifiable work is genuinely built, tested, and independently re-executed in this verification pass — not merely trusted from SUMMARY.md.

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A project-scoped `.npmrc` sets `ignore-scripts=true`, asserted before the first `pi install`; README/runbook state the residual gap | VERIFIED | `.npmrc:24-25` committed with `ignore-scripts=true`; live: `git check-ignore -q .npmrc` exits 1 (committable), `npm config get ignore-scripts` → `true` at repo root and at `--prefix .pi/npm`. Ordering proven by `tests/integration/npmrc-ordering.test.ts` "BOOT-01 (ordering)" describe block (case 3 asserts recorded invocation order). README.md:76-94 states the residual gap (third-party git packages, any un-bootstrapped machine) explicitly with the exact per-command workaround. |
| 2 | `pi install <url>` loads a hello-world extension; `cd repo && pi` loads the same extension from `.pi/` with `/reload` working | PARTIAL — offline proven, live install and live `/reload` OUTSTANDING | Live-executed in this verification: `npx vitest run tests/integration/load-paths.test.ts` → 4/4 passed against the real installed `pi@0.84.1` binary (confirmed via `pi --version`) — package path (`-e <repoRoot>`), real `git clone` + `npm install --omit=dev`, dogfood path (`-a`), and the trust-gate negative control (sentinel absent without `-a`). The real-URL install on a clean profile and the interactive `/reload` re-registration are correctly recorded OUTSTANDING in `docs/RUNBOOK.md` RB-01-02/RB-01-03 — routed to human_verification below, not a gap. |
| 3 | CI is green on windows-latest and macos-latest: every script is POSIX sh, checks out LF, and actually executes | PARTIAL — statically proven, live run OUTSTANDING | `.github/workflows/ci.yml` read in full: `posix-lint` job runs `shellcheck --shell=sh --severity=style` on Ubuntu plus a `pin-audit` step re-resolving every SHA/tag comment through `gh api`; `test` matrix is `[windows-latest, macos-latest]` with `fail-fast: false`, installs the pinned Pi (`0.84.1`), runs `npx vitest run`, `sh bin/bootstrap.sh --check-only`, `sh scripts/check-gh-unauthenticated.sh --warn-only`, `npx tsc --noEmit`. Statically asserted end-to-end by `tests/unit/ci-pinning.test.ts` (77 tests, all green, re-run in this session). Local POSIX proxy: `dash -n bin/bootstrap.sh && dash -n scripts/check-gh-unauthenticated.sh` → both parse clean (dash confirmed present at `/usr/bin/dash`); `shellcheck` confirmed **absent** on this machine, consistent with the stated fact that `posix-lint` has never actually run. The live GitHub Actions run is correctly recorded as never-executed — human_verification below. |
| 4 | Bootstrap against an unpublished pinned Pi version stops with a message naming the version and fallback | VERIFIED | `tests/unit/version-gate.test.ts` case 2 hits the real npm registry with a confirmed-yanked version (0.73.0) and asserts the stderr names the version, the package, and contains "fallback" and "no longer published"; case 3 proves a network-outage stub is NOT misreported as unpublished (discriminates on the literal `E404` token, not exit code). Re-run in this session as part of the full 248-test suite — all passing. |
| 5 | A test proves no credential/runtime-state path is committable, `gh` is left unauthenticated, CONTRIBUTING.md states the boundary rule | VERIFIED (with `gh auth logout` itself OUTSTANDING on the work laptop) | `tests/unit/gitignore-policy.test.ts` "BOOT-09" describe block asserts a meaningful number of credential/state paths in both directions; `.npmrc`/`.pi/npm/.npmrc` asserted to carry no registry credential. `scripts/check-gh-unauthenticated.sh` read in full — correctly classifies via `gh auth status` and is unit-tested (`tests/unit/gh-unauthenticated.test.ts`, WR-11 fix confirmed present: vacuous assertion replaced with a real discriminating pair). `CONTRIBUTING.md:13-52` states the boundary rule verbatim ("A new capability defaults to a command or skill... becomes a tool only when you can state why") and is enforced by `tests/unit/contributing-boundary.test.ts` (part of the 77 green tests re-run). The actual `gh auth logout` on the work laptop is correctly recorded OUTSTANDING (SAFE-16, RB-01-01) — human_verification below. |

**Score:** 5/5 roadmap success criteria structurally and offline VERIFIED; 3 of them additionally carry a live-only sub-check correctly recorded OUTSTANDING per project convention (not a gap).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.npmrc` | Root ignore-scripts control | VERIFIED | Committed, `ignore-scripts=true`, no credential (grepped), live `npm config get` confirms effect |
| `.pi/npm/.npmrc` | Project-scope `pi install -l` control | VERIFIED | Committed, `ignore-scripts=true`, `.gitignore:154-157` explicitly re-includes it via `!/.pi/npm/.npmrc` |
| `bin/bootstrap.sh` | POSIX sh, four modes, hardens all 3 npm scopes before install | VERIFIED | 648 lines; `sanitise_npm_env` (CR-01 fix: refusing pass for un-unsettable `npm_config_*` keys, live-reproduced in this session — poisoned env now correctly refused with exit 1); `harden_pi_npm_root` (CR-02 fix: preserves existing `.npmrc` content via backup+rebuild instead of truncating, confirmed present at `:345-384`); `dash -n` parses clean |
| `scripts/check-gh-unauthenticated.sh` | SAFE-16 classifier | VERIFIED | 110 lines, read in full; `--warn-only` and bare modes both correct; `dash -n` parses clean |
| `.pi/extensions/harness/index.ts` | Sentinel extension, command + provider, never a tool | VERIFIED | Registers `ky-hello` command and `ky-harness-selftest` provider only; explicit BOUNDARY RULE comment; IN-05 fix confirmed (picker text now reads "diagnostic only, not routable") |
| `.github/workflows/ci.yml` | SHA-pinned actions, posix-lint + windows/macos matrix | VERIFIED (never executed live) | 202 lines; `actions/checkout@3d3c42e5...` (v7.0.1) and `actions/setup-node@820762786...` now correctly commented `# v7.0.0` (CR-03 fix confirmed — was previously mislabelled `# v5.0.0`) |
| `docs/RUNBOOK.md` | 3 Phase 1 entries, all OUTSTANDING | VERIFIED | All three (RB-01-01/02/03) read `OUTSTANDING` in both the summary table and the subsection status line; the only "PASSED" string in the file is in the format-explanation prose, not a status. Mechanically enforced by `tests/unit/docs-policy.test.ts` Group C (mutation-proven: parser correctly distinguishes OUTSTANDING/PASSED/INCONSISTENT/MISSING) |
| `README.md` | Residual-gap statement + second-machine/macOS setup | VERIFIED | Lines 55-119: covered/not-covered breakdown, git-package exception stated, `npm_config_ignore_scripts=true` one-shot workaround given, second-machine/macOS bootstrap procedure given |
| `CONTRIBUTING.md` | BOOT-10 boundary rule | VERIFIED | Lines 13-52, with token-cost citations to Pi source and a 3-question written-justification gate; enforced by `tests/unit/contributing-boundary.test.ts` |
| `package.json` / `package-lock.json` | Exact pins, committed lockfile | VERIFIED | No `^`/`~` ranges in devDependencies; `peerDependencies` correctly `"*"` for the 5 host-provided packages per Pi's own docs; enforced by `tests/unit/pinning.test.ts` (BOOT-08.1 through .4, 4 describe blocks) |
| `tests/fixtures/evil-postinstall/` | Live attack fixture for BOOT-01 | VERIFIED | Real postinstall script, private, zero deps, never referenced from root `package.json`, writes a sentinel to an env-supplied path |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `bin/bootstrap.sh` hardening functions | npm's actual config resolution | `npm config get ignore-scripts --prefix <scope>` | WIRED | Live-verified in this session against all reachable scopes (root, `.pi/npm`) |
| `bin/bootstrap.sh --assert-hardening` | before `install_pi` | Ordering — assertion runs first, install last | WIRED | `tests/integration/npmrc-ordering.test.ts` "BOOT-01 (ordering)" case 3 asserts the recorded invocation order mechanically |
| `.pi/extensions/harness/index.ts` | `pi --list-models` output | `pi.registerProvider` queued/flushed at runner bind | WIRED | Live-executed: real `pi@0.84.1` binary, 4/4 `load-paths.test.ts` cases pass, sentinel model id appears/absent correctly across all 4 load-path scenarios |
| `.github/workflows/ci.yml` `uses:` SHA pins | actual GitHub Actions releases | tag comment resolution | WIRED (offline table); pin-audit step unexecuted live | `tests/unit/ci-pinning.test.ts` asserts an explicit `AUDITED_PINS` table (SHA, tag) matches the workflow; CR-03's mislabelled `setup-node` comment confirmed corrected to `# v7.0.0` in this session |
| `scripts/check-gh-unauthenticated.sh` | Pi's `/share` gate | `gh auth status` exit code | WIRED (classifier); live application on work laptop OUTSTANDING | Script correctly documents that Pi's `/share` calls the same `gh auth status` check before writing any transcript; classifier unit-tested both directions |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| BOOT-01 | 01-01, 01-04, 01-05, 01-06, 01-10 | Project-scoped `.npmrc`, asserted before first install | VERIFIED (offline) | `.npmrc`, `sanitise_npm_env`/`harden_pi_npm_root` (both CR fixes confirmed), ordering test |
| BOOT-02 | 01-03, 01-10 | Clean-profile `pi install <url>` loads the extension | PARTIAL — offline VERIFIED, live OUTSTANDING (RB-01-02) | `load-paths.test.ts` case 2 live-passed against real clone; real URL fetch not exercisable here |
| BOOT-03 | 01-05, 01-06 | `bin/bootstrap.sh` cold-machine bootstrap | VERIFIED | Idempotent, probes tool presence, writes env template |
| BOOT-04 | 01-05 | Unpublished-Pi-version gate names version + fallback | VERIFIED | `version-gate.test.ts` case 2 hit real registry with confirmed-yanked version |
| BOOT-05 | 01-03, 01-10 | `.pi/` dogfood load + `/reload` | PARTIAL — offline VERIFIED, live `/reload` OUTSTANDING (RB-01-03) | `load-paths.test.ts` cases 3-4 live-passed; structural precondition proven by `extension-layout.test.ts`; interactive `/reload` needs TTY |
| BOOT-06 | 01-08 | POSIX sh + LF on both platforms | PARTIAL — LF VERIFIED both directions, POSIX conformance CI job never run | `lf-and-shell.test.ts` 15/15 pass; local `dash -n` parses clean (dash present, confirmed); `shellcheck` confirmed absent locally, `posix-lint` job never executed |
| BOOT-07 | 01-08 | CI green on windows-latest + macos-latest | PARTIAL — statically asserted, never actually run | `ci-pinning.test.ts` 77 tests green; workflow cannot be triggered from this machine |
| BOOT-08 | 01-04 | Exact pins, committed lockfile | VERIFIED | `pinning.test.ts` 4 describe blocks, no ranges found in devDependencies |
| BOOT-09 | 01-02 | No credential committable | VERIFIED | `gitignore-policy.test.ts`, bidirectional assertion |
| BOOT-10 | 01-09 | CONTRIBUTING.md boundary rule | VERIFIED | `CONTRIBUTING.md:13-52`, `contributing-boundary.test.ts` |
| SAFE-16 | 01-07, 01-10 | `gh` left unauthenticated, stated in runbook | PARTIAL — classifier VERIFIED, live `gh auth logout` OUTSTANDING (RB-01-01) | `check-gh-unauthenticated.sh` read in full, `gh-unauthenticated.test.ts` (WR-11 fix confirmed: vacuous assertion replaced) |

No orphaned requirements — all 11 IDs declared in ROADMAP.md Phase 1 requirements are claimed across the 10 plans and appear in `.planning/REQUIREMENTS.md` with matching (partial where appropriate) status.

### Anti-Patterns Found

None. Grepped `bin/bootstrap.sh`, `scripts/check-gh-unauthenticated.sh`, `.pi/extensions/harness/index.ts`, `.github/workflows/ci.yml`, `CONTRIBUTING.md`, `README.md`, `docs/RUNBOOK.md`, and the full `tests/` tree for `TODO|FIXME|XXX|TBD` — zero matches. No debt-marker gate violations.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| `.npmrc` is committable and effective | `git check-ignore -q .npmrc && npm config get ignore-scripts` | exit 1 (committable), `true` | PASS |
| Project-scope `.pi/npm` scope hardened | `npm config get ignore-scripts --prefix .pi/npm` | `true` | PASS |
| CR-01 sanitiser refuses un-unsettable poison | `env "npm_config_ignore-scripts=true" ... bootstrap.sh --assert-hardening` | `FATAL: npm configuration is being overridden...` exit 1 | PASS |
| CR-03 setup-node tag comment corrected | `grep setup-node .github/workflows/ci.yml` | `# v7.0.0` (matches the pinned SHA's actual tag) | PASS |
| dash (real POSIX shell) parses both shipped scripts | `dash -n bin/bootstrap.sh && dash -n scripts/check-gh-unauthenticated.sh` | exit 0 | PASS |
| Full test suite | `npm test` | 15 files / 248 tests, all green | PASS |
| Typecheck | `npx tsc --noEmit` | exit 0 | PASS |
| Load-path integration (real `pi` binary) | `npx vitest run tests/integration/load-paths.test.ts` | 4/4 pass against installed `pi@0.84.1` | PASS |
| `shellcheck` availability (proxy for BOOT-06 conformance gap) | `which shellcheck` | not found | Confirms context: `posix-lint` CI job genuinely never run here |

### Human Verification Required

### 1. RB-01-01 (SAFE-16) — `gh auth logout` on the work laptop

**Test:** Run `sh scripts/check-gh-unauthenticated.sh` bare (not `--warn-only`) on the work laptop; run `gh auth logout`; re-run the script; then start a real interactive Pi session and type `/share`.
**Expected:** Before logout: exit 1, "gh IS authenticated. /share can upload this session to a GitHub gist." After logout: exit 0, "OK: gh is unauthenticated; /share aborts before export." Live `/share` attempt aborts with "GitHub CLI is not logged in."
**Why human:** Needs the actual work-laptop credential state; this dev machine's `gh` is legitimately authenticated for git push access and must not be logged out.

### 2. RB-01-02 (BOOT-02) — real-URL `pi install` on a clean profile

**Test:** With `PI_CODING_AGENT_DIR` pointed at an empty directory, run `pi install https://github.com/kaiyitkoh/ky-pi-agent`, then `pi --list-models`.
**Expected:** `ky-harness-selftest` appears in the model list.
**Why human:** Requires a genuinely clean Pi profile and live network egress to GitHub; this machine's profile already has state from development.

### 3. RB-01-03 (BOOT-05) — `/reload` in an interactive TTY

**Test:** `cd ky-pi-agent && pi`, accept project trust, edit `SELFTEST_MODEL_ID` in `.pi/extensions/harness/index.ts`, run `/reload`, confirm the new value appears in the same session.
**Expected:** The edited sentinel id appears without restarting `pi`.
**Why human:** `/reload` has no non-interactive equivalent and requires a TTY.

### 4. First live CI run (BOOT-06 posix-lint job, BOOT-07 windows/macos matrix)

**Test:** Push to `main` or open a PR against the GitHub-hosted repo and observe the `posix-lint`, and `test (windows-latest)` / `test (macos-latest)` jobs.
**Expected:** `posix-lint` passes `shellcheck --shell=sh --severity=style` on both scripts and the `pin-audit` step confirms every SHA/tag pair; both matrix legs execute the full 248-test suite, `bootstrap.sh --check-only`, the `gh` check, and `tsc --noEmit` successfully.
**Why human:** Cannot be triggered from this local machine; requires the GitHub-hosted runner infrastructure. Never executed to date.

### Gaps Summary

No gaps. Every artifact claimed by the 10 SUMMARY.md files was independently re-verified against the actual codebase in this session, not merely trusted: the full test suite (248/248) and typecheck were re-run, the three CRITICAL review findings (CR-01, CR-02, CR-03) were live-reproduced with their original repro commands rather than trusted from `01-REVIEW.md`'s narrative, `docs/RUNBOOK.md`'s three entries were confirmed to genuinely read `OUTSTANDING` (not silently promoted), and the load-path integration test was executed in isolation against the real, correctly-pinned `pi@0.84.1` binary — proving BOOT-02/BOOT-05's offline halves rather than assuming them. The four items routed to human verification are exactly the live-credential/live-infrastructure checks the phase's own `docs/RUNBOOK.md` and `.planning/REQUIREMENTS.md` `[~]` markers already name as outstanding — this is the pre-authorised, expected shape of a Phase 1 outcome under the autonomous-run policy, not a finding of missing work.

---

_Verified: 2026-08-13T10:35:00Z_
_Verifier: Claude (gsd-verifier)_
