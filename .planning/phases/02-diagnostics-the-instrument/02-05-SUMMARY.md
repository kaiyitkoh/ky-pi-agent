---
phase: 02-diagnostics-the-instrument
plan: 05
subsystem: diagnostics
tags: [wave-3, wire-capture, provider-hooks, redaction-at-capture, DIAG-01, DIAG-07]
requires:
  - "02-01 — tests/helpers/faux.ts (wrapFauxWithPayload, buildOpenAiFixturePayload, withSecretHeader, SECRET_FIXTURE_TOKEN), session.ts (withFauxSession, writeUserScopeShim), logs.ts (withTempLogCwd, logFilesIn, readTornSafe)"
  - "02-02 — .pi/extensions/diagnostics/redact.ts (redactDeep, redactHeaders)"
  - "02-03 — .pi/extensions/diagnostics/jsonl.ts (appendJsonl, logDir, logPath), schema.ts (WIRE_LOG_BASE, WIRE_ROTATE_BYTES, MAX_ROTATED_FILES, WireKind, WireRecord), index.ts (safeHandler, noteRowWritten)"
provides:
  - ".pi/extensions/diagnostics/wire.ts — registerWireHooks, wireRecord, nextCorrelationId, currentCorrelationId, SafeHandlerFactory"
  - ".pi/extensions/diagnostics/index.ts — the entry point now registers the three main-loop provider hooks"
  - ".pi/extensions/diagnostics/schema.ts — WireRecord's response arm carries status AND optional headers"
  - "tests/unit/wire-nonmutating.test.ts — the handler-return and non-mutation contract"
  - "tests/integration/wire-capture.test.ts — hook order, payload fidelity, on-disk redaction, gitignored paths; the offline proxy for RB-02-01 and RB-02-02"
affects:
  - "02-06 (call-model.ts) — imports wireRecord so the nested path emits byte-compatible records; nested.* kinds are still unwritten"
  - "02-06 (turns.ts) — may read httpStatus from the main.response record and nothing else; that hook never fires on error"
  - "02-09 (prose retry) — registers on the same index.ts default export, wrapped in the same safeHandler"
  - "02-11 (docs/DIAGNOSTICS.md, docs/RUNBOOK.md) — the Bedrock blind spot stated in wire.ts must be restated there; RB-02-01/RB-02-02 name this file as their offline proxy"
tech-stack:
  added: []
  patterns:
    - "block-bodied hook handlers with no value return — an expression body silently replaces every request payload"
    - "dependency injection over a back-import, to keep index.ts <-> wire.ts acyclic"
    - "the vacuous-pass guard placed on the SPECIFIC record that can go missing, not on the record count"
    - "a paired positive beside every absence assertion — case 4 exists so case 3 cannot pass over an empty file"
    - "recover an unexported event type from the exported union rather than re-declaring its shape"
key-files:
  created:
    - .pi/extensions/diagnostics/wire.ts
    - tests/unit/wire-nonmutating.test.ts
    - tests/integration/wire-capture.test.ts
  modified:
    - .pi/extensions/diagnostics/index.ts
    - .pi/extensions/diagnostics/schema.ts
    - tests/unit/diagnostics-entry.test.ts
decisions:
  - "DIAG-07 is marked COMPLETE — this is the plan 02-02 and 02-03 named as the one that should close it, and both halves are now proven: redaction inside the hook, and the on-disk bytes read back"
  - "DIAG-01 stays Pending — nested calls are captured by nothing until 02-06, and RB-02-01 is OUTSTANDING"
  - "AfterProviderResponseEvent is recovered via Extract<ExtensionEvent, …>; Pi 0.84.1 does not re-export it from the package root"
  - "WireRecord's response arm carries status AND optional headers, against 02-03's three-way exclusive split — one event, two fields"
  - "safeHandler and noteRowWritten are injected into registerWireHooks rather than imported, avoiding an index.ts <-> wire.ts cycle"
  - "producedPaths() cannot be read from an integration test — Pi loads the extension through jiti's own module registry; the gitignore check reads the session's log directory instead"
metrics:
  duration: ~40m
  tasks: 3
  files: 6
  completed: 2026-08-13
---

# Phase 2 Plan 05: Capture the Wire Summary

For any main-loop model invocation the exact outgoing JSON is now readable from
a rotated, gitignored `.pi/logs/wire-<date>.jsonl`, redacted **inside** the
capture hook, with the three provider hooks recorded in order under one
correlation id — and the capture handler proven, by falsification, not to alter
the request.

## What was built

### Task 1 — `.pi/extensions/diagnostics/wire.ts` (commit `e0f9526`)

Pi's bundled `examples/extensions/provider-payload.ts` is fifteen lines; this
file is those fifteen lines plus exactly four deltas, each named in the module
docstring: redaction at capture, rotation, a per-handler `try/catch`, and a
correlation id.

| Export | What it does |
|---|---|
| `registerWireHooks(pi, safeHandler, noteRow)` | registers the three provider hooks, each block-bodied |
| `wireRecord(kind, fields)` | composes a record, stamping `ts` and the current `corr` |
| `nextCorrelationId(sessionId)` | `<sessionId>#<n>`, monotonic per process |
| `currentCorrelationId()` | the last issued id, or `undefined` |
| `SafeHandlerFactory` | the injected wrapper's type |

The three handlers:

- **`before_provider_headers`** issues the correlation id for the whole triple —
  it is the first of the three to fire (RESEARCH §2.3) — and appends
  `main.headers` with `redactHeaders(event.headers)`. It mutates nothing.
- **`before_provider_request`** appends `main.request` with
  `redactDeep(event.payload)` and carries the comment that matters most in the
  subsystem, directly above its closing brace: **NO return.** A non-`undefined`
  return replaces the payload for later handlers *and* for the actual request
  [VERIFIED: `runner.ts:1031-1033`], so an expression-bodied arrow here would
  silently rewrite every request the harness ever makes.
- **`after_provider_response`** appends `main.response` with `status` and
  redacted `headers`, and states at its own site that this hook **never fires on
  a provider error** — `onResponse` sits after the retry wrapper
  [VERIFIED: `openai-completions.ts:239`] and a 4xx/5xx throws into the catch at
  `:590`. No field of a turns row may be derived from it; it contributes an
  optional `httpStatus` and nothing else.

**Why the correlation counter lives in this file rather than in a hook.**
`before_provider_headers` fires once per *logical* request: `transformHeaders`
runs inside `ModelRuntime.prepareRequest` [VERIFIED: `model-runtime.ts:590-593`]
while provider retries happen further down, wrapped around the SDK call. Pi's
docs say it outright — *"retries reuse the same headers rather than re-firing
the hook"* [CITED: `docs/extensions.md:676`]. So a per-attempt id is **not
observable** on the main loop, an `attempt` field is deliberately absent rather
than fabricated, and the docstring says so.

**Known limits, stated in the source rather than discovered later.** Bedrock
SigV4 is applied by Smithy middleware downstream of anything Pi hands over, and
`x-amz-*`, `authorization` and `host` are silently ignored on that path
[CITED: pi-ai `types.ts:148-153`] — so the inspector never sees a Bedrock
credential in `before_provider_headers`. The response body is unreachable. The
three hooks are blind to nested calls. Each is a paragraph in the docstring,
because a dump that implies completeness is worse than one that admits a hole.

### Task 2 — registration + the return contract (commit `d29a37e`)

`index.ts` now calls `registerWireHooks(pi, safeHandler, noteRowWritten)`. Both
dependencies are **passed in**: `index.ts` already imports `wire.ts`, so an
import back would make the pair a cycle, and passing the counter explicitly is
what keeps there being exactly one counter incremented by every append path.

`tests/unit/wire-nonmutating.test.ts` (6 tests) drives the real
`registerWireHooks` against a recording stub of `ExtensionAPI` and a
`ExtensionContext` carrying only `cwd` and a `getSessionId()` stub. No session,
milliseconds:

- the registered event set is asserted **equal** to the three provider hooks, so
  a fourth hook added later without a test fails here;
- `before_provider_request` returns `undefined`, with the message naming the
  replacement contract;
- the payload's `JSON.stringify` is identical before and after, with the message
  naming Pitfall 2's warning sign (a model erroring with "invalid request body"
  the moment the diagnostics extension loads);
- **the do-nothing guard** — the rows counter must move, because a handler that
  did nothing at all would satisfy both assertions above perfectly;
- `before_provider_headers` returns `undefined` and changes neither the key set
  nor any value of the map it is handed (that hook mutates *in place*, so a
  capture path that touched it would be rewriting the real request);
- a sabotaged append — a regular file planted where `logDir(cwd)` wants a
  directory — does not propagate, still returns `undefined`, and is asserted to
  have genuinely failed (the counter must be `0`, or the sabotage stopped
  working and the test proves nothing).

`tests/unit/diagnostics-entry.test.ts`'s registration list grew to the four
events, exactly as its own failure message instructed.

### Task 3 — `tests/integration/wire-capture.test.ts` (commit `5346b6a`) — 5 cases

One real `createAgentSession` through `withFauxSession`, the diagnostics
extension loaded at **user** scope via `writeUserScopeShim`, the payload builder
wrapped with `withSecretHeader` so a bearer-shaped credential travels in the
body, and one `session.prompt("hello")`. Five cases over the one dump:

1. **Order.** Records exist; a `main.request` is among them (see below); all
   records share one correlation id; that id is not the `uncorrelated`
   sentinel; the `kind` sequence is exactly `main.headers`, `main.request`,
   `main.response`; `unparseable` is empty.
2. **Fidelity.** A faux response *factory* captures the `Context` the provider
   received; the recorded payload's `model` equals the model called, and its
   message count equals `context.messages.length + (systemPrompt ? 1 : 0)`. This
   is what separates "we logged something" from "we logged the request".
3. **DIAG-07 on disk.** The file is read with `readFileSync(..., "utf8")` and
   asserted *not* to contain `SECRET_FIXTURE_TOKEN` and *to* contain
   `[redacted:`.
4. **The paired positive.** The same text contains the model id, so an empty,
   truncated or wholly-blanked file cannot satisfy case 3 by accident.
5. **Gitignored.** Every log file the session left is `git check-ignore`d, with
   a shape guard (`.pi/….jsonl`) so the loop cannot be classifying something
   else.

The header states plainly that this file is the offline proxy named by
`RB-02-01` and `RB-02-02`, that the fixture payload is realistic and not real,
and that faux headers are `{}` so no live credential has ever passed through the
redactor. **Both live halves stay OUTSTANDING.**

## Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | exit 0 |
| `npx vitest run tests/unit/wire-nonmutating.test.ts` | exit 0, 6 tests |
| `npx vitest run tests/integration/wire-capture.test.ts` | exit 0, 5 tests, 1.2 s |
| `npm run test:unit` | 18 files, 326 tests passed (was 320) |
| `npm test` (full suite) | 23 files, **354 tests passed** (was 343 after 02-04) |
| `grep -c "=> appendJsonl\|=> wireRecord" wire.ts` | 0 — no expression-bodied handler |
| `grep -c registerTool wire.ts` | 0 |
| `redactDeep` / `redactHeaders` present in `wire.ts` | 3 / 3 occurrences |
| docstring contains `types.ts:148-153` | yes |
| `return` with a value inside any of the three handler bodies | none |
| CR bytes in all new/modified files | 0 |
| `git status --porcelain` after the full suite | clean |
| `.pi/logs/` in this repository | does not exist |

### Falsification checks — executed, not assumed

Every sabotage was applied to the real source, the suite run, and the file
restored from a byte-for-byte backup (`md5sum` identical each time, `git diff`
empty).

**1. The expression-bodied handler — the failure this plan exists to prevent.**
`before_provider_request` rewritten as `(event, ctx) => appendJsonl(...)`:

```
× returns undefined
  → the handler returned a value. Any non-undefined return REPLACES the payload …
    expected 'C:\Users\Admin\AppData\Local\Temp\kyp…' to be undefined
× still writes the record it was there to write
  Tests  2 failed | 4 passed (6)
```

The value the harness would have sent to the model is visible in the failure
message: the absolute path of the log file.

**2. A fourth hook registered.** `pi.on("turn_end", …)` added:

```
× registers exactly the three provider hooks and nothing else
× registers session_start plus the wire hooks, and running it writes the row
  Tests  2 failed | 8 passed (10)
```

Both the wire test and the entry-point test caught it, which is the intent —
neither file can be the only one that notices a new hook.

**3. The headers hook mutating in place.** `delete event.headers["user-agent"]`:

```
× returns undefined and neither adds nor deletes a key
  → the handler changed the header key set … deleting an `authorization` here
    logs the operator out of their provider
```

**4. `wrapFauxWithPayload` removed from the session helper — and this one is the
finding.** The plan expected case 1's record-count guard to catch it. **It does
not.** `before_provider_headers` and `after_provider_response` fire under a
plain faux, so the wire log exists with two records and a non-empty count:

```
× case 1 — the three hooks fired, in order, for one correlated request
  → the wire log has records but NO main.request among them, which is Pitfall 1
    exactly … The headers and response hooks fire regardless, which is what
    makes this failure mode look green to a record-count guard
  Tests  4 failed | 1 passed (5)
```

Case 5 stayed green throughout. The Pitfall-1 message was therefore moved onto
an assertion about the *presence of the `main.request` record* rather than the
record count, before the falsification was re-run.

**5. Redaction removed** (`payload: event.payload`):

```
× case 3 — DIAG-07: the plaintext credential is not in the bytes on disk
  → a credential planted in the outgoing payload reached the log file in
    plaintext … a dump that ever holds a live key on disk inside a public
    repository is a breach the moment it is written
  Tests  1 failed | 4 passed (5)
```

**6. Over-redaction** (`payload: "[redacted:everything]"`) — the counterfactual
that makes case 3 meaningful rather than trivially satisfiable:

```
× case 4 — the paired positive: real content survived the redactor
  → the model id faux-flash is absent from the dump … over-redaction is a
    failure too, just a quieter one
× case 2 — the recorded payload IS the outgoing request
  Tests  2 failed | 3 passed (5)
```

Case 3 passed under this sabotage. Without case 4, a redactor that blanked
everything would have shipped as green.

## Deviations from Plan

### Auto-fixed / adjusted

**1. [Rule 3 — blocking] `AfterProviderResponseEvent` is not exported from the package root.**

- **Found during:** Task 1
- **Issue:** `import type { AfterProviderResponseEvent } from "@earendil-works/pi-coding-agent"`
  fails with TS2305. Pi 0.84.1's `dist/index.d.ts:7` type re-export list carries
  `BeforeProviderHeadersEvent` and `BeforeProviderRequestEvent` and omits this
  one, while the interface itself is declared at
  `dist/core/extensions/types.d.ts:518` and the package exposes no deep
  subpath (`exports` has only `.`, `./rpc-entry`, `./client`).
- **Fix:** `type AfterProviderResponseEvent = Extract<ExtensionEvent, { type: "after_provider_response" }>`.
  `ExtensionEvent` *is* exported and the interface is a member of it, so the
  type stays tied to Pi's own declaration. Re-declaring
  `{ status: number; headers: Record<string, string> }` locally would compile
  happily on the day Pi adds a field and silently stop recording it.
- **Files modified:** `.pi/extensions/diagnostics/wire.ts`
- **Commit:** `e0f9526`

**2. [Rule 3 — blocking] `schema.ts`'s `WireRecord` response arm now carries `status` AND optional `headers`.**

- **Found during:** Task 1
- **Issue:** 02-03 modelled `WireRecord` as three mutually exclusive arms —
  exactly one of `payload`, `headers`, `status`. The plan requires the
  `main.response` record to carry `status` *and* redacted headers, which that
  union rejects. `AfterProviderResponseEvent` is one event with two fields
  [VERIFIED: `types.d.ts:691-696`], and splitting it into two records would put
  four entries in a three-hook dump and break the ordering assertion the same
  plan demands.
- **Fix:** The third arm becomes `{ status: number; headers?: …; payload?: never }`.
  `headers` stays optional because Bedrock supplies only `x-amzn-requestid`
  [VERIFIED: `bedrock-converse-stream.ts:255-261`] and Pi's docs warn a provider
  abstracting HTTP may expose none [CITED: `docs/extensions.md:708`]. The
  payload/status exclusion — the one that actually matters — is unchanged.
- **Files modified:** `.pi/extensions/diagnostics/schema.ts`
- **Commit:** `e0f9526`

**3. [Rule 3 — blocking] `registerWireHooks` takes a third parameter, `noteRow`.**

- **Found during:** Task 1
- **Issue:** The plan's signature is `(pi, safeHandler)` and its action text also
  requires every append to "increment the rows-written counter". That counter
  lives in `index.ts`, which imports `wire.ts` — importing `noteRowWritten` back
  out of it makes the pair a cycle. The plan already solved this problem for
  `safeHandler` by injection and simply did not apply the same reasoning to the
  counter.
- **Fix:** A third, **required** parameter. No default: a no-op default would let
  a future caller silently under-count, and 02-03's rule is that a counter only
  some paths increment reports a number that looks like a measurement and is
  not. The unit test passes its own counter and asserts it moves.
- **Commit:** `e0f9526` / `d29a37e`

**4. [Rule 1 — bug in the plan's own acceptance set] `producedPaths()` is unusable from an integration test.**

- **Found during:** Task 3
- **Issue:** Case 5 as written failed: `producedPaths()` returned an empty list
  while cases 1–4 passed over a fully populated log file. Pi loads the extension
  through **jiti**, which keeps its own module registry, so the `jsonl.ts`
  instance that did the writing is not the one the test file imported. No amount
  of `resetProducedPaths()` fixes that — the two sets are different objects in
  different module graphs.
- **Fix:** Case 5 enumerates the session's log directory with `logFilesIn` and
  maps each name to its cwd-relative, forward-slash form. This is the honest
  oracle at that boundary and the stronger one: it reports what a live session
  actually left on disk rather than what a bookkeeping set believes it left. A
  shape guard (`.pi/….jsonl`) was added so the loop cannot be classifying
  unrelated files, and the reason is recorded as a comment in the test. The
  in-process `producedPaths()` route stays covered by
  `tests/unit/logs-gitignored.test.ts`.
- **Commit:** `5346b6a`

**5. [Rule 2 — correctness] The Pitfall-1 guard moved from the record count to the `main.request` record.**

- **Found during:** Task 3 falsification 4
- **Issue:** The plan says to assert `records.length > 0` first "with the message
  naming Pitfall 1: a zero-length capture means the payload hook never fired".
  Removing `wrapFauxWithPayload` proved that guard **cannot** catch the thing it
  names — the headers and response hooks fire under a plain faux, so the file
  exists and the count is positive.
- **Fix:** The count guard keeps a message about the extension not loading at
  all (its real failure mode); the Pitfall-1 message moved onto
  `rows.some(r => r.kind === "main.request")`, and the falsification was re-run
  to confirm it now fails with exactly that message.
- **Commit:** `5346b6a`

**6. [Rule 3 — blocking] `tests/unit/diagnostics-entry.test.ts` updated.**

Its `toEqual(["session_start"])` assertion and single-handler capture both
break once four hooks are registered. The file's own failure message anticipated
this — *"the later plans in this phase are adding hooks and this assertion
should grow with them — not be deleted"* — so it grew, and it now records
handlers in a `Map` keyed by event name.

**7. [judgement call] DIAG-07 is marked COMPLETE; DIAG-01 stays Pending.**

DIAG-07 reads "Captured payloads are redacted at capture time and written only
to gitignored paths" and is tagged **[FAUX]** only. Both halves now exist and
are proven: redaction happens inside the hook, and case 3 reads the bytes off
disk rather than inspecting an object. 02-02 and 02-03 each deferred it
explicitly to "the plan that wires capture and proves the paths" — this is that
plan, so the box is ticked. DIAG-01 is **not** ticked: it says *every* provider
request, and nested calls are captured by nothing until `call-model.ts` lands in
02-06, while its `[RUNBOOK]` half (`RB-02-01`) is OUTSTANDING.

### Additions beyond the letter of the plan

- The "do-nothing guard" in the unit test: returning `undefined` and touching
  nothing passes every other assertion in that file.
- The failing-append test asserts the append genuinely failed (counter at `0`),
  so a future change that makes the sabotage ineffective is loud rather than
  quietly vacuous.
- Case 1 asserts the correlation id is *not* the `uncorrelated` sentinel, and
  that exactly one id appears — a second id would mean a retry re-fired a hook,
  which Pi's docs say cannot happen.
- Case 2 also asserts `main.response.status === 200`, so the one field that hook
  contributes is exercised rather than merely recorded.
- Case 5's `.pi/….jsonl` shape guard.
- `wire.ts` names the three limits of the capture (Bedrock, error responses,
  nested calls) in its docstring, so 02-11's `docs/DIAGNOSTICS.md` has a source
  of truth to copy rather than re-derive.

## Known Stubs

None. Every export is implemented and exercised. The `nested.headers`,
`nested.request` and `nested.response` members of `WireKind` are still unwritten
by any code path — that is 02-06's `call-model.ts`, named in `wire.ts`'s
docstring, and it is the reason DIAG-01 stays Pending rather than a stub in this
plan's deliverables.

## Threat Flags

None beyond the plan's own register.

| Threat | Where it is closed |
|---|---|
| T-02-05-01 information disclosure | `redactDeep` / `redactHeaders` inside every hook, before `appendJsonl`; integration case 3 reads the on-disk bytes; falsification 5 proves the assertion bites |
| T-02-05-02 Bedrock SigV4 invisibility | accepted; stated verbatim in `wire.ts`'s Known limits with the `types.ts:148-153` citation |
| T-02-05-03 a handler rewriting every payload | block bodies, no value return; `wire-nonmutating.test.ts`; falsification 1 |
| T-02-05-04 a dump on a non-gitignored path | paths built only from `ctx.cwd` + `CONFIG_DIR_NAME`; integration case 5 over the files a live session actually left |
| T-02-05-05 a capture failure vanishing | every hook wrapped in `safeHandler`; the forced-throw unit test, with a guard that the throw really happened |
| T-02-05-06 disk exhaustion | `WIRE_ROTATE_BYTES` and `MAX_ROTATED_FILES` passed explicitly on every append |
| T-02-05-SC supply chain | no package installed; `tests/unit/pinning.test.ts` still green |

## Notes for the next plan

- **`call-model.ts` must import `wireRecord`, not re-implement it.** The two
  paths have to produce byte-compatible records or the correlation between
  `wire-*` and `turns-*` breaks on exactly the nested calls DIAG-02 exists for.
- **The nested path issues its own correlation id** via `nextCorrelationId`.
  Do not rely on `currentCorrelationId()` there: the main loop may have issued
  one in between, and `wireRecord`'s stamp would silently attribute the nested
  call to the wrong request. Pass `corr` explicitly in `fields`.
- **`httpStatus` is the ONLY thing a turns row may take from
  `after_provider_response`,** and it must be optional. That hook does not fire
  on error.
- **Any new hook registered on `index.ts` breaks two tests on purpose** —
  `wire-nonmutating.test.ts`'s set equality and `diagnostics-entry.test.ts`'s
  ordered list. Grow both; deleting either is how a hook ships unasserted.
- **Do not reach for `producedPaths()` from an integration test.** The extension
  runs in Pi's jiti module graph. Read the directory.
- **`tests/integration/wire-capture.test.ts` is the offline proxy `RB-02-01` and
  `RB-02-02` must name** when 02-11 appends the Phase 2 runbook section. Both
  live halves are **OUTSTANDING**.

## Self-Check: PASSED

All three created files exist on disk
(`.pi/extensions/diagnostics/wire.ts`, `tests/unit/wire-nonmutating.test.ts`,
`tests/integration/wire-capture.test.ts`), the three modified files are
committed, and all three task commits (`e0f9526`, `d29a37e`, `5346b6a`) are
present in `git log`.
