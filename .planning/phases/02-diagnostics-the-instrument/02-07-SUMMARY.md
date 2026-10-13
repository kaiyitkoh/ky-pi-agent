---
phase: 02-diagnostics-the-instrument
plan: 07
subsystem: diagnostics
tags: [wave-4, chokepoint, nested-calls, build-gate, negative-control, DIAG-02, DIAG-03]
requires:
  - "02-02 — .pi/extensions/diagnostics/redact.ts (redactDeep, redactHeaders, redactString)"
  - "02-03 — .pi/extensions/diagnostics/jsonl.ts (appendJsonl), schema.ts (TURNS_LOG_BASE, WIRE_LOG_BASE, rotation constants, WireRecord/WireKind/TurnRow), index.ts (noteRowWritten)"
  - "02-05 — .pi/extensions/diagnostics/wire.ts (wireRecord, nextCorrelationId)"
  - "02-06 — .pi/extensions/diagnostics/turns.ts (composeTurnRow)"
  - "02-01 — tests/helpers/{faux,session,logs,git}.ts"
provides:
  - ".pi/extensions/diagnostics/call-model.ts — callModel, CallModelOptions: THE cross-phase chokepoint, with payload, response and header capture"
  - "tests/unit/chokepoint-lint.test.ts — a zero-dependency source gate over tracked .ts under .pi/extensions/, exempt by directory, with an empty allowlist"
  - "tests/integration/call-model.test.ts — the paired positive and negative control on one live session"
  - ".pi/extensions/diagnostics/wire.ts — the request counter is now process-wide, so two module instances cannot issue the same correlation id"
affects:
  - "Phase 5 (ROUTE-04, GATE-09) and Phase 8 — import callModel; the signature already carries all three captures and must not need widening"
  - "02-08 (/budget, message_end/turn_end wiring) — session_start does NOT fire in a headless createAgentSession; any in-session proof must prompt first"
  - "02-11 (docs/DIAGNOSTICS.md) — the six-route scope caveat in call-model.ts is the source of truth to copy, not re-derive"
tech-stack:
  added: []
  patterns:
    - "the paired negative control on the SAME fixture: a bare completion proves the hooks are blind, a warm-up prompt proves capture is nonetheless alive"
    - "exempt a build gate by DIRECTORY prefix, not by filename, so sibling modules may describe the banned call in prose"
    - "a regex gate must prove its own regexes fire against an inline offending fixture"
    - "spread order, not the type system, is what stops a caller suppressing its own instrumentation"
    - "process-wide state keyed on globalThis where jiti can produce two instances of one module"
key-files:
  created:
    - .pi/extensions/diagnostics/call-model.ts
    - tests/unit/chokepoint-lint.test.ts
    - tests/integration/call-model.test.ts
  modified:
    - .pi/extensions/diagnostics/wire.ts
decisions:
  - "DIAG-02 and DIAG-03 are marked COMPLETE — both are [FAUX]-only and both halves are proven offline; DIAG-01 stays Pending because its [RUNBOOK] half RB-02-01 is OUTSTANDING"
  - "the correlation counter moved to globalThis: two jiti module instances of wire.ts in one process both stamped <sessionId>#1 into the same log, which silently mis-joins wire records to turns rows"
  - "WithoutCaptures distributes the Omit; the plain Omit collapses a Model<Api> option bag to the intersection of every API's keys and rejects reasoningEffort"
  - "the type-level 'a caller cannot pass onPayload' claim is FALSE for Model<Api> and was replaced by a runtime assertion — spread order is the enforcement"
  - "session_start does not fire in a headless createAgentSession, so the fixture prompts once; the resulting main.* records double as case 1's paired positive"
  - "the catch branch in callModel is defensive: Pi 0.84.1's lazyStream converts setup failures into an error MESSAGE, so it is exercised only by an injected rejection"
metrics:
  duration: ~45m
  tasks: 3
  files: 4
  completed: 2026-08-13
requirements-completed: [DIAG-02, DIAG-03]
---

# Phase 2 Plan 07: The Chokepoint Summary

Nested model calls are no longer invisible: `callModel()` restores all three
captures per call, produces a `kind:"nested"` turns row with a real cost on both
the success and the failure path, and a zero-dependency build gate fails on
every practical route around it. The bare-completion negative control, run on
the same live session, is what makes either claim mean anything.

## What was built

### Task 1 — `.pi/extensions/diagnostics/call-model.ts` (commit `34c8fc6`)

| Export | What it is |
|---|---|
| `callModel(ctx, opts)` | the only sanctioned route to the model API |
| `CallModelOptions<TApi>` | the cross-phase contract Phases 5 and 8 import |

One call produces four records under one correlation id: `nested.headers`,
`nested.request`, `nested.response` in `wire-*.jsonl`, and one `kind:"nested"`
row in `turns-*.jsonl`. `role` is mandatory because it is the join key — a
nested call with no role is a cost with no owner.

Three things are stated in the file rather than left to be rediscovered:

**The verified trap.** Pi wires the three provider hooks into the constructor
options of the ONE `Agent` the session owns [VERIFIED: `sdk.ts:294-360`], so a
nested completion fires none of them — executed during research, where the
logging extension's file *was never created* (RESEARCH §4.4). `transformHeaders`
is reachable here at all because `complete()` takes
`ModelsApiStreamOptions<TApi>` [VERIFIED: pi-ai `models.ts:78-83`]; without it
the nested path would satisfy two of DIAG-01's three hooks and report itself
complete.

**The two callback contracts.** `onPayload` returns `undefined` (a non-undefined
return replaces the outgoing payload) and `transformHeaders` returns its input
unchanged (whatever it returns is what gets signed and sent). Both are
block-bodied, for the same reason `wire.ts`'s handlers are.

**Six bypass routes the gate cannot close**, enumerated: a raw `Provider` from
either accessor, the runtime class as a public export, pi-ai's `./api/*`
subpaths, string-built property access, a composed third-party extension in
Phase 7, and a virtual provider registered with a hand-written `streamSimple`.
That last one is named as the realistic future gap. Same honest-limits posture
SAFE-15 requires of the bash guard.

### Task 2 — `tests/unit/chokepoint-lint.test.ts` (commit `ce697e3`) — 6 cases

Seven regexes over tracked `.ts` under `.pi/extensions/`, in
`contributing-boundary.test.ts`'s shape. No dependency added: ESLint would break
`tests/unit/pinning.test.ts:253`, which asserts exactly six audited devDependency
pins, and that test is re-run as an acceptance criterion.

Exemption is by **directory** (`.pi/extensions/diagnostics/`), which blocker B4
predicted correctly — `wire.ts` already spells `modelRegistry.complete` and the
runtime class name in its docstring, and a file-level exemption would have made
that a build failure for describing the very trap it warns about.

`CHOKEPOINT_BYPASS_ALLOWLIST` is empty, and its docstring prices an entry at
three written answers, the third being *how the call will be measured instead*,
given that it will produce no `turns-*` row.

Three vacuous-pass guards, not one: the scanned set is non-empty; the set
remaining **after** the exemption is non-empty (or moving the whole tree into
`diagnostics/` would neutralise the gate with nobody deleting anything); and
every pattern is run against an inline offending fixture and asserted to fire. A
fifth case asserts the chokepoint itself is tracked, is under the exempt prefix,
and does contain the sanctioned call — so a directory rename turns *that* red
instead of turning the gate quietly green.

### Task 3 — `tests/integration/call-model.test.ts` (commit `c4f75e8`) — 8 cases

One live `createAgentSession` through `withFauxSession`, the real diagnostics
extension loaded at user scope by an inline probe that also hands the live
`ExtensionContext` out through `globalThis` (jiti keeps its own module registry,
so a module export cannot cross that boundary — 02-05's finding).

| Case | What it holds |
|---|---|
| 0 | the probe really handed over a context, or every positive case below is vacuous |
| 1 | **the negative control** — a bare `modelRuntime.complete` produces no `nested.*` wire record and no `kind:"nested"` row, on a session where the warm-up prompt's three `main.*` records prove capture is alive |
| 2 | exactly one advisor row; `cost.total > 0`; `input`/`output`/`totalTokens`/`latencyMs` numeric; `outcome: "ok"`; three wire records under the row's own `corr`; `status: 200` on both the record and the row |
| 2b | the nested payload IS the outgoing request, redacted **in that record** rather than merely somewhere in the file, with the model id surviving as the over-redaction guard |
| 2c | a caller-supplied `onPayload` never runs and never reaches the log |
| 3 | `reasoningEffort: "high"` reached the provider |
| 4 | a `stopReason: "error"` response still produces a row, `outcome: "error"`, credential redacted, non-secret half surviving |
| 5 | a rejected completion still produces a row and the error is rethrown |

Case 2b asserts redaction on the specific `nested.request` record, not on the
whole file, because the warm-up prompt's `main.request` carries the same planted
credential and is redacted by `wire.ts` — a file-wide `[redacted:` check would
pass even if the nested path skipped the redactor entirely.

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npx vitest run tests/unit/chokepoint-lint.test.ts tests/unit/pinning.test.ts` | exit 0, 38 tests |
| `npx vitest run tests/integration/call-model.test.ts` | exit 0, 8 tests, 1.2 s |
| `npm run test:unit` | exit 0, 20 files, 384 tests |
| `npm test` (full suite) | 26 files, **420 tests passed** (was 406 after 02-06) |
| scratch `.pi/extensions/harness/probe.ts` with a direct completion, `git add -N` | gate FAILS, naming `.pi/extensions/harness/probe.ts` and the pattern's `why` |
| the same content inside `.pi/extensions/diagnostics/` | gate PASSES |
| `package.json` devDependencies | still exactly the six audited pins |
| `grep -c registerTool call-model.ts` | 0 |
| `grep -c 'export default' call-model.ts` | 0 — a module, not an entry point |
| `tests/unit/extension-layout.test.ts`, `contributing-boundary.test.ts` | green with the new sibling module |
| CR bytes in all four files (counted in node) | 0 |
| `.pi/logs/` in this repository | does not exist |
| `git status --porcelain` after the full suite | clean |

### Falsification checks — executed, not assumed

Each sabotage was applied to the real source, the suite run, and the file
restored from a byte-identical backup (`md5sum` unchanged after every restore).

**1. `transformHeaders` not supplied** — the capture the ARCHITECTURE.md
correction exists for:

```
× case 2 — the paired positive: one nested row, with a real cost
  → expected ['nested.request','nested.response'] to equal
    ['nested.headers','nested.request','nested.response']
```

**2. `redactDeep` removed from the nested payload capture:**

```
× case 2b — the nested payload was captured, and redacted before it hit disk
```

**3. The catch-side row append removed:**

```
× case 5 — a REJECTED completion still produces a row, and the error is rethrown
```

**4. Spread order inverted** — `opts.api` applied *after* the captures, which is
the shape a caller would need to make itself invisible:

```
× case 2 — the paired positive
× case 2b — the nested payload was captured…
× case 2c — a caller cannot suppress its own capture
  Tests  3 failed | 5 passed (8)
```

**5. `httpStatus` dropped from the success row:**

```
× case 2 — the paired positive: one nested row, with a real cost
```

**6. The negative control's own liveness** — the bare completion replaced with a
`callModel` call, so nested records DO appear where the control says they cannot:

```
× case 1 — the negative control: a bare completion is captured by nothing
```

**7. The correlation counter reverted to a module-level `let`** — deviation 1's
proof:

```
× case 2 — expected [ Array(6) ] to deeply equal [ 'nested.headers', …(2) ]
```

Six records under one id: the extension's instance and the test's instance both
issued `<sessionId>#1`.

**8. A bypass planted outside `diagnostics/`** (Task 2 acceptance) — fails,
naming the path and the reason. **The same content inside `diagnostics/`** —
passes. **A forbidden pattern broken** (`/^getRegisteredNativeProviderXX/`) — the
liveness case fails with "these patterns matched NOTHING". **`CHOKEPOINT_DIR`
misspelled** — cases 3 and 6 both fail, which is the pair working as designed.

## Deviations from Plan

### Auto-fixed / corrected

**1. [Rule 1 — bug] The correlation counter is process-wide, not module-level.**

- **Found during:** Task 3
- **Issue:** `wire.ts`'s `requestCounter` was a module-level `let`. Pi loads each
  extension through jiti, which keeps its own module registry, so one process can
  hold two instances of `wire.ts` — one in Pi's graph, one in whatever else
  imports `call-model.ts`. Both start at 1, both stamp `<sessionId>#1`, both
  append to the same `wire-*.jsonl`. The correlation id then stops identifying a
  request, and a nested call's bytes get joined onto a different call's row. This
  was **observed**, not predicted: falsification 7 shows six records sharing one
  id. The same shape occurs in production the moment two extensions each import
  the chokepoint.
- **Fix:** The counter lives on `globalThis` under a namespaced key, with the
  observation recorded at the constant. `lastCorrelationId` stays per-instance
  deliberately — a process-wide "last id" would let one extension's record
  inherit another's correlation.
- **Files modified:** `.pi/extensions/diagnostics/wire.ts`
- **Commit:** `6839938`

**2. [Rule 3 — blocking] `Omit` must distribute over the options union.**

- **Found during:** Task 3
- **Issue:** RESEARCH §4.6 specifies
  `api?: Omit<ModelsApiStreamOptions<TApi>, "onPayload" | …>`. For the normal
  case `Model<Api>` that resolves to a **union** of every per-API options type
  [pi-ai `types.ts:179`], and `Omit<union, K>` is `Pick<union, Exclude<keyof
  union, K>>` — `keyof` a union being the *intersection* of its members' keys. So
  the plain form silently deletes `reasoningEffort`, `thinkingEnabled`,
  `toolChoice` and everything else per-API. `api: { reasoningEffort: "high" }`
  failed with TS2353.
- **Fix:** A distributive `WithoutCaptures<T> = T extends unknown ? Omit<T, …> :
  never`, with the measurement written at the type.
- **Commit:** `6839938`

**3. [Rule 1 — a false claim in my own docstring] The type does NOT stop a caller passing `onPayload`.**

- **Found during:** Task 3, while checking the claim rather than assuming it
- **Issue:** The first draft of `CallModelOptions` said a caller supplying its own
  `onPayload` "gets a compile error". Compiling it proved otherwise: `Api` is
  `KnownApi | (string & {})` [pi-ai `types.ts:16`], so the union always carries
  the custom-API fallback arm `StreamOptions & Record<string, unknown>`, which
  accepts any key. Neither `reasoningEfort` (a typo) nor `onPayload` is rejected
  for a `Model<Api>`.
- **Fix:** The docstring now states exactly what the `Omit` buys (enforcement for
  a concretely-typed model, documentation otherwise) and names the real
  enforcement: `opts.api` is spread FIRST so the captures always overwrite it.
  That is now asserted at runtime by **case 2c**, and falsification 4 proves the
  assertion bites. A claim that cannot be falsified is decoration; this one was
  falsified and replaced with a test.
- **Commit:** `6839938` (source), `c4f75e8` (test)

**4. [Rule 2 — correctness] The success row is appended OUTSIDE the `try`, and there is no `finally`.**

- **Found during:** Task 1
- **Issue:** The plan says "wrap the whole call in `try`/`catch`/`finally`". A
  `finally` would append on both paths and produce two rows for one call; and an
  append that itself threw inside the `try` would be caught and attempted a
  second time.
- **Fix:** Only the completion sits in the `try`. The catch-side append is
  wrapped in its own swallowing `try`, so a logging failure cannot replace the
  provider error the caller is waiting for — the same trade `index.ts`'s
  `safeHandler` makes at the same kind of boundary.
- **Commit:** `34c8fc6` / `6839938`

**5. [Rule 3 — blocking] `tools` is `Tool[]`, not `ToolDefinition[]`.**

RESEARCH §4.6 names `ToolDefinition[]`. No such type is exported from pi-ai;
`Context.tools` is `Tool[]` [VERIFIED: pi-ai `types.d.ts:364, :370`]. Used the
type the API actually takes.

**6. [Rule 3 — blocking] A double cast, and why it is not a shrug.**

`as ModelsApiStreamOptions<TApi>` fails with TS2352: the conditional type does
not resolve for an unbound `TApi`, so tsc cannot prove any literal is comparable
to it. `as unknown as` is required, and the comment says where the real checking
happens instead of leaving a bare cast.

### Findings recorded for the next plan

**7. `session_start` does not fire in a headless `createAgentSession`.**

Measured with a probe on five events: nothing at all had fired before the first
prompt; after one prompt the order was `before_agent_start`, `turn_start`,
`before_provider_headers`, `agent_end`. Pi emits session-start from
`AgentSession`'s extension-binding step [`agent-session.ts:1761`], which the
headless factory does not reach. The plan's "obtain ctx from a hook" instruction
therefore needs a prompt first — and that warm-up earns its keep, because its
`main.*` records became case 1's paired positive.

### Additions beyond the letter of the plan

- **Case 2c** — the runtime proof that replaced a falsified type-level claim.
- **Case 5** — a rejected completion. Pi 0.84.1 never produces one on its own
  (`lazyStream` converts setup failures into an error *message*), so the branch
  is injected through `Object.create(ctx, { modelRegistry: … })`: the real
  context with exactly one member shadowed, rather than a hand-built shape. An
  untested defensive branch is a comment.
- **Case 0** — an explicit "the probe handed over a context" guard, so a fixture
  failure reads as a fixture failure rather than as seven mysterious ones.
- **A fifth case in the lint** asserting the exemption is real, so a directory
  rename cannot turn the gate green silently.
- **A sixth case in the lint** asserting the offending fixture stays inline and
  keeps at least one line per pattern.
- **`role` on every nested wire record**, so the wire↔turns join survives a
  truncated dump rather than depending on the correlation id alone.

## Known Stubs

None. Every export is implemented and exercised. Nothing in
`.pi/extensions/` calls `callModel` yet — its callers are Phase 5's router and
Phase 8's gates, which is the plan's stated scope boundary, and the reason
`CHOKEPOINT_BYPASS_ALLOWLIST` is empty rather than pre-populated.

## Threat Flags

None beyond the plan's own register.

| Threat | Where it is closed |
|---|---|
| T-02-07-01 a nested call invisible to the instrument | all three per-call captures; case 1's negative control proves the hooks are otherwise blind; case 2c proves a caller cannot opt out |
| T-02-07-02 credentials in the nested payload or headers | `redactDeep` / `redactHeaders` inside the callbacks, before `appendJsonl`; case 2b asserts on the record's own bytes; falsification 2 |
| T-02-07-03 a capture callback altering the request | `onPayload` returns `undefined`, `transformHeaders` returns its input; both block-bodied; case 2b's payload-fidelity assertion |
| T-02-07-04 a bypass the grep cannot see | accepted; six routes enumerated in `call-model.ts` and to be restated in `docs/DIAGNOSTICS.md` (02-11) |
| T-02-07-05 a vacuous gate scanning zero files | two non-empty guards plus the live-regex fixture; falsification 8 |
| T-02-07-06 a nested call ignoring the abort signal | `signal` defaults to `ctx.signal`, declared in `CallModelOptions` |
| T-02-07-SC supply chain | nothing installed; `tests/unit/pinning.test.ts` re-run and still asserting six pins |

## Notes for the next plan

- **Prompt before you expect a context.** `session_start` does not fire headless.
  02-08's `message_end` / `turn_end` wiring is exercised by a prompt anyway, but
  any test that wants `ctx` *before* one will find `undefined`.
- **Do not append a turns row from `callModel`'s caller.** The chokepoint already
  writes one and counts it; a second append would double-count the nested call in
  every per-role cost figure Phase 8 reports.
- **`httpStatus` on a nested row comes only from `callModel`'s own `onResponse`.**
  The `after_provider_response` hook is not wired on this path at all.
- **If `index.ts` starts importing `call-model.ts`**, note that `call-model.ts`
  already imports `noteRowWritten` from `index.ts`. Both are used only at call
  time, so the ESM cycle is safe — but neither may move work to module-evaluation
  time.
- **DIAG-01 is still Pending.** Nested capture now exists, so its `[FAUX]` half is
  complete, but `RB-02-01` is **OUTSTANDING** and 02-11 owns the runbook entry.
- **The chokepoint gate has an empty allowlist and should stay that way.** If
  Phase 5 or 7 needs an entry, the third justification — how the call gets
  measured instead — is the one that actually matters.

## Self-Check: PASSED

All three created files exist on disk
(`.pi/extensions/diagnostics/call-model.ts`, `tests/unit/chokepoint-lint.test.ts`,
`tests/integration/call-model.test.ts`), the modified `wire.ts` is committed, and
all four task commits (`34c8fc6`, `ce697e3`, `6839938`, `c4f75e8`) are present in
`git log`.
