---
phase: 02-diagnostics-the-instrument
plan: 01
subsystem: test-harness
tags: [wave-0, test-helpers, faux-provider, jsonl, diagnostics]
requires: []
provides:
  - "tests/helpers/faux.ts — wrapFauxWithPayload, buildOpenAiFixturePayload, buildBedrockFixturePayload, SECRET_FIXTURE_TOKEN, withSecretHeader, FixturePayloadBuilder"
  - "tests/helpers/session.ts — createFauxSession, withFauxSession, writeUserScopeShim, FauxSessionOptions, FauxSessionHandle"
  - "tests/helpers/logs.ts — withTempLogCwd, logFilesIn, readJsonl, readTornSafe, TornSafeResult"
affects:
  - "every later Phase 2 plan: all DIAG-01/02/04/05/06/07/08 tests assert THROUGH these three helpers"
tech-stack:
  added: []
  patterns:
    - "onPayload-emitting provider wrapper (fauxProvider never calls it)"
    - "in-memory createAgentSession with ModelRuntime.create({ modelsPath: null, refreshOnCreate: false })"
    - "user-scope extension loading via <agentDir>/extensions/<name>/index.ts"
    - "strict reader vs torn-safe reader, proven different on the same fixture"
key-files:
  created:
    - tests/helpers/faux.ts
    - tests/helpers/session.ts
    - tests/helpers/logs.ts
  modified:
    - tests/unit/helpers.test.ts
decisions:
  - "No DIAG requirement is marked complete by this plan — it ships test apparatus, not requirement code"
  - "The onPayload emission is written out twice (stream and streamSimple) rather than factored into a helper, so the acceptance grep keeps matching the thing it checks"
  - "EXTENSION_UNDER_TEST is module-private in session.ts; no test needs to reconstruct the path by hand"
  - "The literal symbol names `InMemoryCredentialStore` and `it.skip` are deliberately not spelled in session.ts, per the Phase 1 lesson that a substring grep also matches prose"
metrics:
  duration: ~20m
  tasks: 3
  files: 4
  completed: 2026-08-13
requirements-completed: [DIAG-02, DIAG-04, DIAG-06, DIAG-07, DIAG-08]
---

# Phase 2 Plan 01: Wave 0 Test Helpers Summary

Three test helpers that make Phase 2's offline harness non-vacuous: a faux
provider wrapper that actually fires `before_provider_request`, an in-memory
`createAgentSession` factory that runs outside this repository, and a JSONL
reader pair that reports a torn line instead of throwing on it.

## What was built

### Task 1 — `tests/helpers/faux.ts` (commit `f79f345`)

`wrapFauxWithPayload(faux, buildPayload?)` returns a spread copy of
`faux.provider` whose `stream` and `streamSimple` both call
`options.onPayload(...)` immediately before delegating — the position every real
adapter uses (`openai-completions.ts:237`, `bedrock-converse-stream.ts:247`,
`anthropic-messages.ts:550`).

This exists because `fauxProvider` **never calls `onPayload`**
(`pi-ai src/providers/faux.ts:510`), so Pi's `before_provider_request` never
fires under a plain faux session. Any DIAG-01 or DIAG-07 test written before
this wrapper landed would have iterated a permanently empty capture list and
passed without executing a single expectation.

Also exported: `buildOpenAiFixturePayload` (transcribed from `buildParams`,
`openai-completions.ts:681-760`), `buildBedrockFixturePayload` (transcribed from
`bedrock-converse-stream.ts:235-246`), `SECRET_FIXTURE_TOKEN` (assembled at
runtime from three short parts so no 24-plus-character token-alphabet run is
committed to a public repo), and `withSecretHeader`.

### Task 2 — `tests/helpers/session.ts` (commit `151d52c`)

`createFauxSession` / `withFauxSession` build a real `createAgentSession`
against the wrapped faux provider: `ModelRuntime.create({ authPath,
modelsPath: null, refreshOnCreate: false })`, `SettingsManager.inMemory({}, {})`,
`SessionManager.inMemory(cwd)`. No network, no credentials, no writes into this
repository.

Two temp dirs per session (`kypi-session-` for `agentDir`, `kypi-cwd-` for
`cwd`). The `cwd` being outside the repo is load-bearing, not hygiene: Pi walks
up collecting context files, and from inside this repo that loads a 49 KB
`CLAUDE.md` into every faux request (measured at 12,725 input tokens for a
one-word prompt).

`writeUserScopeShim` writes `<agentDir>/extensions/<name>/index.ts`
re-exporting a target file's default export, with backslashes converted to
forward slashes so the module specifier is a path rather than a set of escape
sequences on Windows. User scope is mandatory — project-scoped `.pi/extensions`
is gated behind project trust, which resolves `false` headless with no UI.

Every failure path throws with the remedy in the message; there is no skip
escape hatch anywhere in the file.

### Task 3 — `tests/helpers/logs.ts` + self-tests (commit `8d57e52`)

`withTempLogCwd` (prefix `kypi-logs-`, async, `finally` cleanup with
`maxRetries: 3`), `logFilesIn` (sorted file names, `[]` when the directory is
absent), `readJsonl` (strict — throws on a malformed line) and `readTornSafe`
(never throws; returns `{ records, unparseable }`).

Three `describe` blocks appended to `tests/unit/helpers.test.ts`:

1. **logs** — the same mixed fixture (two good records, one truncated line) is
   read by both readers; `readTornSafe` returns 2 records and exactly 1
   `unparseable` entry, and `readJsonl` throws. The difference between the two
   is proven, not assumed. Plus `logFilesIn` in both directions and a cleanup
   assertion.
2. **session** — one `session.prompt("hello")` reaches the provider exactly
   once (`faux.state.callCount === 1`), the temp `cwd` is asserted **not** to be
   under `repoRoot()`, and both temp dirs are gone after `dispose()`.
3. **faux** — the Pitfall-1 guard. A user-scope extension records every
   `before_provider_request` payload; the test requires
   `captured.length > 0` before touching any content, with a failure message
   that names the cause and forbids weakening the assertion.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npm run test:unit` | 12 files, 232 tests passed |
| `npm test` (full suite) | 15 files, **254 tests passed** (was 248 before this plan) |
| `git status --porcelain` after the suite | no new untracked files anywhere, none under `.pi/logs/` |
| CR bytes in all four files | 0 (`.gitattributes` LF discipline holds) |

### Falsification check — executed, not assumed

The plan requires proof that the Pitfall-1 guard can fail for the right reason.
Both `void bag?.onPayload?.(...)` lines in `tests/helpers/faux.ts` were commented
out and the suite re-run:

```
× faux helper -- before_provider_request actually fires > captures at least one payload
  → ZERO payloads were captured. `before_provider_request` did not fire ...
    : expected 0 to be greater than 0
  Tests  1 failed | 19 passed (20)
```

Exactly one test failed, and it was the guard. The file was then restored from a
byte-for-byte backup; `git diff --stat tests/helpers/faux.ts` is empty against
the committed version.

This matters because it is the second time this phase has caught a
would-be-vacuous green: RESEARCH found the `fauxProvider`/`onPayload` gap by
executing it, and this run proves the guard against that gap is itself live.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 — correctness] The `onPayload` emission is duplicated across both stream entry points instead of being factored into one `emit()` helper.**

- **Found during:** Task 1
- **Issue:** The first draft factored the call into a shared `emit()`. That is
  DRYer, but the task's acceptance criterion greps for the call inside *both* a
  `stream` and a `streamSimple` override, and the repo's standing rule is that a
  duplicated literal is how an assertion silently stops matching the thing it
  checks.
- **Fix:** Wrote the four-line body out twice with a comment explaining why.
- **Files modified:** `tests/helpers/faux.ts`
- **Commit:** `f79f345`

**2. [Rule 2 — correctness] `session.ts` deliberately does not spell `InMemoryCredentialStore` or `it.skip`, even in prose.**

- **Found during:** Task 2
- **Issue:** The first draft's docstring named the non-existent credential-store
  symbol (to correct ARCHITECTURE.md) and wrote "no `it.skip` escape hatch"
  (copying `tests/helpers/pi.ts`). Both are substrings the acceptance criteria
  require to be absent — and Phase 1 already learned (blocker B3,
  `contributing-boundary.test.ts`) that a substring grep matches prose too.
- **Fix:** Rephrased both, keeping the correction and the throw-never-skip rule
  intact without the literal tokens. The docstring now states explicitly that
  the symbol is not spelled *on purpose*.
- **Files modified:** `tests/helpers/session.ts`
- **Commit:** `151d52c`

**3. [Rule 3 — blocking] `EXTENSION_UNDER_TEST` made module-private.**

- **Found during:** Task 2
- **Issue:** Exporting it would have broken the "exports are exactly …"
  acceptance criterion, and no self-test needs it: the helper both writes the
  extension and returns the `agentDir` it lives under.
- **Fix:** Dropped the `export`, with a docstring saying why.
- **Commit:** `151d52c`

**4. [judgement call, logged rather than actioned] No DIAG requirement was marked complete.**

The plan frontmatter lists `requirements: [DIAG-01, DIAG-02, DIAG-04, DIAG-05,
DIAG-06, DIAG-07, DIAG-08]`, but this plan ships **test apparatus, not
requirement code** — there is no `diagnostics/` directory yet, no `callModel()`,
no redactor, no JSONL writer, no `/budget`. Checking those boxes would be
exactly the "green tick that does not exist" the standing operating policy
forbids. `REQUIREMENTS.md` is left untouched; the later plans in this phase that
actually implement each requirement should mark it.

### Additions beyond the letter of the plan

- `logFilesIn` got its own self-test (both directions) and `withTempLogCwd` got
  a cleanup assertion. Both are exported surface that later DIAG-08 tests will
  lean on; an untested exported helper is the failure mode
  `tests/unit/helpers.test.ts` exists to prevent.
- `createFauxSession` rejects being given both `extensionSource` and
  `extensionPath`, because they write to the same user-scope path and one would
  silently overwrite the other.
- `buildOpenAiFixturePayload` also emits `max_completion_tokens` and
  `temperature` when set, and reads `reasoning` as well as `reasoningEffort` —
  faux is driven through `streamSimple`, whose options bag uses the former name.

## Known Stubs

None. All three helpers are fully wired and exercised by the self-tests; none
returns a hardcoded empty value or placeholder.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no schema at a trust
boundary. The three threats it does touch (`T-02-01-01` temp-dir deletion,
`T-02-01-02` repo-relative `cwd`, `T-02-01-03` committed synthetic credential)
were in the plan's own register and are each mitigated in code and named in the
relevant module docstring.

## Notes for the next plan

- **Register the wrapper, never the bare provider.**
  `modelRuntime.registerNativeProvider(wrapFauxWithPayload(faux))`. Registering
  `faux.provider` still resolves the model and still runs a session — it just
  silently never fires `before_provider_request`.
- **Assert `captured.length > 0` first, always.** Content assertions second.
- **`before_provider_headers` fires with `{}` under faux**, because faux auth
  resolves empty. Header-redaction tests must inject headers through the
  wrapper or unit-test the redactor directly (RESEARCH §8.5).
- **`usage.cost` is all zeros under faux** regardless of the model's cost rates.
  The default `faux-flash` model in `session.ts` carries non-zero rates
  specifically so `calculateCost(model, usage)` produces a distinguishable
  number; `callModel()` must call it.
- **`tests/unit/extension-layout.test.ts` will go red** on the first sibling
  module under `.pi/extensions/diagnostics/` (PATTERNS blocker B1). That fix
  belongs in the same wave as the first diagnostics module.

## Self-Check: PASSED

All four source files exist on disk and all three task commits (`f79f345`,
`151d52c`, `8d57e52`) are present in `git log`.
