---
phase: 03-providers-credentials
plan: 03
subsystem: test-harness
tags: [wave-2, test-helpers, loopback, wire-capture, prov-03, prov-10]
requires:
  - "tests/helpers/logs.ts — withTempLogCwd, the async with* skeleton (Phase 2, plan 02-01)"
  - "tests/helpers/stub-bin.ts — the disposable-fixture lifecycle and the loud-TypeError-with-remedy shape (Phase 1)"
  - "tests/unit/helpers.test.ts — the standing self-test file every helper gets a live case in"
provides:
  - "tests/helpers/loopback.ts — withLoopbackCompletions(opts, fn): a 127.0.0.1 node:http capture server exposing baseUrl, port and an ordered requests[] of { method, url, headers, rawBody, body }"
  - "tests/helpers/loopback.ts — assertLoopbackUrl(url): an exported refusal that throws a TypeError for any host other than 127.0.0.1, called from inside the helper on the URL it hands out"
affects:
  - "03-05+ (tests/integration/dashscope-payload.test.ts) — the PROV-03 / PROV-10 payload assertions run through this server"
  - "docs/RUNBOOK.md RB-03-01 / RB-03-02 — this helper is their offline proxy and explicitly does not discharge them"
tech-stack:
  added: []
  patterns:
    - "async disposable holding an OS resource: bind, await the callback in the try, destroy sockets and await server.close() in the finally"
    - "a safety guard enforced inside the helper on the value it is about to hand out, so a caller cannot forget it"
    - "the same literal written out twice on purpose, so one edit cannot move a guard and its subject together"
    - "a request handler that never throws: a JSON parse failure is recorded as `body: undefined` and arrives at the test as data"
key-files:
  created:
    - tests/helpers/loopback.ts
  modified:
    - tests/unit/helpers.test.ts
decisions:
  - "The 127.0.0.1 literal is duplicated between the listen call and the refusal rather than shared through a constant. A shared constant is the shape that defeats the guard: editing it to a real host moves the bind and the assertion together, they still agree, and the refusal passes while the server is no longer on loopback."
  - "detectCompat byte-identity re-verified on the installed artifact rather than taken from PITFALLS: dist/api/openai-completions.js:1161-1221 keys only on a fixed provider-id list and a fixed host-substring list, and `grep -c aliyuncs` on that file is 0. http://127.0.0.1:<port>/v1 matches none of those substrings and neither does a DashScope URL."
  - "The server accepts any path under its base rather than only /chat/completions, so an adapter posting elsewhere surfaces as a captured request with a surprising url instead of as a hang against a 404."
  - "opts.respond overrides the whole response but runs AFTER the capture is pushed, so an error-shape test keeps its assertion. A responder that throws is caught and turned into a 500 — an uncaught throw in the request handler reads at the adapter as a transport failure and hides what the responder did."
  - "node:net is not imported even for types: the socket set is typed structurally as Set<{ destroy: () => void }>, keeping the file to exactly one import."
metrics:
  duration: ~25m
  tasks: 2
  files: 2
  completed: 2026-08-13
---

# Phase 3 Plan 03: The Loopback Wire Capture Summary

A `127.0.0.1` `node:http` server that lets Pi's **real** `openai-completions`
adapter build and send a request body which a test can then read byte for byte —
with no credential, no egress, and a refusal that fires before any URL leaves the
helper.

## What was built

### Task 1 — `tests/helpers/loopback.ts` (commit `ee040c5`)

`withLoopbackCompletions(opts, fn)` binds `listen(0, "127.0.0.1")`, reads the
ephemeral port back from `server.address()`, and hands the callback
`{ baseUrl: "http://127.0.0.1:<port>/v1", port, requests }`.

**Capture.** Every request is buffered and pushed onto `requests` as
`{ method, url, headers, rawBody, body }`, in arrival order, **before** any
response is written. `body` is `JSON.parse(rawBody)` when it parses and
`undefined` when it does not — the handler never throws, because a throw out of
a request handler arrives at the adapter as a transport failure and hides the
actual finding (that Pi sent something which is not JSON).

**Response.** The default reply is `200 text/event-stream` carrying a minimal but
valid OpenAI-completions sequence: one chunk with an assistant text delta, one
with `finish_reason: "stop"`, then `data: [DONE]`. Without the sentinel the
adapter waits for more of a stream that never arrives, and a Wave 2 payload test
hangs rather than fails [threat T-03-03-04]. `opts.respond` replaces the whole
response for a test that needs an error shape, and runs after the capture is
recorded so such a test keeps its assertion.

**Refusal (Trap T11).** `assertLoopbackUrl(url)` is exported — a guard nobody
exercises is a guard nobody knows is dead — and throws a `TypeError` naming
`127.0.0.1`, the threat and the remedy for any other host. It is called from
*inside* `withLoopbackCompletions` on the `baseUrl` it is about to hand out, so a
caller cannot forget it and an edit to the bind host cannot escape it
[threat T-03-03-01].

**Teardown.** Lingering sockets are destroyed and `server.close()` is **awaited**
in the `finally`, so the port is genuinely given back before the next test binds.
`server.close()` alone only stops new connections; one held keep-alive socket
keeps both the port and the process alive [threat T-03-03-03].

**Docstring.** States the `detectCompat` byte-identity argument with a citation
verified on the installed artifact, names `RB-03-01` and `RB-03-02` and says
plainly that proving what Pi *emits* says nothing about what DashScope *accepts*,
and names PROV-03 and PROV-10 as the requirements served.

### Task 2 — five live cases in `tests/unit/helpers.test.ts` (commit `5256618`)

The file went from 28 to 33 tests; the suite from 531 to 536.

1. **Capture works.** A POST of a small JSON body, then `requests.length` asserted
   to be exactly 1 **before** anything about its contents, with a failure message
   saying in terms that every assertion below it is otherwise vacuous. Then the
   parsed `body` deep-equals what was sent, the recorded `content-type` is the one
   the caller set, and `url` is `/v1/chat/completions`.
2. **The response is consumable.** Status 200, `content-type: text/event-stream`,
   a `data: ` line present, and the stream terminating in `data: [DONE]`.
3. **The refusal fires — with its paired positive.** `assertLoopbackUrl` throws a
   `TypeError` whose message contains `127.0.0.1` for
   `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, and does **not**
   throw for the handle's own `baseUrl`. Without the positive, a refusal that
   threw on everything would pass the negative and prove nothing by it.
4. **The port is released after a clean return** — paired with a positive taken
   *inside* the callback (a fetch to the same URL returns 200 while the server is
   up), so "unreachable afterwards" cannot be satisfied by a server that never
   bound.
5. **The port is released after a throw** — the error propagates (`rejects.toThrow("boom")`)
   and the port is refused afterwards.

Every fetch is bounded by `AbortSignal.timeout(5_000)`: a case here asserts a
fetch *fails*, and a hung connect would stall the suite instead of failing it.

## Falsification runs (executed, not assumed)

Per the standing "be suspicious of green" rule, each case was broken and the file
re-run.

| Mutation | Expected | Observed |
|---|---|---|
| `requests.push(record)` replaced with `void record` | case 1 red | **1 failed** — "recorded ZERO requests after one POST completed" |
| `data: [DONE]\n\n` removed from the default SSE body | case 2 red | **1 failed** — "must terminate with the [DONE] sentinel" |
| the refusal's condition forced to `if (false)` | case 3 red | **1 failed** — the refusal case only |
| the refusal's condition forced to `if (true)` (throws on everything) | case 3 red | **5 failed** — the paired positive is live, and the whole helper is unusable, exactly as claimed |
| `await server.close(...)` replaced with `server.unref()` | cases 4 and 5 red | **2 failed** — "the port is STILL accepting connections", "the server survived a throwing callback" |

## Deviations from Plan

None — the plan executed as written. No deviation rule fired, no checkpoint was
reached, and no decision recorded in PROJECT.md, the ROADMAP or the phase
CONTEXT/RESEARCH files was re-derived.

## Requirements status

**No PROV requirement is marked complete by this plan.** It ships the test seam
PROV-03 and PROV-10 are asserted *through*; the requirement code is a later plan
in this phase, and both requirements additionally carry an OUTSTANDING live half
(`RB-03-01`, `RB-03-02`) that no offline green may satisfy (Trap T12). The
frontmatter names them as the requirements served, not as requirements
discharged.

**No network request left this machine.** Every socket opened by this work
terminated at `127.0.0.1`, and the helper now refuses, structurally, to do
otherwise.

## Verification

| Check | Result |
|---|---|
| `npx vitest run tests/unit/helpers.test.ts` | **33 passed** (was 28 after plan 03-01) |
| `npm test` | **536 passed / 36 files** (baseline 531) |
| `npm run typecheck` (`tsc --noEmit`) | exit 0, no output |
| `package.json` `devDependencies` | unchanged — the same six audited pins |
| `grep -c 'node:http' tests/helpers/loopback.ts` | 3 (≥ 1 required) |
| `grep -c '^import' tests/helpers/loopback.ts` | **1** — `node:http` only; no package, and not even `node:net` |
| `grep -ci 'skip' tests/helpers/loopback.ts` | **0** |
| `127.0.0.1` present in both the `listen` call and the refusal check | yes — `:314` and `:173` |
| Docstring names `RB-03-01`, `RB-03-02` and what the helper does not prove | yes |
| `git diff --stat` over both task commits | exactly `tests/helpers/loopback.ts`, `tests/unit/helpers.test.ts` |

## Known Stubs

None. The helper is complete and every branch of it is exercised: the capture,
the default response, the refusal in both directions, and both teardown paths.
`opts.respond` is the one surface without a live case here — it is exercised by
the Wave 2 payload plan that needs an error shape, and its behaviour on the path
that matters (the capture is recorded before it runs) is structural rather than
conditional.

## Self-Check: PASSED

- `tests/helpers/loopback.ts` — FOUND
- `tests/unit/helpers.test.ts` — FOUND
- commit `ee040c5` — FOUND
- commit `5256618` — FOUND
