---
phase: 1
slug: bootstrap-packaging-supply-chain
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-13
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` § Validation Architecture (line 1106).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.9 (matches Pi core's own pin) |
| **Config file** | `vitest.config.ts` — **does not exist; Wave 0 creates it** |
| **Quick run command** | `npx vitest run tests/unit` |
| **Full suite command** | `npx vitest run && npx tsc --noEmit` |
| **Estimated runtime** | ~30–60 seconds (the `pi` subprocess and local-clone tests dominate) |
| **Phase gate** | Full suite green on `windows-latest` **and** `macos-latest`, plus the Ubuntu shellcheck job |

**Constraint:** no build step. Pi loads `.ts` through jiti; `tsconfig.json` is `noEmit` type-checking only. Nothing from `@earendil-works/*` or `typebox` may be bundled — they are `peerDependencies: "*"`.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit`
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green on all three CI legs
- **Max feedback latency:** 60 seconds

---

## Per-Requirement Verification Map

Task IDs are assigned at plan time; the columns below bind each requirement to the exact
sampling command that proves it. Every plan task must map to one of these rows or add a row.

| Requirement | Threat Ref | Observable signal / secure behavior | Test Type | Automated Command | File Exists | Status |
|-------------|-----------|--------------------------------------|-----------|-------------------|-------------|--------|
| BOOT-01 (coverage) | T-01 Malicious `postinstall` (V10) | `npm config get ignore-scripts` is `true` for repo root, `~/.pi/agent/npm`, and `<repo>/.pi/npm`; a local fixture package with a sentinel-writing `postinstall` installs **without** writing its sentinel | unit + local e2e | `npx vitest run tests/unit/npmrc-policy.test.ts` | ❌ W0 | ⬜ pending |
| BOOT-01 (ordering) | T-01 | Bootstrap exits non-zero **before** any `pi install` when the control is absent | integration | `sh bin/bootstrap.sh --check-only` with `PI_CODING_AGENT_DIR` → temp dir lacking `.npmrc`; expect exit 1 + `ignore-scripts` on stderr | ❌ W0 | ⬜ pending |
| BOOT-02 (package path) | — | Sentinel model id appears in `--list-models` when the package is loaded from an unrelated cwd | integration | `cd $(mktemp -d) && pi --offline -e "$REPO" --list-models \| grep -q ky-harness-selftest` | ❌ W0 | ⬜ pending |
| BOOT-02 (real clone) | T-03 Credential leak via commit (V14) | Same, through an actual `git clone` + `npm install --omit=dev` — proves the control files are genuinely committed and no devDep is needed at runtime | integration | `git clone "$REPO" "$T" && (cd "$T" && npm install --omit=dev) && pi --offline -e "$T" --list-models \| grep -q ky-harness-selftest` | ❌ W0 | ⬜ pending |
| BOOT-03 | — | Every probe reports; required tools fail the run, optional tools only warn; two runs are byte-identical (idempotent) | integration | `sh bin/bootstrap.sh --check-only` → exit 0, stdout contains `glab` and `optional`; diff of two consecutive runs is empty | ❌ W0 | ⬜ pending |
| BOOT-04 | T-06 Stale/yanked pin (V14) | Unpublished pinned version produces an actionable message naming the version **and** the fallback; a network error produces a *different*, non-"unpublished" message | unit | `npx vitest run tests/unit/version-gate.test.ts` — `PI_PINNED=0.73.0` → exit 1, stderr matches `/0\.73\.0/` and `/[Ff]allback/`; recorded-fixture case for the offline leg | ❌ W0 | ⬜ pending |
| BOOT-05 (dogfood path) | T-04 Trust gate is not a security boundary (V4) | Sentinel present with `-a`, **absent** without it — proves the assertion is real and not vacuously passing through the trust gate | integration | `cd "$REPO" && pi --offline -a --list-models \| grep -q ky-harness-selftest` **and** the no-`-a` run does *not* contain it | ❌ W0 | ⬜ pending |
| BOOT-05 (`/reload`) | — | Every shipped extension lives under an auto-discovered path (`.pi/extensions/*.ts` or `*/index.ts`) — the documented precondition for hot-reload | structural unit | `npx vitest run tests/unit/extension-layout.test.ts` | ❌ W0 | ⬜ pending |
| BOOT-06 | T-05 CRLF / bashism breakage | No `\r` byte in any tracked `*.sh`; shellcheck clean under `--shell=sh` | unit + CI lint | matrix: node CR-scan over `git ls-files '*.sh'`; ubuntu: `shellcheck --shell=sh $(git ls-files '*.sh')` | ❌ W0 | ⬜ pending |
| BOOT-07 | — | Both matrix legs green with `fail-fast: false`; scripts **execute**, not merely lint | CI | the workflow itself on `windows-latest` + `macos-latest` | ❌ W0 | ⬜ pending |
| BOOT-08 | T-02 Dependency confusion / T-07 unpinned source (V14) | No `^`/`~`/`*` in `dependencies`/`devDependencies` (five documented peers allow-listed); `package-lock.json` tracked; every `settings.json` `packages[]` entry carries a version or git ref; every CI `uses:` pinned by commit SHA | unit | `npx vitest run tests/unit/pinning.test.ts` | ❌ W0 | ⬜ pending |
| BOOT-09 | T-03 Credential exfiltration (V14) | `git check-ignore -q` returns the expected verdict for every path in the credential/runtime-state inventory; the committed `.npmrc` contains no `_authToken`/`_auth`/`_password` | unit | `npx vitest run tests/unit/gitignore-policy.test.ts` | ❌ W0 | ⬜ pending |
| BOOT-10 | — | `CONTRIBUTING.md` states the boundary rule; the phase does not violate it in the same commit | unit | `npx vitest run tests/unit/contributing-boundary.test.ts` — file matches `/default.*command or skill/i` **and** `registerTool` appears nowhere under `.pi/extensions/**` | ❌ W0 | ⬜ pending |
| SAFE-16 | T-04 `/share` transcript exfiltration | `scripts/check-gh-unauthenticated.sh` classifies both states correctly, asserted against a **PATH-stubbed `gh`** (exit 0 → script fails, exit 1 → script passes); README and runbook state the control and that logout is the only mechanism | unit + docs assertion | `npx vitest run tests/unit/gh-unauthenticated.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Why the `gh` test is stubbed, not live:** research confirmed `gh` is currently authenticated **with `gist` scope** on this dev machine. Asserting on real machine state would fail for any developer legitimately logged in for other work, and would pass vacuously on a machine that never had `gh`. The test asserts the classifier; the live control is applied via the runbook.

---

## Wave 0 Requirements

Nothing exists yet — this is a greenfield repo. Wave 0 is large by necessity.

- [ ] `package.json` — the `pi` manifest, exact pins, `peerDependencies`, `keywords: ["pi-package"]`. **Everything below depends on it.**
- [ ] `vitest.config.ts` — no test framework is configured
- [ ] `tsconfig.json` — `noEmit` type-check against Pi's shipped `.d.ts`
- [ ] `tests/helpers/git.ts` — `isIgnored(path)` wrapper around `git check-ignore -q`
- [ ] `tests/helpers/pi.ts` — `runPi(args, cwd)` wrapper capturing stdout/stderr/exit
- [ ] `tests/helpers/stub-bin.ts` — PATH-prepending stub factory (required by the `gh` test)
- [ ] `tests/fixtures/evil-postinstall/` — local package whose `postinstall` writes a sentinel (BOOT-01 end-to-end)
- [ ] **`.gitignore` fixes — `!/.npmrc`, `.pi/npm/`, `.pi/git/`.** ⚠️ **BLOCKING:** `.gitignore:56` currently ignores `.npmrc`, so BOOT-01's control file can never be committed and never reaches a clone. BOOT-01 ships a no-op until `!/.npmrc` lands.
- [ ] Framework install: `npm install --save-dev --save-exact vitest@4.1.9 typescript@5.9.3 @types/node@24.12.4 @earendil-works/pi-coding-agent@0.84.1 @earendil-works/pi-ai@0.84.1 typebox@1.3.7`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions | Status |
|----------|-------------|------------|-------------------|--------|
| `gh auth logout` actually applied on the work laptop | SAFE-16 | Needs the work machine; this dev box's `gh` state is irrelevant and must not be mutated by a test | Runbook: run `gh auth logout`, then confirm `gh auth status` exits non-zero, then confirm `/share` in a live Pi session aborts | **OUTSTANDING** — never mark passed |
| `pi install https://github.com/kaiyitkoh/ky-pi-agent` against the real remote | BOOT-02 | Needs a clean profile and network egress to GitHub | Runbook: on a clean profile, run the install, then `pi --list-models \| grep ky-harness-selftest` | **OUTSTANDING** — local-clone test is the offline proxy |
| `/reload` re-registers the extension | BOOT-05 | Requires an interactive TTY; `/reload` is a slash command with no non-interactive equivalent | Runbook: `cd ky-pi-agent && pi`, edit the sentinel string, `/reload`, confirm the new value in `--list-models` | **OUTSTANDING** — structural assertion is the offline proxy |

These three are *outstanding*, not *failed*. Per the standing autonomous-run policy they are built and unit-verified offline, carry a runbook entry, and their live check is never reported as passing.

---

## Sampling Continuity Check

No 3 consecutive tasks may land without an automated verify. The Wave 0 helper modules
(`tests/helpers/*`) are themselves verified by the first test that consumes them, so Wave 0
tasks 1–3 (`package.json`, `tsconfig.json`, `vitest.config.ts`) are covered by
`npx vitest run --reporter=dot` returning exit 0 on an empty suite plus `npx tsc --noEmit`.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all `❌ W0` references above
- [ ] No watch-mode flags (`vitest run`, never bare `vitest`)
- [ ] Feedback latency < 60s
- [ ] Three manual-only items carry runbook entries and are marked OUTSTANDING, not passed
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
