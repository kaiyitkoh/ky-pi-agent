---
phase: 05-routing-capability-guards
plan: 06
subsystem: routing
tags: [qoder, sse, loopback, offline-proxy, runbook, delegate-tool]

# Dependency graph
requires:
  - phase: 05-routing-capability-guards
    plan: 03
    provides: ".pi/extensions/qoder/client.ts -- delegateTask, resolveQoderConfig, parseSseFrames, foldDelegatedResult, the exact HTTP/SSE shape this plan proves end to end"
provides:
  - "tests/helpers/qoder-loopback.ts -- a 127.0.0.1 HTTP+SSE fixture shaped for the Cloud Agents envelope (withQoderLoopback, assertQoderLoopbackUrl)"
  - "tests/integration/qoder-delegate.test.ts -- ROUTE-11's offline proxy, the file docs/RUNBOOK.md's RB-05-01 entry (plan 05-12) will name"
affects: [05-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A second, purpose-built loopback helper sibling to tests/helpers/loopback.ts -- Qoder's id:/event:/data: envelope is not OpenAI-completions SSE, so the RESEARCH-flagged 'wrong shape' concern was resolved by a small new file, not a reuse of defaultSseBody"
    - "Split-write proof over a REAL socket: a 20ms delay between two res.write() calls forces a genuine two-read arrival, so the split-frame test exercises delegateTask's own incremental buffering rather than a parser unit test's synthetic split"
    - "Absence assertion paired with a control body: the agent.thinking negative uses a distinct fixture string (PONDERING_KYPI_SECRET_XYZ) that must appear in thinkingText before its absence from text means anything"

key-files:
  created:
    - tests/helpers/qoder-loopback.ts
    - tests/integration/qoder-delegate.test.ts

key-decisions:
  - "The real Cloud Agents host string is spelled out zero times in tests/integration/qoder-delegate.test.ts, including in comments -- satisfies the acceptance grep literally (grep -c reports 0) rather than only 'zero outside a comment', since a plain grep -c cannot itself distinguish comment from code"
  - "The session id used across steps 2 and 3 is read back from the URL the CLIENT dialled (the events POST path), not from the request body of step 1 -- the request body is what the client SENT the server, not what the server's response contained, so the original draft asserting on loop.received[0].body.id was a category error and is fixed to read the observable proof (the id appearing where the client used it)"
  - "The missing-PAT case's load-bearing assertion is received.length === 0 for the WHOLE loopback callback scope, not merely 'delegateTask was never called' -- resolveQoderConfig's ok:false result makes calling delegateTask a type error by construction (it requires an already-validated QoderConfig), so the zero-requests assertion is the mechanical proof rather than an assumption"

requirements-completed: []

# Metrics
duration: ~35m
completed: 2026-08-14
---

# Phase 5 Plan 6: Qoder Offline Loopback Proxy Summary

**A 127.0.0.1 HTTP+SSE fixture shaped for Qoder's Cloud Agents envelope, plus the integration test that drives `delegateTask` end to end against it -- proving the exact three-request sequence, the folded-result thinking/message separation (with a paired negative control), a genuine cross-socket split-frame case, the non-2xx and missing-PAT failure paths, and the redacted transcript -- ROUTE-11's offline proxy, named as `RB-05-01`'s evidence in a later plan.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-14
- **Tasks:** 2 completed
- **Files modified:** 2 (2 created)

## Accomplishments

- `tests/helpers/qoder-loopback.ts`: a real `node:http` server on `127.0.0.1` (port 0) routing `POST /sessions`, `POST /sessions/{id}/events` and `GET /sessions/{id}/events/stream`, recording every request's method/url/headers/body before any response is written. Supports a scripted frame body (defaulting to the RESEARCH C.3 sample verbatim, exported as `DEFAULT_QODER_SSE_FRAMES`), a `splitStreamAt` option that forces a genuine two-read arrival via a 20ms inter-write delay, and per-endpoint `statusOverrides` for the non-2xx failure cases. `assertQoderLoopbackUrl` enforces the loopback host with two independent `127.0.0.1` literals, following `tests/helpers/loopback.ts#assertLoopbackUrl`'s exact stated discipline.
- `tests/integration/qoder-delegate.test.ts`: 10 tests driving `delegateTask` (from plan 03's `.pi/extensions/qoder/client.ts`) against the new loopback fixture. Proves: the exact three-request sequence in order with the session id read back from the response and threaded into steps 2 and 3's paths; the `Authorization: Bearer pt-...` header and `Content-Type: application/json` on every applicable request; the `events` POST body carries exactly one `user.message` event with the delegated task text; the folded result equals the concatenated `agent.message` deltas and does NOT contain a distinct `agent.thinking` delta's text (paired positive/negative); an unknown event type injected mid-stream is genuinely present in the parsed frame list yet ignored; a frame split across two real socket writes yields an identical folded result to the unsplit case; a non-2xx on `POST /sessions` surfaces as an error whose message names the status and halts before the next two endpoints are ever dialled; the missing-PAT refusal leaves `received.length === 0` for the entire loopback scope; the transcript written under `cwd/.pi/logs/qoder-*.jsonl` contains neither the fixture token nor an `Authorization`/`Bearer` value.

## Task Commits

Each task was committed atomically:

1. **Task 1: tests/helpers/qoder-loopback.ts** - `0cb6749` (test)
2. **Task 2: tests/integration/qoder-delegate.test.ts** - `6c7e19f` (test)

_Note: Task 2 was framed as `tdd="true"` in the plan, but as with plan 03's own note, its subject (`delegateTask` in `.pi/extensions/qoder/client.ts`) already existed from plan 03 -- there was no RED phase to run against a not-yet-written implementation. The test file was authored against the real implementation and checked for non-vacuity per case (every request-assertion case asserts `received.length > 0` first), then falsified directly (see below) rather than following a literal RED-then-GREEN commit sequence._

## Files Created/Modified

- `tests/helpers/qoder-loopback.ts` - The 127.0.0.1 HTTP+SSE fixture: `withQoderLoopback`, `assertQoderLoopbackUrl`, `DEFAULT_QODER_SSE_FRAMES`
- `tests/integration/qoder-delegate.test.ts` - ROUTE-11's offline proxy: 10 tests across five `describe` blocks (request sequence, folded-result separation, failure surfaces, missing-PAT refusal, transcript redaction, and a coarse "never dials the real host" sanity check)

## Decisions Made

- **Grep discipline for the real host string**: the acceptance criterion "`grep -c "api.qoder.com" tests/integration/qoder-delegate.test.ts` reports 0 outside a comment" is satisfied by never spelling the literal at all, including in comments -- a plain `grep -c` cannot itself distinguish comment from code, so the only way to guarantee the literal check passes is zero occurrences anywhere. Verified: `grep -c "api.qoder.com" tests/integration/qoder-delegate.test.ts` reports `0`.
- **Session id read-back fixed mid-implementation**: the first draft of the "session id threads through steps 2 and 3" case asserted on `loop.received[0].body.id` -- but `received[0].body` is the JSON the CLIENT posted to create a session (agent id, environment id, title), not the id the SERVER minted in its response. That assertion failed immediately (`expected 'undefined' to be 'string'`) and was rewritten to read the session id back from where the client actually used it -- the path of the `events` POST -- which is the correct observable proof that `delegateTask` parsed the create-session response.
- **Falsification run performed and reverted**: mutated `.pi/extensions/qoder/client.ts`'s `foldDelegatedResult` to also accumulate `agent.thinking` deltas into `text` (in addition to `thinkingText`). Three cases in the new integration test turned red as expected (the message-only assertion, the unknown-event-type case, and the split-frame case, all of which assert `folded.text === "Hello world"`), confirming the tests are not tautological. The mutation was reverted via `git checkout -- .pi/extensions/qoder/client.ts` (the file was unmodified from plan 03's commit, so this is a clean revert, not a loss of new work) and the suite re-verified green.

## Deviations from Plan

None beyond the one implementation fix documented above (the session-id read-back source), which is Rule 1 (auto-fix bugs) applied to a bug in this plan's own test draft, not in prior-plan code — caught and fixed before the commit, so no separate deviation commit exists.

## Issues Encountered

- The literal grep for the real Cloud Agents host had to be driven to true zero occurrences (including comments), which required two edit passes after the first draft's docstring mentioned the host by name twice more. Resolved by rephrasing every prose reference to "Qoder's real Cloud Agents host" / "the real host" instead of spelling the domain.

## User Setup Required

None. This plan is entirely offline: the loopback server never leaves `127.0.0.1`, the fixture PAT (`pt-kypi-loopback-fixture-not-a-credential`) is obviously synthetic and is never sent anywhere but the loopback server, and no environment variable on this machine is read or required.

## Next Phase Readiness

- ROUTE-11's offline half is now complete end to end: plan 03 built the client, this plan proves it against a real socket shaped like Qoder's own documented envelope.
- `tests/integration/qoder-delegate.test.ts` exists at the exact path this plan's objective states plan 05-12's `docs/RUNBOOK.md` `RB-05-01` entry must name — **do not rename this file** without updating that runbook entry in the same commit; `tests/unit/docs-policy.test.ts` will assert the named path exists on disk once plan 05-12 adds the `PROXY_PATH_RE`-matched prose line.
- **RB-05-01's live check remains OUTSTANDING** and is untouched by this plan — nothing here talks to `api.qoder.com`, no PAT exists on this machine, and this plan makes no claim about what a real personal access token against a real `agent_id`/`environment_id` actually returns. That determination is deferred to the work laptop, per the Standing Operating Policy.
- Outstanding for a later plan (05-12, per 05-03's own "Next Phase Readiness" note, unchanged by this plan): `docs/RUNBOOK.md`'s `RB-05-01` entry itself, and `tests/unit/docs-policy.test.ts`'s `PHASE_FIVE_IDS`/`ENTRY_COMMANDS["RB-05-01"]` additions. This plan's `files_modified` never touched either.

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*

## Self-Check: PASSED

All created paths found on disk (`tests/helpers/qoder-loopback.ts`, `tests/integration/qoder-delegate.test.ts`, this SUMMARY.md); both task commit hashes (`0cb6749`, `6c7e19f`) found in `git log --oneline --all`.
