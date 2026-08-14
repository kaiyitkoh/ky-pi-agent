---
phase: 05-routing-capability-guards
plan: 03
subsystem: routing
tags: [qoder, sse, fetch, typebox, delegate-tool, foreign-agent]

# Dependency graph
requires:
  - phase: 02-diagnostics-instrumentation
    provides: "diagnostics/redact.ts (redactDeep) and .pi/lib/jsonl.ts (appendJsonl) -- the one redaction rule and hardened writer this plan reuses rather than duplicates"
  - phase: 04-safety-guardrails
    provides: "safety/index.ts#registerApprovalTool -- the only prior precedent for a registered, non-wrapper tool with a typebox schema and an actionable-refusal-via-throw pattern"
provides:
  - "qoder_delegate: a registered tool that delegates a task to Qoder's Cloud Agents API and folds the streamed result back to text"
  - "A pure, offline-testable config resolver, SSE parser and result-folder for the Qoder envelope (client.ts)"
  - "The BOOT-10 allowlist entry and (a)/(b)/(c) justification for this second registered tool in the repository"
affects: [05-04, 05-05, docs-runbook, docs-routing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Foreign-agent delegate tool as a separate .pi/extensions/qoder/ directory, physically apart from routing/ -- reinforces that Qoder is never a routing target (decision 11)"
    - "Incremental SSE parser: parseSseFrames(chunk) -> {frames, rest}, caller threads rest back in on the next chunk -- proven against both a newline-boundary split and a mid-line split of the same fixture"
    - "Refuse-never-guess env resolver taking an injected NodeJS.ProcessEnv, with process.env read at exactly one call site (index.ts#execute)"

key-files:
  created:
    - .pi/extensions/qoder/client.ts
    - .pi/extensions/qoder/index.ts
    - tests/unit/qoder-client.test.ts
  modified:
    - tests/unit/contributing-boundary.test.ts

key-decisions:
  - "Qoder delegate tool lives in its own .pi/extensions/qoder/ directory, not inside routing/ -- physical separation reinforcing that it is never a routing target (05-CONTEXT.md decision 11)"
  - "Tool schema carries only a single required `task` string field -- every other candidate field (session title, thinking-progress toggle) is a per-request token cost with no requirement forcing it"
  - "Refusal is a thrown Error with an actionable message, not a returned isError result -- AgentToolResult carries no isError field on this Pi version; Pi's own agent loop converts a thrown Error into isError:true, matching safety/index.ts#registerApprovalTool's existing precedent"
  - "Transcript writes (own base 'qoder' in .pi/logs/) are best-effort and never throw, mirroring safety/audit.ts#writeAuditRow -- a logging failure must not break the delegated task"

requirements-completed: [ROUTE-11]

# Metrics
duration: ~30m
completed: 2026-08-14
---

# Phase 5 Plan 3: Qoder Delegate Tool Summary

**Qoder Cloud Agents HTTP client (config refusal, incremental SSE parser, three-step delegate sequence) plus the registered `qoder_delegate` tool whose own description names all four controls it bypasses -- ROUTE-11's buildable half, with the live check left OUTSTANDING as `RB-05-01` in a later plan.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-14T05:37:13Z
- **Tasks:** 3 completed
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `.pi/extensions/qoder/client.ts`: a pure `resolveQoderConfig` (refuses on missing PAT/agent-id/environment-id naming each variable and its one-time setup step, refuses a token without the `pt-` prefix, refuses a base URL that is neither `https:` nor a `127.0.0.1` loopback), a pure incremental `parseSseFrames`/`foldDelegatedResult` pair tolerant of unknown event types and malformed `data:` lines, and an impure `delegateTask` that runs the three-step Cloud Agents sequence (create session → send task → stream + fold) with a redacted, best-effort transcript.
- `.pi/extensions/qoder/index.ts`: registers `qoder_delegate` with a first-class description naming all four bypassed controls (Pi's own tools, `AGENTS.md`/system prompt, the Phase 4 safety hooks, the Phase 2 wire inspector) and the auto-deploy consequence, measured at 1315 bytes / 329 tokens.
- `tests/unit/contributing-boundary.test.ts`: `TOOL_REGISTRATION_ALLOWLIST` extended with `.pi/extensions/qoder/index.ts` and a full (a)/(b)/(c) justification in the same commit, following `safety/index.ts`'s worked example.
- `tests/unit/qoder-client.test.ts`: 13 tests proving the refusal path and the tolerant SSE parser entirely offline, including the incremental-parser property across two independent chunk splits of the RESEARCH C.3 fixture.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write .pi/extensions/qoder/client.ts** - `7f46786` (feat)
2. **Task 2: Register the tool in .pi/extensions/qoder/index.ts and add the allowlist entry** - `19fb24e` (feat)
3. **Task 3: tests/unit/qoder-client.test.ts** - `34500c7` (test)

_Note: Task 3 was framed as `tdd="true"` in the plan, but its subject (`client.ts`) was necessarily written first in Task 1 -- the pure functions under test could not exist before the module that exports them. The test file was authored and run against the real implementation rather than against a stub, and every case was checked for non-vacuity (e.g. the unknown-event-type test asserts the unknown frame was genuinely parsed, not merely that the suite stayed green) rather than following a literal RED-then-GREEN commit sequence._

## Files Created/Modified

- `.pi/extensions/qoder/client.ts` - Config resolution, incremental SSE parser, result folder, and the three-step HTTP delegate sequence with a redacted transcript
- `.pi/extensions/qoder/index.ts` - The registered `qoder_delegate` tool: schema, foreign-agent description, refuse-via-throw execute()
- `tests/unit/qoder-client.test.ts` - Offline proof of the refusal path and the SSE parser (13 tests)
- `tests/unit/contributing-boundary.test.ts` - `TOOL_REGISTRATION_ALLOWLIST` entry + (a)/(b)/(c) justification for `qoder/index.ts`

## Decisions Made

- **Schema measurement command**: `node -e` using `createRequire(path.join(process.cwd(), "package.json"))` to load `typebox` from the repo's real `node_modules`, then `JSON.stringify({type:"function",function:{name,description,parameters}})` and `Buffer.byteLength(json, "utf8")` — result: 1315 bytes, `Math.ceil(1315/4) = 329` tokens, recorded verbatim in the allowlist comment.
- **`onThinking` progress surfaced via `onUpdate`**: `delegateTask` accepts an `onThinking(thinkingText)` callback, called only when the accumulated thinking text grows, and `index.ts` wires it to `onUpdate({content:[{type:"text",text:thinkingText}], details: undefined})` — the five-argument `execute` signature already used by `safety/index.ts`.
- **Base-URL guard placed in `resolveQoderConfig` itself**, not only at the `delegateTask` call site, mirroring `tests/helpers/loopback.ts#assertLoopbackUrl`'s "enforced here, not at the call site" discipline — a later plan's loopback fixture can point `QODER_BASE_URL` at `127.0.0.1` and this refusal will not fire, while a copy-paste that reintroduces a real non-TLS host fails loudly.
- **Transcript never records the `Authorization` header** — the header map is never even constructed as a plain object anywhere the transcript writer can see it; only status codes, URLs and byte counts are logged, then passed through `redactDeep` regardless.

## Deviations from Plan

None — plan executed exactly as written. All acceptance-criteria greps, both automated verification commands per task, and the plan-level `<verification>` block (offline test set, `tsc --noEmit`, full suite, the `pt-` grep) all pass as specified.

## Issues Encountered

- Initial draft of `tests/unit/qoder-client.test.ts` accidentally contained the literal substring `process.env` three times in prose comments (the acceptance criterion only checked for the *code* pattern, but the plan's grep `process\.env` matches raw text unconditionally). Fixed by rephrasing the prose and building the self-check's own forbidden pattern from string parts (`["process","env"].join("\\.")`) rather than writing it as a literal, so the assertion cannot trip its own grep. Verified `grep -c "process\.env" tests/unit/qoder-client.test.ts` now reports 0.

## User Setup Required

None for this plan. `QODER_PERSONAL_ACCESS_TOKEN`, `QODER_AGENT_ID` and `QODER_ENVIRONMENT_ID` remain unset on this machine by design — the refusal path is the path that actually runs here. The live check (`RB-05-01`) and its `docs/RUNBOOK.md` entry are a later plan's responsibility per `05-RESEARCH.md` Part A.7; this plan does not claim to have written it.

## Next Phase Readiness

- `qoder_delegate` is registered, allowlisted with a measured cost, and its description states the foreign-agent bypass plainly to both model and user.
- With no PAT configured, the tool refuses with a message naming the variable and the one-time setup step — verified both by the unit tests (pure resolver) and by this being the actual, unavoidable state of this machine.
- The SSE parser tolerates unknown event types and malformed lines, proven by two adversarial cases RESEARCH marked UNVERIFIED for the live check.
- Qoder still appears in no `models.json` entry, no role→model map, no fallback chain and no capability guard — nothing in this plan touched `routing/`.
- Outstanding for a later plan: `docs/RUNBOOK.md`'s `RB-05-01` entry, `tests/unit/docs-policy.test.ts`'s `PHASE_FIVE_IDS`/`ENTRY_COMMANDS` additions, `docs/ROUTING.md`'s full foreign-agent paragraph, and the offline loopback integration test (`tests/integration/qoder-delegate.test.ts`) that exercises `delegateTask` end-to-end against a fake Cloud Agents server — none of these were in this plan's `files_modified` and none were built here.

---
*Phase: 05-routing-capability-guards*
*Completed: 2026-08-14*
