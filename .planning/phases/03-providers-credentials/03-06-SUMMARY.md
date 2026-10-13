---
phase: 03-providers-credentials
plan: 06
subsystem: bootstrap-installer
tags: [wave-2, bootstrap, templates, merge-if-absent, dashscope, PROV-01, PROV-04]
requires:
  - ".pi/templates/models-template.json — the DashScope provider block this installs (03-02)"
  - ".pi/templates/auth-template.json — the three credential entries this installs (03-02)"
  - "bin/bootstrap.sh merge_settings / write_env_template — the two shapes both new functions copy (Phase 1)"
  - "tests/integration/bootstrap-check-only.test.ts — the subprocess runner, the npm stub and the idempotence shape (Phase 1)"
  - "tests/helpers/models.ts — withModelsConfig, pointed at the INSTALLED pair rather than the templates (03-01)"
provides:
  - "bin/bootstrap.sh merge_models_json — key-namespaced replace of providers.dashscope with the install-time KYPI_DASHSCOPE_BASE_URL substitution"
  - "bin/bootstrap.sh merge_auth_json — per-provider-key merge-if-absent into $PI_AGENT_DIR/auth.json"
  - "tests/integration/templates-install.test.ts — install, idempotence, do-not-clobber, refusal, base-URL seam, interpolation and secret-shape scan"
affects:
  - "docs/RUNBOOK.md RB-03-01 — the KYPI_DASHSCOPE_BASE_URL remedy is now a live seam and works on a RE-run, not only on a clean install"
  - "03-0x (loopback payload test) — the installed models.json is the file a live check would use"
  - "every future plan that changes either template — case 1 deep-equals the installed block against the template parse, so a drift fails loudly"
tech-stack:
  added: []
  patterns:
    - "two different merge semantics in one installer, chosen per file by what the file may hold: key-namespaced REPLACE for our own provider block, merge-if-ABSENT for a credential file"
    - "a whole-line-only // comment strip, duplicated between the installer and the test and tied together by a deep-equal so the duplication cannot drift silently"
    - "a paste guard NARROWED with stated reasons rather than allowlisted, with both narrowings asserted live in both directions"
key-files:
  created:
    - tests/integration/templates-install.test.ts
  modified:
    - bin/bootstrap.sh
decisions:
  - "merge_models_json REPLACES providers.dashscope rather than writing it only when absent (RESEARCH §Q1.4's literal wording). The documented RB-03-01 remedy is `set KYPI_DASHSCOPE_BASE_URL and re-run bootstrap`, which a write-only-when-absent rule would silently ignore on every machine that had already bootstrapped once. auth.json keeps the strict merge-if-absent rule, which is where the credential hazard actually lives."
  - "A destination models.json that fails JSON.parse is REFUSED rather than comment-stripped. Pi strips // comments from models.json and JSON.parse does not, so a user's commented file lands in the refusal branch; the FATAL says so and tells them to merge by hand rather than have the script rewrite the file without their comments."
  - "The secret-shape scan excludes runs that are one repeated character (the template's `// -----` rule lines) and runs that are purely alphabetic (`requiresReasoningContentOnAssistantMessages`, 43 characters). Every credential format in scope carries a digit or a non-alphanumeric, so this excludes identifiers and prose without excluding tokens — and both exclusions are asserted live in both directions."
metrics:
  duration: ~30m
  tasks: 2
  files: 2
  completed: 2026-08-13
requirements-completed: [PROV-01]
---

# Phase 3 Plan 06: The Template Installer Summary

Two templates finally reach the only directory Pi reads, installed by a script
that replaces its own provider block, adds a credential entry only when one is
absent, and refuses a file it cannot parse rather than guessing.

## What was built

### Task 1 — `merge_models_json` / `merge_auth_json` in `bin/bootstrap.sh` (commit `217bed3`)

Both in the `merge_settings` shape: read, parse in `node -e`, refuse a target
that is not valid JSON, replace only the key that is ours, print
`already current - unchanged` and exit 0 on a no-op. Both wired into `run_full`
after `install_pi` beside `merge_settings` / `write_env_template`; neither in
`--check-only` (which mutates nothing and has a test asserting exactly that) nor
in `--assert-hardening` (the BOOT-01 ordering proof, which must need no network
and no templates). The BOOT-01 ordering clause is untouched.

**The two files get different merge semantics on purpose**, and the reason is
written into the script:

| file | semantics | why |
|---|---|---|
| `models.json` | key-namespaced **replace** of `providers.dashscope` | that key is the harness's own definition, exactly as `settings.json`'s `kyPiAgent` is, and it must be *updatable*: RB-03-01's documented remedy is "set `KYPI_DASHSCOPE_BASE_URL` and re-run bootstrap" |
| `auth.json` | per-key merge-if-**absent** | this file may hold live credentials for every provider the user has ever configured; an existing entry is never modified, merged into or reordered [threat T-03-06-01] |

The models template carries whole-line `//` comments deliberately — every number
in it has to carry its source — so the installer strips them before
`JSON.parse`. **Whole-line only**, which is what the template promises in its own
header: a naive strip of every `//` would eat the `https://` inside `baseUrl`.

`KYPI_DASHSCOPE_BASE_URL` is the only value the installer transforms, and it
crosses into `node -e` through the environment like every other value in this
script, never through shell interpolation into the JS source — a base URL is
caller-supplied text and would otherwise be a code-injection seam. It is
documented in the usage `Environment:` block, naming the workspace-dedicated
form as its purpose and RB-03-01 as the entry that says when to set it.

Nothing here writes a secret: both templates carry `$ENV_VAR` references only,
which is why the file mode is not this script's business — and why the
"`auth.json` mode `0600` is a no-op on Windows" note already in
`docs/RUNBOOK.md`'s Phase 1 machine-state section is *referenced* in a comment
rather than restated.

**Smoke-run, executed rather than assumed** (temp `PI_CODING_AGENT_DIR`,
`KYPI_SKIP_INSTALL=1`): first run reported `models.json providers.dashscope key
merged` and `auth.json provider entries added: dashscope, deepseek,
amazon-bedrock`; a second run with `KYPI_DASHSCOPE_BASE_URL` set reported
`auth.json already current - unchanged` and installed the new base URL — i.e.
the RB-03-01 remedy works on a machine that has already bootstrapped, which is
the only machine that will ever need it.

### Task 2 — `tests/integration/templates-install.test.ts` (commit `2503ed9`)

Thirteen cases. Every bootstrap run sets `PI_CODING_AGENT_DIR` to a fresh temp
dir **and** `KYPI_SKIP_INSTALL=1`, with a stubbed `npm` first on PATH whose
invocation log is asserted **before** anything about the installed files — two
independent guards plus a proof the script was reached at all [threat
T-03-06-05]. `.env.example`, the one tracked file a full run legitimately owns,
is snapshotted and restored around every case.

- **case 1** clean install: both files exist; the installed `providers.dashscope`
  **deep-equals** the template's parsed block (so the comment strip duplicated
  between installer and test cannot drift silently), and `thinkingFormat` is
  called out by name because its loss is the one that is completely silent.
- **case 2** two runs, byte-identical `models.json` **and** `auth.json`, plus the
  `already current - unchanged` report — that report is what makes an unchanged
  file evidence of a correct merge rather than of a step that never ran.
- **case 3, the one that matters** a pre-existing `auth.json` holding a foreign
  vendor's entry **and** a `dashscope` entry with a `!command` value the user
  chose. Both survive byte-for-byte. Paired positive: the two *absent* template
  entries must have been added in the same run, so an installer that did nothing
  cannot pass.
- **cases 4 / 4b** invalid JSON in each target: non-zero exit, a FATAL naming the
  file, and the file's bytes unchanged. 4b additionally asserts `models.json`
  exists, so the failure is demonstrably the auth refusal and not an early abort.
- **case 5** `KYPI_DASHSCOPE_BASE_URL` reaches the installed file while the
  committed template is byte-unchanged and still carries the shared
  `dashscope-intl` host [threat T-03-06-03].
- **case 6** PROV-01's interpolation half, against the **installed** pair:
  `getProviderAuth("dashscope").auth.apiKey` equals the fixture
  `DASHSCOPE_API_KEY` with `source: "stored credential"`. The blank-environment
  control asserts the resolution returns **nothing at all** — verified by
  execution that Pi resolves a blank reference to `undefined` rather than to the
  literal, which is stated in the file so the two `not.toBe` assertions are not
  mistaken for the load-bearing ones.
- **case 7** the secret-shape scan over both committed templates: `TOKEN_SHAPED`
  over the raw text, and `\bsk-` / `AKIA` / leading-`!` over every string value at
  any depth, with the non-empty guards asserted first and a live case proving the
  narrowed pattern still matches synthetic tokens.

**Falsified five ways, each turning exactly the intended cases red:**

| Mutation | Result |
|---|---|
| `merge_auth_json` overwrites every key instead of skipping present ones | 1 failed — case 3 |
| Both merges swallow invalid JSON instead of refusing | 2 failed — cases 4 and 4b |
| The `KYPI_DASHSCOPE_BASE_URL` substitution removed | 1 failed — case 5 |
| Both merges unwired from `run_full` | 7 failed — cases 1, 2, 3, 4, 4b, 5, 6 |
| A synthetic `sk-` token pasted into a comment of one template and into a value of the other | 4 failed — three case 7s and case 6 |

The fourth is the important one for case 3: an installer that does nothing
leaves an existing `auth.json` perfectly unmodified, and only the paired positive
turns that into a failure.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 - Missing critical] `merge_models_json` replaces its own key rather than writing only when absent**

- **Found during:** Task 1.
- **Issue:** RESEARCH §Q1.4 words `merge_models_json` as "writes
  `providers.dashscope` only when that key is absent". That rule makes the
  install-time base-URL seam dead on arrival: RB-03-01's documented remedy is to
  set `KYPI_DASHSCOPE_BASE_URL` and re-run bootstrap, and the only machine that
  ever needs that remedy is one that has already bootstrapped once and therefore
  already has the key.
- **Fix:** `models.json` gets a key-namespaced **replace** — the analog
  `merge_settings` shape, which owns `settings.json`'s `kyPiAgent` key the same
  way — with every other key of the file preserved. `auth.json` keeps the strict
  merge-if-absent rule unchanged, which is where the actual credential hazard
  (Trap T7, threat T-03-06-01) lives. The plan's own task text supports this
  reading ("merges … under the `providers.dashscope` key only … Preserve every
  other key of the target file untouched"), its acceptance criteria never require
  merge-if-absent for `models.json`, and neither does the `must_haves` block.
- **Files modified:** `bin/bootstrap.sh`
- **Commit:** `217bed3`

**2. [Rule 2 - Missing critical] The negative control in case 6 was strengthened from vacuous to real**

- **Found during:** Task 2 verification.
- **Issue:** The plan asks for "with the variable unset, the resolved key is not
  the literal string `$DASHSCOPE_API_KEY`". Executed against the real pair, Pi
  resolves a blank reference to `undefined` outright — so that assertion is true
  without exercising anything.
- **Fix:** Added `expect(result).toBeUndefined()` as the load-bearing assertion
  and wrote the executed observation into the file, so a future reader knows
  which assertion carries the case.
- **Files modified:** `tests/integration/templates-install.test.ts`
- **Commit:** `2503ed9`

### Acceptance criterion that was already false before this plan

`grep -cE '\[\[|local |declare ' bin/bootstrap.sh` is specified as `0`; it is
`1`, and has been since Phase 1. The single hit is
`grep -v '^[[:space:]]*ignore-scripts[[:space:]]*='` at line 373 — a POSIX
bracket-expression character class, fully portable, and the exact false positive
that `tests/unit/lf-and-shell.test.ts:101-107` documents and excludes with
`/\[\[(?!:)/`. Nothing in this plan added a bashism: the real gates —
`findBashisms` and `dash -n bin/bootstrap.sh` — are both green.

**RESOLVED 2026-08-14 (phase-close sweep).** The paragraph above understated the
problem, and the understatement is the interesting part. The criterion was false
in *both* directions. Red-on-clean is only the visible half: because that grep
was the sole place `local` and `declare` were checked anywhere in the repo, and
it could only ever be waived, nothing gated them. `findBashisms` had no `local`
pattern at all and matched only `declare -A` (uppercase `-A`); `dash -n` parses
`local`, `declare` and `typeset` without complaint because a parse does not
resolve builtins. Executed: replacing `_label=$1` at `bin/bootstrap.sh:295` with
`local _label=$1` left the ENTIRE local suite green, while on the ubuntu CI leg
(`/bin/sh` is dash) `declare` would abort the script at runtime with
`declare: not found`. The claim that "the real gates are both green" was true
only because those gates were not looking.

Fix: `tests/unit/lf-and-shell.test.ts` `BASHISMS` gains two statement-anchored
entries — `declare`/`typeset` and `local` — plus live positive controls and
three prose/string near-miss controls. Falsified against all three mutations
(`local`, `declare`, `typeset` at `bin/bootstrap.sh:295`); each turns
`bin/bootstrap.sh uses no bash-4 or GNU-only construct` red with a named label,
and `dash -n` exits 0 on all three. The plan-level criteria at
`03-06-PLAN.md:125` and `01-05-PLAN.md:121,189` were rewritten to point at the
live test instead of restating the broken grep.

No Rule 4 (architectural) decisions arose. No packages were installed; the test
stubs `npm` in every run.

## Autonomous decisions

- A destination `models.json` that fails `JSON.parse` is **refused**, not
  comment-stripped and rewritten. Pi accepts `//` comments in `models.json` and
  `JSON.parse` does not, so a legitimately-commented user file lands in the
  refusal branch. Rewriting it would silently delete their comments; the FATAL
  therefore names that case explicitly and tells them to merge by hand. Refusing
  to guess beats a lossy rewrite, per `sanitise_npm_env`'s posture.
- The secret-shape scan is **narrowed with stated reasons**, not allowlisted. Two
  shapes in the models template trip the raw `TOKEN_SHAPED` pattern — the `// ---`
  rule lines and the 43-character `requiresReasoningContentOnAssistantMessages` —
  and neither can be a credential, because every format in scope carries a digit
  or a non-alphanumeric. Both narrowings are asserted live in both directions so
  they cannot quietly become an escape hatch.

## What this does NOT prove

Nothing here contacted a provider and nothing here could. That the installed
`models.json` makes DashScope answer is `RB-03-01` / `RB-03-02` and remains
**OUTSTANDING**; that the installed `auth.json` authenticates Bedrock is
`RB-03-03`, likewise. Case 6 proves that **Pi** resolves the credential document
offline — a statement about Pi and about the template, never about a provider.
`PROV-01` and `PROV-04` are advanced by this plan; `PROV-04` is not completed by
it, and Trap T12 forbids marking it passing on a green offline half.

## Known Stubs

None. The one placeholder in play — `REPLACE_WITH_AWS_PROFILE_NAME` in the auth
template — is a declared, deliberately non-empty literal from plan 03-02 (Trap
T8: `""` would win over the ambient variable through `??` and present as a
Bedrock outage rather than a misconfiguration), and `RB-03-03` is the entry that
replaces it on the work laptop.

## Verification

| Check | Result |
|---|---|
| `dash -n bin/bootstrap.sh` | exit 0 |
| `grep -c 'KYPI_DASHSCOPE_BASE_URL' bin/bootstrap.sh` | 4 (≥ 2 required) |
| No `sed`/`awk` operating on a `.json` path | 0 hits |
| Both functions called from `run_full` after `install_pi`; in neither `--check-only` nor `--assert-hardening` | pass |
| Live smoke run against a temp agent dir, twice, second with the base-URL override | both merges reported correctly; `auth.json` unchanged on the re-run |
| `npx vitest run tests/unit/lf-and-shell.test.ts tests/integration/bootstrap-check-only.test.ts` | 19 passed |
| `npx vitest run tests/integration/templates-install.test.ts` | 13 passed |
| Five falsification runs | each turned exactly the intended cases red |
| `npm test` | 41 files, 578 passed |
| `npm run typecheck` | clean |
| `git status --porcelain` after the suite | no tracked file outside `files_modified` differs |

## Self-Check: PASSED

Both created/modified files present on disk; both commits (`217bed3`, `2503ed9`)
present in `git log`.
