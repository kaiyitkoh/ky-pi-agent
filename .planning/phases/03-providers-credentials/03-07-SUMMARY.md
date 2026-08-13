---
phase: 03-providers-credentials
plan: 07
subsystem: config-policy-gates
tags: [wave-2, PROV-02, command-interpolation, vacuity-guards, trap-T13]
requires:
  - ".pi/templates/models-template.json — the surface-1 scan target (03-02)"
  - ".pi/templates/auth-template.json — the sanctioned position the prohibition redirects to (03-02)"
  - "tests/helpers/git.ts — trackedFiles()/repoRoot(), the only enumeration oracle (Phase 1)"
  - "tests/helpers/models.ts — withModelsConfig(), the offline registry over a temp models.json/auth.json pair (03-01)"
  - "tests/unit/chokepoint-lint.test.ts — the scan shape and its three vacuity guards (Phase 2)"
provides:
  - "tests/unit/command-interpolation.test.ts — the PROV-02 gate over BOTH surfaces plus the cached-vs-uncached behavioural proof"
  - "a machine-checked statement that .pi/templates/auth-template.json is deliberately exempt, so a later 'consistency' sweep cannot ban the one construct PROV-02 permits"
affects:
  - "every future plan that adds a provider to .pi/templates/models-template.json — a leading-bang value fails this gate"
  - "03-0x / Phase 5 (.pi/extensions/providers/**) — a provider registration carrying a !-prefixed apiKey or header fails the same gate"
  - "docs/RUNBOOK.md — nothing; this requirement is [FAUX] end to end and needs no runbook entry"
tech-stack:
  added: []
  patterns:
    - "a config-policy scan that walks PARSED string leaves rather than raw text, so the file may document the rule it is governed by"
    - "a behavioural proof by subprocess COUNT — a counter command whose every invocation appends one line — rather than by quoting the vendor's documentation"
    - "an exemption asserted as a property of the SCAN (`SCANNED_TEMPLATES` equals exactly one path) rather than as an absence in the exempt file"
decisions:
  - "The counter command is `node \"<temp>/counter.mjs\"`, not a stub-bin PATH stub. withStubBin is synchronous by contract and rejects a thenable (stub-bin.ts:205-211) because it deletes the stub directory the moment its callback returns — every resolution here is awaited, so a stub-bin PATH could not survive the call it exists to observe."
  - "Both resolutions of each case run inside ONE withModelsConfig callback, per the 03-01 finding that Pi's !command cache is process-global and clearApiKeyCache is not exported from the package root. Each counter also gets a unique temp path, so the two cases cannot share a cache entry."
  - "The `!`-prefixed-fixture inline-ness guard scans for a distinctive marker string (`kypi-prov02-offending-fixture`) under the two scanned trees rather than for `registerProvider(`. The latter is already present legitimately in .pi/extensions/harness/index.ts:79 and would have made the case fail on correct code."
  - "A proposed closing case asserting `[1,2]` differs from itself was cut before commit: it was tautological, and the Standing Operating Policy names a tautological test a defect rather than a pass. Its reasoning is now a describe-level docstring."
metrics:
  duration: ~35m
  tasks: 2
  files: 1
  completed: 2026-08-13
---

# Phase 3 Plan 07: PROV-02 as a Mechanical Gate Summary

`!command` is now forbidden by machine on both surfaces where Pi would
re-execute it per request, and the difference between the two resolvers is
demonstrated by counting subprocesses rather than by citing `docs/models.md`.

## What was built

One file, `tests/unit/command-interpolation.test.ts`, 11 cases in two halves.

### Task 1 — the mechanical scan over both surfaces (commit `9f2d61b`)

**Surface 1, the models template.** The file is comment-stripped whole-line-only
(the same four lines `bin/bootstrap.sh` and
`tests/integration/templates-install.test.ts:179-185` use — a naive strip of
every `//` would eat the `https://` in `baseUrl`), parsed, and every **string
leaf** at any depth is collected. None may begin with `!`.

Walking the parsed structure rather than regexing the text is load-bearing in
both directions and both are asserted: the template's own header *explains* the
bang rule and therefore contains the literal `` `!command` ``, so a text-level
scan would fail on the documentation; and a value nested inside
`providers.<id>.models[0].compat` must not escape. A dedicated case runs the same
pipeline over two inline fixtures that differ by one substitution — a `//`
comment mentioning `!echo hello` passes, the same file with `"!echo hello"` as a
*value* is caught at `$.providers.example.apiKey`.

**Surface 2, extension sources — Trap T13.** Tracked `.ts` under
`.pi/extensions/` is enumerated through `trackedFiles` (git's index, not the
disk) and scanned for four credential shapes, each with its reason beside it in
one `FORBIDDEN` table:

| pattern | why |
|---|---|
| `apiKey: "!…"` | `configuredApiKey()` is `extension?.apiKey ?? config?.apiKey` — the extension's key takes the same `resolveConfigValueOrThrow` path as the `models.json` one |
| `api_key: "!…"` | the `auth.json` spelling copied into code; same uncached path, reads as if it were the cached one |
| `key: "!…"` | a bare credential literal in an extension — cached **only** where `auth-storage.ts:442-448` resolves it, which an extension-held one never reaches |
| `headers: { …: "!…" }` | header values go through `resolveHeadersOrThrow`, the same uncached resolver applied per header |

Counted quantifiers throughout, no `.`, no `g` flag (the persistent-`lastIndex`
lesson `prose.ts:130-135` records against `redact.ts`).

**The vacuity guards, all three, and a fourth.** Both scanned sets asserted
non-empty *before* the loop; every `FORBIDDEN` entry proven live against an
**inline** offending fixture with the case naming any pattern that matched
nothing; the template's bang check paired with a positive asserting at least one
leaf *is* a `$`-prefixed env reference. The fourth is the inline-ness guard: the
fixture carries a marker string that must appear **nowhere** under either scanned
tree, so "extracting the fixture to a file for tidiness" fails loudly instead of
turning the gate into a report of its own evidence.

**The asymmetry is asserted, not assumed.** A case pins `SCANNED_TEMPLATES` to
exactly `[.pi/templates/models-template.json]` and states why: `auth-template.json`
is the one config file where a `!command` is *correct*, and sweeping both files
"for consistency" would enforce a rule nobody wrote. Note what that case does
**not** do — it asserts nothing about the auth template's contents. That file
would still be compliant if it carried a command tomorrow.

### Task 2 — the cached-vs-uncached behavioural proof (commit `4000f6a`)

A counter command — a generated `counter.mjs` that appends one line to a log
*before* writing its value to stdout — placed once in `auth.json`'s
`credential.key` and once in `models.json`'s `providers.<id>.apiKey`, resolved
**twice** in each case through `registry.getProviderAuth()`:

| where the command lives | resolutions | subprocesses |
|---|---|---|
| `auth.json` `key` (no `models.json` apiKey) | 2 | **1** — and both returned the same value |
| `models.json` `apiKey` (no `auth.json` entry) | 2 | **2** |

Both cases assert the log **non-empty first**, and assert the resolved key equals
the counter's stdout, so "whatever ran was not the counter" cannot pass as a
count. Both resolutions of each case happen inside one `withModelsConfig`
callback, per 03-01's recorded finding that Pi's `!command` cache is
process-global and `clearApiKeyCache` has no supported import path.

**Nothing was narrowed for a platform reason.** Both directions are reachable on
this machine. Pi resolves the command through Git Bash `-c` on Windows
(`resolve-config-value.ts:153-206`, `shell.ts:76-98`), so the `.cmd`-launcher
limitation recorded at `stub-bin.ts:33-47` — a stub invoked by code we do not
control cannot be made to succeed on Windows — simply does not arise for a
`node "<abs path>"` command. Verified by a standalone probe against
`ModelRuntime` + `ModelRegistry` *before* the test was written: 2 lines for the
models.json key, 1 for the auth.json key, on win32 / node 24.16.0.

## Falsified six ways, each turning exactly the intended cases red

| Mutation | Result |
|---|---|
| `"apiKey": "$DASHSCOPE_API_KEY"` → `"!echo sk-injected"` in the models template | 2 failed — the bang-leaf case **and** the `$ENV_VAR` paired positive. Reverted. |
| One `FORBIDDEN` pattern renamed dead (`\bkey` → `\bZZZkey`) | 1 failed — the pattern-liveness case |
| `apiKey: "unused"` → `"!echo unused"` in `.pi/extensions/harness/index.ts` | 1 failed — the surface-2 scan. Reverted. |
| The fixture marker written into a `//` comment of the models template | 1 failed — the inline-ness guard. Reverted. |
| The uncached case given an `auth.json` entry for the same command | 1 failed — `expected 1 to be 2`. **This is the decisive one:** moving the credential from `models.json` to `auth.json`, changing nothing else, flips the count. The test measures the call site, not the file name. |
| The cached case's `key` replaced with a plain literal | 1 failed — the non-empty guard, `expected 0 to be greater than 0`, i.e. the guard that stops a command-that-never-ran from being green |

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Bug] The inline-ness guard would have failed on correct code**

- **Found during:** Task 1.
- **Issue:** The first draft asserted that no tracked file under the scanned
  trees contains `registerProvider(`. `.pi/extensions/harness/index.ts:79`
  legitimately contains exactly that — it is the Phase 1 sentinel provider — so
  the case failed on correct code, and "no extension may register a provider" is
  not the rule PROV-02 states.
- **Fix:** The guard now scans for a distinctive fixture marker
  (`kypi-prov02-offending-fixture`) that must appear nowhere under either scanned
  tree. It proves the property the plan asked for — the fixture is inline — and
  says nothing about legitimate registrations.
- **Files modified:** `tests/unit/command-interpolation.test.ts`
- **Commit:** `9f2d61b`

**2. [Rule 2 - Missing critical] A tautological case was cut before it shipped**

- **Found during:** Task 2, self-review before commit.
- **Issue:** A drafted closing case asserted `[1, 2]` deep-equals
  `[...new Set([1, 2])]` under the heading "the pair is the point". It cannot
  fail. The Standing Operating Policy names a tautological test a defect rather
  than a pass, and shipping one immediately above two real behavioural cases
  would have lent them false company.
- **Fix:** Deleted. Its reasoning — that only 1-versus-2 *in the same process*
  separates a correct cache from a resolver that ran once, and a broken cache
  from an uncached resolver — is now a `describe`-level docstring, alongside the
  executed-probe citation.
- **Files modified:** `tests/unit/command-interpolation.test.ts`
- **Commit:** `4000f6a`

No Rule 3 (blocking) or Rule 4 (architectural) situations arose. No packages were
installed; the counter is a generated `.mjs` run by the `node` already required
to run the suite.

## Autonomous decisions

- The plan says "prefer a `node -e` form invoked through the stub-bin helper".
  The helper could not be used: `withStubBin` is synchronous by contract and
  throws on a thenable (`stub-bin.ts:205-211`), because it removes the stub
  directory as soon as its callback returns — and every resolution here is
  awaited. A generated `counter.mjs` invoked as `node "<abs path>"` keeps the
  intent (one process spawn per invocation, logged before anything else happens)
  without the lifetime conflict, and is also what makes the Windows caveat moot.
  Recorded here rather than asked, per the Standing Operating Policy.
- The two halves were committed separately, as the plan's two tasks, with the
  file passing `vitest` and `tsc --noEmit` at each commit rather than only at the
  end.

## What this does NOT prove

Nothing here contacted a provider and nothing here could. The counter command is
a local `node` process; the probe provider points at `http://127.0.0.1:9/v1`, the
discard port, and no request is ever issued to it. The claim is about **Pi's**
resolvers over **this repository's** files.

The scan is a shape match over committed text, exactly as
`chokepoint-lint.test.ts` is, and inherits the same scope caveat: it covers
tracked `.ts` under `.pi/extensions/` and the one config template. A `!command`
assembled at runtime from string concatenation, or read from a file, is out of
its reach — as is any config the user writes directly into `~/.pi/agent/`, which
this repository does not own.

Surface 2 currently scans ten files, none of which registers a provider with a
resolved credential. The gate is therefore live but so far untested by real
production code; the first file that would exercise it is a future
`.pi/extensions/providers/**`.

## Requirement status

**PROV-02 is complete.** It is `[FAUX]`-only — it names a property of files in
this repository and of Pi's own resolvers, both of which are fully checkable
offline — so, unlike PROV-03/04/07/10, it carries no outstanding live half and
needs no `RB-03-xx` entry. Trap T12 does not apply.

## Known Stubs

None.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/unit/command-interpolation.test.ts` (Half A only, at commit `9f2d61b`) | 9 passed |
| `npx vitest run tests/unit/command-interpolation.test.ts` (both halves) | 11 passed |
| Six falsification runs | each turned exactly the intended cases red; every mutation reverted |
| `npm run test:unit` | 32 files, 516 passed |
| `npm test` | 42 files, 589 passed |
| `npm run typecheck` | clean, at both commits |
| `git status --porcelain` after the suite | clean |

## Self-Check: PASSED

`tests/unit/command-interpolation.test.ts` present on disk; both commits
(`9f2d61b`, `4000f6a`) present in `git log`.
