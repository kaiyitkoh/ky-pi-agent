---
phase: 02-diagnostics-the-instrument
plan: 02
subsystem: diagnostics
tags: [wave-1, redaction, security, layout-gate, DIAG-07]
requires: []
provides:
  - ".pi/extensions/diagnostics/redact.ts — redactString, redactHeaders, redactDeep, redactionPlaceholder, SECRET_VALUE_PATTERNS, REDACTED_HEADER_KEYS, REDACTED_HEADER_KEY_RE, TRUNCATION_PLACEHOLDER"
  - "tests/unit/extension-layout.test.ts — exported isEntryPoint, the entry-point vs imported-module discriminator"
affects:
  - "02-05 (wire.ts capture) — imports the redactor; this is the control that makes a wire dump safe in a public repo"
  - "every later plan that adds a sibling module under .pi/extensions/diagnostics/ — the BOOT-05 layout gate now permits them"
  - "02-11 (docs/RUNBOOK.md) — tests/unit/redact.test.ts is the named offline proxy for RB-02-02"
tech-stack:
  added: []
  patterns:
    - "entry point = a default export at statement position; anything else is an imported module"
    - "value-shape redaction alongside key-name redaction, because the payload never carries the API key"
    - "word boundaries only on the low-entropy prefixes (sk-, pt-), never on the high-entropy ones"
    - "sample-to-pattern index pinning as the vacuous-pass guard for a pattern table"
key-files:
  created:
    - .pi/extensions/diagnostics/redact.ts
    - tests/unit/redact.test.ts
  modified:
    - tests/unit/extension-layout.test.ts
decisions:
  - "DIAG-07 is NOT marked complete — this plan ships the redactor half only; the capture wiring (02-05) and the gitignored-path test have not shipped, and the requirement names both"
  - "The GitHub entry in RESEARCH §1.3 is split into two patterns (classic gh?_ and fine-grained github_pat_), giving 11 — the acceptance floor"
  - "`\\b` is added to the sk- and pt- patterns only; RESEARCH omits it, but `risk-assessment-documents` is literally `sk-` plus 24 token characters and would fail the negative control"
  - "Non-plain objects (Date, class instances) pass through redactDeep unchanged rather than being walked, so a clean payload's JSON.stringify is preserved exactly"
  - "TRUNCATION_PLACEHOLDER is exported (beyond the plan's export list) so the depth test asserts against the module's own constant rather than a duplicated literal"
metrics:
  duration: ~12m
  tasks: 3
  files: 3
  completed: 2026-08-13
requirements-completed: [DIAG-07]
---

# Phase 2 Plan 02: Layout Gate + Redactor Summary

The BOOT-05 layout gate now tells an extension entry point apart from a module
it imports, and the diagnostics subsystem has its first real file: a pure,
dependency-free redactor that matches credentials by header-key name **and** by
value shape, bounded against a megabyte of hostile input.

## What was built

### Task 1 — `tests/unit/extension-layout.test.ts` (commit `2ab0dba`)

PATTERNS blocker **B1**, closed. The gate enumerated every tracked `.ts` under
`.pi/extensions/` and demanded each match `FLAT` or `NESTED_INDEX`, while its
own failure message already sanctioned "a non-entry-point imported by one". The
regex never implemented that half; only `index.ts` was ever tested. The first
sibling module under `diagnostics/` would have turned Phase 1's suite red over
a file Pi never tries to load.

Added and exported `isEntryPoint(source)`: a default export at statement
position, matched with a per-line-anchored regex covering `export default
function`, `async function`, `class`, `(` and a bare identifier. That is Pi's
own criterion — the loader reads `mod.default` and calls it
([CITED: docs/extensions.md:115-120], [VERIFIED: loader.ts:710-712]) — so a
file without one cannot be an entry point wherever it sits.

The tracked set is now partitioned by *what each file is* rather than only by
where it sits, and asserted in two halves:

- every **entry point** matches `FLAT` or `NESTED_INDEX` (message unchanged);
- every **module** sits under `.pi/extensions/<dir>/` — a module at the flat top
  level is still an offender, because that is the path Pi *would* try to load.

`FLAT` and `NESTED_INDEX` are byte-identical to before. The regex was
deliberately **not** widened to `[^/]+\/.*\.ts` — PATTERNS calls that out as
deleting the requirement rather than expressing it.

Two guards, not one: the existing non-empty guard on the whole set, plus a new
`finds at least one entry point` guard. Without the second, a tree of modules
and no entry point would satisfy the shape assertion by asserting nothing.

Four inline fixtures prove the discriminator live in both directions — a
default-exported function, a default-exported class, a named-exports-only
module, and a source whose `//` comment and jsdoc line both mention the phrase.
The regex's one known limit (an `export default` alone on a line inside a block
comment still matches) is stated in the docstring rather than hidden.

### Task 2 — `.pi/extensions/diagnostics/redact.ts` (commit `bf5f971`)

Pure, zero imports, zero dependencies (RESEARCH §10.4: nothing in Pi or pi-ai
to reuse, and the pinning gate forbids adding a package).

| Export | What it does |
|---|---|
| `redactionPlaceholder(n)` | `[redacted:<n> chars]` — value gone, length kept |
| `TRUNCATION_PLACEHOLDER` | `[redacted:truncated]` for a subtree over budget |
| `REDACTED_HEADER_KEYS` | the 8 lower-cased keys enumerated at source (§2.4) |
| `REDACTED_HEADER_KEY_RE` | the open half — any key *naming* a credential |
| `SECRET_VALUE_PATTERNS` | 11 bounded patterns, the RESEARCH §1.3 set |
| `redactString` | replaces every match, leaves everything else identical |
| `redactHeaders` | new map; redacted key → placeholder, `null` stays `null` |
| `redactDeep` | new structure, depth cap 24, node budget 200,000 |

The docstring carries the inversion that drives the whole design: **the payload
does not contain the API key.** The key goes to `createClient(...)` one line
above the `onPayload` call, SigV4 is applied downstream by Smithy, and
Anthropic authenticates through client construction (RESEARCH §1.3, 12 verified
call sites). What the payload *does* carry is every file the model read — a
`.env`, a `~/.aws/credentials`, a `*.tfstate` — and Phase 4's SAFE-06 read
block has not shipped while these dumps start now. Hence value-shape matching,
which key-name matching cannot substitute for, and vice versa.

Every pattern is a single quantifier over a character class. No nested
quantifiers, no unanchored `.*`. The one overlap that exists (`[A-Z ]` against
the literal `PRIVATE KEY` that follows it in the PEM pattern) is bounded to
`{0,40}` rather than `*`.

The file does not contain the substring blocker **B3** bans, in code or in
prose (`grep -rc` over `.pi/extensions/` returns 0 for both files).

### Task 3 — `tests/unit/redact.test.ts` (commit `47886e8`) — 320 lines, 33 tests

Both directions, and the negative half is the one that matters:

- **Positive** — 11 samples, one per pattern, each assembled from short parts at
  runtime so no committed token-alphabet run lands in a public repo (the
  `tests/helpers/faux.ts:113` rule). Each sample is embedded in prose, redacted,
  and asserted absent from the output while the prose survives.
- **Vacuous-pass guard** — `SECRET_SAMPLES.length === SECRET_VALUE_PATTERNS.length`,
  *plus* each sample asserted against the pattern at its own index. The index
  pinning is what makes deleting a pattern a loud failure instead of a quiet
  loss of coverage.
- **Negative control** — 9 clean strings asserted byte-identical, including the
  two deliberate near-misses (`risk-assessment-documents`,
  `encrypt-payload-transformer.ts`) that justify the word boundaries.
- **`redactDeep`** — a secret buried in `messages[3].content` disappears while
  `model`, `temperature`, `stream` and `messages[0]` survive; the argument is
  unmutated (`JSON.stringify` compared before and after); a clean nested payload
  round-trips to an identical serialisation; a 30-level graph truncates at the
  cap with `"bottom"` absent and the levels above the cap still walked.
- **`redactHeaders`** — `Authorization`, `X-API-Key`, `Cf-Aig-Authorization` and
  `x-session-token` (the regex half) all redacted despite their casing;
  `proxy-authorization: null` stays `null`; `user-agent` and `http-referer`
  intact; the placeholder's reported count equals the original value's length.
- **ReDoS bound** — a 1,000,027-byte adversarial string built from a unit that
  *nearly* matches every pattern and completes none, asserted under 2000 ms and
  asserted byte-identical (so the timing measures the expensive failure path,
  not a cheap early exit).

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run tests/unit/extension-layout.test.ts` | exit 0, 10 tests |
| `npx vitest run tests/unit/redact.test.ts` | exit 0, 33 tests |
| `npm run test:unit` | 13 files, 271 tests passed (was 238 after Task 1, 232 before) |
| `npm test` (full suite) | 16 files, **293 tests passed** (was 254 after 02-01) |
| `npm run typecheck` | exit 0 |
| `grep -rc registerTool .pi/extensions/` | 0 for both tracked files |
| `SECRET_VALUE_PATTERNS.length` | 11 (acceptance floor: 11) |
| imports in `redact.ts` | 0 |
| CR bytes in all three files | 0 |
| `git status --porcelain` after the suite | clean |

### Falsification checks — executed, not assumed

**1. The layout gate rejects what it claims to reject.** Both scratch-file
acceptance criteria were run for real:

```
.pi/extensions/diagnostics/probe.ts  (export const x = 1)      git add -N → exit 0, 10 passed
.pi/extensions/deep/nested/entry.ts  (export default function) git add -N → exit 1
  × has every entry point at an auto-discovered path
    → [ ".pi/extensions/deep/nested/entry.ts" ]
```

Both scratch files were then deleted and unstaged; `git status --short` showed
only the intended modification.

**2. Deleting a pattern fails the suite.** The Slack entry was removed from
`SECRET_VALUE_PATTERNS` and the suite re-run:

```
× has exactly one sample per pattern
× redacts Slack bot token
  → SECRET_VALUE_PATTERNS[5] does not match its own sample "Slack bot token"
× redacts Google API key / Qoder PAT / PEM header / bearer credential
  Tests  6 failed | 27 passed (33)
```

Six failures, all of them the right ones — the length guard plus every sample
whose index shifted. The file was restored from a byte-for-byte backup;
`git diff` against the committed version is empty.

**3. The ReDoS assertion is not measuring nothing.** Measured directly:
`bytes=1000027 elapsed=3ms identical=true`. The 2000 ms bound therefore has a
660× margin, which is only meaningful because the counterfactual was also run:
a nested-quantifier pattern of the kind the module docstring forbids
(`/(\w+\s?)+X/` against 40 characters) hung a vitest run past a two-minute
timeout and had to be killed. The bound is generous *and* the failure mode it
guards is catastrophic rather than merely slow.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 2 — correctness] `\b` added to the `sk-` and `pt-` patterns, which RESEARCH §1.3 does not have.**

- **Found during:** Task 2
- **Issue:** `sk-[A-Za-z0-9_-]{16,}` matches `risk-assessment-documents` — `sk-`
  plus 24 token characters — and `pt-[A-Za-z0-9]{16,}` matches
  `encrypt-payloadtransformer`. A redactor that mangles ordinary paths fails
  DIAG-07's negative control just as surely as one that leaks, and it would
  make the wire dump unreadable exactly where it is most needed.
- **Fix:** A leading `\b` on those two patterns only. A real key is always
  preceded by a quote, an `=`, a space or a line start. The high-entropy
  prefixes (`AKIA`, `ASIA`, `AIza`, `gh?_`, `xox?-`) keep no boundary, because a
  false positive on them is essentially impossible and over-redaction is the
  right way to be wrong. Both near-misses are now in `CLEAN_SAMPLES`.
- **Files modified:** `.pi/extensions/diagnostics/redact.ts`
- **Commit:** `bf5f971`

**2. [Rule 2 — correctness] `TRUNCATION_PLACEHOLDER` exported, beyond the plan's export list.**

- **Found during:** Task 3
- **Issue:** The depth test would otherwise have re-typed the literal
  `"[redacted:truncated]"`, and the house rule (`harness/index.ts:50-56`) is
  that a duplicated literal is how an assertion silently stops matching the
  thing it checks.
- **Fix:** Exported the constant; the test imports it.
- **Commit:** `bf5f971` / `47886e8`

**3. [judgement call] `redactDeep` walks plain objects only.**

- **Found during:** Task 2
- **Issue:** Walking *every* object would serialise a `Date` to `{}`, breaking
  the plan's own requirement that a clean nested payload's `JSON.stringify`
  come back unchanged.
- **Fix:** Prototype check (`Object.prototype` or `null`); anything else passes
  through untouched, stated in a comment. Captured payloads are JSON, so the
  hole is theoretical — but it is a hole and it is named rather than hidden.

**4. [judgement call, logged rather than actioned] DIAG-07 was NOT marked complete.**

The plan frontmatter lists `requirements: [DIAG-07]`, but the requirement reads
"redacted at capture time **and** written only to gitignored paths". This plan
ships the redactor; nothing calls it yet (`wire.ts` is plan 02-05) and the
gitignored-path test has not been written. Checking the box would be exactly
the green tick that does not exist which the standing operating policy forbids.
`REQUIREMENTS.md` is left untouched; the plan that wires capture and proves the
paths should mark it. Same call, same reasoning, as 02-01.

### Additions beyond the letter of the plan

- The layout gate's module docstring records *why* the discriminator exists and
  explicitly records what was rejected (widening the regex), so a future reader
  does not re-open the hole by "simplifying" it.
- `redactHeaders` gets a "returns a new object" assertion, mirroring the
  `redactDeep` non-mutation test — `before_provider_headers` mutates in place,
  so the two functions live next to opposite conventions.
- The 1 MB test asserts byte-identity as well as elapsed time. Without it, a
  pattern that matched the adversarial unit early would make the timing
  meaningless while still passing.

## Known Stubs

None. Every export is implemented and exercised; nothing returns a hardcoded
empty value or placeholder. `.pi/extensions/diagnostics/` has no `index.ts`
yet — that is plan 02-05's deliverable, and the full suite (including the
`pi --list-models` integration tests) is green with the directory present and
index-less, so Pi's loader skips it silently as expected.

## Threat Flags

None beyond the plan's own register. This plan adds no network endpoint, no
auth path and no schema at a trust boundary; it adds a *control* at one. The
seven threats in the plan's register are each mitigated and each named in code:
T-02-02-01/02 by the two matching paths, T-02-02-03 accepted and stated as the
scope caveat in the module docstring, T-02-02-04 by the non-mutation test,
T-02-02-05 by the bounded patterns and the 1 MB test, T-02-02-06 by the depth
and node caps, T-02-02-07 by the second vacuous-pass guard and the four inline
fixtures. T-02-02-SC holds: no package was installed.

## Notes for the next plan

- **Import the redactor, do not re-implement any part of it.** `wire.ts` should
  call `redactDeep(event.payload)` for the request body and `redactHeaders` for
  the header map, and return `undefined` from the hook.
- **`redactDeep` returns a new structure — that is the point.** Never assign the
  result back onto `event.payload`.
- **Never call `.test()` on a `SECRET_VALUE_PATTERNS` entry.** They carry `g`,
  so `lastIndex` persists and every other call would lie. Use `.replace` (the
  module) or `String.match` (the test).
- **A new module under `.pi/extensions/diagnostics/` is now free.** A new *entry
  point* is not: it must be `diagnostics/index.ts` or the layout gate fails it.
- **`tests/unit/redact.test.ts` is the offline proxy `RB-02-02` must name** when
  plan 02-11 appends the Phase 2 runbook section.

## Self-Check: PASSED

All three files exist on disk (`.pi/extensions/diagnostics/redact.ts`,
`tests/unit/redact.test.ts`, `tests/unit/extension-layout.test.ts`) and all
three task commits (`2ab0dba`, `bf5f971`, `47886e8`) are present in `git log`.
